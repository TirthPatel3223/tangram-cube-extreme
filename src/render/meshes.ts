import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { FACE_COLORS, LOOK } from '../config';
import type { PuzzleModel } from '../puzzle/model';
import { FACE_NORMALS, type PieceDef, cubeFaceOf } from '../puzzle/pieces';
import { insetPlane } from '../puzzle/planes';
import { type ConvexPolyhedron, polyhedronFromPlanes, slicePolyhedron } from '../puzzle/polyhedron';
import type { VariantDef } from '../puzzle/variants';
import type { Vec3 } from '../puzzle/vec';
import { type PlaneBasis, insetConvex, insetPolygon3D, planeBasis, roundConvex, to2D, to3D } from './polygon2d';

export interface PieceVisual {
  readonly pieceId: number;
  readonly group: THREE.Group;
  readonly meshes: readonly THREE.Mesh[];
  readonly bodyMaterial: THREE.MeshPhysicalMaterial;
  readonly stickerMaterials: readonly THREE.MeshPhysicalMaterial[];
}

/** Physical look converted to model units (the cube is [-1,1]^3). */
export interface LookDims {
  readonly gap: number;
  readonly bevelOuter: number;
  readonly bevelInner: number;
  readonly margin: number;
  readonly radius: number;
  readonly lift: number;
}

export function lookDims(variant: VariantDef): LookDims {
  const mm = 2 / variant.edgeMm; // model units per millimetre
  return {
    gap: LOOK.gapMm * mm,
    bevelOuter: LOOK.bevelOuterMm * mm,
    bevelInner: LOOK.bevelInnerMm * mm,
    margin: LOOK.stickerMarginMm * mm,
    radius: LOOK.stickerRadiusMm * mm,
    lift: LOOK.stickerLiftMm * mm,
  };
}

function flatGeometry(poly: ConvexPolyhedron): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const f of poly.faces) {
    const v0 = poly.vertices[f.verts[0]];
    for (let t = 1; t + 1 < f.verts.length; t++) {
      for (const v of [v0, poly.vertices[f.verts[t]], poly.vertices[f.verts[t + 1]]]) {
        pos.push(v[0], v[1], v[2]);
        nrm.push(f.plane.n[0], f.plane.n[1], f.plane.n[2]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/** The piece's cell shrunk by half the piece gap on every cut face (outer cube faces stay put). */
export function shrunkCell(piece: PieceDef, d: LookDims): ConvexPolyhedron {
  // Only the planes that actually bound the piece: a plane that merely touches a vertex must not
  // be moved inward, or it would shave material off that corner.
  const planes = piece.poly.faces.map((f) => (cubeFaceOf(f.plane) ? f.plane : insetPlane(f.plane, d.gap / 2)));
  return polyhedronFromPlanes(planes, 1e-12) ?? piece.poly;
}

/**
 * Plastic body with bevelled edges.
 *
 * Every face of the shrunk cell is inset *within its own plane* (outer faces by `bevelOuter`, cut
 * faces by the much smaller `bevelInner`), outer faces get a second ring slightly below the
 * surface, and the body is the convex hull of all those rings. All hull points lie on or inside
 * the cell, and each outer face keeps a flat footprint that is only `bevelOuter` smaller than the
 * face itself, whatever the angle of the neighbouring cut. (Rolling a ball along the edges, the
 * previous approach, eats far into faces where a cut meets the surface at 45° or 54.7°, which left
 * stickers overhanging the plastic.)
 */
export function bodyGeometry(piece: PieceDef, d: LookDims): THREE.BufferGeometry {
  const cell = shrunkCell(piece, d);
  const pts: THREE.Vector3[] = [];
  const push = (ps: readonly Vec3[] | null) => {
    if (ps) for (const p of ps) pts.push(new THREE.Vector3(p[0], p[1], p[2]));
  };
  for (const f of cell.faces) {
    const outer = cubeFaceOf(f.plane) !== null;
    const poly = f.verts.map((i) => cell.vertices[i]);
    const t = outer ? d.bevelOuter : d.bevelInner;
    push(insetPolygon3D(poly, f.plane.n, t) ?? insetPolygon3D(poly, f.plane.n, t * 0.25) ?? poly);
    if (outer) {
      // Second ring ~0.29·t below the surface, inset by the same amount: with the neighbouring
      // outer face this approximates a quarter-round on the cube's own edges.
      const h = 0.29 * d.bevelOuter;
      const slice = slicePolyhedron(cell, { n: f.plane.n, d: f.plane.d - h });
      if (slice) push(insetPolygon3D(slice, f.plane.n, h));
    }
  }
  if (pts.length < 4) return flatGeometry(cell);
  return new ConvexGeometry(pts);
}

export interface StickerOutline {
  readonly basis: PlaneBasis;
  /** Outline in the face plane (2D, counter-clockwise seen from outside). */
  readonly outline: readonly [number, number][];
  /** The straight-edged inset polygon before the corners are rounded. */
  readonly inset: readonly [number, number][];
}

/** Sticker = face polygon inset by the margin, with rounded corners. */
export function stickerOutline(polygon: readonly Vec3[], normal: Vec3, d: LookDims): StickerOutline | null {
  const basis = planeBasis(polygon[0], normal);
  const pts = polygon.map((p) => to2D(basis, p));
  const inner = insetConvex(pts, d.margin + d.radius);
  if (inner) return { basis, outline: roundConvex(inner, d.radius), inset: insetConvex(pts, d.margin) ?? inner };
  const plain = insetConvex(pts, d.margin);
  return plain ? { basis, outline: plain, inset: plain } : null;
}

function stickerGeometry(s: StickerOutline, lift: number): THREE.BufferGeometry {
  const { basis, outline } = s;
  const cx = outline.reduce((acc, p) => acc + p[0], 0) / outline.length;
  const cy = outline.reduce((acc, p) => acc + p[1], 0) / outline.length;
  const c3 = to3D(basis, [cx, cy], lift);
  const pos: number[] = [];
  const nrm: number[] = [];
  const n = basis.normal;
  for (let i = 0; i < outline.length; i++) {
    pos.push(...c3, ...to3D(basis, outline[i], lift), ...to3D(basis, outline[(i + 1) % outline.length], lift));
    for (let k = 0; k < 3; k++) nrm.push(n[0], n[1], n[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

export function buildPieceVisuals(model: PuzzleModel): PieceVisual[] {
  const d = lookDims(model.variant);
  return model.pieces.map((piece) => {
    const group = new THREE.Group();
    group.name = `piece-${piece.id}-${piece.code}`;
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: LOOK.bodyColor,
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.2,
      clearcoatRoughness: 0.45,
    });
    const body = new THREE.Mesh(bodyGeometry(piece, d), bodyMaterial);
    body.userData.pieceId = piece.id;
    group.add(body);
    const meshes: THREE.Mesh[] = [body];
    const stickerMaterials: THREE.MeshPhysicalMaterial[] = [];
    for (const s of piece.stickers) {
      const outline = stickerOutline(s.polygon, FACE_NORMALS[s.face], d);
      if (!outline) continue;
      const mat = new THREE.MeshPhysicalMaterial({
        color: FACE_COLORS[s.face],
        roughness: 0.42,
        metalness: 0,
        clearcoat: 0.25,
        clearcoatRoughness: 0.3,
      });
      const mesh = new THREE.Mesh(stickerGeometry(outline, d.lift), mat);
      mesh.userData.pieceId = piece.id;
      group.add(mesh);
      meshes.push(mesh);
      stickerMaterials.push(mat);
    }
    return { pieceId: piece.id, group, meshes, bodyMaterial, stickerMaterials };
  });
}

export function disposeVisuals(visuals: readonly PieceVisual[]): void {
  for (const v of visuals) {
    v.group.removeFromParent();
    for (const m of v.meshes) m.geometry.dispose();
    v.bodyMaterial.dispose();
    for (const m of v.stickerMaterials) m.dispose();
  }
}

const HIGHLIGHT_BODY = new THREE.Color('#60a5fa');
const BLACK = new THREE.Color(0x000000);

export function setHighlighted(v: PieceVisual, on: boolean): void {
  v.bodyMaterial.emissive.copy(on ? HIGHLIGHT_BODY : BLACK);
  v.bodyMaterial.emissiveIntensity = on ? 0.55 : 0;
  for (const m of v.stickerMaterials) {
    m.emissive.copy(on ? m.color : BLACK);
    m.emissiveIntensity = on ? 0.18 : 0;
  }
}
