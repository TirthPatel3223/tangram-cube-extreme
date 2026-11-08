import { FACES, type Face } from '../geometry';

export interface MalteseKeyHandlers {
  /** A face key; `counterclockwise` when Shift is held. */
  onFace(face: Face, counterclockwise: boolean): void;
  onUndo(): void;
  onRedo(): void;
}

/** Keys U D F B L R turn that face clockwise; with Shift, counterclockwise. Ctrl+Z / Ctrl+Y undo and redo. */
export function bindMalteseKeyboard(h: MalteseKeyHandlers): void {
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        h.onUndo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        h.onRedo();
      }
      return;
    }
    if (e.altKey || e.repeat) return;
    const f = e.key.toUpperCase() as Face;
    if (e.key.length === 1 && (FACES as readonly string[]).includes(f)) {
      e.preventDefault();
      h.onFace(f, e.shiftKey);
    }
  });
}
