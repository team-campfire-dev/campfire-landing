import type { PointerTracker } from '../PointerTracker';
import type { FireHost, FireRenderer, FireTheme } from './types';

interface CampfireOptions {
  canvas: HTMLCanvasElement;
  /** Element the canvas covers; receives pointer interaction. */
  surface: HTMLElement;
  pointer: PointerTracker;
}

/**
 * Runs the active theme's renderer on the hero canvas: sizing, the frame loop,
 * pausing while off-screen, and routing taps to the theme.
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
    opts.surface.addEventListener('click', this.onClick);
    this.resize();
  }

  setTheme(theme: FireTheme) {
    if (this.theme?.id === theme.id) return;
    this.renderer?.dispose?.();
    this.theme = theme;
    this.time = 0;
    this.renderer = theme.createRenderer(this.host);
    this.renderer.resize(this.width, this.height);
    this.start();
  }

  isInFire(x: number, y: number, margin = 0) {
    return this.fireDistance(x, y) <= margin;
  }

  /** Px from a point to the hot zone: 0 inside it, Infinity while nothing can burn. */
  fireDistance(x: number, y: number) {
    const zone = this.renderer?.hotZone();
    if (!zone) return Infinity;
    const dx = Math.max(zone.x - x, 0, x - (zone.x + zone.width));
    const dy = Math.max(zone.y - y, 0, y - (zone.y + zone.height));
    return Math.hypot(dx, dy);
  }

  /** Where fallen letters rest at `x`, in surface coordinates. */
  groundY(x: number): number | null {
    return this.renderer?.groundY?.(x) ?? null;
  }

  feed(x: number, y: number, fuel: number, letter?: string) {
    this.renderer?.feed(x, y, fuel, letter);
  }

  /** Gravity for fallen letters, or null for the usual straight down. */
  gravity() {
    return this.renderer?.gravity?.() ?? null;
  }

  /** Whether a mouse drag starting at this client point belongs to the renderer. */
  claimsDrag(clientX: number, clientY: number) {
    const { x, y } = this.opts.pointer.toLocal(clientX, clientY);
    return this.renderer?.claimsDrag?.(x, y) ?? false;
  }

  destroy() {
    this.stop();
    this.resizeObserver.disconnect();
    this.visibilityObserver.disconnect();
    this.opts.surface.removeEventListener('click', this.onClick);
    this.opts.surface.classList.remove('is-over-fire');
    this.renderer?.dispose?.();
    this.renderer = null;
    this.theme = null;
  }

  private resize() {
    const { canvas } = this.opts;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (rect.width === this.width && rect.height === this.height && dpr === this.dpr) return;
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = dpr;
    // Resizing wipes the canvas, and this runs after the frame was drawn — redraw now, or the
    // browser paints an empty canvas. On mobile the height changes every frame while the
    // toolbar collapses during a scroll, which made the fire vanish.
    canvas.width = Math.round(this.width * this.dpr);
    canvas.height = Math.round(this.height * this.dpr);
    this.renderer?.resize(this.width, this.height);
    this.paint();
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

    this.paint();

    const overFire = !!pointer && this.isInFire(pointer.x, pointer.y);
    if (overFire !== this.overFire) {
      this.overFire = overFire;
      this.opts.surface.classList.toggle('is-over-fire', overFire);
    }
  };

  private paint() {
    const { ctx, renderer } = this;
    if (!ctx || !renderer) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.width, this.height);
    renderer.draw(ctx);
  }

  private readonly host: FireHost = {
    shake: (strength) => {
      if (this.reducedMotion.matches) return;
      const s = strength;
      this.opts.surface.animate(
        [
          { transform: 'translate(0, 0)' },
          { transform: `translate(${-s}px, ${s * 0.6}px)` },
          { transform: `translate(${s * 0.7}px, ${-s * 0.4}px)` },
          { transform: `translate(${-s * 0.3}px, ${s * 0.2}px)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 160, easing: 'ease-out' },
      );
    },
  };

  // `click` rather than pointerdown, so a touch that starts a scroll isn't a tap.
  private onClick = (e: MouseEvent) => {
    const target = e.target as Element;
    if (target.closest('a, button')) return;
    const { x, y } = this.opts.pointer.toLocal(e.clientX, e.clientY);
    this.renderer?.tap({
      x,
      y,
      onFire: this.isInFire(x, y, 24),
      onLetter: !!target.closest('[data-letter], .title-letter-body'),
    });
  };
}
