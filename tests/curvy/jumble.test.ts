import { describe, expect, it } from 'vitest';
import { EDGES, type EdgeName } from '../../src/curvy/geometry';
import { type AppliedTurn, invertTurn, parseTurns, resolveAlgorithm, resolveTurn } from '../../src/curvy/notation';
import { buildModel } from '../../src/curvy/pieces';
import { comboVariant } from '../../src/curvy/scramble';
import { CurvyState } from '../../src/curvy/state';
import { mulberry32 } from '../../src/puzzle/moves';
import { mat3Vec } from '../../src/puzzle/vec';

function play(st: CurvyState, alg: string): AppliedTurn[] {
  const p = parseTurns(alg);
  if (!p.ok) throw new Error(p.error);
  const r = resolveAlgorithm(st, p.turns);
  if (!r.ok) throw new Error(r.error);
  for (const t of r.turns) st.apply(t, false);
  return r.turns;
}

function blocked(st: CurvyState): EdgeName[] {
  return EDGES.filter((e) => !st.turnCheck(e, -Math.PI).ok && !st.turnCheck(e, Math.PI).ok);
}

/** How far a piece sticks out of the cube outline. */
function sticksOut(st: CurvyState, i: number): number {
  const m = st.matrix(i);
  const s = st.model.shapes[st.model.pieces[i].shape].samples;
  let best = 0;
  for (let k = 0; k < s.count; k++) {
    const w = mat3Vec(m, [s.pts[3 * k], s.pts[3 * k + 1], s.pts[3 * k + 2]]);
    best = Math.max(best, Math.abs(w[0]), Math.abs(w[1]), Math.abs(w[2]));
  }
  return best - 1;
}

describe.each(['cc', 'plus'] as const)('%s jumbling', (variant) => {
  const model = buildModel(variant);

  it("user's example: UL and FR anticlockwise to a stop still leave UF free for 180°", () => {
    const st = CurvyState.solved(model);
    play(st, 'UL- FR-');
    expect(resolveTurn(st, { edge: 'UF', kind: 'half', dir: 1 }).ok).toBe(true);
  });

  it("user's combo UL- FR- UF FR+ UL+ jumbles pieces but returns a flush cube with every edge free", () => {
    const st = CurvyState.solved(model);
    play(st, 'UL- FR- UF FR+ UL+');
    expect(st.isHome()).toBe(false);
    expect(st.isCubeShape()).toBe(true);
    expect(st.protruding()).toEqual([]);
    expect(blocked(st)).toEqual([]);
  });

  it('after one jumble stop the other two neighbours and the two edges at 90° are blocked', () => {
    const st = CurvyState.solved(model);
    play(st, 'UF+');
    expect(blocked(st).sort()).toEqual(['DF', 'FL', 'UB', 'UR']);
  });

  it('a jumble block that never re-aligns stays legal and undoes exactly', () => {
    const st = CurvyState.solved(model);
    const rng = mulberry32(99);
    const done: AppliedTurn[] = [];
    for (let tries = 0; done.length < 80 && tries < 2000; tries++) {
      const r = resolveTurn(st, {
        edge: EDGES[Math.floor(rng() * EDGES.length)],
        kind: rng() < 0.5 ? 'half' : 'stop',
        dir: rng() < 0.5 ? 1 : -1,
      });
      if (!r.ok) continue;
      st.apply(r.turn, false);
      done.push(r.turn);
    }
    expect(done.length).toBe(80);
    expect(st.isHome()).toBe(false);
    for (let k = done.length - 1; k >= 0; k--) st.apply(invertTurn(done[k]), false);
    expect(st.isHome()).toBe(true);
  });
});

describe('Curvy Copter Plus', () => {
  const model = buildModel('plus');

  it('the forum commutator UR+ UF- UR- UF+ has order 6', () => {
    const st = CurvyState.solved(model);
    for (let k = 1; k <= 6; k++) {
      play(st, 'UR+ UF- UR- UF+');
      expect(st.isHome(), `after ${k}`).toBe(k === 6);
    }
  });

  it('UF+ UL UF- puts two corners in small-triangle slots, standing about 18 mm proud (photo 4)', () => {
    const st = CurvyState.solved(model);
    play(st, 'UF+ UL UF-');
    const out = st.protruding();
    const corners = out.filter((i) => model.pieces[i].kind === 'corner');
    expect(corners.length).toBe(2);
    for (const i of corners) expect(sticksOut(st, i)).toBeCloseTo(0.654, 1);
    // the two triangles that left those slots sink into the corner holes (photo 5): nothing of theirs sticks out
    expect(out.filter((i) => model.pieces[i].kind === 'triangle')).toEqual([]);
    expect(st.isCubeShape()).toBe(false);
    expect(blocked(st).sort()).toEqual(['DF', 'DL', 'FL', 'FR']);
  });

  it('twisted small triangles stand proud and block the two edges opposite them (photos 2, 3)', () => {
    const st = CurvyState.solved(model);
    play(st, 'UR+ UF- UR- UF+ UR+ UF- UR- UF+ UR+ UF- UR- UF+');
    const tris = st.protruding().filter((i) => model.pieces[i].kind === 'triangle');
    expect(tris.length).toBe(2);
    for (const i of tris) expect(sticksOut(st, i)).toBeGreaterThan(0.1);
    expect(blocked(st).sort()).toEqual(['BR', 'DF', 'DR', 'FL', 'UB', 'UL']);
  });

  it('all 48 variants of the combo keep a scrambled cube flush and fully turnable', () => {
    const st = CurvyState.solved(model);
    const rng = mulberry32(5);
    for (let k = 0; k < 20; k++) {
      const r = resolveTurn(st, { edge: EDGES[Math.floor(rng() * 12)], kind: 'half', dir: 1 });
      if (r.ok) st.apply(r.turn, false);
    }
    for (let g = 0; g < 24; g++) {
      for (const mirror of [false, true]) {
        const r = resolveAlgorithm(st, comboVariant(g, mirror));
        expect(r.ok, `variant ${g} ${mirror}`).toBe(true);
        if (!r.ok) continue;
        const s2 = st.clone();
        for (const t of r.turns) s2.apply(t, false);
        expect(s2.isCubeShape(), `variant ${g} ${mirror}`).toBe(true);
      }
    }
  });
});

describe('Curvy Copter (original)', () => {
  it('the unsplit X-pieces bandage the commutator: its third move is blocked', () => {
    const st = CurvyState.solved(buildModel('cc'));
    play(st, 'UR+ UF-');
    const r = resolveTurn(st, { edge: 'UR', kind: 'stop', dir: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.some((i) => st.model.pieces[i].kind === 'xpiece')).toBe(true);
  });
});
