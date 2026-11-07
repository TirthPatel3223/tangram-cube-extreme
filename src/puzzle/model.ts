import { type RotationGroup, generateGroup } from './group';
import { type Axis, type AxisDef, type Move, buildAxisDefs } from './moves';
import { type PieceDef, buildPieces } from './pieces';
import { type CutParams, type VariantDef, type VariantId, VARIANTS, cutParams } from './variants';
import { type Mat3, axisAngleMat3 } from './vec';

/** Everything that is fixed for a puzzle variant: pieces, rotation group and move definitions. */
export interface PuzzleModel {
  readonly variant: VariantDef;
  readonly cut: CutParams;
  readonly pieces: readonly PieceDef[];
  readonly group: RotationGroup;
  readonly axes: Readonly<Record<Axis, AxisDef>>;
  /** Rotation matrix of a move (applied to the pieces in the move's region). */
  moveMatrix(move: Move): Mat3;
  /** Group element of a move. */
  moveElement(move: Move): number;
}

export function moveAngle(def: AxisDef, amount: number): number {
  return -amount * def.stepAngle;
}

export function createModel(variantId: VariantId, s: number): PuzzleModel {
  const variant = VARIANTS[variantId];
  const cut = cutParams(s);
  const pieces = buildPieces(variant, cut);
  const axes = buildAxisDefs(variant, cut);
  const moveMatrix = (m: Move): Mat3 => {
    const def = axes[m.axis];
    return axisAngleMat3(def.rotAxis, moveAngle(def, m.amount));
  };
  const group = generateGroup((['U', 'D', 'F', 'R', 'L'] as const).map((axis) => moveMatrix({ axis, amount: 1 })));
  const cache = new Map<string, number>();
  const moveElement = (m: Move): number => {
    const key = `${m.axis}${m.amount}`;
    let idx = cache.get(key);
    if (idx === undefined) {
      idx = group.find(moveMatrix(m));
      if (idx < 0) throw new Error(`move ${key} is not in the rotation group`);
      cache.set(key, idx);
    }
    return idx;
  };
  return { variant, cut, pieces, group, axes, moveMatrix, moveElement };
}
