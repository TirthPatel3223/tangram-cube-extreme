import * as THREE from 'three';
import { EDGE_AXIS } from '../geometry';
import type { AppliedTurn } from '../notation';
import type { CurvyState } from '../state';
import { type CurvyVisual, setPieceTransform } from './meshes';

interface Queued {
  readonly turn: AppliedTurn;
  readonly durationMs: number;
}

interface Active extends Queued {
  readonly start: number;
  readonly pieces: readonly number[];
  readonly axis: THREE.Vector3;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Plays turns one after another. Turns arrive already resolved and checked (exact angle), so the
 * animator only rotates the moving pieces on a pivot about the edge axis and, at the end, applies
 * the turn to the state and snaps every piece to its interned orientation.
 */
export class CurvyAnimator {
  private readonly pivot = new THREE.Group();
  private queue: Queued[] = [];
  private active: Active | null = null;
  /** Called after each turn has been applied to the displayed state. */
  onApplied: (t: AppliedTurn) => void = () => {};

  constructor(
    private readonly root: THREE.Group,
    private visuals: readonly CurvyVisual[],
    private state: CurvyState,
  ) {
    root.add(this.pivot);
    this.syncAll();
  }

  get busy(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  /** The state as currently displayed (queued turns not applied yet). */
  get visualState(): CurvyState {
    return this.state;
  }

  reset(visuals: readonly CurvyVisual[], state: CurvyState): void {
    if (this.active) for (const i of this.active.pieces) this.root.add(this.visuals[i].group);
    this.queue = [];
    this.active = null;
    this.visuals = visuals;
    this.state = state;
    this.pivot.quaternion.identity();
    this.syncAll();
  }

  enqueue(turn: AppliedTurn, durationMs: number): void {
    this.queue.push({ turn, durationMs });
  }

  syncAll(): void {
    for (const v of this.visuals) {
      if (v.group.parent !== this.root) this.root.add(v.group);
      setPieceTransform(v, this.state.matrix(v.pieceId));
    }
  }

  update(now: number): void {
    if (!this.active) {
      const next = this.queue.shift();
      if (!next) return;
      const pieces = this.state.movingPieces(next.turn.edge);
      // Partial jumble turns are shorter than half turns; speed up when many turns are queued.
      const share = 0.45 + 0.55 * Math.min(1, Math.abs(next.turn.angle) / Math.PI);
      const durationMs = (next.durationMs * share) / (1 + Math.min(this.queue.length, 6) * 0.35);
      this.active = { ...next, durationMs, start: now, pieces, axis: new THREE.Vector3(...EDGE_AXIS[next.turn.edge]) };
      this.pivot.quaternion.identity();
      for (const i of pieces) this.pivot.attach(this.visuals[i].group);
    }
    const a = this.active;
    const t = a.durationMs <= 0 ? 1 : Math.min(1, (now - a.start) / a.durationMs);
    this.pivot.quaternion.setFromAxisAngle(a.axis, a.turn.angle * ease(t));
    if (t >= 1) {
      this.state.apply(a.turn, false);
      this.pivot.quaternion.identity();
      for (const i of a.pieces) this.root.add(this.visuals[i].group);
      this.active = null;
      this.syncAll();
      this.onApplied(a.turn);
    }
  }
}
