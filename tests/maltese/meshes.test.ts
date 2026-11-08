import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadManifoldKernel } from '../../src/render/manifold';
import { mulberry32 } from '../../src/puzzle/moves';
import type { Mat3 } from '../../src/puzzle/vec';
import { MM } from '../../src/maltese/config';
import { PIECES } from '../../src/maltese/model';
import { type PrototypeSolids, buildMalteseGeometry, buildPrototypeSolids } from '../../src/maltese/render/pieces';
import { generateScramble } from '../../src/maltese/scramble';
import { MalteseState } from '../../src/maltese/state';

let wasm: ManifoldToplevel;
let solids: PrototypeSolids;
const owned: Array<{ delete(): void }> = [];
const keep = <M extends { delete(): void }>(m: M): M => {
  owned.push(m);
  return m;
};

beforeAll(async () => {
  wasm = await loadManifoldKernel();
  solids = buildPrototypeSolids(wasm, keep);
});
afterAll(() => {
  for (const m of owned) m.delete();
});

const mat4 = (r: Mat3) => [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, 0, 0, 0, 1] as const;

function placed(st: MalteseState): Manifold[] {
  return PIECES.map((p) => {
    const proto = p.kind === 'corner' ? solids.corner : p.kind === 'centre' ? solids.centre : p.kind === 'edge' ? solids.edge : solids.gear;
    return keep(proto.solid.transform([...mat4(st.matrix(p.id))]));
  });
}

/**
 * Largest overlap volume (mm³) between any two pieces (or a piece and the core).
 *
 * Tolerance: each inner arm tip of a corner rests in a gear's side notch. The gear's walls follow its
 * spin axis (22.5° off the face normal) while the arm's follow the face normal, so just under the
 * surface they converge; with the photo outlines this leaves a sliver of at most 0.04 mm³ (top
 * 0.5 mm, under 0.1 mm thick), below the photo fit's accuracy and invisible (black on black).
 */
const AT_REST_MM3 = 0.05;
function worstOverlap(st: MalteseState): { mm3: number; a: string; b: string } {
  const ms = [...placed(st), solids.core];
  const names = [...PIECES.map((p) => `${p.kind} ${p.name}`), 'core'];
  const boxes = ms.map((m) => m.boundingBox());
  let worst = { mm3: 0, a: '', b: '' };
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      const A = boxes[i];
      const B = boxes[j];
      if (A.max.some((v, k) => v < B.min[k]) || B.max.some((v, k) => v < A.min[k])) continue;
      const v = keep(ms[i].intersect(ms[j])).volume() / MM ** 3;
      if (v > worst.mm3) worst = { mm3: v, a: names[i], b: names[j] };
    }
  }
  return worst;
}

describe('piece solids', () => {
  it('builds four valid prototypes with the right stickers', () => {
    for (const [kind, n] of [['corner', 3], ['centre', 1], ['edge', 2], ['gear', 1]] as const) {
      const p = solids[kind];
      expect(p.solid.status(), kind).toBe('NoError');
      expect(p.solid.volume(), kind).toBeGreaterThan(0);
      expect(p.solid.decompose().length, `${kind} is one piece`).toBe(1);
      expect(p.stickers.length, kind).toBe(n);
      for (const s of p.stickers) expect(s.indices.length).toBeGreaterThan(0);
    }
  });

  it('every sticker triangle faces outward (no culled stickers)', () => {
    for (const kind of ['corner', 'centre', 'edge', 'gear'] as const) {
      for (const s of solids[kind].stickers) {
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

  it('renders meshes with normals', () => {
    const g = buildMalteseGeometry(wasm);
    for (const kind of ['corner', 'centre', 'edge', 'gear'] as const) {
      const b = g[kind].body;
      expect(b.positions.length).toBe(b.normals.length);
      expect(b.indices.length % 3).toBe(0);
    }
  }, 30000);

  it('an edge stands 11 mm proud of the face when it sits in a centre slot', () => {
    const bb = solids.edge.solid.boundingBox();
    expect((bb.max[2] - 1) / MM).toBeCloseTo(11 - 0.15, 1);
  });

  it('nothing overlaps when solved', () => {
    const w = worstOverlap(MalteseState.solved());
    expect(w.mm3, `${w.a} / ${w.b}`).toBeLessThan(AT_REST_MM3);
  });

  it('nothing overlaps in shape-shifted states (seeded scrambles)', () => {
    const rng = mulberry32(2026);
    for (let i = 0; i < 6; i++) {
      const st = MalteseState.solved();
      st.applyAll(generateScramble(rng, 20));
      const w = worstOverlap(st);
      expect(w.mm3, `scramble ${i}: ${w.a} / ${w.b}`).toBeLessThan(AT_REST_MM3);
    }
  });
});
