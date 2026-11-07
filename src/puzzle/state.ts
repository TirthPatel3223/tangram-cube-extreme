import type { PuzzleModel } from './model';
import { type Axis, type Move, inRegion } from './moves';
import { type Mat3, type Vec3, dot, mat3Vec } from './vec';

const STRADDLE_EPS = 1e-7;

/**
 * Puzzle state: one rotation-group element per piece. Every turning axis passes through the
 * centre, so a piece's orientation fully determines where it is.
 */
export class PuzzleState {
  private constructor(
    readonly model: PuzzleModel,
    readonly orient: Int32Array,
  ) {}

  static solved(model: PuzzleModel): PuzzleState {
    return new PuzzleState(model, new Int32Array(model.pieces.length).fill(model.group.identity));
  }

  clone(): PuzzleState {
    return new PuzzleState(this.model, this.orient.slice());
  }

  pieceMatrix(i: number): Mat3 {
    return this.model.group.elements[this.orient[i]];
  }

  worldCentroid(i: number): Vec3 {
    return mat3Vec(this.pieceMatrix(i), this.model.pieces[i].poly.centroid);
  }

  /** Is piece i currently inside the region that the given axis turns? */
  isInPart(i: number, axis: Axis): boolean {
    return inRegion(this.model.axes[axis].region, this.worldCentroid(i));
  }

  movingPieces(move: Move): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.model.pieces.length; i++) if (this.isInPart(i, move.axis)) out.push(i);
    return out;
  }

  /**
   * A move is legal when no piece straddles the boundary of the moving region. For this puzzle
   * family every cut always realigns (it is doctrinaire), so this is a safety net rather than a rule
   * players hit; it is the same test a jumbling simulator would use.
   */
  isLegal(move: Move): boolean {
    const { n, d } = this.model.axes[move.axis].region;
    for (let i = 0; i < this.model.pieces.length; i++) {
      const m = this.pieceMatrix(i);
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of this.model.pieces[i].poly.vertices) {
        const sd = dot(n, mat3Vec(m, v)) - d;
        if (sd < lo) lo = sd;
        if (sd > hi) hi = sd;
      }
      if (lo < -STRADDLE_EPS && hi > STRADDLE_EPS) return false;
    }
    return true;
  }

  /** Apply a move; returns the indices of the pieces that moved. */
  apply(move: Move): number[] {
    if (!this.isLegal(move)) throw new Error(`illegal move ${move.axis}${move.amount}`);
    const moving = this.movingPieces(move);
    const g = this.model.moveElement(move);
    for (const i of moving) this.orient[i] = this.model.group.mul(g, this.orient[i]);
    return moving;
  }

  applyAll(moves: readonly Move[]): void {
    for (const m of moves) this.apply(m);
  }

  /** Every piece back in its home position and orientation. */
  isSolved(): boolean {
    return this.orient.every((g) => g === this.model.group.identity);
  }

  /** Pieces with any vertex outside the home cube [-1,1]^3 (i.e. the puzzle has shape-shifted). */
  protrudingPieces(eps = 1e-6): number[] {
    const out: number[] = [];
    this.model.pieces.forEach((p, i) => {
      const m = this.pieceMatrix(i);
      if (p.poly.vertices.some((v) => mat3Vec(m, v).some((c) => Math.abs(c) > 1 + eps))) out.push(i);
    });
    return out;
  }

  equals(other: PuzzleState): boolean {
    return this.orient.every((g, i) => g === other.orient[i]);
  }
}
