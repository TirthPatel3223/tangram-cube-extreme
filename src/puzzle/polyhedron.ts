import { type Plane, samePlane, signedDistance } from './planes';
import { type Vec3, add, cross, dot, length, normalize, scale, solve3, sub } from './vec';

export interface PolyFace {
  /** The bounding half-space this face lies on (outward normal = plane.n). */
  readonly plane: Plane;
  /** Index of the plane in the polyhedron's input plane list. */
  readonly planeIndex: number;
  /** Vertex indices, counter-clockwise when viewed from outside. */
  readonly verts: readonly number[];
}

export interface ConvexPolyhedron {
  readonly planes: readonly Plane[];
  readonly vertices: readonly Vec3[];
  readonly faces: readonly PolyFace[];
  readonly volume: number;
  readonly centroid: Vec3;
}

const ON_PLANE = 1e-7;
const INSIDE = 1e-9;

/**
 * Convex polyhedron from a list of half-spaces (H-representation) by vertex enumeration:
 * every triple of planes is intersected and points satisfying all half-spaces are kept.
 * Returns null when the intersection has no volume.
 */
export function polyhedronFromPlanes(input: readonly Plane[], minVolume = 1e-10): ConvexPolyhedron | null {
  const planes: Plane[] = [];
  for (const p of input) if (!planes.some((q) => samePlane(p, q))) planes.push(p);

  const vertices: Vec3[] = [];
  const n = planes.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const pi = planes[i], pj = planes[j], pk = planes[k];
        const x = solve3(pi.n, pj.n, pk.n, [pi.d, pj.d, pk.d]);
        if (!x) continue;
        if (planes.some((p) => signedDistance(p, x) > INSIDE)) continue;
        if (vertices.some((v) => length(sub(v, x)) < ON_PLANE)) continue;
        vertices.push(x);
      }
    }
  }
  if (vertices.length < 4) return null;

  const faces: PolyFace[] = [];
  planes.forEach((plane, planeIndex) => {
    const on = vertices
      .map((v, idx) => ({ v, idx }))
      .filter(({ v }) => Math.abs(signedDistance(plane, v)) < ON_PLANE);
    if (on.length < 3) return;
    const center = scale(on.reduce((acc, { v }) => add(acc, v), [0, 0, 0] as Vec3), 1 / on.length);
    // Basis (u, w) in the face plane with u x w = n, so increasing angle is CCW seen from outside.
    const ref = Math.abs(plane.n[0]) < 0.9 ? ([1, 0, 0] as Vec3) : ([0, 1, 0] as Vec3);
    const u = normalize(cross(ref, plane.n));
    const w = cross(plane.n, u);
    const sorted = on
      .map(({ v, idx }) => ({ idx, a: Math.atan2(dot(sub(v, center), w), dot(sub(v, center), u)) }))
      .sort((p, q) => p.a - q.a)
      .map(({ idx }) => idx);
    // Reject faces that collapse to a segment.
    if (polygonArea(sorted.map((i) => vertices[i]), plane.n) < 1e-12) return;
    faces.push({ plane, planeIndex, verts: sorted });
  });
  if (faces.length < 4) return null;

  // Volume and centroid by decomposing into tetrahedra from the vertex mean.
  const m = scale(vertices.reduce((acc, v) => add(acc, v), [0, 0, 0] as Vec3), 1 / vertices.length);
  let volume = 0;
  let cx = 0, cy = 0, cz = 0;
  for (const f of faces) {
    const v0 = vertices[f.verts[0]];
    for (let t = 1; t + 1 < f.verts.length; t++) {
      const v1 = vertices[f.verts[t]];
      const v2 = vertices[f.verts[t + 1]];
      const vol = Math.abs(dot(sub(v0, m), cross(sub(v1, m), sub(v2, m)))) / 6;
      volume += vol;
      cx += (vol * (m[0] + v0[0] + v1[0] + v2[0])) / 4;
      cy += (vol * (m[1] + v0[1] + v1[1] + v2[1])) / 4;
      cz += (vol * (m[2] + v0[2] + v1[2] + v2[2])) / 4;
    }
  }
  if (volume < minVolume) return null;
  return { planes, vertices, faces, volume, centroid: [cx / volume, cy / volume, cz / volume] };
}

/**
 * Cross-section of a convex polyhedron with the plane plane.n·x = plane.d, as a convex polygon
 * ordered counter-clockwise around plane.n (null if the plane misses the solid).
 */
export function slicePolyhedron(poly: ConvexPolyhedron, plane: Plane): Vec3[] | null {
  const pts: Vec3[] = [];
  const add1 = (p: Vec3) => {
    if (!pts.some((q) => length(sub(q, p)) < ON_PLANE)) pts.push(p);
  };
  for (const f of poly.faces) {
    for (let i = 0; i < f.verts.length; i++) {
      const a = poly.vertices[f.verts[i]];
      const b = poly.vertices[f.verts[(i + 1) % f.verts.length]];
      const da = signedDistance(plane, a);
      const db = signedDistance(plane, b);
      if (Math.abs(da) < ON_PLANE) add1(a);
      if ((da < -ON_PLANE && db > ON_PLANE) || (da > ON_PLANE && db < -ON_PLANE)) {
        const t = da / (da - db);
        add1([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
  }
  if (pts.length < 3) return null;
  const center = scale(pts.reduce((acc, p) => add(acc, p), [0, 0, 0] as Vec3), 1 / pts.length);
  const ref = Math.abs(plane.n[0]) < 0.9 ? ([1, 0, 0] as Vec3) : ([0, 1, 0] as Vec3);
  const u = normalize(cross(ref, plane.n));
  const w = cross(plane.n, u);
  return pts
    .map((p) => ({ p, a: Math.atan2(dot(sub(p, center), w), dot(sub(p, center), u)) }))
    .sort((x, y) => x.a - y.a)
    .map(({ p }) => p);
}

/** Area of a planar polygon with the given (unit) normal. */
export function polygonArea(points: readonly Vec3[], normal: Vec3): number {
  let acc: Vec3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    acc = add(acc, cross(points[i], points[(i + 1) % points.length]));
  }
  return Math.abs(dot(acc, normal)) / 2;
}
