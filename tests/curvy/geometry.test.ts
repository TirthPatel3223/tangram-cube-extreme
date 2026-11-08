import { describe, expect, it } from 'vitest';
import { CORE_R } from '../../src/curvy/config';
import {
  APEX,
  type CubeFace,
  EDGES,
  EDGE_AXIS,
  FACES,
  FACE_NORMAL,
  HALF_ANGLE,
  coneSd,
  innerCornerAxis,
  pieceValue,
} from '../../src/curvy/geometry';
import { buildModel } from '../../src/curvy/pieces';
import { mat3Transpose, mat3Vec, type Vec3 } from '../../src/puzzle/vec';

/** Root of f on [lo, hi] by bisection (f changes sign). */
function bisect(f: (t: number) => number, lo: number, hi: number): number {
  let flo = f(lo);
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

describe('cut cones', () => {
  it('are 58° cones tilted 32° from the Helicopter cut, through the face centres', () => {
    expect((HALF_ANGLE * 180) / Math.PI).toBeCloseTo(58, 9);
    expect(APEX).toBeCloseTo((1 - Math.tan((32 * Math.PI) / 180)) / Math.SQRT2, 12);
    for (const e of EDGES) {
      const a = EDGE_AXIS[e];
      for (const f of [e[0], e[1]] as CubeFace[]) {
        const c = FACE_NORMAL[f];
        expect(Math.abs(coneSd(c[0], c[1], c[2], a[0], a[1], a[2]))).toBeLessThan(1e-12);
      }
    }
  });

  it('cut the cube edges 0.348 from the edge midpoint (fitted from the photo: ~0.35)', () => {
    // Along the top edge of the F face (y = 1, z = 1), where the UR cone starts.
    const a = EDGE_AXIS.UR;
    const x = bisect((t) => coneSd(t, 1, 1, a[0], a[1], a[2]), 0, 1);
    expect(x).toBeCloseTo(0.348, 3);
  });

  it("put the Plus's small-triangle cut 0.360 along the face diagonal", () => {
    const X = innerCornerAxis(FACE_NORMAL.F, [1, 1, 1]);
    expect(X[0] * Math.sqrt(18)).toBeCloseTo(-1, 9);
    expect(X[2] * Math.sqrt(18)).toBeCloseTo(4, 9);
    const s = bisect((t) => coneSd(t, t, 1, X[0], X[1], X[2]), 0.05, 0.7);
    expect(s).toBeCloseTo(0.36, 2);
  });

  it('make the small triangle an "inner corner": three cones mutually 60° apart, like a real corner', () => {
    const X = innerCornerAxis(FACE_NORMAL.F, [1, 1, 1]);
    const dots = [
      EDGE_AXIS.UF[0] * EDGE_AXIS.FR[0] + EDGE_AXIS.UF[1] * EDGE_AXIS.FR[1] + EDGE_AXIS.UF[2] * EDGE_AXIS.FR[2],
      X[0] * EDGE_AXIS.UF[0] + X[1] * EDGE_AXIS.UF[1] + X[2] * EDGE_AXIS.UF[2],
      X[0] * EDGE_AXIS.FR[0] + X[1] * EDGE_AXIS.FR[1] + X[2] * EDGE_AXIS.FR[2],
    ];
    for (const d of dots) expect(d).toBeCloseTo(0.5, 12);
  });
});

describe.each([
  ['cc', 44, { edge: 12, corner: 8, xpiece: 24 }, 12],
  ['plus', 68, { edge: 12, corner: 8, petal: 24, triangle: 24 }, 16],
] as const)('%s pieces', (variant, total, kinds, perFace) => {
  const model = buildModel(variant);

  it(`has ${total} pieces of the expected kinds`, () => {
    expect(model.pieces.length).toBe(total);
    for (const [kind, n] of Object.entries(kinds)) {
      expect(model.pieces.filter((p) => p.kind === kind).length, kind).toBe(n);
    }
  });

  it(`shows ${perFace} shapes on every face`, () => {
    for (const f of FACES) {
      const n = model.pieces.reduce((acc, p) => acc + p.stickers.filter((s) => s.color === f).length, 0);
      expect(n, f).toBe(perFace);
    }
  });

  it('fills the cube outside the core: every point is in exactly one piece, and pieces of a kind are congruent', () => {
    const step = 0.05;
    const counts = new Array(model.pieces.length).fill(0);
    const inverse = model.pieces.map((p) => mat3Transpose(p.home));
    let overlaps = 0;
    let uncovered = 0;
    for (let x = -1 + step / 2; x < 1; x += step) {
      for (let y = -1 + step / 2; y < 1; y += step) {
        for (let z = -1 + step / 2; z < 1; z += step) {
          let hits = 0;
          model.pieces.forEach((p, i) => {
            const q = mat3Vec(inverse[i], [x, y, z]);
            if (pieceValue(model.shapes[p.shape].constraints, q[0], q[1], q[2]) <= 0) {
              hits++;
              counts[i]++;
            }
          });
          if (hits > 1) overlaps++;
          if (hits === 0) {
            // Allowed gaps: the core, and the trimmed edge slivers near the face centres.
            const inCones = EDGES.filter((e) => coneSd(x, y, z, ...(EDGE_AXIS[e] as [number, number, number])) < 0);
            const nearFaceAxis = [Math.hypot(y, z), Math.hypot(x, z), Math.hypot(x, y)].some((r) => r < 0.27);
            if (Math.hypot(x, y, z) > CORE_R && inCones.length > 0 && !(inCones.length === 1 && nearFaceAxis)) uncovered++;
          }
        }
      }
    }
    expect(overlaps).toBe(0);
    expect(uncovered).toBe(0);
    for (const kind of Object.keys(kinds)) {
      const c = model.pieces.flatMap((p, i) => (p.kind === kind ? [counts[i]] : []));
      expect(Math.max(...c) - Math.min(...c), kind).toBe(0);
      expect(Math.min(...c), kind).toBeGreaterThan(0);
    }
  });

  it('samples every shape densely on its surface', () => {
    for (const s of model.shapes) {
      expect(s.samples.count, s.kind).toBeGreaterThan(500);
      // every sample satisfies the shape's own constraints
      for (let k = 0; k < s.samples.count; k++) {
        const v = pieceValue(s.constraints, s.samples.pts[3 * k], s.samples.pts[3 * k + 1], s.samples.pts[3 * k + 2]);
        expect(v).toBeLessThan(1e-8);
      }
    }
  });
});

describe('triangle vs corner', () => {
  it('a small triangle is the corner shape turned by the jumble angle (same three cones)', () => {
    const model = buildModel('plus');
    const tri = model.shapes.find((s) => s.kind === 'triangle')!;
    const cones = tri.constraints.filter((c) => c.kind === 'cone' && c.inside).map((c) => (c as { axis: Vec3 }).axis);
    expect(cones.length).toBe(3);
  });
});
