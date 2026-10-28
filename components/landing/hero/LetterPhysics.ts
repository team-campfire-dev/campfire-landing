import type { LetterBehavior } from './campfire/types';
import type { PointerTracker } from './PointerTracker';

export interface FireTarget {
  /** Px from a point to the hot zone: 0 inside it, Infinity while nothing can burn. */
  fireDistance(x: number, y: number): number;
  feed(x: number, y: number, fuel: number, letter?: string): void;
  /** Gravity's direction and strength; null means straight down. */
  gravity(): { x: number; y: number } | null;
  /** Where fallen letters rest at `x`; null means the bottom of the surface. */
  groundY(x: number): number | null;
}

interface LetterPhysicsOptions {
  /** Title whose `[data-letter]` spans can be knocked loose. */
  title: HTMLElement;
  /** Absolutely positioned layer covering `surface`; falling letters live here. */
  layer: HTMLElement;
  surface: HTMLElement;
  pointer: PointerTracker;
  fire: FireTarget;
  behavior: LetterBehavior;
}

type BodyState = 'flying' | 'dragging' | 'burning' | 'fading';

interface Launch {
  vx: number;
  vy: number;
  spin: number;
}

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
  /** Current size factor; dropped items shrink towards ITEM_SCALE. */
  scale: number;
  /** Floats, bobs and turns like a dropped item instead of tumbling. */
  item: boolean;
  phase: number;
  state: BodyState;
  /** Seconds spent resting (flying) or in the current burn/fade. */
  timer: number;
  grounded: boolean;
  pointerId: number | null;
  targetX: number;
  targetY: number;
  grabX: number;
  grabY: number;
  /** Where the current press started (client px), to tell a click from a drag. */
  pressX: number;
  pressY: number;
  /** 0 = cold, 1 = catches fire (see `LetterHeat`). */
  heat: number;
  /** Heat last written to the element's `--heat`. */
  shownHeat: number;
  /** How flat it has been hammered, 0..MAX_SQUASH. */
  squash: number;
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
const ITEM_SCALE = 0.7;
/** Near the fire (within `LetterHeat.reach`) letters heat at most this fraction of the in-fire rate. */
const NEAR_RATE = 0.45;
/** A letter must be at least this hot to give under the hammer. */
const MALLEABLE = 0.3;
const MAX_SQUASH = 0.55;
/** Pointer travel (px) beyond which a press is a drag, not a click. */
const CLICK_SLOP = 6;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Kick for a letter hit by a shot at (x, y): away from the impact and upwards. */
function blastFrom(x: number, y: number, cx: number, cy: number): Launch {
  const dx = cx - x;
  const dy = cy - y;
  const d = Math.hypot(dx, dy) || 1;
  return {
    vx: (dx / d) * 700 + rand(-200, 200),
    vy: Math.min((dy / d) * 500, 0) - rand(500, 900),
    spin: rand(-14, 14),
  };
}

/**
 * Lets title letters be pulled out of the heading: once pressed (or shot) they fall with
 * gravity, bounce, pile up, can be grabbed and thrown, and burn up when they land in the fire.
 * How they come loose and behave is set per theme (`LetterBehavior`).
 */
export class LetterPhysics {
  private bodies: LetterBody[] = [];
  private behavior: LetterBehavior;
  private raf = 0;
  private last = 0;
  private clock = 0;
  private readonly timers = new Set<number>();
  private readonly unbind: Array<() => void> = [];

  constructor(private readonly opts: LetterPhysicsOptions) {
    this.behavior = opts.behavior;
    opts.title.querySelectorAll<HTMLElement>('[data-letter]').forEach((span) => {
      // Letters stay put under a passing pointer; pressing one pulls it out into the hand.
      const onDown = (e: PointerEvent) => {
        if (this.behavior.knock !== 'touch') return;
        this.release(span, this.behavior.draggable ? e : undefined);
      };
      const onClick = (e: MouseEvent) => {
        if (this.behavior.knock !== 'shoot') return;
        const p = this.opts.pointer.toLocal(e.clientX, e.clientY);
        const rect = this.local(span.getBoundingClientRect());
        this.release(span, undefined, blastFrom(p.x, p.y, rect.x, rect.y));
      };
      span.addEventListener('pointerdown', onDown);
      span.addEventListener('click', onClick);
      this.unbind.push(() => {
        span.removeEventListener('pointerdown', onDown);
        span.removeEventListener('click', onClick);
        delete span.dataset.state;
      });
    });
  }

  setBehavior(behavior: LetterBehavior) {
    this.behavior = behavior;
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

  /** Center of a client rect in surface coordinates. */
  private local(rect: DOMRect) {
    const p = this.opts.pointer.toLocal(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { x: p.x, y: p.y };
  }

  /** Pops a letter out of the title, optionally straight into the user's hand or with a given kick. */
  private release(span: HTMLElement, grab?: PointerEvent, launch?: Launch) {
    if (span.dataset.state === 'gone') return;
    const { layer, pointer } = this.opts;
    const rect = span.getBoundingClientRect();
    const center = this.local(rect);
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
    const kick = launch ?? {
      vx: clamp(velocity.vx * 0.4, -900, 900) + rand(-60, 60),
      vy: clamp(velocity.vy * 0.4, -900, 900) - 160,
      spin: 0,
    };
    const body: LetterBody = {
      span,
      el,
      x: center.x,
      y: center.y,
      vx: kick.vx,
      vy: kick.vy,
      angle: 0,
      spin: launch ? kick.spin : rand(-4, 4) + kick.vx * 0.006,
      w: rect.width,
      h: rect.height,
      scale: 1,
      item: this.behavior.item,
      phase: rand(0, Math.PI * 2),
      state: 'flying',
      timer: 0,
      grounded: false,
      pointerId: null,
      targetX: 0,
      targetY: 0,
      grabX: 0,
      grabY: 0,
      pressX: 0,
      pressY: 0,
      heat: 0,
      shownHeat: 0,
      squash: 0,
      cleanup: () => {},
    };
    body.cleanup = this.bindBody(body);
    this.bodies.push(body);
    this.render(body);

    if (grab) this.grab(body, grab);
    this.start();
  }

  private bindBody(body: LetterBody) {
    const { el } = body;
    const onDown = (e: PointerEvent) => {
      if (this.behavior.draggable && this.behavior.knock === 'touch') this.grab(body, e);
    };
    const onClick = (e: MouseEvent) => {
      if (this.behavior.hammer && body.state === 'flying') {
        if (Math.hypot(e.clientX - body.pressX, e.clientY - body.pressY) <= CLICK_SLOP) this.strike(body);
        return;
      }
      if (this.behavior.knock !== 'shoot' || body.state !== 'flying') return;
      const p = this.opts.pointer.toLocal(e.clientX, e.clientY);
      const kick = blastFrom(p.x, p.y, body.x, body.y);
      body.vx = kick.vx;
      body.vy = kick.vy;
      body.spin = kick.spin;
      body.timer = 0;
    };
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
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('click', onClick);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('click', onClick);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }

  private grab(body: LetterBody, e: PointerEvent) {
    if (body.state === 'burning' || body.state === 'fading') return;
    e.preventDefault();
    const p = this.opts.pointer.toLocal(e.clientX, e.clientY);
    body.state = 'dragging';
    body.grounded = false;
    body.pointerId = e.pointerId;
    body.grabX = p.x - body.x;
    body.grabY = p.y - body.y;
    body.pressX = e.clientX;
    body.pressY = e.clientY;
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

  /** A hammer blow: hot letters flatten a little and hop, cold ones just ring. */
  private strike(body: LetterBody) {
    body.vy = Math.min(body.vy, -180);
    body.timer = 0;
    if (body.heat < MALLEABLE) return;
    body.squash = Math.min(MAX_SQUASH, body.squash + 0.08 + 0.12 * body.heat);
    body.heat = Math.max(0, body.heat - 0.04);
  }

  private ignite(body: LetterBody) {
    if (body.state === 'dragging') this.drop(body);
    body.state = 'burning';
    body.timer = 0;
    body.el.classList.add('is-burning');
    this.opts.fire.feed(body.x, body.y, 1, body.el.textContent ?? undefined);
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
    this.clock += dt;
    const width = this.opts.surface.clientWidth;
    const bottom = this.opts.surface.clientHeight;

    for (let step = 0; step < 2; step++) {
      for (const body of this.bodies) this.integrate(body, dt / 2, width, this.opts.fire.groundY(body.x) ?? bottom);
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

  private integrate(body: LetterBody, dt: number, width: number, floor: number) {
    if (body.item) body.scale += (ITEM_SCALE - body.scale) * Math.min(1, dt * 10);

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
        if (!body.item) {
          // Swing with the drag like something held by one corner.
          const tilt = clamp(body.vx * 0.0006, -0.5, 0.5);
          body.spin = (tilt - body.angle) * 12;
          body.angle += body.spin * dt;
        }
        break;
      }
      case 'flying': {
        const pull = this.opts.fire.gravity() ?? { x: 0, y: 1 };
        const g = GRAVITY * (this.behavior.gravity ?? 1);
        body.vx += g * pull.x * dt;
        body.vy += g * pull.y * dt;
        body.vx *= 1 - 0.25 * dt;
        body.x += body.vx * dt;
        body.y += body.vy * dt;
        if (body.item) {
          // Dropped items stay upright and turn about their vertical axis instead (see render).
          body.angle = 0;
          body.spin = 0;
        } else {
          body.spin *= 1 - 0.4 * dt;
          body.angle += body.spin * dt;
        }

        const w = body.w * body.scale;
        const h = body.h * body.scale;
        const cos = Math.abs(Math.cos(body.angle));
        const sin = Math.abs(Math.sin(body.angle));
        const extentX = (w * cos + h * sin) / 2;
        const extentY = (w * sin + h * cos) / 2;

        if (body.x - extentX < 0) {
          body.x = extentX;
          body.vx = Math.abs(body.vx) * 0.5;
        } else if (body.x + extentX > width) {
          body.x = width - extentX;
          body.vx = -Math.abs(body.vx) * 0.5;
        }
        if (body.y - extentY < 0) {
          body.y = extentY;
          body.vy = Math.abs(body.vy) * 0.5;
        }
        if (pull.y < 0.5) {
          // Gravity pulling sideways, up or not at all: letters settle against walls or drift,
          // and fade once they've been still for a while.
          const still = Math.hypot(body.vx, body.vy) < 25;
          body.timer = still ? body.timer + dt : 0;
          if (body.timer > REST_SECONDS) this.fade(body);
        }

        body.grounded = body.y + extentY >= floor;
        if (body.grounded) {
          body.y = floor - extentY;
          if (body.vy > 0) {
            body.vy = body.vy > 140 ? -body.vy * BOUNCE : 0;
            body.spin = body.spin * 0.6 + body.vx * 0.002;
          }
          body.vx *= Math.max(0, 1 - 5 * dt);
          if (!body.item) {
            // Topple onto whichever side is nearest.
            const rest = Math.round(body.angle / (Math.PI / 2)) * (Math.PI / 2);
            body.spin += (rest - body.angle) * 40 * dt;
            body.spin *= Math.max(0, 1 - 8 * dt);
          }
          const still = Math.abs(body.vx) < 15 && Math.abs(body.vy) < 15 && Math.abs(body.spin) < 0.3;
          body.timer = still ? body.timer + dt : 0;
          if (body.timer > REST_SECONDS) this.fade(body);
        }
        break;
      }
    }

    this.warm(body, dt);
  }

  private warm(body: LetterBody, dt: number) {
    const distance = this.opts.fire.fireDistance(body.x, body.y);
    const heat = this.behavior.heat;
    if (!heat) {
      if (distance === 0) this.ignite(body);
      return;
    }
    if (distance === 0) {
      body.heat += heat.rate * dt;
    } else if (distance < heat.reach) {
      const closeness = 1 - distance / heat.reach;
      body.heat += heat.rate * NEAR_RATE * closeness * closeness * dt;
    } else {
      body.heat = Math.max(0, body.heat - heat.cool * dt);
    }
    if (body.heat >= 1) this.ignite(body);
  }

  /** Cheap circle-vs-circle separation so fallen letters pile up instead of overlapping. Items pass through each other. */
  private collide() {
    const solid = this.bodies.filter((b) => !b.item && (b.state === 'flying' || b.state === 'dragging'));
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const a = solid[i];
        const b = solid[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = (a.w + a.h + b.w + b.h) * 0.22;
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
    let scale = body.scale;
    if (body.state === 'burning') scale *= 1 - 0.35 * (body.timer / BURN_SECONDS);
    const x = body.x - body.w / 2;
    let y = body.y - body.h / 2;
    let turn = '';
    if (body.item) {
      const bob = body.grounded ? (3 + 3 * Math.sin(this.clock * 3 + body.phase)) * body.scale : 0;
      y -= bob;
      turn = ` rotateY(${this.clock * 1.8 + body.phase}rad)`;
    }
    // Hammering flattens along the vertical, whichever way the letter lies.
    const flat = body.squash ? ` scale(${1 + body.squash * 0.7}, ${1 - body.squash})` : '';
    body.el.style.transform =
      `translate3d(${x}px, ${y}px, 0)${flat} rotate(${body.angle}rad)${turn} scale(${scale})`;
    if (Math.abs(body.heat - body.shownHeat) > 0.004) {
      body.shownHeat = body.heat;
      body.el.style.setProperty('--heat', Math.min(body.heat, 1).toFixed(3));
    }
  }
}
