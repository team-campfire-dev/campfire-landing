import { noise1, noise2 } from '../noise';
import { Backdrop, TongueFire, blend, css, glow, mix, seeded, shade, type RGB } from '../illustration';
import type { FireFrame, FireRenderer, FireTap, FireTheme, HotZone } from '../types';
import { fadeToPage } from './classic';

/** Roast gained per second by the side facing the grill. */
const ROAST_RATE = 0.07;
/** Both sides past this and the potato is done: it splits open and steams. */
const DONE = 0.6;
/** A side past this is charcoal. */
const BURNT = 1.2;
const FLIP_SECONDS = 0.45;
const RESPAWN_SECONDS = 2.5;
const MAX_PUFFS = 60;

interface Potato {
  /** Offset from the drum's center in drum-widths, so it survives a resize. */
  slot: number;
  /** Roast of the side facing up and the side facing the grill. */
  up: number;
  down: number;
  /** Seconds into a flip, or -1 when resting. */
  flip: number;
  /** Seconds until a taken potato is replaced, or -1 while it is on the grill. */
  away: number;
  seed: number;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  /** Steam is white and quick; smoke is grey and lingers. */
  steam: boolean;
}

interface Flake {
  x: number;
  y: number;
  size: number;
  speed: number;
  seed: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Skin colour for a roast level: purple-red raw, dark roasted, black burnt. */
function skin(roast: number): RGB {
  const stops: [number, RGB][] = [
    [0, [158, 62, 92]],
    [DONE, [104, 42, 48]],
    [1, [66, 32, 30]],
    [BURNT, [28, 22, 22]],
  ];
  let i = 1;
  while (i < stops.length - 1 && stops[i][0] < roast) i++;
  const [p0, c0] = stops[i - 1];
  const [p1, c1] = stops[i];
  return mix(c0, c1, (roast - p0) / (p1 - p0));
}

const freshPotato = (slot: number): Potato => ({
  slot,
  up: rand(0, 0.05),
  down: rand(0, 0.05),
  flip: -1,
  away: -1,
  seed: Math.random() * 100,
});

/**
 * A street-corner sweet potato drum on a snowy night. Potatoes on the grill roast on the side
 * facing down: click to turn them over, and once both sides are done they split open — click
 * again to take one.
 */
class SweetPotatoDrum implements FireRenderer {
  private readonly fire = new TongueFire(6, undefined, 2);
  private readonly backdrop = new Backdrop();
  private potatoes: Potato[] = [-0.28, 0, 0.28].map(freshPotato);
  private puffs: Puff[] = [];
  private flakes: Flake[] = [];

  private width = 0;
  private height = 0;
  private scale = 1;
  private cx = 0;
  private time = 0;
  private ignition = 0;
  private boost = 0;
  private smokeDebt = 0;
  private steamDebt = 0;

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    this.cx = width / 2;
    const count = Math.round(clamp((width * height) / 8000, 30, 160));
    this.flakes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: rand(1, 2.6),
      speed: rand(18, 45),
      seed: Math.random() * 100,
    }));
    this.backdrop.paint(width, height, (ctx) => this.paintStreet(ctx));
  }

  hotZone(): HotZone {
    const { x, width, top } = this.drum();
    return { x, y: top - 30 * this.scale, width, height: 60 * this.scale };
  }

  /** Letters land on the grill over the drum, in the snow elsewhere. */
  groundY(x: number) {
    const drum = this.drum();
    return x > drum.x && x < drum.x + drum.width ? drum.top : this.ground() + 6 * this.scale;
  }

  tap({ x, y, onLetter }: FireTap) {
    if (onLetter) return;
    const hit = this.potatoAt(x, y);
    if (hit) {
      this.handle(hit);
      return;
    }
    const door = this.door();
    if (x > door.x && x < door.x + door.width && y > door.y && y < door.y + door.height) {
      this.boost = Math.min(this.boost + 0.4, 1.5);
      this.fire.burst(this.cx, door.y + door.height * 0.6, 3);
    }
  }

  feed(x: number, _y: number, fuel: number) {
    this.boost = Math.min(this.boost + 0.6 * fuel, 1.5);
    for (let i = 0; i < 6; i++) this.puff(x + rand(-20, 20), this.drum().top - 10 * this.scale, false);
  }

  update({ time, dt }: FireFrame) {
    this.time = time;
    this.ignition = Math.min(1, this.ignition + dt / 1.5);
    this.boost *= Math.exp(-0.4 * dt);
    const heat = this.ignition * (1 + 0.6 * this.boost);

    const door = this.door();
    this.fire.place(this.cx, door.y + door.height - 6 * this.scale, door.width * 0.9, door.height * 0.95 * heat, 0);
    this.fire.update(dt, time);

    for (const p of this.potatoes) {
      if (p.away >= 0) {
        p.away += dt;
        if (p.away >= RESPAWN_SECONDS) Object.assign(p, freshPotato(p.slot));
        continue;
      }
      if (p.flip >= 0) {
        p.flip += dt;
        if (p.flip >= FLIP_SECONDS) p.flip = -1;
        continue;
      }
      p.down = Math.min(BURNT + 0.2, p.down + ROAST_RATE * heat * dt);
    }

    // Smoke from the chimney; steam from potatoes that are done; smoke from burnt ones.
    const chimney = this.chimneyTop();
    this.smokeDebt += (2 + 4 * this.boost) * this.ignition * dt;
    while (this.smokeDebt >= 1) {
      this.smokeDebt -= 1;
      this.puff(chimney.x, chimney.y, false);
    }
    this.steamDebt += 3 * dt;
    while (this.steamDebt >= 1) {
      this.steamDebt -= 1;
      for (const p of this.potatoes) {
        if (p.away >= 0 || p.flip >= 0) continue;
        if (this.isBurnt(p) || this.isDone(p)) this.puff(this.potatoX(p), this.drum().top - 12 * this.scale, !this.isBurnt(p));
      }
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const f = this.puffs[i];
      f.age += dt;
      if (f.age >= f.life) {
        this.puffs[i] = this.puffs[this.puffs.length - 1];
        this.puffs.pop();
        continue;
      }
      f.vx += (noise1(f.y * 0.01 + i) - 0.5) * 40 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }

    for (const flake of this.flakes) {
      flake.y += flake.speed * dt;
      flake.x += Math.sin(time * 0.8 + flake.seed) * 12 * dt;
      if (flake.y > this.height + 4) {
        flake.y = -4;
        flake.x = Math.random() * this.width;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const s = this.scale;
    const drum = this.drum();
    const door = this.door();
    const light = this.ignition * (0.85 + 0.15 * noise1(this.time * 6)) * (1 + 0.4 * this.boost);

    this.backdrop.draw(ctx);
    // Firelight from the door spilling over the snow.
    glow(ctx, this.cx, door.y + door.height / 2, 420 * s, [255, 130, 60], 0.16 * light);
    ctx.save();
    ctx.translate(this.cx, this.ground() + 14 * s);
    ctx.scale(1, 0.25);
    glow(ctx, 0, 0, 280 * s, [255, 150, 80], 0.35 * light);
    ctx.restore();

    this.drawChimney(ctx, light);
    this.drawPuffs(ctx, false);
    this.drawDrum(ctx, drum, door, light);
    for (const p of this.potatoes) this.drawPotato(ctx, p, drum.top - 6 * s, light);
    this.drawSign(ctx, drum, light);
    this.drawPuffs(ctx, true);
    this.drawSnow(ctx, drum);
    fadeToPage(ctx, this.width, this.height);
  }

  // ---- potatoes ----

  private handle(p: Potato) {
    if (this.isDone(p) || this.isBurnt(p)) {
      // Taken off the grill (or thrown away).
      for (let i = 0; i < 5; i++) this.puff(this.potatoX(p), this.drum().top - 16 * this.scale, !this.isBurnt(p));
      p.away = 0;
      return;
    }
    p.flip = 0;
    [p.up, p.down] = [p.down, p.up];
  }

  private isDone(p: Potato) {
    return p.up >= DONE && p.down >= DONE && !this.isBurnt(p);
  }

  private isBurnt(p: Potato) {
    return p.up >= BURNT || p.down >= BURNT;
  }

  private potatoAt(x: number, y: number) {
    const s = this.scale;
    const top = this.drum().top - 6 * s;
    return this.potatoes.find(
      (p) => p.away < 0 && Math.abs(x - this.potatoX(p)) < 28 * s && Math.abs(y - top) < 22 * s,
    );
  }

  private potatoX(p: Potato) {
    return this.cx + p.slot * this.drum().width;
  }

  private puff(x: number, y: number, steam: boolean) {
    if (this.puffs.length >= MAX_PUFFS) return;
    const s = this.scale;
    this.puffs.push({
      x: x + rand(-4, 4) * s,
      y,
      vx: rand(-10, 10) * s,
      vy: -rand(25, 50) * s * (steam ? 1.3 : 1),
      age: 0,
      life: steam ? rand(0.8, 1.4) : rand(1.8, 2.8),
      size: (steam ? rand(5, 9) : rand(9, 15)) * s,
      steam,
    });
  }

  // ---- layout ----

  private ground() {
    return this.height - 52 * this.scale;
  }

  private drum() {
    const s = this.scale;
    const width = Math.min(190 * s, this.width * 0.42);
    const height = 200 * s;
    const bottom = this.ground() + 18 * s;
    return { x: this.cx - width / 2, width, top: bottom - height, bottom, height, rim: width * 0.13 };
  }

  private door() {
    const drum = this.drum();
    const s = this.scale;
    const width = drum.width * 0.46;
    const height = 58 * s;
    return { x: this.cx - width / 2, y: drum.bottom - height - 34 * s, width, height };
  }

  private chimneyTop() {
    const drum = this.drum();
    const s = this.scale;
    return { x: drum.x + drum.width * 0.8, y: drum.top - 56 * s };
  }

  // ---- drawing ----

  /** The street, painted once: night sky, apartment blocks, low houses with snowy roofs, a lamp. */
  private paintStreet(ctx: CanvasRenderingContext2D) {
    const { width, height } = this;
    const s = this.scale;
    const rand = seeded(42);
    const ground = this.ground();

    const sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, '#0a1029');
    sky.addColorStop(0.6, '#152049');
    sky.addColorStop(1, '#25305e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // Far apartment blocks with a scatter of lit windows.
    const farBase = ground - 70 * s;
    for (let x = -10; x < width; ) {
      const w = (60 + rand() * 70) * s;
      const h = (140 + rand() * 120) * s;
      ctx.fillStyle = '#161d45';
      ctx.fillRect(x, farBase - h, w - 6 * s, h + 80 * s);
      const cols = Math.floor((w - 16 * s) / (11 * s));
      const rows = Math.floor((h - 16 * s) / (14 * s));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rand() > 0.1) continue;
          ctx.fillStyle = rand() < 0.75 ? 'rgba(255, 200, 120, 0.55)' : 'rgba(170, 200, 255, 0.4)';
          ctx.fillRect(x + 8 * s + c * 11 * s, farBase - h + 10 * s + r * 14 * s, 5 * s, 6 * s);
        }
      }
      x += w;
    }

    // Low houses nearer, with snow on the roofs and a warm window here and there.
    const houseBase = ground + 4 * s;
    for (let x = -20; x < width; ) {
      const w = (90 + rand() * 80) * s;
      const h = (60 + rand() * 40) * s;
      const roof = (22 + rand() * 14) * s;
      const wall = new Path2D();
      wall.rect(x + 6 * s, houseBase - h, w - 12 * s, h);
      ctx.fillStyle = '#121838';
      ctx.fill(wall);
      const roofPath = new Path2D();
      roofPath.moveTo(x, houseBase - h);
      roofPath.lineTo(x + w * 0.5, houseBase - h - roof);
      roofPath.lineTo(x + w, houseBase - h);
      roofPath.closePath();
      ctx.fillStyle = '#0f1430';
      ctx.fill(roofPath);
      // Snow cap.
      ctx.fillStyle = '#aab5d6';
      ctx.beginPath();
      ctx.moveTo(x - 2 * s, houseBase - h + 1 * s);
      ctx.lineTo(x + w * 0.5, houseBase - h - roof - 3 * s);
      ctx.lineTo(x + w + 2 * s, houseBase - h + 1 * s);
      ctx.lineTo(x + w * 0.5 + 6 * s, houseBase - h - roof + 5 * s);
      ctx.closePath();
      ctx.fill();
      if (rand() < 0.6) {
        const wx = x + w * (0.25 + rand() * 0.4);
        ctx.fillStyle = '#f2b866';
        ctx.fillRect(wx, houseBase - h * 0.7, 14 * s, 12 * s);
        ctx.fillStyle = '#121838';
        ctx.fillRect(wx + 6 * s, houseBase - h * 0.7, 2 * s, 12 * s);
      }
      x += w;
    }

    // Street lamp on the right with its cone of light.
    const lx = width - Math.max(50 * s, width * 0.12);
    const lampY = ground - 210 * s;
    const cone = ctx.createLinearGradient(0, lampY, 0, ground);
    cone.addColorStop(0, 'rgba(255, 225, 170, 0.16)');
    cone.addColorStop(1, 'rgba(255, 225, 170, 0.02)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(lx - 22 * s, lampY + 8 * s);
    ctx.lineTo(lx + 2 * s, lampY + 8 * s);
    ctx.lineTo(lx + 60 * s, ground + 10 * s);
    ctx.lineTo(lx - 110 * s, ground + 10 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0d1126';
    ctx.fillRect(lx - 3 * s, lampY, 6 * s, ground - lampY + 10 * s);
    ctx.fillRect(lx - 26 * s, lampY - 4 * s, 26 * s, 5 * s);
    ctx.fillStyle = '#ffe6b0';
    ctx.beginPath();
    ctx.ellipse(lx - 22 * s, lampY + 5 * s, 9 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Snowy ground, catching the lamp.
    const snow = new Path2D();
    snow.moveTo(0, height);
    for (let x = 0; x <= width + 8; x += 8) snow.lineTo(x, ground + Math.sin(x * 0.01) * 3 + Math.sin(x * 0.031 + 1) * 2);
    snow.lineTo(width, height);
    snow.closePath();
    ctx.fillStyle = '#7b87b0';
    ctx.fill(snow);
    ctx.fillStyle = '#a5b0d2';
    ctx.fillRect(0, ground - 2 * s, width, 4 * s);
    ctx.save();
    ctx.translate(lx - 25 * s, ground + 12 * s);
    ctx.scale(1, 0.22);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, 110 * s);
    pool.addColorStop(0, 'rgba(255, 236, 200, 0.22)');
    pool.addColorStop(1, 'rgba(255, 236, 200, 0)');
    ctx.fillStyle = pool;
    ctx.fillRect(-110 * s, -110 * s, 220 * s, 220 * s);
    ctx.restore();
  }

  private drawChimney(ctx: CanvasRenderingContext2D, light: number) {
    const drum = this.drum();
    const s = this.scale;
    const top = this.chimneyTop();
    const w = 15 * s;
    const pipe = new Path2D();
    pipe.rect(top.x - w / 2, top.y, w, drum.top - top.y + 6 * s);
    shade(ctx, pipe, { base: '#2c303a', shadow: '#1a1d24', light: blend('#465063', '#d98a5a', light * 0.3) }, { x: 1, y: 0 }, 3 * s, 4 * s);
    const cap = new Path2D();
    cap.roundRect(top.x - w / 2 - 4 * s, top.y - 5 * s, w + 8 * s, 6 * s, 1.5 * s);
    shade(ctx, cap, { base: '#363b47', shadow: '#1f222a', light: '#5d6779' }, { x: 1, y: -1 }, 2 * s);
  }

  private drawDrum(
    ctx: CanvasRenderingContext2D,
    drum: ReturnType<SweetPotatoDrum['drum']>,
    door: ReturnType<SweetPotatoDrum['door']>,
    light: number,
  ) {
    const s = this.scale;
    const { x, width, top, bottom, rim } = drum;
    const warm = clamp(light, 0, 1.2);

    // Body: a cylinder, cool moonlight on the right edge, shadow wrapping round the left.
    const body = new Path2D();
    body.moveTo(x, top);
    body.lineTo(x, bottom);
    body.ellipse(this.cx, bottom, width / 2, rim, 0, Math.PI, 0, true);
    body.lineTo(x + width, top);
    body.closePath();
    shade(ctx, body, { base: '#3a3f4b', shadow: '#22252d', light: '#5a6478' }, { x: 1, y: 0 }, width * 0.1, width * 0.28);

    ctx.save();
    ctx.clip(body);
    // Rust running down from the rim and the hoops.
    ctx.fillStyle = 'rgba(120, 60, 32, 0.45)';
    for (let i = 0; i < 7; i++) {
      const rx = x + width * (0.08 + 0.84 * noise1(i * 3.7));
      const ry = top + (bottom - top) * [0, 0.28, 0.7][i % 3] + 2 * s;
      const w = (3 + 5 * noise1(i * 2.3)) * s;
      const h = (16 + 40 * noise1(i * 1.9)) * s;
      ctx.beginPath();
      ctx.moveTo(rx - w, ry);
      ctx.quadraticCurveTo(rx - w * 0.8, ry + h * 0.7, rx, ry + h);
      ctx.quadraticCurveTo(rx + w * 0.8, ry + h * 0.7, rx + w, ry);
      ctx.closePath();
      ctx.fill();
    }
    // Rolling hoops, curving with the drum.
    for (const k of [0.28, 0.7]) {
      const hy = top + (bottom - top) * k;
      ctx.strokeStyle = '#1c1f26';
      ctx.lineWidth = 5 * s;
      ctx.beginPath();
      ctx.ellipse(this.cx, hy + 2 * s, width / 2, rim, 0, 0, Math.PI);
      ctx.stroke();
      ctx.strokeStyle = '#5b6375';
      ctx.lineWidth = 2.5 * s;
      ctx.beginPath();
      ctx.ellipse(this.cx, hy, width / 2, rim, 0, 0, Math.PI);
      ctx.stroke();
    }
    // Firelight from the door warming the lower front.
    glow(ctx, this.cx, door.y + door.height * 0.7, width * 0.6, [255, 120, 50], 0.35 * warm);
    ctx.restore();

    // Fire door.
    const frame = new Path2D();
    frame.roundRect(door.x - 5 * s, door.y - 5 * s, door.width + 10 * s, door.height + 10 * s, 6 * s);
    ctx.fillStyle = '#2a2d36';
    ctx.fill(frame);
    const opening = new Path2D();
    opening.roundRect(door.x, door.y, door.width, door.height, 4 * s);
    ctx.fillStyle = '#1b0b07';
    ctx.fill(opening);
    ctx.save();
    ctx.clip(opening);
    glow(ctx, this.cx, door.y + door.height, door.width * 0.8, [255, 110, 40], 0.6 * warm);
    this.fire.draw(ctx);
    ctx.restore();
    ctx.strokeStyle = blend('#4a4f5c', '#ffae6a', warm * 0.8);
    ctx.lineWidth = 2 * s;
    ctx.stroke(opening);

    // Open top, glowing from the fire below, with a grill across it.
    ctx.fillStyle = '#2f343f';
    ctx.beginPath();
    ctx.ellipse(this.cx, top, width / 2 + 3 * s, rim + 3 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = blend('#2a120b', '#9a3a16', warm * 0.8);
    ctx.beginPath();
    ctx.ellipse(this.cx, top, width / 2 - 3 * s, rim - 2 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(this.cx, top, width / 2 - 3 * s, rim - 2 * s, 0, 0, Math.PI * 2);
    ctx.clip();
    glow(ctx, this.cx, top, width * 0.45, [255, 140, 60], 0.5 * warm);
    ctx.strokeStyle = '#5a5f6b';
    ctx.lineWidth = 1.5 * s;
    for (let gx = x + 10 * s; gx < x + width; gx += 12 * s) {
      ctx.beginPath();
      ctx.moveTo(gx, top - rim);
      ctx.lineTo(gx - 6 * s, top + rim);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPotato(ctx: CanvasRenderingContext2D, p: Potato, y: number, light: number) {
    if (p.away >= 0) return;
    const s = this.scale;
    const x = this.potatoX(p);
    // A flip squashes it flat at the midpoint and lifts it off the grill.
    const t = p.flip >= 0 ? p.flip / FLIP_SECONDS : 0;
    const turn = p.flip >= 0 ? Math.abs(Math.cos(t * Math.PI)) : 1;
    const hop = p.flip >= 0 ? Math.sin(t * Math.PI) * 22 * s : 0;
    const rx = 24 * s * (0.92 + 0.16 * noise1(p.seed));
    const ry = 11 * s * Math.max(0.15, turn);
    const tilt = (noise1(p.seed + 3) - 0.5) * 0.3;
    // Before the flip midpoint we still see the old top side.
    const roast = p.flip >= 0 && t < 0.5 ? p.down : p.up;
    const color = skin(roast);

    // Tapered at both ends like a sweet potato, not an egg.
    const body = new Path2D();
    body.moveTo(-rx, 0);
    body.bezierCurveTo(-rx * 0.6, -ry * 1.25, rx * 0.6, -ry * 1.25, rx, 0);
    body.bezierCurveTo(rx * 0.6, ry * 1.1, -rx * 0.6, ry * 1.1, -rx, 0);

    ctx.save();
    ctx.translate(x, y - ry * 0.5 - hop);
    ctx.rotate(tilt);
    shade(
      ctx,
      body,
      {
        base: css(color),
        shadow: css(mix(color, [20, 8, 10], 0.45)),
        light: css(mix(mix(color, [255, 230, 220], 0.28), [255, 160, 90], clamp(light, 0, 1) * 0.3)),
      },
      { x: -0.4, y: -1 },
      3 * s,
      4 * s,
    );
    if (roast > 0.85) {
      ctx.fillStyle = 'rgba(15, 10, 10, 0.5)';
      for (let i = 0; i < 4; i++) {
        const sx = (noise2(p.seed, i) - 0.5) * rx * 1.2;
        ctx.beginPath();
        ctx.ellipse(sx, (noise2(i, p.seed) - 0.6) * ry, 4 * s, 2.5 * s * turn, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (p.flip < 0 && this.isDone(p)) {
      // Split open along the top, showing the golden inside.
      const split = new Path2D();
      split.ellipse(0, -ry * 0.4, rx * 0.55, ry * 0.32, 0, 0, Math.PI * 2);
      shade(ctx, split, { base: '#ffc443', shadow: '#e09a2a', light: '#ffe9a6' }, { x: -0.3, y: -1 }, 2 * s, 2 * s);
    }
    ctx.restore();
  }

  /** A hand-lettered cardboard sign leaning on the drum. */
  private drawSign(ctx: CanvasRenderingContext2D, drum: ReturnType<SweetPotatoDrum['drum']>, light: number) {
    const s = this.scale;
    const w = 92 * s;
    const h = 58 * s;
    const x = drum.x - w * 0.62;
    if (x - w / 2 < 4) return;
    const y = this.ground() + 10 * s;
    const card = new Path2D();
    card.roundRect(-w / 2, -h, w, h, 3 * s);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.09);
    shade(
      ctx,
      card,
      { base: '#b8895a', shadow: '#8a6540', light: blend('#cfa274', '#ffc08a', clamp(light, 0, 1) * 0.5) },
      { x: 1, y: -0.3 },
      3 * s,
      5 * s,
    );
    ctx.fillStyle = '#2b1a10';
    ctx.font = `800 ${Math.round(17 * s)}px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('군고구마', 0, -h * 0.58);
    ctx.font = `600 ${Math.round(10 * s)}px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
    ctx.fillStyle = '#5a3a22';
    ctx.fillText('3개 / 5,000원', 0, -h * 0.24);
    ctx.restore();
  }

  private drawPuffs(ctx: CanvasRenderingContext2D, steam: boolean) {
    for (const f of this.puffs) {
      if (f.steam !== steam) continue;
      const t = f.age / f.life;
      const r = f.size * (1 + t * 1.8);
      const soft = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      soft.addColorStop(0, steam ? 'rgba(238,241,248,1)' : 'rgba(89,96,122,1)');
      soft.addColorStop(1, steam ? 'rgba(238,241,248,0)' : 'rgba(89,96,122,0)');
      // Smoke thins out quickly so it never clouds the title above.
      ctx.globalAlpha = (steam ? 0.5 : 0.35) * (1 - t) ** (steam ? 1 : 2) * Math.min(1, t * 6);
      ctx.fillStyle = soft;
      ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawSnow(ctx: CanvasRenderingContext2D, drum: ReturnType<SweetPotatoDrum['drum']>) {
    ctx.fillStyle = '#eef2fb';
    for (const f of this.flakes) {
      // Flakes thin out and vanish as they drift over the hot drum.
      const d = Math.hypot(f.x - this.cx, (f.y - drum.top) * 1.4);
      const melt = clamp((d - drum.width * 0.5) / (drum.width * 0.6), 0, 1);
      if (melt <= 0) continue;
      ctx.globalAlpha = 0.8 * melt;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

export const sweetPotatoTheme: FireTheme = {
  id: 'sweet-potato',
  label: '군고구마',
  palette: {
    titleFrom: '#ffe6c2',
    titleTo: '#e0864a',
    titleGlow: 'rgba(255, 140, 60, 0.35)',
    ambient: '#141a38',
  },
  letters: { knock: 'touch', draggable: true, item: false },
  createRenderer: () => new SweetPotatoDrum(),
};
