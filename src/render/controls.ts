import type { Stage } from './scene';

export interface GestureHandlers {
  /** A click or tap that did not turn into a drag. `alternate` = right button or Shift held. */
  onTap(clientX: number, clientY: number, alternate: boolean): void;
  /** The user started rotating or zooming (hide hover feedback). */
  onGestureStart(): void;
}

const TAP_SLOP_PX = 6;
/** Rotation per pixel of two-finger trackpad scroll (slightly gentler than dragging). */
const WHEEL_ROTATE_PER_PX = 0.0045;
/** Zoom sensitivity for pinch (trackpad pinch arrives as ctrl+wheel). */
const WHEEL_ZOOM = 0.01;
/** Only the last bit of a drag decides the flick speed. */
const FLING_WINDOW_MS = 90;

interface TrackedPointer {
  x: number;
  y: number;
  readonly startX: number;
  readonly startY: number;
}

/**
 * Gestures over the whole puzzle area (everything except the side panel):
 *  - drag with one finger / mouse button: rotate freely (keeps spinning a little after a flick)
 *  - two-finger trackpad swipe (wheel events): rotate freely
 *  - pinch on a trackpad (ctrl+wheel) or Ctrl+mouse wheel: zoom
 *  - two-finger touch: move to rotate, pinch to zoom
 *  - click / tap without dragging: turn the part under the pointer
 */
export class GestureControls {
  private readonly pointers = new Map<number, TrackedPointer>();
  private dragging = false;
  private multiTouch = false;
  private tapButton = 0;
  private tapShift = false;
  private samples: Array<{ t: number; dx: number; dy: number }> = [];
  private pinchDistance = 0;
  private centroid = { x: 0, y: 0 };
  private safariScale = 1;

  constructor(
    private readonly el: HTMLElement,
    private readonly stage: Stage,
    private readonly handlers: GestureHandlers,
  ) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Safari reports trackpad pinches as non-standard gesture events.
    el.addEventListener('gesturestart', this.onSafariGestureStart as EventListener);
    el.addEventListener('gesturechange', this.onSafariGestureChange as EventListener);
  }

  private setDragging(on: boolean) {
    if (on && !this.dragging) this.handlers.onGestureStart();
    this.dragging = on;
    this.el.classList.toggle('is-dragging', on);
  }

  private twoPointerState(): { cx: number; cy: number; dist: number } {
    const [a, b] = [...this.pointers.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    if (this.pointers.size >= 2) return; // ignore a third finger
    try {
      this.el.setPointerCapture(e.pointerId); // keep receiving moves if the pointer leaves the area
    } catch {
      // Capture is best-effort (it throws for pointers the browser no longer tracks).
    }
    this.stage.stopMotion(); // grabbing the puzzle stops any spin
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
    if (this.pointers.size === 1) {
      this.multiTouch = false;
      this.tapButton = e.button;
      this.tapShift = e.shiftKey;
      this.samples = [];
    } else {
      this.multiTouch = true;
      this.setDragging(true);
      const s = this.twoPointerState();
      this.centroid = { x: s.cx, y: s.cy };
      this.pinchDistance = s.dist;
    }
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 1) {
      if (!this.dragging && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > TAP_SLOP_PX) {
        this.setDragging(true);
      }
      if (this.dragging && !this.multiTouch) {
        this.stage.rotateBy(dx, dy);
        this.samples.push({ t: e.timeStamp, dx, dy });
        while (this.samples.length && e.timeStamp - this.samples[0].t > FLING_WINDOW_MS) this.samples.shift();
      }
      return;
    }
    // Two fingers: move together to rotate, pinch to zoom.
    const s = this.twoPointerState();
    this.stage.rotateBy(s.cx - this.centroid.x, s.cy - this.centroid.y);
    if (this.pinchDistance > 0 && s.dist > 0) this.stage.zoomBy(this.pinchDistance / s.dist);
    this.centroid = { x: s.cx, y: s.cy };
    this.pinchDistance = s.dist;
  };

  private finish(e: PointerEvent, cancelled: boolean) {
    if (!this.pointers.delete(e.pointerId)) return;
    try {
      if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (this.pointers.size === 1) {
      // Lifting one of two fingers: carry on rotating with the other, without a jump.
      const [rest] = this.pointers.values();
      this.pinchDistance = 0;
      this.centroid = { x: rest.x, y: rest.y };
      return;
    }
    if (this.pointers.size > 0) return;
    if (!cancelled && !this.dragging && !this.multiTouch) {
      this.handlers.onTap(e.clientX, e.clientY, this.tapButton === 2 || this.tapShift || e.shiftKey);
    } else if (!cancelled && this.dragging && !this.multiTouch && this.samples.length >= 2) {
      const recent = e.timeStamp - this.samples[this.samples.length - 1].t < 50;
      const span = Math.max(16, this.samples[this.samples.length - 1].t - this.samples[0].t);
      if (recent) {
        const sx = this.samples.reduce((a, s) => a + s.dx, 0);
        const sy = this.samples.reduce((a, s) => a + s.dy, 0);
        this.stage.fling(sx / span, sy / span);
      }
    }
    this.multiTouch = false;
    this.setDragging(false);
  }

  private onUp = (e: PointerEvent) => this.finish(e, false);
  private onCancel = (e: PointerEvent) => this.finish(e, true);

  private onWheel = (e: WheelEvent) => {
    e.preventDefault(); // never scroll or zoom the page from the puzzle area
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || e.metaKey) {
      this.stage.zoomBy(Math.exp(e.deltaY * unit * WHEEL_ZOOM));
      return;
    }
    this.stage.stopMotion();
    this.handlers.onGestureStart();
    // Scrolling moves "content" opposite to the scroll offset; the puzzle's front follows it, so
    // with natural scrolling (the default on Windows precision touchpads and macOS) it follows the fingers.
    this.stage.rotateBy(-e.deltaX * unit, -e.deltaY * unit, WHEEL_ROTATE_PER_PX);
  };

  private onSafariGestureStart = (e: Event) => {
    e.preventDefault();
    this.safariScale = 1;
  };

  private onSafariGestureChange = (e: Event & { scale?: number }) => {
    e.preventDefault();
    const scale = e.scale ?? 1;
    if (scale > 0) this.stage.zoomBy(this.safariScale / scale);
    this.safariScale = scale;
  };
}
