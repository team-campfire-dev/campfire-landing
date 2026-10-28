import { noise1, noise2 } from '../noise';
import { PixelFire } from '../pixelFire';
import type { FireFrame, FireRenderer, FireTap, FireTheme, HotZone } from '../types';

/** Coolest to hottest; heat 0 draws nothing. */
const RAMP = '.:-=+*#%@';
/** Terminal fire colors along the heat range, as [position, #rrggbb]. */
const COLOR_STOPS: [number, string][] = [
  [0, '#3a0d08'],
  [0.25, '#8f1d0b'],
  [0.45, '#d4380d'],
  [0.65, '#f08a24'],
  [0.85, '#ffd166'],
  [1, '#fff8e0'],
];
/** Also the tallest the fire gets in rows, since heat drops by at most one per row. */
const MAX_HEAT = 16;
/** The fire spreads at a steady, slightly choppy terminal rate. */
const TIC = 1 / 30;
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
/** Rows under the fire grid taken up by the ASCII log pile. */
const LOG_ROWS = 2;
const MAX_GLYPHS = 48;
const MAX_SPARKS = 160;
const SPARK_CHARS = ".'`*";
const PROMPT = 'campfire:~$ ';
const HINT = 'type to add fuel';

/** A typed character falling into the fire. */
interface Glyph {
  char: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
}

interface Spark {
  char: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function heatColor(t: number) {
  let i = 1;
  while (i < COLOR_STOPS.length - 1 && COLOR_STOPS[i][0] < t) i++;
  const [p0, c0] = COLOR_STOPS[i - 1];
  const [p1, c1] = COLOR_STOPS[i];
  const k = clamp((t - p0) / (p1 - p0), 0, 1);
  const a = parseInt(c0.slice(1), 16);
  const b = parseInt(c1.slice(1), 16);
  const mix = (shift: number) => Math.round(((a >> shift) & 255) * (1 - k) + ((b >> shift) & 255) * k);
  return `rgb(${mix(16)},${mix(8)},${mix(0)})`;
}

/** Keys typed into a text field belong to that field, not the fire. */
function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || !!target.closest('input, textarea, select, [contenteditable]');
}

/**
 * A terminal fire in the spirit of aafire: the DOOM heat grid drawn as text, one character per
 * cell. Typed keys drop into the fire as fuel.
 */
class AsciiFire implements FireRenderer {
  private readonly fire = new PixelFire(1, 1, MAX_HEAT);
  /** One pre-rendered glyph per heat level, side by side, so a frame is just blits. */
  private atlas: HTMLCanvasElement | null = null;
  private atlasScale = 1;
  private glyphs: Glyph[] = [];
  private sparks: Spark[] = [];
  private readonly canType =
    typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  private width = 0;
  private height = 0;
  private scale = 1;
  private fontSize = 13;
  private cellW = 8;
  private cellH = 13;
  private time = 0;
  private ignition = 0;
  private boost = 0;
  private wind = 0;
  private tics = 0;
  private sparkDebt = 0;
  private typed = 0;
  /** Wall time of the last frame; keys are ignored while the hero is off-screen and paused. */
  private lastFrame = 0;
  private pointer: FireFrame['pointer'] = null;
  private cursorStill = 0;

  constructor() {
    window.addEventListener('keydown', this.onKey);
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    this.fontSize = clamp(Math.round(13 * this.scale), 10, 16);
    this.buildAtlas();
    const rows = Math.max(4, Math.ceil((height * 0.85) / this.cellH) - LOG_ROWS);
    this.fire.resize(Math.ceil(width / this.cellW), rows);
  }

  hotZone(): HotZone {
    const half = this.baseHalfWidth() * 1.15;
    const top = this.fireBottom() - this.flameHeight() * 0.5;
    return { x: this.width / 2 - half, y: top, width: half * 2, height: this.height - top };
  }

  tap({ x, y }: FireTap) {
    // Taps in the flames stoke them; elsewhere they only throw sparks — a lone blob of heat
    // in mid-air reads as a glitch, not fire.
    if (y > this.fireBottom() - this.flameHeight()) this.flare(x, y, 3, 0.15);
    else for (let i = 0; i < 6; i++) this.spark(x, y, 1.6);
  }

  feed(x: number, y: number, fuel: number) {
    this.boost = Math.min(this.boost + 0.5 * fuel, 1.5);
    this.flare(x, Math.max(y, this.fireBottom() - this.flameHeight() * 0.3), 5, 0);
  }

  update({ time, dt, pointer }: FireFrame) {
    this.time = time;
    this.lastFrame = performance.now();
    this.ignition = Math.min(1, this.ignition + dt / 1.5);
    this.boost *= Math.exp(-0.45 * dt);

    const moving = !!pointer && Math.hypot(pointer.vx, pointer.vy) > 20;
    this.cursorStill = moving ? 0 : this.cursorStill + dt;
    this.pointer = pointer;

    const ambient = (noise1(time * 0.3 + 3) - 0.5) * 0.3;
    if (pointer) this.wind += clamp(pointer.vx / 1800, -1, 1) * dt * 5;
    this.wind += (ambient - this.wind) * Math.min(1, dt * 1.5);
    this.wind = clamp(this.wind, -0.8, 0.8);

    this.tics += dt;
    while (this.tics >= TIC) {
      this.tics -= TIC;
      this.tic();
    }

    // Sparks drift off the flame tips.
    this.sparkDebt += 7 * this.ignition * (1 + 2 * this.boost) * dt;
    while (this.sparkDebt >= 1) {
      this.sparkDebt -= 1;
      const half = this.baseHalfWidth() * 0.7;
      this.spark(this.width / 2 + rand(-half, half), this.fireBottom() - this.flameHeight() * rand(0.4, 0.9));
    }

    const gravity = 900 * this.scale;
    const hot = this.hotZone();
    for (let i = this.glyphs.length - 1; i >= 0; i--) {
      const g = this.glyphs[i];
      g.vy += gravity * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.angle += g.spin * dt;
      if (g.y >= hot.y + hot.height * 0.15) {
        this.glyphs[i] = this.glyphs[this.glyphs.length - 1];
        this.glyphs.pop();
        this.boost = Math.min(this.boost + 0.08, 1.5);
        this.flare(g.x, g.y, 2, 0);
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      if (s.age >= s.life) {
        this.sparks[i] = this.sparks[this.sparks.length - 1];
        this.sparks.pop();
        continue;
      }
      s.vx += this.wind * 120 * dt;
      s.vx *= 1 - 1.5 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { width, height, cellW, cellH, atlas } = this;
    const cx = width / 2;
    const base = this.fireBottom();

    // Firelight.
    ctx.globalCompositeOperation = 'lighter';
    const strength = this.ignition * (0.8 + 0.2 * noise1(this.time * 5)) * (1 + 0.5 * this.boost);
    const r = Math.max(width, height) * 0.45;
    const light = ctx.createRadialGradient(cx, base, 0, cx, base, r);
    light.addColorStop(0, `rgba(255,110,30,${Math.min(1, 0.2 * strength).toFixed(3)})`);
    light.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';

    if (atlas) {
      const { cells, width: cols, height: rows } = this.fire;
      const top = this.fireTop();
      const s = this.atlasScale;
      for (let y = 0; y < rows; y++) {
        const row = y * cols;
        for (let x = 0; x < cols; x++) {
          const heat = cells[row + x];
          if (heat === 0) continue;
          ctx.drawImage(atlas, (heat - 1) * cellW * s, 0, cellW * s, cellH * s, x * cellW, top + y * cellH, cellW, cellH);
        }
      }
    }

    this.drawLogs(ctx, cx, base);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${this.fontSize}px ${FONT}`;
    for (const s of this.sparks) {
      const t = s.age / s.life;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = heatColor(0.95 - 0.6 * t);
      ctx.fillText(s.char, s.x, s.y);
    }
    ctx.globalAlpha = 1;

    ctx.font = `700 ${Math.round(this.fontSize * 1.6)}px ${FONT}`;
    ctx.fillStyle = '#f3ead8';
    for (const g of this.glyphs) {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.angle);
      ctx.fillText(g.char, 0, 0);
      ctx.restore();
    }

    this.drawCursor(ctx);
    this.drawPrompt(ctx);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || isEditable(e.target)) return;
    if (performance.now() - this.lastFrame > 250) return;
    if (e.key === 'Enter') {
      this.boost = Math.min(this.boost + 0.5, 1.5);
      this.flare(this.width / 2, this.fireBottom() - this.cellH * 2, 6, 0);
      this.typed++;
      return;
    }
    if (e.key.length !== 1 || e.key.trim() === '') return;
    if (this.glyphs.length >= MAX_GLYPHS) this.glyphs.shift();
    const half = this.baseHalfWidth() * 0.8;
    this.glyphs.push({
      char: e.key,
      x: this.width / 2 + rand(-half, half),
      y: -this.fontSize,
      vx: rand(-30, 30) * this.scale,
      vy: rand(0, 120) * this.scale,
      spin: rand(-4, 4),
      angle: 0,
    });
    this.typed++;
  };

  private tic() {
    const { fire } = this;
    const cx = fire.width / 2;
    const half = this.baseHalfWidth() / this.cellW;
    // Cooler towards the edges and patchy along the bed, so the flames taper into tongues.
    fire.setSource((x) => {
      const d = Math.abs(x + 0.5 - cx) / half;
      if (d >= 1) return 0;
      const patch = 0.55 + 0.45 * noise2(x * 0.35, this.time * 1.5);
      return MAX_HEAT * this.ignition * (1 - d * d) * patch * rand(0.85, 1);
    });
    const rows = this.flameHeight() / this.cellH;
    fire.step(clamp(MAX_HEAT / rows, 0.15, 1), this.wind);
  }

  /** Heat burst at a canvas point, plus a handful of sparks. */
  private flare(x: number, y: number, radius: number, boost: number) {
    this.boost = Math.min(this.boost + boost, 1.5);
    const gy = (y - this.fireTop()) / this.cellH;
    if (gy > 0) this.fire.heat(x / this.cellW, gy, radius, MAX_HEAT);
    for (let i = 0; i < radius * 2; i++) this.spark(x, y, 1.6);
  }

  private spark(x: number, y: number, speed = 1) {
    if (this.sparks.length >= MAX_SPARKS) return;
    this.sparks.push({
      char: SPARK_CHARS[(Math.random() * SPARK_CHARS.length) | 0],
      x,
      y,
      vx: rand(-40, 40) * speed * this.scale,
      vy: -rand(50, 140) * speed * this.scale,
      age: 0,
      life: rand(0.6, 1.4),
    });
  }

  private drawLogs(ctx: CanvasRenderingContext2D, cx: number, base: number) {
    const cols = Math.max(4, Math.round((this.baseHalfWidth() * 2) / this.cellW));
    const sticks = '/\\'.repeat(Math.ceil(cols / 2)).slice(0, cols);
    const log = `(${'='.repeat(cols - 2)})`;
    ctx.font = `600 ${this.fontSize}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#b4582a';
    ctx.fillText(sticks, cx, base);
    ctx.fillStyle = '#7a4520';
    ctx.fillText(log, cx, base + this.cellH);
  }

  /** A terminal block cursor under the mouse: solid while moving, blinking once it rests. */
  private drawCursor(ctx: CanvasRenderingContext2D) {
    const p = this.pointer;
    if (!p || !this.canType) return;
    if (this.cursorStill > 0.5 && Math.floor(this.time * 2) % 2 === 1) return;
    const x = Math.floor(p.x / this.cellW) * this.cellW;
    const y = Math.floor((p.y - this.fireTop()) / this.cellH) * this.cellH + this.fireTop();
    ctx.fillStyle = 'rgba(255, 214, 150, 0.55)';
    ctx.fillRect(x, y, this.cellW, this.cellH);
  }

  /** Tells keyboard users they can type; fades once they have. */
  private drawPrompt(ctx: CanvasRenderingContext2D) {
    if (!this.canType) return;
    const alpha = this.typed === 0 ? 0.55 : Math.max(0, 0.55 - this.typed * 0.08);
    if (alpha <= 0) return;
    const size = Math.max(11, Math.round(this.fontSize * 0.95));
    const margin = 20;
    ctx.font = `500 ${size}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#9fe870';
    ctx.fillText(PROMPT, margin, this.height - margin);
    const promptWidth = ctx.measureText(PROMPT).width;
    ctx.fillStyle = '#e8dcc8';
    ctx.fillText(HINT, margin + promptWidth, this.height - margin);
    if (Math.floor(this.time * 2) % 2 === 0) {
      const hintWidth = ctx.measureText(HINT).width;
      ctx.fillRect(margin + promptWidth + hintWidth + 2, this.height - margin - size, size * 0.6, size);
    }
    ctx.globalAlpha = 1;
  }

  private buildAtlas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const font = `600 ${this.fontSize}px ${FONT}`;
    const canvas = this.atlas ?? document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = font;
    this.cellW = Math.ceil(ctx.measureText('M').width);
    this.cellH = Math.round(this.fontSize * 1.05);
    this.atlasScale = dpr;
    canvas.width = Math.ceil(this.cellW * MAX_HEAT * dpr);
    canvas.height = Math.ceil(this.cellH * dpr);
    // Resizing resets the context state.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let heat = 1; heat <= MAX_HEAT; heat++) {
      const t = heat / MAX_HEAT;
      ctx.fillStyle = heatColor(t);
      ctx.fillText(RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))], (heat - 0.5) * this.cellW, this.cellH / 2);
    }
    this.atlas = canvas;
  }

  /** Half the width of the fire bed in px. */
  private baseHalfWidth() {
    return clamp(this.width * 0.2, 110, 260) * (1 + 0.1 * this.boost);
  }

  private fireBottom() {
    return this.height - LOG_ROWS * this.cellH;
  }

  private fireTop() {
    return this.fireBottom() - this.fire.height * this.cellH;
  }

  /** Typical flame height in px; grows when the fire is fed. */
  private flameHeight() {
    return Math.min(this.height * 0.32 * (1 + 0.45 * this.boost), this.fire.height * this.cellH * 0.8);
  }
}

export const asciiTheme: FireTheme = {
  id: 'ascii',
  label: 'ASCII',
  palette: {
    titleFrom: '#fff1c1',
    titleTo: '#f08a24',
    titleGlow: 'rgba(255, 140, 40, 0.4)',
    ambient: '#1c120b',
  },
  letters: { knock: 'touch', draggable: true, item: false },
  createRenderer: () => new AsciiFire(),
};
