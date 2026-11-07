import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CUT_S } from '../src/config';
import { MoveHistory } from '../src/puzzle/history';
import { createModel } from '../src/puzzle/model';
import { generateScramble, mulberry32, parseAlgorithm } from '../src/puzzle/moves';
import { PuzzleState } from '../src/puzzle/state';
import { VARIANTS } from '../src/puzzle/variants';
import { Animator } from '../src/render/animator';
import type { PieceVisual } from '../src/render/meshes';

/** Headless stand-ins for the piece meshes: the animator only needs a group per piece. */
function fakeVisuals(n: number): PieceVisual[] {
  return Array.from({ length: n }, (_, pieceId) => ({
    pieceId,
    group: new THREE.Group(),
    meshes: [],
    bodyMaterial: new THREE.MeshPhysicalMaterial(),
    stickerMaterials: [],
  }));
}

function run(animator: Animator, startMs = 0): number {
  let t = startMs;
  for (let i = 0; i < 100000 && animator.busy; i++) {
    t += 16;
    animator.update(t);
  }
  expect(animator.busy).toBe(false);
  return t;
}

describe('animator + history (as wired in the app)', () => {
  it('moves then undo-all returns to solved, and meshes match the state', () => {
    const model = createModel('extreme', CUT_S);
    const root = new THREE.Group();
    const visuals = fakeVisuals(model.pieces.length);
    const animator = new Animator(root, visuals, PuzzleState.solved(model));
    const history = new MoveHistory();
    const turn = (alg: string) => {
      const r = parseAlgorithm(alg, VARIANTS.extreme);
      if (!r.ok) throw new Error(r.error);
      for (const m of r.moves) {
        animator.enqueue(m, 280);
        history.push(m);
      }
    };
    turn('U F D');
    let t = run(animator);
    turn("U2' R L D3");
    // undo while some moves are still queued
    for (let i = 0; i < 3; i++) animator.update((t += 16));
    for (let i = 0; i < 7; i++) {
      const m = history.undo();
      if (m) animator.enqueue(m, 280);
    }
    t = run(animator, t);
    expect(history.moves.length).toBe(0);
    expect(animator.visualState.isSolved()).toBe(true);
    // every mesh is back under the root with the identity orientation
    for (const v of visuals) {
      expect(v.group.parent).toBe(root);
      expect(v.group.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    }
    // redo everything reproduces the forward state exactly
    const expected = PuzzleState.solved(model);
    const r = parseAlgorithm("U F D U2' R L D3", VARIANTS.extreme);
    if (!r.ok) throw new Error(r.error);
    expected.applyAll(r.moves);
    let m;
    while ((m = history.redo())) animator.enqueue(m, 280);
    run(animator, t);
    expect(animator.visualState.equals(expected)).toBe(true);
  });

  it('mesh orientations follow the state after a long scramble', () => {
    const model = createModel('extreme', CUT_S);
    const root = new THREE.Group();
    const visuals = fakeVisuals(model.pieces.length);
    const animator = new Animator(root, visuals, PuzzleState.solved(model));
    const moves = generateScramble(model.variant, mulberry32(99));
    for (const m of moves) animator.enqueue(m, 70);
    run(animator);
    const expected = PuzzleState.solved(model);
    expected.applyAll(moves);
    expect(animator.visualState.equals(expected)).toBe(true);
    for (const v of visuals) {
      const [x, y, z, w] = model.group.quats[expected.orient[v.pieceId]];
      expect(v.group.quaternion.angleTo(new THREE.Quaternion(x, y, z, w))).toBeLessThan(1e-6);
    }
  });
});
