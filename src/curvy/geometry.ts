import { type Vec3, add, cross, dot, normalize, scale, sub } from '../puzzle/vec';
import { CORE_R, CUT_TILT_DEG, EDGE_TIP_DEPTH, EDGE_TIP_R } from './config';

/**
 * Cut geometry of the Curvy Copter family (designer Tom van der Zanden).
 *
 * Coordinates: x = R, y = U, z = F; the cube is [-1,1]^3.
 *
 * Every one of the 12 edges turns about its axis e (towards the edge midpoint). Its moving part is
 * everything inside a cone around e:
 *   - half-angle ALPHA = 90° − 32° (the cut is tilted 32° from the Helicopter Cube's flat cut);
 *   - apex on the axis at APEX·e, with APEX = (1 − tan 32°)/√2;
 *   - so the cone passes through the centres of the two faces next to the edge.
 *
 * The Plus adds one more cone per X-piece: the edge cone turned through the jumble angle
 * arccos(1/3). Its axis is X = (4·n_face − corner⊥)/√18. The part of the X-piece inside it is the
 * small "inner corner" triangle, bounded by three mutually-60° cones exactly like a real corner.
 */

export const TILT = (CUT_TILT_DEG * Math.PI) / 180;
export const HALF_ANGLE = Math.PI / 2 - TILT;
export const COS_A = Math.cos(HALF_ANGLE);
export const SIN_A = Math.sin(HALF_ANGLE);
export const TAN_A = Math.tan(HALF_ANGLE);
export const APEX = (1 - Math.tan(TILT)) / Math.SQRT2;

/** The jumble angle: an edge turned by this realigns two of its four neighbours' cuts. */
export const JUMBLE = Math.acos(1 / 3);

export type CubeFace = 'U' | 'D' | 'F' | 'B' | 'R' | 'L';
export const FACES: readonly CubeFace[] = ['U', 'D', 'F', 'B', 'R', 'L'];
export const FACE_NORMAL: Readonly<Record<CubeFace, Vec3>> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  R: [1, 0, 0],
  L: [-1, 0, 0],
};

/** Edges in UI order: top layer, equator, bottom layer. */
export const EDGES = ['UF', 'UR', 'UB', 'UL', 'FR', 'FL', 'BR', 'BL', 'DF', 'DR', 'DB', 'DL'] as const;
export type EdgeName = (typeof EDGES)[number];

/** Edge midpoint (also the click "handle"). */
export const EDGE_HANDLE: Readonly<Record<EdgeName, Vec3>> = Object.fromEntries(
  EDGES.map((e) => [e, add(FACE_NORMAL[e[0] as CubeFace], FACE_NORMAL[e[1] as CubeFace])]),
) as Record<EdgeName, Vec3>;

/** Unit turning axis of each edge. */
export const EDGE_AXIS: Readonly<Record<EdgeName, Vec3>> = Object.fromEntries(
  EDGES.map((e) => [e, normalize(EDGE_HANDLE[e])]),
) as Record<EdgeName, Vec3>;

/** The four edges whose cuts meet this edge's (axes 60° apart). */
export const NEIGHBOURS: Readonly<Record<EdgeName, readonly EdgeName[]>> = Object.fromEntries(
  EDGES.map((e) => [e, EDGES.filter((f) => f !== e && Math.abs(dot(EDGE_AXIS[e], EDGE_AXIS[f]) - 0.5) < 1e-9)]),
) as unknown as Record<EdgeName, readonly EdgeName[]>;

/** Name an edge from a (near) axis direction, or null. */
export function edgeOfAxis(v: Vec3, eps = 1e-6): EdgeName | null {
  for (const e of EDGES) {
    const a = EDGE_AXIS[e];
    if (Math.abs(a[0] - v[0]) < eps && Math.abs(a[1] - v[1]) < eps && Math.abs(a[2] - v[2]) < eps) return e;
  }
  return null;
}

/** Corner name for a corner direction such as (1,1,1) -> "UFR". */
export function cornerName(c: Vec3): string {
  return (c[1] > 0 ? 'U' : 'D') + (c[2] > 0 ? 'F' : 'B') + (c[0] > 0 ? 'R' : 'L');
}

/** Face name of an axis-aligned unit vector, or null. */
export function faceOf(n: Vec3, eps = 1e-6): CubeFace | null {
  for (const f of FACES) {
    const m = FACE_NORMAL[f];
    if (Math.abs(m[0] - n[0]) < eps && Math.abs(m[1] - n[1]) < eps && Math.abs(m[2] - n[2]) < eps) return f;
  }
  return null;
}

/** Axis of the Plus's extra cone for the X-piece on `face` next to `corner` (corner = (±1,±1,±1)). */
export function innerCornerAxis(face: Vec3, corner: Vec3): Vec3 {
  const perp = sub(corner, scale(face, dot(corner, face)));
  return normalize(sub(scale(face, 4), perp));
}

/**
 * Signed distance (1-Lipschitz) from point (x,y,z) to the cut cone of the unit axis (ax,ay,az),
 * whose apex is APEX·axis: negative inside (towards the edge), positive outside. `offset` moves the
 * surface outwards (positive) or inwards (negative) by that distance.
 */
export function coneSd(x: number, y: number, z: number, ax: number, ay: number, az: number, offset = 0): number {
  const dx = x - APEX * ax;
  const dy = y - APEX * ay;
  const dz = z - APEX * az;
  const along = dx * ax + dy * ay + dz * az;
  const perp = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
  return perp * COS_A - along * SIN_A - offset;
}

/**
 * One bounding surface of a piece, with the side the piece is on.
 * - cone: inside or outside the cut cone of `axis`;
 * - cube: inside the cube;
 * - core: outside the core sphere;
 * - tip: outside the thin cylinder around a face's centre line (used to trim the edge slivers).
 */
export type Constraint =
  | { readonly kind: 'cone'; readonly axis: Vec3; readonly inside: boolean }
  | { readonly kind: 'cube' }
  | { readonly kind: 'core' }
  | { readonly kind: 'tip'; readonly face: Vec3 };

/** Signed value of a constraint at a point: <= 0 where the constraint holds. Roughly a distance. */
export function constraintValue(c: Constraint, x: number, y: number, z: number): number {
  switch (c.kind) {
    case 'cone': {
      const v = coneSd(x, y, z, c.axis[0], c.axis[1], c.axis[2]);
      return c.inside ? v : -v;
    }
    case 'cube':
      return Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) - 1;
    case 'core':
      return CORE_R - Math.sqrt(x * x + y * y + z * z);
    case 'tip': {
      const [nx, ny, nz] = c.face;
      const h = x * nx + y * ny + z * nz;
      const rx = x - h * nx;
      const ry = y - h * ny;
      const rz = z - h * nz;
      const rho = Math.sqrt(rx * rx + ry * ry + rz * rz);
      // Inside the excluded region when both are positive: then the constraint is violated.
      return Math.min(EDGE_TIP_R - rho, h - EDGE_TIP_DEPTH);
    }
  }
}

/** Largest constraint value at a point: <= 0 iff the point is inside (or on) the piece. */
export function pieceValue(cons: readonly Constraint[], x: number, y: number, z: number): number {
  let worst = -Infinity;
  for (const c of cons) {
    const v = constraintValue(c, x, y, z);
    if (v > worst) worst = v;
  }
  return worst;
}

/** An orthonormal basis (u, w) perpendicular to a unit vector a, with u x w = a. */
export function perpBasis(a: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(ref, a));
  const w = cross(a, u);
  return [u, w];
}
