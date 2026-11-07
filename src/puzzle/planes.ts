import { type Vec3, dot, length, scale } from './vec';

/**
 * A half-space { x : n·x <= d } with a unit normal `n`.
 * The boundary plane is n·x = d; `n` points "outside" the half-space.
 */
export interface Plane {
  readonly n: Vec3;
  readonly d: number;
}

/** Build a normalized half-space n·x <= d from an un-normalized normal. */
export function halfSpace(n: Vec3, d: number): Plane {
  const len = length(n);
  return { n: scale(n, 1 / len), d: d / len };
}

/** The opposite half-space n·x >= d, i.e. (-n)·x <= -d. */
export function complement(p: Plane): Plane {
  return { n: scale(p.n, -1), d: -p.d };
}

/** Positive outside the half-space, negative inside. */
export function signedDistance(p: Plane, x: Vec3): number {
  return dot(p.n, x) - p.d;
}

/** Move the boundary plane inward (towards the inside of the half-space) by `delta`. */
export function insetPlane(p: Plane, delta: number): Plane {
  return { n: p.n, d: p.d - delta };
}

export function samePlane(a: Plane, b: Plane, eps = 1e-9): boolean {
  return (
    Math.abs(a.n[0] - b.n[0]) < eps &&
    Math.abs(a.n[1] - b.n[1]) < eps &&
    Math.abs(a.n[2] - b.n[2]) < eps &&
    Math.abs(a.d - b.d) < eps
  );
}
