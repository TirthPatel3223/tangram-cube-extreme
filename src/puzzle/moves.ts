import { type CutParams, DIAGONAL, EDGE_AXES, type VariantDef } from './variants';
import { type Vec3, dot, normalize, scale } from './vec';

/**
 * Notation (Jaap Scherphuis' Pentahedron convention, "prism view" with corner T on top):
 *   U / D   turn the top / bottom corner layer clockwise as seen from that corner.
 *           One step is 60 degrees on the Extreme (U U2 U3 U2' U'), 120 degrees on the original (U U').
 *   F R L   180-degree flips about the edges (1,-1,0), (0,1,-1), (-1,0,1). Seen from T,
 *           F -> R -> L runs counter-clockwise. A flip is its own inverse (F' = F).
 */
export type Axis = 'U' | 'D' | 'F' | 'R' | 'L';
export const AXES: readonly Axis[] = ['U', 'D', 'F', 'R', 'L'];

export interface Move {
  readonly axis: Axis;
  /** Steps; positive = clockwise seen from the handle. Normalized to (-order/2, order/2]. */
  readonly amount: number;
}

/** A moving region { x : n·x > d } (n unit). */
export interface Region {
  readonly n: Vec3;
  readonly d: number;
}

export interface AxisDef {
  readonly axis: Axis;
  readonly kind: 'corner' | 'flip';
  /** Unit vector from the centre towards the handle. A positive amount turns by -amount*step about it. */
  readonly rotAxis: Vec3;
  readonly stepAngle: number;
  /** Number of steps in a full turn. */
  readonly order: number;
  readonly region: Region;
  /** Point on the cube surface that identifies this part (turning corner or flip-edge midpoint). */
  readonly handle: Vec3;
}

export function buildAxisDefs(variant: VariantDef, cut: CutParams): Readonly<Record<Axis, AxisDef>> {
  const diag = normalize(DIAGONAL);
  const cornerStep = (2 * Math.PI) / variant.cornerOrder;
  const corner = (axis: Axis, dir: Vec3): AxisDef => ({
    axis,
    kind: 'corner',
    rotAxis: dir,
    stepAngle: cornerStep,
    order: variant.cornerOrder,
    region: { n: dir, d: cut.c / Math.sqrt(3) },
    handle: scale(dir, Math.sqrt(3)),
  });
  const flip = (axis: Axis, e: Vec3): AxisDef => {
    const n = normalize(e);
    return {
      axis,
      kind: 'flip',
      rotAxis: n,
      stepAngle: Math.PI,
      order: 2,
      region: { n, d: cut.b / Math.sqrt(2) },
      handle: e,
    };
  };
  return {
    U: corner('U', diag),
    D: corner('D', scale(diag, -1)),
    F: flip('F', EDGE_AXES[0]),
    R: flip('R', EDGE_AXES[1]),
    L: flip('L', EDGE_AXES[2]),
  };
}

export function inRegion(region: Region, p: Vec3): boolean {
  return dot(region.n, p) > region.d;
}

/** Normalize a step count into (-order/2, order/2]. */
export function normalizeAmount(amount: number, order: number): number {
  let a = ((amount % order) + order) % order;
  if (a > order / 2) a -= order;
  return a;
}

export function invertMove(m: Move): Move {
  return m.axis === 'F' || m.axis === 'R' || m.axis === 'L' ? m : { axis: m.axis, amount: -m.amount };
}

export function invertSequence(moves: readonly Move[]): Move[] {
  return moves.slice().reverse().map(invertMove);
}

export function formatMove(m: Move): string {
  if (m.axis === 'F' || m.axis === 'R' || m.axis === 'L') return m.axis;
  const n = Math.abs(m.amount);
  return m.axis + (n === 1 ? '' : String(n)) + (m.amount < 0 ? "'" : '');
}

export function formatSequence(moves: readonly Move[]): string {
  return moves.map(formatMove).join(' ');
}

export type ParseResult =
  | { readonly ok: true; readonly moves: Move[] }
  | { readonly ok: false; readonly error: string; readonly index: number };

const TOKEN = /([UDFRLudfrl])(\d*)(['’`]?)/y;

/** Parse an algorithm such as "U F U2' R D3 L" (whitespace optional) for the given variant. */
export function parseAlgorithm(text: string, variant: VariantDef): ParseResult {
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
    if (!m) return { ok: false, error: `Unexpected "${ch}". Use U, D, F, R, L with optional number and '.`, index: i };
    const axis = m[1].toUpperCase() as Axis;
    const count = m[2] ? parseInt(m[2], 10) : 1;
    const prime = m[3] !== '';
    if (axis === 'F' || axis === 'R' || axis === 'L') {
      if (count % 2 === 0) {
        return { ok: false, error: `${m[0]} is a full turn of a 180° flip (no effect).`, index: i };
      }
      moves.push({ axis, amount: 1 });
    } else {
      const amount = normalizeAmount(prime ? -count : count, variant.cornerOrder);
      if (amount === 0) {
        return { ok: false, error: `${m[0]} is a full turn on the ${variant.name} (no effect).`, index: i };
      }
      moves.push({ axis, amount });
    }
    i += m[0].length;
  }
  return { ok: true, moves };
}

/** Small, fast, seedable PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random-move scramble: each round turns the corner layers (U^a D^b, not both zero)
 * and then performs a flip different from the previous one.
 */
export function generateScramble(variant: VariantDef, rng: () => number, rounds = 20): Move[] {
  const order = variant.cornerOrder;
  const amounts: number[] = [];
  for (let a = -Math.floor((order - 1) / 2); a <= Math.floor(order / 2); a++) amounts.push(a);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  const moves: Move[] = [];
  let prevFlip: Axis | null = null;
  for (let r = 0; r < rounds; r++) {
    let a = 0;
    let b = 0;
    while (a === 0 && b === 0) {
      a = pick(amounts);
      b = pick(amounts);
    }
    if (a !== 0) moves.push({ axis: 'U', amount: a });
    if (b !== 0) moves.push({ axis: 'D', amount: b });
    const flips = (['F', 'R', 'L'] as const).filter((f) => f !== prevFlip);
    const f = pick(flips);
    moves.push({ axis: f, amount: 1 });
    prevFlip = f;
  }
  return moves;
}
