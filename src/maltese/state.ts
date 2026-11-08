import { type Mat3, mat3Mul } from '../puzzle/vec';
import { CENTRE_SLOT_COUNT, CORNER_SLOTS, FACES, type Face, GEAR_SLOTS, RADIAL_SLOTS, RZ, inFaceLayer, inRingOf } from './geometry';
import { CORNER_SLOT_OF_ORI, CUBE_GROUP, PIECES } from './model';
import { quarterTable } from './moves';
import type { Move } from './notation';

/** How far the puzzle is from a cube, piece by piece. */
export interface ShapeReport {
  /** Edges standing in centre slots (≈ 11 mm proud). */
  readonly edgesProud: number;
  /** Centres sitting in edge slots (deep in the bevel). */
  readonly centresSunk: number;
  /** Edges in edge slots but turned 90° (ridge across the cube edge; slightly proud). */
  readonly edgesRotated: number;
  /** Gears not at their flush quarter (tilted 31° or 45°). */
  readonly gearsTilted: number;
}

export interface MovingParts {
  /** Pieces that turn 90° with the face. */
  readonly layer: number[];
  /** Pieces of the middle ring that follow 45° (gears also spin). */
  readonly ring: number[];
}

/**
 * Puzzle state: for every piece, its slot and orientation.
 * - Corners: `slot` = corner slot, `ori` = CUBE_GROUP index (rotation applied to the UFR prototype).
 * - Centres, edges (radial slots) and gears: `ori` = k, quarter turns about the slot's outward axis.
 */
export class MalteseState {
  private constructor(
    readonly slot: Int8Array,
    readonly ori: Int8Array,
  ) {}

  static solved(): MalteseState {
    const slot = new Int8Array(PIECES.length);
    const ori = new Int8Array(PIECES.length);
    for (const p of PIECES) {
      slot[p.id] = p.home;
      ori[p.id] = p.kind === 'corner' ? p.homeOri : 0;
    }
    return new MalteseState(slot, ori);
  }

  clone(): MalteseState {
    return new MalteseState(this.slot.slice(), this.ori.slice());
  }

  /** One quarter turn of a face (dir +1 = clockwise seen from outside). */
  applyQuarter(face: Face, dir: 1 | -1): void {
    const t = quarterTable(face, dir);
    for (const p of PIECES) {
      const i = p.id;
      if (p.kind === 'corner') {
        if (!inFaceLayer(CORNER_SLOTS[this.slot[i]].dir, face)) continue;
        const o = CUBE_GROUP.mul(t.cornerRot, this.ori[i]);
        this.ori[i] = o;
        this.slot[i] = CORNER_SLOT_OF_ORI[o];
        continue;
      }
      const st = p.kind === 'gear' ? t.gear[this.slot[i]] : t.radial[this.slot[i]];
      if (!st) continue;
      this.slot[i] = st.to;
      this.ori[i] = (this.ori[i] + st.dk) % 4;
    }
  }

  apply(move: Move): void {
    const dir = move.amount > 0 ? 1 : -1;
    for (let q = 0; q < Math.abs(move.amount); q++) this.applyQuarter(move.face, dir);
  }

  applyAll(moves: readonly Move[]): void {
    for (const m of moves) this.apply(m);
  }

  /** Rotation taking the piece's prototype (built in its slot frame / the UFR position) to where it is now. */
  matrix(id: number): Mat3 {
    const p = PIECES[id];
    if (p.kind === 'corner') return CUBE_GROUP.elements[this.ori[id]];
    const frame = p.kind === 'gear' ? GEAR_SLOTS[this.slot[id]].frame : RADIAL_SLOTS[this.slot[id]].frame;
    return mat3Mul(frame, RZ[this.ori[id]]);
  }

  /** Pieces that move when `face` turns: its face layer (90°) and its middle ring (45°). */
  movingParts(face: Face): MovingParts {
    const layer: number[] = [];
    const ring: number[] = [];
    for (const p of PIECES) {
      const dir =
        p.kind === 'corner'
          ? CORNER_SLOTS[this.slot[p.id]].dir
          : p.kind === 'gear'
            ? GEAR_SLOTS[this.slot[p.id]].dir
            : RADIAL_SLOTS[this.slot[p.id]].dir;
      if (inFaceLayer(dir, face)) layer.push(p.id);
      else if (p.kind !== 'corner' && inRingOf(dir, face)) ring.push(p.id);
    }
    return { layer, ring };
  }

  shapeReport(): ShapeReport {
    let edgesProud = 0;
    let centresSunk = 0;
    let edgesRotated = 0;
    let gearsTilted = 0;
    for (const p of PIECES) {
      const s = this.slot[p.id];
      const k = this.ori[p.id];
      if (p.kind === 'edge') {
        if (s < CENTRE_SLOT_COUNT) edgesProud++;
        else if (k % 2 === 1) edgesRotated++;
      } else if (p.kind === 'centre') {
        if (s >= CENTRE_SLOT_COUNT) centresSunk++;
      } else if (p.kind === 'gear') {
        if (k !== 0) gearsTilted++;
      }
    }
    return { edgesProud, centresSunk, edgesRotated, gearsTilted };
  }

  /** Every piece flush: centres and edges in their own kind of slot, edges not turned 90°, gears flat. */
  isCubeShape(): boolean {
    const r = this.shapeReport();
    return r.edgesProud + r.centresSunk + r.edgesRotated + r.gearsTilted === 0;
  }

  /**
   * Solved as it looks: every sticker on its own face and every piece flush. Gears of one colour are
   * interchangeable, and a centre's square sticker looks the same turned in place.
   */
  isSolved(): boolean {
    for (const p of PIECES) {
      const s = this.slot[p.id];
      const k = this.ori[p.id];
      switch (p.kind) {
        case 'corner':
          if (k !== p.homeOri) return false;
          break;
        case 'centre':
          if (s !== p.home) return false;
          break;
        case 'edge':
          if (s !== p.home || k !== 0) return false;
          break;
        case 'gear':
          if (GEAR_SLOTS[s].face !== GEAR_SLOTS[p.home].face || k !== 0) return false;
          break;
      }
    }
    return true;
  }

  /** Exact identity of the arrangement (for tests and caching). */
  key(): string {
    return `${Array.from(this.slot).join(',')}|${Array.from(this.ori).join(',')}`;
  }

  equals(other: MalteseState): boolean {
    return this.key() === other.key();
  }
}

/** Faces in display order (for buttons and keys). */
export const TURN_FACES: readonly Face[] = FACES;
