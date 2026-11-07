import { describe, expect, it } from 'vitest';
import { CUT_S } from '../src/config';
import { MoveHistory } from '../src/puzzle/history';
import { createModel } from '../src/puzzle/model';
import { formatSequence, parseAlgorithm } from '../src/puzzle/moves';
import { PuzzleState } from '../src/puzzle/state';
import { VARIANTS } from '../src/puzzle/variants';

describe('undo / redo', () => {
  it('undoes and redoes moves in order', () => {
    const h = new MoveHistory();
    const r = parseAlgorithm("U F U2' R", VARIANTS.extreme);
    if (!r.ok) throw new Error(r.error);
    r.moves.forEach((m) => h.push(m));
    expect(formatSequence([h.undo()!, h.undo()!])).toBe("R U2");
    expect(formatSequence(h.moves)).toBe('U F');
    expect(formatSequence(h.redoable)).toBe("U2' R");
    expect(formatSequence([h.redo()!])).toBe("U2'");
    h.push({ axis: 'L', amount: 1 });
    expect(h.canRedo).toBe(false);
    expect(formatSequence(h.moves)).toBe("U F U2' L");
  });

  it('undoing everything returns the puzzle to solved', () => {
    const model = createModel('extreme', CUT_S);
    const st = PuzzleState.solved(model);
    const h = new MoveHistory();
    const r = parseAlgorithm("U F D3 R U2' L D F", VARIANTS.extreme);
    if (!r.ok) throw new Error(r.error);
    for (const m of r.moves) {
      st.apply(m);
      h.push(m);
    }
    let m;
    while ((m = h.undo())) st.apply(m);
    expect(st.isSolved()).toBe(true);
  });
});
