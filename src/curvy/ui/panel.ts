import { EDGES, type EdgeName } from '../geometry';
import { type AppliedTurn, formatTurn } from '../notation';
import type { CurvyVariantDef } from '../variants';

export type TurnMode = 'half' | 'jumble';
export type CurvyView = 'corner' | 'face' | 'edge';

export interface CurvyPanelHandlers {
  onMode(mode: TurnMode): void;
  /** An edge button; `alternate` = Shift-click or right-click (anticlockwise in Jumble mode). */
  onEdgeButton(edge: EdgeName, alternate: boolean): void;
  onHoverEdge(edge: EdgeName | null): void;
  onScramble(): void;
  onReset(): void;
  onUndo(): void;
  onRedo(): void;
  /** Returns an error message, or null when the algorithm was applied. */
  onAlgorithm(text: string): string | null;
  onView(view: CurvyView): void;
  onLabels(on: boolean): void;
  onSpeed(factor: number): void;
}

export interface CurvyStatus {
  readonly loading?: boolean;
  readonly cube: boolean;
  readonly solved: boolean;
  readonly protruding: number;
  readonly blocked: readonly EdgeName[];
}

export interface CurvyPanelView {
  readonly variant: CurvyVariantDef;
  readonly mode: TurnMode;
  readonly moves: readonly AppliedTurn[];
  readonly redoable: readonly AppliedTurn[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly scramble: string | null;
  readonly status: CurvyStatus;
}

export interface CurvyPanel {
  update(view: CurvyPanelView): void;
  setView(view: CurvyView): void;
  /** Brief message under the edge buttons (e.g. why a turn was refused). */
  flash(message: string): void;
}

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  cube: svg('<path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9Z"/><path d="M3.8 7.6 12 12l8.2-4.4M12 12v9"/>'),
  shuffle: svg('<path d="M3 17h2.2c1.3 0 2.5-.6 3.2-1.7l5.2-7.6c.7-1.1 1.9-1.7 3.2-1.7H21"/><path d="m18 3 3 3-3 3"/><path d="M3 7h2.6c1.2 0 2.3.5 3 1.4"/><path d="M21 17h-4.4c-1.2 0-2.3-.5-3-1.4"/><path d="m18 14 3 3-3 3"/>'),
  reset: svg('<path d="M20 11.5A8 8 0 1 1 17.7 6"/><path d="M20.5 3.5V8H16"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
};

const ROWS: ReadonlyArray<{ label: string; edges: readonly EdgeName[] }> = [
  { label: 'Top', edges: EDGES.slice(0, 4) },
  { label: 'Middle', edges: EDGES.slice(4, 8) },
  { label: 'Bottom', edges: EDGES.slice(8, 12) },
];

function template(v: CurvyVariantDef): string {
  const buttons = ROWS.map(
    (r) =>
      `<div class="edge-row"><span class="edge-row__label">${r.label}</span>${r.edges
        .map((e) => `<button type="button" class="mv mv--edge" data-edge="${e}" title="${e} edge">${e}</button>`)
        .join('')}</div>`,
  ).join('');
  return /* html */ `
  <header class="panel__header">
    <p class="eyebrow eyebrow--brand">${ICON.cube}<span>Meffert's · design by Tom van der Zanden</span></p>
    <h1 class="brand__title">${v.name}</h1>
    <p class="brand__meta">${v.designYear} design · 57 mm · ${v.pieces} pieces · ${v.shapesPerFace} shapes per face</p>
  </header>

  <section class="card" aria-labelledby="h-turn">
    <div class="card__head">
      <h2 id="h-turn" class="eyebrow eyebrow--flush">Turn</h2>
      <div class="seg seg--sm" role="group" aria-label="Turn mode">
        <button type="button" data-mode="half" title="Each turn is a 180° flip">180°</button>
        <button type="button" data-mode="jumble" title="Each turn goes to the next jumble stop (J)">Jumble</button>
      </div>
    </div>
    <p class="mode-note" data-ref="modeNote"></p>
    <div class="edge-grid">${buttons}</div>
    <p class="status" data-ref="status" role="status"></p>
    <p class="hint">Drag or two-finger swipe to rotate, pinch to zoom. Click a piece to turn its highlighted edge;
      in Jumble mode Shift-click or right-click turns anticlockwise. Keys <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd>
      · <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd> · <kbd>Z</kbd><kbd>X</kbd><kbd>C</kbd><kbd>V</kbd> follow the
      rows above, <kbd>J</kbd> toggles Jumble.</p>
  </section>

  <div class="actions">
    <button type="button" class="btn btn--primary" data-action="scramble">${ICON.shuffle}<span>Scramble</span></button>
    <button type="button" class="btn btn--ghost" data-action="reset" title="Back to solved">${ICON.reset}<span>Reset</span></button>
    <button type="button" class="btn btn--ghost btn--icon" data-action="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${ICON.undo}</button>
    <button type="button" class="btn btn--ghost btn--icon" data-action="redo" title="Redo (Ctrl+Y)" aria-label="Redo">${ICON.redo}</button>
  </div>

  <section class="card card--compact" data-ref="scrambleBox" aria-label="Scramble" hidden>
    <div class="field-label">Scramble <span class="tag">180° turns · combo · jumbles</span></div>
    <code class="scramble__text" data-ref="scrambleText"></code>
  </section>

  <section class="card" aria-labelledby="h-alg">
    <label id="h-alg" class="field-label" for="alg-input">Algorithm</label>
    <form class="alg" data-ref="algForm" autocomplete="off">
      <input id="alg-input" class="alg__input" data-ref="alg" type="text" spellcheck="false" placeholder="UL- FR- UF FR+ UL+" />
      <button type="submit" class="btn btn--pill">Apply</button>
    </form>
    <p class="alg__error" data-ref="algError" role="alert" hidden></p>
    <p class="hint hint--tight"><code>UF</code> = 180°, <code>UF+</code> / <code>UF-</code> = to the next jumble stop clockwise /
      anticlockwise (seen from outside the edge).</p>
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
      <span>Show edge labels</span>
    </label>
    <label class="range"><span>Speed</span><input type="range" data-ref="speed" min="0.4" max="2.5" step="0.1" value="1" /></label>
  </section>

  <footer class="about">${v.about}</footer>
`;
}

export function createCurvyPanel(host: HTMLElement, variant: CurvyVariantDef, h: CurvyPanelHandlers): CurvyPanel {
  host.innerHTML = template(variant);
  const ref = <T extends HTMLElement>(name: string) => host.querySelector<T>(`[data-ref="${name}"]`)!;
  const status = ref('status');
  const modeNote = ref('modeNote');
  const scrambleBox = ref('scrambleBox');
  const scrambleText = ref('scrambleText');
  const algForm = ref<HTMLFormElement>('algForm');
  const alg = ref<HTMLInputElement>('alg');
  const algError = ref('algError');
  const count = ref('count');
  const history = ref('history');
  const undoBtn = host.querySelector<HTMLButtonElement>('[data-action="undo"]')!;
  const redoBtn = host.querySelector<HTMLButtonElement>('[data-action="redo"]')!;
  let flashTimer = 0;
  let lastStatus = '';

  host.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => h.onMode(b.dataset.mode as TurnMode)),
  );
  host.querySelectorAll<HTMLButtonElement>('[data-edge]').forEach((b) => {
    const edge = b.dataset.edge as EdgeName;
    b.addEventListener('click', (e) => h.onEdgeButton(edge, e.shiftKey));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      h.onEdgeButton(edge, true);
    });
    b.addEventListener('pointerenter', () => h.onHoverEdge(edge));
    b.addEventListener('pointerleave', () => h.onHoverEdge(null));
    b.addEventListener('focus', () => h.onHoverEdge(edge));
    b.addEventListener('blur', () => h.onHoverEdge(null));
  });
  const actions: Record<string, () => void> = { scramble: h.onScramble, reset: h.onReset, undo: h.onUndo, redo: h.onRedo };
  host.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) =>
    b.addEventListener('click', () => actions[b.dataset.action!]()),
  );
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
  host.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => h.onView(b.dataset.view as CurvyView)),
  );
  ref<HTMLInputElement>('labels').addEventListener('change', (e) => h.onLabels((e.target as HTMLInputElement).checked));
  ref<HTMLInputElement>('speed').addEventListener('input', (e) =>
    h.onSpeed(parseFloat((e.target as HTMLInputElement).value)),
  );

  const setView = (view: CurvyView) => {
    host.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
      b.classList.toggle('is-on', b.dataset.view === view),
    );
  };
  setView('corner');

  const statusText = (s: CurvyStatus): string => {
    if (s.loading) return 'Building the curved pieces…';
    const parts: string[] = [];
    if (s.solved) parts.push('Solved ✓');
    else if (s.cube) parts.push('Cube shape ✓');
    else parts.push(s.protruding ? `Shape-shifted: ${s.protruding} piece${s.protruding === 1 ? '' : 's'} out` : 'Jumbled');
    parts.push(s.blocked.length ? `blocked: ${s.blocked.join(' ')}` : 'every edge can turn');
    return parts.join(' · ');
  };

  return {
    setView,
    flash(message: string) {
      window.clearTimeout(flashTimer);
      status.textContent = message;
      status.classList.add('is-alert');
      flashTimer = window.setTimeout(() => {
        status.textContent = lastStatus;
        status.classList.remove('is-alert');
      }, 2600);
    },
    update(v: CurvyPanelView) {
      host.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
        b.classList.toggle('is-on', b.dataset.mode === v.mode),
      );
      modeNote.textContent =
        v.mode === 'half'
          ? 'Click an edge for a 180° turn.'
          : 'Click: to the next stop clockwise (70.5°, 109.5°, 180°…). Shift-click: anticlockwise.';
      const blocked = new Set(v.status.blocked);
      host.querySelectorAll<HTMLButtonElement>('[data-edge]').forEach((b) => {
        const e = b.dataset.edge as EdgeName;
        b.classList.toggle('is-blocked', blocked.has(e));
        b.title = blocked.has(e) ? `${e} edge (blocked)` : `${e} edge`;
        b.textContent = v.mode === 'jumble' ? `${e}±` : e;
      });
      lastStatus = statusText(v.status);
      if (!status.classList.contains('is-alert')) status.textContent = lastStatus;
      status.classList.toggle('is-good', !v.status.loading && (v.status.solved || v.status.cube));
      undoBtn.disabled = !v.canUndo;
      redoBtn.disabled = !v.canRedo;
      scrambleBox.hidden = !v.scramble;
      scrambleText.textContent = v.scramble ?? '';
      count.textContent = String(v.moves.length);
      history.replaceChildren(
        ...v.moves.map((m) => chip(formatTurn(m), false)),
        ...v.redoable.map((m) => chip(formatTurn(m), true)),
      );
      if (v.moves.length + v.redoable.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'history__empty';
        empty.textContent = 'No moves yet. Turn an edge, or type an algorithm above.';
        history.append(empty);
      }
      history.scrollTop = history.scrollHeight;
    },
  };
}

function chip(text: string, redo: boolean): HTMLElement {
  const el = document.createElement('span');
  el.className = redo ? 'chip chip--redo' : 'chip';
  el.textContent = text.replace('-', '−');
  return el;
}
