import { describe, expect, it } from 'vitest';
import { CUT_S } from '../src/config';
import { createModel } from '../src/puzzle/model';
import { AXES, type Move, invertSequence, mulberry32 } from '../src/puzzle/moves';
import { PuzzleState } from '../src/puzzle/state';

function randomMoves(order: number, n: number, seed: number): Move[] {
  const rng = mulberry32(seed);
  const out: Move[] = [];
  for (let i = 0; i < n; i++) {
    const axis = AXES[Math.floor(rng() * AXES.length)];
    if (axis === 'U' || axis === 'D') {
      let amount = 0;
      while (amount === 0) amount = Math.floor(rng() * order) - Math.floor((order - 1) / 2);
      out.push({ axis, amount });
    } else {
      out.push({ axis, amount: 1 });
    }
  }
  return out;
}

describe.each([
  ['extreme', 12, 6],
  ['original', 6, 3],
] as const)('%s moves', (variant, groupSize, order) => {
  const model = createModel(variant, CUT_S);

  it(`piece orientations form a rotation group of size ${groupSize}`, () => {
    expect(model.group.size).toBe(groupSize);
  });

  it(`corner layers return home after ${order} steps`, () => {
    for (const axis of ['U', 'D'] as const) {
      const st = PuzzleState.solved(model);
      for (let k = 1; k <= order; k++) {
        st.apply({ axis, amount: 1 });
        expect(st.isSolved(), `${axis} x${k}`).toBe(k === order);
      }
    }
  });

  it('flips are self-inverse', () => {
    for (const axis of ['F', 'R', 'L'] as const) {
      const st = PuzzleState.solved(model);
      st.apply({ axis, amount: 1 });
      expect(st.isSolved()).toBe(false);
      st.apply({ axis, amount: 1 });
      expect(st.isSolved()).toBe(true);
    }
  });

  it('U and D commute', () => {
    const a = PuzzleState.solved(model);
    const b = PuzzleState.solved(model);
    a.applyAll([{ axis: 'F', amount: 1 }, { axis: 'U', amount: 1 }, { axis: 'D', amount: -1 }]);
    b.applyAll([{ axis: 'F', amount: 1 }, { axis: 'D', amount: -1 }, { axis: 'U', amount: 1 }]);
    expect(a.equals(b)).toBe(true);
  });

  it('every move stays legal and a random walk followed by its inverse is solved', () => {
    const moves = randomMoves(order, 500, 12345);
    const st = PuzzleState.solved(model);
    for (const m of moves) {
      for (const axis of AXES) expect(st.isLegal({ axis, amount: 1 })).toBe(true);
      st.apply(m);
    }
    expect(st.isSolved()).toBe(false);
    st.applyAll(invertSequence(moves));
    expect(st.isSolved()).toBe(true);
  });

  it('each flip moves its slab and each corner turn moves its layer', () => {
    const st = PuzzleState.solved(model);
    const layerSize = model.pieces.filter((p) => p.layer === 'T').length;
    expect(st.movingPieces({ axis: 'U', amount: 1 }).length).toBe(layerSize);
    expect(st.movingPieces({ axis: 'D', amount: 1 }).length).toBe(layerSize);
    const f = st.movingPieces({ axis: 'F', amount: 1 }).length;
    expect(st.movingPieces({ axis: 'R', amount: 1 }).length).toBe(f);
    expect(st.movingPieces({ axis: 'L', amount: 1 }).length).toBe(f);
  });
});

describe('shape-shifting', () => {
  it('one 60° turn of the Extreme pushes 16 of the 19 corner-layer pieces outside the cube', () => {
    const model = createModel('extreme', CUT_S);
    const st = PuzzleState.solved(model);
    st.apply({ axis: 'U', amount: 1 });
    const out = st.protrudingPieces();
    expect(out.length).toBe(16);
    expect(out.every((i) => model.pieces[i].layer === 'T')).toBe(true);
    st.apply({ axis: 'U', amount: 1 }); // 120 degrees: back to a cube
    expect(st.protrudingPieces().length).toBe(0);
  });

  it('the original Tangram Cube never changes shape', () => {
    const model = createModel('original', CUT_S);
    const st = PuzzleState.solved(model);
    for (const m of randomMoves(3, 200, 7)) {
      st.apply(m);
      expect(st.protrudingPieces().length).toBe(0);
    }
  });
});
