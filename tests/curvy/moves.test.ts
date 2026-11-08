import { describe, expect, it } from 'vitest';
import { EDGES, EDGE_AXIS, JUMBLE, NEIGHBOURS } from '../../src/curvy/geometry';
import { invertTurn, resolveTurn } from '../../src/curvy/notation';
import { OrientationTable, rotationByAngle } from '../../src/curvy/orient';
import { buildModel } from '../../src/curvy/pieces';
import { CurvyState } from '../../src/curvy/state';
import { mulberry32 } from '../../src/puzzle/moves';

const DEG = 180 / Math.PI;
const half = (edge: (typeof EDGES)[number]) => ({ edge, angle: -Math.PI, c: -1, s: 0 });

describe.each([
  ['cc', 7],
  ['plus', 11],
] as const)('%s turns', (variant, perEdge) => {
  const model = buildModel(variant);

  it('every edge can turn both ways when solved', () => {
    const st = CurvyState.solved(model);
    for (const e of EDGES) {
      expect(st.straddlers(e), e).toEqual([]);
      expect(st.turnCheck(e, -Math.PI).ok && st.turnCheck(e, Math.PI).ok, e).toBe(true);
    }
  });

  it(`each edge turns ${perEdge} pieces (edge, 2 corners and the X-pieces around it)`, () => {
    const st = CurvyState.solved(model);
    for (const e of EDGES) expect(st.movingPieces(e).length, e).toBe(perEdge);
  });

  it('jumble stops from a cube are 70.53°, 109.47° and 180°, each unlocking the right neighbours', () => {
    const st = CurvyState.solved(model);
    for (const e of EDGES) {
      for (const dir of [1, -1] as const) {
        const stops = st.stops(e, dir, 3);
        expect(stops.map((s) => Math.abs(s.angle * DEG)), `${e} ${dir}`).toEqual([
          expect.closeTo(70.5288, 3),
          expect.closeTo(109.4712, 3),
          expect.closeTo(180, 6),
        ]);
        expect(stops.every((s) => Math.sign(s.angle) === -dir)).toBe(true);
        const [a, b, c] = stops.map((s) => s.unlocks);
        expect(a.length).toBe(2);
        expect(b.length).toBe(2);
        expect([...a, ...b].sort()).toEqual([...NEIGHBOURS[e]].sort());
        expect([...c].sort()).toEqual([...NEIGHBOURS[e]].sort());
      }
    }
    // The pair is set by direction: UF clockwise unlocks UL and FR first.
    expect(st.stops('UF', 1, 1)[0].unlocks).toEqual(['UL', 'FR']);
    expect(st.stops('UF', -1, 1)[0].unlocks).toEqual(['UR', 'FL']);
  });

  it('a 60° turn unlocks nothing (the "60°" click is really 70.53° = arccos 1/3)', () => {
    const st = CurvyState.solved(model);
    st.apply({ edge: 'UF', angle: -Math.PI / 3, c: 0.5, s: -Math.sqrt(3) / 2 });
    for (const n of NEIGHBOURS.UF) expect(st.straddlers(n).length, n).toBeGreaterThan(0);
    expect(JUMBLE * DEG).toBeCloseTo(70.5288, 4);
  });

  it('180° turns are self-inverse and keep the cube shape', () => {
    const st = CurvyState.solved(model);
    st.apply(half('UF'));
    expect(st.isHome()).toBe(false);
    expect(st.isCubeShape()).toBe(true);
    st.apply(half('UF'));
    expect(st.isHome()).toBe(true);
  });

  it('a long 180°-only walk never blocks, stays a cube, and its inverse returns home', () => {
    const st = CurvyState.solved(model);
    const rng = mulberry32(2024);
    const done = [];
    for (let k = 0; k < 300; k++) {
      const e = EDGES[Math.floor(rng() * EDGES.length)];
      const r = resolveTurn(st, { edge: e, kind: 'half', dir: 1 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      st.apply(r.turn, false);
      done.push(r.turn);
      if (k % 50 === 0) {
        expect(st.isCubeShape()).toBe(true);
        expect(EDGES.every((x) => st.straddlers(x).length === 0)).toBe(true);
      }
    }
    expect(st.protruding()).toEqual([]);
    for (let k = done.length - 1; k >= 0; k--) st.apply(invertTurn(done[k]), false);
    expect(st.isHome()).toBe(true);
  });
});

describe('orientations', () => {
  it('jumble turns are exact rational rotations (entries k/3)', () => {
    for (const e of EDGES) {
      for (const ang of [JUMBLE, -JUMBLE, Math.PI - JUMBLE, Math.PI]) {
        const m = rotationByAngle(EDGE_AXIS[e], ang);
        for (const v of m) expect(Math.abs(v * 3 - Math.round(v * 3))).toBeLessThan(1e-12);
      }
    }
  });

  it('interns products so a turn and its inverse return the identity id', () => {
    const t = new OrientationTable();
    const a = t.intern(rotationByAngle(EDGE_AXIS.UF, JUMBLE));
    const b = t.intern(rotationByAngle(EDGE_AXIS.UF, -JUMBLE));
    expect(t.mul(a, b)).toBe(OrientationTable.IDENTITY);
  });
});
