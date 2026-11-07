import { IDENTITY3, type Mat3, type Quat, mat3Equal, mat3Mul, mat3ToQuat } from './vec';

/**
 * A finite rotation group with exact integer multiplication tables.
 * Piece orientations are stored as element indices, so long move sequences never drift.
 */
export interface RotationGroup {
  readonly size: number;
  readonly identity: number;
  readonly elements: readonly Mat3[];
  readonly quats: readonly Quat[];
  /** Index of elements[a] · elements[b]. */
  mul(a: number, b: number): number;
  inv(a: number): number;
  /** Index of the given matrix, or -1 if it is not in the group. */
  find(m: Mat3): number;
}

export function generateGroup(generators: readonly Mat3[], maxSize = 240): RotationGroup {
  const elements: Mat3[] = [IDENTITY3];
  const find = (m: Mat3) => elements.findIndex((e) => mat3Equal(e, m));
  for (let i = 0; i < elements.length; i++) {
    for (const g of generators) {
      const h = mat3Mul(g, elements[i]);
      if (find(h) < 0) {
        elements.push(h);
        if (elements.length > maxSize) throw new Error('rotation group is not finite (or too large)');
      }
    }
  }
  const n = elements.length;
  const table = new Int32Array(n * n);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const idx = find(mat3Mul(elements[a], elements[b]));
      if (idx < 0) throw new Error('group closure failed');
      table[a * n + b] = idx;
    }
  }
  const inverse = new Int32Array(n);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) if (table[a * n + b] === 0) inverse[a] = b;
  }
  return {
    size: n,
    identity: 0,
    elements,
    quats: elements.map(mat3ToQuat),
    mul: (a, b) => table[a * n + b],
    inv: (a) => inverse[a],
    find,
  };
}
