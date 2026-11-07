import { type Axis, type Move, formatMove } from '../puzzle/moves';
import type { VariantDef, VariantId } from '../puzzle/variants';
import type { ViewName } from '../render/scene';

export interface PanelHandlers {
  onVariant(id: VariantId): void;
  /** A move button: notation of a single move such as "U" or "D'". */
  onMoveButton(notation: string): void;
  onHoverPart(axis: Axis | null): void;
  onScramble(): void;
  onReset(): void;
  onUndo(): void;
  onRedo(): void;
  /** Returns an error message, or null when the algorithm was applied. */
  onAlgorithm(text: string): string | null;
  onView(view: ViewName): void;
  onLabels(on: boolean): void;
  onSpeed(factor: number): void;
}

export interface PanelView {
  readonly variant: VariantDef;
  readonly moves: readonly Move[];
  readonly redoable: readonly Move[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly scramble: string | null;
}

export interface Panel {
  update(view: PanelView): void;
  setView(view: ViewName): void;
  focusAlgorithm(): void;
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

const TEMPLATE = /* html */ `
  <header class="panel__header">
    <p class="eyebrow eyebrow--brand">${ICON.cube}<span>DaYan · design by Daqing Bao</span></p>
    <h1 class="brand__title" data-ref="title">Tangram Cube Extreme</h1>
    <p class="brand__meta" data-ref="meta"></p>
    <div class="seg" role="group" aria-label="Puzzle variant">
      <button type="button" data-variant="extreme">Extreme</button>
      <button type="button" data-variant="original">Original</button>
    </div>
  </header>

  <section class="card" aria-labelledby="h-turn">
    <h2 id="h-turn" class="eyebrow">Turn</h2>
    <div class="move-group">
      <div class="field-label">Corner layers <span class="tag" data-ref="step">60°</span></div>
      <div class="btn-row btn-row--moves">
        <button type="button" class="mv" data-move="U" data-axis="U" title="Top corner layer, clockwise">U</button>
        <button type="button" class="mv" data-move="U'" data-axis="U" title="Top corner layer, counter-clockwise">U′</button>
        <button type="button" class="mv" data-move="D" data-axis="D" title="Bottom corner layer, clockwise">D</button>
        <button type="button" class="mv" data-move="D'" data-axis="D" title="Bottom corner layer, counter-clockwise">D′</button>
      </div>
    </div>
    <div class="move-group">
      <div class="field-label">Edge flips <span class="tag">180°</span></div>
      <div class="btn-row btn-row--moves">
        <button type="button" class="mv" data-move="F" data-axis="F" title="Front edge flip">F</button>
        <button type="button" class="mv" data-move="R" data-axis="R" title="Right edge flip">R</button>
        <button type="button" class="mv" data-move="L" data-axis="L" title="Left edge flip">L</button>
      </div>
    </div>
    <p class="hint">Drag or two-finger swipe to rotate, pinch to zoom. Click a piece to turn the highlighted part;
      Shift-click or right-click turns the other way. Keys <kbd>U</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>R</kbd>
      <kbd>L</kbd>, add <kbd>Shift</kbd> for ′.</p>
  </section>

  <div class="actions">
    <button type="button" class="btn btn--primary" data-action="scramble">${ICON.shuffle}<span>Scramble</span></button>
    <button type="button" class="btn btn--ghost" data-action="reset" title="Back to solved">${ICON.reset}<span>Reset</span></button>
    <button type="button" class="btn btn--ghost btn--icon" data-action="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${ICON.undo}</button>
    <button type="button" class="btn btn--ghost btn--icon" data-action="redo" title="Redo (Ctrl+Y)" aria-label="Redo">${ICON.redo}</button>
  </div>

  <section class="card card--compact" data-ref="scrambleBox" aria-label="Scramble" hidden>
    <div class="field-label">Scramble</div>
    <code class="scramble__text" data-ref="scrambleText"></code>
  </section>

  <section class="card" aria-labelledby="h-alg">
    <label id="h-alg" class="field-label" for="alg-input">Algorithm</label>
    <form class="alg" data-ref="algForm" autocomplete="off">
      <input id="alg-input" class="alg__input" data-ref="alg" type="text" spellcheck="false" placeholder="U F U' R D2 L" />
      <button type="submit" class="btn btn--pill">Apply</button>
    </form>
    <p class="alg__error" data-ref="algError" role="alert" hidden></p>
  </section>

  <section class="card" aria-labelledby="h-moves">
    <div class="card__head">
      <h2 id="h-moves" class="eyebrow">Moves</h2>
      <span class="count" data-ref="count">0</span>
    </div>
    <div class="history" data-ref="history" aria-live="polite"></div>
  </section>

  <section class="card" aria-labelledby="h-view">
    <h2 id="h-view" class="eyebrow">View</h2>
    <div class="seg" role="group" aria-label="Camera">
      <button type="button" data-view="prism">Corner up</button>
      <button type="button" data-view="cube">Cube</button>
    </div>
    <label class="switch">
      <input type="checkbox" data-ref="labels" checked />
      <span class="switch__track" aria-hidden="true"></span>
      <span>Show part labels</span>
    </label>
    <label class="range"><span>Speed</span><input type="range" data-ref="speed" min="0.4" max="2.5" step="0.1" value="1" /></label>
  </section>

  <footer class="about" data-ref="about"></footer>
`;

const ABOUT: Record<VariantId, string> = {
  extreme:
    'A bandaged 3-layer hexagonal prism shaped as a cube. The two corner layers turn in 60° steps, so the puzzle ' +
    'shape-shifts; the three edges flip 180°. 11 shapes per face, 44 visible pieces.',
  original:
    'A 3-layer triangular prism ("Pentahedron") shaped as a cube. Corner layers turn 120° and edges flip 180°, so it ' +
    'always stays a cube. 7 tangram-like shapes per face, 20 visible pieces.',
};

export function createPanel(host: HTMLElement, h: PanelHandlers): Panel {
  host.innerHTML = TEMPLATE;
  const ref = <T extends HTMLElement>(name: string) => host.querySelector<T>(`[data-ref="${name}"]`)!;
  const title = ref('title');
  const meta = ref('meta');
  const step = ref('step');
  const scrambleBox = ref('scrambleBox');
  const scrambleText = ref('scrambleText');
  const algForm = ref<HTMLFormElement>('algForm');
  const alg = ref<HTMLInputElement>('alg');
  const algError = ref('algError');
  const count = ref('count');
  const history = ref('history');
  const about = ref('about');
  const undoBtn = host.querySelector<HTMLButtonElement>('[data-action="undo"]')!;
  const redoBtn = host.querySelector<HTMLButtonElement>('[data-action="redo"]')!;

  host.querySelectorAll<HTMLButtonElement>('[data-variant]').forEach((b) =>
    b.addEventListener('click', () => h.onVariant(b.dataset.variant as VariantId)),
  );
  host.querySelectorAll<HTMLButtonElement>('.mv').forEach((b) => {
    b.addEventListener('click', () => h.onMoveButton(b.dataset.move!));
    b.addEventListener('pointerenter', () => h.onHoverPart(b.dataset.axis as Axis));
    b.addEventListener('pointerleave', () => h.onHoverPart(null));
    b.addEventListener('focus', () => h.onHoverPart(b.dataset.axis as Axis));
    b.addEventListener('blur', () => h.onHoverPart(null));
  });
  const actions: Record<string, () => void> = {
    scramble: h.onScramble,
    reset: h.onReset,
    undo: h.onUndo,
    redo: h.onRedo,
  };
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
    b.addEventListener('click', () => h.onView(b.dataset.view as ViewName)),
  );
  ref<HTMLInputElement>('labels').addEventListener('change', (e) =>
    h.onLabels((e.target as HTMLInputElement).checked),
  );
  ref<HTMLInputElement>('speed').addEventListener('input', (e) =>
    h.onSpeed(parseFloat((e.target as HTMLInputElement).value)),
  );

  const setView = (view: ViewName) => {
    host.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
      b.classList.toggle('is-on', b.dataset.view === view),
    );
  };
  setView('prism');

  return {
    setView,
    focusAlgorithm: () => alg.focus(),
    update(v: PanelView) {
      title.textContent = v.variant.name;
      meta.textContent = `${v.variant.year} · ${v.variant.edgeMm} mm · ${v.variant.shapesPerFace} shapes per face`;
      step.textContent = v.variant.cornerOrder === 6 ? '60° per step' : '120° per step';
      about.textContent = ABOUT[v.variant.id];
      host.querySelectorAll<HTMLButtonElement>('[data-variant]').forEach((b) =>
        b.classList.toggle('is-on', b.dataset.variant === v.variant.id),
      );
      undoBtn.disabled = !v.canUndo;
      redoBtn.disabled = !v.canRedo;
      scrambleBox.hidden = !v.scramble;
      scrambleText.textContent = v.scramble ?? '';
      count.textContent = String(v.moves.length);
      history.replaceChildren(
        ...v.moves.map((m) => chip(formatMove(m), false)),
        ...v.redoable.map((m) => chip(formatMove(m), true)),
      );
      if (v.moves.length + v.redoable.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'history__empty';
        empty.textContent = 'No moves yet. Turn a part, or type an algorithm above.';
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
