import { type Mat3, type Vec3, axisAngleMat3, mat3Mul, mat3Transpose, mat3Vec } from '../puzzle/vec';
import { FACES, FACE_NORMAL, type Face, GEAR_SLOTS, RADIAL_SLOTS, RZ, findByDir, inFaceLayer, inRingOf } from './geometry';
import { CUBE_GROUP } from './model';

/**
 * Exact move tables. A clockwise quarter turn of face X (seen from outside X):
 *  - turns X's face layer −90° about X's outward normal (17 pieces);
 *  - drives the middle ring perpendicular to it −45° (16 pieces: 4 centre/edge slots each way, 8 gears);
 *  - spins each of that ring's 8 gears +270° about its own outward axis, i.e. three quarter turns
 *    counterclockwise seen from outside (it rolls between the turning layer and the fixed opposite one,
 *    like a differential's spider gears; the user measured 270° on the real puzzle), so it comes to
 *    rest where a 90° clockwise spin would leave it;
 *  - leaves the opposite face layer where it is.
 *
 * Every slot frame lands on a slot frame up to a quarter turn about the slot's axis, so a move maps
 * each pose (slot, k) to (slot', k + dk). The tables below are built once by matching rotated frames.
 */

export interface SlotStep {
  readonly to: number;
  /** Change of the pose's quarter-turn count k (0-3). */
  readonly dk: number;
}

export interface QuarterTable {
  readonly face: Face;
  /** +1 = clockwise seen from outside the face, -1 = anticlockwise. */
  readonly dir: 1 | -1;
  /** Rotation of the face layer (exact signed permutation matrix). */
  readonly faceRot: Mat3;
  /** Rotation of the ring (45°). */
  readonly ringRot: Mat3;
  /** CUBE_GROUP index of faceRot (applied to the corners in the layer). */
  readonly cornerRot: number;
  /** Per radial slot: where a piece there goes, or null if it doesn't move. */
  readonly radial: readonly (SlotStep | null)[];
  /** Per gear slot. Ring gears include their spin. */
  readonly gear: readonly (SlotStep | null)[];
}

/** Angle of a clockwise quarter turn (right-handed about the outward normal). */
export const QUARTER = -Math.PI / 2;
/** The ring follows at half the angle. */
export const RING_RATIO = 0.5;
/** Ring gears spin this many quarter turns (about their outward axis) per clockwise face quarter turn. */
export const GEAR_SPIN_PER_QUARTER = 3;

/**
 * How far through its spin a ring gear is (in face quarter turns; multiply by GEAR_SPIN_PER_QUARTER
 * for gear quarter turns) when the move has progressed `p` quarter turns.
 * The spin is uniform: it starts as the face starts to turn and finishes with it, so a gear is always
 * exactly as far through its 270° as the face is through its quarter turn. (The real puzzle's gears
 * dwell and then click into place, but the user prefers the smooth version.)
 */
export function gearSpinProgress(p: number): number {
  return p;
}

function roundMat(m: Mat3): Mat3 {
  return m.map((x) => Math.round(x)) as unknown as Mat3;
}

function step(slots: readonly { readonly dir: Vec3; readonly frame: Mat3 }[], from: number, rot: Mat3, spin: number): SlotStep {
  const s = slots[from];
  const to = findByDir(slots, mat3Vec(rot, s.dir));
  if (to < 0) throw new Error('move table: no slot for a rotated direction');
  // rot · F_from = F_to · RZ[dk]
  const m = mat3Mul(mat3Transpose(slots[to].frame), mat3Mul(rot, s.frame));
  const dk = ((Math.round(Math.atan2(m[3], m[0]) / (Math.PI / 2)) % 4) + 4) % 4;
  const rz = RZ[dk];
  for (let i = 0; i < 9; i++) if (Math.abs(m[i] - rz[i]) > 1e-9) throw new Error('move table: frames do not match');
  return { to, dk: (((dk + spin) % 4) + 4) % 4 };
}

function buildTable(face: Face, dir: 1 | -1): QuarterTable {
  const n = FACE_NORMAL[face];
  const faceRot = roundMat(axisAngleMat3(n, dir * QUARTER));
  const ringRot = axisAngleMat3(n, dir * QUARTER * RING_RATIO);
  const cornerRot = CUBE_GROUP.find(faceRot);
  const radial = RADIAL_SLOTS.map((s, i) =>
    inFaceLayer(s.dir, face) ? step(RADIAL_SLOTS, i, faceRot, 0) : inRingOf(s.dir, face) ? step(RADIAL_SLOTS, i, ringRot, 0) : null,
  );
  const gear = GEAR_SLOTS.map((s, i) =>
    inFaceLayer(s.dir, face)
      ? step(GEAR_SLOTS, i, faceRot, 0)
      : inRingOf(s.dir, face)
        ? step(GEAR_SLOTS, i, ringRot, dir * GEAR_SPIN_PER_QUARTER)
        : null,
  );
  return { face, dir, faceRot, ringRot, cornerRot, radial, gear };
}

const TABLES = new Map<string, QuarterTable>();
for (const f of FACES) for (const d of [1, -1] as const) TABLES.set(`${f}${d}`, buildTable(f, d));

export function quarterTable(face: Face, dir: 1 | -1): QuarterTable {
  return TABLES.get(`${face}${dir}`)!;
}
