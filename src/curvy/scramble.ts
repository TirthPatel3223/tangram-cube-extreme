import { mat3Vec } from '../puzzle/vec';
import { EDGES, EDGE_AXIS, type EdgeName, NEIGHBOURS, edgeOfAxis } from './geometry';
import { type AppliedTurn, type Notated, formatTurns, resolveTurn } from './notation';
import { CUBE_ROTATIONS, type CurvyModel } from './pieces';
import { CurvyState } from './state';

/**
 * The user's jumble combo: jumble UL and FR anticlockwise, which unlocks UF; turn UF 180°; undo
 * the two jumbles. The cube comes back flush, but pieces have crossed between orbits (L-face pieces
 * end up on R, two corners swap, UF flips), which 180° turns alone can't do.
 */
export const COMBO: readonly Notated[] = [
  { edge: 'UL', kind: 'stop', dir: -1 },
  { edge: 'FR', kind: 'stop', dir: -1 },
  { edge: 'UF', kind: 'half', dir: 1 },
  { edge: 'FR', kind: 'stop', dir: 1 },
  { edge: 'UL', kind: 'stop', dir: 1 },
];

/** Mirror image of the combo (left and right swapped, so turning directions swap too). */
export const COMBO_MIRROR: readonly Notated[] = [
  { edge: 'UR', kind: 'stop', dir: 1 },
  { edge: 'FL', kind: 'stop', dir: 1 },
  { edge: 'UF', kind: 'half', dir: 1 },
  { edge: 'FL', kind: 'stop', dir: -1 },
  { edge: 'UR', kind: 'stop', dir: -1 },
];

/** The combo, or its mirror, carried by one of the 24 cube rotations: 48 variants in all. */
export function comboVariant(rotationIndex: number, mirror: boolean): Notated[] {
  const g = CUBE_ROTATIONS[rotationIndex];
  return (mirror ? COMBO_MIRROR : COMBO).map((t) => ({ ...t, edge: edgeOfAxis(mat3Vec(g, EDGE_AXIS[t.edge]))! }));
}

export interface ScrambleOptions {
  /** Phase 1: random 180° turns. */
  readonly halfTurns: number;
  /** Phase 2: rounds of (combo variant + a few 180° turns); stays cube-shaped. */
  readonly comboRounds: number;
  /** Phase 3: jumble blocks A± B A∓ that leave the puzzle genuinely jumbled. */
  readonly jumbles: number;
}

/**
 * Two final jumble blocks: enough to swap corners and triangles and change the shape, while
 * leaving some edges free (each proud corner bandages the two edges across its face).
 */
export const DEFAULT_SCRAMBLE: ScrambleOptions = { halfTurns: 20, comboRounds: 6, jumbles: 2 };

export interface Scramble {
  readonly turns: AppliedTurn[];
  readonly text: string;
  /** The state the scramble leads to (from solved). */
  readonly state: CurvyState;
}

/**
 * Scramble the way the user does by hand:
 *   1. a normal (non-jumbling) scramble of 180° turns;
 *   2. the shape-preserving jumble combo in random orientations, mixed with 180° turns;
 *   3. finally some real jumbling: A± (to a stop), B 180° (a neighbour that A's stop unlocked), then A
 *      straight back. Pieces end up swapped between kinds (corners proud of faces, triangles sunk in
 *      corner holes), which also bandages some turns, as on the real puzzle.
 * Every move is checked against the geometry, so the result is always reachable on the real puzzle.
 */
export function generateCurvyScramble(model: CurvyModel, rng: () => number, opts = DEFAULT_SCRAMBLE): Scramble {
  const turns: AppliedTurn[] = [];
  const groups: string[] = [];
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

  let last: EdgeName | null = null;
  const halfTurns = (n: number) => {
    const seq: Notated[] = [];
    for (let k = 0; k < n; k++) {
      const edge = pick(EDGES.filter((e) => e !== last));
      seq.push({ edge, kind: 'half', dir: 1 });
      last = edge;
    }
    return seq;
  };

  let state = CurvyState.solved(model);
  /**
   * Apply a sequence atomically: either every move is possible (and recorded) or nothing changes.
   * `accept` can veto the result (e.g. a jumble block whose last move didn't fully reverse the first).
   */
  const commit = (seq: readonly Notated[], wrap: boolean, accept?: (done: AppliedTurn[]) => boolean): boolean => {
    const trial = state.clone();
    const done: AppliedTurn[] = [];
    for (const n of seq) {
      const r = resolveTurn(trial, n);
      if (!r.ok) return false;
      trial.apply(r.turn, false);
      done.push(r.turn);
    }
    if (accept && !accept(done)) return false;
    state = trial;
    turns.push(...done);
    groups.push(wrap ? `(${formatTurns(done)})` : formatTurns(done));
    return true;
  };

  // 1. Normal scramble.
  commit(halfTurns(opts.halfTurns), false);
  // 2. Shape-preserving jumble combos mixed with 180° turns.
  for (let r = 0; r < opts.comboRounds; r++) {
    for (let attempt = 0; attempt < 8; attempt++) {
      if (commit(comboVariant(Math.floor(rng() * CUBE_ROTATIONS.length), rng() < 0.5), true)) break;
    }
    commit(halfTurns(2 + Math.floor(rng() * 2)), false);
  }
  // 3. Real jumbling.
  let lastA: EdgeName | null = null;
  for (let j = 0; j < opts.jumbles; j++) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = pick(EDGES.filter((e) => e !== lastA));
      const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
      const [stop] = state.stops(a, dir, 1);
      if (!stop) continue;
      const unlocked = stop.unlocks.filter((e) => NEIGHBOURS[a].includes(e));
      if (!unlocked.length) continue;
      const b = pick(unlocked);
      const back: 1 | -1 = dir > 0 ? -1 : 1;
      const block: Notated[] = [
        { edge: a, kind: 'stop', dir },
        { edge: b, kind: 'half', dir: 1 },
        { edge: a, kind: 'stop', dir: back },
      ];
      // Like doing it by hand: A's last move must take it exactly back to where it started, so
      // every edge ends aligned and the jumble shows as swapped and protruding pieces.
      if (commit(block, true, (done) => Math.abs(done[0].angle + done[2].angle) < 1e-9)) {
        lastA = a;
        break;
      }
    }
  }
  return { turns, text: groups.filter(Boolean).join(' '), state };
}
