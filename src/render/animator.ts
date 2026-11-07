import * as THREE from 'three';
import { moveAngle } from '../puzzle/model';
import type { Move } from '../puzzle/moves';
import type { PuzzleState } from '../puzzle/state';
import type { PieceVisual } from './meshes';

interface QueuedMove {
  readonly move: Move;
  readonly durationMs: number;
}

interface ActiveMove extends QueuedMove {
  readonly start: number;
  readonly pieces: readonly number[];
  readonly axis: THREE.Vector3;
  readonly angle: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Plays moves one after another. The moving pieces are parented to a pivot that rotates about the
 * move axis; when the turn finishes the state is updated and every piece snaps to the exact
 * orientation stored in the rotation group (so nothing drifts, however long the session).
 */
export class Animator {
  private readonly pivot = new THREE.Group();
  private queue: QueuedMove[] = [];
  private active: ActiveMove | null = null;
  /** Called after each move has been applied to the state. */
  onMoveApplied: (move: Move) => void = () => {};

  constructor(
    private readonly root: THREE.Group,
    private visuals: readonly PieceVisual[],
    private state: PuzzleState,
  ) {
    root.add(this.pivot);
    this.syncAll();
  }

  get busy(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  /** The state as currently displayed (moves still queued are not applied yet). */
  get visualState(): PuzzleState {
    return this.state;
  }

  /** Swap in a new model/state (variant change or reset). */
  reset(visuals: readonly PieceVisual[], state: PuzzleState): void {
    this.queue = [];
    this.active = null;
    this.visuals = visuals;
    this.state = state;
    this.pivot.quaternion.identity();
    this.syncAll();
  }

  enqueue(move: Move, durationMs: number): void {
    this.queue.push({ move, durationMs });
  }

  /** Drop queued (not yet started) moves. */
  clearQueue(): void {
    this.queue = [];
  }

  syncAll(): void {
    const { group } = this.state.model;
    for (const v of this.visuals) {
      if (v.group.parent !== this.root) this.root.add(v.group);
      const [x, y, z, w] = group.quats[this.state.orient[v.pieceId]];
      v.group.quaternion.set(x, y, z, w);
    }
  }

  update(now: number): void {
    if (!this.active) {
      const next = this.queue.shift();
      if (!next) return;
      const def = this.state.model.axes[next.move.axis];
      if (!this.state.isLegal(next.move)) {
        // Cannot happen on this puzzle family, but never animate an impossible turn.
        console.warn('blocked move', next.move);
        return;
      }
      const pieces = this.state.movingPieces(next.move);
      // Speed up when the user queues many moves.
      const durationMs = next.durationMs / (1 + Math.min(this.queue.length, 6) * 0.35);
      this.active = {
        ...next,
        durationMs,
        start: now,
        pieces,
        axis: new THREE.Vector3(...def.rotAxis),
        angle: moveAngle(def, next.move.amount),
      };
      this.pivot.quaternion.identity();
      for (const i of pieces) this.pivot.attach(this.visuals[i].group);
    }
    const a = this.active;
    const t = a.durationMs <= 0 ? 1 : Math.min(1, (now - a.start) / a.durationMs);
    this.pivot.quaternion.setFromAxisAngle(a.axis, a.angle * ease(t));
    if (t >= 1) {
      this.state.apply(a.move);
      this.pivot.quaternion.identity();
      for (const i of a.pieces) this.root.add(this.visuals[i].group);
      this.active = null;
      this.syncAll();
      this.onMoveApplied(a.move);
    }
  }
}
