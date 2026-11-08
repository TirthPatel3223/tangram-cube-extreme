import * as THREE from 'three';
import type { Stage } from '../../render/scene';
import { distance } from '../../puzzle/vec';
import { EDGES, EDGE_HANDLE, type EdgeName } from '../geometry';
import type { CurvyState } from '../state';
import { type CurvyVisual, PICK_LAYER } from './meshes';

export interface CurvyPickHandlers {
  onHover(edge: EdgeName | null, clientX: number, clientY: number): void;
  /** A click/tap on an edge part. `alternate` = right button or Shift (the other direction). */
  onTurn(edge: EdgeName, alternate: boolean): void;
}

/**
 * Click-to-turn for the 12 edges. A piece can belong to several turning parts; the one whose edge
 * midpoint is nearest the clicked point wins. Membership is recomputed when the state changes.
 */
export class CurvyPicker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private hovered: EdgeName | null = null;
  private membership: Map<number, EdgeName[]> | null = null;

  constructor(
    private readonly stage: Stage,
    private visuals: readonly CurvyVisual[],
    private readonly getState: () => CurvyState,
    private readonly handlers: CurvyPickHandlers,
  ) {
    this.raycaster.layers.set(PICK_LAYER);
    const el = stage.renderer.domElement;
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerleave', () => this.clearHover());
  }

  setVisuals(visuals: readonly CurvyVisual[]): void {
    this.visuals = visuals;
    this.invalidate();
    this.clearHover();
  }

  /** Call after the displayed state changes. */
  invalidate(): void {
    this.membership = null;
  }

  private edgesOf(pieceId: number): EdgeName[] {
    if (!this.membership) {
      const st = this.getState();
      const map = new Map<number, EdgeName[]>();
      for (const e of EDGES) {
        for (const i of st.movingPieces(e)) {
          const list = map.get(i);
          if (list) list.push(e);
          else map.set(i, [e]);
        }
      }
      this.membership = map;
    }
    return this.membership.get(pieceId) ?? [];
  }

  partAt(clientX: number, clientY: number): EdgeName | null {
    const el = this.stage.renderer.domElement;
    const r = el.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
    const hits = this.raycaster.intersectObjects(
      this.visuals.map((v) => v.group),
      true,
    );
    const hit = hits.find((h) => typeof h.object.userData.pieceId === 'number');
    if (!hit) return null;
    const local = this.stage.root.worldToLocal(hit.point.clone());
    const p: [number, number, number] = [local.x, local.y, local.z];
    let best: EdgeName | null = null;
    let bestD = Infinity;
    for (const e of this.edgesOf(hit.object.userData.pieceId as number)) {
      const d = distance(p, EDGE_HANDLE[e]);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  tap(clientX: number, clientY: number, alternate: boolean): void {
    const e = this.partAt(clientX, clientY);
    if (e) this.handlers.onTurn(e, alternate);
  }

  clearHover(): void {
    this.setHovered(null, 0, 0);
  }

  /** Re-run hover handling at the last pointer position (after a turn changed what is under it). */
  get hoveredEdge(): EdgeName | null {
    return this.hovered;
  }

  private setHovered(e: EdgeName | null, x: number, y: number) {
    this.hovered = e;
    this.stage.renderer.domElement.style.cursor = e ? 'pointer' : '';
    this.handlers.onHover(e, x, y);
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
    const edge = this.partAt(e.clientX, e.clientY);
    if (edge !== this.hovered || edge) this.setHovered(edge, e.clientX, e.clientY);
  };
}
