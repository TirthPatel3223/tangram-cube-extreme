import * as THREE from 'three';
import { FACE_NORMAL } from '../geometry';
import { GEAR_SPIN_PER_QUARTER, QUARTER, RING_RATIO, gearSpinProgress } from '../moves';
import type { Move } from '../notation';
import type { MalteseState } from '../state';
import { type MalteseVisual, setPieceTransform } from './meshes';

interface Queued {
  readonly move: Move;
  readonly durationMs: number;
}

interface Active extends Queued {
  readonly start: number;
  readonly axis: THREE.Vector3;
  readonly layer: readonly number[];
  readonly ring: readonly number[];
  readonly from: ReadonlyMap<number, THREE.Quaternion>;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const Z = new THREE.Vector3(0, 0, 1);
const qTurn = new THREE.Quaternion();
const qSpin = new THREE.Quaternion();

/** Spin angle of the ring gears after `p` of `n` quarter turns (signed by the move's direction). */
function spinAngle(amount: number, fraction: number): number {
  const n = Math.abs(amount);
  return Math.sign(amount) * (Math.PI / 2) * GEAR_SPIN_PER_QUARTER * gearSpinProgress(fraction * n);
}

/**
 * Plays moves one after another, like the real mechanism: the face layer turns the full angle, the
 * middle ring follows at half the angle, and every gear of that ring also spins about its own axis
 * (+90° per clockwise quarter turn, counterclockwise seen from outside), during the second half of
 * each quarter turn (see gearSpinProgress). At the end of a move the state is updated and every
 * piece snaps to its exact pose.
 */
export class MalteseAnimator {
  private queue: Queued[] = [];
  private active: Active | null = null;
  /** Called after each move has been applied to the displayed state. */
  onApplied: (m: Move) => void = () => {};

  constructor(
    private readonly visuals: readonly MalteseVisual[],
    private state: MalteseState,
  ) {
    this.syncAll();
  }

  get busy(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  /** The state as currently displayed (queued moves not applied yet). */
  get visualState(): MalteseState {
    return this.state;
  }

  reset(state: MalteseState): void {
    this.queue = [];
    this.active = null;
    this.state = state;
    this.syncAll();
  }

  enqueue(move: Move, durationMs: number): void {
    this.queue.push({ move, durationMs });
  }

  syncAll(): void {
    for (const v of this.visuals) setPieceTransform(v, this.state.matrix(v.pieceId));
  }

  /**
   * Show `move` frozen at fraction t (0-1, no easing) from the displayed state, without applying it;
   * `null` snaps back. For inspecting a turn half way (the real puzzle can be held there).
   */
  previewAt(move: Move | null, t = 0.5): void {
    this.syncAll();
    if (!move) return;
    const { layer, ring } = this.state.movingParts(move.face);
    const axis = new THREE.Vector3(...FACE_NORMAL[move.face]);
    const face = QUARTER * move.amount * t;
    qTurn.setFromAxisAngle(axis, face);
    for (const id of layer) this.visuals[id].group.quaternion.premultiply(qTurn);
    qTurn.setFromAxisAngle(axis, face * RING_RATIO);
    qSpin.setFromAxisAngle(Z, spinAngle(move.amount, t));
    for (const id of ring) {
      const q = this.visuals[id].group.quaternion.premultiply(qTurn);
      if (this.visuals[id].kind === 'gear') q.multiply(qSpin);
    }
  }

  /** Advance the animation to time `now` (ms). */
  update(now: number): void {
    if (!this.active) {
      const next = this.queue.shift();
      if (!next) return;
      const { layer, ring } = this.state.movingParts(next.move.face);
      const from = new Map<number, THREE.Quaternion>();
      for (const id of [...layer, ...ring]) from.set(id, this.visuals[id].group.quaternion.clone());
      // Longer moves take a little longer; speed up when many moves are queued (scrambles).
      const n = Math.abs(next.move.amount);
      const durationMs = (next.durationMs * (0.7 + 0.3 * n)) / (1 + Math.min(this.queue.length, 6) * 0.35);
      const axis = new THREE.Vector3(...FACE_NORMAL[next.move.face]);
      this.active = { ...next, durationMs, start: now, axis, layer, ring, from };
    }
    const a = this.active;
    const t = a.durationMs <= 0 ? 1 : Math.min(1, (now - a.start) / a.durationMs);
    const e = ease(t);
    const face = QUARTER * a.move.amount * e;
    const ringAngle = face * RING_RATIO;
    const spin = spinAngle(a.move.amount, e);
    qTurn.setFromAxisAngle(a.axis, face);
    for (const id of a.layer) this.visuals[id].group.quaternion.copy(qTurn).multiply(a.from.get(id)!);
    qTurn.setFromAxisAngle(a.axis, ringAngle);
    qSpin.setFromAxisAngle(Z, spin);
    for (const id of a.ring) {
      const q = this.visuals[id].group.quaternion.copy(qTurn).multiply(a.from.get(id)!);
      if (this.visuals[id].kind === 'gear') q.multiply(qSpin);
    }
    if (t >= 1) {
      this.state.apply(a.move);
      this.active = null;
      this.syncAll();
      this.onApplied(a.move);
    }
  }
}
