import { noise1, noise2 } from '../noise';
import { Backdrop, TongueFire, blend, drawEmbers, glow, ridge, ridgeY, seeded, shade, type Ember } from '../illustration';
import type { FireFrame, FireHost, FireRenderer, FireTap, FireTheme, HotZone, PointerSample } from '../types';
import { fadeToPage } from './classic';

// A tribute to Grand Theft Auto V: a burn barrel in an empty lot at Los Santos golden hour, under
// the game's HUD. Feeding the fire is a crime — the wanted stars climb and the sirens close in —
// and pushing it too far ends the way it always does: wasted, or busted. Everything is drawn
// here; no artwork from the game is used.

const MAX_EMBERS = 140;
const MAX_STARS = 5;
/** Seconds without a crime before the stars start to fade, and seconds per star lost after that. */
const EVADE_AFTER = 6;
const STAR_FADE = 3;
/** Stoking by hand past this blows the barrel; each tap adds STOKE, which drains at STOKE_DRAIN per second. */
const BLOW_AT = 2.5;
const STOKE = 0.45;
const STOKE_DRAIN = 0.7;
/** Seconds the fire stays out after it blows or the cops put it out. */
const OUT_FOR = 3.4;
/** Seconds a banner (mission passed, wasted, busted) stays up. */
const BANNER_FOR = 3.2;
/** Letters fed per "mission". */
const MISSION_EVERY = 4;
const MISSION_PAY = 5000;
const LETTER_PAY = 100;

type Banner = 'passed' | 'wasted' | 'busted';

interface CashPop {
  amount: number;
  age: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const money = (v: number) => `$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;

/** A palm tree silhouette: a leaning, tapering trunk and a crown of drooping fronds. */
function palm(path: Path2D, x: number, baseY: number, height: number, lean: number, rand: () => number) {
  const topX = x + lean * height;
  const topY = baseY - height;
  const midX = x + lean * height * 0.35;
  const midY = baseY - height * 0.55;
  const w0 = height * 0.035;
  const w1 = height * 0.016;
  path.moveTo(x - w0, baseY);
  path.quadraticCurveTo(midX - (w0 + w1) / 2, midY, topX - w1, topY);
  path.lineTo(topX + w1, topY);
  path.quadraticCurveTo(midX + (w0 + w1) / 2, midY, x + w0, baseY);
  path.closePath();
  const fronds = 7 + Math.floor(rand() * 3);
  for (let i = 0; i < fronds; i++) {
    const a = -Math.PI / 2 + ((i / (fronds - 1)) * 2 - 1) * 1.9 + (rand() - 0.5) * 0.3;
    const len = height * (0.26 + rand() * 0.12);
    const droop = height * (0.1 + rand() * 0.1);
    const tx = topX + Math.cos(a) * len;
    const ty = topY + Math.sin(a) * len * 0.55 + droop;
    const cx = topX + Math.cos(a) * len * 0.5;
    const cy = topY + Math.sin(a) * len * 0.5 - droop * 0.4;
    const t = height * 0.03;
    path.moveTo(topX, topY);
    path.quadraticCurveTo(cx, cy - t, tx, ty);
    path.quadraticCurveTo(cx, cy + t, topX, topY + t * 0.5);
    path.closePath();
  }
}

/** A five-pointed star centred on (x, y). */
function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/**
 * A burn barrel in an empty Los Santos lot at sunset — palms, the downtown skyline and a sign on
 * the hills — with a wanted level, cash, a minimap and the game's big banners drawn over it.
 */
class BurnBarrel implements FireRenderer {
  private readonly fire = new TongueFire(7);
  private readonly backdrop = new Backdrop();
  private embers: Ember[] = [];

  private width = 0;
  private height = 0;
  private scale = 1;
  /** Where the barrel stands, and the top of its rim. */
  private cx = 0;
  private ground = 0;
  private rim = 0;
  private font = 'Impact, sans-serif';

  private time = 0;
  private ignition = 0;
  private boost = 0;
  /** How hard the fire's been stoked by hand lately; full blows the barrel. */
  private stoke = 0;
  private flicker = 1;
  private wind = 0;
  private pointer: PointerSample | null = null;
  private reducedMotion = false;
  private emberDebt = 0;

  /** Wanted level, 0..5; whole stars are shown. */
  private wanted = 0;
  private lastCrime = -99;
  private cash = 4250;
  private shownCash = 4250;
  private pops: CashPop[] = [];
  private fed = 0;
  private banner: Banner | null = null;
  private bannerAge = 0;
  private bannerPay = 0;
  /** Seconds left with the fire out. */
  private out = 0;
  /** Explosion flash, 1 at the blast and fading to 0. */
  private blast = 0;
  /** Which way the player arrow on the minimap faces. */
  private heading = 0;

  constructor(private readonly host: FireHost) {
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-gta').trim();
    if (font) this.font = `${font}, Impact, sans-serif`;
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    const s = this.scale;
    this.cx = width / 2;
    this.ground = height - 58 * s;
    this.rim = this.ground - 96 * s;
    this.backdrop.paint(width, height, (ctx) => this.paintScene(ctx));
  }

  hotZone(): HotZone | null {
    if (this.out > 0) return null;
    const s = this.scale;
    const top = this.rim - (160 + 60 * Math.min(this.boost, 2)) * s;
    return { x: this.cx - 70 * s, y: top, width: 140 * s, height: this.ground - top };
  }

  groundY() {
    return this.ground;
  }

  tap({ x, onFire, onLetter }: FireTap) {
    if (onLetter || !onFire || this.out > 0 || this.banner === 'wasted' || this.banner === 'busted') return;
    this.boost = Math.min(this.boost + 0.4, 2.6);
    this.stoke += STOKE;
    const bx = clamp(x, this.cx - 30 * this.scale, this.cx + 30 * this.scale);
    for (let i = 0; i < 20; i++) this.burstEmber(bx, this.rim - 10 * this.scale, 0.9);
    this.fire.burst(bx, this.rim - 30 * this.scale, 3);
    this.crime(1 / 3);
    if (this.stoke > BLOW_AT) this.explode();
  }

  feed(x: number, y: number, fuel: number) {
    if (this.out > 0) return;
    // Letters feed the fire but never blow it; only stoking by hand does that.
    this.boost = Math.min(this.boost + 0.6 * fuel, 2.6);
    for (let i = 0; i < 36 * fuel; i++) this.burstEmber(x, Math.min(y, this.rim), 1.1);
    this.fire.burst(x, Math.min(y, this.rim - 20 * this.scale), Math.round(5 * fuel));
    // Arson: a star for every letter thrown in, and a little cash for the trouble.
    if (!this.crime(1)) return;
    this.earn(LETTER_PAY);
    this.fed++;
    if (this.fed % MISSION_EVERY === 0 && !this.banner) {
      this.show('passed');
      this.bannerPay = MISSION_PAY;
      this.earn(MISSION_PAY);
    }
  }

  update({ time, dt: realDt, pointer, reducedMotion }: FireFrame) {
    this.time = time;
    this.pointer = pointer;
    this.reducedMotion = reducedMotion;
    // Wasted and busted play out in slow motion, like the game.
    const slow = this.banner === 'wasted' || this.banner === 'busted';
    const dt = slow ? realDt * 0.3 : realDt;

    if (this.banner) {
      this.bannerAge += realDt;
      if (this.bannerAge > BANNER_FOR) this.banner = null;
    }
    this.blast = Math.max(0, this.blast - realDt * 1.4);
    if (this.out > 0) {
      this.out -= realDt;
      // Relit, from nothing.
      if (this.out <= 0) this.ignition = 0;
    } else {
      this.ignition = Math.min(1, this.ignition + dt / 1.4);
    }
    const lit = this.out > 0 ? 0 : 1 - (1 - this.ignition) ** 3;
    this.boost *= Math.exp(-0.5 * dt);
    this.stoke = Math.max(0, this.stoke - STOKE_DRAIN * dt);
    this.flicker = 0.85 + 0.2 * noise1(time * 3.1) + 0.08 * noise1(time * 9.7 + 40);

    // Losing the cops: after a quiet spell the stars go one at a time.
    if (this.wanted > 0 && time - this.lastCrime > EVADE_AFTER) this.wanted = Math.max(0, this.wanted - realDt / STAR_FADE);

    this.shownCash += (this.cash - this.shownCash) * Math.min(1, realDt * 6);
    for (const p of this.pops) p.age += realDt;
    this.pops = this.pops.filter((p) => p.age < 2.2);

    const s = this.scale;
    if (pointer) {
      const target = Math.atan2(pointer.x - this.cx, -(pointer.y - this.rim));
      let d = target - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, realDt * 5);
      const proximity = clamp(1 - Math.hypot(pointer.x - this.cx, pointer.y - this.rim) / (320 * s), 0, 1);
      this.wind += clamp(pointer.vx / 1500, -1.5, 1.5) * proximity * dt * 6;
    }
    const ambient = (noise1(time * 0.35 + 90) - 0.5) * 0.4;
    this.wind += (ambient - this.wind) * Math.min(1, dt * 1.4);
    this.wind = clamp(this.wind, -1.2, 1.2);

    const boost = Math.min(this.boost, 2);
    this.fire.place(this.cx, this.rim + 2 * s, 66 * s * (1 + 0.15 * boost), 170 * s * lit * this.flicker * (1 + 0.35 * boost), this.wind * 0.8);
    this.fire.update(reducedMotion ? dt * 0.5 : dt, time);

    this.emberDebt += (reducedMotion ? 2 : 6) * lit * (1 + 2.5 * boost) * dt;
    while (this.emberDebt >= 1) {
      this.emberDebt -= 1;
      this.pushEmber(this.cx + gauss() * 20 * s, this.rim - rand(20, 80) * s, rand(-30, 30) * s, -rand(80, 200) * s);
    }
    this.stepEmbers(dt);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const s = this.scale;
    const lit = this.out > 0 ? 0 : 1 - (1 - this.ignition) ** 3;
    const light = lit * this.flicker * (1 + 0.35 * Math.min(this.boost, 2));

    this.backdrop.draw(ctx);
    this.drawSkylineLights(ctx);

    glow(ctx, this.cx, this.rim - 50 * s, 420 * s, [255, 130, 60], 0.18 * light);
    ctx.save();
    ctx.translate(this.cx, this.ground);
    ctx.scale(1, 0.22);
    glow(ctx, 0, 0, 260 * s, [255, 140, 70], 0.32 * light);
    ctx.restore();

    this.drawBarrel(ctx, light, 'back');
    this.fire.draw(ctx);
    this.drawBarrel(ctx, light, 'front');
    drawEmbers(ctx, this.embers, this.time);

    this.drawSearchlight(ctx);
    this.drawSirens(ctx);
    this.drawBlast(ctx);
    if (this.banner === 'wasted' || this.banner === 'busted') this.desaturate(ctx);
    fadeToPage(ctx, this.width, this.height);

    this.drawMinimap(ctx, lit);
    this.drawWanted(ctx);
    this.drawBanner(ctx);
  }

  // ---- game ----

  /** A crime raises the wanted level; one more at five stars and the cops close in. Returns false when busted. */
  private crime(stars: number) {
    if (this.banner === 'wasted' || this.banner === 'busted') return false;
    if (this.wanted >= MAX_STARS - 0.001) {
      this.bust();
      return false;
    }
    this.wanted = Math.min(MAX_STARS, this.wanted + stars);
    this.lastCrime = this.time;
    return true;
  }

  /** Whole stars shown: any crime at all shows one, and five means the next one gets you busted. */
  private stars() {
    return this.wanted <= 0 ? 0 : Math.max(1, Math.floor(this.wanted + 1e-6));
  }

  private earn(amount: number) {
    this.cash = Math.max(0, this.cash + amount);
    this.pops.push({ amount, age: 0 });
  }

  private show(banner: Banner) {
    this.banner = banner;
    this.bannerAge = 0;
  }

  /** Stoked too hard: the barrel goes up, and so do you. */
  private explode() {
    this.blast = 1;
    this.out = OUT_FOR;
    this.boost = 0;
    this.stoke = 0;
    this.wanted = 0;
    if (!this.reducedMotion) this.host.shake(10);
    for (let i = 0; i < 90; i++) this.burstEmber(this.cx, this.rim, 1.8);
    this.show('wasted');
    // The hospital bill.
    this.earn(-Math.min(this.cash, 500));
  }

  /** Five stars and still at it: the cops put the fire out. */
  private bust() {
    this.out = OUT_FOR;
    this.boost = 0;
    this.stoke = 0;
    this.wanted = 0;
    if (!this.reducedMotion) this.host.shake(3);
    this.show('busted');
    this.earn(-Math.min(this.cash, 1000));
  }

  // ---- scene ----

  /** Sky, sun, hills with their sign, the skyline, palms, the fence and the lot. Painted once per resize. */
  private paintScene(ctx: CanvasRenderingContext2D) {
    const { width: w, height: h, scale: s, ground } = this;
    const rand = seeded(17);

    const sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, '#241640');
    sky.addColorStop(0.32, '#5d2a63');
    sky.addColorStop(0.55, '#c64a5c');
    sky.addColorStop(0.72, '#f39048');
    sky.addColorStop(0.86, '#ffc56e');
    sky.addColorStop(1, '#ffdc8f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // A few early stars up top.
    ctx.fillStyle = '#ffe9d6';
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = 0.15 + rand() * 0.4;
      ctx.fillRect(rand() * w, rand() ** 2 * h * 0.25, 1, 1);
    }
    ctx.globalAlpha = 1;

    // The low sun, with long haze bands across it.
    const sunX = w * 0.7;
    const sunY = ground - h * 0.2;
    glow(ctx, sunX, sunY, 260 * s, [255, 200, 120], 0.35);
    ctx.fillStyle = '#fff0bf';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 46 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(243, 144, 72, 0.55)';
    for (let k = 0; k < 4; k++) ctx.fillRect(0, sunY + (6 + k * 11) * s, w, (2 + k) * s);

    // Hills, and the big white letters on them.
    const hills = { base: ground - h * 0.17, amp: h * 0.14, freq: 0.0026, seed: 5 };
    ctx.fillStyle = '#8a3f63';
    ctx.fill(ridge(w, hills.base, hills.amp, hills.freq, hills.seed, h));
    this.paintSign(ctx, hills);
    const near = { base: ground - h * 0.1, amp: h * 0.06, freq: 0.005, seed: 13 };
    ctx.fillStyle = '#6a2f55';
    ctx.fill(ridge(w, near.base, near.amp, near.freq, near.seed, h));

    this.paintSkyline(ctx, rand);

    // Chain-link fence along the back of the lot.
    const fenceTop = ground - 46 * s;
    ctx.strokeStyle = 'rgba(35, 18, 40, 0.55)';
    ctx.lineWidth = Math.max(1, 0.8 * s);
    const mesh = 9 * s;
    ctx.beginPath();
    for (let x = -46 * s; x < w + 46 * s; x += mesh) {
      ctx.moveTo(x, fenceTop);
      ctx.lineTo(x + 46 * s, ground);
      ctx.moveTo(x + 46 * s, fenceTop);
      ctx.lineTo(x, ground);
    }
    ctx.stroke();
    ctx.fillStyle = '#2a1430';
    for (let x = 20 * s; x < w; x += 90 * s) ctx.fillRect(x, fenceTop - 4 * s, 3 * s, ground - fenceTop + 4 * s);
    ctx.fillRect(0, fenceTop - 4 * s, w, 2.5 * s);

    // Palms: tall ones framing the lot, smaller ones further off.
    const far = new Path2D();
    for (let x = rand() * 60 * s; x < w; x += (70 + rand() * 120) * s) {
      if (Math.abs(x - this.cx) < 120 * s) continue;
      palm(far, x, ground - 30 * s, (110 + rand() * 70) * s, (rand() - 0.5) * 0.25, rand);
    }
    ctx.fillStyle = '#4a2048';
    ctx.fill(far);
    const framing = new Path2D();
    for (const [fx, lean, size] of [
      [0.06, 0.12, 0.62],
      [0.15, -0.06, 0.48],
      [0.88, -0.14, 0.66],
      [0.96, 0.05, 0.5],
    ]) {
      // On a tall phone screen, size them by the width so they don't tower over the title.
      palm(framing, w * fx, ground + 6 * s, Math.min(h, w * 1.1) * size, lean, rand);
    }
    ctx.fillStyle = '#1d0d22';
    ctx.fill(framing);

    // The lot: cracked asphalt with faded parking lines.
    const lot = ctx.createLinearGradient(0, ground - 8 * s, 0, h);
    lot.addColorStop(0, '#3a2433');
    lot.addColorStop(1, '#1a1018');
    ctx.fillStyle = lot;
    ctx.fillRect(0, ground - 8 * s, w, h);
    ctx.fillStyle = 'rgba(255, 236, 200, 0.18)';
    for (let x = 30 * s; x < w; x += 110 * s) {
      if (Math.abs(x - this.cx) < 70 * s) continue;
      ctx.save();
      ctx.translate(x, ground);
      ctx.transform(1, 0, -0.6, 1, 0, 0);
      ctx.fillRect(0, 0, 4 * s, h);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(10, 5, 10, 0.45)';
    ctx.lineWidth = Math.max(1, s);
    for (let i = 0; i < 9; i++) {
      let x = rand() * w;
      let y = ground + rand() * (h - ground);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (rand() - 0.5) * 30 * s;
        y += rand() * 6 * s;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  /** White block letters standing on the hillside — our own sign, spelling the team's name. */
  private paintSign(ctx: CanvasRenderingContext2D, hill: { base: number; amp: number; freq: number; seed: number }) {
    const s = this.scale;
    const text = 'CAMPFIRE';
    const size = 17 * s;
    const step = size * 0.82;
    const x0 = this.width * 0.16;
    ctx.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let i = 0; i < text.length; i++) {
      const x = x0 + i * step;
      const y = ridgeY(x, hill.base, hill.amp, hill.freq, hill.seed) + size * 0.9;
      ctx.fillStyle = 'rgba(60, 20, 50, 0.5)';
      ctx.fillText(text[i], x + 1.5 * s, y + 1.5 * s);
      ctx.fillStyle = '#fbe6d8';
      ctx.fillText(text[i], x, y);
    }
  }

  /** Downtown on the horizon: towers in silhouette, one tall one with a spire. */
  private paintSkyline(ctx: CanvasRenderingContext2D, rand: () => number) {
    const { height: h, scale: s, ground } = this;
    const left = this.width * 0.42;
    const right = this.width * 0.86;
    const base = ground - 34 * s;
    ctx.fillStyle = '#4b2350';
    for (let x = left; x < right; ) {
      const bw = (14 + rand() * 22) * s;
      const centre = 1 - Math.abs((x - (left + right) / 2) / ((right - left) / 2));
      const bh = (30 + rand() * 60 + centre * 110) * s * (h / 700);
      ctx.fillRect(x, base - bh, bw, bh + 40 * s);
      if (rand() < 0.3) ctx.fillRect(x + bw * 0.3, base - bh - 8 * s, bw * 0.4, 8 * s);
      x += bw + rand() * 4 * s;
    }
    const tx = left + (right - left) * 0.58;
    const th = 240 * s * (h / 700);
    ctx.beginPath();
    ctx.moveTo(tx - 16 * s, base);
    ctx.lineTo(tx - 13 * s, base - th);
    ctx.lineTo(tx, base - th - 22 * s);
    ctx.lineTo(tx + 13 * s, base - th);
    ctx.lineTo(tx + 16 * s, base);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(tx - 1, base - th - 46 * s, 2, 26 * s);
  }

  /** Windows lighting up across the skyline as the sun goes, and red lights on the tallest tops. */
  private drawSkylineLights(ctx: CanvasRenderingContext2D) {
    const { scale: s, ground, time } = this;
    const left = this.width * 0.42;
    const right = this.width * 0.86;
    const base = ground - 34 * s;
    const cols = Math.floor((right - left) / (6 * s));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < 18; r++) {
        const n = noise2(c * 0.9, r * 0.9 + 3);
        if (n < 0.62) continue;
        const on = noise2(c * 0.7 + time * 0.05, r * 0.7) > 0.45;
        if (!on) continue;
        ctx.fillStyle = n > 0.8 ? 'rgba(255, 236, 170, 0.7)' : 'rgba(255, 200, 140, 0.45)';
        ctx.fillRect(left + c * 6 * s, base - (8 + r * 7) * s, 2 * s, 2.5 * s);
      }
    }
    if (Math.floor(time * 1.1) % 2 === 0) {
      const tx = left + (right - left) * 0.58;
      const th = 240 * s * (this.height / 700);
      glow(ctx, tx, base - th - 46 * s, 8 * s, [255, 60, 60], 0.9);
    }
  }

  /** The burn barrel, cel-shaded by its own fire. The front lip is drawn after the flames so they sit inside. */
  private drawBarrel(ctx: CanvasRenderingContext2D, light: number, part: 'back' | 'front') {
    const s = this.scale;
    const { cx, rim, ground } = this;
    const hw = 36 * s;
    const lip = 9 * s;
    if (part === 'front') {
      ctx.strokeStyle = blend('#5d3b2c', '#ffb276', clamp(light * 0.8, 0, 1));
      ctx.lineWidth = 3.5 * s;
      ctx.beginPath();
      ctx.ellipse(cx, rim, hw, lip, 0, 0, Math.PI);
      ctx.stroke();
      return;
    }
    const body = new Path2D();
    body.moveTo(cx - hw, rim);
    body.lineTo(cx - hw, ground);
    body.ellipse(cx, ground, hw, lip, 0, Math.PI, 0, true);
    body.lineTo(cx + hw, rim);
    body.ellipse(cx, rim, hw, lip, 0, 0, Math.PI);
    body.closePath();
    // Lit from the side the wind blows the flames to, mostly from above.
    shade(
      ctx,
      body,
      { base: '#6b3f2c', shadow: '#2e1a14', light: blend('#8a5a3c', '#ffad6a', clamp(light, 0, 1.2)) },
      { x: this.wind * 30, y: -60 },
      4 * s,
      14 * s,
    );
    ctx.save();
    ctx.clip(body);
    // Rust streaks, rolled ribs and a dent.
    ctx.fillStyle = 'rgba(160, 70, 30, 0.35)';
    for (const [x, y, ww, hh] of [[-24, 18, 10, 38], [8, 40, 14, 26], [18, 10, 6, 20]]) {
      ctx.fillRect(cx + x * s, rim + y * s, ww * s, hh * s);
    }
    ctx.strokeStyle = 'rgba(25, 12, 8, 0.6)';
    ctx.lineWidth = 2.5 * s;
    for (const k of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.ellipse(cx, rim + (ground - rim) * k, hw, lip, 0, 0, Math.PI);
      ctx.stroke();
    }
    ctx.restore();
    // The open top: dark inside, glowing where the fire sits.
    ctx.fillStyle = '#1b0e0a';
    ctx.beginPath();
    ctx.ellipse(cx, rim, hw, lip, 0, 0, Math.PI * 2);
    ctx.fill();
    glow(ctx, cx, rim, hw * 1.1, [255, 120, 40], 0.7 * clamp(light, 0, 1));
    ctx.strokeStyle = blend('#4a2c20', '#ff9c5c', clamp(light * 0.6, 0, 1));
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.ellipse(cx, rim, hw, lip, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }

  // ---- effects ----

  /** Three stars and up, a police helicopter's searchlight sweeps the lot. */
  private drawSearchlight(ctx: CanvasRenderingContext2D) {
    const k = clamp(this.wanted - 2, 0, 1);
    if (k <= 0 || this.banner === 'wasted' || this.banner === 'busted') return;
    const s = this.scale;
    const gx = this.cx + Math.sin(this.time * 0.6) * this.width * 0.3;
    const hx = this.cx + Math.sin(this.time * 0.6 - 0.6) * this.width * 0.2;
    const r = 70 * s;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(hx, -20, gx, this.ground);
    beam.addColorStop(0, `rgba(230, 240, 255, ${(0.02 * k).toFixed(3)})`);
    beam.addColorStop(1, `rgba(230, 240, 255, ${(0.14 * k).toFixed(3)})`);
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(hx - 4 * s, -20);
    ctx.lineTo(hx + 4 * s, -20);
    ctx.lineTo(gx + r, this.ground);
    ctx.lineTo(gx - r, this.ground);
    ctx.closePath();
    ctx.fill();
    ctx.translate(gx, this.ground);
    ctx.scale(1, 0.25);
    glow(ctx, 0, 0, r * 1.2, [230, 240, 255], 0.35 * k);
    ctx.restore();
  }

  /** Red and blue light washing in from the edges while the cops are after you. */
  private drawSirens(ctx: CanvasRenderingContext2D) {
    const k = clamp(this.wanted / MAX_STARS, 0, 1);
    if (k <= 0 || this.banner === 'wasted' || this.banner === 'busted') return;
    const phase = Math.floor(this.time * 3) % 2 === 0;
    const reach = this.width * 0.35;
    const a = (0.12 + 0.28 * k) * (this.reducedMotion ? 0.5 : 1);
    for (const [side, color] of [
      [0, phase ? '255, 40, 50' : '40, 90, 255'],
      [1, phase ? '40, 90, 255' : '255, 40, 50'],
    ] as const) {
      const x0 = side ? this.width : 0;
      const g = ctx.createLinearGradient(x0, 0, side ? this.width - reach : reach, 0);
      g.addColorStop(0, `rgba(${color}, ${a.toFixed(3)})`);
      g.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(side ? this.width - reach : 0, 0, reach, this.height);
    }
  }

  private drawBlast(ctx: CanvasRenderingContext2D) {
    if (this.blast <= 0) return;
    const s = this.scale;
    const t = 1 - this.blast;
    glow(ctx, this.cx, this.rim - 40 * s, (120 + 380 * t) * s, [255, 150, 60], this.blast);
    glow(ctx, this.cx, this.rim - 40 * s, (60 + 160 * t) * s, [255, 240, 200], this.blast);
    ctx.fillStyle = `rgba(255, 245, 225, ${(this.blast ** 3 * 0.8).toFixed(3)})`;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /** Drains the colour out of everything drawn so far, and darkens it. */
  private desaturate(ctx: CanvasRenderingContext2D) {
    const k = clamp(this.bannerAge / 0.6, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = `rgba(128, 128, 128, ${k.toFixed(3)})`;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0, 0, 0, ${(0.4 * k).toFixed(3)})`;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  // ---- HUD ----

  /** Bottom-left: the radar with roads, the sea, blips and police, and the three bars under it. */
  private drawMinimap(ctx: CanvasRenderingContext2D, lit: number) {
    const s = Math.max(this.scale, 0.7);
    const mw = 170 * s;
    const mh = 108 * s;
    const x = 18 * s;
    const y = this.height - mh - 30 * s;
    const ccx = x + mw / 2;
    const ccy = y + mh * 0.62;
    const turn = (noise1(this.time * 0.05) - 0.5) * 1.2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, mw, mh);
    ctx.clip();
    ctx.fillStyle = '#4c5a50';
    ctx.fillRect(x, y, mw, mh);
    ctx.translate(ccx, ccy);
    ctx.rotate(turn);
    // The sea off to one side, a park, then the street grid.
    ctx.fillStyle = '#3d6f93';
    ctx.beginPath();
    ctx.moveTo(70 * s, -200 * s);
    for (let k = -200; k <= 200; k += 20) ctx.lineTo((70 + Math.sin(k * 0.05) * 10) * s, k * s);
    ctx.lineTo(300 * s, 200 * s);
    ctx.lineTo(300 * s, -200 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5d7a52';
    ctx.fillRect(-90 * s, -70 * s, 40 * s, 30 * s);
    ctx.strokeStyle = '#a8aeb0';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    for (let k = -6; k <= 2; k++) {
      ctx.moveTo(k * 26 * s, -200 * s);
      ctx.lineTo(k * 26 * s, 200 * s);
    }
    for (let k = -8; k <= 8; k++) {
      ctx.moveTo(-200 * s, k * 22 * s);
      ctx.lineTo(62 * s, k * 22 * s);
    }
    ctx.stroke();
    ctx.strokeStyle = '#d6c27a';
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.moveTo(-200 * s, 120 * s);
    ctx.quadraticCurveTo(-20 * s, 20 * s, 40 * s, -200 * s);
    ctx.stroke();
    // Mission marker and the fire blip.
    ctx.fillStyle = '#f0c850';
    ctx.beginPath();
    ctx.arc(-52 * s, -40 * s, 5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = this.out > 0 ? '#777' : '#ff7a2a';
    ctx.beginPath();
    ctx.arc(0, -14 * s, 5 * s, 0, Math.PI * 2);
    ctx.fill();
    // Police closing in, one car per star.
    const cars = this.stars();
    for (let i = 0; i < cars; i++) {
      const a = this.time * (0.5 + i * 0.13) + i * 2.1;
      const d = (75 - this.wanted * 8 + Math.sin(this.time + i) * 8) * s;
      ctx.fillStyle = (Math.floor(this.time * 4) + i) % 2 ? '#ff3b3b' : '#3b7bff';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 3.5 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // The player arrow, facing the pointer.
    ctx.save();
    ctx.translate(ccx, ccy);
    ctx.rotate(this.heading);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(0, -8 * s);
    ctx.lineTo(6 * s, 7 * s);
    ctx.lineTo(0, 3 * s);
    ctx.lineTo(-6 * s, 7 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Frame: flashing red and blue while wanted.
    const chased = this.wanted > 0 && Math.floor(this.time * 3) % 2 === 0;
    ctx.strokeStyle = this.wanted > 0 ? (chased ? '#ff3b3b' : '#3b7bff') : '#000';
    ctx.lineWidth = 3 * s;
    ctx.strokeRect(x, y, mw, mh);

    // Health (the fire), armour (how much heat you're dodging) and the stoke meter, which blows when full.
    const by = y + mh + 5 * s;
    const bh = 6 * s;
    const bars: [number, number, string][] = [
      [0.5, clamp(lit * this.flicker, 0, 1), '#5fae5a'],
      [0.25, 1 - this.wanted / MAX_STARS, '#4a98d8'],
      [0.25, clamp(this.stoke / BLOW_AT, 0, 1), this.stoke / BLOW_AT > 0.75 && Math.floor(this.time * 6) % 2 ? '#ff5a3a' : '#f0c850'],
    ];
    let bx = x;
    for (const [share, value, color] of bars) {
      const bw = mw * share - 3 * s;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = color;
      ctx.fillRect(bx, by, bw * value, bh);
      bx += mw * share;
    }
  }

  /** Top-right: the wanted stars, and the cash under them with gains and losses popping in. */
  private drawWanted(ctx: CanvasRenderingContext2D) {
    const s = Math.max(this.scale, 0.7);
    const r = 13 * s;
    const right = this.width - 22 * s;
    // Narrow screens put the theme picker's dots across the top, so the stars sit below them.
    const top = (this.width < 640 ? 72 : 26) * s;
    const evading = this.wanted > 0 && this.time - this.lastCrime > EVADE_AFTER;
    const blink = evading && Math.floor(this.time * 4) % 2 === 0;
    ctx.lineJoin = 'round';
    for (let i = 0; i < MAX_STARS; i++) {
      const x = right - r - (MAX_STARS - 1 - i) * r * 2.3;
      star(ctx, x, top + r, r);
      const on = i < this.stars();
      ctx.fillStyle = on ? (blink ? '#9a9a9a' : '#ffffff') : 'rgba(0, 0, 0, 0.35)';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2.5 * s;
      ctx.stroke();
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.font = `400 ${Math.round(34 * s)}px ${this.font}`;
    ctx.lineWidth = 5 * s;
    ctx.strokeStyle = '#000';
    const cashY = top + r * 2 + 8 * s;
    const text = money(this.shownCash);
    ctx.strokeText(text, right, cashY);
    ctx.fillStyle = '#e9f6e4';
    ctx.fillText(text, right, cashY);
    ctx.font = `400 ${Math.round(26 * s)}px ${this.font}`;
    this.pops.forEach((p, i) => {
      const a = clamp(2.2 - p.age, 0, 1);
      const y = cashY + (36 + i * 26) * s - p.age * 6 * s;
      const label = `${p.amount < 0 ? '-' : '+'}${money(p.amount)}`;
      ctx.globalAlpha = a;
      ctx.strokeText(label, right, y);
      ctx.fillStyle = p.amount < 0 ? '#e0453a' : '#7bd96b';
      ctx.fillText(label, right, y);
    });
    ctx.globalAlpha = 1;
  }

  /** Mission passed in gold, wasted in red, busted in white, across a dark band. */
  private drawBanner(ctx: CanvasRenderingContext2D) {
    if (!this.banner) return;
    const s = Math.max(this.scale, 0.7);
    const t = this.bannerAge;
    const fade = clamp(t / 0.25, 0, 1) * clamp((BANNER_FOR - t) / 0.4, 0, 1);
    if (fade <= 0) return;
    // Below the title, over the fire.
    const y = this.height * 0.7;
    const big = this.banner !== 'passed';
    ctx.save();
    ctx.globalAlpha = fade;
    const band = ctx.createLinearGradient(0, 0, this.width, 0);
    band.addColorStop(0, 'rgba(0, 0, 0, 0)');
    band.addColorStop(0.25, 'rgba(0, 0, 0, 0.55)');
    band.addColorStop(0.75, 'rgba(0, 0, 0, 0.55)');
    band.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, y - (big ? 52 : 46) * s, this.width, (big ? 104 : 108) * s);

    const words = { passed: 'mission passed', wasted: 'wasted', busted: 'busted' }[this.banner];
    const color = { passed: '#f0c850', wasted: '#c8242c', busted: '#f2f2f2' }[this.banner];
    // Settles from slightly larger, the way the game punches it in.
    const pop = 1 + 0.25 * (1 - clamp(t / 0.3, 0, 1)) ** 2;
    const size = Math.round((big ? 92 : 64) * s * Math.min(1, this.width / (big ? 420 : 560)) * pop);
    ctx.font = `400 ${size}px ${this.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size * 0.09);
    ctx.strokeStyle = '#000';
    const ty = this.banner === 'passed' ? y - 12 * s : y;
    ctx.strokeText(words, this.width / 2, ty);
    ctx.fillStyle = color;
    ctx.fillText(words, this.width / 2, ty);
    if (this.banner === 'passed') {
      ctx.font = `400 ${Math.round(26 * s)}px ${this.font}`;
      ctx.lineWidth = 4 * s;
      const pay = `+${money(this.bannerPay)}`;
      ctx.strokeText(pay, this.width / 2, y + 36 * s);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(pay, this.width / 2, y + 36 * s);
    }
    ctx.restore();
  }

  // ---- embers ----

  private burstEmber(x: number, y: number, power: number) {
    const angle = -Math.PI / 2 + rand(-1.1, 1.1);
    const speed = rand(150, 460) * this.scale * power;
    this.pushEmber(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  private pushEmber(x: number, y: number, vx: number, vy: number) {
    if (this.embers.length >= MAX_EMBERS) return;
    this.embers.push({ x, y, vx, vy, age: 0, life: rand(1.2, 3), size: rand(1.1, 2.2) * Math.max(this.scale, 0.8), seed: Math.random() * 100 });
  }

  private stepEmbers(dt: number) {
    const s = this.scale;
    const drag = Math.max(0, 1 - 0.7 * dt);
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.age += dt;
      if (e.age >= e.life || e.y < -20 || e.x < -20 || e.x > this.width + 20) {
        this.embers[i] = this.embers[this.embers.length - 1];
        this.embers.pop();
        continue;
      }
      e.vy -= 40 * s * dt;
      e.vx += (noise2(e.seed, this.time * 0.9) - 0.5) * 480 * s * dt + this.wind * 150 * s * dt;
      e.vx *= drag;
      e.vy *= drag;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
  }
}

export const gtaTheme: FireTheme = {
  id: 'gta',
  label: 'Los Santos',
  palette: {
    titleFrom: '#ffffff',
    titleTo: '#ffe2b0',
    titleGlow: 'rgba(255, 140, 80, 0.4)',
    ambient: '#2a1430',
  },
  letters: { knock: 'touch', draggable: true, item: false },
  createRenderer: (host) => new BurnBarrel(host),
};
