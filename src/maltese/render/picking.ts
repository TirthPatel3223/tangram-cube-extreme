import * as THREE from 'three';
import { distance } from '../../puzzle/vec';
import type { Stage } from '../../render/scene';
import { FACES, FACE_NORMAL, type Face } from '../geometry';
import type { MalteseState } from '../state';
import type { MalteseVisual } from './meshes';

export interface MaltesePickHandlers {
  onHover(face: Face | null, clientX: number, clientY: number): void;
  /** A click/tap on a face. `alternate` = right button or Shift (counterclockwise). */
  onTurn(face: Face, alternate: boolean): void;
}

/**
 * Click-to-turn. A piece belongs to one to three face layers; of those, the face whose centre is
 * nearest the clicked point wins (so clicking anywhere on a face turns that face). Membership is
 * recomputed whenever the displayed state changes.
 */
export class MaltesePicker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private hovered: Face | null = null;
  private membership: Map<number, Face[]> | null = null;
  private readonly targets: THREE.Object3D[];

  constructor(
    private readonly stage: Stage,
    visuals: readonly MalteseVisual[],
    private readonly getState: () => MalteseState,
    private readonly handlers: MaltesePickHandlers,
  ) {
    this.targets = visuals.map((v) => v.group);
    const el = stage.renderer.domElement;
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerleave', () => this.clearHover());
  }

  /** Call after the displayed state changes. */
  invalidate(): void {
    this.membership = null;
  }

  private facesOf(pieceId: number): Face[] {
    if (!this.membership) {
      const st = this.getState();
      const map = new Map<number, Face[]>();
      for (const f of FACES) {
        for (const id of st.movingParts(f).layer) {
          const list = map.get(id);
          if (list) list.push(f);
          else map.set(id, [f]);
        }
      }
      this.membership = map;
    }
    return this.membership.get(pieceId) ?? [];
  }

  faceAt(clientX: number, clientY: number): Face | null {
    const el = this.stage.renderer.domElement;
    const r = el.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
    const hit = this.raycaster.intersectObjects(this.targets, true).find((h) => typeof h.object.userData.pieceId === 'number');
    if (!hit) return null;
    const local = this.stage.root.worldToLocal(hit.point.clone());
    const p: [number, number, number] = [local.x, local.y, local.z];
    let best: Face | null = null;
    let bestD = Infinity;
    for (const f of this.facesOf(hit.object.userData.pieceId as number)) {
      const d = distance(p, FACE_NORMAL[f]);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  tap(clientX: number, clientY: number, alternate: boolean): void {
    const f = this.faceAt(clientX, clientY);
    if (f) this.handlers.onTurn(f, alternate);
  }

  clearHover(): void {
    this.setHovered(null, 0, 0);
  }

  get hoveredFace(): Face | null {
    return this.hovered;
  }

  private setHovered(f: Face | null, x: number, y: number) {
    this.hovered = f;
    this.stage.renderer.domElement.style.cursor = f ? 'pointer' : '';
    this.handlers.onHover(f, x, y);
  }

  private pending: { x: number; y: number } | null = null;

  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
    // Raycast at most once per frame.
    const first = this.pending === null;
    this.pending = { x: e.clientX, y: e.clientY };
    if (!first) return;
    requestAnimationFrame(() => {
      const p = this.pending!;
      this.pending = null;
      const f = this.faceAt(p.x, p.y);
      if (f !== this.hovered || f) this.setHovered(f, p.x, p.y);
    });
  };
}
