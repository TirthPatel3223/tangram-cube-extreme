import type { Axis } from '../puzzle/moves';

export interface KeyHandlers {
  onTurn(axis: Axis, direction: 1 | -1): void;
  onUndo(): void;
  onRedo(): void;
}

const AXIS_KEYS: Record<string, Axis> = { u: 'U', d: 'D', f: 'F', r: 'R', l: 'L' };

export function bindKeyboard(h: KeyHandlers): void {
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        h.onUndo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        h.onRedo();
      }
      return;
    }
    if (e.altKey || e.repeat) return;
    const axis = AXIS_KEYS[key];
    if (axis) {
      e.preventDefault();
      h.onTurn(axis, e.shiftKey ? -1 : 1);
    }
  });
}
