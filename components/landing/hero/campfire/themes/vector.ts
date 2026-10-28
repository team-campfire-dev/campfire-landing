import { noise1, noise2 } from '../noise';
import type { FireFrame, FireRenderer, FireTap, FireTheme, HotZone, PointerSample } from '../types';
import { fadeToPage } from './classic';

// An analog oscilloscope. In XY mode a single beam traces the campfire — stones, logs and
// flames — in one continuous line, bright where it moves slowly and faint where it jumps
// between shapes, with the phosphor glowing on behind it. In Y-T mode the screen sweeps the
// fire's flicker as a waveform. A graticule, cursors and read-outs make up the rest of the
// screen.

const PHOSPHOR = '93, 255, 138';
const CORE = '220, 255, 228';
const READOUT = 'rgba(157, 255, 184, 0.85)';
/** How fast the phosphor's afterglow fades, per second. */
const AFTERGLOW = 3.2;
/** Seconds the spot takes to trace the whole fire once in XY mode. */
const TRACE_SECONDS = 0.45;
/** Seconds for one left-to-right sweep in Y-T mode. */
const SWEEP_SECONDS = 0.9;
/** Divisions across and down: 10 × 8, turned to 8 × 10 on portrait screens. */
const DIVS_WIDE = 10;
const DIVS_NARROW = 8;
const MAX_EMBERS = 14;

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

type Point = [number, number];
type Mode = 'xy' | 'yt';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

class Oscilloscope implements FireRenderer {
  /** The phosphor: the beam is drawn here and fades slowly, rather than being cleared each frame. */
  private readonly screen = document.createElement('canvas');
  private embers: Ember[] = [];
  private mode: Mode = 'xy';

  private width = 0;
  private height = 0;
  private scale = 1;
  private dpr = 1;
  private time = 0;
  private dt = 0;
  /** Starts half lit, so the first thing on the screen is a fire rather than a flat line. */
  private ignition = 0.5;
  private boost = 0;
  private wind = 0;
  private flame = 0;
  private pointer: PointerSample | null = null;
  /** Where the spot is along the XY path, in path points. */
  private cursor = 0;
  /** How far across the Y-T sweep is, 0..1, and where each channel's trace last reached. */
  private sweepX = 0;
  private sweepPrev: [Point, Point] | null = null;
  /** The beam's spots right now, drawn bright on top of the afterglow. */
  private spots: Point[] = [];

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.screen.width = Math.max(1, Math.round(width * this.dpr));
    this.screen.height = Math.max(1, Math.round(height * this.dpr));
  }

  hotZone(): HotZone {
    const { x, y, div } = this.fireBase();
    const top = y - (3.4 + Math.min(this.boost, 2)) * div;
    return { x: x - 1.8 * div, y: top, width: 3.6 * div, height: this.height - top };
  }

  tap({ x, y, onLetter }: FireTap) {
    if (onLetter) return;
    // Only the mode button switches to the Y-T sweep; a tap anywhere else stokes the fire.
    const b = this.modeButton();
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      this.mode = this.mode === 'xy' ? 'yt' : 'xy';
      return;
    }
    this.boost = Math.min(this.boost + 0.5, 2);
    for (let i = 0; i < 6; i++) this.ember(1.5);
  }

  /** The XY / Y-T switch in the screen's top-right corner. */
  private modeButton() {
    const r = this.rect();
    const s = Math.max(this.scale, 0.8);
    const w = 64 * s;
    const h = 22 * s;
    return { x: r.x + r.w - w - 6 * s, y: r.y + 6 * s, w, h };
  }

  feed(_x: number, _y: number, fuel: number) {
    this.boost = Math.min(this.boost + 0.8 * fuel, 2);
    for (let i = 0; i < 6; i++) this.ember(2);
  }

  update({ time, dt, pointer }: FireFrame) {
    this.time = time;
    this.dt = dt;
    this.pointer = pointer;
    this.ignition = Math.min(1, this.ignition + dt / 1.5);
    this.boost *= Math.exp(-0.5 * dt);
    const ambient = (noise1(time * 0.35 + 90) - 0.5) * 0.4;
    if (pointer) this.wind += clamp(pointer.vx / 1500, -1.5, 1.5) * dt * 4;
    this.wind += (ambient - this.wind) * Math.min(1, dt * 1.4);
    this.wind = clamp(this.wind, -1.2, 1.2);
    this.flame = this.ignition * (1 + 0.35 * Math.min(this.boost, 2)) * (0.8 + 0.3 * noise1(time * 3));

    if (Math.random() < dt * 2.5 * this.ignition) this.ember(1);
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.age += dt;
      if (e.age >= e.life) {
        this.embers[i] = this.embers[this.embers.length - 1];
        this.embers.pop();
        continue;
      }
      e.vx += this.wind * 0.5 * dt;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const g = this.screen.getContext('2d');
    if (!g) return;
    const { width, height } = this;
    const r = this.rect();

    // Afterglow: take a fraction of every lit pixel away, frame-rate independent.
    const fade = 1 - Math.exp(-Math.max(this.dt, 1 / 240) * AFTERGLOW);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = `rgba(0, 0, 0, ${fade.toFixed(3)})`;
    g.fillRect(0, 0, this.screen.width, this.screen.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.save();
    g.beginPath();
    g.roundRect(r.x, r.y, r.w, r.h, 10 * this.scale);
    g.clip();
    if (this.mode === 'xy') this.traceXY(g, this.firePath());
    else this.traceYT(g);
    g.restore();

    // The instrument: a dark bezel, then the tube face with its phosphor and graticule.
    ctx.fillStyle = '#0c0e0f';
    ctx.fillRect(0, 0, width, height);
    const face = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, 0, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.7);
    face.addColorStop(0, '#071a0f');
    face.addColorStop(1, '#020805');
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 10 * this.scale);
    ctx.fill();
    ctx.drawImage(this.screen, 0, 0, width, height);
    this.drawSpots(ctx);
    this.drawGraticule(ctx);
    this.drawCursor(ctx);
    this.drawReadouts(ctx);
    ctx.strokeStyle = '#2b3033';
    ctx.lineWidth = 5 * this.scale;
    ctx.beginPath();
    ctx.roundRect(r.x - 3 * this.scale, r.y - 3 * this.scale, r.w + 6 * this.scale, r.h + 6 * this.scale, 13 * this.scale);
    ctx.stroke();
    fadeToPage(ctx, width, height);
  }

  // ---- layout ----

  private divs() {
    return this.width >= this.height ? [DIVS_WIDE, DIVS_NARROW] : [DIVS_NARROW, DIVS_WIDE];
  }

  /** The tube face, as large as fits, below the theme dots; `div` is one division. */
  private rect() {
    const s = this.scale;
    const [dx, dy] = this.divs();
    const top = 46 * s;
    const h = Math.min(this.height - top - 40 * s, ((this.width - 24 * s) * dy) / dx);
    const w = (h * dx) / dy;
    return { x: (this.width - w) / 2, y: top, w, h, div: w / dx };
  }

  /** Where the fire stands on the screen, and the size of one division. */
  private fireBase() {
    const r = this.rect();
    return { x: r.x + r.w / 2, y: r.y + r.h - 1.4 * r.div, div: r.div };
  }

  // ---- the beam ----

  /**
   * Strokes beam segments onto the phosphor. Each carries its own brightness: the spot spends
   * the same time on every step of the path, so short steps glow and long jumps barely show.
   */
  private burn(g: CanvasRenderingContext2D, segments: { a: Point; b: Point; bright: number }[]) {
    const s = this.scale;
    const buckets: Path2D[] = Array.from({ length: 6 }, () => new Path2D());
    for (const { a, b, bright } of segments) {
      const k = Math.min(5, Math.floor(clamp(bright, 0, 0.999) * 6));
      buckets[k].moveTo(a[0], a[1]);
      buckets[k].lineTo(b[0], b[1]);
    }
    buckets.forEach((path, k) => {
      const a = (k + 1) / 6;
      g.strokeStyle = `rgba(${PHOSPHOR}, ${(0.18 * a).toFixed(3)})`;
      g.lineWidth = 6 * s;
      g.stroke(path);
      g.strokeStyle = `rgba(${PHOSPHOR}, ${(0.6 * a).toFixed(3)})`;
      g.lineWidth = 2.2 * s;
      g.stroke(path);
      g.strokeStyle = `rgba(${CORE}, ${(0.85 * a).toFixed(3)})`;
      g.lineWidth = 1 * s;
      g.stroke(path);
    });
  }

  /**
   * XY mode: the spot runs along the path at a steady rate in points, going round about twice
   * a second; this frame only burns in the stretch it covered since the last one.
   */
  private traceXY(g: CanvasRenderingContext2D, path: Point[]) {
    const n = path.length - 1;
    if (n < 1) return;
    const s = this.scale;
    const lerp = (i: number, f: number): Point => {
      const [ax, ay] = path[i];
      const [bx, by] = path[i + 1];
      return [ax + (bx - ax) * f, ay + (by - ay) * f];
    };
    let pos = this.cursor % n;
    let left = (n / TRACE_SECONDS) * Math.min(this.dt, 0.05);
    const segments: { a: Point; b: Point; bright: number }[] = [];
    while (left > 1e-6) {
      const i = Math.floor(pos);
      const f = pos - i;
      const step = Math.min(left, 1 - f);
      const [ax, ay] = path[i];
      const [bx, by] = path[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      segments.push({ a: lerp(i, f), b: lerp(i, f + step), bright: clamp((7 * s) / Math.max(len, 0.5), 0.03, 1) });
      pos += step;
      left -= step;
      if (pos >= n) pos -= n;
    }
    this.burn(g, segments);
    this.cursor = pos;
    const i = Math.min(n - 1, Math.floor(pos));
    this.spots = [lerp(i, pos - i)];
  }

  private ellipse(out: Point[], x: number, y: number, rx: number, ry: number, steps = 14) {
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2 + Math.PI;
      out.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry]);
    }
  }

  /** The XY path: stones, logs, then the flames, embers and smoke, all in one line. */
  private firePath(): Point[] {
    const { x: cx, y: cy, div } = this.fireBase();
    const t = this.time;
    const lit = this.flame;
    const path: Point[] = [];

    for (let i = -3; i <= 3; i++) this.ellipse(path, cx + i * 0.78 * div, cy + (0.62 - Math.abs(i) * 0.06) * div, 0.36 * div, 0.2 * div, 12);

    // Two crossed logs: each traced along one side and back along the other.
    for (const dir of [-1, 1]) {
      const ax = cx + dir * 2.1 * div;
      const ay = cy + 0.38 * div;
      const bx = cx - dir * 1.6 * div;
      const by = cy - 0.25 * div;
      const a = Math.atan2(by - ay, bx - ax);
      const nx = -Math.sin(a) * 0.22 * div;
      const ny = Math.cos(a) * 0.22 * div;
      path.push([ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]);
      this.ellipse(path, ax, ay, 0.1 * div, 0.22 * div, 8);
    }

    // Flames: tongue outlines across, then the inner flames back.
    for (const [count, hs, ws, back] of [
      [6, 1, 1, false],
      [4, 0.55, 0.6, true],
    ] as const) {
      const order = Array.from({ length: count }, (_, k) => (back ? count - 1 - k : k));
      for (const k of order) {
        const o = (k / (count - 1)) * 2 - 1;
        const base = cx + o * 1.1 * div * ws;
        const flick = 0.75 + 0.35 * noise1(t * 2.6 + k * 13 + hs * 7);
        const h = (1 - Math.abs(o) ** 1.5 * 0.55) * 3.3 * div * lit * flick * hs;
        const w = 0.5 * div * ws;
        const steps = 10;
        for (let i = 0; i <= steps * 2; i++) {
          const up = i <= steps;
          const u = up ? i / steps : 2 - i / steps;
          const half = w * (1 - u) ** 0.75 * (up ? -1 : 1);
          const sway = (this.wind * 0.5 + (noise1(t * 1.7 + k * 5 + hs) - 0.5)) * h * 0.35 * u * u;
          const wobble = (noise2(k * 3 + u * 4, t * 3) - 0.5) * 0.1 * div * u;
          path.push([base + half + sway + wobble, cy - 0.05 * div - h * u]);
        }
      }
    }

    // Embers as small loops, and a wisp of smoke rising off the top.
    for (const e of this.embers) {
      const k = 1 - e.age / e.life;
      this.ellipse(path, cx + e.x * div, cy - e.y * div, 0.06 * div * k + 0.02 * div, 0.06 * div * k + 0.02 * div, 6);
    }
    for (let i = 0; i <= 16; i++) {
      const u = i / 16;
      path.push([cx + Math.sin(u * 7 + t * 1.5) * 0.25 * div * u + this.wind * 0.8 * div * u, cy - (3.6 + u * 2) * div * Math.max(lit, 0.3)]);
    }
    return path;
  }

  /**
   * Y-T mode: two spots sweep left to right, tracing the fire's flicker on channel 1 and the
   * wind on channel 2, then fly back to the left edge and start again.
   */
  private traceYT(g: CanvasRenderingContext2D) {
    const r = this.rect();
    const div = r.div;
    const mid = r.y + r.h / 2;
    const ch1 = (t: number) =>
      mid - 1.2 * div - ((this.flame - 0.8) * 2.5 + Math.sin(t * Math.PI * 2 * 7.5) * 0.55 * this.flame + (noise2(t * 8, 1) - 0.5) * 0.35) * div;
    const ch2 = (t: number) => mid + 2 * div - (this.wind * 1.2 + Math.sin(t * Math.PI * 2 * 3 + 1) * 0.3) * div;
    const dt = Math.min(this.dt, 0.05);
    const steps = 8;
    const segments: { a: Point; b: Point; bright: number }[] = [];
    for (let k = 1; k <= steps; k++) {
      const t = this.time - dt + (dt * k) / steps;
      const x = this.sweepX + dt / SWEEP_SECONDS / steps;
      if (x >= 1) {
        // Flyback: the beam blanks and jumps back to the left edge.
        this.sweepX = 0;
        this.sweepPrev = null;
        continue;
      }
      this.sweepX = x;
      const px = r.x + x * r.w;
      const next: [Point, Point] = [
        [px, ch1(t)],
        [px, ch2(t)],
      ];
      if (this.sweepPrev) {
        segments.push({ a: this.sweepPrev[0], b: next[0], bright: 0.85 });
        segments.push({ a: this.sweepPrev[1], b: next[1], bright: 0.6 });
      }
      this.sweepPrev = next;
    }
    this.burn(g, segments);
    this.spots = this.sweepPrev ? [this.sweepPrev[0], this.sweepPrev[1]] : [];
  }

  /** The spot itself: a hot white dot with a green bloom, brighter than anything it leaves. */
  private drawSpots(ctx: CanvasRenderingContext2D) {
    const s = this.scale;
    for (const [x, y] of this.spots) {
      const r = 9 * s;
      const bloom = ctx.createRadialGradient(x, y, 0, x, y, r);
      bloom.addColorStop(0, `rgba(${CORE}, 0.9)`);
      bloom.addColorStop(0.3, `rgba(${PHOSPHOR}, 0.45)`);
      bloom.addColorStop(1, `rgba(${PHOSPHOR}, 0)`);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = bloom;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ---- the screen ----

  /** The division grid, with finer ticks along the centre axes. */
  private drawGraticule(ctx: CanvasRenderingContext2D) {
    const r = this.rect();
    const div = r.div;
    const [divsX, divsY] = this.divs();
    ctx.strokeStyle = 'rgba(150, 210, 170, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < divsX; i++) {
      const x = Math.round(r.x + i * div) + 0.5;
      ctx.moveTo(x, r.y);
      ctx.lineTo(x, r.y + r.h);
    }
    for (let i = 1; i < divsY; i++) {
      const y = Math.round(r.y + i * div) + 0.5;
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150, 210, 170, 0.3)';
    ctx.beginPath();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const tick = 4 * this.scale;
    for (let i = 0; i <= divsX * 5; i++) {
      const x = Math.round(r.x + (i * div) / 5) + 0.5;
      ctx.moveTo(x, cy - tick);
      ctx.lineTo(x, cy + tick);
    }
    for (let i = 0; i <= divsY * 5; i++) {
      const y = Math.round(r.y + (i * div) / 5) + 0.5;
      ctx.moveTo(cx - tick, y);
      ctx.lineTo(cx + tick, y);
    }
    ctx.stroke();
  }

  /** Measurement cursors at the pointer: dashed lines and their values. */
  private drawCursor(ctx: CanvasRenderingContext2D) {
    const p = this.pointer;
    const r = this.rect();
    if (!p || p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) return;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255, 210, 120, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, r.y);
    ctx.lineTo(p.x, r.y + r.h);
    ctx.moveTo(r.x, p.y);
    ctx.lineTo(r.x + r.w, p.y);
    ctx.stroke();
    ctx.restore();
  }

  /** Channel settings, mode, trigger and measurements along the screen's edges. */
  private drawReadouts(ctx: CanvasRenderingContext2D) {
    const r = this.rect();
    const s = Math.max(this.scale, 0.8);
    const pad = 8 * s;
    const div = r.div;
    ctx.font = `500 ${Math.round(11 * s)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = READOUT;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(this.mode === 'xy' ? 'CH1(X) 0.5V/div  CH2(Y) 0.5V/div' : 'CH1 0.5V/div  CH2 0.2V/div', r.x + pad, r.y + pad);
    // The mode button, and the timebase or "RUN" beside it.
    const b = this.modeButton();
    ctx.strokeStyle = 'rgba(157, 255, 184, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.mode === 'xy' ? 'XY ▸ Y-T' : 'Y-T ▸ XY', b.x + b.w / 2, b.y + b.h / 2);
    ctx.textAlign = 'right';
    ctx.fillText(this.mode === 'xy' ? 'RUN' : '100ms/div  RUN', b.x - pad, b.y + b.h / 2);
    ctx.textBaseline = 'top';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('Trig ↗ CH1  0.00V', r.x + pad, r.y + r.h - pad);
    // Measurements from the fire itself: flame height as volts, flicker as frequency.
    const vpp = (3.3 * this.flame * 0.5).toFixed(2);
    const freq = (2.6 / (Math.PI * 2) * 10 * (0.9 + 0.2 * noise1(this.time * 0.5))).toFixed(1);
    ctx.textAlign = 'right';
    const p = this.pointer;
    const inside = p && p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
    if (inside && p) {
      const vx = (((p.x - (r.x + r.w / 2)) / div) * 0.5).toFixed(2);
      const vy = (((r.y + r.h / 2 - p.y) / div) * 0.5).toFixed(2);
      ctx.fillText(`X ${vx}V  Y ${vy}V`, r.x + r.w - pad, r.y + r.h - pad);
    } else {
      ctx.fillText(`Vpp ${vpp}V  f ${freq}Hz`, r.x + r.w - pad, r.y + r.h - pad);
    }
  }

  private ember(power: number) {
    if (this.embers.length >= MAX_EMBERS) return;
    // In divisions, relative to the fire's base.
    this.embers.push({ x: rand(-0.6, 0.6), y: rand(1.5, 2.5), vx: rand(-0.3, 0.3), vy: rand(0.6, 1.2) * power, age: 0, life: rand(1, 2) });
  }
}

export const vectorTheme: FireTheme = {
  id: 'vector',
  label: 'Oscilloscope',
  palette: {
    titleFrom: '#e2ffe9',
    titleTo: '#5dff8a',
    titleGlow: 'rgba(93, 255, 138, 0.55)',
    ambient: '#0c0e0f',
  },
  letters: { knock: 'touch', draggable: true, item: false },
  createRenderer: () => new Oscilloscope(),
};
