import type { Manifold, ManifoldToplevel, Mat4, Mesh } from 'manifold-3d';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/puzzle/moves';
import type { Mat3, Vec3 } from '../../src/puzzle/vec';
import { loadManifoldKernel } from '../../src/render/manifold';
import { DIM, MM } from '../../src/maltese/config';
import { PIECES } from '../../src/maltese/model';
import {
  GEAR_CAP_NORMAL,
  HUB_Z,
  PAD,
  type Proto,
  type PrototypeSolids,
  buildMalteseGeometry,
  buildPrototypeSolids,
  defaultFillet,
  edgeRoof,
  roundedSolid,
} from '../../src/maltese/render/pieces';
import { generateScramble } from '../../src/maltese/scramble';
import { MalteseState } from '../../src/maltese/state';

let wasm: ManifoldToplevel;
let solids: PrototypeSolids;
const rounded = new Map<string, Manifold>();
const owned: Array<{ delete(): void }> = [];
const keep = <M extends { delete(): void }>(m: M): M => {
  owned.push(m);
  return m;
};

const KINDS = ['corner', 'centre', 'edge', 'gear'] as const;
type Kind = (typeof KINDS)[number];

beforeAll(async () => {
  wasm = await loadManifoldKernel();
  solids = buildPrototypeSolids(wasm, keep);
  for (const k of KINDS) rounded.set(k, roundedSolid(solids[k], defaultFillet()));
}, 60000);
afterAll(() => {
  for (const m of owned) m.delete();
});

const mat4 = (r: Mat3): Mat4 => [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, 0, 0, 0, 1];

function proto(kind: Kind): Proto {
  return solids[kind];
}

function placed(st: MalteseState): Manifold[] {
  return PIECES.map((p) => keep(proto(p.kind).sharp.transform(mat4(st.matrix(p.id)))));
}

interface Directions {
  /** A cone (axis, half-angle) and a box (per coordinate of the unit direction) holding them all. */
  readonly axis: Vec3;
  readonly angle: number;
  readonly lo: Vec3;
  readonly hi: Vec3;
  /** Nearest approach to the centre. */
  readonly rMin: number;
}

/**
 * Directions a solid covers from the centre. Every surface triangle is seen from the centre as a
 * spherical triangle spanned by its corners' directions, so bounds on the vertices' directions bound
 * the whole solid (when it spans less than a hemisphere, as every piece does).
 */
function directions(m: Manifold): Directions {
  const mesh = m.getMesh();
  const P = mesh.numProp;
  const n = mesh.vertProperties.length / P;
  const dirs: Vec3[] = [];
  const s = [0, 0, 0];
  const lo = [1, 1, 1];
  const hi = [-1, -1, -1];
  let rMin = Infinity;
  for (let i = 0; i < n; i++) {
    const x = mesh.vertProperties[i * P];
    const y = mesh.vertProperties[i * P + 1];
    const z = mesh.vertProperties[i * P + 2];
    const l = Math.hypot(x, y, z);
    rMin = Math.min(rMin, l);
    const d: Vec3 = [x / l, y / l, z / l];
    dirs.push(d);
    for (let k = 0; k < 3; k++) {
      s[k] += d[k];
      lo[k] = Math.min(lo[k], d[k]);
      hi[k] = Math.max(hi[k], d[k]);
    }
  }
  const l = Math.hypot(...s);
  const axis: Vec3 = [s[0] / l, s[1] / l, s[2] / l];
  let angle = 0;
  for (const d of dirs) angle = Math.max(angle, Math.acos(Math.min(1, d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2])));
  return { axis, angle, lo: lo as unknown as Vec3, hi: hi as unknown as Vec3, rMin };
}

/** Could two pieces' cones of directions meet? (Necessary for any overlap; the sides of a spherical
 *  triangle bulge past its corners' coordinate box only near the poles, hence the margin.) */
function mayMeet(a: Directions, b: Directions): boolean {
  const c = a.axis[0] * b.axis[0] + a.axis[1] * b.axis[1] + a.axis[2] * b.axis[2];
  if (Math.acos(Math.max(-1, Math.min(1, c))) > a.angle + b.angle + 1e-6) return false;
  for (let k = 0; k < 3; k++) if (a.lo[k] > b.hi[k] + 0.05 || b.lo[k] > a.hi[k] + 0.05) return false;
  return true;
}

/**
 * Largest overlap volume (mm³) between any two pieces (or a piece and the core). Every body is a cone
 * from the centre, so two pieces can only meet if their cones of directions do (the broad phase).
 */
const AT_REST_MM3 = 0.01;
function worstOverlap(st: MalteseState): { mm3: number; a: string; b: string } {
  const ms = [...placed(st), solids.core];
  const names = [...PIECES.map((p) => `${p.kind} ${p.name}`), 'core'];
  const dirs = ms.map((m, i) => (i < PIECES.length ? directions(m) : null));
  const coreR = DIM.coreRadiusMm * MM;
  let worst = { mm3: 0, a: '', b: '' };
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      const di = dirs[i];
      const dj = dirs[j];
      if (di && dj && !mayMeet(di, dj)) continue;
      // The core is a ball: a piece that stays outside its radius cannot overlap it.
      if (!dj && di && di.rMin > coreR) continue;
      const v = keep(ms[i].intersect(ms[j])).volume() / MM ** 3;
      if (v > worst.mm3) worst = { mm3: v, a: names[i], b: names[j] };
    }
  }
  return worst;
}

// ---- point-in-mesh and slicing helpers

function vertsOf(mesh: Mesh): Float64Array {
  const P = mesh.numProp;
  const n = mesh.vertProperties.length / P;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[3 * i + k] = mesh.vertProperties[i * P + k];
  return out;
}

/** Is p inside the closed mesh? (Parity of crossings along a slanted ray.) */
function inside(mesh: Mesh, verts: Float64Array, p: Vec3): boolean {
  const d: Vec3 = [0.3711, 0.5279, 0.7637];
  let hits = 0;
  const tv = mesh.triVerts;
  for (let t = 0; t < tv.length; t += 3) {
    const a = 3 * tv[t];
    const b = 3 * tv[t + 1];
    const c = 3 * tv[t + 2];
    const e1 = [verts[b] - verts[a], verts[b + 1] - verts[a + 1], verts[b + 2] - verts[a + 2]];
    const e2 = [verts[c] - verts[a], verts[c + 1] - verts[a + 1], verts[c + 2] - verts[a + 2]];
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-14) continue;
    const s = [p[0] - verts[a], p[1] - verts[a + 1], p[2] - verts[a + 2]];
    const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det;
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    if ((e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det > 0) hits++;
  }
  return hits % 2 === 1;
}

/** Turn a solid so the plane n·p = d becomes z = 0 (n becomes +z); returns the turned solid and the map. */
function planeToTop(m: Manifold, n: Vec3, d: number): { m: Manifold; map: (p: Vec3) => [number, number] } {
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u0: Vec3 = [ref[1] * n[2] - ref[2] * n[1], ref[2] * n[0] - ref[0] * n[2], ref[0] * n[1] - ref[1] * n[0]];
  const ul = Math.hypot(...u0);
  const u: Vec3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
  const w: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  // Rows u, w, n; translate by -d along the new z.
  const M: Mat4 = [u[0], w[0], n[0], 0, u[1], w[1], n[1], 0, u[2], w[2], n[2], 0, 0, 0, -d, 1];
  return {
    m: keep(m.transform(M)),
    map: (p) => [u[0] * p[0] + u[1] * p[1] + u[2] * p[2], w[0] * p[0] + w[1] * p[1] + w[2] * p[2]],
  };
}

function distToPolys(p: [number, number], polys: [number, number][][]): number {
  let best = Infinity;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
    }
  }
  return best;
}

function insidePolys(p: [number, number], polys: [number, number][][]): boolean {
  let c = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

/** Each sticker with the plane it lies on (n·p = d), in its prototype's frame. */
function stickerPlanes(kind: Kind): { pts: Vec3[]; n: Vec3; d: number }[] {
  return proto(kind).stickers.map((s) => {
    const pts: Vec3[] = [];
    for (let i = 0; i < s.positions.length; i += 3) pts.push([s.positions[i], s.positions[i + 1], s.positions[i + 2]]);
    const n = s.normal;
    const lift = DIM.stickerLiftMm * MM;
    const d = n[0] * pts[0][0] + n[1] * pts[0][1] + n[2] * pts[0][2] - lift;
    return { pts, n, d };
  });
}

describe('piece solids', () => {
  it('builds four valid prototypes with the right stickers', () => {
    for (const [kind, n] of [['corner', 3], ['centre', 1], ['edge', 2], ['gear', 1]] as const) {
      const p = proto(kind);
      expect(p.sharp.status(), kind).toBe('NoError');
      expect(p.sharp.volume(), kind).toBeGreaterThan(0);
      expect(p.sharp.decompose().length, `${kind} is one piece`).toBe(1);
      const r = rounded.get(kind)!;
      expect(r.status(), kind).toBe('NoError');
      expect(r.decompose().length, `rounded ${kind} is one piece`).toBe(1);
      // Rounding only shaves the edges.
      expect(r.volume() / p.sharp.volume(), kind).toBeGreaterThan(0.97);
      expect(r.volume() / p.sharp.volume(), kind).toBeLessThanOrEqual(1 + 1e-9);
      expect(p.stickers.length, kind).toBe(n);
      for (const s of p.stickers) expect(s.indices.length).toBeGreaterThan(0);
    }
  });

  it('every sticker triangle faces outward (no culled stickers)', () => {
    for (const kind of KINDS) {
      for (const s of proto(kind).stickers) {
        const P = s.positions;
        for (let t = 0; t < s.indices.length; t += 3) {
          const [a, b, c] = [s.indices[t], s.indices[t + 1], s.indices[t + 2]].map((v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]]);
          const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
          expect(n[0] * s.normal[0] + n[1] * s.normal[1] + n[2] * s.normal[2], kind).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('builds the render meshes quickly, with unit normals that face out of their triangles', () => {
    const t0 = performance.now();
    const g = buildMalteseGeometry(wasm);
    expect(performance.now() - t0).toBeLessThan(15000); // about 1-3 s here; generous for slow CI runners
    for (const kind of KINDS) {
      const b = g[kind].body;
      expect(b.positions.length).toBe(b.normals.length);
      expect(b.indices.length % 3).toBe(0);
      expect(g[kind].pick.indices.length).toBeGreaterThan(0);
      let bad = 0;
      for (let t = 0; t < b.indices.length; t += 3) {
        const [i, j, k] = [b.indices[t], b.indices[t + 1], b.indices[t + 2]];
        const p = (v: number) => [b.positions[3 * v], b.positions[3 * v + 1], b.positions[3 * v + 2]];
        const [A, B, C] = [p(i), p(j), p(k)];
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
        const w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const fl = Math.hypot(f[0], f[1], f[2]);
        for (const v of [i, j, k]) {
          const n = [b.normals[3 * v], b.normals[3 * v + 1], b.normals[3 * v + 2]];
          expect(Math.abs(Math.hypot(n[0], n[1], n[2]) - 1)).toBeLessThan(1e-3);
          // (Slivers from the booleans can flip in float32; they are invisible.)
          if (fl > 1e-9 && (n[0] * f[0] + n[1] * f[1] + n[2] * f[2]) / fl <= 0) bad++;
        }
      }
      expect(bad, kind).toBe(0);
    }
  }, 60000);

  it('an edge stands 11 mm proud of the face when it sits in a centre slot', () => {
    const bb = proto('edge').sharp.boundingBox();
    expect((bb.max[2] - 1) / MM).toBeCloseTo(11 - 0.15, 1);
  });

  it('every sticker has the same plastic margin around it', () => {
    const pad = PAD / MM;
    for (const kind of KINDS) {
      for (const s of stickerPlanes(kind)) {
        // The top face of the sharp body, just under the sticker's plane.
        const { m, map } = planeToTop(proto(kind).sharp, s.n, s.d - 1e-5);
        const top = m.slice(0).toPolygons() as [number, number][][];
        const sticker = [s.pts.map(map)];
        // No part of a sticker comes closer to the edge than the padding ...
        const inner = s.pts.map((p) => distToPolys(map(p), top) / MM);
        expect(Math.min(...inner), kind).toBeGreaterThan(pad - 0.02);
        // ... and the plateau's edge runs one padding from the sticker all round (the corner's bridges
        // over the bevel and the small notch radii aside).
        const edge = top.flat().map((q) => distToPolys(q, sticker) / MM);
        const exact = edge.filter((d) => Math.abs(d - pad) < 0.03).length;
        expect(exact / edge.length, `${kind}: share of the plateau edge one padding from the sticker`).toBeGreaterThan(0.85);
      }
    }
  });

  it('stickers sit on the flat: the rounding stops short of every sticker', () => {
    for (const kind of KINDS) {
      const r = rounded.get(kind)!;
      for (const s of stickerPlanes(kind)) {
        const { m, map } = planeToTop(r, s.n, s.d - 2e-5);
        const top = m.slice(0).toPolygons() as [number, number][][];
        for (const p of s.pts) {
          const q = map(p);
          expect(insidePolys(q, top), `${kind} sticker point on the flat top`).toBe(true);
          expect(distToPolys(q, top) / MM, kind).toBeGreaterThan(0.05);
        }
      }
    }
  });

  it('the gear body is under its whole sticker, deep down, so it rises with it in every orientation', () => {
    // Body and sticker share one frame (a gear in any slot and orientation is this prototype turned),
    // so checking the prototype checks every k.
    const body = rounded.get('gear')!;
    const mesh = body.getMesh();
    const verts = vertsOf(mesh);
    const n = GEAR_CAP_NORMAL;
    const s = stickerPlanes('gear')[0];
    const lift = (DIM.stickerLiftMm + 0.01) * MM;
    const core = DIM.coreRadiusMm * MM;
    for (let i = 0; i < s.pts.length; i += 3) {
      // From the sticker point, down onto the plastic and on towards the centre (the body is a cone):
      // just under the sticker, half way down to the core, and just above the core.
      const p = s.pts[i];
      const t: Vec3 = [p[0] - n[0] * lift, p[1] - n[1] * lift, p[2] - n[2] * lift];
      const l = Math.hypot(...t);
      for (const depth of [0.2 * MM, (l - core) / 2, l - core - 0.15 * MM]) {
        const k = (l - depth) / l;
        const q: Vec3 = [t[0] * k, t[1] * k, t[2] * k];
        expect(inside(mesh, verts, q), `gear body ${(depth / MM).toFixed(2)} mm under sticker point ${i}`).toBe(true);
      }
    }
    // And the body reaches all the way down to the core.
    expect(body.boundingBox().min[2]).toBeLessThan((DIM.coreRadiusMm + 0.5) * MM);
    expect(HUB_Z).toBeGreaterThan(1);
  });

  it('nothing overlaps when solved', () => {
    const w = worstOverlap(MalteseState.solved());
    expect(w.mm3, `${w.a} / ${w.b}`).toBeLessThan(AT_REST_MM3);
  }, 120000);

  // Shape-shifted states: edges proud, centres sunk, gears tilted in every orientation. One test per
  // scramble, so each has its own time budget (about 20 s each here, slower on CI).
  const scrambles = (() => {
    const rng = mulberry32(2026);
    return Array.from({ length: 6 }, (_, i) => ({ i, moves: generateScramble(rng, 20) }));
  })();
  it.each(scrambles)('nothing overlaps in shape-shifted state $i (seeded scramble)', ({ i, moves }) => {
    const st = MalteseState.solved();
    st.applyAll(moves);
    const w = worstOverlap(st);
    expect(w.mm3, `scramble ${i}: ${w.a} / ${w.b}`).toBeLessThan(AT_REST_MM3);
  }, 120000);

  it('the core blocks every line of sight except the four see-through holes at the corners', () => {
    const st = MalteseState.solved();
    const scene = new THREE.Group();
    const add = (mesh: Mesh, m: Mat3 | null) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(vertsOf(mesh)), 3));
      g.setIndex(Array.from(mesh.triVerts));
      const obj = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      if (m) obj.matrix.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
      obj.matrixAutoUpdate = false;
      obj.updateMatrixWorld(true);
      scene.add(obj);
    };
    const meshes = new Map(KINDS.map((k) => [k, rounded.get(k)!.getMesh()]));
    for (const p of PIECES) add(meshes.get(p.kind)!, st.matrix(p.id));
    add(solids.core.getMesh(), null);
    scene.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const rng = mulberry32(7);
    let through = 0;
    for (let i = 0; i < 300; i++) {
      // A random line through the cube that stays clear of the four diagonal holes.
      const dir = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      const off = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.9);
      off.sub(dir.clone().multiplyScalar(off.dot(dir)));
      const nearDiagonal = [
        [1, 1, 1],
        [-1, 1, 1],
        [1, -1, 1],
        [1, 1, -1],
      ].some((d) => {
        const a = new THREE.Vector3(...d).normalize();
        return Math.abs(a.dot(dir)) > 0.99 && off.clone().sub(a.clone().multiplyScalar(off.dot(a))).length() < 5 * MM;
      });
      if (nearDiagonal) continue;
      ray.set(off.clone().sub(dir.clone().multiplyScalar(3)), dir);
      if (ray.intersectObject(scene, true).length === 0) through++;
    }
    expect(through, 'lines of sight straight through the puzzle').toBe(0);
    // Straight down each body diagonal you can see through: the hollow cubes open into the empty core.
    for (const d of [
      [1, 1, 1],
      [-1, 1, 1],
      [1, -1, 1],
      [1, 1, -1],
    ]) {
      const a = new THREE.Vector3(...d).normalize();
      ray.set(a.clone().multiplyScalar(-3), a);
      expect(ray.intersectObject(scene, true).length, `diagonal ${d}`).toBe(0);
    }
  }, 120000);

  it('the core is a hollow ball, cut back to the hollow cube at every vertex', () => {
    const core = solids.core;
    const mesh = core.getMesh();
    const verts = vertsOf(mesh);
    const R = DIM.coreRadiusMm * MM;
    const rIn = (DIM.coreRadiusMm - DIM.coreShellMm) * MM;
    expect(core.status()).toBe('NoError');
    expect(core.decompose().length).toBe(1);
    // In the shell under every face and edge; empty in the middle.
    const mid = (R + rIn) / 2;
    for (const d of [
      [1, 0, 0],
      [0, -1, 0],
      [0, 0, 1],
      [1, 1, 0],
      [0, -1, 1],
    ]) {
      const l = Math.hypot(...d);
      expect(inside(mesh, verts, [(d[0] / l) * mid, (d[1] / l) * mid, (d[2] / l) * mid]), `shell under ${d}`).toBe(true);
    }
    expect(inside(mesh, verts, [0.1, 0.2, 0.3])).toBe(false);
    // Each vertex: the hollow cube [a, ...]^3 is cut out (it opens into the middle).
    const a = DIM.vertexBoxMm * MM;
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        for (const sz of [1, -1]) {
          const at = (t: number): Vec3 => [sx * t, sy * t, sz * t];
          expect(inside(mesh, verts, at(a + 0.05)), 'in the hollow cube').toBe(false);
          expect(inside(mesh, verts, at(mid / Math.sqrt(3))), 'on the diagonal, in the shell').toBe(false);
        }
      }
    }
    // The shell next to the pockets is still there.
    expect(inside(mesh, verts, [a - 0.03, a + 0.1, Math.sqrt(Math.max(0, mid * mid - (a - 0.03) ** 2 - (a + 0.1) ** 2))])).toBe(true);
    // Volume: the shell less the eight cube corners.
    const shell = ((4 / 3) * Math.PI * (R ** 3 - rIn ** 3)) / MM ** 3;
    const v = core.volume() / MM ** 3;
    expect(v).toBeLessThan(shell);
    expect(v).toBeGreaterThan(0.9 * shell);
  });

  it('keeps the edge roof geometry: crest above the shoulders by 2 mm', () => {
    const { c0, crest, yCrest } = edgeRoof();
    expect(crest).toBeGreaterThan(1);
    expect(yCrest).toBeGreaterThan(0);
    expect((c0 - (DIM.columnMm / 2 - DIM.gapMm) * MM - crest) / MM).toBeCloseTo(-2, 0);
  });
});
