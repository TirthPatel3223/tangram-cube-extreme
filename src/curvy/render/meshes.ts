import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Mat3 } from '../../puzzle/vec';
import { COLORS, CORE_R, LOOK } from '../config';
import { FACE_NORMAL } from '../geometry';
import type { CurvyModel } from '../pieces';
import type { MeshData, ShapeGeometry } from './csg';

export interface CurvyVisual {
  readonly pieceId: number;
  readonly group: THREE.Group;
  readonly meshes: readonly THREE.Mesh[];
  readonly bodyMaterial: THREE.MeshPhysicalMaterial;
  readonly stickerMaterials: readonly THREE.MeshPhysicalMaterial[];
}

function bodyGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  // Smooth across the facets of each cone, sharp where two cuts (or a cut and a face) meet.
  const creased = toCreasedNormals(g, (35 * Math.PI) / 180);
  g.dispose();
  return creased;
}

function stickerGeometry(m: MeshData, normal: readonly number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  const n = new Float32Array(m.positions.length);
  for (let i = 0; i < n.length; i += 3) n.set(normal, i);
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
}

/**
 * One group per piece: the shared body and sticker geometries of its shape (all pieces of a kind
 * are rotated copies), with per-piece materials so pieces can be highlighted on their own.
 */
export function buildCurvyVisuals(model: CurvyModel, geos: readonly ShapeGeometry[]): CurvyVisual[] {
  const bodies = geos.map((g) => bodyGeometry(g.body));
  const stickers = geos.map((g) => new Map(g.stickers.map((s) => [s.face, stickerGeometry(s, FACE_NORMAL[s.face])])));
  return model.pieces.map((piece) => {
    const group = new THREE.Group();
    group.name = `piece-${piece.id}-${piece.kind}-${piece.slot}`;
    group.matrixAutoUpdate = true;
    // Glossy black plastic: a low base specular keeps faces black when seen head-on, while the
    // clearcoat still catches highlights on the curved cuts.
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: LOOK.bodyColor,
      roughness: 0.42,
      metalness: 0,
      specularIntensity: 0.35,
      clearcoat: 0.3,
      clearcoatRoughness: 0.25,
      envMapIntensity: 0.7,
    });
    const body = new THREE.Mesh(bodies[piece.shape], bodyMaterial);
    body.userData.pieceId = piece.id;
    group.add(body);
    const meshes: THREE.Mesh[] = [body];
    const stickerMaterials: THREE.MeshPhysicalMaterial[] = [];
    for (const s of piece.stickers) {
      const geo = stickers[piece.shape].get(s.face);
      if (!geo) continue;
      const mat = new THREE.MeshPhysicalMaterial({
        color: COLORS[s.color],
        roughness: 0.45,
        metalness: 0,
        specularIntensity: 0.5,
        clearcoat: 0.25,
        clearcoatRoughness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.pieceId = piece.id;
      group.add(mesh);
      meshes.push(mesh);
      stickerMaterials.push(mat);
    }
    return { pieceId: piece.id, group, meshes, bodyMaterial, stickerMaterials };
  });
}

/** The fixed black core, visible through the holes a jumble leaves. */
export function buildCore(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(CORE_R * 1.02, 48, 32),
    new THREE.MeshPhysicalMaterial({ color: LOOK.coreColor, roughness: 0.6, metalness: 0 }),
  );
  mesh.name = 'core';
  return mesh;
}

const M4 = new THREE.Matrix4();

/** Put a piece where the state says: its group rotation is orientation · home. */
export function setPieceTransform(v: CurvyVisual, m: Mat3): void {
  M4.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
  v.group.quaternion.setFromRotationMatrix(M4);
}

export type Highlight = 'none' | 'moving' | 'blocker';

const MOVING = new THREE.Color('#60a5fa');
const BLOCKER = new THREE.Color('#f43f5e');
const BLACK = new THREE.Color(0x000000);

export function setHighlight(v: CurvyVisual, h: Highlight): void {
  const c = h === 'moving' ? MOVING : h === 'blocker' ? BLOCKER : BLACK;
  v.bodyMaterial.emissive.copy(c);
  v.bodyMaterial.emissiveIntensity = h === 'none' ? 0 : h === 'blocker' ? 0.85 : 0.55;
  for (const m of v.stickerMaterials) {
    m.emissive.copy(h === 'none' ? BLACK : h === 'blocker' ? BLOCKER : m.color);
    m.emissiveIntensity = h === 'none' ? 0 : h === 'blocker' ? 0.45 : 0.18;
  }
}
