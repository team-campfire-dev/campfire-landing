import { hash, noise1 } from '../noise';
import type { FireFrame, FireRenderer, FireTap, FireTheme, HotZone, PointerSample } from '../types';

/** What differs between the regular and the soul campfire. */
interface CampfireVariant {
  /** Flame colors: edge, outer, inner, core. */
  flames: [string, string, string, string];
  /** Glowing bed between the logs. */
  bed: string[];
  spark: string;
  /** RGB of the light the fire casts. */
  light: [number, number, number];
  /** Brightest light level (the soul campfire is dimmer). */
  lightLevel: number;
}

const CAMPFIRE: CampfireVariant = {
  flames: ['#b3360b', '#f0720f', '#ffb41f', '#fff0b0'],
  bed: ['#ff9a1f', '#ffcf3a', '#e8641a', '#b8420e'],
  spark: '#ffb43a',
  light: [255, 150, 60],
  lightLevel: 15,
};

const SOUL_CAMPFIRE: CampfireVariant = {
  flames: ['#0c5d7a', '#1597b8', '#3fd2ea', '#c4f8ff'],
  bed: ['#3fd8f0', '#a0f4ff', '#1aa6c8', '#0f6f8f'],
  spark: '#7fe9ff',
  light: [80, 200, 255],
  lightLevel: 10,
};

const ASH = ['#3a3a3a', '#2e2e2e', '#454545', '#262626'];
const BARK = ['#5b4129', '#4a3421', '#6b4e31', '#3d2b1b'];
const WOOD = ['#b8945f', '#9c7a4a'];
const GRASS = ['#5d9c3a', '#6fb043', '#4f8a30'];
const DIRT = ['#8a5a3c', '#79503a', '#6b4630', '#5a3a28'];

const BLOCK = 16;
const GROUND_ROWS = 5;
const LOG_ROWS = 8;
const FLAME_ROWS = 20;
/** Block row the flames rise from — behind the front log, which hides their base. */
const FLAME_BASE = 5;
/** Block textures animate at a chunky rate rather than every frame. */
const TEXTURE_FPS = 9;
const MAX_SMOKE = 40;

type RGBA = [number, number, number, number];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  shade: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const CLEAR: RGBA = [0, 0, 0, 0];

function rgba(hex: string, brightness = 1): RGBA {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) * brightness, ((n >> 8) & 255) * brightness, (n & 255) * brightness, 255];
}

const pick = (colors: string[], h: number, brightness = 1) =>
  rgba(colors[Math.min(colors.length - 1, (h * colors.length) | 0)], brightness);

/** Minecraft's light curve: brightness falls off steeply at low light levels. */
function lightCurve(level: number) {
  const r = clamp(level, 0, 15) / 15;
  return Math.max(0.05, r / (4 - 3 * r));
}

/** Small offscreen canvas painted one texel per pixel, then scaled up without smoothing. */
class Texture {
  readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d');
  private image: ImageData | null = null;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  paint(color: (x: number, y: number) => RGBA) {
    const { ctx } = this;
    if (!ctx) return;
    this.image ??= ctx.createImageData(this.width, this.height);
    const data = this.image.data;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const [r, g, b, a] = color(x, y);
        const i = (y * this.width + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = a;
      }
    }
    ctx.putImageData(this.image, 0, 0);
  }
}

/**
 * Minecraft-style flame texture: a few pointed tongues with a light core and dark edge,
 * re-drawn every animation frame so the tongues flicker and climb.
 */
function paintFlames(
  tex: Texture,
  colors: [string, string, string, string],
  frame: number,
  lean: number,
  grow: number,
  mirror: boolean,
  brightness = 1,
) {
  const [edge, outer, inner, core] = colors.map((c) => rgba(c, brightness));
  const tongues = [3.5, 6.5, 9.5, 12.5].map((cx, k) => ({
    cx: cx + (hash(k, frame) - 0.5) * 1.4,
    height: (k === 1 || k === 2 ? 11 : 8) + hash(k + 11, frame) * 5 + grow,
    width: 2.1 + hash(k + 23, frame) * 1.1,
  }));
  tex.paint((px, y) => {
    const x = mirror ? tex.width - 1 - px : px;
    const up = tex.height - 1 - y;
    let heat = up < 3 ? 0.85 - up * 0.12 : 0;
    for (const [k, t] of tongues.entries()) {
      const rel = up / t.height;
      if (rel >= 1) continue;
      const sway = Math.sin(up * 0.6 + frame * 1.3 + k * 2) * 0.5 + (mirror ? -lean : lean) * up * 0.12;
      const half = t.width * (1 - rel) ** 0.8 + 0.35;
      const d = Math.abs(x + 0.5 - (t.cx + sway));
      if (d < half) heat = Math.max(heat, 1 - (d / half) * 0.55 - rel * 0.45);
    }
    // Loose flecks above the tongues.
    if (heat === 0 && up > 9 && hash(x * 5 + (up - frame) * 3, frame) > 0.965) heat = 0.35;
    if (heat <= 0) return CLEAR;
    if (heat > 0.78) return core;
    if (heat > 0.58) return inner;
    if (heat > 0.38) return outer;
    return edge;
  });
}

class BlockCampfire implements FireRenderer {
  // Two flame layers, like Minecraft's crossed flame planes seen from the front.
  private readonly flamesFront = new Texture(BLOCK, FLAME_ROWS);
  private readonly flamesBack = new Texture(BLOCK, FLAME_ROWS);
  private readonly logs = new Texture(BLOCK, LOG_ROWS);
  private ground: Texture | null = null;
  private smoke: Particle[] = [];
  private sparks: Particle[] = [];

  private width = 0;
  private height = 0;
  private texel = 8;
  /** Left edge of the campfire block and top of the ground, in px. */
  private blockX = 0;
  private groundTop = 0;

  private time = 0;
  private frame = -1;
  private lit = true;
  /** 0 = out, 1 = fully lit; eases between the two. */
  private glow = 0;
  private boost = 0;
  private wind = 0;
  private smokeDebt = 0;
  private sparkDebt = 0;

  constructor(private readonly variant: CampfireVariant) {}

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    const scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    this.texel = Math.max(4, Math.round(9 * scale));
    this.groundTop = height - GROUND_ROWS * this.texel;
    this.blockX = Math.round(width / 2 - (BLOCK / 2) * this.texel);
    this.ground = new Texture(Math.ceil(width / this.texel) + 1, GROUND_ROWS);
  }

  hotZone(): HotZone | null {
    if (!this.lit) return null;
    const t = this.texel;
    return { x: this.blockX - t, y: this.groundTop - 20 * t, width: (BLOCK + 2) * t, height: 20 * t };
  }

  groundY() {
    return this.groundTop;
  }

  tap({ onFire, onLetter, x, y }: FireTap) {
    if (onLetter) return;
    const t = this.texel;
    const onBlock =
      x >= this.blockX && x <= this.blockX + BLOCK * t && y >= this.groundTop - LOG_ROWS * t && y <= this.groundTop;
    if (!onFire && !onBlock) return;

    // Like a shovel and flint & steel: click to put the campfire out, click again to relight it.
    this.lit = !this.lit;
    const cx = this.blockX + (BLOCK / 2) * t;
    if (this.lit) {
      for (let i = 0; i < 16; i++) this.spark(cx + rand(-3, 3) * t, this.groundTop - 3 * t, 1.2);
    } else {
      for (let i = 0; i < 10; i++) this.puff(cx + rand(-5, 5) * t, this.groundTop - rand(2, 8) * t, rand(-30, 30));
    }
  }

  feed(x: number, y: number, fuel: number) {
    this.boost = Math.min(this.boost + 0.8 * fuel, 2);
    for (let i = 0; i < 18 * fuel; i++) this.spark(x, y, 1.3);
    for (let i = 0; i < 4 * fuel; i++) this.puff(x, y, rand(-20, 20));
  }

  update({ time, dt, pointer }: FireFrame) {
    this.time = time;
    this.glow += ((this.lit ? 1 : 0) - this.glow) * Math.min(1, dt * 3);
    this.boost *= Math.exp(-0.5 * dt);

    const ambient = (noise1(time * 0.25 + 3) - 0.5) * 0.6;
    if (pointer) this.wind += clamp(pointer.vx / 1200, -1.5, 1.5) * dt * 4;
    this.wind += (ambient - this.wind) * Math.min(1, dt);
    this.wind = clamp(this.wind, -1.5, 1.5);

    const frame = Math.floor(time * TEXTURE_FPS);
    if (frame !== this.frame) {
      this.frame = frame;
      const lean = clamp(this.wind, -1, 1);
      const grow = 3 * Math.min(this.boost, 1.5);
      paintFlames(this.flamesFront, this.variant.flames, frame, lean, grow, false);
      // The back layer runs out of step, mirrored and dimmer, so the front tongues read in front of it.
      paintFlames(this.flamesBack, this.variant.flames, frame + 5, lean, grow, true, 0.7);
    }

    const t = this.texel;
    const cx = this.blockX + (BLOCK / 2) * t;
    this.smokeDebt += (this.lit ? 1.3 + this.boost : 0) * dt;
    while (this.smokeDebt >= 1) {
      this.smokeDebt -= 1;
      this.puff(cx + rand(-4, 4) * t, this.groundTop - rand(16, 19) * t, 0);
    }
    this.sparkDebt += (this.lit ? 0.7 + 3 * this.boost : 0) * dt;
    while (this.sparkDebt >= 1) {
      this.sparkDebt -= 1;
      this.spark(cx + rand(-3, 3) * t, this.groundTop - rand(6, 11) * t, 1);
    }

    this.stepSmoke(dt, pointer);
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.sparks[i] = this.sparks[this.sparks.length - 1];
        this.sparks.pop();
        continue;
      }
      p.vy += 80 * t * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const t = this.texel;
    const cx = this.blockX + (BLOCK / 2) * t;
    const cy = this.groundTop - 6 * t;
    const [lr, lg, lb] = this.variant.light;
    const flicker = 0.85 + 0.15 * noise1(this.time * 5);

    // Light falls off in hard steps, like Minecraft's light levels.
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgb(${lr},${lg},${lb})`;
    for (let level = 1; level <= 8; level++) {
      ctx.globalAlpha = 0.024 * this.glow * flicker * (this.variant.lightLevel / 15);
      ctx.beginPath();
      ctx.arc(cx, cy, (9 - level) * 8 * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    this.drawSmoke(ctx);

    ctx.imageSmoothingEnabled = false;
    this.drawGround(ctx, cx, cy, flicker);
    if (this.glow > 0.05) {
      const top = this.groundTop - (FLAME_ROWS + FLAME_BASE) * t;
      ctx.globalAlpha = Math.min(1, this.glow * 1.5);
      ctx.drawImage(this.flamesBack.canvas, this.blockX, top, BLOCK * t, FLAME_ROWS * t);
      ctx.drawImage(this.flamesFront.canvas, this.blockX, top, BLOCK * t, FLAME_ROWS * t);
      ctx.globalAlpha = 1;
    }
    this.drawLogs(ctx);
    ctx.imageSmoothingEnabled = true;

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = this.variant.spark;
    for (const p of this.sparks) {
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawGround(ctx: CanvasRenderingContext2D, cx: number, cy: number, flicker: number) {
    const { ground } = this;
    if (!ground) return;
    const t = this.texel;
    const offset = Math.ceil(this.blockX / t);
    const originX = this.blockX - offset * t;
    const maxLevel = this.variant.lightLevel * this.glow;
    ground.paint((x, y) => {
      const h = hash(x - offset, y);
      const grass = y === 0 || (y === 1 && h > 0.35) || (y === 2 && h > 0.85);
      const px = originX + (x + 0.5) * t;
      const py = this.groundTop + (y + 0.5) * t;
      const level = Math.floor(maxLevel * flicker - Math.hypot(px - cx, py - cy) / (t * 9));
      return pick(grass ? GRASS : DIRT, h, lightCurve(level));
    });
    ctx.drawImage(ground.canvas, originX, this.groundTop, ground.width * t, GROUND_ROWS * t);
  }

  private drawLogs(ctx: CanvasRenderingContext2D) {
    const { bed } = this.variant;
    const b = Math.max(lightCurve(this.variant.lightLevel * this.glow), 0.5);
    const step = Math.floor(this.time * 6);
    this.logs.paint((x, y) => {
      const row = LOG_ROWS - 1 - y;
      if (row >= 4) {
        // Top log lying across the front; grain runs along it.
        const h = hash(Math.floor(x / 3) + row * 7, row);
        return rgba(row === 7 ? BARK[2] : row === 4 ? BARK[3] : BARK[(h * 2) | 0], b);
      }
      if ((x >= 1 && x <= 4) || (x >= 11 && x <= 14)) {
        // Cut ends of the two bottom logs.
        const edge = x === 1 || x === 4 || x === 11 || x === 14 || row === 0 || row === 3;
        return rgba(edge ? BARK[1] : WOOD[(x + row) % 2], b);
      }
      if (x >= 5 && x <= 10 && row <= 1) {
        const h = hash(x * 3 + row, step);
        return this.lit ? pick(bed, h) : pick(ASH, h, b);
      }
      return CLEAR;
    });
    const t = this.texel;
    ctx.drawImage(this.logs.canvas, this.blockX, this.groundTop - LOG_ROWS * t, BLOCK * t, LOG_ROWS * t);
  }

  private stepSmoke(dt: number, pointer: PointerSample | null) {
    const t = this.texel;
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.age += dt;
      if (p.age >= p.life || p.y < -p.size) {
        this.smoke[i] = this.smoke[this.smoke.length - 1];
        this.smoke.pop();
        continue;
      }
      p.vx += (this.wind * 5 * t - p.vx) * dt * 0.8;
      if (pointer) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const d = Math.hypot(dx, dy);
        const r = 10 * t;
        if (d < r && d > 0) {
          p.vx += (dx / d) * (1 - d / r) * 900 * dt;
          p.vy += (dy / d) * (1 - d / r) * 300 * dt;
        }
      }
      p.vy += (-(t * 5) - p.vy) * dt * 0.5;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  private drawSmoke(ctx: CanvasRenderingContext2D) {
    for (const p of this.smoke) {
      const k = p.age / p.life;
      const alpha = Math.min(1, p.age / 0.6) * (k > 0.6 ? (1 - k) / 0.4 : 1) * 0.38;
      const shade = (140 + p.shade * 60) | 0;
      const size = p.size * (1 + 0.6 * k);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
    }
    ctx.globalAlpha = 1;
  }

  private puff(x: number, y: number, vx: number) {
    if (this.smoke.length >= MAX_SMOKE) return;
    const t = this.texel;
    this.smoke.push({ x, y, vx, vy: -rand(3, 6) * t, age: 0, life: rand(7, 10), size: Math.round(rand(1.5, 2.5) * t), shade: Math.random() });
  }

  private spark(x: number, y: number, power: number) {
    const t = this.texel;
    this.sparks.push({
      x,
      y,
      vx: rand(-10, 10) * t * power,
      vy: -rand(25, 45) * t * power,
      age: 0,
      life: rand(0.8, 1.4),
      size: Math.max(2, Math.round(t * 0.5)),
      shade: 0,
    });
  }
}

const itemLetters = { knock: 'touch', draggable: true, item: true } as const;

export const minecraftTheme: FireTheme = {
  id: 'minecraft',
  label: 'Minecraft',
  palette: {
    titleFrom: '#ffe27a',
    titleTo: '#ff9b2e',
    titleGlow: 'rgba(255, 170, 60, 0.35)',
    ambient: '#1c160d',
  },
  letters: itemLetters,
  createRenderer: () => new BlockCampfire(CAMPFIRE),
};

export const soulCampfireTheme: FireTheme = {
  id: 'soul',
  label: 'Soul',
  palette: {
    titleFrom: '#c9f6ff',
    titleTo: '#3cc8dc',
    titleGlow: 'rgba(70, 210, 240, 0.4)',
    ambient: '#0a1a1e',
  },
  letters: itemLetters,
  createRenderer: () => new BlockCampfire(SOUL_CAMPFIRE),
};
