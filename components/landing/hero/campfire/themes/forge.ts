import { noise1, noise2 } from '../noise';
import { Backdrop, TongueFire, blend, glow, seeded, shade } from '../illustration';
import type { FireFrame, FireHost, FireRenderer, FireTap, FireTheme, HotZone } from '../types';
import { fadeToPage } from './classic';

/** Air the fire settles back to without the bellows. */
const IDLE_AIR = 0.35;
const MAX_AIR = 1.4;
const MAX_SPARKS = 220;

interface Coal {
  x: number;
  y: number;
  r: number;
  seed: number;
  shape: Path2D;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** Hammer sparks fall; forge sparks float up on the draft. */
  heavy: boolean;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** A rough, chunky lump around the origin. */
function lump(r: number, seed: number) {
  const path = new Path2D();
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const k = 0.75 + 0.45 * noise2(seed, i);
    const x = Math.cos(a) * r * k;
    const y = Math.sin(a) * r * k * 0.75;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  return path;
}

/**
 * A blacksmith's forge at night: a brick hearth of coals under a hood, bellows that blow the fire
 * up, and an anvil. Letters glow as they heat in the coals and can be hammered flat while hot
 * (`LetterBehavior.hammer`).
 */
class Forge implements FireRenderer {
  private readonly fire = new TongueFire(13, undefined, 4);
  private readonly backdrop = new Backdrop();
  private coals: Coal[] = [];
  private sparks: Spark[] = [];
  private audio: AudioContext | null = null;

  private width = 0;
  private height = 0;
  private scale = 1;
  private cx = 0;
  /** Top of the hearth, where the coals sit. */
  private bed = 0;
  private time = 0;
  private ignition = 0;
  private air = IDLE_AIR;
  /** 1 right after a squeeze of the bellows, easing back to 0 as they refill. */
  private squeeze = 0;
  private wind = 0;
  private sparkDebt = 0;

  constructor(private readonly host: FireHost) {}

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    const s = this.scale;
    this.cx = width / 2;
    this.bed = height - 110 * s;

    const half = this.hearthHalf();
    const count = Math.round((half * 2) / (15 * s));
    this.coals = Array.from({ length: count }, (_, i) => {
      const r = rand(9, 13) * s;
      const seed = Math.random() * 100;
      return {
        x: this.cx - half + 16 * s + (i / (count - 1)) * (half * 2 - 32 * s) + rand(-4, 4) * s,
        y: this.bed + rand(-5, 2) * s,
        r,
        seed,
        shape: lump(r, seed),
      };
    });
    this.backdrop.paint(width, height, (ctx) => this.paintRoom(ctx));
  }

  hotZone(): HotZone {
    const half = this.hearthHalf() - 18 * this.scale;
    const top = this.bed - this.flameHeight() * 0.55;
    return { x: this.cx - half, y: top, width: half * 2, height: this.height - top };
  }

  /** Letters land on the coals inside the hearth, on the floor elsewhere. */
  groundY(x: number) {
    const half = this.hearthHalf();
    return Math.abs(x - this.cx) < half ? this.bed + 4 * this.scale : this.floor();
  }

  tap({ x, y, onFire, onLetter }: FireTap) {
    if (onLetter) {
      this.hammer(x, y);
    } else if (this.overBellows(x, y)) {
      this.pump(0.35);
    } else if (onFire) {
      this.air = Math.min(this.air + 0.1, MAX_AIR);
      for (let i = 0; i < 12; i++) this.spark(x, this.bed, false);
      this.fire.burst(x, this.bed - 20 * this.scale, 2);
    }
  }

  feed(x: number, y: number, fuel: number) {
    this.air = Math.min(this.air + 0.3 * fuel, MAX_AIR);
    for (let i = 0; i < 30 * fuel; i++) this.spark(x + rand(-10, 10), Math.min(y, this.bed), false);
    this.fire.burst(x, this.bed - 20 * this.scale, 4);
  }

  update({ time, dt, pointer }: FireFrame) {
    this.time = time;
    this.ignition = Math.min(1, this.ignition + dt / 1.5);
    this.squeeze *= Math.exp(-3.5 * dt);
    this.air += (IDLE_AIR - this.air) * (1 - Math.exp(-0.35 * dt));

    // Working the bellows: pumping the pointer up and down over them.
    if (pointer && this.overBellows(pointer.x, pointer.y)) {
      const stroke = Math.abs(pointer.vy);
      if (stroke > 120) this.pump(Math.min(stroke / 3000, 0.6) * dt * 4);
    }

    const ambient = (noise1(time * 0.25 + 11) - 0.5) * 0.25;
    if (pointer) this.wind += clamp(pointer.vx / 2000, -1, 1) * dt * 4;
    this.wind += (ambient - this.wind) * Math.min(1, dt * 1.5);
    this.wind = clamp(this.wind, -0.7, 0.7);

    const s = this.scale;
    this.fire.place(this.cx, this.bed - 2 * s, (this.hearthHalf() * 2 - 40 * s) * 0.92, this.flameHeight(), this.wind);
    this.fire.update(dt, time);

    this.sparkDebt += 10 * Math.max(0, this.air - 0.15) * this.ignition * dt;
    while (this.sparkDebt >= 1) {
      this.sparkDebt -= 1;
      this.spark(this.cx + rand(-1, 1) * this.hearthHalf() * 0.7, this.bed - rand(0, 20) * s, false);
    }

    const gravity = 1300 * s;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.sparks[i] = this.sparks[this.sparks.length - 1];
        this.sparks.pop();
        continue;
      }
      if (p.heavy) p.vy += gravity * dt;
      else p.vx += this.wind * 160 * dt;
      p.vx *= 1 - 1.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { cx, bed } = this;
    const s = this.scale;
    const light = this.ignition * (0.55 + 0.45 * Math.min(this.air, 1.2)) * (0.92 + 0.08 * noise1(this.time * 7));

    this.backdrop.draw(ctx);
    glow(ctx, cx, bed - 40 * s, 560 * s, [255, 110, 40], 0.24 * light);
    this.drawFireback(ctx, light);
    this.drawAnvil(ctx, light);
    this.drawBellows(ctx, light);
    this.drawHearth(ctx, light);
    this.fire.draw(ctx);
    this.drawCoals(ctx, light);

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of this.sparks) {
      const t = p.age / p.life;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = t < 0.4 ? '#fff1c4' : '#ffa23a';
      ctx.lineWidth = (p.heavy ? 1.8 : 1.4) * s;
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';
    fadeToPage(ctx, this.width, this.height);
  }

  dispose() {
    void this.audio?.close();
    this.audio = null;
  }

  // ---- mechanics ----

  private pump(amount: number) {
    this.air = Math.min(this.air + amount, MAX_AIR);
    this.squeeze = Math.min(1, this.squeeze + amount * 3);
    const hx = this.cx + this.hearthHalf();
    for (let i = 0; i < amount * 30; i++) this.spark(hx - rand(10, 60) * this.scale, this.bed, false);
  }

  private hammer(x: number, y: number) {
    for (let i = 0; i < 18; i++) this.spark(x, y, true);
    this.host.shake(3);
    this.clang();
  }

  private spark(x: number, y: number, heavy: boolean) {
    if (this.sparks.length >= MAX_SPARKS) return;
    const s = this.scale;
    const angle = heavy ? rand(-Math.PI, 0) : rand(-Math.PI * 0.65, -Math.PI * 0.35);
    const speed = heavy ? rand(200, 600) * s : rand(60, 220) * s;
    this.sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: heavy ? rand(0.25, 0.6) : rand(0.6, 1.5),
      heavy,
    });
  }

  // ---- layout ----

  private hearthHalf() {
    return Math.min(140 * this.scale, this.width * 0.2);
  }

  private floor() {
    return this.height - 26 * this.scale;
  }

  private flameHeight() {
    return (50 + 150 * Math.min(this.air, 1.2)) * this.scale * this.ignition;
  }

  private bellowsBox() {
    const s = this.scale;
    const x = this.cx + this.hearthHalf() + 6 * s;
    // Shortened on narrow screens so the handle stays on screen.
    const length = Math.max(40 * s, Math.min(150 * s, this.width - x - 60 * s));
    return { x, y: this.bed - 70 * s, width: length + 56 * s, height: 120 * s, length };
  }

  private overBellows(x: number, y: number) {
    const b = this.bellowsBox();
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
  }

  // ---- drawing ----

  /** The room, painted once: stone wall, a moonlit window, tools on the wall, the floor. */
  private paintRoom(ctx: CanvasRenderingContext2D) {
    const { width, height } = this;
    const s = this.scale;
    const rand = seeded(13);
    const floor = this.floor();

    ctx.fillStyle = '#121017';
    ctx.fillRect(0, 0, width, height);
    // Rough stone blocks, staggered, in close cool tones.
    const rowH = 34 * s;
    for (let row = 0, y = 0; y < floor; row++, y += rowH) {
      let x = row % 2 ? -26 * s : -4 * s;
      while (x < width) {
        const w = (46 + rand() * 40) * s;
        const tone = rand();
        ctx.fillStyle = tone < 0.33 ? '#18161e' : tone < 0.66 ? '#16141c' : '#1a1720';
        ctx.beginPath();
        ctx.roundRect(x + 2 * s, y + 2 * s, w - 4 * s, rowH - 4 * s, 5 * s);
        ctx.fill();
        x += w;
      }
    }

    // Window, high on the right, with moonlight slanting in.
    const ww = Math.min(110 * s, width * 0.14);
    const wh = ww * 1.3;
    const wx = width - ww - Math.max(40 * s, width * 0.08);
    const wy = height * 0.1;
    const shaft = new Path2D();
    shaft.moveTo(wx, wy);
    shaft.lineTo(wx + ww, wy);
    shaft.lineTo(wx + ww - width * 0.18, floor);
    shaft.lineTo(wx - width * 0.32, floor);
    shaft.closePath();
    ctx.fillStyle = 'rgba(130, 160, 230, 0.035)';
    ctx.fill(shaft);
    ctx.fillStyle = '#231a14';
    ctx.fillRect(wx - 8 * s, wy - 8 * s, ww + 16 * s, wh + 16 * s);
    ctx.fillStyle = '#141c36';
    ctx.fillRect(wx, wy, ww, wh);
    ctx.fillStyle = '#1a2547';
    ctx.fillRect(wx, wy + wh * 0.6, ww, wh * 0.4);
    ctx.fillStyle = '#e9e1c8';
    ctx.beginPath();
    ctx.arc(wx + ww * 0.68, wy + wh * 0.3, ww * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#231a14';
    ctx.fillRect(wx + ww / 2 - 3 * s, wy, 6 * s, wh);
    ctx.fillRect(wx, wy + wh / 2 - 3 * s, ww, 6 * s);

    // Tools hanging on a rail to the left.
    const railX = Math.max(30 * s, width * 0.07);
    const railW = Math.min(220 * s, this.cx - this.hearthHalf() - railX - 30 * s);
    const railY = height * 0.3;
    if (railW > 60 * s) {
      ctx.fillStyle = '#2d2219';
      ctx.fillRect(railX, railY, railW, 8 * s);
      ctx.fillStyle = '#121016';
      const tools = Math.floor(railW / (34 * s));
      for (let i = 0; i < tools; i++) {
        const x = railX + (i + 0.5) * (railW / tools);
        const kind = i % 3;
        if (kind === 0) {
          // Tongs.
          ctx.fillRect(x - 3 * s, railY + 8 * s, 2.5 * s, 90 * s);
          ctx.fillRect(x + 1 * s, railY + 8 * s, 2.5 * s, 90 * s);
          ctx.fillRect(x - 5 * s, railY + 96 * s, 10 * s, 10 * s);
        } else if (kind === 1) {
          // Hammer, hanging head down.
          ctx.fillRect(x - 2 * s, railY + 8 * s, 4 * s, 60 * s);
          ctx.beginPath();
          ctx.roundRect(x - 12 * s, railY + 64 * s, 24 * s, 14 * s, 3 * s);
          ctx.fill();
        } else {
          // Poker.
          ctx.fillRect(x - 1.5 * s, railY + 8 * s, 3 * s, 110 * s);
          ctx.beginPath();
          ctx.arc(x, railY + 12 * s, 6 * s, 0, Math.PI * 2);
          ctx.lineWidth = 2.5 * s;
          ctx.strokeStyle = '#121016';
          ctx.stroke();
        }
      }
    }

    // Floorboards.
    ctx.fillStyle = '#120f14';
    ctx.fillRect(0, floor, width, height - floor);
    ctx.fillStyle = '#1a151a';
    ctx.fillRect(0, floor, width, 3 * s);
  }

  /** Brick fireback behind the coals, taking the full glow of the fire. */
  private drawFireback(ctx: CanvasRenderingContext2D, light: number) {
    const s = this.scale;
    const half = this.hearthHalf() - 6 * s;
    const top = this.bed - 150 * s;
    const brickH = 16 * s;
    const brickW = 38 * s;
    ctx.save();
    const wall = new Path2D();
    wall.roundRect(this.cx - half, top, half * 2, this.bed - top + 4 * s, [10 * s, 10 * s, 0, 0]);
    ctx.fillStyle = '#1a0f10';
    ctx.fill(wall);
    ctx.clip(wall);
    for (let row = 0; top + row * brickH < this.bed; row++) {
      // Hottest just above the coals.
      const warm = clamp(light * (0.25 + 0.75 * ((row * brickH) / (this.bed - top))), 0, 1);
      const offset = row % 2 ? brickW / 2 : 0;
      for (let bx = this.cx - half - offset; bx < this.cx + half; bx += brickW) {
        ctx.fillStyle = blend('#3a1d1a', '#b8532e', warm * 0.75);
        ctx.beginPath();
        ctx.roundRect(bx + 1.5 * s, top + row * brickH + 1.5 * s, brickW - 3 * s, brickH - 3 * s, 2.5 * s);
        ctx.fill();
      }
    }
    // Soot darkening towards the top.
    const soot = ctx.createLinearGradient(0, top, 0, this.bed);
    soot.addColorStop(0, 'rgba(12, 8, 10, 0.75)');
    soot.addColorStop(1, 'rgba(12, 8, 10, 0)');
    ctx.fillStyle = soot;
    ctx.fill(wall);
    ctx.restore();
  }

  private drawHearth(ctx: CanvasRenderingContext2D, light: number) {
    const s = this.scale;
    const half = this.hearthHalf();
    const x0 = this.cx - half;
    const top = this.bed;
    const bottom = this.floor();
    const brickH = 16 * s;
    const brickW = 38 * s;

    ctx.fillStyle = '#1c1013';
    ctx.fillRect(x0, top, half * 2, bottom - top);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, top, half * 2, bottom - top);
    ctx.clip();
    for (let row = 0; top + row * brickH < bottom; row++) {
      // The top rows take on the glow of the coals.
      const warm = clamp(light * (1 - row / 4), 0, 1);
      const offset = row % 2 ? brickW / 2 : 0;
      for (let bx = x0 - offset; bx < x0 + half * 2; bx += brickW) {
        const brick = new Path2D();
        brick.roundRect(bx + 1.5 * s, top + row * brickH + 1.5 * s, brickW - 3 * s, brickH - 3 * s, 2.5 * s);
        const tone = noise2(bx * 0.05, row * 3.1);
        shade(
          ctx,
          brick,
          {
            base: blend(tone > 0.5 ? '#6a2f26' : '#5c2a23', '#a4472c', warm * 0.6),
            shadow: '#3a1b18',
            light: blend('#7d3a2d', '#ff9a5a', warm),
          },
          { x: 0, y: -1 },
          2.5 * s,
          3 * s,
        );
      }
    }
    ctx.restore();

    // Stone lip around the fire pit.
    const lip = new Path2D();
    lip.roundRect(x0 - 10 * s, top - 6 * s, half * 2 + 20 * s, 12 * s, 3 * s);
    shade(
      ctx,
      lip,
      { base: '#3d3840', shadow: '#26222a', light: blend('#55505a', '#ffb07a', clamp(light, 0, 1)) },
      { x: 0, y: -1 },
      3 * s,
      4 * s,
    );
  }

  private drawCoals(ctx: CanvasRenderingContext2D, light: number) {
    const s = this.scale;
    for (const coal of this.coals) {
      const flicker = noise2(coal.seed, this.time * 1.6);
      const heat = clamp(light * (0.5 + 0.7 * flicker), 0, 1.2);
      ctx.save();
      ctx.translate(coal.x, coal.y);
      shade(
        ctx,
        coal.shape,
        {
          base: blend('#3a1810', '#c8461a', heat * 0.7),
          shadow: '#1f0d09',
          light: blend('#a8401a', '#ffe08a', heat * 0.85),
        },
        { x: 0, y: -1 },
        3.5 * s,
        3 * s,
      );
      ctx.restore();
    }
    glow(ctx, this.cx, this.bed, this.hearthHalf() * 1.2, [255, 120, 40], 0.3 * light);
  }

  private drawBellows(ctx: CanvasRenderingContext2D, light: number) {
    const s = this.scale;
    const b = this.bellowsBox();
    const hingeX = b.x + 26 * s;
    const hingeY = this.bed - 6 * s;
    const { length } = b;
    const warm = clamp(light, 0, 1);
    // Wide open at rest, nearly shut right after a squeeze.
    const open = 0.3 - 0.2 * this.squeeze + 0.02 * Math.sin(this.time * 1.3);
    const tipTop = { x: hingeX + Math.cos(-open) * length, y: hingeY + Math.sin(-open) * length };
    const tipBottom = { x: hingeX + length, y: hingeY + 10 * s };

    // Nozzle into the hearth.
    const nozzle = new Path2D();
    nozzle.moveTo(b.x - 10 * s, hingeY - 3 * s);
    nozzle.lineTo(hingeX, hingeY - 8 * s);
    nozzle.lineTo(hingeX, hingeY + 10 * s);
    nozzle.lineTo(b.x - 10 * s, hingeY + 4 * s);
    nozzle.closePath();
    shade(ctx, nozzle, { base: '#4a4650', shadow: '#2b2830', light: blend('#5f5a66', '#ffb27a', warm) }, { x: -1, y: -1 }, 2.5 * s);

    // Leather, pleated.
    const leather = new Path2D();
    leather.moveTo(hingeX, hingeY);
    leather.lineTo(tipTop.x, tipTop.y);
    leather.lineTo(tipBottom.x, tipBottom.y);
    leather.closePath();
    shade(ctx, leather, { base: '#5a3322', shadow: '#3a2015', light: blend('#6d4029', '#e48a52', warm * 0.8) }, { x: -1, y: 0 }, 4 * s, 6 * s);
    ctx.strokeStyle = 'rgba(25, 12, 6, 0.55)';
    ctx.lineWidth = 1.5 * s;
    for (let i = 1; i <= 3; i++) {
      const k = i / 4;
      ctx.beginPath();
      ctx.moveTo(hingeX + (tipTop.x - hingeX) * k, hingeY + (tipTop.y - hingeY) * k);
      ctx.lineTo(hingeX + (tipBottom.x - hingeX) * k, hingeY + (tipBottom.y - hingeY) * k);
      ctx.stroke();
    }

    // Boards and the handle.
    const board = (x1: number, y1: number, x2: number, y2: number, w: number) => {
      const path = new Path2D();
      const a = Math.atan2(y2 - y1, x2 - x1);
      const nx = -Math.sin(a) * w;
      const ny = Math.cos(a) * w;
      path.moveTo(x1 - nx / 2, y1 - ny / 2);
      path.lineTo(x2 - nx / 2, y2 - ny / 2);
      path.lineTo(x2 + nx / 2, y2 + ny / 2);
      path.lineTo(x1 + nx / 2, y1 + ny / 2);
      path.closePath();
      shade(ctx, path, { base: '#7a4f2e', shadow: '#4e311c', light: blend('#946340', '#ffb27a', warm * 0.8) }, { x: -1, y: -1 }, 2 * s, 3 * s);
    };
    board(hingeX, hingeY, tipTop.x, tipTop.y, 8 * s);
    board(hingeX, hingeY + 4 * s, tipBottom.x, tipBottom.y, 8 * s);
    board(tipTop.x, tipTop.y, tipTop.x + Math.cos(-open) * 28 * s, tipTop.y + Math.sin(-open) * 28 * s, 5 * s);
  }

  /** Anvil on a wooden stump, left of the hearth. */
  private drawAnvil(ctx: CanvasRenderingContext2D, light: number) {
    const s = this.scale * 0.8;
    const floor = this.floor();
    const ax = this.cx - this.hearthHalf() - 20 * this.scale - 50 * s;
    if (ax - 96 * s < 4) return;
    const warm = clamp(light, 0, 1);
    const toward = { x: 1, y: -0.4 };

    const stumpTop = floor - 46 * s;
    const stump = new Path2D();
    stump.roundRect(ax - 34 * s, stumpTop, 68 * s, floor - stumpTop, 4 * s);
    shade(ctx, stump, { base: '#4a3020', shadow: '#2c1c12', light: blend('#5c3c28', '#f0955a', warm * 0.8) }, toward, 3 * s, 8 * s);
    ctx.fillStyle = blend('#6e4a30', '#c98a5a', warm * 0.5);
    ctx.beginPath();
    ctx.ellipse(ax, stumpTop, 34 * s, 6 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    const g = stumpTop;
    const anvil = new Path2D();
    // Foot, waist, face and horn, left to right.
    anvil.moveTo(ax - 30 * s, g);
    anvil.lineTo(ax - 22 * s, g - 12 * s);
    anvil.lineTo(ax - 14 * s, g - 16 * s);
    anvil.lineTo(ax - 12 * s, g - 36 * s);
    anvil.lineTo(ax - 44 * s, g - 40 * s);
    anvil.quadraticCurveTo(ax - 70 * s, g - 46 * s, ax - 84 * s, g - 58 * s);
    anvil.lineTo(ax - 36 * s, g - 58 * s);
    anvil.lineTo(ax + 46 * s, g - 58 * s);
    anvil.lineTo(ax + 46 * s, g - 42 * s);
    anvil.lineTo(ax + 14 * s, g - 36 * s);
    anvil.lineTo(ax + 16 * s, g - 16 * s);
    anvil.lineTo(ax + 24 * s, g - 12 * s);
    anvil.lineTo(ax + 32 * s, g);
    anvil.closePath();
    shade(ctx, anvil, { base: '#353a42', shadow: '#1d2026', light: blend('#4f5761', '#ffa06a', warm * 0.85) }, toward, 3.5 * s, 7 * s);
    // Polished face catching the light.
    ctx.fillStyle = blend('#6a737e', '#ffc08a', warm * 0.7);
    ctx.fillRect(ax - 36 * s, g - 58 * s, 82 * s, 2.5 * s);
  }

  /** A synthesized hammer blow: inharmonic partials ringing out over a short thud. */
  private clang() {
    try {
      this.audio ??= new AudioContext();
      const ac = this.audio;
      const now = ac.currentTime;
      const base = rand(560, 640);
      for (const [ratio, gain, decay] of [
        [1, 0.16, 0.9],
        [2.76, 0.1, 0.6],
        [5.4, 0.06, 0.35],
        [8.93, 0.04, 0.2],
      ]) {
        const osc = ac.createOscillator();
        osc.frequency.value = base * ratio;
        const gn = ac.createGain();
        gn.gain.setValueAtTime(gain, now);
        gn.gain.exponentialRampToValueAtTime(0.0005, now + decay);
        osc.connect(gn).connect(ac.destination);
        osc.start(now);
        osc.stop(now + decay);
      }
      const thud = ac.createOscillator();
      thud.frequency.setValueAtTime(180, now);
      thud.frequency.exponentialRampToValueAtTime(60, now + 0.08);
      const tg = ac.createGain();
      tg.gain.setValueAtTime(0.25, now);
      tg.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      thud.connect(tg).connect(ac.destination);
      thud.start(now);
      thud.stop(now + 0.1);
    } catch {
      // Audio is optional.
    }
  }
}

export const forgeTheme: FireTheme = {
  id: 'forge',
  label: 'Forge',
  palette: {
    titleFrom: '#eef1f4',
    titleTo: '#6f7a84',
    titleGlow: 'rgba(255, 110, 30, 0.3)',
    ambient: '#1d1418',
  },
  letters: {
    knock: 'touch',
    draggable: true,
    item: false,
    // Glows in the coals within a couple of seconds, melts if left there; cools slowly on the anvil.
    heat: { rate: 0.3, reach: 50, cool: 0.06 },
    hammer: true,
  },
  createRenderer: (host) => new Forge(host),
};
