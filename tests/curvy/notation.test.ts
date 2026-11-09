import { describe, expect, it } from 'vitest';
import { formatTurns, parseTurns, resolveAlgorithm } from '../../src/curvy/notation';
import { buildModel } from '../../src/curvy/pieces';
import {
  SHAPE_SHIFT,
  TRIANGLE_SPLIT,
  algVariant,
  defaultScramble,
  generateCurvyScramble,
} from '../../src/curvy/scramble';
import { CurvyState } from '../../src/curvy/state';
import { mulberry32 } from '../../src/puzzle/moves';

describe('curvy notation', () => {
  it('round-trips half turns and jumble stops', () => {
    const text = 'UF UR+ FL- DB BR+ DL-';
    const r = parseTurns(text);
    expect(r.ok && formatTurns(r.turns)).toBe(text);
  });

  it('accepts either letter order, lower case, primes and brackets', () => {
    const r = parseTurns("fu (rf+, lu-) DB' bd2");
    expect(r.ok && formatTurns(r.turns)).toBe('UF FR+ UL- DB DB');
  });

  it('rejects bad input with a position', () => {
    const notEdge = parseTurns('UF UD');
    expect(notEdge.ok).toBe(false);
    if (!notEdge.ok) expect(notEdge.index).toBe(3);
    expect(parseTurns('UF X').ok).toBe(false);
    expect(parseTurns('U').ok).toBe(false);
  });

  it('resolves stops in context: UF+ three times walks 70.53°, 109.47°, 180°', () => {
    const st = CurvyState.solved(buildModel('plus'));
    const p = parseTurns('UF+ UF+ UF+');
    if (!p.ok) throw new Error(p.error);
    const r = resolveAlgorithm(st, p.turns);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const deg = r.turns.map((t) => (t.angle * 180) / Math.PI);
    expect(deg[0]).toBeCloseTo(-70.5288, 3);
    expect(deg[1]).toBeCloseTo(-38.9424, 3);
    expect(deg[2]).toBeCloseTo(-70.5288, 3);
  });

  it('reports a blocked move by number and applies nothing', () => {
    const st = CurvyState.solved(buildModel('plus'));
    const p = parseTurns('UF+ UR');
    if (!p.ok) throw new Error(p.error);
    const r = resolveAlgorithm(st, p.turns);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Move 2 \(UR\)/);
    expect(st.isHome()).toBe(true);
  });
});

describe.each(['cc', 'plus'] as const)('%s scramble', (variant) => {
  const model = buildModel(variant);

  it('the first two phases (180° turns + the combo) always end as a flush, fully turnable cube', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = generateCurvyScramble(model, mulberry32(seed), { ...defaultScramble(model), jumbles: 0, shapeShifts: 0, freeJumbles: 0 });
      expect(s.state.isCubeShape(), `seed ${seed}`).toBe(true);
      expect(s.state.protruding(), `seed ${seed}`).toEqual([]);
      expect(s.text).toMatch(/\(/); // contains combo groups
    }
  }, 30_000);

  it('is deterministic, replays from its text, and ends genuinely jumbled', () => {
    const a = generateCurvyScramble(model, mulberry32(42));
    const b = generateCurvyScramble(model, mulberry32(42));
    expect(a.text).toBe(b.text);
    const p = parseTurns(a.text);
    if (!p.ok) throw new Error(p.error);
    const r = resolveAlgorithm(CurvyState.solved(model), p.turns);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const st = CurvyState.solved(model);
    for (const t of r.turns) st.apply(t, false);
    expect(st.equals(a.state)).toBe(true);
    expect(a.state.isCubeShape()).toBe(false);
  });
});

describe("Curvy Copter Plus scramble (the user's recipe)", () => {
  const model = buildModel('plus');
  const groups = (text: string) => (text.match(/\([^)]*\)/g) ?? []).map((g) => g.slice(1, -1).split(' ').length);

  it('all 48 orientations of the triangle split are legal from solved and return a flush cube', () => {
    for (let v = 0; v < 48; v++) {
      const st = CurvyState.solved(model);
      const r = resolveAlgorithm(st, algVariant(TRIANGLE_SPLIT, v >> 1, (v & 1) === 1));
      expect(r.ok, `variant ${v}`).toBe(true);
      if (!r.ok) continue;
      for (const t of r.turns) st.apply(t, false);
      expect(st.isCubeShape(), `variant ${v}`).toBe(true);
      expect(st.isHome(), `variant ${v}`).toBe(false);
    }
  }, 60000);

  it('the shape shift is legal from solved and leaves the puzzle out of cube shape', () => {
    const st = CurvyState.solved(model);
    const r = resolveAlgorithm(st, SHAPE_SHIFT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const t of r.turns) st.apply(t, false);
    expect(st.isCubeShape()).toBe(false);
  });

  it('runs 6 combos and 6 triangle splits, then the shape shift twice', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const s = generateCurvyScramble(model, mulberry32(seed), { ...defaultScramble(model), freeJumbles: 0 });
      const g = groups(s.text);
      expect(g.filter((n) => n === COMBO_LEN).length, `seed ${seed}`).toBe(6);
      expect(g.filter((n) => n === TRIANGLE_SPLIT.length).length, `seed ${seed}`).toBe(6);
      // The two shape shifts come last.
      expect(g.slice(-2), `seed ${seed}`).toEqual([SHAPE_SHIFT.length, SHAPE_SHIFT.length]);
      expect(s.state.isCubeShape(), `seed ${seed}`).toBe(false);
    }
  }, 120000);

  it('ends with 15 free jumbling moves (stops and 180° turns) after the last shape shift', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const s = generateCurvyScramble(model, mulberry32(seed));
      const tail = s.text.slice(s.text.lastIndexOf(')') + 1).trim().split(' ');
      expect(tail.length, `seed ${seed}`).toBe(15);
      expect(tail.some((m) => /[+-]$/.test(m)), `seed ${seed}`).toBe(true);
      expect(s.state.isCubeShape(), `seed ${seed}`).toBe(false);
      // The text replays exactly.
      const p = parseTurns(s.text);
      if (!p.ok) throw new Error(p.error);
      const r = resolveAlgorithm(CurvyState.solved(model), p.turns);
      expect(r.ok, `seed ${seed}`).toBe(true);
    }
  }, 120000);
});

const COMBO_LEN = 5;
