import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CUT_S } from '../src/config';
import { createModel } from '../src/puzzle/model';
import { FACE_NORMALS, type PieceDef } from '../src/puzzle/pieces';
import type { Vec3 } from '../src/puzzle/vec';
import { type LookDims, bodyGeometry, lookDims, stickerOutline } from '../src/render/meshes';
import { to3D } from '../src/render/polygon2d';

/** Outward half-spaces (n·x <= c) of a convex mesh, from its triangles. */
function hullPlanes(g: THREE.BufferGeometry): Array<{ n: THREE.Vector3; c: number }> {
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const count = idx ? idx.count : pos.count;
  const get = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i);
  const out: Array<{ n: THREE.Vector3; c: number }> = [];
  for (let i = 0; i < count; i += 3) {
    const a = get(i), b = get(i + 1), c = get(i + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.length() < 1e-12) continue;
    n.normalize();
    out.push({ n, c: n.dot(a) });
  }
  return out;
}

/** Depth (along -dir from q) at which a ray enters the convex body, or null if it misses. */
function entryDepth(planes: Array<{ n: THREE.Vector3; c: number }>, q: Vec3, dir: Vec3): number | null {
  let lo = 0;
  let hi = Infinity;
  const Q = new THREE.Vector3(...q);
  const D = new THREE.Vector3(-dir[0], -dir[1], -dir[2]);
  for (const { n, c } of planes) {
    const a = n.dot(Q) - c; // ray point p(t) = Q + D t ; constraint n·p - c <= 0  ->  a + t (n·D) <= 0
    const b = n.dot(D);
    if (Math.abs(b) < 1e-12) {
      if (a > 1e-9) return null;
    } else if (b > 0) hi = Math.min(hi, -a / b);
    else lo = Math.max(lo, -a / b);
  }
  return lo <= hi + 1e-12 ? lo : null;
}

interface RimStats {
  overhangPoints: number;
  rims: number[];
}

/**
 * For every sticker: (a) count outline points with no plastic directly beneath them, and
 * (b) measure, head-on, how wide the black rim is beyond each straight sticker edge (how far out
 * the plastic stays within `visibleDepth` of the surface).
 */
function measure(pieces: readonly PieceDef[], d: LookDims, body: (p: PieceDef) => THREE.BufferGeometry, mm: number): RimStats {
  const visibleDepth = 0.25 * mm;
  const step = 0.01 * mm;
  let overhangPoints = 0;
  const rims: number[] = [];
  for (const piece of pieces) {
    const planes = hullPlanes(body(piece));
    for (const s of piece.stickers) {
      const n = FACE_NORMALS[s.face];
      const o = stickerOutline(s.polygon, n, d);
      if (!o) continue;
      for (const p2 of o.outline) {
        const depth = entryDepth(planes, to3D(o.basis, p2, 1e-6), n);
        if (depth === null || depth > 0.02 * mm) overhangPoints++;
      }
      const poly = o.inset;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 2 * mm) continue;
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const out: [number, number] = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len]; // CCW -> right normal points out
        let w = 0;
        for (; w < 3 * mm; w += step) {
          const q = to3D(o.basis, [mid[0] + out[0] * w, mid[1] + out[1] * w], 1e-6);
          const depth = entryDepth(planes, q, n);
          if (depth === null || depth > visibleDepth) break;
        }
        rims.push(w / mm);
      }
    }
  }
  return { overhangPoints, rims };
}

describe.each(['extreme', 'original'] as const)('%s piece bodies under the stickers', (variant) => {
  const model = createModel(variant, CUT_S);
  const d = lookDims(model.variant);
  const mm = 2 / model.variant.edgeMm;
  const now = measure(model.pieces, d, (p) => bodyGeometry(p, d), mm);

  it('every sticker sits on plastic everywhere (no overhang)', () => {
    expect(now.overhangPoints).toBe(0);
  });

  it('the black rim around stickers is even (0.67-1.01 mm; it was 0-0.99 mm with rolled edges)', () => {
    expect(Math.min(...now.rims)).toBeGreaterThan(0.6);
    expect(Math.max(...now.rims)).toBeLessThan(1.1);
    expect(Math.max(...now.rims) - Math.min(...now.rims)).toBeLessThan(0.4);
  });
});
