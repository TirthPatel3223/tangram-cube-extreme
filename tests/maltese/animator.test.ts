import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MoveHistory } from '../../src/puzzle/history';
import { PIECES } from '../../src/maltese/model';
import { type Move, invertMove, parseAlgorithm } from '../../src/maltese/notation';
import { MalteseAnimator } from '../../src/maltese/render/animator';
import type { MalteseVisual } from '../../src/maltese/render/meshes';
import { MalteseState } from '../../src/maltese/state';

/** Headless stand-ins for the piece meshes: the animator only needs a group per piece. */
function fakeVisuals(): MalteseVisual[] {
  return PIECES.map((p) => ({
    pieceId: p.id,
    kind: p.kind,
    group: new THREE.Group(),
    meshes: [],
    bodyMaterial: new THREE.MeshPhysicalMaterial(),
    stickerMaterials: [],
  }));
}

function run(animator: MalteseAnimator, start = 0): number {
  let t = start;
  for (let i = 0; i < 100000 && animator.busy; i++) animator.update((t += 16));
  expect(animator.busy).toBe(false);
  return t;
}

const q = new THREE.Quaternion();
const m4 = new THREE.Matrix4();
function quatOf(st: MalteseState, id: number): THREE.Quaternion {
  const m = st.matrix(id);
  m4.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
  return q.setFromRotationMatrix(m4).clone();
}
function expectMeshesMatch(visuals: readonly MalteseVisual[], st: MalteseState) {
  for (const v of visuals) expect(v.group.quaternion.angleTo(quatOf(st, v.pieceId)), PIECES[v.pieceId].name).toBeLessThan(1e-6);
}

describe('maltese animator + history', () => {
  it('animates moves (ring gears spinning) into exactly the engine poses, undoes and redoes them', () => {
    const visuals = fakeVisuals();
    const animator = new MalteseAnimator(visuals, MalteseState.solved());
    const history = new MoveHistory<Move>(invertMove);
    const logical = MalteseState.solved();
    const p = parseAlgorithm("U R2' F' D3 B L4 U' R F2");
    if (!p.ok) throw new Error(p.error);
    for (const m of p.moves) {
      logical.apply(m);
      animator.enqueue(m, 300);
      history.push(m);
    }
    let t = run(animator);
    expect(animator.visualState.equals(logical)).toBe(true);
    expectMeshesMatch(visuals, animator.visualState);
    const forward = animator.visualState.clone();
    let m;
    while ((m = history.undo())) animator.enqueue(m, 300);
    t = run(animator, t);
    expect(animator.visualState.isSolved()).toBe(true);
    while ((m = history.redo())) animator.enqueue(m, 300);
    run(animator, t);
    expect(animator.visualState.equals(forward)).toBe(true);
    expectMeshesMatch(visuals, animator.visualState);
  });

  it('half way through U the ring has turned 22.5° and its gears have not spun yet (as in the user’s video)', () => {
    const visuals = fakeVisuals();
    const animator = new MalteseAnimator(visuals, MalteseState.solved());
    animator.previewAt({ face: 'U', amount: 1 }, 0.5);
    const solved = MalteseState.solved();
    // The F-right gear of the E ring: carried 22.5° about +y (clockwise from above), not spun yet.
    const g = PIECES.find((x) => x.kind === 'gear' && x.name === 'Fr')!;
    const expected = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 8)
      .multiply(quatOf(solved, g.id));
    expect(visuals[g.id].group.quaternion.angleTo(expected)).toBeLessThan(1e-6);
    // A U-layer corner has turned 45°, a D-layer corner not at all.
    const ufr = PIECES.find((x) => x.name === 'UFR')!;
    const dfr = PIECES.find((x) => x.name === 'DFR')!;
    expect(visuals[ufr.id].group.quaternion.angleTo(quatOf(solved, ufr.id))).toBeCloseTo(Math.PI / 4, 6);
    expect(visuals[dfr.id].group.quaternion.angleTo(quatOf(solved, dfr.id))).toBeLessThan(1e-6);
    // Three quarters of the way the gear is half way through its spin (45°), like frame 120 of the video.
    animator.previewAt({ face: 'U', amount: 1 }, 0.75);
    const at34 = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(3 * Math.PI) / 16)
      .multiply(quatOf(solved, g.id))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4));
    expect(visuals[g.id].group.quaternion.angleTo(at34)).toBeLessThan(1e-6);
    animator.previewAt(null);
    expectMeshesMatch(visuals, solved);
  });
});
