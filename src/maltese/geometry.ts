import { type Mat3, type Vec3, cross, dot, normalize, scale, sub } from '../puzzle/vec';

/**
 * Slots of the Maltese Gear Cube. Model frame: x = R, y = U, z = F; the cube is [-1, 1]^3 (1 unit =
 * 30 mm, the distance from the centre to a face plane).
 *
 * Each of the three middle rings (M ⟂ x, E ⟂ y, S ⟂ z) has 16 slots, 22.5° apart around its axis:
 * centre and edge slots alternate on the even ones (0°, 45°, 90°, ...) and gears sit on the odd ones
 * (22.5°, 67.5°, ...). A face turn of 90° drives its ring 45°, so ring pieces always land in slots.
 *
 * Centre and edge pieces share the 18 "radial" slots (that is the mixup: they trade places), and every
 * radial or gear piece has a pose (slot, k): it sits in the slot turned k·90° about the slot's outward
 * axis. Every move maps slot frames onto slot frames up to such quarter turns, so poses stay exact.
 */

export type Face = 'U' | 'D' | 'F' | 'B' | 'L' | 'R';
export const FACES: readonly Face[] = ['U', 'D', 'F', 'B', 'L', 'R'];

export const FACE_NORMAL: Readonly<Record<Face, Vec3>> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  R: [1, 0, 0],
  L: [-1, 0, 0],
};

/** Coordinate axis (0 = x, 1 = y, 2 = z) a face's normal lies on. */
export const FACE_AXIS: Readonly<Record<Face, 0 | 1 | 2>> = { R: 0, L: 0, U: 1, D: 1, F: 2, B: 2 };

/** Ring names by axis: M ⟂ x, E ⟂ y, S ⟂ z. */
export const RING_NAME = ['M', 'E', 'S'] as const;

/** Gear axes lie 22.5° from their face's normal, towards a neighbouring face (forced by symmetry). */
export const GEAR_TILT = Math.PI / 8;

const AXES: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Face whose outward normal is (within 1e-6) the unit vector v, or null. */
export function faceOf(v: Vec3): Face | null {
  for (const f of FACES) {
    const n = FACE_NORMAL[f];
    if (Math.abs(n[0] - v[0]) < 1e-6 && Math.abs(n[1] - v[1]) < 1e-6 && Math.abs(n[2] - v[2]) < 1e-6) return f;
  }
  return null;
}

/** Rotation whose columns are the given orthonormal x, y, z (maps local coordinates to the model frame). */
export function frameFromColumns(x: Vec3, y: Vec3, z: Vec3): Mat3 {
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

export interface CornerSlot {
  readonly name: string;
  /** Sign vector, e.g. (1, 1, 1) for UFR. */
  readonly dir: Vec3;
  readonly faces: readonly Face[];
}

export interface RadialSlot {
  readonly kind: 'centre' | 'edge';
  /** "F" for a centre slot, "UF" for an edge slot. */
  readonly name: string;
  /** Unit vector from the centre through the slot. */
  readonly dir: Vec3;
  /**
   * Slot frame (columns x, y, z): z = dir. Edge slots: x along the ridge (the ring axis), so a
   * home-oriented edge has k = 0. Centre slots: x = the first coordinate axis perpendicular to z.
   */
  readonly frame: Mat3;
  /** Face layers that contain the slot (1 for a centre, 2 for an edge). */
  readonly faces: readonly Face[];
  /** Rings that contain the slot (2 for a centre, 1 for an edge). */
  readonly rings: readonly (0 | 1 | 2)[];
}

export interface GearSlot {
  /** e.g. "Fr": on the F face, on the side towards R. */
  readonly name: string;
  /** Face the gear sits on (its colour when solved). */
  readonly face: Face;
  /** The neighbouring face it leans towards (the edge it sits next to is face + toward). */
  readonly toward: Face;
  /** Unit spin axis = cos 22.5° · n_face + sin 22.5° · n_toward. */
  readonly dir: Vec3;
  /** Columns x, y, z: z = dir, y points (in the ring plane) towards the face centre, x = y × z. */
  readonly frame: Mat3;
  /** The two face layers that contain it: its own face and `toward`. */
  readonly faces: readonly Face[];
  readonly ring: 0 | 1 | 2;
}

function cornerName(d: Vec3): string {
  return `${d[1] > 0 ? 'U' : 'D'}${d[2] > 0 ? 'F' : 'B'}${d[0] > 0 ? 'R' : 'L'}`;
}

function buildCorners(): CornerSlot[] {
  const out: CornerSlot[] = [];
  for (const sy of [1, -1]) {
    for (const sz of [1, -1]) {
      for (const sx of [1, -1]) {
        const dir: Vec3 = [sx, sy, sz];
        out.push({ name: cornerName(dir), dir, faces: FACES.filter((f) => dot(FACE_NORMAL[f], dir) > 0) });
      }
    }
  }
  return out;
}

/** Faces adjacent to f (normals perpendicular to f's), in FACES order. */
function neighbours(f: Face): Face[] {
  return FACES.filter((g) => Math.abs(dot(FACE_NORMAL[f], FACE_NORMAL[g])) < 1e-9);
}

/** Edge names follow the usual order: U/D first, then F/B, then R/L (UF, UR, FR, DB, ...). */
const FACE_RANK: Readonly<Record<Face, number>> = { U: 0, D: 0, F: 1, B: 1, R: 2, L: 2 };

function buildRadial(): RadialSlot[] {
  const out: RadialSlot[] = [];
  for (const f of FACES) {
    const z = FACE_NORMAL[f];
    const x = AXES.find((a) => Math.abs(dot(a, z)) < 1e-9)!;
    const axis = FACE_AXIS[f];
    out.push({
      kind: 'centre',
      name: f,
      dir: z,
      frame: frameFromColumns(x, cross(z, x), z),
      faces: [f],
      rings: ([0, 1, 2] as const).filter((a) => a !== axis),
    });
  }
  const seen = new Set<string>();
  for (const f of FACES) {
    for (const g of neighbours(f)) {
      const [a, b] = FACE_RANK[f] <= FACE_RANK[g] ? [f, g] : [g, f];
      const name = a + b;
      if (seen.has(name)) continue;
      seen.add(name);
      const z = normalize([
        FACE_NORMAL[a][0] + FACE_NORMAL[b][0],
        FACE_NORMAL[a][1] + FACE_NORMAL[b][1],
        FACE_NORMAL[a][2] + FACE_NORMAL[b][2],
      ]);
      const ring = ([0, 1, 2] as const).find((i) => i !== FACE_AXIS[a] && i !== FACE_AXIS[b])!;
      const x = AXES[ring];
      out.push({ kind: 'edge', name, dir: z, frame: frameFromColumns(x, cross(z, x), z), faces: [a, b], rings: [ring] });
    }
  }
  return out;
}

function buildGears(): GearSlot[] {
  const out: GearSlot[] = [];
  const c = Math.cos(GEAR_TILT);
  const s = Math.sin(GEAR_TILT);
  for (const f of FACES) {
    for (const g of neighbours(f)) {
      const nf = FACE_NORMAL[f];
      const ng = FACE_NORMAL[g];
      const z = normalize([c * nf[0] + s * ng[0], c * nf[1] + s * ng[1], c * nf[2] + s * ng[2]]);
      // In the ring plane, perpendicular to z, pointing towards the face centre.
      const y = normalize(sub(nf, scale(z, dot(nf, z))));
      const x = cross(y, z);
      const ring = ([0, 1, 2] as const).find((i) => i !== FACE_AXIS[f] && i !== FACE_AXIS[g])!;
      out.push({ name: f + g.toLowerCase(), face: f, toward: g, dir: z, frame: frameFromColumns(x, y, z), faces: [f, g], ring });
    }
  }
  return out;
}

export const CORNER_SLOTS: readonly CornerSlot[] = buildCorners();
/** 6 centre slots (indices 0-5, in FACES order) then 12 edge slots (6-17). */
export const RADIAL_SLOTS: readonly RadialSlot[] = buildRadial();
export const GEAR_SLOTS: readonly GearSlot[] = buildGears();

export const CENTRE_SLOT_COUNT = 6;

/** Index of the slot whose direction matches v (within 1e-9), or -1. */
export function findByDir<T extends { readonly dir: Vec3 }>(slots: readonly T[], v: Vec3): number {
  return slots.findIndex((s) => Math.abs(s.dir[0] - v[0]) < 1e-9 && Math.abs(s.dir[1] - v[1]) < 1e-9 && Math.abs(s.dir[2] - v[2]) < 1e-9);
}

/** Is a slot direction in the face layer of f (the part that turns 90°)? */
export function inFaceLayer(dir: Vec3, f: Face): boolean {
  return dot(dir, FACE_NORMAL[f]) > 0.2;
}

/** Is a slot direction in the middle ring perpendicular to f's normal (the part that turns 45°)? */
export function inRingOf(dir: Vec3, f: Face): boolean {
  return Math.abs(dot(dir, FACE_NORMAL[f])) < 1e-9;
}

/** Quarter turns about z, exact: RZ[k] turns +k·90° (counterclockwise seen from +z). */
export const RZ: readonly Mat3[] = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1],
  [0, -1, 0, 1, 0, 0, 0, 0, 1],
  [-1, 0, 0, 0, -1, 0, 0, 0, 1],
  [0, 1, 0, -1, 0, 0, 0, 0, 1],
];
