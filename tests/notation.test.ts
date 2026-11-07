import { describe, expect, it } from 'vitest';
import { CUT_S } from '../src/config';
import { createModel } from '../src/puzzle/model';
import {
  formatSequence,
  generateScramble,
  invertSequence,
  mulberry32,
  normalizeAmount,
  parseAlgorithm,
} from '../src/puzzle/moves';
import { PuzzleState } from '../src/puzzle/state';
import { VARIANTS } from '../src/puzzle/variants';

const ext = VARIANTS.extreme;
const orig = VARIANTS.original;

describe('notation', () => {
  it('normalizes amounts into (-order/2, order/2]', () => {
    expect([1, 2, 3, 4, 5, 6, -1, -3, 7].map((a) => normalizeAmount(a, 6))).toEqual([1, 2, 3, -2, -1, 0, -1, 3, 1]);
    expect([1, 2, 3, -1].map((a) => normalizeAmount(a, 3))).toEqual([1, -1, 0, -1]);
  });

  it('parses and formats the Extreme notation', () => {
    const r = parseAlgorithm("U U2 U3 U2' U' D4 F R' L", ext);
    expect(r.ok).toBe(true);
    if (r.ok) expect(formatSequence(r.moves)).toBe("U U2 U3 U2' U' D2' F R L");
  });

  it('round-trips every move', () => {
    const text = "U U2 U3 U2' U' D D2 D3 D2' D' F R L";
    const r = parseAlgorithm(text, ext);
    expect(r.ok && formatSequence(r.moves)).toBe(text);
  });

  it('accepts compact input and lower case', () => {
    const r = parseAlgorithm("uf'R(D2)", ext);
    expect(r.ok && formatSequence(r.moves)).toBe('U F R D2');
  });

  it('uses 120-degree steps on the original', () => {
    const r = parseAlgorithm("U2 D U'", orig);
    expect(r.ok && formatSequence(r.moves)).toBe("U' D U'");
  });

  it('rejects bad input with a position', () => {
    const bad = parseAlgorithm('U X', ext);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.index).toBe(2);
    expect(parseAlgorithm('F2', ext).ok).toBe(false);
    expect(parseAlgorithm('U6', ext).ok).toBe(false);
    expect(parseAlgorithm('U3', orig).ok).toBe(false);
  });
});

describe('scramble', () => {
  it('is deterministic for a seed and alternates corner turns with different flips', () => {
    const a = generateScramble(ext, mulberry32(42));
    const b = generateScramble(ext, mulberry32(42));
    expect(formatSequence(a)).toBe(formatSequence(b));
    const flips = a.filter((m) => m.axis === 'F' || m.axis === 'R' || m.axis === 'L');
    expect(flips.length).toBe(20);
    for (let i = 1; i < flips.length; i++) expect(flips[i].axis).not.toBe(flips[i - 1].axis);
  });

  it('scrambles and un-scrambles on both variants', () => {
    for (const v of ['extreme', 'original'] as const) {
      const model = createModel(v, CUT_S);
      const st = PuzzleState.solved(model);
      const s = generateScramble(model.variant, mulberry32(7));
      st.applyAll(s);
      expect(st.isSolved()).toBe(false);
      st.applyAll(invertSequence(s));
      expect(st.isSolved()).toBe(true);
    }
  });
});
