import { noise1, noise2 } from '../noise';
import type { FireFrame, FireRenderer, FireTheme, HotZone, PointerSample } from '../types';

type RGB = [number, number, number];

interface Flame {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  cool: number;
}

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  seed: number;
}

interface Smoke {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
}

interface Log {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  radius: number;
}

interface Stone {
  x: number;
  y: number;
  rx: number;
  ry: number;
  tilt: number;
}

// Flame color over a particle's life: white-hot core → yellow → orange → deep red → gone.
const FLAME_RAMP: Array<[number, RGB, number]> = [
  [0, [255, 236, 190], 0.45],
  [0.14, [255, 200, 92], 0.62],
  [0.34, [255, 138, 34], 0.6],
  [0.58, [224, 70, 14], 0.4],
  [0.82, [130, 26, 8], 0.16],
  [1, [48, 8, 4], 0],
];
const SPRITE_STEPS = 32;
const SPRITE_SIZE = 64;
const MAX_FLAMES = 650;
const MAX_EMBERS = 240;
const MAX_SMOKE = 36;

// Scenery layout in "fire units" (multiplied by the scale), relative to the fire base.
const LOGS: Log[] = [
  { x1: -128, y1: 24, x2: 92, y2: -20, radius: 15 },
  { x1: 128, y1: 24, x2: -92, y2: -20, radius: 15 },
];
const STONES: Stone[] = [
  { x: -150, y: 18, rx: 24, ry: 15, tilt: -0.2 },
  { x: -112, y: 32, rx: 27, ry: 16, tilt: 0.1 },
  { x: -64, y: 41, rx: 25, ry: 15, tilt: -0.05 },
  { x: -14, y: 44, rx: 28, ry: 16, tilt: 0.08 },
  { x: 38, y: 43, rx: 24, ry: 15, tilt: -0.1 },
  { x: 88, y: 37, rx: 27, ry: 16, tilt: 0.12 },
  { x: 134, y: 25, rx: 24, ry: 15, tilt: 0.2 },
];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
/** Roughly normal in [-1, 1], biased to the center. */
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function sampleRamp(t: number): [RGB, number] {
  for (let i = 1; i < FLAME_RAMP.length; i++) {
    const [t1, c1, a1] = FLAME_RAMP[i];
    if (t <= t1) {
      const [t0, c0, a0] = FLAME_RAMP[i - 1];
      const k = (t - t0) / (t1 - t0);
      return [
        [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k],
        a0 + (a1 - a0) * k,
      ];
    }
  }
  const last = FLAME_RAMP[FLAME_RAMP.length - 1];
  return [last[1], last[2]];
}

function makeSprite([r, g, b]: RGB, alpha: number) {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const half = SPRITE_SIZE / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${alpha})`);
  grad.addColorStop(0.4, `rgba(${r | 0},${g | 0},${b | 0},${alpha * 0.5})`);
  grad.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return canvas;
}

function repel(p: { x: number; y: number; vx: number; vy: number }, pointer: PointerSample | null, radius: number, force: number) {
  if (!pointer) return;
  const dx = p.x - pointer.x;
  const dy = p.y - pointer.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= radius * radius) return;
  const d = Math.sqrt(d2) || 1;
  const f = (1 - d / radius) * force;
  p.vx += (dx / d) * f;
  p.vy += (dy / d) * f * 0.6;
}

class ClassicCampfire implements FireRenderer {
  private readonly sprites: HTMLCanvasElement[];
  private readonly smokeSprite: HTMLCanvasElement;
  private flames: Flame[] = [];
  private embers: Ember[] = [];
  private smoke: Smoke[] = [];

  private width = 0;
  private height = 0;
  private scale = 1;
  private cx = 0;
  private cy = 0;

  private time = 0;
  private ignition = 0;
  private boost = 0;
  private flicker = 1;
  private wind = 0;
  private pointer: PointerSample | null = null;
  private reducedMotion = false;
  private flameDebt = 0;
  private emberDebt = 0;
  private smokeDebt = 0;

  constructor() {
    this.sprites = Array.from({ length: SPRITE_STEPS }, (_, i) => {
      const [rgb, alpha] = sampleRamp(i / (SPRITE_STEPS - 1));
      return makeSprite(rgb, alpha);
    });
    this.smokeSprite = makeSprite([74, 66, 64], 1);
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    this.cx = width / 2;
    this.cy = height - 70 * this.scale;
  }

  hotZone(): HotZone {
    const s = this.scale;
    const top = this.cy - (170 + 60 * Math.min(this.boost, 2)) * s;
    return { x: this.cx - 100 * s, y: top, width: 200 * s, height: this.height - top };
  }

  stoke(x: number) {
    this.boost = Math.min(this.boost + 0.35, 2.6);
    const bx = clamp(x, this.cx - 70 * this.scale, this.cx + 70 * this.scale);
    for (let i = 0; i < 28; i++) this.burstEmber(bx, this.cy - 30 * this.scale, 0.9);
  }

  feed(x: number, y: number, fuel: number) {
    this.boost = Math.min(this.boost + 0.9 * fuel, 2.6);
    for (let i = 0; i < 50 * fuel; i++) this.burstEmber(x, y, 1.15);
    for (let i = 0; i < 30 * fuel && this.flames.length < MAX_FLAMES; i++) {
      this.flames.push({
        x: x + gauss() * 18 * this.scale,
        y: y + gauss() * 18 * this.scale,
        vx: rand(-40, 40) * this.scale,
        vy: -rand(60, 160) * this.scale,
        age: 0,
        life: rand(0.4, 0.8),
        size: rand(24, 40) * this.scale,
        cool: 0,
      });
    }
  }

  update({ time, dt, pointer, reducedMotion }: FireFrame) {
    this.time = time;
    this.pointer = pointer;
    this.reducedMotion = reducedMotion;

    this.ignition = Math.min(1, this.ignition + dt / 1.6);
    const lit = 1 - (1 - this.ignition) ** 3;
    this.boost *= Math.exp(-0.5 * dt);
    this.flicker = 0.78 + 0.3 * noise1(time * 3.1) + 0.14 * noise1(time * 9.7 + 40);

    // Wind: slow ambient sway plus gusts from the pointer sweeping past the fire.
    const ambient = (noise1(time * 0.35 + 90) - 0.5) * 0.45;
    if (pointer) {
      const dx = pointer.x - this.cx;
      const dy = pointer.y - (this.cy - 110 * this.scale);
      const proximity = clamp(1 - Math.hypot(dx, dy) / (340 * this.scale), 0, 1);
      this.wind += clamp(pointer.vx / 1500, -1.5, 1.5) * proximity * dt * 6;
    }
    this.wind += (ambient - this.wind) * Math.min(1, dt * 1.4);
    this.wind = clamp(this.wind, -1.3, 1.3);

    const boost = Math.min(this.boost, 2);
    this.flameDebt += (reducedMotion ? 160 : 250) * lit * (1 + 0.7 * boost) * this.flicker * dt;
    while (this.flameDebt >= 1) {
      this.flameDebt -= 1;
      if (this.flames.length < MAX_FLAMES) this.spawnFlame(boost);
    }
    this.emberDebt += (reducedMotion ? 3 : 8) * lit * (1 + 2.5 * boost) * dt;
    while (this.emberDebt >= 1) {
      this.emberDebt -= 1;
      this.spawnEmber();
    }
    this.smokeDebt += 4 * lit * dt;
    while (this.smokeDebt >= 1) {
      this.smokeDebt -= 1;
      if (this.smoke.length < MAX_SMOKE) this.spawnSmoke(boost);
    }

    this.stepFlames(dt);
    this.stepEmbers(dt);
    this.stepSmoke(dt);
  }

  draw(ctx: CanvasRenderingContext2D) {
    const heat = (1 - (1 - this.ignition) ** 3) * this.flicker * (1 + 0.5 * Math.min(this.boost, 2));
    this.drawGlow(ctx, heat);
    this.drawSmoke(ctx);
    for (const log of LOGS) this.drawLog(ctx, log, heat);
    this.drawCoals(ctx, heat);
    this.drawFlames(ctx);
    this.drawStones(ctx, heat);
    this.drawEmbers(ctx);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- spawning ----

  private spawnFlame(boost: number) {
    const s = this.scale;
    const g = gauss();
    const edge = Math.abs(g);
    const tall = Math.random() < 0.18 ? 1.6 : 1;
    const height = (0.8 + 0.3 * this.flicker) * (1 + 0.4 * boost) * tall;
    this.flames.push({
      x: this.cx + g * 64 * s * (1 + 0.2 * boost),
      y: this.cy - rand(0, 14) * s,
      vx: rand(-15, 15) * s,
      vy: -rand(85, 150) * s * height,
      age: 0,
      life: rand(0.5, 0.95) * (1 - edge * 0.5) * Math.sqrt(height),
      size: rand(20, 32) * s * (1 - edge * 0.35) * (1 + 0.2 * boost),
      cool: Math.random() * 0.16,
    });
  }

  private spawnEmber() {
    const s = this.scale;
    this.pushEmber(
      this.cx + gauss() * 40 * s,
      this.cy - rand(10, 70) * s,
      rand(-0.3, 0.3) * 120 * s,
      -rand(90, 240) * s,
    );
  }

  private burstEmber(x: number, y: number, power: number) {
    const angle = -Math.PI / 2 + rand(-1.15, 1.15);
    const speed = rand(150, 480) * this.scale * power;
    this.pushEmber(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  private pushEmber(x: number, y: number, vx: number, vy: number) {
    if (this.embers.length >= MAX_EMBERS) return;
    this.embers.push({
      x,
      y,
      vx,
      vy,
      age: 0,
      life: rand(1.2, 3.4),
      size: rand(1, 2.4) * Math.max(this.scale, 0.8),
      seed: Math.random() * 100,
    });
  }

  private spawnSmoke(boost: number) {
    const s = this.scale;
    this.smoke.push({
      x: this.cx + gauss() * 30 * s,
      y: this.cy - rand(140, 200) * s * (1 + 0.3 * boost),
      vx: 0,
      vy: -rand(22, 40) * s,
      age: 0,
      life: rand(3, 5),
      size: rand(30, 48) * s,
    });
  }

  // ---- simulation ----

  private stepFlames(dt: number) {
    const s = this.scale;
    const turbulence = (this.reducedMotion ? 450 : 900) * s;
    const drag = Math.max(0, 1 - 2.2 * dt);
    for (let i = this.flames.length - 1; i >= 0; i--) {
      const p = this.flames[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.flames[i] = this.flames[this.flames.length - 1];
        this.flames.pop();
        continue;
      }
      const t = p.age / p.life;
      const rise = Math.max(0, this.cy - p.y);
      // Particles converge on a wavering axis, which is what shapes them into flame tongues.
      const sway = (noise1(this.time * 1.3 + rise * 0.004) - 0.5) * 34 * s * (rise / (150 * s));
      const axis = this.cx + this.wind * rise * 0.55 + sway;
      p.vy -= 270 * s * dt;
      p.vx += (axis - p.x) * 3 * dt;
      p.vx += (noise2(p.x * 0.011, p.y * 0.009 + this.time * 2.2) - 0.5) * turbulence * dt * (0.35 + t);
      repel(p, this.pointer, 75 * s, 2600 * s * dt);
      p.vx *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
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
      e.vx += (noise2(e.seed, this.time * 0.9) - 0.5) * 520 * s * dt + this.wind * 150 * s * dt;
      repel(e, this.pointer, 90 * s, 4200 * s * dt);
      e.vx *= drag;
      e.vy *= drag;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
  }

  private stepSmoke(dt: number) {
    const s = this.scale;
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.smoke[i] = this.smoke[this.smoke.length - 1];
        this.smoke.pop();
        continue;
      }
      p.vx += (this.wind * 40 * s - p.vx) * dt + (noise2(p.y * 0.01, this.time * 0.5) - 0.5) * 60 * s * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  // ---- drawing ----

  private drawGlow(ctx: CanvasRenderingContext2D, heat: number) {
    const s = this.scale;
    const gy = this.cy - 70 * s;
    const radius = 440 * s * (0.92 + 0.1 * this.flicker) * (1 + 0.12 * Math.min(this.boost, 2));
    const a = (v: number) => Math.min(1, v * heat).toFixed(3);

    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(this.cx, gy, 0, this.cx, gy, radius);
    glow.addColorStop(0, `rgba(255,120,40,${a(0.26)})`);
    glow.addColorStop(0.35, `rgba(255,80,20,${a(0.1)})`);
    glow.addColorStop(1, 'rgba(255,60,10,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(this.cx - radius, gy - radius, radius * 2, radius * 2);

    // Light pooled on the ground around the fire.
    ctx.save();
    ctx.translate(this.cx, this.cy + 26 * s);
    ctx.scale(1, 0.22);
    const ground = ctx.createRadialGradient(0, 0, 0, 0, 0, 260 * s);
    ground.addColorStop(0, `rgba(255,120,45,${a(0.32)})`);
    ground.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.arc(0, 0, 260 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawSmoke(ctx: CanvasRenderingContext2D) {
    ctx.globalCompositeOperation = 'source-over';
    for (const p of this.smoke) {
      const t = p.age / p.life;
      const r = p.size * (1 + 2 * t);
      ctx.globalAlpha = 0.07 * Math.sin(Math.PI * t);
      ctx.drawImage(this.smokeSprite, p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawLog(ctx: CanvasRenderingContext2D, log: Log, heat: number) {
    const s = this.scale;
    const x1 = this.cx + log.x1 * s;
    const y1 = this.cy + log.y1 * s;
    const x2 = this.cx + log.x2 * s;
    const y2 = this.cy + log.y2 * s;
    const r = log.radius * s;
    const length = Math.hypot(x2 - x1, y2 - y1);
    const lit = clamp(heat, 0, 1.6);

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.translate(x1, y1);
    ctx.rotate(Math.atan2(y2 - y1, x2 - x1));

    const bark = ctx.createLinearGradient(0, -r, 0, r);
    bark.addColorStop(0, `rgb(${(70 + 70 * lit) | 0},${(38 + 30 * lit) | 0},${(20 + 8 * lit) | 0})`);
    bark.addColorStop(0.45, '#3a2215');
    bark.addColorStop(1, '#140b06');
    ctx.fillStyle = bark;
    ctx.beginPath();
    ctx.roundRect(0, -r, length, r * 2, r * 0.6);
    ctx.fill();

    ctx.strokeStyle = 'rgba(10,5,2,0.55)';
    ctx.lineWidth = Math.max(1, 1.2 * s);
    for (const [from, to, off] of [[0.12, 0.5, -0.35], [0.3, 0.8, 0.15], [0.55, 0.95, 0.5]]) {
      ctx.beginPath();
      ctx.moveTo(length * from, r * off);
      ctx.lineTo(length * to, r * off + r * 0.08);
      ctx.stroke();
    }

    // Charred end glowing where it sits in the fire.
    ctx.globalCompositeOperation = 'lighter';
    const ember = ctx.createLinearGradient(length * 0.45, 0, length, 0);
    ember.addColorStop(0, 'rgba(255,80,10,0)');
    ember.addColorStop(1, `rgba(255,90,20,${Math.min(1, 0.45 * lit).toFixed(3)})`);
    ctx.fillStyle = ember;
    ctx.beginPath();
    ctx.roundRect(length * 0.45, -r, length * 0.55, r * 2, r * 0.6);
    ctx.fill();

    // Cut end facing the viewer.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#5a3a22';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.42, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a6240';
    ctx.lineWidth = Math.max(1, 1.4 * s);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.26, r * 0.62, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawCoals(ctx: CanvasRenderingContext2D, heat: number) {
    const s = this.scale;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const x = this.cx + (i - 4) * 15 * s + Math.sin(i * 7.3) * 6 * s;
      const y = this.cy + 6 * s + Math.cos(i * 3.1) * 5 * s;
      const pulse = 0.45 + 0.55 * noise1(this.time * 1.7 + i * 11);
      const r = (10 + (i % 3) * 3) * s;
      ctx.globalAlpha = clamp(pulse * heat * 0.8, 0, 1);
      ctx.drawImage(this.sprites[12], x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawFlames(ctx: CanvasRenderingContext2D) {
    ctx.globalCompositeOperation = 'lighter';
    const last = SPRITE_STEPS - 1;
    for (const p of this.flames) {
      const t = p.age / p.life;
      const r = p.size * (t < 0.2 ? 0.7 + 1.5 * t : 1 - 0.75 * ((t - 0.2) / 0.8));
      const sprite = this.sprites[Math.min(last, ((t + p.cool) * last) | 0)];
      ctx.globalAlpha = Math.min(1, p.age / 0.15) * 0.62;
      ctx.drawImage(sprite, p.x - r, p.y - r * 1.35, r * 2, r * 2.7);
    }
    ctx.globalAlpha = 1;
  }

  private drawStones(ctx: CanvasRenderingContext2D, heat: number) {
    const s = this.scale;
    const lit = clamp(heat, 0, 1.6);
    ctx.globalCompositeOperation = 'source-over';
    for (const stone of STONES) {
      const x = this.cx + stone.x * s;
      const y = this.cy + stone.y * s;
      const rx = stone.rx * s;
      const ry = stone.ry * s;
      // Stones nearer the center catch more firelight.
      const near = 1 - Math.abs(stone.x) / 220;
      const fill = ctx.createLinearGradient(x, y - ry, x, y + ry);
      fill.addColorStop(0, `rgb(${(62 + 70 * lit * near) | 0},${(50 + 32 * lit * near) | 0},${(48 + 14 * lit * near) | 0})`);
      fill.addColorStop(0.5, '#2a2526');
      fill.addColorStop(1, '#111012');
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, stone.tilt, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawEmbers(ctx: CanvasRenderingContext2D) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const glow = this.sprites[6];
    for (const e of this.embers) {
      const t = e.age / e.life;
      const twinkle = 0.55 + 0.45 * Math.sin(e.seed * 13 + this.time * (12 + (e.seed % 7)));
      const alpha = clamp((1 - t) ** 1.2 * twinkle, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = `rgb(255,${(225 - 150 * t) | 0},${(120 - 100 * t) | 0})`;
      ctx.lineWidth = e.size;
      ctx.beginPath();
      ctx.moveTo(e.x - e.vx * 0.035, e.y - e.vy * 0.035);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
      const r = e.size * 6;
      ctx.globalAlpha = alpha * 0.45;
      ctx.drawImage(glow, e.x - r, e.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }
}

export const classicTheme: FireTheme = {
  id: 'classic',
  label: 'Campfire',
  palette: {
    titleFrom: '#ff9100',
    titleTo: '#ff5f00',
    titleGlow: 'rgba(255, 95, 0, 0.45)',
    ambient: '#2a1a10',
  },
  createRenderer: () => new ClassicCampfire(),
};
