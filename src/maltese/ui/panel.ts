import { FACES, type Face } from '../geometry';
import { type Move, formatMove } from '../notation';
import type { ShapeReport } from '../state';

export type MalteseView = 'corner' | 'face' | 'edge';

export interface MaltesePanelHandlers {
  /** A face button; `counterclockwise` for the ′ row (or Shift-click / right-click). */
  onFaceButton(face: Face, counterclockwise: boolean): void;
  onHoverFace(face: Face | null): void;
  onScramble(): void;
  onReset(): void;
  onUndo(): void;
  onRedo(): void;
  /** Returns an error message, or null when the algorithm was applied. */
  onAlgorithm(text: string): string | null;
  onView(view: MalteseView): void;
  onLabels(on: boolean): void;
  onSpeed(factor: number): void;
}

export interface MalteseStatus {
  readonly loading?: boolean;
  readonly solved: boolean;
  readonly cube: boolean;
  readonly shape: ShapeReport;
}

export interface MaltesePanelView {
  readonly moves: readonly Move[];
  readonly redoable: readonly Move[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly scramble: string | null;
  readonly status: MalteseStatus;
}

export interface MaltesePanel {
  update(view: MaltesePanelView): void;
  setView(view: MalteseView): void;
}

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  shuffle: svg('<path d="M3 17h2.2c1.3 0 2.5-.6 3.2-1.7l5.2-7.6c.7-1.1 1.9-1.7 3.2-1.7H21"/><path d="m18 3 3 3-3 3"/><path d="M3 7h2.6c1.2 0 2.3.5 3 1.4"/><path d="M21 17h-4.4c-1.2 0-2.3-.5-3-1.4"/><path d="m18 14 3 3-3 3"/>'),
  reset: svg('<path d="M20 11.5A8 8 0 1 1 17.7 6"/><path d="M20.5 3.5V8H16"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
};

const FACE_TITLE: Record<Face, string> = { U: 'Up (top)', D: 'Down (bottom)', F: 'Front', B: 'Back', L: 'Left', R: 'Right' };

function template(): string {
  const row = (ccw: boolean) =>
    FACES.map(
      (f) =>
        `<button type="button" class="mv mv--face" data-face="${f}" data-ccw="${ccw ? 1 : 0}" title="${FACE_TITLE[f]} face, 90° ${ccw ? 'counterclockwise' : 'clockwise'}">${f}${ccw ? '′' : ''}</button>`,
    ).join('');
  return /* html */ `
  <header class="panel__header">
    <p class="eyebrow eyebrow--brand">${ICON.gear}<span>Meffert's · design by Oskar van Deventer</span></p>
    <h1 class="brand__title">Maltese Gear Cube</h1>
    <p class="brand__meta">2013 design · 60 mm · 50 pieces · 24 gears</p>
  </header>

  <section class="card" aria-labelledby="h-turn">
    <h2 id="h-turn" class="eyebrow">Turn</h2>
    <p class="mode-note">A 90° face turn drives the middle layer 45°, and that layer's 8 gears each spin three quarters of a turn.
      Centres and edges trade places, so edges stand proud, centres sink and gears tilt.</p>
    <div class="face-grid">${row(false)}${row(true)}</div>
    <p class="status" data-ref="status" role="status"></p>
    <p class="hint">Drag or two-finger swipe to rotate, pinch to zoom. Click a piece to turn the face it is on;
      Shift-click or right-click turns counterclockwise. Keys <kbd>U</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>B</kbd>
      <kbd>L</kbd> <kbd>R</kbd>, add <kbd>Shift</kbd> for ′.</p>
  </section>

  <div class="actions">
    <button type="button" class="btn btn--primary" data-action="scramble">${ICON.shuffle}<span>Scramble</span></button>
    <button type="button" class="btn btn--ghost" data-action="reset" title="Back to solved">${ICON.reset}<span>Reset</span></button>
    <button type="button" class="btn btn--ghost btn--icon" data-action="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${ICON.undo}</button>
    <button type="button" class="btn btn--ghost btn--icon" data-action="redo" title="Redo (Ctrl+Y)" aria-label="Redo">${ICON.redo}</button>
  </div>

  <section class="card card--compact" data-ref="scrambleBox" aria-label="Scramble" hidden>
    <div class="field-label">Scramble <span class="tag">random face turns</span></div>
    <code class="scramble__text" data-ref="scrambleText"></code>
  </section>

  <section class="card" aria-labelledby="h-alg">
    <label id="h-alg" class="field-label" for="alg-input">Algorithm</label>
    <form class="alg" data-ref="algForm" autocomplete="off">
      <input id="alg-input" class="alg__input" data-ref="alg" type="text" spellcheck="false" placeholder="U R U' R'" />
      <button type="submit" class="btn btn--pill">Apply</button>
    </form>
    <p class="alg__error" data-ref="algError" role="alert" hidden></p>
    <p class="hint hint--tight"><code>U</code> = top face 90° clockwise (seen from above); <code>U'</code> counterclockwise.
      A face needs 8 quarter turns to come back, so <code>U2</code> and <code>U2'</code> differ (the middle layer ends 90° one way
      or the other) and <code>U4</code> turns the middle layer half way round.</p>
  </section>

  <section class="card" aria-labelledby="h-moves">
    <div class="card__head">
      <h2 id="h-moves" class="eyebrow eyebrow--flush">Moves</h2>
      <span class="count" data-ref="count">0</span>
    </div>
    <div class="history" data-ref="history" aria-live="polite"></div>
  </section>

  <section class="card" aria-labelledby="h-view">
    <h2 id="h-view" class="eyebrow">View</h2>
    <div class="seg" role="group" aria-label="Camera">
      <button type="button" data-view="corner">Corner</button>
      <button type="button" data-view="face">Face-on</button>
      <button type="button" data-view="edge">Edge</button>
    </div>
    <label class="switch">
      <input type="checkbox" data-ref="labels" checked />
      <span class="switch__track" aria-hidden="true"></span>
      <span>Show face labels</span>
    </label>
    <label class="range"><span>Speed</span><input type="range" data-ref="speed" min="0.4" max="2.5" step="0.1" value="1" /></label>
  </section>

  <footer class="about">Oskar van Deventer's "Maltese Gears" (2013), "a combination of the Geared Mixup and the Void Cube",
    mass-produced by Meffert's. The geometry here is rebuilt from photos of a real puzzle: gear axes 22.5° off the face
    normals, outlines traced from the stickers, edge pieces measured at 11 mm proud in a centre slot.</footer>
`;
}

export function createMaltesePanel(host: HTMLElement, h: MaltesePanelHandlers): MaltesePanel {
  host.innerHTML = template();
  const ref = <T extends HTMLElement>(name: string) => host.querySelector<T>(`[data-ref="${name}"]`)!;
  const status = ref('status');
  const scrambleBox = ref('scrambleBox');
  const scrambleText = ref('scrambleText');
  const algForm = ref<HTMLFormElement>('algForm');
  const alg = ref<HTMLInputElement>('alg');
  const algError = ref('algError');
  const count = ref('count');
  const history = ref('history');
  const undoBtn = host.querySelector<HTMLButtonElement>('[data-action="undo"]')!;
  const redoBtn = host.querySelector<HTMLButtonElement>('[data-action="redo"]')!;

  host.querySelectorAll<HTMLButtonElement>('[data-face]').forEach((b) => {
    const face = b.dataset.face as Face;
    const ccw = b.dataset.ccw === '1';
    b.addEventListener('click', (e) => h.onFaceButton(face, ccw !== e.shiftKey));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      h.onFaceButton(face, !ccw);
    });
    b.addEventListener('pointerenter', () => h.onHoverFace(face));
    b.addEventListener('pointerleave', () => h.onHoverFace(null));
    b.addEventListener('focus', () => h.onHoverFace(face));
    b.addEventListener('blur', () => h.onHoverFace(null));
  });
  const actions: Record<string, () => void> = { scramble: h.onScramble, reset: h.onReset, undo: h.onUndo, redo: h.onRedo };
  host.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.action!]()));
  algForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = h.onAlgorithm(alg.value);
    algError.hidden = !err;
    algError.textContent = err ?? '';
    alg.classList.toggle('is-invalid', !!err);
    if (!err) alg.value = '';
  });
  alg.addEventListener('input', () => {
    algError.hidden = true;
    alg.classList.remove('is-invalid');
  });
  host.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.addEventListener('click', () => h.onView(b.dataset.view as MalteseView)));
  ref<HTMLInputElement>('labels').addEventListener('change', (e) => h.onLabels((e.target as HTMLInputElement).checked));
  ref<HTMLInputElement>('speed').addEventListener('input', (e) => h.onSpeed(parseFloat((e.target as HTMLInputElement).value)));

  const setView = (view: MalteseView) => {
    host.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.classList.toggle('is-on', b.dataset.view === view));
  };
  setView('corner');

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const statusText = (s: MalteseStatus): string => {
    if (s.loading) return 'Building the pieces…';
    if (s.solved) return 'Solved ✓';
    if (s.cube) return 'Cube shape ✓ (colours scrambled)';
    const r = s.shape;
    const parts: string[] = [];
    if (r.edgesProud) parts.push(plural(r.edgesProud, 'edge proud', 'edges proud'));
    if (r.centresSunk) parts.push(plural(r.centresSunk, 'centre sunk', 'centres sunk'));
    if (r.edgesRotated) parts.push(plural(r.edgesRotated, 'edge turned', 'edges turned'));
    if (r.gearsTilted) parts.push(plural(r.gearsTilted, 'gear tilted', 'gears tilted'));
    return `Shape-shifted: ${parts.join(' · ')}`;
  };

  return {
    setView,
    update(v: MaltesePanelView) {
      status.textContent = statusText(v.status);
      status.classList.toggle('is-good', !v.status.loading && (v.status.solved || v.status.cube));
      undoBtn.disabled = !v.canUndo;
      redoBtn.disabled = !v.canRedo;
      scrambleBox.hidden = !v.scramble;
      scrambleText.textContent = v.scramble ?? '';
      count.textContent = String(v.moves.length);
      history.replaceChildren(...v.moves.map((m) => chip(formatMove(m), false)), ...v.redoable.map((m) => chip(formatMove(m), true)));
      if (v.moves.length + v.redoable.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'history__empty';
        empty.textContent = 'No moves yet. Turn a face, or type an algorithm above.';
        history.append(empty);
      }
      history.scrollTop = history.scrollHeight;
    },
  };
}

function chip(text: string, redo: boolean): HTMLElement {
  const el = document.createElement('span');
  el.className = redo ? 'chip chip--redo' : 'chip';
  el.textContent = text.replace("'", '′');
  return el;
}
