/**
 * Contract every campfire theme implements.
 *
 * A theme owns everything drawn on the hero canvas (flames, embers, logs…)
 * and reacts to the hero's interactions. To add a theme (Doom, Minecraft, …)
 * implement `FireTheme` and register it in `themes/index.ts`.
 */

export interface PointerSample {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface FireFrame {
  /** Seconds since the renderer started. */
  time: number;
  /** Seconds since the previous frame (clamped). */
  dt: number;
  /** Pointer in canvas CSS pixels, or null when it is outside the hero. */
  pointer: PointerSample | null;
  reducedMotion: boolean;
}

/** Area (canvas CSS pixels) that counts as "in the fire" — letters burn here, clicks stoke here. */
export interface HotZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FireRenderer {
  resize(width: number, height: number): void;
  update(frame: FireFrame): void;
  draw(ctx: CanvasRenderingContext2D): void;
  hotZone(): HotZone;
  /** User poked the fire. */
  stoke(x: number, y: number): void;
  /** Something (e.g. a title letter) was thrown into the fire. */
  feed(x: number, y: number, fuel: number): void;
  dispose?(): void;
}

/** Colors applied to the hero around the canvas, exposed as CSS custom properties. */
export interface FirePalette {
  titleFrom: string;
  titleTo: string;
  titleGlow: string;
  ambient: string;
}

export interface FireTheme {
  id: string;
  label: string;
  palette: FirePalette;
  createRenderer(): FireRenderer;
}
