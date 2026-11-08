import { CUT_S, TIMING } from '../config';
import { MoveHistory } from '../puzzle/history';
import { type PuzzleModel, createModel } from '../puzzle/model';
import {
  type Axis,
  type Move,
  formatSequence,
  generateScramble,
  invertMove,
  mulberry32,
  parseAlgorithm,
} from '../puzzle/moves';
import { PuzzleState } from '../puzzle/state';
import type { VariantId } from '../puzzle/variants';
import { Animator } from '../render/animator';
import { GestureControls } from '../render/controls';
import { PartLabels } from '../render/labels';
import { type PieceVisual, buildPieceVisuals, disposeVisuals, setHighlighted } from '../render/meshes';
import { Picker } from '../render/picking';
import { TANGRAM_VIEWS, type ViewName, createStage } from '../render/scene';
import { bindKeyboard } from '../ui/keyboard';
import { createPanel } from '../ui/panel';
import type { AppContext } from './context';

/** The DaYan Tangram Cube Extreme / Tangram Cube app (the site's original puzzle). */
export function start({ stageEl, panelEl, tipEl, params }: AppContext): void {
  const sParam = Number(params.get('s'));
  const cutS = sParam > 0 && sParam < 1 / 3 ? sParam : CUT_S;

  const stage = createStage(stageEl, TANGRAM_VIEWS, 'prism');
  const labels = new PartLabels(stage.root);
  const history = new MoveHistory<Move>(invertMove);

  let model: PuzzleModel = createModel(params.get('variant') === 'original' ? 'original' : 'extreme', cutS);
  let visuals: PieceVisual[] = buildPieceVisuals(model);
  let scrambleText: string | null = null;
  let speed = 1;
  let hovered: Axis | null = null;

  const animator = new Animator(stage.root, visuals, PuzzleState.solved(model));
  const picker = new Picker(stage, visuals, () => animator.visualState, {
    onHover: (axis, x, y) => {
      highlight(axis);
      showTip(axis, x, y);
    },
    onTurn: (axis, dir) => turnAxis(axis, dir),
  });
  labels.build(model);

  // Rotate / zoom / tap anywhere over the puzzle area (everything except the side panel).
  new GestureControls(stageEl, stage, {
    onTap: (x, y, alternate) => picker.tap(x, y, alternate),
    onGestureStart: () => picker.clearHover(),
  });

  const panel = createPanel(panelEl, {
    onVariant: (id) => {
      if (id !== model.variant.id) loadVariant(id);
    },
    onMoveButton: (text) => {
      const r = parseAlgorithm(text, model.variant);
      if (r.ok) r.moves.forEach((m) => turn(m));
    },
    onHoverPart: (axis) => highlight(axis),
    onScramble: scramble,
    onReset: reset,
    onUndo: undo,
    onRedo: redo,
    onAlgorithm: (text) => {
      if (!text.trim()) return 'Type some moves first, e.g. U F U\' R.';
      const r = parseAlgorithm(text, model.variant);
      if (!r.ok) return r.error;
      r.moves.forEach((m) => turn(m));
      return null;
    },
    onView: (view: ViewName) => {
      stage.setView(view);
      panel.setView(view);
    },
    onLabels: (on) => labels.setVisible(on),
    onSpeed: (f) => {
      speed = f;
    },
  });

  bindKeyboard({ onTurn: (axis, dir) => turnAxis(axis, dir), onUndo: undo, onRedo: redo });

  animator.onMoveApplied = () => {
    if (hovered) highlight(hovered); // the highlighted part may now contain different pieces
  };

  function loadVariant(id: VariantId) {
    model = createModel(id, cutS);
    disposeVisuals(visuals);
    visuals = buildPieceVisuals(model);
    animator.reset(visuals, PuzzleState.solved(model));
    picker.setVisuals(visuals);
    labels.build(model);
    history.clear();
    scrambleText = null;
    highlight(null);
    refresh();
  }

  function refresh() {
    document.title = `${model.variant.name} · 3D simulator`;
    panel.update({
      variant: model.variant,
      moves: history.moves,
      redoable: history.redoable,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      scramble: scrambleText,
    });
  }

  function highlight(axis: Axis | null) {
    hovered = axis;
    const moving = axis ? new Set(animator.visualState.movingPieces({ axis, amount: 1 })) : new Set<number>();
    for (const v of visuals) setHighlighted(v, moving.has(v.pieceId));
    labels.setActive(axis);
  }

  function showTip(axis: Axis | null, x: number, y: number) {
    if (!axis) {
      tipEl.hidden = true;
      return;
    }
    const kind = model.axes[axis].kind;
    tipEl.textContent =
      kind === 'corner'
        ? `${axis} · corner layer (${model.variant.cornerOrder === 6 ? 60 : 120}°)`
        : `${axis} · edge flip (180°)`;
    const r = stageEl.getBoundingClientRect();
    tipEl.style.transform = `translate(${x - r.left + 14}px, ${y - r.top + 16}px)`;
    tipEl.hidden = false;
  }

  function turn(move: Move, record = true) {
    animator.enqueue(move, TIMING.moveMs / speed);
    if (record) history.push(move);
    refresh();
  }

  function turnAxis(axis: Axis, dir: 1 | -1) {
    const kind = model.axes[axis].kind;
    turn({ axis, amount: kind === 'flip' ? 1 : dir });
  }

  function undo() {
    const m = history.undo();
    if (m) animator.enqueue(m, TIMING.moveMs / speed);
    refresh();
  }

  function redo() {
    const m = history.redo();
    if (m) animator.enqueue(m, TIMING.moveMs / speed);
    refresh();
  }

  function reset() {
    animator.reset(visuals, PuzzleState.solved(model));
    history.clear();
    scrambleText = null;
    highlight(hovered);
    refresh();
  }

  function scramble() {
    animator.reset(visuals, PuzzleState.solved(model));
    history.clear();
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const moves = generateScramble(model.variant, mulberry32(seed));
    for (const m of moves) animator.enqueue(m, TIMING.fastMoveMs / speed);
    scrambleText = formatSequence(moves);
    refresh();
  }

  refresh();
  requestAnimationFrame(function loop(now) {
    animator.update(now);
    labels.update(stage.camera);
    stage.frame(now);
    requestAnimationFrame(loop);
  });

  // Handy for debugging in the browser console.
  Object.assign(window as unknown as Record<string, unknown>, {
    tangram: {
      get model() {
        return model;
      },
      get state() {
        return animator.visualState;
      },
      stage,
    },
  });
}
