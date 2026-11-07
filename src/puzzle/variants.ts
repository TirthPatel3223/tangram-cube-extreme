import { type Plane, complement, halfSpace } from './planes';
import type { Vec3 } from './vec';

/**
 * Cut geometry of the DaYan Tangram Cube family (inventor Daqing Bao).
 *
 * Coordinates: the cube is [-1, 1]^3. The two turning corners are T = (1,1,1) and B = (-1,-1,-1);
 * the three flip axes go through the edge midpoints (1,-1,0), (0,1,-1), (-1,0,1).
 *
 * With s = cut offset as a fraction of the edge length (measured ~0.31 on a real puzzle),
 * b = 2s and c = 1 - 2s:
 *   - layer cuts:               x+y+z = +c and x+y+z = -c        (3 layers along the T-B diagonal)
 *   - full edge cuts:           x-y = b, y-z = b, z-x = b         (all layers)
 *   - Extreme-only edge cuts:   x-y = -b, y-z = -b, z-x = -b      (top and bottom layers only)
 * Because c + b = 1, every cut line on the surface ends exactly on a cube edge.
 */

export type VariantId = 'extreme' | 'original';

export interface VariantDef {
  readonly id: VariantId;
  readonly name: string;
  readonly edgeMm: number;
  readonly year: number;
  /** Mirror-image edge cuts in the two corner layers (Extreme only). */
  readonly extraCuts: boolean;
  /** Corner-layer steps per full turn: 6 (60 degrees) on the Extreme, 3 (120 degrees) on the original. */
  readonly cornerOrder: number;
  /** Shapes visible on each face of the solved cube. */
  readonly shapesPerFace: number;
}

export const VARIANTS: Readonly<Record<VariantId, VariantDef>> = {
  extreme: {
    id: 'extreme',
    name: 'Tangram Cube Extreme',
    edgeMm: 61,
    year: 2017,
    extraCuts: true,
    cornerOrder: 6,
    shapesPerFace: 11,
  },
  original: {
    id: 'original',
    name: 'Tangram Cube',
    edgeMm: 59,
    year: 2016,
    extraCuts: false,
    cornerOrder: 3,
    shapesPerFace: 7,
  },
};

export interface CutParams {
  /** Cut offset as a fraction of the edge length. */
  readonly s: number;
  /** Edge-cut offset: planes e·x = ±b with e = (1,-1,0) etc. (un-normalized). */
  readonly b: number;
  /** Layer-cut offset: planes (1,1,1)·x = ±c (un-normalized). */
  readonly c: number;
}

export function cutParams(s: number): CutParams {
  if (!(s > 0 && s < 1 / 3)) throw new Error(`cut fraction s must be in (0, 1/3), got ${s}`);
  return { s, b: 2 * s, c: 1 - 2 * s };
}

export const DIAGONAL: Vec3 = [1, 1, 1];
/** Edge axes of the three flips, in F, R, L order. Seen from T, F -> R -> L is counter-clockwise. */
export const EDGE_AXES: readonly Vec3[] = [
  [1, -1, 0],
  [0, 1, -1],
  [-1, 0, 1],
];

export type LayerId = 'T' | 'M' | 'B';
export const LAYERS: readonly LayerId[] = ['T', 'M', 'B'];

export const CUBE_HALFSPACES: readonly Plane[] = [
  halfSpace([1, 0, 0], 1),
  halfSpace([-1, 0, 0], 1),
  halfSpace([0, 1, 0], 1),
  halfSpace([0, -1, 0], 1),
  halfSpace([0, 0, 1], 1),
  halfSpace([0, 0, -1], 1),
];

/** Half-spaces bounding one of the three layers along the T-B diagonal. */
export function layerHalfspaces(layer: LayerId, cut: CutParams): Plane[] {
  switch (layer) {
    case 'T':
      return [complement(halfSpace(DIAGONAL, cut.c))]; // x+y+z >= c
    case 'B':
      return [halfSpace(DIAGONAL, -cut.c)]; // x+y+z <= -c
    case 'M':
      return [halfSpace(DIAGONAL, cut.c), halfSpace([-1, -1, -1], cut.c)]; // -c <= x+y+z <= c
  }
}

/** Edge cut planes (as half-spaces e·x <= offset) that slice the given layer. */
export function layerEdgeCuts(layer: LayerId, variant: VariantDef, cut: CutParams): Plane[] {
  const offsets = layer !== 'M' && variant.extraCuts ? [cut.b, -cut.b] : [cut.b];
  return EDGE_AXES.flatMap((e) => offsets.map((o) => halfSpace(e, o)));
}
