import type { EdgeName } from '../geometry';

export interface CurvyKeyHandlers {
  onEdge(edge: EdgeName, alternate: boolean): void;
  onToggleMode(): void;
  onUndo(): void;
  onRedo(): void;
}

/** Physical key positions mirror the three rows of edge buttons (layout independent). */
const KEY_EDGES: Record<string, EdgeName> = {
  KeyQ: 'UF',
  KeyW: 'UR',
  KeyE: 'UB',
  KeyR: 'UL',
  KeyA: 'FR',
  KeyS: 'FL',
  KeyD: 'BR',
  KeyF: 'BL',
  KeyZ: 'DF',
  KeyX: 'DR',
  KeyC: 'DB',
  KeyV: 'DL',
};

export function bindCurvyKeyboard(h: CurvyKeyHandlers): void {
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
    if (e.code === 'KeyJ') {
      e.preventDefault();
      h.onToggleMode();
      return;
    }
    const edge = KEY_EDGES[e.code];
    if (edge) {
      e.preventDefault();
      h.onEdge(edge, e.shiftKey);
    }
  });
}
