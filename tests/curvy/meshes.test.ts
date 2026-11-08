import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { FACE_NORMAL, pieceValue } from '../../src/curvy/geometry';
import { buildModel } from '../../src/curvy/pieces';
import { type ShapeGeometry, buildShapeGeometry, defaultCsgOptions, loadManifold } from '../../src/curvy/render/csg';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await loadManifold();
});

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
