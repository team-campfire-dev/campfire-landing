import type { PointerTracker } from './PointerTracker';

export interface FireTarget {
  isInFire(x: number, y: number): boolean;
  feed(x: number, y: number, fuel: number): void;
}

interface LetterPhysicsOptions {
  /** Title whose `[data-letter]` spans can be knocked loose. */
  title: HTMLElement;
  /** Absolutely positioned layer covering `surface`; falling letters live here. */
  layer: HTMLElement;
  surface: HTMLElement;
  pointer: PointerTracker;
  fire: FireTarget;
}

type BodyState = 'flying' | 'dragging' | 'burning' | 'fading';

interface LetterBody {
  span: HTMLElement;
  el: HTMLElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  w: number;
  h: number;
  radius: number;
  state: BodyState;
  /** Seconds spent resting (flying) or in the current burn/fade. */
  timer: number;
  pointerId: number | null;
  targetX: number;
  targetY: number;
  grabX: number;
  grabY: number;
  cleanup: () => void;
}

const GRAVITY = 2400;
const BOUNCE = 0.32;
const REST_SECONDS = 9;
const BURN_SECONDS = 0.9;
const FADE_SECONDS = 0.6;
const RETURN_DELAY_MS = 1600;
const REKINDLE_MS = 900;
const MAX_THROW = 2400;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Lets title letters be knocked out of the heading: they fall with gravity, bounce,
 * pile up, can be grabbed and thrown, and burn up when they land in the fire.
 */
export class LetterPhysics {
  private bodies: LetterBody[] = [];
  private raf = 0;
  private last = 0;
  private readonly timers = new Set<number>();
  private readonly unbind: Array<() => void> = [];

  constructor(private readonly opts: LetterPhysicsOptions) {
    opts.title.querySelectorAll<HTMLElement>('[data-letter]').forEach((span) => {
      const onEnter = (e: PointerEvent) => {
        if (e.pointerType === 'mouse') this.release(span, null);
      };
      const onDown = (e: PointerEvent) => this.release(span, e);
      span.addEventListener('pointerenter', onEnter);
      span.addEventListener('pointerdown', onDown);
      this.unbind.push(() => {
        span.removeEventListener('pointerenter', onEnter);
        span.removeEventListener('pointerdown', onDown);
        delete span.dataset.state;
      });
    });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers.clear();
    for (const body of this.bodies) {
      body.cleanup();
      body.el.remove();
    }
    this.bodies = [];
    this.unbind.forEach((fn) => fn());
  }

  /** Pops a letter out of the title, optionally straight into the user's hand. */
  private release(span: HTMLElement, grab: PointerEvent | null) {
    if (span.dataset.state === 'gone') return;
    const { layer, surface, pointer } = this.opts;
    const surfaceRect = surface.getBoundingClientRect();
    const rect = span.getBoundingClientRect();
    const style = getComputedStyle(span);

    const el = document.createElement('span');
    el.className = 'title-letter-body';
    el.textContent = span.textContent;
    el.setAttribute('aria-hidden', 'true');
    el.style.setProperty('--t0', span.style.getPropertyValue('--t0'));
    el.style.setProperty('--t1', span.style.getPropertyValue('--t1'));
    el.style.fontFamily = style.fontFamily;
    el.style.fontSize = style.fontSize;
    el.style.fontWeight = style.fontWeight;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
    el.style.lineHeight = `${rect.height}px`;
    layer.appendChild(el);
    span.dataset.state = 'gone';

    const velocity = pointer.sample() ?? { vx: 0, vy: 0 };
    const body: LetterBody = {
      span,
      el,
      x: rect.left - surfaceRect.left + rect.width / 2,
      y: rect.top - surfaceRect.top + rect.height / 2,
      vx: clamp(velocity.vx * 0.4, -900, 900) + rand(-60, 60),
      vy: clamp(velocity.vy * 0.4, -900, 900) - 160,
      angle: 0,
      spin: 0,
      w: rect.width,
      h: rect.height,
      radius: (rect.width + rect.height) * 0.22,
      state: 'flying',
      timer: 0,
      pointerId: null,
      targetX: 0,
      targetY: 0,
      grabX: 0,
      grabY: 0,
      cleanup: () => {},
    };
    body.spin = rand(-4, 4) + body.vx * 0.006;
    body.cleanup = this.bindBody(body);
    this.bodies.push(body);
    this.render(body);

    if (grab) this.grab(body, grab);
    this.start();
  }

  private bindBody(body: LetterBody) {
    const { el } = body;
    const onDown = (e: PointerEvent) => this.grab(body, e);
    const onMove = (e: PointerEvent) => {
      if (body.state !== 'dragging' || e.pointerId !== body.pointerId) return;
      const p = this.opts.pointer.toLocal(e.clientX, e.clientY);
      body.targetX = p.x - body.grabX;
      body.targetY = p.y - body.grabY;
    };
    const onUp = (e: PointerEvent) => {
      if (body.state !== 'dragging' || e.pointerId !== body.pointerId) return;
      this.drop(body);
    };
    const onEnter = (e: PointerEvent) => {
      // Brushing a fallen letter with the mouse nudges it along.
      if (e.pointerType !== 'mouse' || body.state !== 'flying') return;
      const v = this.opts.pointer.sample();
      if (!v || Math.hypot(v.vx, v.vy) < 150) return;
      body.vx += clamp(v.vx * 0.5, -800, 800);
      body.vy += Math.min(v.vy * 0.5, 0) - 220;
      body.spin += rand(-5, 5);
      body.timer = 0;
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerenter', onEnter);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerenter', onEnter);
    };
  }

  private grab(body: LetterBody, e: PointerEvent) {
    if (body.state === 'burning' || body.state === 'fading') return;
    e.preventDefault();
    const p = this.opts.pointer.toLocal(e.clientX, e.clientY);
    body.state = 'dragging';
    body.pointerId = e.pointerId;
    body.grabX = p.x - body.x;
    body.grabY = p.y - body.y;
    body.targetX = body.x;
    body.targetY = body.y;
    body.timer = 0;
    body.el.classList.add('is-dragging');
    try {
      body.el.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone (e.g. a very short tap) — the letter simply falls.
      this.drop(body);
    }
  }

  private drop(body: LetterBody) {
    if (body.pointerId !== null && body.el.hasPointerCapture(body.pointerId)) {
      body.el.releasePointerCapture(body.pointerId);
    }
    body.pointerId = null;
    body.el.classList.remove('is-dragging');
    if (body.state !== 'dragging') return;
    body.state = 'flying';
    const v = this.opts.pointer.sample();
    if (v) {
      body.vx = clamp(v.vx, -MAX_THROW, MAX_THROW);
      body.vy = clamp(v.vy, -MAX_THROW, MAX_THROW);
    }
    body.spin += body.vx * 0.004;
  }

  private ignite(body: LetterBody) {
    if (body.state === 'dragging') this.drop(body);
    body.state = 'burning';
    body.timer = 0;
    body.el.classList.add('is-burning');
    this.opts.fire.feed(body.x, body.y, 1);
  }

  private fade(body: LetterBody) {
    body.state = 'fading';
    body.timer = 0;
    body.el.classList.add('is-fading');
  }

  /** Removes the falling copy and grows the letter back in the title. */
  private retire(body: LetterBody) {
    body.cleanup();
    body.el.remove();
    const { span } = body;
    const back = window.setTimeout(() => {
      this.timers.delete(back);
      span.dataset.state = 'returning';
      const settle = window.setTimeout(() => {
        this.timers.delete(settle);
        if (span.dataset.state === 'returning') delete span.dataset.state;
      }, REKINDLE_MS);
      this.timers.add(settle);
    }, RETURN_DELAY_MS);
    this.timers.add(back);
  }

  private start() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    const dt = Math.min((now - this.last) / 1000, 1 / 30);
    this.last = now;
    const width = this.opts.surface.clientWidth;
    const height = this.opts.surface.clientHeight;

    for (let step = 0; step < 2; step++) {
      for (const body of this.bodies) this.integrate(body, dt / 2, width, height);
      this.collide();
    }

    this.bodies = this.bodies.filter((body) => {
      const done =
        (body.state === 'burning' && body.timer >= BURN_SECONDS) ||
        (body.state === 'fading' && body.timer >= FADE_SECONDS);
      if (done) this.retire(body);
      else this.render(body);
      return !done;
    });

    this.raf = this.bodies.length ? requestAnimationFrame(this.tick) : 0;
  };

  private integrate(body: LetterBody, dt: number, width: number, height: number) {
    switch (body.state) {
      case 'burning':
        body.timer += dt;
        body.y -= 40 * dt;
        body.angle += body.spin * dt * 0.3;
        return;
      case 'fading':
        body.timer += dt;
        return;
      case 'dragging': {
        const px = body.x;
        const py = body.y;
        const k = Math.min(1, dt * 30);
        body.x += (body.targetX - body.x) * k;
        body.y += (body.targetY - body.y) * k;
        body.vx = (body.x - px) / dt;
        body.vy = (body.y - py) / dt;
        // Swing with the drag like something held by one corner.
        const tilt = clamp(body.vx * 0.0006, -0.5, 0.5);
        body.spin = (tilt - body.angle) * 12;
        body.angle += body.spin * dt;
        break;
      }
      case 'flying': {
        body.vy += GRAVITY * dt;
        body.vx *= 1 - 0.25 * dt;
        body.spin *= 1 - 0.4 * dt;
        body.x += body.vx * dt;
        body.y += body.vy * dt;
        body.angle += body.spin * dt;

        const cos = Math.abs(Math.cos(body.angle));
        const sin = Math.abs(Math.sin(body.angle));
        const extentX = (body.w * cos + body.h * sin) / 2;
        const extentY = (body.w * sin + body.h * cos) / 2;

        if (body.x - extentX < 0) {
          body.x = extentX;
          body.vx = Math.abs(body.vx) * 0.5;
        } else if (body.x + extentX > width) {
          body.x = width - extentX;
          body.vx = -Math.abs(body.vx) * 0.5;
        }

        if (body.y + extentY >= height) {
          body.y = height - extentY;
          if (body.vy > 0) {
            body.vy = body.vy > 140 ? -body.vy * BOUNCE : 0;
            body.spin = body.spin * 0.6 + body.vx * 0.002;
          }
          body.vx *= Math.max(0, 1 - 5 * dt);
          // Topple onto whichever side is nearest.
          const rest = Math.round(body.angle / (Math.PI / 2)) * (Math.PI / 2);
          body.spin += (rest - body.angle) * 40 * dt;
          body.spin *= Math.max(0, 1 - 8 * dt);
          const still = Math.abs(body.vx) < 15 && Math.abs(body.vy) < 15 && Math.abs(body.spin) < 0.3;
          body.timer = still ? body.timer + dt : 0;
          if (body.timer > REST_SECONDS) this.fade(body);
        }
        break;
      }
    }

    if (this.opts.fire.isInFire(body.x, body.y)) this.ignite(body);
  }

  /** Cheap circle-vs-circle separation so fallen letters pile up instead of overlapping. */
  private collide() {
    const solid = this.bodies.filter((b) => b.state === 'flying' || b.state === 'dragging');
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const a = solid[i];
        const b = solid[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const ia = a.state === 'dragging' ? 0 : 1;
        const ib = b.state === 'dragging' ? 0 : 1;
        const total = ia + ib;
        if (!total) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const overlap = min - d;
        a.x -= nx * overlap * (ia / total);
        a.y -= ny * overlap * (ia / total);
        b.x += nx * overlap * (ib / total);
        b.y += ny * overlap * (ib / total);
        const approach = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (approach < 0) {
          const impulse = (-1.2 * approach) / total;
          a.vx -= impulse * nx * ia;
          a.vy -= impulse * ny * ia;
          b.vx += impulse * nx * ib;
          b.vy += impulse * ny * ib;
        }
      }
    }
  }

  private render(body: LetterBody) {
    const scale = body.state === 'burning' ? 1 - 0.35 * (body.timer / BURN_SECONDS) : 1;
    body.el.style.transform =
      `translate3d(${body.x - body.w / 2}px, ${body.y - body.h / 2}px, 0) ` +
      `rotate(${body.angle}rad) scale(${scale})`;
  }
}
