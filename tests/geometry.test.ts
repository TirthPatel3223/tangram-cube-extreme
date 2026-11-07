import { describe, expect, it } from 'vitest';
import { CUT_S } from '../src/config';
import { createModel } from '../src/puzzle/model';
import { FACE_IDS } from '../src/puzzle/pieces';
import type { VariantId } from '../src/puzzle/variants';

const cases: Array<[VariantId, number, Record<'T' | 'M' | 'B', number>, number]> = [
  ['extreme', 45, { T: 19, M: 7, B: 19 }, 11],
  ['original', 21, { T: 7, M: 7, B: 7 }, 7],
];

describe.each(cases)('%s geometry', (variant, cells, perLayer, perFace) => {
  const model = createModel(variant, CUT_S);

  it(`has ${cells} cells`, () => {
    expect(model.pieces.length).toBe(cells);
  });

  it('has the expected cells per layer', () => {
    for (const layer of ['T', 'M', 'B'] as const) {
      expect(model.pieces.filter((p) => p.layer === layer).length).toBe(perLayer[layer]);
    }
  });

  it(`shows ${perFace} shapes on every face`, () => {
    for (const face of FACE_IDS) {
      const n = model.pieces.reduce((acc, p) => acc + p.stickers.filter((s) => s.face === face).length, 0);
      expect(n, `face ${face}`).toBe(perFace);
    }
  });

  it('has exactly one hidden piece (the core)', () => {
    expect(model.pieces.filter((p) => p.stickers.length === 0).length).toBe(1);
  });

  it('pieces fill the cube exactly', () => {
    const vol = model.pieces.reduce((acc, p) => acc + p.poly.volume, 0);
    expect(vol).toBeCloseTo(8, 9);
  });
});

describe('face pattern on +z matches the measured cut lines', () => {
  for (const variant of ['extreme', 'original'] as const) {
    it(variant, () => {
      const model = createModel(variant, CUT_S);
      const { b, c } = model.cut;
      // Lines on the face z = 1, as functions that vanish on the line.
      const lines: Array<[string, (x: number, y: number) => number]> = [
        ['T layer cut  x+y = c-1', (x, y) => x + y - (c - 1)],
        ['B layer cut  x+y = -c-1', (x, y) => x + y + c + 1],
        ['edge cut     x-y = b', (x, y) => x - y - b],
        ['edge cut     x = 1-b', (x) => x - (1 - b)],
      ];
      if (variant === 'extreme') {
        lines.push(['extra cut    x-y = -b', (x, y) => x - y + b]);
        lines.push(['extra cut    y = 1-b', (_x, y) => y - (1 - b)]);
      }
      const used = new Set<string>();
      const onBoundary = (x: number, y: number) => Math.abs(Math.abs(x) - 1) < 1e-9 || Math.abs(Math.abs(y) - 1) < 1e-9;
      for (const p of model.pieces) {
        for (const s of p.stickers.filter((st) => st.face === '+z')) {
          const poly = s.polygon;
          for (let i = 0; i < poly.length; i++) {
            const [x0, y0] = poly[i];
            const [x1, y1] = poly[(i + 1) % poly.length];
            const mid: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
            if (onBoundary(mid[0], mid[1]) && (Math.abs(x0 - x1) < 1e-9 || Math.abs(y0 - y1) < 1e-9)) continue;
            const hit = lines.find(([, f]) => Math.abs(f(x0, y0)) < 1e-9 && Math.abs(f(x1, y1)) < 1e-9);
            expect(hit, `edge (${x0.toFixed(3)},${y0.toFixed(3)})-(${x1.toFixed(3)},${y1.toFixed(3)})`).toBeDefined();
            used.add(hit![0]);
          }
        }
      }
      expect([...used].sort()).toEqual(lines.map(([name]) => name).sort());
    });
  }
});
