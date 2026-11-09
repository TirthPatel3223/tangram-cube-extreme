import wasmUrl from 'manifold-3d/manifold.wasm?url';
import type { AppContext } from '../apps/context';
import { MoveHistory } from '../puzzle/history';
import { mulberry32 } from '../puzzle/moves';
import { GestureControls } from '../render/controls';
import { loadManifoldKernel } from '../render/manifold';
import { type ViewPreset, createStage } from '../render/scene';
import { TIMING } from './config';
import { FACE_AXIS, type Face, RING_NAME } from './geometry';
import { type Move, formatMove, formatSequence, invertMove, parseAlgorithm } from './notation';
import { MalteseAnimator } from './render/animator';
import { FaceLabels } from './render/labels';
import { type MalteseVisual, buildCoreMesh, buildMalteseVisuals, setHighlight } from './render/meshes';
import { MaltesePicker } from './render/picking';
import { buildMalteseGeometry, defaultFillet } from './render/pieces';
import { generateScramble } from './scramble';
import { MalteseState } from './state';
import { bindMalteseKeyboard } from './ui/keyboard';
import { type MalteseStatus, type MalteseView, createMaltesePanel } from './ui/panel';

const IDENTITY_ROWS: ViewPreset['rows'] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
/** Camera presets in the puzzle frame (x = R, y = U, z = F). */
export const MALTESE_VIEWS: Readonly<Record<MalteseView, ViewPreset>> = {
  // U (white) on top, F (green) front-left, R (purple) front-right, like the retail photos.
  corner: { rows: IDENTITY_ROWS, azimuth: 45, elevation: 28 },
  // F straight on, for comparing with a face photo.
  face: { rows: IDENTITY_ROWS, azimuth: 0, elevation: 0 },
  // The UF edge towards the viewer.
  edge: { rows: IDENTITY_ROWS, azimuth: 0, elevation: 45 },
};

/** The Maltese Gear Cube app. */
export async function start(ctx: AppContext): Promise<void> {
  const { stageEl, panelEl, tipEl } = ctx;
  document.title = 'Maltese Gear Cube · 3D simulator';

  const history = new MoveHistory<Move>(invertMove);
  let speed = 1;
  let scrambleText: string | null = null;
  let hovered: Face | null = null;
  /** The state after every queued move: the status line describes it. */
  let logical = MalteseState.solved();
  let ready = false;
  let animator!: MalteseAnimator;
  let visuals!: MalteseVisual[];
  let picker!: MaltesePicker;

  const stage = createStage(stageEl, MALTESE_VIEWS, 'corner');
  const labels = new FaceLabels(stage.root);

  const panel = createMaltesePanel(panelEl, {
    onFaceButton: (face, ccw) => turn(face, ccw),
    onHoverFace: (face) => hover(face, null),
    onScramble: scramble,
    onReset: reset,
    onUndo: undo,
    onRedo: redo,
    onAlgorithm: (text) => {
      if (!ready) return 'Still building the pieces…';
      if (!text.trim()) return "Type some moves first, e.g. U R U' R'.";
      const p = parseAlgorithm(text);
      if (!p.ok) return p.error;
      for (const m of p.moves) enqueue(m);
      return null;
    },
    onView: (view) => {
      stage.setView(view);
      panel.setView(view);
    },
    onLabels: (on) => labels.setVisible(on),
    onSpeed: (f) => {
      speed = f;
    },
  });

  refresh({ loading: true, solved: true, cube: true, shape: logical.shapeReport() });
  requestAnimationFrame(function loop(now) {
    if (ready) animator.update(now);
    labels.update(stage.camera);
    stage.frame(now);
    requestAnimationFrame(loop);
  });

  // Build the pieces (WebAssembly mesh booleans plus rolling-ball rounding; about a second).
  // `?round=0` shows the sharp-edged bodies instead.
  const wasm = await loadManifoldKernel(wasmUrl);
  const geo = buildMalteseGeometry(wasm, ctx.params.get('round') === '0' ? null : defaultFillet());
  visuals = buildMalteseVisuals(geo);
  for (const v of visuals) stage.root.add(v.group);
  stage.root.add(buildCoreMesh(geo));
  animator = new MalteseAnimator(visuals, MalteseState.solved());
  ready = true;

  picker = new MaltesePicker(stage, visuals, () => animator.visualState, {
    onHover: (face, x, y) => hover(face, { x, y }),
    onTurn: (face, alt) => turn(face, alt),
  });
  new GestureControls(stageEl, stage, {
    onTap: (x, y, alt) => picker.tap(x, y, alt),
    onGestureStart: () => picker.clearHover(),
  });
  bindMalteseKeyboard({ onFace: (f, ccw) => turn(f, ccw), onUndo: undo, onRedo: redo });

  animator.onApplied = () => {
    picker.invalidate();
    if (hovered) hover(hovered, null);
  };

  // ---------------------------------------------------------------- turning

  function turn(face: Face, counterclockwise: boolean) {
    if (!ready) return;
    enqueue({ face, amount: counterclockwise ? -1 : 1 });
  }

  function enqueue(m: Move, record = true) {
    logical.apply(m);
    animator.enqueue(m, TIMING.moveMs / speed);
    if (record) history.push(m);
    refreshStatus();
  }

  function undo() {
    if (!ready) return;
    const m = history.undo();
    if (m) enqueue(m, false);
    else refreshStatus();
  }

  function redo() {
    if (!ready) return;
    const m = history.redo();
    if (m) enqueue(m, false);
    else refreshStatus();
  }

  function reset() {
    if (!ready) return;
    logical = MalteseState.solved();
    animator.reset(MalteseState.solved());
    picker.invalidate();
    history.clear();
    scrambleText = null;
    hover(hovered, null);
    refreshStatus();
  }

  function scramble() {
    if (!ready) return;
    const moves = generateScramble(mulberry32((Math.random() * 2 ** 32) >>> 0));
    logical = MalteseState.solved();
    animator.reset(MalteseState.solved());
    picker.invalidate();
    history.clear();
    for (const m of moves) {
      logical.apply(m);
      animator.enqueue(m, TIMING.fastMoveMs / speed);
    }
    scrambleText = formatSequence(moves);
    refreshStatus();
  }

  // ---------------------------------------------------------------- feedback

  function hover(face: Face | null, at: { x: number; y: number } | null) {
    hovered = face;
    if (!ready) return;
    if (!face || animator.busy) {
      for (const v of visuals) setHighlight(v, 'none');
      labels.setActive(null);
      tipEl.hidden = true;
      return;
    }
    const { layer, ring } = animator.visualState.movingParts(face);
    const inLayer = new Set(layer);
    const inRing = new Set(ring);
    for (const v of visuals) setHighlight(v, inLayer.has(v.pieceId) ? 'layer' : inRing.has(v.pieceId) ? 'ring' : 'none');
    labels.setActive(face);
    if (at) {
      tipEl.textContent = `${formatMove({ face, amount: 1 })} · 90° (${RING_NAME[FACE_AXIS[face]]} layer follows 45°)`;
      tipEl.classList.remove('is-blocked');
      const r = stageEl.getBoundingClientRect();
      tipEl.style.transform = `translate(${at.x - r.left + 14}px, ${at.y - r.top + 16}px)`;
      tipEl.hidden = false;
    }
  }

  function computeStatus(st: MalteseState): MalteseStatus {
    return { solved: st.isSolved(), cube: st.isCubeShape(), shape: st.shapeReport() };
  }

  function refreshStatus() {
    refresh(computeStatus(logical));
  }

  function refresh(status: MalteseStatus) {
    panel.update({
      moves: history.moves,
      redoable: history.redoable,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      scramble: scrambleText,
      status,
    });
  }

  refreshStatus();

  // Handy for debugging in the browser console.
  Object.assign(window as unknown as Record<string, unknown>, {
    maltese: {
      stage,
      get state() {
        return animator.visualState;
      },
      get logical() {
        return logical;
      },
      /** Play an algorithm, e.g. maltese.play("U R U'"). */
      play(text: string) {
        const p = parseAlgorithm(text);
        if (!p.ok) return p.error;
        for (const m of p.moves) enqueue(m);
        return 'ok';
      },
      /** Freeze one move part way, e.g. maltese.preview("U", 0.5); maltese.preview(null) snaps back. */
      preview(text: string | null, t = 0.5) {
        if (text === null) return animator.previewAt(null);
        const p = parseAlgorithm(text);
        if (!p.ok || p.moves.length !== 1) return 'give one move';
        animator.previewAt(p.moves[0], t);
        return 'ok';
      },
    },
  });
}
