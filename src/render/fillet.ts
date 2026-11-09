import type { Manifold, ManifoldToplevel, Mesh } from 'manifold-3d';
import { type Vec3, add, cross, dot, length, normalize, scale, sub } from '../puzzle/vec';

/**
 * Rounded piece edges by a rolling ball (shared by the Curvy Copter and the Maltese Gear Cube).
 *
 * A piece body is described by its smooth bounding surfaces (planes, cones, spheres, cylinders, ...),
 * each with an exact signed distance near the surface. Wherever two surfaces of different groups meet
 * in a convex crease, a rolling ball of radius r rounds it exactly like a morphological opening would:
 *
 *  - the ball's centre runs along C' = {g_A = -r} ∩ {g_B = -r} (both surfaces offset inwards by r);
 *  - the material to remove is, in each normal plane of the edge, the corner between the two faces
 *    outside the ball: the wedge spanned by the two normals at C', minus the disc of radius r.
 *
 * That region is swept along each crease (extended a little past its ends, where it only removes
 * material that lies more than r from the offset solid anyway) and subtracted from the body. Every
 * swept remover lies inside the true removal region, so it can never gouge a face; where three
 * creases meet, the overlapping removers leave a slightly fuller corner than a sphere would. Concave
 * creases (the seams of a union) are left alone. A general Minkowski rounding would take seconds per
 * piece; this takes milliseconds.
 *
 * To use it: tag every primitive of the sharp body with `asOriginal()` and record which surfaces its
 * triangles can lie on (`prims`), find the creases of the sharp mesh, subtract the removers, and give
 * the result analytic normals with `bodyData`.
 */

/** One smooth bounding surface of a piece body: the body is on the side where g <= 0. */
export interface Surface {
  /** A label for debugging (e.g. 'face', 'cone', 'wall'). */
  readonly kind: string;
  /** Signed distance (exact near the surface), negative on the body's side. */
  g(p: Vec3): number;
  /** Unit outward normal of the body: the gradient of g. */
  n(p: Vec3): Vec3;
  /** An outside surface (cube face, sticker plateau): its creases get the larger, outer rounding. */
  readonly outer: boolean;
  /** Surfaces of one group meet in concave creases (or not at all) and are never rounded together. */
  readonly group: number;
  /**
   * Part of a union (the Curvy tip cut: outside the cylinder OR below its cap). Such a surface bounds
   * the body only in part of space, so its fillets must be clipped to that part by the caller.
   */
  readonly union?: boolean;
}

export interface MeshData {
  /** x,y,z per vertex. */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

export interface BodyData extends MeshData {
  /** Unit vertex normals (analytic: exact surfaces and fillets, so no faceting shows). */
  readonly normals: Float32Array;
}

// ------------------------------------------------------------------------------------------------
// Creases

export interface Crease {
  readonly a: number;
  readonly b: number;
  /** Points along the crease, in order. */
  readonly points: Vec3[];
}

/** Read a vertex position from a manifold mesh. */
function vert(mesh: Mesh, v: number): Vec3 {
  const k = v * mesh.numProp;
  return [mesh.vertProperties[k], mesh.vertProperties[k + 1], mesh.vertProperties[k + 2]];
}

/** Map every triangle to the run (input mesh) it came from. */
export function triangleOrigins(mesh: Mesh): Int32Array {
  const nTri = mesh.triVerts.length / 3;
  const out = new Int32Array(nTri).fill(-1);
  const { runIndex, runOriginalID } = mesh;
  for (let r = 0; r < runOriginalID.length; r++) {
    for (let t = runIndex[r] / 3; t < runIndex[r + 1] / 3; t++) out[t] = runOriginalID[r];
  }
  return out;
}

function triNormal(a: Vec3, b: Vec3, c: Vec3): { n: Vec3; area2: number } {
  const n = cross(sub(b, a), sub(c, a));
  const l = length(n);
  return { n: l > 0 ? scale(n, 1 / l) : [0, 0, 0], area2: l };
}

/** Which surface a triangle lies on, given the candidates of the input mesh it came from. */
export function triangleSurface(
  surfaces: readonly Surface[],
  candidates: readonly number[],
  a: Vec3,
  b: Vec3,
  c: Vec3,
): number {
  if (candidates.length === 1) return candidates[0];
  const centroid: Vec3 = scale(add(add(a, b), c), 1 / 3);
  const { n, area2 } = triNormal(a, b, c);
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const s of candidates) {
    // Prefer the normal (robust for planes vs. cylinder side); fall back to distance for slivers.
    const score = area2 > 1e-10 ? dot(n, surfaces[s].n(centroid)) : -Math.abs(surfaces[s].g(centroid));
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/** Is the edge (va, vb) between triangles t and u a concave (reflex) one? */
function concave(mesh: Mesh, t: number, u: number, va: number, vb: number): boolean {
  const tv = mesh.triVerts;
  const at = (v: number) => vert(mesh, v);
  const [a, b, c] = [at(tv[3 * t]), at(tv[3 * t + 1]), at(tv[3 * t + 2])];
  const nt = cross(sub(b, a), sub(c, a));
  // The vertex of u that is not on the edge (compare positions: split vertices share them).
  const pa = at(va);
  const pb = at(vb);
  let far: Vec3 | null = null;
  for (let k = 0; k < 3; k++) {
    const p = at(tv[3 * u + k]);
    if (length(sub(p, pa)) > 1e-12 && length(sub(p, pb)) > 1e-12) far = p;
  }
  if (!far) return false;
  const nl = length(nt);
  const el = length(sub(pb, pa));
  return nl > 0 && dot(nt, sub(far, pa)) / nl > 1e-6 * Math.max(el, 1e-6);
}

/**
 * Find every crease of the sharp body: mesh edges whose two triangles lie on different surfaces
 * that may be rounded together, chained into polylines (one or more per surface pair).
 */
export function findCreases(mesh: Mesh, surfaces: readonly Surface[], prims: ReadonlyMap<number, readonly number[]>): Crease[] {
  const nVert = mesh.vertProperties.length / mesh.numProp;
  const canon = new Uint32Array(nVert);
  for (let i = 0; i < nVert; i++) canon[i] = i;
  if (mesh.mergeFromVert) for (let i = 0; i < mesh.mergeFromVert.length; i++) canon[mesh.mergeFromVert[i]] = mesh.mergeToVert[i];

  const origins = triangleOrigins(mesh);
  const nTri = mesh.triVerts.length / 3;
  const triSurf = new Int32Array(nTri).fill(-1);
  for (let t = 0; t < nTri; t++) {
    const cands = prims.get(origins[t]);
    if (!cands) continue;
    const tv = mesh.triVerts;
    triSurf[t] = triangleSurface(surfaces, cands, vert(mesh, tv[3 * t]), vert(mesh, tv[3 * t + 1]), vert(mesh, tv[3 * t + 2]));
  }

  // Pair up the two triangles of every edge.
  const firstTri = new Map<number, number>();
  const segments = new Map<string, Array<[number, number]>>();
  for (let t = 0; t < nTri; t++) {
    for (let e = 0; e < 3; e++) {
      const va = canon[mesh.triVerts[3 * t + e]];
      const vb = canon[mesh.triVerts[3 * t + ((e + 1) % 3)]];
      const key = Math.min(va, vb) * nVert + Math.max(va, vb);
      const u = firstTri.get(key);
      if (u === undefined) {
        firstTri.set(key, t);
        continue;
      }
      const sa = triSurf[t];
      const sb = triSurf[u];
      if (sa < 0 || sb < 0 || sa === sb || surfaces[sa].group === surfaces[sb].group) continue;
      // Only convex creases are rounded: skip an edge whose second triangle folds up over the first's
      // plane (a concave seam, e.g. where two solids of a union meet).
      if (concave(mesh, t, u, va, vb)) continue;
      const pk = sa < sb ? `${sa},${sb}` : `${sb},${sa}`;
      let list = segments.get(pk);
      if (!list) segments.set(pk, (list = []));
      list.push([va, vb]);
    }
  }

  const creases: Crease[] = [];
  for (const [pk, segs] of segments) {
    const [a, b] = pk.split(',').map(Number);
    const adj = new Map<number, number[]>();
    const link = (x: number, y: number) => {
      let l = adj.get(x);
      if (!l) adj.set(x, (l = []));
      l.push(y);
    };
    for (const [x, y] of segs) {
      link(x, y);
      link(y, x);
    }
    const usedEdge = new Set<string>();
    const ek = (x: number, y: number) => (x < y ? `${x},${y}` : `${y},${x}`);
    const walk = (start: number) => {
      const chain = [start];
      let cur = start;
      for (;;) {
        const next = (adj.get(cur) ?? []).find((n) => !usedEdge.has(ek(cur, n)));
        if (next === undefined) break;
        usedEdge.add(ek(cur, next));
        chain.push(next);
        cur = next;
        if ((adj.get(cur)?.length ?? 0) !== 2) break; // a junction or an end
      }
      return chain;
    };
    // Open chains first (from ends and junctions), then whatever closed loops remain.
    const starts = [...adj.keys()].filter((v) => adj.get(v)!.length !== 2);
    for (const s of starts) {
      for (;;) {
        if (!(adj.get(s) ?? []).some((n) => !usedEdge.has(ek(s, n)))) break;
        const c = walk(s);
        if (c.length > 1) creases.push({ a, b, points: c.map((v) => vert(mesh, v)) });
      }
    }
    for (const v of adj.keys()) {
      if (!(adj.get(v) ?? []).some((n) => !usedEdge.has(ek(v, n)))) continue;
      const c = walk(v);
      if (c.length > 1) creases.push({ a, b, points: c.map((x) => vert(mesh, x)) });
    }
  }
  return creases;
}

// ------------------------------------------------------------------------------------------------
// Rolling-ball removers

/** Move p onto {g_A = ta} ∩ {g_B = tb} (Newton steps in the plane of the two normals). */
export function projectPair(A: Surface, B: Surface, p: Vec3, ta: number, tb: number): Vec3 {
  let q = p;
  for (let it = 0; it < 8; it++) {
    const va = A.g(q) - ta;
    const vb = B.g(q) - tb;
    if (Math.abs(va) < 1e-10 && Math.abs(vb) < 1e-10) break;
    const na = A.n(q);
    const nb = B.n(q);
    const c = dot(na, nb);
    const det = 1 - c * c;
    if (det < 1e-8) break;
    const al = (va - c * vb) / det;
    const be = (vb - c * va) / det;
    q = sub(q, add(scale(na, al), scale(nb, be)));
  }
  return q;
}

export interface FilletOptions {
  /** Ball radius for creases on the outside of the cube (a cut meeting a face, or a cube edge). */
  readonly outerRadius: number;
  /** Ball radius for creases between two cuts (hidden until the puzzle is turned or jumbled). */
  readonly innerRadius: number;
  /** Spacing of the profiles swept along each crease. */
  readonly step: number;
  /** Largest angle between neighbouring points of a fillet's arc, in radians. */
  readonly arcStep: number;
  /**
   * Optional: the farthest a fillet may reach onto either face, measured from the crease. On sharp
   * (acute) creases a ball of the full radius would reach far onto the faces (r·tan(φ/2)); where that
   * is more than this, the ball shrinks just enough. Keeps fillets out of a sticker's margin.
   */
  readonly maxReach?: number;
  /**
   * Optional: the largest turn (radians) of a crease between neighbouring profiles. Without it the
   * profiles sit every `step` along the crease, which cuts across turns much tighter than a step (a
   * plateau rounded around a sticker's sharp point, a narrow notch).
   */
  readonly maxTurn?: number;
}

/** Below this angle between the two normals a crease is nearly flat: there is nothing to round. */
const MIN_CREASE = (4 * Math.PI) / 180;

interface Station {
  readonly c: Vec3;
  readonly na: Vec3;
  readonly nb: Vec3;
  readonly phi: number;
  /** Ball radius at this station. */
  readonly r: number;
}

/**
 * Profiles along a polyline: no farther apart than `step` and, where it turns, no more than `maxTurn`
 * apart in direction (at the polyline's own vertices, which are dense on curves).
 */
function resampleByTurn(points: readonly Vec3[], step: number, maxTurn: number): Vec3[] {
  const out: Vec3[] = [points[0]];
  let turn = 0;
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = length(sub(b, a));
    // A long segment: profiles along it every step.
    const n = Math.ceil(seg / step - 1e-9);
    for (let k = 1; k < n; k++) out.push(add(a, scale(sub(b, a), k / n)));
    run = n > 1 ? seg / n : run + seg;
    if (i < points.length - 1) {
      const d1 = sub(b, a);
      const d2 = sub(points[i + 1], b);
      const l1 = length(d1);
      const l2 = length(d2);
      if (l1 > 0 && l2 > 0) turn += Math.acos(Math.max(-1, Math.min(1, dot(d1, d2) / (l1 * l2))));
    }
    const nextSeg = i < points.length - 1 ? length(sub(points[i + 1], b)) : 0;
    if (i === points.length - 1 || turn >= maxTurn || run + nextSeg > step) {
      out.push(b);
      turn = 0;
      run = 0;
    }
  }
  return out;
}

function resample(points: readonly Vec3[], step: number): Vec3[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + length(sub(points[i], points[i - 1])));
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.ceil(total / step));
  const out: Vec3[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = (total * k) / n;
    while (j < points.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j];
    const t = seg > 0 ? (s - cum[j]) / seg : 0;
    out.push(add(points[j], scale(sub(points[j + 1], points[j]), t)));
  }
  return out;
}

/** Continue the crease A ∩ B past an end point, `count` steps of `step` in the direction away from `prev`. */
function extend(A: Surface, B: Surface, end: Vec3, prev: Vec3, count: number, step: number): Vec3[] {
  const out: Vec3[] = [];
  let p = end;
  let dir = sub(end, prev);
  for (let k = 0; k < count; k++) {
    let t = cross(A.n(p), B.n(p));
    const tl = length(t);
    if (tl < 1e-9) break;
    t = scale(t, 1 / tl);
    if (dot(t, dir) < 0) t = scale(t, -1);
    const q = projectPair(A, B, add(p, scale(t, step)), 0, 0);
    dir = sub(q, p);
    p = q;
    out.push(p);
  }
  return out;
}

function station(A: Surface, B: Surface, p: Vec3, r: number): Station {
  const na0 = A.n(p);
  const nb0 = B.n(p);
  const guess = sub(p, scale(add(na0, nb0), r / (1 + dot(na0, nb0))));
  const c = projectPair(A, B, guess, -r, -r);
  const na = A.n(c);
  const nb = B.n(c);
  return { c, na, nb, phi: Math.acos(Math.max(-1, Math.min(1, dot(na, nb)))), r };
}

/** The ball radius at a crease point: r, or less where the fillet would reach farther than maxReach. */
function radiusAt(A: Surface, B: Surface, p: Vec3, r: number, maxReach: number | undefined): number {
  if (maxReach === undefined) return r;
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(A.n(p), B.n(p)))));
  return Math.min(r, maxReach / Math.tan(Math.min(phi, Math.PI - 1e-6) / 2));
}

/** Points of one profile: the arc (on the body's surface) then three points outside the body. */
function profile(s: Station, arcSegs: number): { pts: Vec3[]; normals: Vec3[] } {
  const { c, na, nb, phi, r } = s;
  const sinPhi = Math.sin(phi);
  const pts: Vec3[] = [];
  const normals: Vec3[] = [];
  for (let j = 0; j <= arcSegs; j++) {
    const t = j / arcSegs;
    const u = sinPhi > 1e-9 ? add(scale(na, Math.sin((1 - t) * phi) / sinPhi), scale(nb, Math.sin(t * phi) / sinPhi)) : na;
    const un = normalize(u);
    pts.push(add(c, scale(un, r)));
    normals.push(un);
  }
  const m = 0.5 * r;
  const bis = normalize(add(na, nb));
  pts.push(add(c, scale(nb, r + m)), add(c, scale(bis, r / Math.cos(phi / 2) + m)), add(c, scale(na, r + m)));
  normals.push(nb, bis, na);
  return { pts, normals };
}

/** A closed mesh sweeping the profiles along the stations (with flat end caps). */
function sweepMesh(wasm: ManifoldToplevel, stations: readonly Station[], arcSegs: number): Manifold | null {
  const P = arcSegs + 4;
  const K = stations.length;
  const props = new Float32Array(K * P * 6);
  stations.forEach((s, k) => {
    const { pts, normals } = profile(s, arcSegs);
    for (let j = 0; j < P; j++) props.set([...pts[j], ...normals[j]], (k * P + j) * 6);
  });
  const tris: number[] = [];
  for (let k = 0; k + 1 < K; k++) {
    for (let j = 0; j < P; j++) {
      const jn = (j + 1) % P;
      const a = k * P + j;
      const b = k * P + jn;
      const c = (k + 1) * P + jn;
      const d = (k + 1) * P + j;
      tris.push(a, b, c, a, c, d);
    }
  }
  // End caps: fans from the outer bisector point (it sees the whole profile).
  const hub = arcSegs + 2;
  const cap = (base: number, flip: boolean) => {
    const ring = [arcSegs + 3, ...Array.from({ length: arcSegs + 1 }, (_, j) => j), arcSegs + 1];
    for (let i = 0; i + 1 < ring.length; i++) {
      if (flip) tris.push(base + hub, base + ring[i + 1], base + ring[i]);
      else tris.push(base + hub, base + ring[i], base + ring[i + 1]);
    }
  };
  cap(0, true);
  cap((K - 1) * P, false);
  // Orient outwards (positive signed volume).
  let vol = 0;
  const pos = (i: number): Vec3 => [props[i * 6], props[i * 6 + 1], props[i * 6 + 2]];
  for (let t = 0; t < tris.length; t += 3) vol += dot(pos(tris[t]), cross(pos(tris[t + 1]), pos(tris[t + 2])));
  if (vol < 0) {
    for (let t = 0; t < tris.length; t += 3) [tris[t + 1], tris[t + 2]] = [tris[t + 2], tris[t + 1]];
  }
  const mesh = new wasm.Mesh({ numProp: 6, vertProperties: props, triVerts: Uint32Array.from(tris) });
  const m = new wasm.Manifold(mesh);
  if (m.status() !== 'NoError' || m.isEmpty()) {
    m.delete();
    return null;
  }
  return m;
}

/**
 * Removers for one crease: the corner outside the rolling ball, swept along the crease and a little
 * beyond both ends (so neighbouring creases' removers overlap at the piece's corners). Beyond its
 * ends a remover only takes material farther than r from the offset solid, which a rolling ball
 * would remove too, wherever both surfaces bound the body.
 */
export function creaseRemovers(wasm: ManifoldToplevel, A: Surface, B: Surface, points: readonly Vec3[], opts: FilletOptions): Manifold[] {
  const r = A.outer || B.outer ? opts.outerRadius : opts.innerRadius;
  if (!(r > 0) || points.length < 2) return [];
  // A closed loop swept as one mesh would overlap itself where its ends meet: sweep two halves,
  // which overlap each other at both joins instead.
  if (points.length > 3 && length(sub(points[0], points[points.length - 1])) < 1e-9) {
    const mid = Math.floor(points.length / 2);
    return [
      ...creaseRemovers(wasm, A, B, points.slice(0, mid + 1), opts),
      ...creaseRemovers(wasm, A, B, points.slice(mid), opts),
    ];
  }
  const exact = points.map((p) => projectPair(A, B, p, 0, 0));
  const onCrease = opts.maxTurn === undefined ? resample(exact, opts.step) : resampleByTurn(exact, opts.step, opts.maxTurn);
  if (onCrease.length < 2) return [];
  // Extend past each end by the reach of the corner region (capped for very sharp wedges).
  const reach = (p: Vec3) => {
    const phi = Math.acos(Math.max(-1, Math.min(1, dot(A.n(p), B.n(p)))));
    return Math.min(6 * r, r / Math.max(Math.cos(phi / 2), 0.2) + r);
  };
  const n = onCrease.length;
  const steps = (p: Vec3) => Math.ceil(reach(p) / opts.step);
  const head = extend(A, B, onCrease[0], onCrease[1], steps(onCrease[0]), opts.step).reverse();
  const tail = extend(A, B, onCrease[n - 1], onCrease[n - 2], steps(onCrease[n - 1]), opts.step);
  const stations = [...head, ...onCrease, ...tail].map((p) => station(A, B, p, radiusAt(A, B, p, r, opts.maxReach)));

  // Split where the crease flattens out (nothing to round there).
  const runs: Station[][] = [];
  let cur: Station[] = [];
  for (const s of stations) {
    if (s.phi >= MIN_CREASE && Number.isFinite(s.c[0])) cur.push(s);
    else {
      if (cur.length > 1) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) runs.push(cur);

  const out: Manifold[] = [];
  for (const run of runs) {
    const maxPhi = Math.max(...run.map((s) => s.phi));
    const arcSegs = Math.max(2, Math.min(24, Math.ceil(maxPhi / opts.arcStep)));
    const m = sweepMesh(wasm, run, arcSegs);
    if (m) out.push(m);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Meshes with analytic normals

/** Positions and triangles only. */
export function meshData(mesh: Mesh): MeshData {
  const n = mesh.vertProperties.length / mesh.numProp;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) positions[3 * i + k] = mesh.vertProperties[i * mesh.numProp + k];
  }
  return { positions, indices: Uint32Array.from(mesh.triVerts) };
}

/**
 * Indexed body mesh with analytic normals: each triangle takes the normal of the surface it lies
 * on (cube face, cone, sphere, cylinder) or, on a fillet, the normal swept with the remover.
 */
export function bodyData(mesh: Mesh, surfaces: readonly Surface[], prims: ReadonlyMap<number, readonly number[]>): BodyData {
  const P = mesh.numProp;
  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  const origins = triangleOrigins(mesh);
  const pos = (v: number): Vec3 => [vp[v * P], vp[v * P + 1], vp[v * P + 2]];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const lookup = new Map<string, number>();
  const q = (x: number) => Math.round(x * 1e6);
  for (let t = 0; t < tv.length / 3; t++) {
    const vs = [tv[3 * t], tv[3 * t + 1], tv[3 * t + 2]];
    const ps = vs.map(pos);
    const geo = cross(sub(ps[1], ps[0]), sub(ps[2], ps[0]));
    const gl = length(geo);
    if (gl < 1e-14) continue; // degenerate sliver
    const flat = scale(geo, 1 / gl);
    const cands = prims.get(origins[t]);
    let ns: Vec3[];
    if (cands) {
      const s = surfaces[triangleSurface(surfaces, cands, ps[0], ps[1], ps[2])];
      ns = ps.map((p) => s.n(p));
    } else if (P >= 6) {
      ns = vs.map((v) => {
        const n: Vec3 = [vp[v * P + 3], vp[v * P + 4], vp[v * P + 5]];
        return length(n) > 0.5 ? normalize(n) : flat;
      });
    } else {
      ns = [flat, flat, flat];
    }
    // Never let a misread normal face away from its triangle.
    ns = ns.map((n) => (dot(n, flat) > 0.3 ? n : flat));
    for (let k = 0; k < 3; k++) {
      const p = ps[k];
      const n = ns[k];
      const key = `${q(p[0])},${q(p[1])},${q(p[2])},${q(n[0] * 0.01)},${q(n[1] * 0.01)},${q(n[2] * 0.01)}`;
      let idx = lookup.get(key);
      if (idx === undefined) {
        idx = positions.length / 3;
        lookup.set(key, idx);
        positions.push(p[0], p[1], p[2]);
        normals.push(n[0], n[1], n[2]);
      }
      indices.push(idx);
    }
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) };
}
