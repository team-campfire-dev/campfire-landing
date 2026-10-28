// Shared look for the illustrated themes: flat colour, cel shading lit by the fire, layered
// silhouettes, and flames built from overlapping tongues instead of particles.

import { noise1 } from './noise';

export type RGB = [number, number, number];

export const hexRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const mix = (a: RGB, b: RGB, t: number): RGB => {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};

export const css = ([r, g, b]: RGB, alpha = 1) =>
  alpha >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${alpha.toFixed(3)})`;

/** Mixes two hex colours into a CSS colour. */
export const blend = (a: string, b: string, t: number) => css(mix(hexRgb(a), hexRgb(b), t));

/** Deterministic PRNG, so scenery is the same after every resize. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Fractal noise in [0, 1] — ridgelines and other natural edges. */
export const fbm = (x: number, octaves = 4) => {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise1(x * freq + i * 31.7) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
};

export interface Tones {
  base: string;
  /** Crisp band along the edge facing the light. */
  light: string;
  /** Band along the edge turned away from it. */
  shadow: string;
}

/** The part of `shape` left uncovered once it is shifted by (dx, dy). */
function band(shape: Path2D, dx: number, dy: number) {
  const out = new Path2D();
  out.rect(-1e5, -1e5, 2e5, 2e5);
  out.addPath(shape, new DOMMatrix().translateSelf(dx, dy));
  return out;
}

/**
 * Fills a shape in three flat tones — base, a highlight band on the side facing the light and a
 * shadow band on the far side. `toward` points from the shape to the light; `rim` and `shadow`
 * are the band widths in px.
 */
export function shade(
  ctx: CanvasRenderingContext2D,
  shape: Path2D,
  tones: Tones,
  toward: { x: number; y: number },
  rim: number,
  shadow = rim * 1.8,
) {
  const d = Math.hypot(toward.x, toward.y) || 1;
  const ux = toward.x / d;
  const uy = toward.y / d;
  ctx.fillStyle = tones.base;
  ctx.fill(shape);
  ctx.save();
  ctx.clip(shape);
  ctx.fillStyle = tones.shadow;
  ctx.fill(band(shape, ux * shadow, uy * shadow), 'evenodd');
  ctx.fillStyle = tones.light;
  ctx.fill(band(shape, -ux * rim, -uy * rim), 'evenodd');
  ctx.restore();
}

/** Tones for a surface: `cool` where the fire doesn't reach, warming towards `warm` with `light` (0..1). */
export function litTones(base: string, shadow: string, cool: string, warm: string, light: number): Tones {
  return { base, shadow, light: blend(cool, warm, light) };
}

/** Additive radial glow. */
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: RGB, alpha: number) {
  if (alpha <= 0.002 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, css(color, Math.min(1, alpha)));
  g.addColorStop(0.4, css(color, Math.min(1, alpha) * 0.4));
  g.addColorStop(1, css(color, 0));
  const op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalCompositeOperation = op;
}

/** Translates/rotates a path built around the origin. */
export function placed(path: Path2D, x: number, y: number, angle = 0) {
  const out = new Path2D();
  out.addPath(path, new DOMMatrix().translateSelf(x, y).rotateSelf((angle * 180) / Math.PI));
  return out;
}

/** A stylised pine: stacked, slightly ragged tiers on a short trunk. Base at (x, y). */
export function pine(path: Path2D, x: number, y: number, height: number, rand: () => number) {
  const width = height * (0.32 + rand() * 0.08);
  const trunk = height * 0.08;
  path.rect(x - width * 0.06, y - trunk, width * 0.12, trunk + 1);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const bottom = y - trunk - t * height * 0.78;
    const w = (width / 2) * (1 - t * 0.68);
    const top = bottom - height * (0.34 - t * 0.04);
    path.moveTo(x - w, bottom);
    path.lineTo(x - w * 0.55, bottom - (bottom - top) * 0.32);
    path.lineTo(x - w * 0.72, bottom - (bottom - top) * 0.3);
    path.lineTo(x, top);
    path.lineTo(x + w * 0.72, bottom - (bottom - top) * 0.3);
    path.lineTo(x + w * 0.55, bottom - (bottom - top) * 0.32);
    path.lineTo(x + w, bottom);
    path.closePath();
  }
}

/** A ridgeline filled down to `bottom`. */
export function ridge(width: number, baseY: number, amp: number, freq: number, seed: number, bottom: number) {
  const path = new Path2D();
  path.moveTo(0, bottom);
  for (let x = 0; x <= width + 6; x += 6) path.lineTo(x, baseY - amp * fbm(x * freq + seed));
  path.lineTo(width, bottom);
  path.closePath();
  return path;
}

/** Height of a `ridge` at x. */
export const ridgeY = (x: number, baseY: number, amp: number, freq: number, seed: number) =>
  baseY - amp * fbm(x * freq + seed);

/** Static scenery painted once per resize into an offscreen canvas at device resolution. */
export class Backdrop {
  private canvas: HTMLCanvasElement | null = null;
  private width = 0;
  private height = 0;

  paint(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas ??= document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.width = width;
    this.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx);
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.canvas) ctx.drawImage(this.canvas, 0, 0, this.width, this.height);
  }
}

/** Outer to core: red-orange rim, orange, yellow, pale core. */
export const FIRE_TONES = ['#d9431f', '#f47b28', '#ffbb3f', '#fff1bd'];
const LAYER_HEIGHT = [1, 0.74, 0.5, 0.27];
const LAYER_WIDTH = [1, 0.8, 0.6, 0.4];

interface Tongue {
  /** Position across the base, -1..1. */
  offset: number;
  height: number;
  width: number;
  seed: number;
}

interface Lick {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  age: number;
  life: number;
}

/**
 * A stylised fire: flame tongues layered in flat colour bands, plus small licks that break
 * off the top and rise. Call `place` every frame, then `update` and `draw`.
 */
export class TongueFire {
  private readonly tongues: Tongue[];
  private licks: Lick[] = [];
  private lickDebt = 0;
  private time = 0;
  x = 0;
  baseY = 0;
  width = 100;
  height = 150;
  /** Lean of the whole fire, roughly -1..1. */
  wind = 0;

  constructor(
    count: number,
    private readonly colors: string[] = FIRE_TONES,
    /** Licks per second at full height. */
    private readonly lickRate = 5,
  ) {
    this.tongues = Array.from({ length: count }, (_, i) => {
      const o = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
      return {
        offset: o * 0.82 + (Math.random() - 0.5) * 0.12,
        height: (1 - Math.abs(o) ** 1.5 * 0.62) * (0.82 + Math.random() * 0.3),
        width: 0.3 + Math.random() * 0.12,
        seed: Math.random() * 100,
      };
    });
  }

  place(x: number, baseY: number, width: number, height: number, wind = this.wind) {
    this.x = x;
    this.baseY = baseY;
    this.width = width;
    this.height = height;
    this.wind = wind;
  }

  /** Throws a burst of licks up from (x, y) — fed or stoked. */
  burst(x: number, y: number, count: number) {
    for (let i = 0; i < count; i++) this.spawnLick(x + (Math.random() - 0.5) * this.width * 0.4, y, 1.4);
  }

  update(dt: number, time: number) {
    this.time = time;
    this.lickDebt += this.lickRate * (this.height / 150) * dt;
    while (this.lickDebt >= 1) {
      this.lickDebt -= 1;
      const top = this.baseY - this.height * (0.45 + Math.random() * 0.3);
      this.spawnLick(this.x + (Math.random() - 0.5) * this.width * 0.45, top, 1);
    }
    for (let i = this.licks.length - 1; i >= 0; i--) {
      const l = this.licks[i];
      l.age += dt;
      if (l.age >= l.life) {
        this.licks[i] = this.licks[this.licks.length - 1];
        this.licks.pop();
        continue;
      }
      l.vx += this.wind * 220 * dt;
      l.x += l.vx * dt;
      l.y += l.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.height < 2) return;
    ctx.globalCompositeOperation = 'source-over';
    for (let layer = 0; layer < this.colors.length; layer++) {
      const path = new Path2D();
      this.addLayer(path, layer);
      for (const l of this.licks) {
        const t = l.age / l.life;
        const size = l.size * (1 - t) * LAYER_WIDTH[layer] * (layer < 2 ? 1 : 0.7);
        if (size > 1 && layer < 3) this.tongue(path, l.x, l.y, size, size * 2.3, this.wind * size, 0);
      }
      ctx.fillStyle = this.colors[layer];
      ctx.fill(path);
    }
  }

  private addLayer(path: Path2D, layer: number) {
    const { time, width, height, baseY } = this;
    const hs = LAYER_HEIGHT[layer];
    const ws = LAYER_WIDTH[layer];
    // Inner layers gather towards the middle, so the core sits low and central.
    const gather = 1 - layer * 0.22;
    for (const t of this.tongues) {
      const flick = 0.72 + 0.36 * noise1(time * 2.4 + t.seed) + 0.12 * noise1(time * 7.3 + t.seed * 3);
      const h = height * t.height * flick * hs;
      const w = width * t.width * ws;
      const bx = this.x + (t.offset * width * gather) / 2;
      const sway = (noise1(time * 1.6 + t.seed * 5) - 0.5) * w * 0.9 + this.wind * h * 0.45;
      const bend = (noise1(time * 2.2 + t.seed * 7) - 0.5) * w * 0.9;
      this.tongue(path, bx, baseY, w, h, sway, bend);
    }
    // Round the base so the tongues sit on one body of flame.
    path.ellipse(this.x, baseY, (width / 2) * ws * 0.92, width * 0.16 * ws, 0, 0, Math.PI * 2);
  }

  /** One teardrop flame, base centred on (x, y), tip shifted by `sway`, belly bent by `bend`. */
  private tongue(path: Path2D, x: number, y: number, w: number, h: number, sway: number, bend: number) {
    path.moveTo(x - w / 2, y);
    path.bezierCurveTo(x - w / 2, y - h * 0.42, x - w * 0.18 + bend + sway * 0.4, y - h * 0.74, x + sway, y - h);
    path.bezierCurveTo(x + w * 0.18 + bend + sway * 0.4, y - h * 0.72, x + w / 2, y - h * 0.42, x + w / 2, y);
    path.bezierCurveTo(x + w / 2, y + w * 0.28, x - w / 2, y + w * 0.28, x - w / 2, y);
    path.closePath();
  }

  private spawnLick(x: number, y: number, power: number) {
    if (this.licks.length > 24) return;
    this.licks.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 30,
      vy: -this.height * (0.9 + Math.random() * 0.6) * power,
      size: this.width * (0.08 + Math.random() * 0.07),
      age: 0,
      life: 0.35 + Math.random() * 0.3,
    });
  }
}

/** Rising embers drawn as small glowing dots. */
export interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  seed: number;
}

export function drawEmbers(ctx: CanvasRenderingContext2D, embers: Ember[], time: number) {
  ctx.globalCompositeOperation = 'lighter';
  for (const e of embers) {
    const t = e.age / e.life;
    const twinkle = 0.6 + 0.4 * Math.sin(e.seed * 13 + time * (10 + (e.seed % 6)));
    const alpha = Math.max(0, (1 - t) * twinkle);
    const color = mix([255, 226, 140], [255, 96, 40], t);
    ctx.fillStyle = css(color, alpha * 0.25);
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.size * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(color, alpha);
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
