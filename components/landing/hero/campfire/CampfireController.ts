import type { PointerTracker } from '../PointerTracker';
import type { FireRenderer, FireTheme } from './types';

interface CampfireOptions {
  canvas: HTMLCanvasElement;
  /** Element the canvas covers; receives pointer interaction. */
  surface: HTMLElement;
  pointer: PointerTracker;
}

/**
 * Runs the active theme's renderer on the hero canvas: sizing, the frame loop,
 * pausing while off-screen, and routing clicks to the fire.
 */
export class CampfireController {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly reducedMotion: MediaQueryList;
  private readonly resizeObserver: ResizeObserver;
  private readonly visibilityObserver: IntersectionObserver;
  private renderer: FireRenderer | null = null;
  private theme: FireTheme | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private time = 0;
  private last = 0;
  private raf = 0;
  private visible = true;
  private overFire = false;

  constructor(private readonly opts: CampfireOptions) {
    this.ctx = opts.canvas.getContext('2d');
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(opts.canvas);
    this.visibilityObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.start();
      else this.stop();
    });
    this.visibilityObserver.observe(opts.canvas);
    opts.surface.addEventListener('pointerdown', this.onPointerDown);
    this.resize();
  }

  setTheme(theme: FireTheme) {
    if (this.theme?.id === theme.id) return;
    this.renderer?.dispose?.();
    this.theme = theme;
    this.time = 0;
    this.renderer = theme.createRenderer();
    this.renderer.resize(this.width, this.height);
    this.start();
  }

  isInFire(x: number, y: number, margin = 0) {
    const zone = this.renderer?.hotZone();
    if (!zone) return false;
    return (
      x >= zone.x - margin &&
      x <= zone.x + zone.width + margin &&
      y >= zone.y - margin &&
      y <= zone.y + zone.height + margin
    );
  }

  feed(x: number, y: number, fuel: number) {
    this.renderer?.feed(x, y, fuel);
  }

  destroy() {
    this.stop();
    this.resizeObserver.disconnect();
    this.visibilityObserver.disconnect();
    this.opts.surface.removeEventListener('pointerdown', this.onPointerDown);
    this.opts.surface.classList.remove('is-over-fire');
    this.renderer?.dispose?.();
    this.renderer = null;
    this.theme = null;
  }

  private resize() {
    const { canvas } = this.opts;
    const rect = canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(this.width * this.dpr);
    canvas.height = Math.round(this.height * this.dpr);
    this.renderer?.resize(this.width, this.height);
  }

  private start() {
    if (this.raf || !this.visible || !this.renderer) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const { ctx, renderer } = this;
    if (!ctx || !renderer) return;

    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.time += dt;

    const pointer = this.opts.pointer.sample(now);
    renderer.update({ time: this.time, dt, pointer, reducedMotion: this.reducedMotion.matches });

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.width, this.height);
    renderer.draw(ctx);

    const overFire = !!pointer && this.isInFire(pointer.x, pointer.y);
    if (overFire !== this.overFire) {
      this.overFire = overFire;
      this.opts.surface.classList.toggle('is-over-fire', overFire);
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('[data-letter], .title-letter-body, a, button')) return;
    const { x, y } = this.opts.pointer.toLocal(e.clientX, e.clientY);
    if (this.isInFire(x, y, 24)) this.renderer?.stoke(x, y);
  };
}
