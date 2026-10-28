import type { PointerSample } from './campfire/types';

/** Tracks the pointer over the hero in local coordinates, with a smoothed velocity. */
export class PointerTracker {
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private inside = false;
  private down = false;
  private lastTime = 0;

  constructor(private readonly surface: HTMLElement) {
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointerleave', this.onLeave);
    surface.addEventListener('pointerup', this.onRelease);
    surface.addEventListener('pointercancel', this.onRelease);
  }

  /** Current pointer, or null when it isn't over the hero. Velocity decays once the pointer stops. */
  sample(now = performance.now()): PointerSample | null {
    if (!this.inside) return null;
    const idle = Math.max(0, (now - this.lastTime) / 1000 - 0.05);
    const decay = Math.exp(-idle * 14);
    return { x: this.x, y: this.y, vx: this.vx * decay, vy: this.vy * decay, down: this.down };
  }

  toLocal(clientX: number, clientY: number) {
    const rect = this.surface.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  destroy() {
    this.surface.removeEventListener('pointermove', this.onMove);
    this.surface.removeEventListener('pointerdown', this.onDown);
    this.surface.removeEventListener('pointerleave', this.onLeave);
    this.surface.removeEventListener('pointerup', this.onRelease);
    this.surface.removeEventListener('pointercancel', this.onRelease);
  }

  private onMove = (e: PointerEvent) => {
    const { x, y } = this.toLocal(e.clientX, e.clientY);
    const dt = (e.timeStamp - this.lastTime) / 1000;
    if (this.inside && dt > 0.001 && dt < 0.12) {
      this.vx += ((x - this.x) / dt - this.vx) * 0.5;
      this.vy += ((y - this.y) / dt - this.vy) * 0.5;
    } else if (!this.inside || dt >= 0.12) {
      this.vx = 0;
      this.vy = 0;
    }
    this.x = x;
    this.y = y;
    this.lastTime = e.timeStamp;
    this.inside = true;
  };

  private onDown = (e: PointerEvent) => {
    this.down = !(e.target as Element).closest('[data-letter], .title-letter-body, a, button');
    this.onMove(e);
  };

  // Touch has no hover: once the finger lifts, or the browser takes it over to scroll, it's gone.
  private onRelease = (e: PointerEvent) => {
    this.down = false;
    if (e.pointerType === 'touch') this.inside = false;
  };

  private onLeave = (e: PointerEvent) => {
    // Captured pointers (dragged letters) still count as inside.
    if (e.target === this.surface) this.inside = false;
  };
}
