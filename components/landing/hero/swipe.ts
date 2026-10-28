interface SwipeOptions {
  /** Called once per swipe: +1 for a swipe to the left (next), -1 to the right (previous). */
  onSwipe(direction: 1 | -1): void;
  /** Live drag offset in px while swiping, 0 when released — for visual feedback. */
  onDrag(offset: number): void;
  /** A press something else wants for its own drag (e.g. painting on the canvas); no swipe then. */
  claimed?(e: PointerEvent): boolean;
}

const IGNORE = '[data-letter], .title-letter-body, a, button';
const MIN_DISTANCE = 70;
const FLICK_DISTANCE = 30;
const FLICK_SPEED = 0.5; // px per ms

/**
 * Horizontal swipe (touch or mouse drag) across `surface`. Vertical drags are left to the
 * page scroll, and the click that ends a swipe is swallowed so it doesn't count as a tap.
 */
export function bindSwipe(surface: HTMLElement, { onSwipe, onDrag, claimed }: SwipeOptions) {
  let start: { id: number; x: number; y: number; time: number } | null = null;
  let swiping = false;
  let swallowClick = false;

  const reset = () => {
    start = null;
    if (swiping) onDrag(0);
    swiping = false;
  };

  const onDown = (e: PointerEvent) => {
    if (start || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as Element).closest(IGNORE) || claimed?.(e)) return;
    start = { id: e.pointerId, x: e.clientX, y: e.clientY, time: e.timeStamp };
  };

  const onMove = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!swiping) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
        start = null;
        return;
      }
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      swiping = true;
    }
    onDrag(dx);
  };

  const onUp = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    if (swiping) {
      const dx = e.clientX - start.x;
      const speed = Math.abs(dx) / Math.max(1, e.timeStamp - start.time);
      if (Math.abs(dx) >= MIN_DISTANCE || (Math.abs(dx) >= FLICK_DISTANCE && speed >= FLICK_SPEED)) {
        onSwipe(dx < 0 ? 1 : -1);
      }
      swallowClick = true;
    }
    reset();
  };

  const onClickCapture = (e: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  };

  surface.addEventListener('pointerdown', onDown);
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerup', onUp);
  surface.addEventListener('pointercancel', reset);
  surface.addEventListener('click', onClickCapture, true);
  return () => {
    surface.removeEventListener('pointerdown', onDown);
    surface.removeEventListener('pointermove', onMove);
    surface.removeEventListener('pointerup', onUp);
    surface.removeEventListener('pointercancel', reset);
    surface.removeEventListener('click', onClickCapture, true);
  };
}
