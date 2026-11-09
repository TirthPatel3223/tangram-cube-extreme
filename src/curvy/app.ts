import wasmUrl from 'manifold-3d/manifold.wasm?url';
import type { AppContext } from '../apps/context';
import { MoveHistory } from '../puzzle/history';
import { mulberry32 } from '../puzzle/moves';
import { GestureControls } from '../render/controls';
import { type ViewPreset, createStage } from '../render/scene';
import { TIMING } from './config';
import { EDGES, type EdgeName } from './geometry';
import {
  type AppliedTurn,
  type Notated,
  formatTurn,
  invertTurn,
  parseTurns,
  resolveAlgorithm,
  resolveTurn,
} from './notation';
import { buildModel } from './pieces';
import { CurvyAnimator } from './render/animator';
import { buildShapeGeometry, defaultCsgOptions, loadManifold } from './render/csg';
import { EdgeLabels } from './render/labels';
import { type CurvyVisual, buildCore, buildCurvyVisuals, setHighlight } from './render/meshes';
import { CurvyPicker } from './render/picking';
import { generateCurvyScramble } from './scramble';
import { CurvyState } from './state';
import { bindCurvyKeyboard } from './ui/keyboard';
import { type CurvyStatus, type CurvyView, type TurnMode, createCurvyPanel } from './ui/panel';
import { CURVY_VARIANTS, type CurvyVariantId } from './variants';

/** Camera presets in the puzzle frame (x = R, y = U, z = F). */
const IDENTITY_ROWS: ViewPreset['rows'] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
export const CURVY_VIEWS: Readonly<Record<CurvyView, ViewPreset>> = {
  // U on top, F front-left, R front-right (like the retail photos).
  corner: { rows: IDENTITY_ROWS, azimuth: 45, elevation: 28 },
  // F straight on, for comparing with a face photo.
  face: { rows: IDENTITY_ROWS, azimuth: 0, elevation: 0 },
  // The UF edge towards the viewer.
  edge: { rows: IDENTITY_ROWS, azimuth: 0, elevation: 45 },
};

const KIND_LABEL: Record<string, string> = {
  corner: 'a corner',
  petal: 'a petal',
  triangle: 'a small triangle',
  xpiece: 'an X-piece',
};

/** The Curvy Copter / Curvy Copter Plus app. */
export async function start(ctx: AppContext, variantId: CurvyVariantId): Promise<void> {
  const { stageEl, panelEl, tipEl } = ctx;
  const variant = CURVY_VARIANTS[variantId];
  document.title = `${variant.name} · 3D simulator`;

  const model = buildModel(variantId);
  const history = new MoveHistory<AppliedTurn>(invertTurn);
  let mode: TurnMode = 'jumble';
  let speed = 1;
  let scrambleText: string | null = null;
  let hovered: EdgeName | null = null;
  /** The state after every queued turn: new turns are resolved against it. */
  let logical = CurvyState.solved(model);
  let ready = false;
  // Assigned once the curved pieces are built (see below); nothing touches them before `ready`.
  let animator!: CurvyAnimator;
  let visuals!: CurvyVisual[];
  let picker!: CurvyPicker;

  const stage = createStage(stageEl, CURVY_VIEWS, 'corner');
  const labels = new EdgeLabels(stage.root);

  const panel = createCurvyPanel(panelEl, variant, {
    onMode: (m) => setMode(m),
    onEdgeButton: (edge, alt) => turnEdge(edge, alt),
    onHoverEdge: (edge) => hover(edge, null),
    onScramble: scramble,
    onReset: reset,
    onUndo: undo,
    onRedo: redo,
    onAlgorithm: (text) => {
      if (!ready) return 'Still building the pieces…';
      if (!text.trim()) return 'Type some moves first, e.g. UL- FR- UF FR+ UL+.';
      const p = parseTurns(text);
      if (!p.ok) return p.error;
      const r = resolveAlgorithm(logical, p.turns);
      if (!r.ok) return r.error;
      for (const t of r.turns) enqueue(t);
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

  refresh({ loading: true, cube: true, solved: true, protruding: 0, blocked: [] });
  requestAnimationFrame(function loop(now) {
    if (ready) animator.update(now);
    labels.update(stage.camera);
    stage.frame(now);
    requestAnimationFrame(loop);
  });

  // Build the curved pieces (WebAssembly mesh booleans; a few hundred milliseconds).
  const wasm = await loadManifold(wasmUrl);
  // `?round=0` builds the old knife-edged pieces (handy for comparing the fillets).
  const csg = defaultCsgOptions();
  const opts = ctx.params.get('round') === '0' ? { ...csg, fillet: null } : csg;
  const geos = model.shapes.map((s) => buildShapeGeometry(wasm, s, opts));
  visuals = buildCurvyVisuals(model, geos);
  stage.root.add(buildCore());
  animator = new CurvyAnimator(stage.root, visuals, CurvyState.solved(model));
  ready = true;

  picker = new CurvyPicker(stage, visuals, () => animator.visualState, {
    onHover: (edge, x, y) => hover(edge, { x, y }),
    onTurn: (edge, alt) => turnEdge(edge, alt),
  });
  new GestureControls(stageEl, stage, {
    onTap: (x, y, alt) => picker.tap(x, y, alt),
    onGestureStart: () => picker.clearHover(),
  });
  bindCurvyKeyboard({
    onEdge: (edge, alt) => turnEdge(edge, alt),
    onToggleMode: () => setMode(mode === 'half' ? 'jumble' : 'half'),
    onUndo: undo,
    onRedo: redo,
  });

  animator.onApplied = () => {
    picker.invalidate();
    if (hovered) hover(hovered, null);
  };

  // ---------------------------------------------------------------- turning

  function notated(edge: EdgeName, alternate: boolean): Notated {
    return mode === 'half'
      ? { edge, kind: 'half', dir: alternate ? -1 : 1 }
      : { edge, kind: 'stop', dir: alternate ? -1 : 1 };
  }

  function describeBlockers(st: CurvyState, blockers: readonly number[]): string {
    if (!blockers.length) return 'no stop to turn to';
    const names = blockers.map((i) => {
      const p = st.model.pieces[i];
      return p.kind === 'edge' ? `the ${p.slot} edge` : KIND_LABEL[p.kind];
    });
    const uniq = [...new Set(names)];
    return `blocked by ${uniq.slice(0, 3).join(', ')}${uniq.length > 3 ? '…' : ''}`;
  }

  function turnEdge(edge: EdgeName, alternate: boolean) {
    if (!ready) return;
    const n = notated(edge, alternate);
    const r = resolveTurn(logical, n);
    if (!r.ok) {
      panel.flash(`${formatTurn(n)} can't turn: ${describeBlockers(logical, r.blockers)}.`);
      flashBlockers(r.blockers);
      return;
    }
    enqueue(r.turn);
  }

  function enqueue(t: AppliedTurn, record = true) {
    logical.apply(t, false);
    animator.enqueue(t, TIMING.moveMs / speed);
    if (record) history.push(t);
    scheduleStatus();
  }

  function undo() {
    if (!ready) return;
    const m = history.undo();
    if (m) enqueue(m, false);
    else scheduleStatus();
  }

  function redo() {
    if (!ready) return;
    const m = history.redo();
    if (m) enqueue(m, false);
    else scheduleStatus();
  }

  function reset() {
    if (!ready) return;
    logical = CurvyState.solved(model);
    animator.reset(visuals, CurvyState.solved(model));
    picker.invalidate();
    history.clear();
    scrambleText = null;
    hover(hovered, null);
    scheduleStatus();
  }

  function scramble() {
    if (!ready) return;
    const s = generateCurvyScramble(model, mulberry32((Math.random() * 2 ** 32) >>> 0));
    logical = CurvyState.solved(model);
    animator.reset(visuals, CurvyState.solved(model));
    picker.invalidate();
    history.clear();
    for (const t of s.turns) {
      logical.apply(t, false);
      animator.enqueue(t, TIMING.fastMoveMs / speed);
    }
    scrambleText = s.text;
    scheduleStatus();
  }

  function setMode(m: TurnMode) {
    mode = m;
    hover(hovered, null);
    refresh(lastStatus);
  }

  // ---------------------------------------------------------------- feedback

  let flashUntil = 0;
  function flashBlockers(blockers: readonly number[]) {
    const set = new Set(blockers);
    for (const v of visuals) setHighlight(v, set.has(v.pieceId) ? 'blocker' : 'none');
    flashUntil = performance.now() + 1400;
    window.setTimeout(() => {
      if (performance.now() >= flashUntil) hover(hovered, null);
    }, 1450);
  }

  const hoverCache = new Map<string, { ok: boolean; blockers: readonly number[]; text: string }>();
  function hoverInfo(edge: EdgeName) {
    const st = animator.visualState;
    const key = `${edge}|${mode}|${st.orient.join(',')}`;
    let info = hoverCache.get(key);
    if (!info) {
      const n = notated(edge, false);
      const r = resolveTurn(st, n);
      const text = r.ok
        ? n.kind === 'half'
          ? `${edge} · 180°`
          : `${edge}+ · ${Math.abs((r.turn.angle * 180) / Math.PI).toFixed(1)}° clockwise to the next stop`
        : `${edge} · ${describeBlockers(st, r.blockers)}`;
      info = { ok: r.ok, blockers: r.ok ? [] : r.blockers, text };
      if (hoverCache.size > 400) hoverCache.clear();
      hoverCache.set(key, info);
    }
    return info;
  }

  function hover(edge: EdgeName | null, at: { x: number; y: number } | null) {
    hovered = edge;
    if (!ready) return;
    if (performance.now() < flashUntil) return;
    if (!edge || animator.busy) {
      for (const v of visuals) setHighlight(v, 'none');
      labels.setActive(null);
      tipEl.hidden = true;
      return;
    }
    const info = hoverInfo(edge);
    const moving = new Set(animator.visualState.movingPieces(edge));
    const blockers = new Set(info.blockers);
    for (const v of visuals) {
      setHighlight(v, blockers.has(v.pieceId) ? 'blocker' : moving.has(v.pieceId) ? 'moving' : 'none');
    }
    labels.setActive(edge, !info.ok);
    if (at) {
      tipEl.textContent = info.text;
      tipEl.classList.toggle('is-blocked', !info.ok);
      const r = stageEl.getBoundingClientRect();
      tipEl.style.transform = `translate(${at.x - r.left + 14}px, ${at.y - r.top + 16}px)`;
      tipEl.hidden = false;
    }
  }

  // ---------------------------------------------------------------- status

  let lastStatus: CurvyStatus = { cube: true, solved: true, protruding: 0, blocked: [] };
  let statusTimer = 0;
  function scheduleStatus() {
    refresh(lastStatus);
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      lastStatus = computeStatus(logical);
      refresh(lastStatus);
    }, 30);
  }

  function computeStatus(st: CurvyState): CurvyStatus {
    const blocked = EDGES.filter(
      (e) =>
        !st.turnCheck(e, -Math.PI).ok &&
        !st.turnCheck(e, Math.PI).ok &&
        st.stops(e, 1, 1).length === 0 &&
        st.stops(e, -1, 1).length === 0,
    );
    const cube = st.isCubeShape();
    return { cube, solved: cube && st.isColourSolved(), protruding: st.protruding().length, blocked };
  }

  function refresh(status: CurvyStatus) {
    panel.update({
      variant,
      mode,
      moves: history.moves,
      redoable: history.redoable,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      scramble: scrambleText,
      status,
    });
  }

  scheduleStatus();

  // Handy for debugging in the browser console.
  Object.assign(window as unknown as Record<string, unknown>, {
    curvy: {
      model,
      stage,
      get state() {
        return animator.visualState;
      },
      get logical() {
        return logical;
      },
      /** Play an algorithm, e.g. curvy.play("UF+ UL UF-"). */
      play(text: string) {
        const p = parseTurns(text);
        if (!p.ok) return p.error;
        const r = resolveAlgorithm(logical, p.turns);
        if (!r.ok) return r.error;
        for (const t of r.turns) enqueue(t);
        return 'ok';
      },
    },
  });
}
