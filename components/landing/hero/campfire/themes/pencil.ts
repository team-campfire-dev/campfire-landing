import { noise1 } from '../noise';
import { Backdrop, seeded } from '../illustration';
import type { FireFrame, FireRenderer, FireTap, FireTheme, HotZone } from '../types';
import { fadeToPage } from './classic';

// A campfire doodled in pencil on a page of a lined notebook, animated a few drawings a second
// so the lines boil like a flip-book. Clicking rubs part of it out with an eraser; a moment
// later the pencil draws it back in.

/** Drawings per second — the flip-book rate. */
const FPS = 8;
const GRAPHITE = 'rgba(52, 52, 62, 0.82)';
const RUB_SECONDS = 0.5;
const HOLD_SECONDS = 0.7;
const REDRAW_SECONDS = 1.4;
const MAX_CRUMBS = 60;

/** A patch rubbed out by the eraser, healing as the pencil draws it back in. */
interface Erased {
  x: number;
  y: number;
  r: number;
  age: number;
}

interface Crumb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  size: number;
}

type Point = [number, number];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

class PencilDoodle implements FireRenderer {
  private readonly paper = new Backdrop();
  /** The drawing itself, so the eraser can cut holes in it and leave the paper. */
  private readonly layer = document.createElement('canvas');
  private erased: Erased[] = [];
  /** The flame outlines as last drawn, for the pencil to keep going over. */
  private outline: Point[] = [];
  private crumbs: Crumb[] = [];

  private width = 0;
  private height = 0;
  private scale = 1;
  private dpr = 1;
  private cx = 0;
  private cy = 0;
  private time = 0;
  private ignition = 0;
  private boost = 0;
  private wind = 0;
  /** The hand-drawn font the title uses, for the margin notes. */
  private hand = 'cursive';

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    this.cx = width / 2;
    this.cy = height - 80 * this.scale;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.layer.width = Math.round(width * this.dpr);
    this.layer.height = Math.round(height * this.dpr);
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-hand').trim();
    if (font) this.hand = font;
    this.paper.paint(width, height, (ctx) => this.paintPaper(ctx));
  }

  hotZone(): HotZone {
    const s = this.scale;
    const top = this.cy - (170 + 60 * Math.min(this.boost, 2)) * s;
    return { x: this.cx - 100 * s, y: top, width: 200 * s, height: this.height - top };
  }

  tap({ x, y, onLetter }: FireTap) {
    if (onLetter) return;
    this.erased.push({ x, y, r: 60 * this.scale, age: 0 });
  }

  feed(_x: number, _y: number, fuel: number) {
    this.boost = Math.min(this.boost + 0.8 * fuel, 2);
  }

  update({ time, dt, pointer }: FireFrame) {
    this.time = time;
    this.ignition = Math.min(1, this.ignition + dt / 1.2);
    this.boost *= Math.exp(-0.5 * dt);
    const ambient = (noise1(time * 0.35 + 90) - 0.5) * 0.4;
    if (pointer) {
      const near = clamp(1 - Math.hypot(pointer.x - this.cx, pointer.y - this.cy) / (340 * this.scale), 0, 1);
      this.wind += clamp(pointer.vx / 1500, -1.5, 1.5) * near * dt * 6;
    }
    this.wind += (ambient - this.wind) * Math.min(1, dt * 1.4);
    this.wind = clamp(this.wind, -1.2, 1.2);

    for (const e of this.erased) {
      e.age += dt;
      // Eraser crumbs while it's rubbing.
      if (e.age < RUB_SECONDS && this.crumbs.length < MAX_CRUMBS && Math.random() < dt * 40) {
        this.crumbs.push({
          x: e.x + rand(-1, 1) * e.r * 0.6,
          y: e.y + rand(-0.3, 0.3) * e.r,
          vx: rand(-40, 40),
          vy: rand(-30, 10),
          age: 0,
          size: rand(1, 2.4) * this.scale,
        });
      }
    }
    this.erased = this.erased.filter((e) => e.age < RUB_SECONDS + HOLD_SECONDS + REDRAW_SECONDS);
    for (let i = this.crumbs.length - 1; i >= 0; i--) {
      const c = this.crumbs[i];
      c.age += dt;
      c.vy += 300 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.age > 1.4 || c.y > this.height) this.crumbs.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const g = this.layer.getContext('2d');
    if (!g) return;
    this.paper.draw(ctx);

    // Redraw the doodle only a few times a second, each time a little differently.
    const frame = Math.floor(this.time * FPS);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.layer.width, this.layer.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    this.drawDoodle(g, frame);

    // Rubbed-out patches: holes in the drawing that close up as the pencil fills them back in.
    g.globalCompositeOperation = 'destination-out';
    for (const e of this.erased) {
      const r = this.erasedRadius(e);
      if (r <= 0) continue;
      const hole = g.createRadialGradient(e.x, e.y, r * 0.7, e.x, e.y, r);
      hole.addColorStop(0, 'rgba(0,0,0,1)');
      hole.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = hole;
      g.fillRect(e.x - r, e.y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.layer, 0, 0, this.width, this.height);

    this.drawTools(ctx, frame);
    fadeToPage(ctx, this.width, this.height);
  }

  // ---- drawing ----

  private erasedRadius(e: Erased) {
    if (e.age < RUB_SECONDS) return e.r * (e.age / RUB_SECONDS);
    if (e.age < RUB_SECONDS + HOLD_SECONDS) return e.r;
    return e.r * (1 - (e.age - RUB_SECONDS - HOLD_SECONDS) / REDRAW_SECONDS);
  }

  /** Lined notebook paper: ruled lines, a red margin, punched holes and a little grain. */
  private paintPaper(ctx: CanvasRenderingContext2D) {
    const { width, height } = this;
    const s = this.scale;
    const rand = seeded(12);
    ctx.fillStyle = '#fbf7ec';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(120, 100, 70, 0.05)';
    for (let i = 0; i < (width * height) / 900; i++) ctx.fillRect(rand() * width, rand() * height, 1, 1);
    const gap = 28 * s;
    ctx.strokeStyle = 'rgba(120, 160, 215, 0.55)';
    ctx.lineWidth = 1;
    for (let y = 70 * s; y < height; y += gap) {
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
      ctx.stroke();
    }
    const margin = Math.max(48 * s, width * 0.08);
    ctx.strokeStyle = 'rgba(225, 120, 120, 0.6)';
    for (const dx of [0, 3]) {
      ctx.beginPath();
      ctx.moveTo(margin + dx + 0.5, 0);
      ctx.lineTo(margin + dx + 0.5, height);
      ctx.stroke();
    }
    for (let k = 0; k < 3; k++) {
      const y = height * (0.2 + k * 0.3);
      ctx.fillStyle = '#e8e1d0';
      ctx.beginPath();
      ctx.arc(margin * 0.42, y, 9 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140, 120, 90, 0.35)';
      ctx.stroke();
    }
  }

  /** A pencil line: the path drawn twice with a shaky hand, overshooting a little at the ends. */
  private sketch(g: CanvasRenderingContext2D, points: Point[], rand: () => number, width = 1.3, color = GRAPHITE) {
    const s = this.scale;
    g.strokeStyle = color;
    for (let pass = 0; pass < 2; pass++) {
      g.lineWidth = width * s * (pass ? 0.7 : 1);
      g.beginPath();
      points.forEach(([x, y], i) => {
        const jx = (rand() - 0.5) * 2.2 * s;
        const jy = (rand() - 0.5) * 2.2 * s;
        if (i === 0) g.moveTo(x + jx - (pass ? 2 : 0) * s, y + jy);
        else g.lineTo(x + jx, y + jy);
      });
      g.stroke();
    }
  }

  /** Parallel strokes across a shape, as if shading it in. */
  private hatch(g: CanvasRenderingContext2D, shape: Path2D, box: [number, number, number, number], spacing: number, color: string, rand: () => number, angle = -0.9) {
    const s = this.scale;
    const [x0, y0, x1, y1] = box;
    g.save();
    g.clip(shape);
    g.strokeStyle = color;
    g.lineWidth = 1.4 * s;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    for (let d = -len; d < len; d += spacing * s) {
      const cx = (x0 + x1) / 2 + -dy * d;
      const cy = (y0 + y1) / 2 + dx * d;
      g.beginPath();
      g.moveTo(cx - dx * len + (rand() - 0.5) * 3, cy - dy * len);
      g.lineTo(cx + dx * len, cy + dy * len + (rand() - 0.5) * 3);
      g.stroke();
    }
    g.restore();
  }

  private circle(x: number, y: number, rx: number, ry: number, rand: () => number, steps = 14): Point[] {
    return Array.from({ length: steps + 2 }, (_, i) => {
      const a = (i / steps) * Math.PI * 2;
      const k = 1 + (rand() - 0.5) * 0.12;
      return [x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k] as Point;
    });
  }

  private drawDoodle(g: CanvasRenderingContext2D, frame: number) {
    const { cx, cy } = this;
    const s = this.scale;
    const rand = seeded(frame + 1);
    // The flames move only between drawings, so time is quantised to the frame.
    const t = frame / FPS;
    const lit = this.ignition * (1 + 0.35 * Math.min(this.boost, 2));

    // Logs, with wood grain and ringed ends.
    for (const [x1, y1, x2, y2] of [
      [-120, 22, 90, -14],
      [120, 22, -90, -14],
    ]) {
      const ax = cx + x1 * s;
      const ay = cy + y1 * s;
      const bx = cx + x2 * s;
      const by = cy + y2 * s;
      const a = Math.atan2(by - ay, bx - ax);
      const r = 13 * s;
      const nx = -Math.sin(a) * r;
      const ny = Math.cos(a) * r;
      this.sketch(g, [[ax + nx, ay + ny], [bx + nx, by + ny]], rand);
      this.sketch(g, [[ax - nx, ay - ny], [bx - nx, by - ny]], rand);
      this.sketch(g, [[ax + nx * 0.2 + (bx - ax) * 0.2, ay + ny * 0.2 + (by - ay) * 0.2], [ax + (bx - ax) * 0.6, ay + (by - ay) * 0.6]], rand, 0.8);
      this.sketch(g, this.circle(ax, ay, r * 0.5, r, rand, 12), rand, 1.2);
      this.sketch(g, this.circle(ax, ay, r * 0.22, r * 0.45, rand, 8), rand, 0.8);
    }

    // Stones, shaded underneath.
    for (let i = -3; i <= 3; i++) {
      const x = cx + i * 44 * s;
      const y = cy + (36 - Math.abs(i) * 4) * s;
      const pts = this.circle(x, y, 21 * s, 12 * s, rand, 12);
      this.sketch(g, pts, rand);
      const shape = new Path2D();
      shape.ellipse(x, y + 6 * s, 20 * s, 7 * s, 0, 0, Math.PI);
      this.hatch(g, shape, [x - 20 * s, y, x + 20 * s, y + 13 * s], 4, 'rgba(52, 52, 62, 0.4)', rand);
    }

    // Flames: an outline in graphite, coloured in with orange and yellow pencil.
    const outline = new Path2D();
    const count = 5;
    const tongues: Point[][] = [];
    for (let k = 0; k < count; k++) {
      const o = (k / (count - 1)) * 2 - 1;
      const base = cx + o * 48 * s;
      const flick = 0.75 + 0.35 * noise1(t * 2.6 + k * 13);
      const h = (1 - Math.abs(o) ** 1.5 * 0.55) * 180 * s * lit * flick;
      const w = 34 * s * (1 - Math.abs(o) * 0.3);
      if (h < 6) continue;
      const left: Point[] = [];
      const right: Point[] = [];
      for (let i = 0; i <= 8; i++) {
        const u = i / 8;
        const half = w * (1 - u) ** 0.8;
        const sway = (this.wind * 0.5 + (noise1(t * 1.7 + k * 5) - 0.5)) * h * 0.4 * u * u;
        const y = cy - 2 * s - h * u;
        left.push([base - half + sway, y]);
        right.push([base + half + sway, y]);
      }
      const pts = [...left, ...right.reverse()];
      tongues.push(pts);
      pts.forEach(([x, y], i) => (i ? outline.lineTo(x, y) : outline.moveTo(x, y)));
      outline.closePath();
    }
    if (tongues.length) {
      const top = cy - 200 * s * lit;
      this.hatch(g, outline, [cx - 90 * s, top, cx + 90 * s, cy], 5, 'rgba(240, 130, 50, 0.55)', rand, -1.1);
      const core = new Path2D();
      core.ellipse(cx, cy - 30 * s * lit, 34 * s, 40 * s * lit, 0, 0, Math.PI * 2);
      this.hatch(g, core, [cx - 40 * s, cy - 80 * s, cx + 40 * s, cy], 4, 'rgba(245, 200, 70, 0.6)', rand, -0.6);
      for (const pts of tongues) this.sketch(g, pts, rand, 1.4);
      this.outline = tongues.flat();
    }

    // Sparks as little scribbled stars, and a curl of smoke.
    for (let k = 0; k < 4; k++) {
      const phase = (t * 0.5 + k * 0.27) % 1;
      const x = cx + (noise1(k * 7 + Math.floor(t * 0.5 + k * 0.27)) - 0.5) * 120 * s + this.wind * 40 * s * phase;
      const y = cy - (150 + phase * 140) * s * lit;
      const r = 4 * s * (1 - phase);
      if (r < 1) continue;
      this.sketch(g, [[x - r, y], [x + r, y]], rand, 1);
      this.sketch(g, [[x, y - r], [x, y + r]], rand, 1);
      this.sketch(g, [[x - r * 0.7, y - r * 0.7], [x + r * 0.7, y + r * 0.7]], rand, 0.8);
    }
    const curl: Point[] = [];
    for (let i = 0; i <= 26; i++) {
      const u = i / 26;
      const a = u * Math.PI * 5;
      curl.push([cx + 40 * s + Math.cos(a) * 14 * s * u + this.wind * 50 * s * u, cy - (210 + u * 120) * s * lit + Math.sin(a) * 10 * s]);
    }
    this.sketch(g, curl, rand, 1, 'rgba(52, 52, 62, 0.45)');

    // A note in the margin, as doodles get.
    const noteX = Math.min(cx + 160 * s, this.width - 120 * s);
    if (noteX > cx + 110 * s) {
      g.save();
      g.translate(noteX, cy - 150 * s);
      g.rotate(-0.12 + (rand() - 0.5) * 0.02);
      g.fillStyle = 'rgba(52, 52, 62, 0.8)';
      g.font = `700 ${Math.round(20 * s)}px ${this.hand}`;
      g.fillText('따뜻해!', 0, 0);
      g.restore();
      this.sketch(g, [[noteX - 6 * s, cy - 145 * s], [noteX - 40 * s, cy - 120 * s], [noteX - 34 * s, cy - 130 * s]], rand, 1);
    }
  }

  /** The eraser while it rubs, the pencil while it draws a patch back in, and eraser crumbs. */
  private drawTools(ctx: CanvasRenderingContext2D, frame: number) {
    const s = this.scale;
    for (const e of this.erased) {
      if (e.age < RUB_SECONDS) {
        // A pink eraser scrubbing back and forth.
        const k = e.age / RUB_SECONDS;
        const x = e.x + Math.sin(k * Math.PI * 7) * e.r * 0.5;
        ctx.save();
        ctx.translate(x, e.y);
        ctx.rotate(-0.4);
        ctx.fillStyle = '#f2a7b4';
        ctx.fillRect(-16 * s, -9 * s, 32 * s, 18 * s);
        ctx.fillStyle = '#5a7fc2';
        ctx.fillRect(-16 * s, -9 * s, 10 * s, 18 * s);
        ctx.strokeStyle = 'rgba(60, 40, 50, 0.6)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(-16 * s, -9 * s, 32 * s, 18 * s);
        ctx.restore();
      }
    }
    ctx.fillStyle = 'rgba(200, 150, 160, 0.8)';
    for (const c of this.crumbs) ctx.fillRect(c.x, c.y, c.size, c.size);

    // The pencil is always at work: filling in a rubbed-out patch if there is one, otherwise
    // going over the flames again and again.
    const healing = this.erased.find((e) => e.age > RUB_SECONDS + HOLD_SECONDS);
    if (healing) {
      const r = this.erasedRadius(healing);
      const a = frame * 1.3;
      this.drawPencil(ctx, healing.x + Math.cos(a) * r * 0.8, healing.y + Math.sin(a) * r * 0.8);
      return;
    }
    if (this.erased.length || this.outline.length < 2) return;
    const tip = this.alongOutline(this.time * 260 * s);
    if (!tip) return;
    // A fresh, darker line just behind the tip.
    const tail: Point[] = [];
    for (let k = 0; k <= 6; k++) {
      const p = this.alongOutline(this.time * 260 * s - k * 6 * s);
      if (p) tail.push(p);
    }
    ctx.strokeStyle = 'rgba(40, 40, 48, 0.9)';
    ctx.lineWidth = 1.8 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    tail.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    this.drawPencil(ctx, tip[0], tip[1]);
  }

  /** The point `distance` px along the flame outline, looping round. */
  private alongOutline(distance: number): Point | null {
    const pts = this.outline;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (total <= 0) return null;
    let d = ((distance % total) + total) % total;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      if (d <= len) {
        const f = len ? d / len : 0;
        return [ax + (bx - ax) * f, ay + (by - ay) * f];
      }
      d -= len;
    }
    return pts[pts.length - 1];
  }

  /** A yellow pencil, tip at (x, y), held at a slant. */
  private drawPencil(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const s = this.scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.7);
    ctx.translate(10 * s, 0);
    ctx.fillStyle = '#f2c94c';
    ctx.fillRect(0, -4 * s, 46 * s, 8 * s);
    ctx.fillStyle = '#d9ad35';
    ctx.fillRect(0, 1.5 * s, 46 * s, 2.5 * s);
    ctx.fillStyle = '#e9c9a0';
    ctx.beginPath();
    ctx.moveTo(0, -4 * s);
    ctx.lineTo(-10 * s, 0);
    ctx.lineTo(0, 4 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3a3a44';
    ctx.beginPath();
    ctx.moveTo(-6 * s, -1.6 * s);
    ctx.lineTo(-10 * s, 0);
    ctx.lineTo(-6 * s, 1.6 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b8b8c0';
    ctx.fillRect(46 * s, -4 * s, 4 * s, 8 * s);
    ctx.fillStyle = '#e88a9a';
    ctx.fillRect(50 * s, -4 * s, 7 * s, 8 * s);
    ctx.restore();
  }
}

export const pencilTheme: FireTheme = {
  id: 'pencil',
  label: 'Pencil',
  palette: {
    titleFrom: '#3a3a44',
    titleTo: '#55556a',
    titleGlow: 'rgba(0, 0, 0, 0)',
    ambient: '#fbf7ec',
  },
  letters: { knock: 'touch', draggable: true, item: false },
  createRenderer: () => new PencilDoodle(),
};
