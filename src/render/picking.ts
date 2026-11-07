import * as THREE from 'three';
import { AXES, type Axis } from '../puzzle/moves';
import type { PuzzleState } from '../puzzle/state';
import { distance } from '../puzzle/vec';
import type { PieceVisual } from './meshes';
import type { Stage } from './scene';

export interface PickHandlers {
  /** Hovered part changed (null when the pointer leaves the puzzle). */
  onHover(axis: Axis | null, clientX: number, clientY: number): void;
  /** A click/tap on a part: direction +1 = clockwise (or the flip), -1 = counter-clockwise. */
  onTurn(axis: Axis, direction: 1 | -1): void;
}

/**
 * Click-to-turn. A piece belongs to one or more turning parts (a corner layer and/or edge flips);
 * the part whose handle (turning corner or flip-edge midpoint) is closest to the pointer wins.
 * Clicks/taps are recognised by GestureControls (so drags and two-finger gestures never turn).
 */
export class Picker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private hovered: Axis | null = null;

  constructor(
    private readonly stage: Stage,
    private visuals: readonly PieceVisual[],
    private readonly getState: () => PuzzleState,
    private readonly handlers: PickHandlers,
  ) {
    const el = stage.renderer.domElement;
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerleave', () => this.clearHover());
  }

  setVisuals(visuals: readonly PieceVisual[]): void {
    this.visuals = visuals;
    this.clearHover();
  }

  /** Which part would a click at this screen position turn? */
  partAt(clientX: number, clientY: number): Axis | null {
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
    const pieceId: number = hit.object.userData.pieceId;
    const local = this.stage.root.worldToLocal(hit.point.clone());
    const p: [number, number, number] = [local.x, local.y, local.z];
    const state = this.getState();
    let best: Axis | null = null;
    let bestDist = Infinity;
    for (const axis of AXES) {
      if (!state.isInPart(pieceId, axis)) continue;
      const d = distance(p, state.model.axes[axis].handle);
      if (d < bestDist) {
        bestDist = d;
        best = axis;
      }
    }
    return best;
  }

  /** Turn the part under a click/tap position. */
  tap(clientX: number, clientY: number, alternate: boolean): void {
    const axis = this.partAt(clientX, clientY);
    if (axis) this.handlers.onTurn(axis, alternate ? -1 : 1);
  }

  clearHover(): void {
    this.setHovered(null, 0, 0);
  }

  private setHovered(axis: Axis | null, x: number, y: number) {
    this.hovered = axis;
    this.stage.renderer.domElement.style.cursor = axis ? 'pointer' : '';
    this.handlers.onHover(axis, x, y);
  }

  private onMove = (e: PointerEvent) => {
    // Hover feedback is for mice only, and not while a button is held (that is a drag).
    if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
    const axis = this.partAt(e.clientX, e.clientY);
    if (axis !== this.hovered || axis) this.setHovered(axis, e.clientX, e.clientY);
  };
}
