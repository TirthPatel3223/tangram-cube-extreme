import { type Vec3, cross, dot, normalize, sub } from '../puzzle/vec';

/** 2D helpers for convex polygons lying in a 3D plane (sticker outlines, bevel rings). */

export type P2 = [number, number];

export interface PlaneBasis {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly w: Vec3;
  readonly normal: Vec3;
}

/** Right-handed in-plane basis (u x w = normal), so CCW-from-outside polygons stay CCW in 2D. */
export function planeBasis(origin: Vec3, normal: Vec3): PlaneBasis {
  const ref: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(ref, normal));
  const w = cross(normal, u);
  return { origin, u, w, normal };
}

export function to2D(b: PlaneBasis, p: Vec3): P2 {
  const d = sub(p, b.origin);
  return [dot(d, b.u), dot(d, b.w)];
}

export function to3D(b: PlaneBasis, p: P2, lift = 0): Vec3 {
  const { origin: o, u, w, normal: n } = b;
  return [
    o[0] + u[0] * p[0] + w[0] * p[1] + n[0] * lift,
    o[1] + u[1] * p[0] + w[1] * p[1] + n[1] * lift,
    o[2] + u[2] * p[0] + w[2] * p[1] + n[2] * lift,
  ];
}

/** Keep the part of a convex CCW polygon with nIn·(p - q) >= 0. */
function clipHalfPlane(poly: P2[], q: P2, nIn: P2): P2[] {
  const out: P2[] = [];
  const f = (p: P2) => nIn[0] * (p[0] - q[0]) + nIn[1] * (p[1] - q[1]);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function signedArea(poly: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Inset a convex CCW polygon by distance d (intersection of the inward-shifted edge half-planes). */
export function insetConvex(poly: readonly P2[], d: number): P2[] | null {
  let out = poly.slice();
  for (let i = 0; i < poly.length && out.length >= 3; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-12) continue;
    const nIn: P2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    out = clipHalfPlane(out, [a[0] + nIn[0] * d, a[1] + nIn[1] * d], nIn);
  }
  return out.length >= 3 && signedArea(out) > 1e-10 ? out : null;
}

/** Minkowski sum of a convex CCW polygon with a disk of radius r (rounded corners). */
export function roundConvex(poly: readonly P2[], r: number, segments = 6): P2[] {
  const out: P2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const prev = poly[(i + n - 1) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const a0 = Math.atan2(-(cur[0] - prev[0]), cur[1] - prev[1]);
    let a1 = Math.atan2(-(next[0] - cur[0]), next[1] - cur[1]);
    while (a1 < a0) a1 += 2 * Math.PI;
    for (let k = 0; k <= segments; k++) {
      const a = a0 + ((a1 - a0) * k) / segments;
      out.push([cur[0] + r * Math.cos(a), cur[1] + r * Math.sin(a)]);
    }
  }
  return out;
}

/** Inset a convex polygon that lies in a 3D plane, staying in that plane. */
export function insetPolygon3D(poly: readonly Vec3[], normal: Vec3, d: number): Vec3[] | null {
  const b = planeBasis(poly[0], normal);
  const inset = insetConvex(
    poly.map((p) => to2D(b, p)),
    d,
  );
  return inset ? inset.map((p) => to3D(b, p)) : null;
}
