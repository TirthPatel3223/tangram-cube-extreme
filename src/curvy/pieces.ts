import { generateGroup } from '../puzzle/group';
import { type Mat3, type Vec3, mat3Vec } from '../puzzle/vec';
import { SAMPLE_SPACING } from './config';
import {
  type Constraint,
  type CubeFace,
  EDGE_AXIS,
  type EdgeName,
  FACE_NORMAL,
  cornerName,
  edgeOfAxis,
  faceOf,
  innerCornerAxis,
} from './geometry';
import { OrientationTable } from './orient';
import { type ShapeSamples, sampleShape } from './samples';
import { CURVY_VARIANTS, type CurvyVariantDef, type CurvyVariantId } from './variants';

export type PieceKind = 'edge' | 'corner' | 'xpiece' | 'petal' | 'triangle';

/** One of the 3 (Curvy Copter) or 4 (Plus) distinct piece shapes, in its standard position. */
export interface Shape {
  readonly kind: PieceKind;
  readonly constraints: readonly Constraint[];
  /** Faces carrying a sticker, in the shape's own frame. */
  readonly stickerFaces: readonly CubeFace[];
  /** Axes of every cone that bounds the shape (used to find jumble stops). */
  readonly coneAxes: readonly Vec3[];
  readonly samples: ShapeSamples;
}

export interface Sticker {
  /** Face of the shape (own frame) the sticker is on. */
  readonly face: CubeFace;
  /** Colour = the cube face it sits on when solved. */
  readonly color: CubeFace;
}

export interface CurvyPiece {
  readonly id: number;
  readonly kind: PieceKind;
  readonly shape: number;
  /** Cube rotation taking the shape's standard position to this piece's home slot. */
  readonly home: Mat3;
  /** Home slot, e.g. "UF", "UFR", "F·UFR". */
  readonly slot: string;
  readonly stickers: readonly Sticker[];
}

export interface CurvyModel {
  readonly variant: CurvyVariantDef;
  readonly shapes: readonly Shape[];
  readonly pieces: readonly CurvyPiece[];
  /** Interned orientations shared by every state of this model. */
  readonly table: OrientationTable;
}

const UFR: Vec3 = [1, 1, 1];
const cone = (e: EdgeName, inside: boolean): Constraint => ({ kind: 'cone', axis: EDGE_AXIS[e], inside });
const X_F_UFR = innerCornerAxis(FACE_NORMAL.F, UFR); // (-1,-1,4)/sqrt(18)

/** Shape definitions. Pieces sit inside the cube and outside the core. */
function shapeDefs(splitX: boolean): Array<Omit<Shape, 'samples' | 'coneAxes'>> {
  const solid: Constraint[] = [{ kind: 'cube' }, { kind: 'core' }];
  // UF edge: inside its own cone, outside its four neighbours'; slivers near the face centres trimmed.
  const edge: Omit<Shape, 'samples' | 'coneAxes'> = {
    kind: 'edge',
    constraints: [
      cone('UF', true),
      cone('UR', false),
      cone('UL', false),
      cone('FR', false),
      cone('FL', false),
      ...solid,
      { kind: 'tip', face: FACE_NORMAL.U },
      { kind: 'tip', face: FACE_NORMAL.F },
    ],
    stickerFaces: ['U', 'F'],
  };
  // UFR corner: inside the three cones that meet there.
  const corner: Omit<Shape, 'samples' | 'coneAxes'> = {
    kind: 'corner',
    constraints: [cone('UF', true), cone('UR', true), cone('FR', true), ...solid],
    stickerFaces: ['U', 'F', 'R'],
  };
  // X-piece on F next to UFR: inside the two F-face edge cones there, outside the third corner cone.
  const xBase: Constraint[] = [cone('UF', true), cone('FR', true), cone('UR', false)];
  if (!splitX) {
    return [edge, corner, { kind: 'xpiece', constraints: [...xBase, ...solid], stickerFaces: ['F'] }];
  }
  const inner: Constraint = { kind: 'cone', axis: X_F_UFR, inside: true };
  const outer: Constraint = { kind: 'cone', axis: X_F_UFR, inside: false };
  return [
    edge,
    corner,
    { kind: 'petal', constraints: [...xBase, outer, ...solid], stickerFaces: ['F'] },
    { kind: 'triangle', constraints: [...xBase, inner, ...solid], stickerFaces: ['F'] },
  ];
}

const R90X: Mat3 = [1, 0, 0, 0, 0, -1, 0, 1, 0];
const R90Y: Mat3 = [0, 0, 1, 0, 1, 0, -1, 0, 0];
/** The 24 rotations of the cube. */
export const CUBE_ROTATIONS: readonly Mat3[] = generateGroup([R90X, R90Y]).elements;

function slotOf(kind: PieceKind, g: Mat3): string {
  const corner = cornerName(mat3Vec(g, UFR));
  switch (kind) {
    case 'edge':
      return edgeOfAxis(mat3Vec(g, EDGE_AXIS.UF))!;
    case 'corner':
      return corner;
    default:
      return `${faceOf(mat3Vec(g, FACE_NORMAL.F))}·${corner}`;
  }
}

const cache = new Map<string, CurvyModel>();

/** Build (once per variant and sample spacing) the pieces of a Curvy Copter variant. */
export function buildModel(variantId: CurvyVariantId, spacing = SAMPLE_SPACING): CurvyModel {
  const key = `${variantId}:${spacing}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const variant = CURVY_VARIANTS[variantId];
  const shapes: Shape[] = shapeDefs(variant.splitX).map((d) => ({
    ...d,
    coneAxes: d.constraints.flatMap((c) => (c.kind === 'cone' ? [c.axis] : [])),
    samples: sampleShape(d.constraints, spacing),
  }));
  const pieces: CurvyPiece[] = [];
  shapes.forEach((shape, si) => {
    const seen = new Set<string>();
    for (const g of CUBE_ROTATIONS) {
      const slot = slotOf(shape.kind, g);
      if (seen.has(slot)) continue;
      seen.add(slot);
      pieces.push({
        id: pieces.length,
        kind: shape.kind,
        shape: si,
        home: g,
        slot,
        stickers: shape.stickerFaces.map((f) => ({ face: f, color: faceOf(mat3Vec(g, FACE_NORMAL[f]))! })),
      });
    }
  });
  const model: CurvyModel = { variant, shapes, pieces, table: new OrientationTable() };
  cache.set(key, model);
  return model;
}
