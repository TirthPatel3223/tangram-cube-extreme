import { mat3Vec } from '../puzzle/vec';
import { EDGES, EDGE_AXIS, type EdgeName, NEIGHBOURS, edgeOfAxis } from './geometry';
import { type AppliedTurn, type Notated, formatTurns, parseTurns, resolveTurn } from './notation';
import { CUBE_ROTATIONS, type CurvyModel } from './pieces';
import { CurvyState } from './state';

function notate(alg: string): Notated[] {
  const p = parseTurns(alg);
  if (!p.ok) throw new Error(`bad built-in algorithm: ${p.error}`);
  return p.turns;
}

/**
 * The user's jumble combo: jumble UL and FR anticlockwise, which unlocks UF; turn UF 180°; undo
 * the two jumbles. The cube comes back flush, but pieces have crossed between orbits (L-face pieces
 * end up on R, two corners swap, UF flips), which 180° turns alone can't do.
 */
export const COMBO: readonly Notated[] = notate('UL- FR- UF FR+ UL+');

/**
 * The user's triangle-splitting algorithm (Curvy Copter Plus only). It separates the small triangles
 * from the pieces next to them and brings the puzzle back to a flush cube. It is symmetric, so it
 * works from every relative position.
 */
export const TRIANGLE_SPLIT: readonly Notated[] = notate(
  'UR+ DL+ BR- BR- BR- DF- DF- DF- UR- DL- DR+ DR+ DR+ DL+ UR+ DF+ DF+ DF+ DL- BR+ BR+ BR+ UR-',
);

/**
 * The user's shape-shifting algorithm for the last phase of a Plus scramble. It leaves a corner and
 * a small triangle swapped, so the puzzle ends out of cube shape.
 */
export const SHAPE_SHIFT: readonly Notated[] = notate('UF- UR+ UF+ UR- UF- UR+ UF+ UR- FR- UF+ FR+ UF- FR- UF+ FR+ UF-');

/**
 * An algorithm carried by one of the 24 cube rotations, optionally mirrored first (left and right
 * swapped, which also swaps the jumble directions): 48 variants in all.
 */
export function algVariant(alg: readonly Notated[], rotationIndex: number, mirror: boolean): Notated[] {
  const g = CUBE_ROTATIONS[rotationIndex];
  return alg.map((t) => {
    const a = EDGE_AXIS[t.edge];
    const edge = edgeOfAxis(mat3Vec(g, mirror ? [-a[0], a[1], a[2]] : a))!;
    const dir: 1 | -1 = mirror && t.kind === 'stop' ? (t.dir > 0 ? -1 : 1) : t.dir;
    return { ...t, edge, dir };
  });
}

/** The combo, or its mirror, carried by one of the 24 cube rotations: 48 variants in all. */
export function comboVariant(rotationIndex: number, mirror: boolean): Notated[] {
  return algVariant(COMBO, rotationIndex, mirror);
}

export interface ScrambleOptions {
  /** Phase 1: random 180° turns. */
  readonly halfTurns: number;
  /** Phase 2: rounds of (combo variant + a few 180° turns); stays cube-shaped. */
  readonly comboRounds: number;
  /** Phase 2, shuffled in with the combos: rounds of (triangle split + a few 180° turns). Plus only. */
  readonly splitRounds: number;
  /** Phase 3: jumble blocks A± B A∓ that leave the puzzle genuinely jumbled. */
  readonly jumbles: number;
  /** Phase 3: the shape-shifting algorithm, each time in a random orientation. Plus only. */
  readonly shapeShifts: number;
}

/**
 * Curvy Copter: two final jumble blocks, enough to swap corners and triangles and change the shape,
 * while leaving some edges free (each proud corner bandages the two edges across its face).
 */
export const DEFAULT_SCRAMBLE: ScrambleOptions = { halfTurns: 20, comboRounds: 6, splitRounds: 0, jumbles: 2, shapeShifts: 0 };

/** Curvy Copter Plus, the user's recipe: 6 combos + 6 triangle splits, then the shape shift twice. */
export const PLUS_SCRAMBLE: ScrambleOptions = { halfTurns: 20, comboRounds: 6, splitRounds: 6, jumbles: 0, shapeShifts: 2 };

export function defaultScramble(model: CurvyModel): ScrambleOptions {
  return model.variant.id === 'plus' ? PLUS_SCRAMBLE : DEFAULT_SCRAMBLE;
}

export interface Scramble {
  readonly turns: AppliedTurn[];
  readonly text: string;
  /** The state the scramble leads to (from solved). */
  readonly state: CurvyState;
}

/**
 * Scramble the way the user does by hand:
 *   1. a normal (non-jumbling) scramble of 180° turns;
 *   2. shape-preserving algorithms in random orientations, mixed with 180° turns: the corner-swapping
 *      combo and, on the Plus, the triangle-splitting algorithm;
 *   3. finally real jumbling. On the Plus that is the user's shape-shifting algorithm. On the Curvy
 *      Copter it is jumble blocks: A± (to a stop), B 180° (a neighbour that A's stop unlocked), then A
 *      straight back. Pieces end up swapped between kinds (corners proud of faces, triangles sunk in
 *      corner holes), which also bandages some turns, as on the real puzzle.
 * Every move is checked against the geometry, so the result is always reachable on the real puzzle.
 */
export function generateCurvyScramble(model: CurvyModel, rng: () => number, opts = defaultScramble(model)): Scramble {
  const turns: AppliedTurn[] = [];
  const groups: string[] = [];
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  const shuffle = <T>(xs: T[]): T[] => {
    for (let k = xs.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [xs[k], xs[j]] = [xs[j], xs[k]];
    }
    return xs;
  };

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

  /** Apply an algorithm in a random one of its 48 orientations, trying the others if it is blocked. */
  const commitVariant = (alg: readonly Notated[], accept?: (done: AppliedTurn[]) => boolean): boolean => {
    const order = shuffle(Array.from({ length: 48 }, (_, k) => k));
    return order.some((v) => commit(algVariant(alg, v >> 1, (v & 1) === 1), true, accept));
  };

  // 1. Normal scramble.
  commit(halfTurns(opts.halfTurns), false);
  // 2. Shape-preserving algorithms, shuffled, each followed by a few 180° turns.
  const rounds = shuffle([
    ...Array<readonly Notated[]>(opts.comboRounds).fill(COMBO),
    ...Array<readonly Notated[]>(opts.splitRounds).fill(TRIANGLE_SPLIT),
  ]);
  for (const alg of rounds) {
    commitVariant(alg);
    commit(halfTurns(2 + Math.floor(rng() * 2)), false);
  }
  // 3. Real jumbling: the shape shift (Plus), in orientations that don't put the cube shape back ...
  const shifted = (done: AppliedTurn[]) => {
    const st = state.clone();
    for (const t of done) st.apply(t, false);
    return !st.isCubeShape();
  };
  for (let k = 0; k < opts.shapeShifts; k++) commitVariant(SHAPE_SHIFT, shifted);
  // ... or jumble blocks (Curvy Copter).
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
