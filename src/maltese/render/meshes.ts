import * as THREE from 'three';
import type { Mat3 } from '../../puzzle/vec';
import { COLORS, LOOK } from '../config';
import { PIECES, type PieceKind } from '../model';
import type { BodyMesh, MalteseGeometry, StickerMesh } from './pieces';

export interface MalteseVisual {
  readonly pieceId: number;
  readonly kind: PieceKind;
  readonly group: THREE.Group;
  readonly meshes: readonly THREE.Mesh[];
  readonly bodyMaterial: THREE.MeshPhysicalMaterial;
  readonly stickerMaterials: readonly THREE.MeshPhysicalMaterial[];
}

function bodyGeometry(m: BodyMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

function stickerGeometry(m: StickerMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  const n = new Float32Array(m.positions.length);
  for (let i = 0; i < n.length; i += 3) n.set(m.normal, i);
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** Glossy black plastic: a low base specular keeps faces black head-on; clearcoat catches highlights. */
function plasticMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: LOOK.bodyColor,
    roughness: 0.42,
    metalness: 0,
    specularIntensity: 0.35,
    clearcoat: 0.3,
    clearcoatRoughness: 0.25,
    envMapIntensity: 0.7,
  });
}

/**
 * One group per piece: the shared body and sticker geometries of its kind (all pieces of a kind are
 * rotated copies), with per-piece materials so pieces can be highlighted on their own.
 */
export function buildMalteseVisuals(geo: MalteseGeometry): MalteseVisual[] {
  const shared = {
    corner: { body: bodyGeometry(geo.corner.body), stickers: geo.corner.stickers.map(stickerGeometry) },
    centre: { body: bodyGeometry(geo.centre.body), stickers: geo.centre.stickers.map(stickerGeometry) },
    edge: { body: bodyGeometry(geo.edge.body), stickers: geo.edge.stickers.map(stickerGeometry) },
    gear: { body: bodyGeometry(geo.gear.body), stickers: geo.gear.stickers.map(stickerGeometry) },
  };
  return PIECES.map((piece) => {
    const g = shared[piece.kind];
    const group = new THREE.Group();
    group.name = `piece-${piece.id}-${piece.kind}-${piece.name}`;
    const bodyMaterial = plasticMaterial();
    const body = new THREE.Mesh(g.body, bodyMaterial);
    body.userData.pieceId = piece.id;
    group.add(body);
    const meshes: THREE.Mesh[] = [body];
    const stickerMaterials: THREE.MeshPhysicalMaterial[] = [];
    g.stickers.forEach((sg, i) => {
      const mat = new THREE.MeshPhysicalMaterial({
        color: COLORS[piece.colors[i]],
        roughness: 0.45,
        metalness: 0,
        specularIntensity: 0.5,
        clearcoat: 0.25,
        clearcoatRoughness: 0.3,
        // Stickers lie 0.05 mm above the plastic; a small offset keeps them from flickering far away.
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(sg, mat);
      mesh.userData.pieceId = piece.id;
      group.add(mesh);
      meshes.push(mesh);
      stickerMaterials.push(mat);
    });
    return { pieceId: piece.id, kind: piece.kind, group, meshes, bodyMaterial, stickerMaterials };
  });
}

/** The fixed black core (with see-through tunnels along the four body diagonals). */
export function buildCoreMesh(geo: MalteseGeometry): THREE.Mesh {
  const mesh = new THREE.Mesh(
    bodyGeometry(geo.core),
    // Matte, so the deep core reads as shadow through the gaps rather than a shiny ball.
    new THREE.MeshPhysicalMaterial({ color: LOOK.coreColor, roughness: 0.92, metalness: 0, specularIntensity: 0.2 }),
  );
  mesh.name = 'core';
  return mesh;
}

const M4 = new THREE.Matrix4();

/** Put a piece where the state says: its group rotation is the state's matrix for it. */
export function setPieceTransform(v: MalteseVisual, m: Mat3): void {
  M4.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
  v.group.quaternion.setFromRotationMatrix(M4);
}

/** Highlight: the face layer that would turn 90°, its ring (45°) in a lighter tint. */
export type Highlight = 'none' | 'layer' | 'ring';

const LAYER = new THREE.Color('#60a5fa');
const RING = new THREE.Color('#a5f3fc');
const BLACK = new THREE.Color(0x000000);

export function setHighlight(v: MalteseVisual, h: Highlight): void {
  const c = h === 'layer' ? LAYER : h === 'ring' ? RING : BLACK;
  v.bodyMaterial.emissive.copy(c);
  v.bodyMaterial.emissiveIntensity = h === 'none' ? 0 : h === 'layer' ? 0.55 : 0.35;
  for (const m of v.stickerMaterials) {
    m.emissive.copy(h === 'none' ? BLACK : m.color);
    m.emissiveIntensity = h === 'none' ? 0 : h === 'layer' ? 0.18 : 0.1;
  }
}
