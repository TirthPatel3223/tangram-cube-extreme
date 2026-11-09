/**
 * A small 2D sketch kit for the sticker outlines: straight segments, circular arcs and tangent fillets,
 * sampled into counterclockwise polygons.
 *
 * It mirrors the sketch functions in `tools/maltese/fit_stickers.py` (the photo fitter) step for step,
 * so the fitted parameters in `stickers.ts` rebuild exactly the outline that was fitted;
 * `tests/maltese/stickers.test.ts` checks that against the fitter's reference polygons.
 */

export type P2 = readonly [number, number];

/** Largest angle between neighbouring samples of an arc. */
export const ARC_STEP = (2 * Math.PI) / 180;

/** The parameters do not describe a valid sketch (a fillet that does not fit, overlapping petals, ...). */
export class SketchError extends Error {}

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P2, s: number): P2 => [a[0] * s, a[1] * s];
const len = (a: P2) => Math.hypot(a[0], a[1]);
const unit = (a: P2): P2 => mul(a, 1 / len(a));
const cross = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
export const angleOf = (c: P2, p: P2) => Math.atan2(p[1] - c[1], p[0] - c[0]);

/** Samples of an arc around c from angle a0 to a1 (the start excluded, the end included). */
export function arc(c: P2, r: number, a0: number, a1: number, ccw: boolean): P2[] {
  if (ccw) while (a1 <= a0) a1 += 2 * Math.PI;
  else while (a1 >= a0) a1 -= 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / ARC_STEP));
  const out: P2[] = [];
  for (let k = 1; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}

export interface Fillet {
  readonly t1: P2;
  readonly c: P2;
  readonly t2: P2;
  readonly ccw: boolean;
}

/** The tangent arc of radius r in the corner a -> x -> b. */
export function fillet(a: P2, x: P2, b: P2, r: number): Fillet {
  const d1 = unit(sub(x, a));
  const d2 = unit(sub(b, x));
  const th = Math.acos(Math.min(1, Math.max(-1, -dot(d1, d2)))); // interior angle
  if (th < 1e-6 || th > Math.PI - 1e-6) throw new SketchError('degenerate corner');
  const tl = r / Math.tan(th / 2);
  if (tl > len(sub(x, a)) + 1e-12 || tl > len(sub(b, x)) + 1e-12) throw new SketchError('fillet does not fit');
  const bis = unit(add(mul(d1, -1), d2));
  return { t1: sub(x, mul(d1, tl)), c: add(x, mul(bis, r / Math.sin(th / 2))), t2: add(x, mul(d2, tl)), ccw: cross(d1, d2) > 0 };
}

/**
 * A corner of a closed path: a line runs into it, rounded with a fillet of radius r (0 = sharp); or,
 * with `arc`, an arc around `arc.c` runs into it (no fillet at either end of that arc).
 */
export interface PathNode {
  readonly p: P2;
  readonly r?: number;
  readonly arc?: { readonly c: P2; readonly ccw: boolean };
}

/** Sample a closed path through its nodes (counterclockwise when the nodes are). */
export function path(nodes: readonly PathNode[]): P2[] {
  const n = nodes.length;
  const entry: P2[] = [];
  const exit: P2[] = [];
  const fil: (Fillet & { r: number })[] = [];
  nodes.forEach((nd, i) => {
    const prv = nodes[(i - 1 + n) % n];
    const nxt = nodes[(i + 1) % n];
    const r = nd.r ?? 0;
    if (r > 0 && !nd.arc && !nxt.arc) {
      const f = fillet(prv.p, nd.p, nxt.p, r);
      entry[i] = f.t1;
      exit[i] = f.t2;
      fil[i] = { ...f, r };
    } else {
      entry[i] = exit[i] = nd.p;
    }
  });
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const nd = nodes[j];
    if (nd.arc) {
      const c = nd.arc.c;
      out.push(...arc(c, len(sub(exit[i], c)), angleOf(c, exit[i]), angleOf(c, entry[j]), nd.arc.ccw).slice(0, -1));
    }
    out.push(entry[j]);
    const f = fil[j];
    if (f) out.push(...arc(f.c, f.r, angleOf(f.c, entry[j]), angleOf(f.c, exit[j]), f.ccw));
  }
  return out;
}

/** Intersection of two circles: the one with the larger dot product with `prefer`. */
export function circleCircle(c0: P2, r0: number, c1: P2, r1: number, prefer: P2): P2 {
  const dv = sub(c1, c0);
  const dd = len(dv);
  if (dd < 1e-12 || dd > r0 + r1 || dd < Math.abs(r0 - r1)) throw new SketchError('circles do not meet');
  const a = (r0 * r0 - r1 * r1 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
  const m = add(c0, mul(dv, a / dd));
  const perp: P2 = [-dv[1] / dd, dv[0] / dd];
  const p1 = add(m, mul(perp, h));
  const p2 = sub(m, mul(perp, h));
  return dot(p1, prefer) >= dot(p2, prefer) ? p1 : p2;
}

export const rot2 = (v: P2, th: number): P2 => [Math.cos(th) * v[0] - Math.sin(th) * v[1], Math.sin(th) * v[0] + Math.cos(th) * v[1]];
export { add as add2, sub as sub2, mul as mul2, len as len2, dot as dot2 };

/** Signed area (positive = counterclockwise). */
export function signedArea(poly: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - a[1] * b[0];
  }
  return s / 2;
}
