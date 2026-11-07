import { type Plane, complement } from './planes';
import { type ConvexPolyhedron, polyhedronFromPlanes } from './polyhedron';
import {
  CUBE_HALFSPACES,
  type CutParams,
  LAYERS,
  type LayerId,
  type VariantDef,
  layerEdgeCuts,
  layerHalfspaces,
} from './variants';
import type { Vec3 } from './vec';

export type FaceId = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export const FACE_IDS: readonly FaceId[] = ['+x', '-x', '+y', '-y', '+z', '-z'];
export const FACE_NORMALS: Readonly<Record<FaceId, Vec3>> = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};

export interface StickerDef {
  /** Cube face the sticker sits on in the solved state (determines its colour). */
  readonly face: FaceId;
  /** Polygon on the cube surface, counter-clockwise seen from outside. */
  readonly polygon: readonly Vec3[];
}

export interface PieceDef {
  readonly id: number;
  readonly layer: LayerId;
  /** Debug code: layer plus which side of each of the layer's edge cuts the piece is on. */
  readonly code: string;
  readonly poly: ConvexPolyhedron;
  readonly stickers: readonly StickerDef[];
  /** Index (into poly.planes) of every bounding plane that lies on the cube surface. */
  readonly outerPlanes: ReadonlySet<number>;
}

/** Which cube face a bounding plane lies on, if any. */
export function cubeFaceOf(plane: Plane, eps = 1e-9): FaceId | null {
  if (Math.abs(plane.d - 1) > eps) return null;
  for (const id of FACE_IDS) {
    const n = FACE_NORMALS[id];
    if (
      Math.abs(plane.n[0] - n[0]) < eps &&
      Math.abs(plane.n[1] - n[1]) < eps &&
      Math.abs(plane.n[2] - n[2]) < eps
    ) {
      return id;
    }
  }
  return null;
}

/**
 * Enumerate the pieces: split the cube into the three diagonal layers, then split each layer by
 * that layer's edge cuts (every combination of sides), keeping cells with positive volume.
 */
export function buildPieces(variant: VariantDef, cut: CutParams): PieceDef[] {
  const pieces: PieceDef[] = [];
  for (const layer of LAYERS) {
    const cuts = layerEdgeCuts(layer, variant, cut);
    const base = [...CUBE_HALFSPACES, ...layerHalfspaces(layer, cut)];
    for (let mask = 0; mask < 1 << cuts.length; mask++) {
      const sides = cuts.map((p, i) => ((mask >> i) & 1 ? complement(p) : p));
      const poly = polyhedronFromPlanes([...base, ...sides]);
      if (!poly) continue;
      const stickers: StickerDef[] = [];
      const outerPlanes = new Set<number>();
      poly.planes.forEach((p, idx) => {
        if (cubeFaceOf(p)) outerPlanes.add(idx);
      });
      for (const f of poly.faces) {
        const face = cubeFaceOf(f.plane);
        if (face) stickers.push({ face, polygon: f.verts.map((i) => poly.vertices[i]) });
      }
      const code = layer + ':' + cuts.map((_, i) => ((mask >> i) & 1 ? '>' : '<')).join('');
      pieces.push({ id: pieces.length, layer, code, poly, stickers, outerPlanes });
    }
  }
  return pieces;
}
