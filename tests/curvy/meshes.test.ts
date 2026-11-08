import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { FACE_NORMAL, pieceValue } from '../../src/curvy/geometry';
import { buildModel } from '../../src/curvy/pieces';
import { type ShapeGeometry, buildShapeGeometry, defaultCsgOptions, loadManifold } from '../../src/curvy/render/csg';
import { type Surface, shapeSurfaces } from '../../src/curvy/render/fillet';
import { type Vec3, cross, dot, normalize, sub } from '../../src/puzzle/vec';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await loadManifold();
});

/** Like pieceValue for the shrunk body's surfaces: <= 0 inside (the tip cut is a union of two surfaces). */
function bodyValue(surfaces: readonly Surface[], p: Vec3): number {
  let worst = -Infinity;
  const tip: number[] = [];
  for (const s of surfaces) {
    if (s.union) tip.push(s.g(p));
    else worst = Math.max(worst, s.g(p));
  }
  for (let i = 0; i < tip.length; i += 2) worst = Math.max(worst, Math.min(tip[i], tip[i + 1]));
  return worst;
}

const vec = (a: ArrayLike<number>, i: number): Vec3 => [a[3 * i], a[3 * i + 1], a[3 * i + 2]];

/** Voxel estimate of a shape's volume. */
function voxelVolume(cons: Parameters<typeof pieceValue>[0], step = 0.02): number {
  let n = 0;
  for (let x = -1 + step / 2; x < 1; x += step)
    for (let y = -1 + step / 2; y < 1; y += step)
      for (let z = -1 + step / 2; z < 1; z += step) if (pieceValue(cons, x, y, z) <= 0) n++;
  return n * step ** 3;
}

describe.each(['cc', 'plus'] as const)('%s meshes', (variant) => {
  const model = buildModel(variant);
  const opts = defaultCsgOptions();
  const geo: ShapeGeometry[] = [];

  it('builds every shape quickly', () => {
    const t0 = performance.now();
    for (const s of model.shapes) geo.push(buildShapeGeometry(wasm, s, opts));
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('exact solids match the analytic shapes (volume within 2%)', () => {
    model.shapes.forEach((s, i) => {
      const v = voxelVolume(s.constraints);
      expect(Math.abs(geo[i].volume - v) / v, s.kind).toBeLessThan(0.02);
    });
  });

  it('bodies are closed meshes with a gap-sized clearance inside the exact shape', () => {
    model.shapes.forEach((s, i) => {
      const { positions, indices } = geo[i].body;
      expect(indices.length % 3).toBe(0);
      expect(indices.length / 3, s.kind).toBeGreaterThan(100);
      // every body vertex lies inside the exact piece (shrunk by the gap on cut faces)
      let worst = -Infinity;
      for (let k = 0; k < positions.length; k += 3) {
        worst = Math.max(worst, pieceValue(s.constraints, positions[k], positions[k + 1], positions[k + 2]));
      }
      expect(worst, s.kind).toBeLessThan(1e-3);
    });
  });

  it('stickers lie on their faces, inset from every cut by the sticker margin', () => {
    model.shapes.forEach((s, i) => {
      expect(geo[i].stickers.map((t) => t.face).sort(), s.kind).toEqual([...s.stickerFaces].sort());
      for (const st of geo[i].stickers) {
        const n = FACE_NORMAL[st.face];
        for (let k = 0; k < st.positions.length; k += 3) {
          const p: [number, number, number] = [st.positions[k], st.positions[k + 1], st.positions[k + 2]];
          const h = p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
          expect(h).toBeCloseTo(1 + opts.stickerLift, 5);
          // Pull the point back onto the face and check it is well inside the piece's face region.
          const q: [number, number, number] = [p[0] - (h - 1 + 1e-6) * n[0], p[1] - (h - 1 + 1e-6) * n[1], p[2] - (h - 1 + 1e-6) * n[2]];
          const cons = s.constraints.filter((c) => c.kind !== 'cube');
          expect(pieceValue(cons, q[0], q[1], q[2]), s.kind).toBeLessThan(-opts.stickerInset * 0.7);
        }
      }
    });
  });

  it('rounds every crease (only where the tip cut turns concave does a fillet stop short)', () => {
    model.shapes.forEach((s, i) => {
      const { surfaces } = shapeSurfaces(s.constraints, opts.gap / 2);
      const onTwo = (positions: Float32Array) => {
        let n = 0;
        for (let k = 0; k < positions.length / 3; k++) {
          const p = vec(positions, k);
          const on = surfaces.filter((sf) => Math.abs(sf.g(p)) < 2e-4);
          if (new Set(on.map((sf) => sf.group)).size >= 2 && !on.some((sf) => sf.union)) n++;
        }
        return n;
      };
      expect(onTwo(geo[i].pick.positions), s.kind).toBeGreaterThan(100); // the sharp body has creases
      expect(onTwo(geo[i].body.positions), s.kind).toBe(0);
    });
  });

  it('rounding never cuts deeper than a rolling ball would', () => {
    const { outerRadius, innerRadius } = opts.fillet!;
    model.shapes.forEach((s, i) => {
      const { surfaces } = shapeSurfaces(s.constraints, opts.gap / 2);
      const P = geo[i].body.positions;
      let worst = -Infinity;
      for (let k = 0; k < P.length / 3; k++) {
        const p = vec(P, k);
        // The surfaces bounding the body near p; of each tip cut (a union) only the one that holds.
        const near = surfaces.filter(
          (sf) =>
            sf.g(p) > -2 * outerRadius &&
            (!sf.union || surfaces.every((o) => o === sf || o.group !== sf.group || o.g(p) > sf.g(p))),
        );
        const depth = -Math.max(...near.map((sf) => sf.g(p)));
        // A ball of radius r in a crease whose normals are phi apart rests r(1 - cos(phi/2)) below
        // both surfaces: p must be within that of its nearest surface for some pair of them.
        let allowed = 0;
        for (const a of near) {
          for (const b of near) {
            if (a.group === b.group) continue;
            const phi = Math.acos(Math.max(-1, Math.min(1, dot(a.n(p), b.n(p)))));
            const r = a.outer || b.outer ? outerRadius : innerRadius;
            allowed = Math.max(allowed, r * (1 - Math.cos(phi / 2)));
          }
        }
        worst = Math.max(worst, depth - allowed);
      }
      expect(worst, s.kind).toBeLessThan(3e-4);
    });
  });

  it('stickers sit on the flat part of their faces, clear of the rounded edges', () => {
    const r = opts.fillet!.outerRadius;
    model.shapes.forEach((s, i) => {
      const { surfaces } = shapeSurfaces(s.constraints, opts.gap / 2);
      for (const st of geo[i].stickers) {
        const n = FACE_NORMAL[st.face];
        for (let k = 0; k < st.positions.length / 3; k++) {
          const p = vec(st.positions, k);
          const h = dot(p, n);
          // The ball under this point, touching the face, must fit inside the body.
          const c: Vec3 = [p[0] - (h - 1 + r) * n[0], p[1] - (h - 1 + r) * n[1], p[2] - (h - 1 + r) * n[2]];
          expect(bodyValue(surfaces, c), s.kind).toBeLessThan(-r + 1e-6);
        }
      }
    });
  });

  it('body normals are unit length and face out of their triangles', () => {
    for (const g of geo) {
      const { positions: P, normals: N, indices: I } = g.body;
      for (let k = 0; k < N.length / 3; k++) expect(Math.hypot(...vec(N, k))).toBeCloseTo(1, 4);
      for (let t = 0; t < I.length; t += 3) {
        const a = vec(P, I[t]);
        const face = cross(sub(vec(P, I[t + 1]), a), sub(vec(P, I[t + 2]), a));
        if (Math.hypot(...face) < 1e-10) continue;
        const f = normalize(face);
        for (let j = 0; j < 3; j++) expect(dot(vec(N, I[t + j]), f)).toBeGreaterThan(0.3);
      }
    }
  });

  if (variant === 'plus') {
    it('punches the dot into the small triangles only', () => {
      const tri = model.shapes.findIndex((s) => s.kind === 'triangle');
      const petal = model.shapes.findIndex((s) => s.kind === 'petal');
      // a dot is a hole: the triangle's sticker outline has a second (inner) loop, so more vertices
      expect(geo[tri].stickers[0].positions.length / 3).toBeGreaterThan(40);
      expect(geo[petal].stickers.length).toBe(1);
    });
  }
});
