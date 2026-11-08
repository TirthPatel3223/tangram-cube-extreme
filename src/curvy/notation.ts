import { EDGES, type EdgeName } from './geometry';
import type { CurvyState, Turn } from './state';

/**
 * Notation (TwistyPuzzles forum convention for jumbling copters):
 *   UF    turn the UF edge 180°
 *   UF+   turn UF clockwise (seen from outside, looking at the edge) to its next jumble stop
 *   UF-   turn UF anticlockwise to its next stop
 * A stop is where the turning part lines up with a neighbouring edge's cut (70.5°, 109.5°, … from
 * a cube), so + and - depend on the current state. The history therefore keeps the exact angle.
 */
export type TurnKind = 'half' | 'stop';

/** A turn as written: which edge, half turn or jumble stop, and direction (+1 clockwise). */
export interface Notated {
  readonly edge: EdgeName;
  readonly kind: TurnKind;
  readonly dir: 1 | -1;
}

/** A turn as performed: notation plus the exact angle it resolved to. */
export interface AppliedTurn extends Turn, Notated {}

export function formatTurn(t: Notated): string {
  return t.kind === 'half' ? t.edge : `${t.edge}${t.dir > 0 ? '+' : '-'}`;
}

export function formatTurns(ts: readonly Notated[]): string {
  return ts.map(formatTurn).join(' ');
}

/** The exact turn that undoes an applied turn. */
export function invertTurn(t: AppliedTurn): AppliedTurn {
  return { ...t, angle: -t.angle, s: -t.s, dir: t.dir > 0 ? -1 : 1 };
}

export type ParseResult =
  | { readonly ok: true; readonly turns: Notated[] }
  | { readonly ok: false; readonly error: string; readonly index: number };

const FACE_LETTERS = 'UDFBRL';

/** Canonical edge name for two face letters in any order (FU -> UF), or null. */
function edgeOf(a: string, b: string): EdgeName | null {
  for (const e of EDGES) if ((e[0] === a && e[1] === b) || (e[0] === b && e[1] === a)) return e;
  return null;
}

const TOKEN = /([UDFBRL])([UDFBRL])(2|'|’|\+|-|−)?/y;

/** Parse an algorithm such as "UF UR+ (FL- DB) BR". Lower case and missing spaces are fine. */
export function parseTurns(text: string): ParseResult {
  const turns: Notated[] = [];
  const src = text.toUpperCase();
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/[\s,;()[\]·]/.test(ch)) {
      i++;
      continue;
    }
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m || !FACE_LETTERS.includes(ch)) {
      return { ok: false, error: `Unexpected "${text[i]}". Use edges like UF, FR, DB with optional + or -.`, index: i };
    }
    const edge = edgeOf(m[1], m[2]);
    if (!edge) return { ok: false, error: `${m[1]}${m[2]} is not an edge (the faces must be neighbours).`, index: i };
    const suffix = m[3] ?? '';
    if (suffix === '+') turns.push({ edge, kind: 'stop', dir: 1 });
    else if (suffix === '-' || suffix === '−') turns.push({ edge, kind: 'stop', dir: -1 });
    else turns.push({ edge, kind: 'half', dir: 1 });
    i += m[0].length;
  }
  return { ok: true, turns };
}

export type Resolved =
  | { readonly ok: true; readonly turn: AppliedTurn; readonly moving: readonly number[] }
  | { readonly ok: false; readonly reason: string; readonly blockers: readonly number[] };

/**
 * Work out the exact turn for a notated move in the given state (without applying it).
 * Half turns go clockwise, or anticlockwise if only that way is clear.
 */
export function resolveTurn(state: CurvyState, n: Notated): Resolved {
  if (n.kind === 'half') {
    let lastBlockers: readonly number[] = [];
    for (const dir of [n.dir, n.dir > 0 ? -1 : 1] as const) {
      const angle = -dir * Math.PI;
      const chk = state.turnCheck(n.edge, angle);
      if (chk.ok) return { ok: true, turn: { ...n, dir, angle, c: -1, s: 0 }, moving: chk.moving };
      lastBlockers = chk.blockers;
    }
    return { ok: false, reason: `${n.edge} is blocked`, blockers: lastBlockers };
  }
  const [stop] = state.stops(n.edge, n.dir, 1);
  if (!stop) {
    // Either the edge can't move that way at all, or something blocks it before the next stop.
    const start = state.turnCheck(n.edge, -n.dir * 0.2);
    if (!start.ok) return { ok: false, reason: `${n.edge} is blocked`, blockers: start.blockers };
    const far = state.turnCheck(n.edge, -n.dir * Math.PI);
    return far.ok
      ? { ok: false, reason: `${formatTurn(n)} has no stop to turn to`, blockers: [] }
      : { ok: false, reason: `${n.edge} is blocked before its next stop`, blockers: far.blockers };
  }
  return { ok: true, turn: { ...n, angle: stop.angle, c: stop.c, s: stop.s }, moving: state.movingPieces(n.edge) };
}

/**
 * Resolve and apply a whole algorithm on a copy of the state. Nothing is applied unless every
 * move is possible; on failure the error names the move.
 */
export function resolveAlgorithm(
  state: CurvyState,
  turns: readonly Notated[],
): { ok: true; turns: AppliedTurn[] } | { ok: false; error: string; at: number } {
  const st = state.clone();
  const out: AppliedTurn[] = [];
  for (let k = 0; k < turns.length; k++) {
    const r = resolveTurn(st, turns[k]);
    if (!r.ok) return { ok: false, error: `Move ${k + 1} (${formatTurn(turns[k])}): ${r.reason}.`, at: k };
    st.apply(r.turn, false);
    out.push(r.turn);
  }
  return { ok: true, turns: out };
}
