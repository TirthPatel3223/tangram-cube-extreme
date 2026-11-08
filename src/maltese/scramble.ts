import { FACES, type Face } from './geometry';
import type { Move } from './notation';

/** Amounts a scramble picks from: mostly quarter turns, some half turns (both ways). */
const AMOUNTS = [1, -1, 1, -1, 2, -2] as const;

/**
 * Random-move scramble (seeded). Consecutive moves use different faces, so nothing cancels or merges.
 * Every move is always legal on this puzzle, and random faces mix centres into edge slots, turn
 * edges, and tilt gears, so the result is as shape-shifted as a real scramble.
 */
export function generateScramble(rng: () => number, length = 25): Move[] {
  const moves: Move[] = [];
  let prev: Face | null = null;
  while (moves.length < length) {
    const options = FACES.filter((f) => f !== prev);
    const face = options[Math.floor(rng() * options.length)];
    const amount = AMOUNTS[Math.floor(rng() * AMOUNTS.length)];
    moves.push({ face, amount });
    prev = face;
  }
  return moves;
}
