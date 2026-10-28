import { noise1, noise2 } from '../noise';
import {
  Backdrop,
  TongueFire,
  blend,
  drawEmbers,
  glow,
  pine,
  placed,
  ridge,
  ridgeY,
  seeded,
  shade,
  type Ember,
} from '../illustration';
import type { FireFrame, FireRenderer, FireTap, FireTheme, HotZone, PointerSample } from '../types';

/** What a setting needs to know to draw around the fire. */
export interface CampfireView {
  width: number;
  height: number;
  scale: number;
  /** Fire base. */
  cx: number;
  cy: number;
  /** Fire brightness, 0 (out) to ~1.5 (roaring). */
  light: number;
  time: number;
  reducedMotion: boolean;
  /** Pointer over the hero, or null. */
  pointer: PointerSample | null;
}

/** The place the campfire burns in: everything but the fire, logs and stones. */
export interface CampfireSetting {
  /** Static scenery, painted once per resize. */
  paint(ctx: CanvasRenderingContext2D, view: CampfireView): void;
  /** Scenery that moves (stars, water), drawn over the static part every frame. */
  animate?(ctx: CanvasRenderingContext2D, view: CampfireView): void;
  /** Props that catch the firelight, drawn just before the fire. */
  props?(ctx: CanvasRenderingContext2D, view: CampfireView): void;
  /** Drawn over everything, fire included. */
  overlay?(ctx: CanvasRenderingContext2D, view: CampfireView): void;
  /** A tap the setting wants for itself; return true to keep it from the fire. */
  tap?(tap: FireTap, view: CampfireView): boolean;
  /** Advances the setting's own simulation. */
  update?(dt: number, view: CampfireView): void;
  dispose?(): void;
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

const MAX_EMBERS = 160;

// Layout in "fire units" (multiplied by the scale), relative to the fire base.
const LOGS: Log[] = [
  { x1: -122, y1: 22, x2: 88, y2: -18, radius: 14 },
  { x1: 122, y1: 22, x2: -88, y2: -18, radius: 14 },
];
const BACK_STONES: Stone[] = [
  { x: -96, y: -4, rx: 20, ry: 12, tilt: 0.1 },
  { x: -40, y: -10, rx: 22, ry: 12, tilt: -0.05 },
  { x: 30, y: -10, rx: 21, ry: 12, tilt: 0.06 },
  { x: 92, y: -4, rx: 20, ry: 12, tilt: -0.12 },
];
const FRONT_STONES: Stone[] = [
  { x: -146, y: 16, rx: 24, ry: 15, tilt: -0.2 },
  { x: -108, y: 31, rx: 27, ry: 16, tilt: 0.1 },
  { x: -60, y: 40, rx: 25, ry: 15, tilt: -0.05 },
  { x: -10, y: 43, rx: 28, ry: 16, tilt: 0.08 },
  { x: 42, y: 42, rx: 24, ry: 15, tilt: -0.1 },
  { x: 90, y: 35, rx: 27, ry: 16, tilt: 0.12 },
  { x: 136, y: 22, rx: 24, ry: 15, tilt: 0.2 },
];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
/** Roughly normal in [-1, 1], biased to the center. */
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** A lumpy stone outline around the origin. */
function stonePath(stone: Stone, s: number, seed: number) {
  const path = new Path2D();
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const k = 1 + 0.12 * (noise2(seed, i * 0.7) - 0.5) * 2;
    const x = Math.cos(a) * stone.rx * s * k;
    // Flatter underneath, where it sits on the ground.
    const y = Math.sin(a) * stone.ry * s * k * (Math.sin(a) > 0 ? 0.8 : 1);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  return placed(path, 0, 0, stone.tilt);
}

/**
 * An illustrated campfire: flat-coloured flame tongues on crossed logs in a ring of stones,
 * everything around it cel-shaded by the firelight. The surroundings come from a `CampfireSetting`.
 */
export class IllustratedCampfire implements FireRenderer {
  private readonly fire = new TongueFire(9);
  private readonly backdrop = new Backdrop();
  private embers: Ember[] = [];
  private stoneShapes: Path2D[] = [];

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
  private emberDebt = 0;

  constructor(private readonly setting: CampfireSetting) {}

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    this.cx = width / 2;
    this.cy = height - 70 * this.scale;
    this.stoneShapes = [...BACK_STONES, ...FRONT_STONES].map((stone, i) => stonePath(stone, this.scale, i * 3.3));
    this.backdrop.paint(width, height, (ctx) => this.setting.paint(ctx, this.view()));
  }

  hotZone(): HotZone {
    const s = this.scale;
    const top = this.cy - (170 + 60 * Math.min(this.boost, 2)) * s;
    return { x: this.cx - 100 * s, y: top, width: 200 * s, height: this.height - top };
  }

  tap(tap: FireTap) {
    if (this.setting.tap?.(tap, this.view())) return;
    const { x, onFire, onLetter } = tap;
    if (!onFire || onLetter) return;
    this.boost = Math.min(this.boost + 0.35, 2.6);
    const bx = clamp(x, this.cx - 70 * this.scale, this.cx + 70 * this.scale);
    for (let i = 0; i < 24; i++) this.burstEmber(bx, this.cy - 30 * this.scale, 0.9);
    this.fire.burst(bx, this.cy - 60 * this.scale, 3);
  }

  feed(x: number, y: number, fuel: number) {
    this.boost = Math.min(this.boost + 0.9 * fuel, 2.6);
    for (let i = 0; i < 40 * fuel; i++) this.burstEmber(x, y, 1.15);
    this.fire.burst(x, Math.min(y, this.cy - 40 * this.scale), Math.round(6 * fuel));
  }

  update({ time, dt, pointer, reducedMotion }: FireFrame) {
    this.time = time;
    this.pointer = pointer;
    this.reducedMotion = reducedMotion;
    this.ignition = Math.min(1, this.ignition + dt / 1.6);
    const lit = 1 - (1 - this.ignition) ** 3;
    this.boost *= Math.exp(-0.5 * dt);
    this.flicker = 0.85 + 0.2 * noise1(time * 3.1) + 0.08 * noise1(time * 9.7 + 40);

    // Wind: slow ambient sway plus gusts from the pointer sweeping past the fire.
    const ambient = (noise1(time * 0.35 + 90) - 0.5) * 0.4;
    if (pointer) {
      const dx = pointer.x - this.cx;
      const dy = pointer.y - (this.cy - 110 * this.scale);
      const proximity = clamp(1 - Math.hypot(dx, dy) / (340 * this.scale), 0, 1);
      this.wind += clamp(pointer.vx / 1500, -1.5, 1.5) * proximity * dt * 6;
    }
    this.wind += (ambient - this.wind) * Math.min(1, dt * 1.4);
    this.wind = clamp(this.wind, -1.2, 1.2);

    const s = this.scale;
    const boost = Math.min(this.boost, 2);
    this.fire.place(
      this.cx,
      this.cy - 2 * s,
      130 * s * (1 + 0.15 * boost),
      200 * s * lit * this.flicker * (1 + 0.35 * boost),
      this.wind * 0.8,
    );
    this.fire.update(reducedMotion ? dt * 0.5 : dt, reducedMotion ? time * 0.5 : time);

    this.emberDebt += (reducedMotion ? 2 : 6) * lit * (1 + 2.5 * boost) * dt;
    while (this.emberDebt >= 1) {
      this.emberDebt -= 1;
      this.pushEmber(this.cx + gauss() * 40 * s, this.cy - rand(30, 110) * s, rand(-30, 30) * s, -rand(80, 200) * s);
    }
    this.stepEmbers(dt);
    this.setting.update?.(dt, this.view());
  }

  draw(ctx: CanvasRenderingContext2D) {
    const lit = 1 - (1 - this.ignition) ** 3;
    const light = lit * this.flicker * (1 + 0.35 * Math.min(this.boost, 2));
    const view = this.view(light);
    const s = this.scale;

    this.backdrop.draw(ctx);
    this.setting.animate?.(ctx, view);

    // Firelight falling on the scene and pooling on the ground.
    glow(ctx, this.cx, this.cy - 90 * s, 520 * s, [255, 120, 50], 0.2 * light);
    ctx.save();
    ctx.translate(this.cx, this.cy + 20 * s);
    ctx.scale(1, 0.24);
    glow(ctx, 0, 0, 300 * s, [255, 130, 60], 0.3 * light);
    ctx.restore();

    this.setting.props?.(ctx, view);
    for (let i = 0; i < BACK_STONES.length; i++) this.drawStone(ctx, BACK_STONES[i], this.stoneShapes[i], light);
    for (const log of LOGS) this.drawLog(ctx, log, light);
    this.fire.draw(ctx);
    for (let i = 0; i < FRONT_STONES.length; i++) {
      this.drawStone(ctx, FRONT_STONES[i], this.stoneShapes[BACK_STONES.length + i], light);
    }
    drawEmbers(ctx, this.embers, this.time);
    this.setting.overlay?.(ctx, view);
    // Last, so the firelight doesn't leave a seam where the hero meets the page.
    fadeToPage(ctx, this.width, this.height);
  }

  dispose() {
    this.setting.dispose?.();
  }

  private view(light = 0): CampfireView {
    return {
      width: this.width,
      height: this.height,
      scale: this.scale,
      cx: this.cx,
      cy: this.cy,
      light,
      time: this.time,
      reducedMotion: this.reducedMotion,
      pointer: this.pointer,
    };
  }

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
    const p = this.pointer;
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
      if (p) {
        // Embers scatter away from the pointer.
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const d = Math.hypot(dx, dy);
        const r = 90 * s;
        if (d < r && d > 0) {
          const f = (1 - d / r) * 4200 * s * dt;
          e.vx += (dx / d) * f;
          e.vy += (dy / d) * f * 0.6;
        }
      }
      e.vx *= drag;
      e.vy *= drag;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
  }

  private drawLog(ctx: CanvasRenderingContext2D, log: Log, light: number) {
    const s = this.scale;
    const x1 = this.cx + log.x1 * s;
    const y1 = this.cy + log.y1 * s;
    const x2 = this.cx + log.x2 * s;
    const y2 = this.cy + log.y2 * s;
    const r = log.radius * s;
    const length = Math.hypot(x2 - x1, y2 - y1);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const warm = clamp(light, 0, 1.2);

    const body = new Path2D();
    body.roundRect(0, -r, length, r * 2, r * 0.7);
    const shape = placed(body, x1, y1, angle);
    shade(
      ctx,
      shape,
      { base: '#3d2a22', shadow: '#1f150f', light: blend('#55402f', '#f39a55', warm) },
      { x: this.cx - (x1 + x2) / 2, y: this.cy - 80 * s - (y1 + y2) / 2 },
      3.5 * s,
      7 * s,
    );

    // Bark grooves, then the glowing charred end in the fire.
    ctx.save();
    ctx.clip(shape);
    ctx.translate(x1, y1);
    ctx.rotate(angle);
    ctx.strokeStyle = 'rgba(20, 12, 8, 0.5)';
    ctx.lineWidth = Math.max(1, 1.4 * s);
    for (const [from, to, off] of [[0.15, 0.5, -0.3], [0.32, 0.78, 0.2], [0.55, 0.9, -0.05]]) {
      ctx.beginPath();
      ctx.moveTo(length * from, r * off);
      ctx.lineTo(length * to, r * off);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(255, 96, 34, ${(0.55 * clamp(light, 0, 1.2)).toFixed(3)})`;
    ctx.fillRect(length * 0.72, -r, length * 0.3, r * 2);
    ctx.restore();

    // Cut end facing the viewer.
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(angle);
    ctx.fillStyle = '#9c6a43';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.45, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6e4529';
    ctx.lineWidth = Math.max(1, 1.3 * s);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.26, r * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawStone(ctx: CanvasRenderingContext2D, stone: Stone, shape: Path2D, light: number) {
    const s = this.scale;
    const x = this.cx + stone.x * s;
    const y = this.cy + stone.y * s;
    const near = 1 - Math.abs(stone.x) / 220;
    ctx.save();
    ctx.translate(x, y);
    shade(
      ctx,
      shape,
      { base: '#2c2636', shadow: '#17131e', light: blend('#423a50', '#ef8c50', clamp(light * near, 0, 1)) },
      { x: -stone.x * s, y: -70 * s - stone.y * s },
      4 * s,
      6 * s,
    );
    ctx.restore();
  }
}

// ---- Settings ----

/** `--bg-color`, which the page continues in below the hero. */
const PAGE_BG = '#0f0f13';

/** Fades the bottom of the scene into the page background below the hero. */
export function fadeToPage(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const g = ctx.createLinearGradient(0, height - 70, 0, height);
  g.addColorStop(0, 'rgba(15,15,19,0)');
  g.addColorStop(1, PAGE_BG);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = g;
  ctx.fillRect(0, height - 70, width, 70);
}

/** Pines along a ridgeline, `spacing` px apart on average. */
export function ridgePines(
  path: Path2D,
  width: number,
  baseY: number,
  amp: number,
  freq: number,
  seed: number,
  size: number,
  rand: () => number,
) {
  for (let x = rand() * 20; x < width; x += size * (0.45 + rand() * 0.9)) {
    pine(path, x, ridgeY(x, baseY, amp, freq, seed) + size * 0.15, size * (0.6 + rand() * 0.6), rand);
  }
}

/** Big pines framing both sides of the scene, leaving the middle open. */
export function framingPines(path: Path2D, width: number, ground: number, height: number, rand: () => number) {
  const edge = Math.max(width * 0.2, 90);
  for (const side of [-1, 1]) {
    for (let d = -20; d < edge; d += 26 + rand() * 40) {
      const x = side < 0 ? d : width - d;
      pine(path, x, ground + 8, height * (0.32 + rand() * 0.2) * (1 - d / (edge * 2.2)), rand);
    }
  }
}

/** Ground in front of everything, with a gently rolling top edge. */
export function groundPath(width: number, top: number, bottom: number) {
  const path = new Path2D();
  path.moveTo(0, bottom);
  for (let x = 0; x <= width + 8; x += 8) path.lineTo(x, top + Math.sin(x * 0.006) * 6 + Math.sin(x * 0.017 + 2) * 3);
  path.lineTo(width, bottom);
  path.closePath();
  return path;
}

/** Mountains at dusk: the last light on the horizon behind layered ridges and pines. */
const DUSK: CampfireSetting = {
  paint(ctx, { width, height, scale: s, cy }) {
    const rand = seeded(7);
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#121226');
    sky.addColorStop(0.42, '#211b37');
    sky.addColorStop(0.6, '#43273f');
    sky.addColorStop(0.72, '#6a3543');
    sky.addColorStop(1, '#6a3543');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#f4e3cf';
    for (let i = 0; i < 70; i++) {
      ctx.globalAlpha = 0.15 + rand() * 0.45;
      const size = rand() < 0.1 ? 1.6 : 1;
      ctx.fillRect(rand() * width, rand() ** 1.5 * height * 0.45, size, size);
    }
    ctx.globalAlpha = 1;

    const far = { base: height * 0.66, amp: height * 0.17, freq: 0.0032, seed: 3 };
    ctx.fillStyle = '#3b2843';
    ctx.fill(ridge(width, far.base, far.amp, far.freq, far.seed, height));

    const mid = { base: height * 0.73, amp: height * 0.08, freq: 0.006, seed: 11 };
    const midPath = ridge(width, mid.base, mid.amp, mid.freq, mid.seed, height);
    ridgePines(midPath, width, mid.base, mid.amp, mid.freq, mid.seed, 26 * s, rand);
    ctx.fillStyle = '#2a1e34';
    ctx.fill(midPath);

    const ground = cy - 44 * s;
    const near = new Path2D();
    framingPines(near, width, ground, height, rand);
    ctx.fillStyle = '#1b1526';
    ctx.fill(near);
    ctx.fillStyle = '#16121e';
    ctx.fill(groundPath(width, ground, height));
  },
};

export const classicTheme: FireTheme = {
  id: 'classic',
  label: 'Campfire',
  palette: {
    titleFrom: '#ff9100',
    titleTo: '#ff5f00',
    titleGlow: 'rgba(255, 95, 0, 0.45)',
    ambient: '#2a1a10',
  },
  letters: { knock: 'touch', draggable: true, item: false },
  createRenderer: () => new IllustratedCampfire(DUSK),
};
