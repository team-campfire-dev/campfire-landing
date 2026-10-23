/**
 * Contract every campfire theme implements.
 *
 * A theme owns everything drawn on the hero canvas (flames, embers, logs…),
 * reacts to the hero's interactions, and decides how the title letters behave.
 * To add a theme implement `FireTheme` and register it in `themes/index.ts`.
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

/** Area (canvas CSS pixels) that counts as "in the fire" — letters burn here. */
export interface HotZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A click or tap anywhere on the hero. */
export interface FireTap {
  x: number;
  y: number;
  /** Inside the hot zone. */
  onFire: boolean;
  /** On a title letter (in the heading or fallen). */
  onLetter: boolean;
}

/** Effects a renderer can trigger outside its canvas. */
export interface FireHost {
  /** Shakes the whole hero for a moment; `strength` is roughly the offset in px. */
  shake(strength: number): void;
}

export interface FireRenderer {
  resize(width: number, height: number): void;
  update(frame: FireFrame): void;
  draw(ctx: CanvasRenderingContext2D): void;
  /** Null while nothing can burn (e.g. an extinguished campfire). */
  hotZone(): HotZone | null;
  /** Y where fallen letters come to rest; defaults to the bottom of the hero. */
  groundY?(): number;
  tap(tap: FireTap): void;
  /** Something (e.g. a title letter) was thrown into the fire. */
  feed(x: number, y: number, fuel: number): void;
  dispose?(): void;
}

/** How title letters react in a theme. */
export interface LetterBehavior {
  /** `touch`: hovering or touching knocks a letter loose. `shoot`: clicking/tapping blasts it off. */
  knock: 'touch' | 'shoot';
  /** Fallen letters can be picked up and thrown. */
  draggable: boolean;
  /** Fallen letters shrink and float like dropped items. */
  item: boolean;
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
  letters: LetterBehavior;
  createRenderer(host: FireHost): FireRenderer;
}
