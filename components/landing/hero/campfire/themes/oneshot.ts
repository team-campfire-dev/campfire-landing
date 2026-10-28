import { hash, noise1 } from '../noise';
import { seeded } from '../illustration';
import type { FireFrame, FireHost, FireRenderer, FireTap, FireTheme, HotZone } from '../types';
import { fadeToPage } from './classic';

// A tribute to OneShot: a dark world with no sun, a lightbulb carried in its place, and blue
// phosphor that goes dark when left alone. Drawn as low-resolution pixel art and scaled up.

/** The bulb sprite is drawn at this many scene pixels per sprite pixel. */
const BULB_SCALE = 2;
const BULB_W = 13;
const BULB_H = 20;
/** Seconds a stirred phosphor plant keeps glowing before it fades out. */
const PHOSPHOR_FADE = 6;
/** Characters typed into the text box per second. */
const TYPE_RATE = 28;
const MAX_MOTES = 18;

const LINES = [
  '…거기, 누군가 있나요?',
  '이 세계엔 해가 없어요. 남은 빛은 이 전구 하나뿐이에요.',
  '푸른 인광은 가만두면 잠들어요. 주위를 휘저어서 깨워 주세요.',
  '글자를 빛 속으로 던져 주면 조금 더 밝아질 거예요.',
  '…너무 세게 두드리지는 말아 주세요. 기회는 한 번뿐이니까요.',
];

interface Plant {
  /** Scene-pixel position of the cluster's base. */
  x: number;
  y: number;
  leaves: { dx: number; dy: number }[];
  glow: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const mixHex = (a: string, b: string, t: number) => {
  const [ar, ag, ab] = hexRgb(a);
  const [br, bg, bb] = hexRgb(b);
  const k = clamp(t, 0, 1);
  return `rgb(${Math.round(ar + (br - ar) * k)},${Math.round(ag + (bg - ag) * k)},${Math.round(ab + (bb - ab) * k)})`;
};

/** The lightbulb, one sprite pixel per cell: glass with a highlight and filament, on a screw base. */
function makeBulbSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = BULB_W;
  canvas.height = BULB_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const put = (x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };
  const cx = 6;
  const cy = 6;
  for (let y = 0; y < 13; y++) {
    for (let x = 0; x < BULB_W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      // Below the middle the glass narrows into the neck.
      const neck = y > 8 ? Math.abs(x - cx) <= 6 - (y - 8) * 0.9 : true;
      if (!neck || d > 6.4) continue;
      const edge = d > 5.4 || (y > 8 && Math.abs(x - cx) > 5 - (y - 8) * 0.9);
      if (edge) put(x, y, '#b8913f');
      else if (Math.hypot(x - 4, y - 3.5) < 1.6) put(x, y, '#ffffff');
      else if (d < 3) put(x, y, '#fffbe6');
      else put(x, y, '#ffe9a0');
    }
  }
  // Filament: a little zigzag held on two wires.
  for (const [x, y] of [[4, 6], [5, 7], [6, 6], [7, 7], [8, 6], [5, 8], [7, 8], [5, 9], [7, 9], [5, 10], [7, 10]]) {
    put(x, y, y <= 7 ? '#ff9a2e' : '#c98a4a');
  }
  // Screw base with alternating threads and a small contact at the tip.
  for (let y = 13; y < 18; y++) {
    for (let x = 3; x <= 9; x++) {
      const side = x === 3 || x === 9;
      put(x, y, side ? '#4d4c55' : y % 2 ? '#9a99a4' : '#6e6d78');
    }
  }
  for (let x = 4; x <= 8; x++) put(x, 18, '#55545e');
  for (let x = 5; x <= 7; x++) put(x, 19, '#2e2d34');
  return canvas;
}

/**
 * OneShot's world at night: the Barrens' metallic sand under a sunless sky, a distant tower,
 * blue phosphor that sleeps unless stirred, and a lightbulb standing in for the sun. Tapping the
 * bulb opens a text box that talks to you.
 */
class SunlessBarrens implements FireRenderer {
  private readonly bulb = makeBulbSprite();
  private readonly base = document.createElement('canvas');
  private readonly pix = document.createElement('canvas');
  private readonly dark = document.createElement('canvas');
  private plants: Plant[] = [];
  private motes: Mote[] = [];

  private width = 0;
  private height = 0;
  private scale = 1;
  /** CSS px per scene pixel. */
  private px = 3;
  private pw = 1;
  private ph = 1;
  private horizon = 0;
  /** Scene-pixel position of the bulb's base. */
  private bx = 0;
  private by = 0;
  private time = 0;
  private ignition = 0;
  private boost = 0;
  private reducedMotion = false;

  /** Index of the line in the text box, or -1 when it's closed. */
  private line = -1;
  private typed = 0;
  private taps = 0;
  private glitch = 0;

  constructor(private readonly host: FireHost) {}

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    this.px = clamp(Math.round(3 * this.scale), 2, 4);
    this.pw = Math.ceil(width / this.px);
    this.ph = Math.ceil(height / this.px);
    this.horizon = Math.round(this.ph * 0.66);
    this.bx = Math.round(this.pw / 2);
    this.by = Math.round(this.ph * 0.82);
    for (const c of [this.base, this.pix, this.dark]) {
      c.width = this.pw;
      c.height = this.ph;
    }
    this.paintBase();
    this.plantPhosphor();
  }

  hotZone(): HotZone {
    const { px } = this;
    const top = (this.by - BULB_H * BULB_SCALE - 6) * px;
    return { x: (this.bx - 14) * px, y: top, width: 28 * px, height: this.height - top };
  }

  groundY() {
    return this.by * this.px;
  }

  tap({ x, y }: FireTap) {
    const sx = x / this.px;
    const sy = y / this.px;
    const onBulb =
      Math.abs(sx - this.bx) < (BULB_W * BULB_SCALE) / 2 + 4 && sy > this.by - BULB_H * BULB_SCALE - 4 && sy < this.by + 3;
    if (onBulb) {
      this.talk();
      return;
    }
    if (this.line >= 0) this.line = -1;
    this.stir(sx, sy, 16);
  }

  feed(x: number, y: number, fuel: number) {
    this.boost = Math.min(this.boost + 0.6 * fuel, 1.5);
    this.stir(x / this.px, y / this.px, 40);
    for (let i = 0; i < 8; i++) this.mote(true);
  }

  update({ time, dt, pointer, reducedMotion }: FireFrame) {
    this.time = time;
    this.reducedMotion = reducedMotion;
    this.ignition = Math.min(1, this.ignition + dt / 1.2);
    this.boost *= Math.exp(-0.5 * dt);
    this.glitch = Math.max(0, this.glitch - dt * 1.6);
    if (this.line >= 0) this.typed = Math.min(LINES[this.line].length, this.typed + TYPE_RATE * dt);

    if (pointer) this.stir(pointer.x / this.px, pointer.y / this.px, 10, Math.hypot(pointer.vx, pointer.vy) > 40);
    for (const p of this.plants) p.glow = Math.max(0, p.glow - dt / PHOSPHOR_FADE);

    if (Math.random() < dt * 4) this.mote(false);
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      m.age += dt;
      if (m.age >= m.life) {
        this.motes[i] = this.motes[this.motes.length - 1];
        this.motes.pop();
        continue;
      }
      m.vx += (noise1(m.y * 0.2 + i) - 0.5) * 8 * dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const g = this.pix.getContext('2d');
    const d = this.dark.getContext('2d');
    if (!g || !d) return;
    const { pw, ph, bx, by } = this;
    const lit = this.ignition * (0.96 + 0.04 * noise1(this.time * 9)) * (1 + 0.5 * this.boost);

    g.imageSmoothingEnabled = false;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.base, 0, 0);

    // The tower's warning light, blinking far away.
    const tower = this.towerTop();
    const blink = Math.floor(this.time * 1.2) % 2 === 0;
    g.fillStyle = blink ? '#ffd36a' : '#5a4a2a';
    g.fillRect(tower.x, tower.y, 1, 1);

    for (const p of this.plants) {
      g.fillStyle = mixHex('#1a3a48', '#5ef0ff', p.glow);
      for (const leaf of p.leaves) this.clover(g, p.x + leaf.dx, p.y + leaf.dy);
    }

    // Motes of dust drifting through the light.
    g.fillStyle = '#ffeab0';
    for (const m of this.motes) {
      if (Math.floor(m.age * 6) % 3 === 0) continue;
      g.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
    }

    const bw = BULB_W * BULB_SCALE;
    const bh = BULB_H * BULB_SCALE;
    g.drawImage(this.bulb, bx - bw / 2, by - bh, bw, bh);

    // Darkness over everything, with the light cut out in steps, the way old RPGs shade it.
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, pw, ph);
    d.fillStyle = 'rgba(3, 3, 9, 0.86)';
    d.fillRect(0, 0, pw, ph);
    d.globalCompositeOperation = 'destination-out';
    const radius = (62 + 6 * noise1(this.time * 2)) * this.scale * (3 / this.px) * lit;
    this.steppedLight(d, bx, by - bh * 0.55, radius, [1, 0.78, 0.5, 0.22]);
    for (const p of this.plants) {
      // Even asleep, phosphor shows faintly, so there's something to stir.
      const glow = Math.max(p.glow, 0.15);
      this.steppedLight(d, p.x + 2, p.y, 9 * glow + 3, [glow * 0.8, glow * 0.45, glow * 0.2, 0]);
    }
    this.steppedLight(d, tower.x, tower.y, 3, [blink ? 0.8 : 0.2, 0.4, 0.1, 0]);
    g.drawImage(this.dark, 0, 0);

    // Warmth around the bulb, and a cyan haze over glowing phosphor.
    g.globalCompositeOperation = 'lighter';
    this.tint(g, bx, by - bh * 0.55, radius * 0.7, [255, 200, 110], 0.22 * lit);
    for (const p of this.plants) if (p.glow > 0.1) this.tint(g, p.x + 2, p.y, 8, [80, 220, 255], 0.25 * p.glow);
    g.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.pix, 0, 0, pw * this.px, ph * this.px);
    ctx.restore();
    fadeToPage(ctx, this.width, this.height);
    this.drawGlitch(ctx);
    this.drawTextBox(ctx);
  }

  // ---- interactions ----

  /** The bulb speaks: finish the line being typed, or move on to the next one. */
  private talk() {
    if (this.line >= 0 && this.typed < LINES[this.line].length) {
      this.typed = LINES[this.line].length;
      return;
    }
    this.taps++;
    // Opens on the first line, then cycles through the rest.
    this.line = this.taps === 1 ? 0 : 1 + ((this.taps - 2) % (LINES.length - 1));
    this.typed = 0;
    this.boost = Math.min(this.boost + 0.15, 1.5);
    if (this.line === LINES.length - 1 && !this.reducedMotion) {
      // Tapped once too often: the world machine flinches.
      this.glitch = 1;
      this.host.shake(4);
    }
  }

  /** Wakes phosphor near a scene-pixel point. */
  private stir(x: number, y: number, radius: number, moving = true) {
    if (!moving) return;
    for (const p of this.plants) {
      if (Math.hypot(p.x - x, p.y - y) < radius) p.glow = 1;
    }
  }

  private mote(burst: boolean) {
    if (this.motes.length >= MAX_MOTES) return;
    const spread = BULB_W * BULB_SCALE;
    this.motes.push({
      x: this.bx + rand(-spread, spread),
      y: this.by - rand(4, BULB_H * BULB_SCALE),
      vx: rand(-3, 3),
      vy: -rand(2, burst ? 14 : 6),
      age: 0,
      life: rand(2, 4),
    });
  }

  // ---- scene ----

  private towerTop() {
    return { x: Math.round(this.pw * 0.74), y: Math.round(this.ph * 0.14) - 6 };
  }

  /** Sky, horizon rubble, the distant tower and the metallic sand, painted once per resize. */
  private paintBase() {
    const g = this.base.getContext('2d');
    if (!g) return;
    const { pw, ph, horizon } = this;
    const image = g.createImageData(pw, ph);
    const data = image.data;
    const sky = [hexRgb('#06060c'), hexRgb('#1d1a2b')];
    const sand = ['#24202a', '#29252f', '#201d26', '#2d2833'].map(hexRgb);
    const speck = hexRgb('#3e3848');
    // 2x2 ordered dither, so the sky's gradient falls into visible bands.
    const bayer = [0, 0.5, 0.75, 0.25];
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const i = (y * pw + x) * 4;
        let c: [number, number, number];
        if (y < horizon) {
          const t = y / horizon + (bayer[(y % 2) * 2 + (x % 2)] - 0.5) * 0.12;
          const k = Math.round(clamp(t, 0, 1) * 6) / 6;
          c = [sky[0][0] + (sky[1][0] - sky[0][0]) * k, sky[0][1] + (sky[1][1] - sky[0][1]) * k, sky[0][2] + (sky[1][2] - sky[0][2]) * k];
        } else {
          const h = hash(x, y);
          c = h > 0.985 ? speck : sand[Math.floor(hash(Math.floor(x / 2), Math.floor(y / 2) + 99) * sand.length)];
        }
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
        data[i + 3] = 255;
      }
    }
    g.putImageData(image, 0, 0);

    // Rubble and ruined machines along the horizon, in blocky steps.
    g.fillStyle = '#0b0a10';
    for (let x = 0; x < pw; x += 3) {
      const h = Math.round(noise1(x * 0.05 + 4) * 9 + noise1(x * 0.2) * 3);
      g.fillRect(x, horizon - h, 3, h + 1);
    }

    // The tower, far off: a tall dark spire with ledges.
    const tower = this.towerTop();
    g.fillStyle = '#060509';
    for (let y = tower.y + 6; y < horizon; y++) {
      const w = 3 + Math.floor(((y - tower.y) / (horizon - tower.y)) * 6);
      g.fillRect(tower.x - w, y, w * 2 + 1, 1);
      if ((y - tower.y) % 14 === 0) g.fillRect(tower.x - w - 2, y, w * 2 + 5, 2);
    }
    g.fillRect(tower.x, tower.y, 1, 6);

    // Blocky rocks scattered over the sand, kept clear of the bulb.
    const rand = seeded(5);
    for (let i = 0; i < Math.round(pw / 22); i++) {
      const x = Math.round(rand() * pw);
      const y = Math.round(horizon + 6 + rand() * (ph - horizon - 14));
      if (Math.abs(x - this.bx) < 26 && Math.abs(y - this.by) < 20) continue;
      const w = 3 + Math.round(rand() * 6);
      const h = 2 + Math.round(rand() * 3);
      g.fillStyle = '#1b1820';
      g.fillRect(x, y, w, h + 1);
      g.fillStyle = '#3a3443';
      g.fillRect(x, y - 1, w, h);
      g.fillStyle = '#4a4354';
      g.fillRect(x, y - 1, w, 1);
    }
  }

  private plantPhosphor() {
    const rand = seeded(23);
    const { pw, ph, horizon } = this;
    const count = Math.round(pw / 14);
    this.plants = [];
    for (let i = 0; i < count; i++) {
      const x = Math.round(rand() * (pw - 6));
      const y = Math.round(horizon + 5 + rand() * (ph - horizon - 12));
      if (Math.abs(x - this.bx) < 18 && Math.abs(y - this.by) < 14) continue;
      const leaves = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, k) => ({ dx: k * 5 - Math.floor(rand() * 2), dy: -Math.floor(rand() * 2) }));
      // A few start out glowing, so there's something to find in the dark.
      this.plants.push({ x, y, leaves, glow: rand() < 0.3 ? 1 : 0 });
    }
  }

  /** A three-leafed phosphor sprout, base at (x, y). */
  private clover(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillRect(x + 1, y - 4, 1, 1);
    g.fillRect(x + 3, y - 4, 1, 1);
    g.fillRect(x, y - 3, 5, 1);
    g.fillRect(x + 1, y - 2, 3, 1);
    g.fillRect(x + 2, y - 1, 1, 1);
  }

  /** Cuts light out of the darkness in hard-edged rings. */
  private steppedLight(d: CanvasRenderingContext2D, x: number, y: number, r: number, levels: number[]) {
    if (r <= 0.5) return;
    const grad = d.createRadialGradient(x, y, 0, x, y, r);
    levels.forEach((a, i) => {
      const from = i / levels.length;
      const to = (i + 1) / levels.length;
      grad.addColorStop(from, `rgba(0,0,0,${clamp(a, 0, 1).toFixed(3)})`);
      grad.addColorStop(Math.max(from, to - 0.001), `rgba(0,0,0,${clamp(a, 0, 1).toFixed(3)})`);
    });
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    d.fillStyle = grad;
    d.fillRect(x - r, y - r, r * 2, r * 2);
  }

  private tint(g: CanvasRenderingContext2D, x: number, y: number, r: number, [cr, cg, cb]: number[], a: number) {
    if (a <= 0.005 || r <= 0) return;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},${clamp(a, 0, 1).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // ---- overlays ----

  /** A brief tear: shifted strips of the frame and a few stray blocks of black and green. */
  private drawGlitch(ctx: CanvasRenderingContext2D) {
    if (this.glitch <= 0) return;
    const { width, height } = this;
    const canvas = ctx.canvas;
    const k = canvas.width / width;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < 5; i++) {
      const y = Math.random() * canvas.height;
      const h = (4 + Math.random() * 18) * k;
      const shift = (Math.random() - 0.5) * 40 * k * this.glitch;
      ctx.drawImage(canvas, 0, y, canvas.width, h, shift, y, canvas.width, h);
    }
    ctx.restore();
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? '#000000' : 'rgba(90, 255, 140, 0.8)';
      const size = this.px * (2 + Math.floor(Math.random() * 5));
      ctx.fillRect(Math.random() * width, Math.random() * height, size, size);
    }
  }

  /** The text box: a dark panel with a light frame, the line typing out, and the bulb's portrait. */
  private drawTextBox(ctx: CanvasRenderingContext2D) {
    if (this.line < 0) return;
    const s = Math.max(this.scale, 0.75);
    const w = Math.min(560 * s, this.width - 24);
    const h = Math.max(70, 82 * s);
    const x = (this.width - w) / 2;
    const y = this.height - h - 14 * s;
    const portrait = h - 16 * s;

    ctx.fillStyle = 'rgba(10, 9, 16, 0.94)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#e9e4f2';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);

    // Portrait: the bulb itself, in a frame on the right.
    const px = x + w - portrait - 8 * s;
    const py = y + 8 * s;
    ctx.fillStyle = '#18161f';
    ctx.fillRect(px, py, portrait, portrait);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const sh = portrait * 0.85;
    const sw = (sh * BULB_W) / BULB_H;
    ctx.drawImage(this.bulb, px + (portrait - sw) / 2, py + (portrait - sh) / 2, sw, sh);
    ctx.restore();

    const text = LINES[this.line].slice(0, Math.floor(this.typed));
    const size = Math.max(14, Math.round(16 * s));
    ctx.font = `500 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = '#f1ede4';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    // Wrap at spaces, so words aren't split across lines (the full line decides where).
    const maxWidth = w - portrait - 40 * s;
    const rows: string[] = [];
    let row = '';
    for (const word of LINES[this.line].split(' ')) {
      const next = row ? `${row} ${word}` : word;
      if (row && ctx.measureText(next).width > maxWidth) {
        rows.push(row);
        row = word;
      } else {
        row = next;
      }
    }
    rows.push(row);
    let left = text.length;
    rows.forEach((full, i) => {
      if (left <= 0) return;
      ctx.fillText(full.slice(0, left), x + 16 * s, y + 14 * s + i * size * 1.45);
      left -= full.length + 1;
    });

    // A blinking marker once the line is done.
    if (this.typed >= LINES[this.line].length && Math.floor(this.time * 2) % 2 === 0) {
      ctx.fillStyle = '#f1ede4';
      const mx = x + w - portrait - 26 * s;
      const my = y + h - 18 * s;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + 8 * s, my);
      ctx.lineTo(mx + 4 * s, my + 5 * s);
      ctx.closePath();
      ctx.fill();
    }
  }
}

export const oneshotTheme: FireTheme = {
  id: 'oneshot',
  label: 'OneShot',
  palette: {
    titleFrom: '#fff6d8',
    titleTo: '#ffd36a',
    titleGlow: 'rgba(255, 210, 110, 0.45)',
    ambient: '#0b0a12',
  },
  letters: { knock: 'touch', draggable: true, item: false },
  createRenderer: (host) => new SunlessBarrens(host),
};
