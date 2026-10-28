import { noise1 } from '../noise';
import { seeded } from '../illustration';
import type { FireFrame, FireRenderer, FireTap, FireTheme, HotZone } from '../types';
import { fadeToPage } from './classic';

// A falling-sand lab: every cell of a coarse grid is a material — sand, water, oil, wood, fire,
// smoke, metal salts — with temperature, gravity and a few chemical rules. The campfire is a bed
// of coal that never goes out. Salts (and letters) thrown in colour the flame like a flame test.

const EMPTY = 0;
const WALL = 1;
const SAND = 2;
const WATER = 3;
const OIL = 4;
const WOOD = 5;
const FIRE = 6;
const SMOKE = 7;
const STEAM = 8;
const SALT = 9;
const COAL = 10;
const ASH = 11;
/** Toolbar-only: clears cells. */
const ERASE = 255;

const AMBIENT = 20;
const TICK = 1 / 60;

interface Element {
  symbol: string;
  name: string;
  /** What the flame looks like, in words, for the read-out. */
  colorName: string;
  flame: string;
  /** Colour of the salt as a powder. */
  salt: string;
}

/** Flame-test colours. Index 0 is "no element": a plain flame. */
const ELEMENTS: (Element | null)[] = [
  null,
  { symbol: 'Na', name: '나트륨', colorName: '노란색', flame: '#ffcf3a', salt: '#ece6d6' },
  { symbol: 'Cu', name: '구리', colorName: '청록색', flame: '#33e0b0', salt: '#4f9fd8' },
  { symbol: 'Li', name: '리튬', colorName: '진홍색', flame: '#ff2f5e', salt: '#eae8ef' },
  { symbol: 'K', name: '칼륨', colorName: '연보라색', flame: '#c48cff', salt: '#f1eef6' },
  { symbol: 'Sr', name: '스트론튬', colorName: '빨간색', flame: '#ff2d2d', salt: '#f3eaea' },
  { symbol: 'B', name: '붕소', colorName: '연두색', flame: '#7aff4a', salt: '#dcdcd2' },
  { symbol: 'Tl', name: '탈륨', colorName: '초록색', flame: '#3cff6a', salt: '#d8d8d8' },
  { symbol: 'Mg', name: '마그네슘', colorName: '흰색', flame: '#ffffff', salt: '#e6e6ea' },
  { symbol: 'P', name: '인', colorName: '옅은 청록색', flame: '#9fffd8', salt: '#f0e8d0' },
  { symbol: 'In', name: '인듐', colorName: '남색', flame: '#5864ff', salt: '#d0d0dc' },
  { symbol: 'Rb', name: '루비듐', colorName: '붉은 보라색', flame: '#d23cff', salt: '#e8e2ec' },
  { symbol: 'Zn', name: '아연', colorName: '청록빛 흰색', flame: '#88e8ff', salt: '#e2e6ea' },
];
const element = (symbol: string) => ELEMENTS.findIndex((e) => e?.symbol === symbol);

/**
 * The element a letter brings to the flame: a metal whose symbol starts with that letter and
 * has a known flame colour. Letters with none burn sodium yellow, the most common flame colour.
 */
const LETTER_ELEMENT: Record<string, string> = {
  B: 'B', C: 'Cu', I: 'In', K: 'K', L: 'Li', M: 'Mg', N: 'Na', P: 'P', R: 'Rb', S: 'Sr', T: 'Tl', Z: 'Zn',
};
const letterElement = (letter: string) => element(LETTER_ELEMENT[letter.toUpperCase()] ?? 'Na');

type View = 'normal' | 'thermal' | 'night';
const VIEWS: View[] = ['normal', 'thermal', 'night'];
const VIEW_LABEL: Record<View, string> = { normal: '일반', thermal: '열화상', night: '야간투시' };

/** Toolbar entries. */
interface Tool {
  kind: 'material' | 'view' | 'gravity';
  label: string;
  color: string;
  material?: number;
  /** Element for a salt. */
  element?: number;
  gravity?: [number, number];
}

const TOOLS: Tool[] = [
  { kind: 'material', label: '모래', color: '#d8b46a', material: SAND },
  { kind: 'material', label: '물', color: '#3f86e0', material: WATER },
  { kind: 'material', label: '기름', color: '#6b4a24', material: OIL },
  { kind: 'material', label: '나무', color: '#8a5a32', material: WOOD },
  { kind: 'material', label: '불', color: '#ff8a2a', material: FIRE },
  { kind: 'material', label: '벽', color: '#5a5864', material: WALL },
  ...['Na', 'Cu', 'Li', 'K', 'Sr'].map((symbol): Tool => {
    const e = element(symbol);
    return { kind: 'material', label: symbol, color: ELEMENTS[e]!.flame, material: SALT, element: e };
  }),
  { kind: 'material', label: '지우개', color: '#1b1a22', material: ERASE },
  { kind: 'view', label: '보기', color: '#2a2a36' },
  { kind: 'gravity', label: '↓', color: '#2a2a36', gravity: [0, 1] },
  { kind: 'gravity', label: '←', color: '#2a2a36', gravity: [-1, 0] },
  { kind: 'gravity', label: '↑', color: '#2a2a36', gravity: [0, -1] },
  { kind: 'gravity', label: '→', color: '#2a2a36', gravity: [1, 0] },
  { kind: 'gravity', label: '0', color: '#2a2a36', gravity: [0, 0] },
];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Thermal "iron" palette from cold to white-hot, as [°C, colour]. */
const IRON: [number, [number, number, number]][] = [
  [10, hexRgb('#06031a')],
  [60, hexRgb('#2c0b5c')],
  [150, hexRgb('#7a1286')],
  [300, hexRgb('#c8242e')],
  [550, hexRgb('#ff7a12')],
  [800, hexRgb('#ffd23a')],
  [1100, hexRgb('#ffffe0')],
];

function ironColor(t: number): [number, number, number] {
  if (t <= IRON[0][0]) return IRON[0][1];
  for (let i = 1; i < IRON.length; i++) {
    if (t <= IRON[i][0]) {
      const [t0, c0] = IRON[i - 1];
      const [t1, c1] = IRON[i];
      const k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return IRON[IRON.length - 1][1];
}

/**
 * The lab. Gravity can point any way (or nowhere): powders and liquids fall with it, fire and
 * gases rise against it, and with none at all flames burn round and blue as in orbit.
 */
class SandLab implements FireRenderer {
  private readonly pix = document.createElement('canvas');
  private image: ImageData | null = null;

  private width = 0;
  private height = 0;
  private scale = 1;
  /** CSS px per cell. */
  private cell = 4;
  private gw = 1;
  private gh = 1;
  private type = new Uint8Array(1);
  /** Per-cell extra: the element of a salt, or the tint of a flame. */
  private aux = new Uint8Array(1);
  private life = new Uint8Array(1);
  private shade = new Uint8Array(1);
  private temp = new Float32Array(1);
  private stamp = new Uint8Array(1);
  private mark = 1;
  private ticks = 0;
  private acc = 0;

  private gx = 0;
  private gy = 1;
  private view: View = 'normal';
  private tool = 0;
  private time = 0;
  private pointer: FireFrame['pointer'] = null;
  private lastPaint: { x: number; y: number } | null = null;
  /** The last flame test, shown by the fire for a moment. */
  private reading: { text: string; color: string; until: number } | null = null;
  private built = { width: 0, height: 0 };

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.scale = clamp(Math.min(width * 1.4, height * 1.2) / 760, 0.6, 1.3);
    const changed = Math.abs(width - this.built.width) > 40 || Math.abs(height - this.built.height) / Math.max(1, this.built.height) > 0.25;
    if (!changed) return;
    this.built = { width, height };
    this.cell = clamp(Math.round(4 * this.scale), 3, 5);
    this.gw = Math.ceil(width / this.cell);
    this.gh = Math.ceil(height / this.cell);
    const n = this.gw * this.gh;
    this.type = new Uint8Array(n);
    this.aux = new Uint8Array(n);
    this.life = new Uint8Array(n);
    this.shade = new Uint8Array(n).map(() => (Math.random() * 255) | 0);
    this.temp = new Float32Array(n).fill(AMBIENT);
    this.stamp = new Uint8Array(n);
    this.pix.width = this.gw;
    this.pix.height = this.gh;
    this.image = null;
    this.buildScene();
  }

  hotZone(): HotZone {
    const { cell } = this;
    const fire = this.fireSpot();
    const top = (fire.y - 34) * cell;
    return { x: (fire.x - 12) * cell, y: top, width: 24 * cell, height: this.height - top };
  }

  /** Letters land on whatever's piled up in their column. */
  groundY(x: number) {
    const cx = clamp(Math.floor(x / this.cell), 0, this.gw - 1);
    for (let y = 0; y < this.gh; y++) {
      const t = this.type[y * this.gw + cx];
      if (t === WALL || t === SAND || t === WOOD || t === SALT || t === COAL || t === ASH) return y * this.cell;
    }
    return this.height;
  }

  gravity() {
    return { x: this.gx, y: this.gy };
  }

  claimsDrag(x: number, y: number) {
    return this.toolAt(x, y) < 0;
  }

  tap({ x, y, onLetter }: FireTap) {
    if (onLetter) return;
    const hit = this.toolAt(x, y);
    if (hit >= 0) {
      this.useTool(hit);
      return;
    }
    // A tap drops a small blob; on touch screens it's the only way to place things.
    this.paint(Math.floor(x / this.cell), Math.floor(y / this.cell), 4);
  }

  feed(x: number, y: number, fuel: number, letter?: string) {
    const e = letter ? letterElement(letter) : 1;
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    for (let i = 0; i < 70 * fuel; i++) {
      const px = cx + Math.round(rand(-5, 5));
      const py = cy + Math.round(rand(-5, 5));
      if (!this.inside(px, py)) continue;
      const k = py * this.gw + px;
      if (this.type[k] === EMPTY || this.type[k] === SMOKE) this.set(k, FIRE, e, 30 + Math.random() * 40, 900);
    }
    this.read(e);
  }

  update({ time, dt, pointer }: FireFrame) {
    this.time = time;
    this.pointer = pointer;

    // Painting with the mouse held down, along the path since the last frame.
    if (pointer?.down && this.toolAt(pointer.x, pointer.y) < 0 && TOOLS[this.tool].kind === 'material') {
      const to = { x: Math.floor(pointer.x / this.cell), y: Math.floor(pointer.y / this.cell) };
      const from = this.lastPaint ?? to;
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
      for (let k = 0; k <= steps; k++) {
        this.paint(Math.round(from.x + ((to.x - from.x) * k) / steps), Math.round(from.y + ((to.y - from.y) * k) / steps), 2);
      }
      this.lastPaint = to;
    } else {
      this.lastPaint = null;
    }

    this.acc = Math.min(this.acc + dt, TICK * 3);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.step();
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { width, height } = this;
    if (this.view === 'normal') {
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, '#0b0d14');
      bg.addColorStop(1, '#181722');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      // The fire's light on the lab.
      const f = this.fireSpot();
      const fx = f.x * this.cell;
      const fy = f.y * this.cell;
      const r = 320 * this.scale;
      const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
      glow.addColorStop(0, 'rgba(255, 130, 50, 0.16)');
      glow.addColorStop(1, 'rgba(255, 130, 50, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(fx - r, fy - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = this.view === 'thermal' ? '#06031a' : '#020a04';
      ctx.fillRect(0, 0, width, height);
    }

    this.render();
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.pix, 0, 0, this.gw * this.cell, this.gh * this.cell);
    if (this.view === 'night') {
      // Scanlines and grain, like an image intensifier.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      for (let y = 0; y < height; y += 3) ctx.fillRect(0, y, width, 1);
    }
    ctx.restore();
    fadeToPage(ctx, width, height);
    this.drawReadings(ctx);
    this.drawToolbar(ctx);
  }

  // ---- simulation ----

  private inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.gw && y < this.gh;
  }

  /** Type at a cell; outside the grid counts as wall. */
  private at(x: number, y: number) {
    return this.inside(x, y) ? this.type[y * this.gw + x] : WALL;
  }

  private set(i: number, t: number, aux = 0, life = 0, temp?: number) {
    this.type[i] = t;
    this.aux[i] = aux;
    this.life[i] = clamp(life, 0, 255);
    if (temp !== undefined) this.temp[i] = temp;
  }

  private swap(i: number, j: number) {
    const { type, aux, life, shade, temp } = this;
    let b = type[i];
    type[i] = type[j];
    type[j] = b;
    b = aux[i];
    aux[i] = aux[j];
    aux[j] = b;
    b = life[i];
    life[i] = life[j];
    life[j] = b;
    b = shade[i];
    shade[i] = shade[j];
    shade[j] = b;
    const t = temp[i];
    temp[i] = temp[j];
    temp[j] = t;
    this.stamp[j] = this.mark;
  }

  /** How heavy a cell is, for things sinking through each other; gases and empty are 0. */
  private density(t: number) {
    switch (t) {
      case OIL:
        return 2;
      case WATER:
        return 3;
      case SAND:
      case SALT:
      case ASH:
        return 5;
      case EMPTY:
      case FIRE:
      case SMOKE:
      case STEAM:
        return 0;
      default:
        return 99;
    }
  }

  /** Moves cell i to (x, y) if what's there is lighter; returns whether it moved. */
  private sink(i: number, x: number, y: number, weight: number) {
    if (!this.inside(x, y)) return false;
    const j = y * this.gw + x;
    if (this.stamp[j] === this.mark) return false;
    if (this.density(this.type[j]) >= weight) return false;
    this.swap(i, j);
    return true;
  }

  /** Moves a gas cell into empty space at (x, y). */
  private drift(i: number, x: number, y: number) {
    if (!this.inside(x, y)) return false;
    const j = y * this.gw + x;
    if (this.type[j] !== EMPTY) return false;
    this.swap(i, j);
    return true;
  }

  private step() {
    this.mark = this.mark === 1 ? 2 : 1;
    const flip = (this.ticks++ & 1) === 1;
    const { gw, gh, gx, gy } = this;
    if (gx === 0) {
      // Work from the downhill side so falling things don't move twice.
      const [y0, y1, dy] = gy >= 0 ? [gh - 1, -1, -1] : [0, gh, 1];
      for (let y = y0; y !== y1; y += dy) {
        for (let k = 0; k < gw; k++) this.update1(flip ? gw - 1 - k : k, y);
      }
    } else {
      const [x0, x1, dx] = gx > 0 ? [gw - 1, -1, -1] : [0, gw, 1];
      for (let x = x0; x !== x1; x += dx) {
        for (let k = 0; k < gh; k++) this.update1(x, flip ? gh - 1 - k : k);
      }
    }
    if (this.ticks % 2 === 0) this.diffuse();
  }

  private update1(x: number, y: number) {
    const i = y * this.gw + x;
    if (this.stamp[i] === this.mark) return;
    const t = this.type[i];
    if (t === EMPTY || t === WALL) return;
    const { gx, gy } = this;
    // Sideways relative to gravity, for sliding and spreading.
    const px = -gy;
    const py = gx;
    const side = Math.random() < 0.5 ? 1 : -1;
    const weightless = gx === 0 && gy === 0;

    switch (t) {
      case SAND:
      case SALT:
      case ASH: {
        if (weightless) return;
        const w = this.density(t);
        if (this.sink(i, x + gx, y + gy, w)) return;
        if (this.sink(i, x + gx + px * side, y + gy + py * side, w)) return;
        this.sink(i, x + gx - px * side, y + gy - py * side, w);
        return;
      }
      case WATER:
      case OIL: {
        if (t === WATER && this.temp[i] > 100 && Math.random() < 0.2) {
          this.set(i, STEAM, 0, 60 + Math.random() * 80);
          return;
        }
        if (t === OIL && this.temp[i] > 220 && Math.random() < 0.1) {
          this.set(i, FIRE, 0, 60 + Math.random() * 60, 900);
          return;
        }
        if (weightless) {
          if (Math.random() < 0.1) this.sink(i, x + side, y + (Math.random() < 0.5 ? 1 : -1), this.density(t));
          return;
        }
        const w = this.density(t);
        if (this.sink(i, x + gx, y + gy, w)) return;
        if (this.sink(i, x + gx + px * side, y + gy + py * side, w)) return;
        if (this.sink(i, x + px * side, y + py * side, w)) return;
        this.sink(i, x - px * side, y - py * side, w);
        return;
      }
      case WOOD: {
        if (this.temp[i] > 280 && Math.random() < 0.02) this.set(i, FIRE, 0, 150 + Math.random() * 100, 900);
        return;
      }
      case COAL: {
        this.temp[i] = 750;
        // The bed that keeps the campfire going.
        if (Math.random() < 0.5) {
          const [ux, uy] = weightless ? this.randomDir() : [-gx, -gy];
          const nx = x + ux + (Math.random() < 0.3 ? side : 0);
          const ny = y + uy;
          if (this.at(nx, ny) === EMPTY) this.set(ny * this.gw + nx, FIRE, 0, 22 + Math.random() * 34, 900);
        }
        return;
      }
      case FIRE:
        this.burn(i, x, y, side, weightless);
        return;
      case SMOKE:
      case STEAM: {
        if (this.life[i] <= 1) {
          // Steam that has cooled condenses back to water now and then.
          if (t === STEAM && this.temp[i] < 90 && Math.random() < 0.3) this.set(i, WATER);
          else this.set(i, EMPTY);
          return;
        }
        this.life[i]--;
        if (Math.random() < 0.4) return;
        const [ux, uy] = weightless ? this.randomDir() : [-gx, -gy];
        if (this.drift(i, x + ux, y + uy)) return;
        if (this.drift(i, x + ux + px * side, y + uy + py * side)) return;
        this.drift(i, x + px * side, y + py * side);
        return;
      }
    }
  }

  /** Fire: burns down, lights what it touches, is put out by water, takes colour from salts. */
  private burn(i: number, x: number, y: number, side: number, weightless: boolean) {
    const { gw, gx, gy } = this;
    this.temp[i] = 900;
    if (this.life[i] <= 1) {
      this.set(i, Math.random() < 0.35 ? SMOKE : EMPTY, 0, 60 + Math.random() * 100);
      return;
    }
    // Without convection to carry heat away, a flame lingers.
    if (!weightless || Math.random() < 0.5) this.life[i]--;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.inside(nx, ny)) continue;
      const j = ny * gw + nx;
      const n = this.type[j];
      if (n === WATER) {
        // Doused: the water flashes to steam.
        this.set(j, STEAM, 0, 80 + Math.random() * 60, 110);
        this.set(i, EMPTY);
        return;
      }
      if (n === OIL && Math.random() < 0.25) this.set(j, FIRE, 0, 70 + Math.random() * 60, 900);
      else if (n === SALT) {
        // Flame test: the flame takes the salt's colour, and the salt slowly burns away.
        this.aux[i] = this.aux[j];
        if (Math.random() < 0.01) this.set(j, FIRE, this.aux[j], 40, 900);
        if (Math.random() < 0.02) this.read(this.aux[j]);
      }
    }
    // Flames rise against gravity and flicker sideways; weightless, they just spread a little.
    if (weightless) {
      if (Math.random() < 0.5) {
        const [dx, dy] = this.randomDir();
        this.drift(i, x + dx, y + dy);
      }
      return;
    }
    if (Math.random() < 0.75) {
      const px = -gy;
      const py = gx;
      const wobble = Math.random() < 0.35 ? side : 0;
      if (this.drift(i, x - gx + px * wobble, y - gy + py * wobble)) return;
      this.drift(i, x - gx, y - gy);
    }
  }

  private randomDir(): [number, number] {
    const k = (Math.random() * 4) | 0;
    return ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][])[k];
  }

  /** Heat spreads between neighbouring cells and leaks away into the air. */
  private diffuse() {
    const { gw, gh, temp, type } = this;
    for (let y = 1; y < gh - 1; y++) {
      for (let x = 1; x < gw - 1; x++) {
        const i = y * gw + x;
        const t = type[i];
        if (t === FIRE || t === COAL) continue;
        const avg = (temp[i - 1] + temp[i + 1] + temp[i - gw] + temp[i + gw]) * 0.25;
        // Solids and liquids hold heat; air loses it fast.
        const k = t === EMPTY || t === SMOKE || t === STEAM ? 0.35 : 0.12;
        temp[i] += (avg - temp[i]) * k;
        temp[i] += (AMBIENT - temp[i]) * (t === EMPTY ? 0.02 : 0.004);
      }
    }
  }

  /** Puts the selected material in a disc of cells. */
  private paint(cx: number, cy: number, radius: number) {
    const tool = TOOLS[this.tool];
    if (tool.kind !== 'material') return;
    const m = tool.material!;
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (!this.inside(x, y) || (x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
        const i = y * this.gw + x;
        if (m === ERASE) {
          if (this.type[i] !== COAL) this.set(i, EMPTY, 0, 0, AMBIENT);
          continue;
        }
        // Loose materials go down speckled; solid ones fill the brush.
        if (this.type[i] !== EMPTY || (m !== WALL && m !== WOOD && Math.random() < 0.4)) continue;
        if (m === FIRE) this.set(i, FIRE, 0, 40 + Math.random() * 40, 900);
        else this.set(i, m, tool.element ?? 0, 0, AMBIENT);
      }
    }
  }

  private read(e: number) {
    const el = ELEMENTS[e];
    if (!el) return;
    this.reading = { text: `${el.name} (${el.symbol}) · ${el.colorName}`, color: el.flame, until: this.time + 2.5 };
  }

  // ---- scene ----

  /** Centre of the coal bed, in cells. */
  private fireSpot() {
    return { x: Math.floor(this.gw / 2), y: this.gh - Math.round(16 * (4 / this.cell)) };
  }

  private buildScene() {
    const { gw, gh } = this;
    const rand = seeded(9);
    const fill = (x: number, y: number, t: number, e = 0) => {
      if (this.inside(x, y)) this.set(y * gw + x, t, e);
    };
    const floor = gh - Math.round(12 * (4 / this.cell));
    for (let y = floor; y < gh; y++) for (let x = 0; x < gw; x++) fill(x, y, WALL);

    // Dunes on the left.
    for (let x = 0; x < gw * 0.3; x++) {
      const h = Math.round((noise1(x * 0.04 + 2) * 0.8 + 0.2) * 16 * (1 - x / (gw * 0.3)) ** 0.6);
      for (let y = floor - h; y < floor; y++) fill(x, y, SAND);
    }

    // A basin of water on the right.
    const bx0 = Math.round(gw * 0.7);
    const bx1 = Math.round(gw * 0.94);
    const depth = 10;
    for (let y = floor - depth - 2; y < floor; y++) {
      fill(bx0, y, WALL);
      fill(bx1, y, WALL);
    }
    for (let y = floor - depth; y < floor; y++) for (let x = bx0 + 1; x < bx1; x++) fill(x, y, WATER);

    // The campfire: a mound of coal in a ring of stones, with logs leaning on it.
    const fire = this.fireSpot();
    const bed = floor - 1;
    for (let k = -9; k <= 9; k++) {
      const h = Math.round(4 - Math.abs(k) * 0.35);
      for (let y = bed - h; y <= bed; y++) fill(fire.x + k, y, COAL);
    }
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) for (let y = bed - 3 + k; y <= bed; y++) fill(fire.x + side * (11 + k), y, WALL);
    }
    // A woodpile to the left of the fire, for the visitor to push into it.
    for (let y = floor - 6; y < floor; y++) {
      for (let x = Math.round(gw * 0.36); x < Math.round(gw * 0.36) + 12; x++) if (rand() < 0.95) fill(x, y, WOOD);
    }
  }

  // ---- drawing ----

  private render() {
    const g = this.pix.getContext('2d');
    if (!g) return;
    this.image ??= g.createImageData(this.gw, this.gh);
    const data = this.image.data;
    const { type, aux, life, shade, temp, view } = this;
    const weightless = this.gx === 0 && this.gy === 0;
    for (let i = 0; i < type.length; i++) {
      const o = i * 4;
      const t = type[i];
      if (view === 'thermal') {
        const [r, gg, b] = ironColor(temp[i]);
        data[o] = r;
        data[o + 1] = gg;
        data[o + 2] = b;
        data[o + 3] = 255;
        continue;
      }
      let r = 0;
      let gg = 0;
      let b = 0;
      let a = 255;
      const v = shade[i] / 255;
      switch (t) {
        case EMPTY:
          a = 0;
          break;
        case WALL:
          r = 52 + v * 14;
          gg = 50 + v * 12;
          b = 60 + v * 14;
          break;
        case SAND:
          r = 206 + v * 30;
          gg = 168 + v * 26;
          b = 98 + v * 20;
          break;
        case WATER:
          r = 40 + v * 20;
          gg = 110 + v * 30;
          b = 210 + v * 30;
          a = 225;
          break;
        case OIL:
          r = 92 + v * 20;
          gg = 62 + v * 14;
          b = 28 + v * 10;
          break;
        case WOOD:
          r = 118 + v * 30;
          gg = 74 + v * 20;
          b = 40 + v * 12;
          break;
        case ASH:
          r = gg = b = 140 + v * 40;
          break;
        case SALT: {
          [r, gg, b] = hexRgb(ELEMENTS[aux[i]]?.salt ?? '#e8e8e8');
          r *= 0.85 + v * 0.15;
          gg *= 0.85 + v * 0.15;
          b *= 0.85 + v * 0.15;
          break;
        }
        case COAL: {
          const glow = 0.5 + 0.5 * noise1(this.time * 2 + i * 0.37);
          r = 90 + glow * 150;
          gg = 30 + glow * 60;
          b = 16;
          break;
        }
        case FIRE: {
          // Fresh flame is bright; it reddens as it burns down. Salts colour it, and without
          // gravity it burns blue.
          const k = clamp(life[i] / 60, 0, 1);
          const tint = ELEMENTS[aux[i]];
          if (tint) {
            const [tr, tg, tb] = hexRgb(tint.flame);
            r = tr * (0.6 + 0.4 * k) + 60 * k;
            gg = tg * (0.6 + 0.4 * k) + 60 * k;
            b = tb * (0.6 + 0.4 * k) + 60 * k;
          } else if (weightless) {
            r = 70 + 120 * k;
            gg = 140 + 100 * k;
            b = 255;
          } else {
            r = 255;
            gg = 70 + 170 * k;
            b = 20 + 140 * k * k;
          }
          a = 200 + 55 * k;
          break;
        }
        case SMOKE:
          r = gg = b = 70 + v * 20;
          a = clamp(life[i] * 1.6, 0, 150);
          break;
        case STEAM:
          r = 200;
          gg = 210;
          b = 225;
          a = clamp(life[i] * 1.4, 0, 140);
          break;
      }
      if (view === 'night') {
        // An image intensifier: brightness only, in green, with grain.
        const lum = (a / 255) * (0.3 * r + 0.59 * gg + 0.11 * b) * 1.6 + 18 + Math.random() * 14;
        data[o] = lum * 0.25;
        data[o + 1] = clamp(lum, 0, 255);
        data[o + 2] = lum * 0.3;
        data[o + 3] = 255;
        continue;
      }
      data[o] = clamp(r, 0, 255);
      data[o + 1] = clamp(gg, 0, 255);
      data[o + 2] = clamp(b, 0, 255);
      data[o + 3] = a;
    }
    g.putImageData(this.image, 0, 0);
  }

  /** The flame-test read-out by the fire, and the temperature under the pointer in thermal view. */
  private drawReadings(ctx: CanvasRenderingContext2D) {
    const s = Math.max(this.scale, 0.85);
    ctx.textBaseline = 'middle';
    if (this.reading && this.time < this.reading.until) {
      const f = this.fireSpot();
      const alpha = clamp((this.reading.until - this.time) / 0.5, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.font = `600 ${Math.round(13 * s)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const x = f.x * this.cell;
      const y = (f.y - 42) * this.cell;
      const w = ctx.measureText(this.reading.text).width + 28 * s;
      ctx.fillStyle = 'rgba(8, 9, 14, 0.8)';
      ctx.fillRect(x - w / 2, y - 13 * s, w, 26 * s);
      ctx.fillStyle = this.reading.color;
      ctx.fillRect(x - w / 2 + 8 * s, y - 4 * s, 8 * s, 8 * s);
      ctx.fillStyle = '#f2f2f6';
      ctx.fillText(this.reading.text, x + 6 * s, y);
      ctx.globalAlpha = 1;
    }
    const p = this.pointer;
    if (this.view === 'thermal' && p && this.toolAt(p.x, p.y) < 0) {
      const cx = clamp(Math.floor(p.x / this.cell), 0, this.gw - 1);
      const cy = clamp(Math.floor(p.y / this.cell), 0, this.gh - 1);
      const t = this.temp[cy * this.gw + cx];
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - 8, p.y);
      ctx.lineTo(p.x + 8, p.y);
      ctx.moveTo(p.x, p.y - 8);
      ctx.lineTo(p.x, p.y + 8);
      ctx.stroke();
      ctx.font = `600 ${Math.round(13 * s)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${Math.round(t)}°C`, p.x + 12, p.y - 12);
    }
  }

  /**
   * Where each toolbar button sits: materials, then view and gravity, laid out in rows across the
   * top (below the theme dots), wrapping on narrow screens.
   */
  private toolbar() {
    const s = Math.max(this.scale, 0.85);
    const size = Math.round(30 * s);
    const gap = Math.round(5 * s);
    const margin = Math.round(12 * s);
    const top = Math.round(50 * s);
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    let row = 0;
    let x = margin;
    TOOLS.forEach((tool, i) => {
      const w = tool.kind === 'view' ? size * 2.6 : tool.label.length > 2 ? size * 1.7 : size;
      // A wider gap between the materials and the controls.
      const extra = i > 0 && tool.kind !== 'material' && TOOLS[i - 1].kind === 'material' ? gap * 3 : 0;
      if (x > margin && x + extra + w > this.width - margin) {
        row++;
        x = margin;
      } else {
        x += extra;
      }
      rects.push({ x, y: top + row * (size + gap), w, h: size });
      x += w + gap;
    });
    return { rects, size };
  }

  private toolAt(x: number, y: number) {
    return this.toolbar().rects.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  }

  private useTool(index: number) {
    const tool = TOOLS[index];
    if (tool.kind === 'material') this.tool = index;
    else if (tool.kind === 'view') this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length];
    else if (tool.gravity) [this.gx, this.gy] = tool.gravity;
  }

  private drawToolbar(ctx: CanvasRenderingContext2D) {
    const { rects, size } = this.toolbar();
    const s = Math.max(this.scale, 0.85);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    TOOLS.forEach((tool, i) => {
      const r = rects[i];
      const active =
        (tool.kind === 'material' && i === this.tool) ||
        (tool.kind === 'gravity' && tool.gravity![0] === this.gx && tool.gravity![1] === this.gy);
      ctx.fillStyle = 'rgba(14, 15, 22, 0.85)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (tool.kind === 'material') {
        ctx.fillStyle = tool.color;
        ctx.fillRect(r.x + 4 * s, r.y + r.h - 7 * s, r.w - 8 * s, 3 * s);
      }
      ctx.strokeStyle = active ? '#ffd27a' : 'rgba(200, 205, 220, 0.35)';
      ctx.lineWidth = active ? 2 : 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = '#eef0f6';
      ctx.font = `600 ${Math.round((tool.label.length > 2 ? 10 : 12) * s)}px ui-sans-serif, system-ui, sans-serif`;
      const label = tool.kind === 'view' ? `${tool.label}: ${VIEW_LABEL[this.view]}` : tool.label;
      ctx.fillText(label, r.x + r.w / 2, r.y + size * 0.42);
    });
  }
}

export const scienceTheme: FireTheme = {
  id: 'science',
  label: 'Science',
  palette: {
    titleFrom: '#e8f6ff',
    titleTo: '#7fd0ff',
    titleGlow: 'rgba(120, 200, 255, 0.35)',
    ambient: '#10131c',
  },
  letters: { knock: 'touch', draggable: true, item: false },
  createRenderer: () => new SandLab(),
};
