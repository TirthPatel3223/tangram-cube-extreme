import { FACES, type Face } from './geometry';

/**
 * Notation. `U` turns the top face 90° clockwise (seen from above); the middle ring follows 45°.
 * A face needs 8 quarter turns to come back (its ring has turned 360°), so amounts live in −3…4:
 *   U U2 U3 U4 U3' U2' U'   (U2 and U2' are different moves: the ring ends 90° one way or the other;
 *                            U4 = U4' turns the ring half way round and leaves everything flush.)
 */
export interface Move {
  readonly face: Face;
  /** Quarter turns, clockwise positive, normalised to −3…4 (never 0). */
  readonly amount: number;
}

/** Normalise a quarter-turn count into −3…4 (0 stays 0). */
export function normalizeAmount(amount: number): number {
  let a = ((Math.round(amount) % 8) + 8) % 8;
  if (a > 4) a -= 8;
  return a;
}

export function invertMove(m: Move): Move {
  return { face: m.face, amount: normalizeAmount(-m.amount) };
}

export function invertSequence(moves: readonly Move[]): Move[] {
  return moves.slice().reverse().map(invertMove);
}

export function formatMove(m: Move): string {
  const n = Math.abs(m.amount);
  return m.face + (n === 1 ? '' : String(n)) + (m.amount < 0 ? "'" : '');
}

export function formatSequence(moves: readonly Move[]): string {
  return moves.map(formatMove).join(' ');
}

export type ParseResult =
  | { readonly ok: true; readonly moves: Move[] }
  | { readonly ok: false; readonly error: string; readonly index: number };

const TOKEN = /([UDFBLRudfblr])(\d*)(['’`]?)(\d*)/y;

/** Parse e.g. "U R U' R2 F2' D4" (whitespace and commas optional). `U'2` is read like `U2'`. */
export function parseAlgorithm(text: string): ParseResult {
  const moves: Move[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/[\s,;()[\]]/.test(ch)) {
      i++;
      continue;
    }
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(text);
    if (!m) {
      return { ok: false, error: `Unexpected "${ch}". Use the faces ${FACES.join(' ')}, with an optional number and '.`, index: i };
    }
    const face = m[1].toUpperCase() as Face;
    const digits = m[2] || m[4];
    if (m[2] && m[4]) return { ok: false, error: `"${m[0]}": put the number before the ' (e.g. ${face}2').`, index: i };
    const count = digits ? parseInt(digits, 10) : 1;
    const amount = normalizeAmount(m[3] ? -count : count);
    if (amount === 0) {
      return { ok: false, error: `${m[0]} turns the face 8 quarter turns (a full cycle): it has no effect.`, index: i };
    }
    moves.push({ face, amount });
    i += m[0].length;
  }
  return { ok: true, moves };
}
