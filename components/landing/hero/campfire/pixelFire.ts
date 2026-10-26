/**
 * The PSX DOOM fire: a grid of heat values where each cell copies the heat of the
 * cell below it into a randomly offset cell above, sometimes losing one step.
 * Shared by the pixel-art themes.
 */
export class PixelFire {
  cells: Uint8Array;

  constructor(
    public width: number,
    public height: number,
    public readonly maxHeat: number,
  ) {
    this.cells = new Uint8Array(width * height);
  }

  /** Keeps the current flames, anchored to the bottom row, so a resize doesn't put the fire out. */
  resize(width: number, height: number) {
    const old = this.cells;
    const oldWidth = this.width;
    const oldHeight = this.height;
    this.width = width;
    this.height = height;
    this.cells = new Uint8Array(width * height);
    const rows = Math.min(height, oldHeight);
    const cols = Math.min(width, oldWidth);
    for (let r = 1; r <= rows; r++) {
      const from = (oldHeight - r) * oldWidth;
      this.cells.set(old.subarray(from, from + cols), (height - r) * width);
    }
  }

  /** Sets the bottom row, which feeds the whole fire. */
  setSource(heat: (x: number) => number) {
    const row = (this.height - 1) * this.width;
    for (let x = 0; x < this.width; x++) {
      this.cells[row + x] = Math.max(0, Math.min(this.maxHeat, Math.round(heat(x))));
    }
  }

  /**
   * One tick of spread. `decay` is the chance a cell loses heat as it rises (lower → taller fire);
   * `wind` in [-1, 1] skews the sideways drift.
   */
  step(decay: number, wind = 0) {
    const { width, height, cells } = this;
    const windStep = Math.sign(wind);
    const windChance = Math.abs(wind);
    // As in the original, heat is lost on odd drift offsets, so drift and decay stay correlated —
    // that correlation is what forms the flame tongues. `decay` rescales how often it happens.
    const oddLoss = Math.min(1, decay * 2);
    const evenLoss = Math.max(0, decay * 2 - 1);
    for (let x = 0; x < width; x++) {
      for (let y = 1; y < height; y++) {
        const src = y * width + x;
        const heat = cells[src];
        if (heat === 0) {
          cells[src - width] = 0;
          continue;
        }
        const r = Math.round(Math.random() * 3) & 3;
        let dx = x - r + 1;
        if (Math.random() < windChance) dx += windStep;
        if (dx < 0) dx = 0;
        else if (dx >= width) dx = width - 1;
        const loss = Math.random() < (r & 1 ? oddLoss : evenLoss) ? 1 : 0;
        cells[(y - 1) * width + dx] = Math.max(0, heat - loss);
      }
    }
  }

  /** Adds a disc of heat (grid coordinates). */
  heat(cx: number, cy: number, radius: number, amount: number) {
    this.forDisc(cx, cy, radius, (i, falloff) => {
      this.cells[i] = Math.min(this.maxHeat, this.cells[i] + Math.round(amount * falloff));
    });
  }

  /** Scales heat down inside a disc (grid coordinates). */
  cool(cx: number, cy: number, radius: number, keep: number) {
    this.forDisc(cx, cy, radius, (i, falloff) => {
      this.cells[i] = Math.floor(this.cells[i] * (1 - (1 - keep) * falloff));
    });
  }

  clear() {
    this.cells.fill(0);
  }

  private forDisc(cx: number, cy: number, radius: number, fn: (index: number, falloff: number) => void) {
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    // Never touch the source row.
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(this.height - 2, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= radius) fn(y * this.width + x, 1 - d / (radius + 1));
      }
    }
  }
}

/** Packs `#rrggbb` colors into little-endian RGBA words for an ImageData Uint32 view; index 0 is transparent. */
export function packPalette(colors: string[]): Uint32Array {
  const out = new Uint32Array(colors.length + 1);
  colors.forEach((hex, i) => {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    out[i + 1] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  });
  return out;
}

/** Blits a fire grid onto an offscreen canvas, one pixel per cell, using a packed palette. */
export class PixelFireCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private image: ImageData | null = null;
  private pixels: Uint32Array | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  render(fire: PixelFire, palette: Uint32Array) {
    const { ctx } = this;
    if (!ctx) return this.canvas;
    if (!this.image || this.image.width !== fire.width || this.image.height !== fire.height) {
      this.canvas.width = fire.width;
      this.canvas.height = fire.height;
      this.image = ctx.createImageData(fire.width, fire.height);
      this.pixels = new Uint32Array(this.image.data.buffer);
    }
    const pixels = this.pixels!;
    const last = palette.length - 1;
    // Heat maps onto the palette proportionally, so any maxHeat works with any palette length.
    const scale = last / fire.maxHeat;
    for (let i = 0; i < fire.cells.length; i++) {
      const heat = fire.cells[i];
      pixels[i] = heat === 0 ? 0 : palette[Math.max(1, Math.round(heat * scale))];
    }
    ctx.putImageData(this.image, 0, 0);
    return this.canvas;
  }
}
