import { generateGroup } from '../puzzle/group';
import { type Mat3, type Vec3, mat3Vec } from '../puzzle/vec';
import { CENTRE_SLOT_COUNT, CORNER_SLOTS, type Face, GEAR_SLOTS, RADIAL_SLOTS, faceOf, findByDir } from './geometry';

export type PieceKind = 'corner' | 'centre' | 'edge' | 'gear';

export interface MaltesePiece {
  readonly id: number;
  readonly kind: PieceKind;
  /** Name of the home slot, e.g. "UFR", "F", "UF", "Fr". */
  readonly name: string;
  /** Home slot: a corner, radial (centres 0-5, edges 6-17) or gear slot index. */
  readonly home: number;
  /** Corners only: index in CUBE_GROUP of the rotation taking the UFR prototype home. */
  readonly homeOri: number;
  /**
   * Sticker colours, by sticker of the prototype:
   * corner [U (+y), F (+z), R (+x) faces of the UFR prototype]; centre [top];
   * edge [the face on local +y, the face on local −y]; gear [cap].
   */
  readonly colors: readonly Face[];
}

const R90X: Mat3 = [1, 0, 0, 0, 0, -1, 0, 1, 0];
const R90Y: Mat3 = [0, 0, 1, 0, 1, 0, -1, 0, 0];
/** The 24 rotations of the cube (corner orientations). */
export const CUBE_GROUP = generateGroup([R90X, R90Y]);

const UFR: Vec3 = [1, 1, 1];
const S = Math.SQRT1_2;

/** Corner slot index reached by each cube rotation (where it sends the UFR prototype). */
export const CORNER_SLOT_OF_ORI: readonly number[] = CUBE_GROUP.elements.map((g) => findByDir(CORNER_SLOTS, mat3Vec(g, UFR)));

function face(v: Vec3): Face {
  const f = faceOf(v);
  if (!f) throw new Error(`not a face normal: ${v}`);
  return f;
}

function buildPieces(): MaltesePiece[] {
  const pieces: MaltesePiece[] = [];
  CORNER_SLOTS.forEach((slot, i) => {
    const ori = CORNER_SLOT_OF_ORI.indexOf(i);
    const g = CUBE_GROUP.elements[ori];
    pieces.push({
      id: pieces.length,
      kind: 'corner',
      name: slot.name,
      home: i,
      homeOri: ori,
      colors: [face(mat3Vec(g, [0, 1, 0])), face(mat3Vec(g, [0, 0, 1])), face(mat3Vec(g, [1, 0, 0]))],
    });
  });
  RADIAL_SLOTS.forEach((slot, i) => {
    const colors =
      slot.kind === 'centre'
        ? [slot.faces[0]]
        : [face(mat3Vec(slot.frame, [0, S, S])), face(mat3Vec(slot.frame, [0, -S, S]))];
    pieces.push({ id: pieces.length, kind: i < CENTRE_SLOT_COUNT ? 'centre' : 'edge', name: slot.name, home: i, homeOri: 0, colors });
  });
  GEAR_SLOTS.forEach((slot, i) => {
    pieces.push({ id: pieces.length, kind: 'gear', name: slot.name, home: i, homeOri: 0, colors: [slot.face] });
  });
  return pieces;
}

/** All 50 pieces: 8 corners (ids 0-7), 6 centres (8-13), 12 edges (14-25), 24 gears (26-49). */
export const PIECES: readonly MaltesePiece[] = buildPieces();

export const PIECE_COUNT = PIECES.length;
