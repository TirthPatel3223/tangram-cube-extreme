import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type AppliedTurn, invertTurn, parseTurns, resolveAlgorithm } from '../../src/curvy/notation';
import { buildModel } from '../../src/curvy/pieces';
import { CurvyAnimator } from '../../src/curvy/render/animator';
import type { CurvyVisual } from '../../src/curvy/render/meshes';
import { CurvyState } from '../../src/curvy/state';
import { MoveHistory } from '../../src/puzzle/history';

/** Headless stand-ins for the piece meshes: the animator only needs a group per piece. */
function fakeVisuals(n: number): CurvyVisual[] {
  return Array.from({ length: n }, (_, pieceId) => ({
    pieceId,
    group: new THREE.Group(),
    meshes: [],
    bodyMaterial: new THREE.MeshPhysicalMaterial(),
    stickerMaterials: [],
  }));
}

function run(animator: CurvyAnimator, start = 0): number {
  let t = start;
  for (let i = 0; i < 100000 && animator.busy; i++) animator.update((t += 16));
  expect(animator.busy).toBe(false);
  return t;
}

function expectMeshesMatch(visuals: readonly CurvyVisual[], state: CurvyState) {
  const q = new THREE.Quaternion();
  const m4 = new THREE.Matrix4();
  for (const v of visuals) {
    const m = state.matrix(v.pieceId);
    m4.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
    q.setFromRotationMatrix(m4);
    expect(v.group.quaternion.angleTo(q)).toBeLessThan(1e-6);
  }
}

describe('curvy animator + history', () => {
  it('plays jumbles, undoes them all back to solved, and redo reproduces the state', () => {
    const model = buildModel('plus');
    const root = new THREE.Group();
    const visuals = fakeVisuals(model.pieces.length);
    const animator = new CurvyAnimator(root, visuals, CurvyState.solved(model));
    const history = new MoveHistory<AppliedTurn>(invertTurn);
    const logical = CurvyState.solved(model);
    const p = parseTurns('UL- FR- UF FR+ UL+ UR+ UF- UR- UF+ DB');
    if (!p.ok) throw new Error(p.error);
    const r = resolveAlgorithm(logical, p.turns);
    if (!r.ok) throw new Error(r.error);
    for (const t of r.turns) {
      logical.apply(t, false);
      animator.enqueue(t, 300);
      history.push(t);
    }
    let t = run(animator);
    expect(animator.visualState.equals(logical)).toBe(true);
    expectMeshesMatch(visuals, animator.visualState);
    const forward = animator.visualState.clone();
    let m;
    while ((m = history.undo())) animator.enqueue(m, 300);
    t = run(animator, t);
    expect(animator.visualState.isHome()).toBe(true);
    for (const v of visuals) expect(v.group.parent).toBe(root);
    while ((m = history.redo())) animator.enqueue(m, 300);
    run(animator, t);
    expect(animator.visualState.equals(forward)).toBe(true);
    expectMeshesMatch(visuals, animator.visualState);
  });
});
