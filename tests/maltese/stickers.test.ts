import { describe, expect, it } from 'vitest';
import { ARC_STEP, type P2, signedArea } from '../../src/maltese/sketch';
import { gearSticker, starSticker } from '../../src/maltese/stickers';

import { STICKER_REFERENCE as REF } from './fixtures/sticker-reference';

const MM = 1 / 30;

function segDist(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function toPoly(p: P2, poly: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, segDist(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}
function hausdorff(a: readonly P2[], b: readonly P2[]): number {
  let h = 0;
  for (const p of a) h = Math.max(h, toPoly(p, b));
  for (const p of b) h = Math.max(h, toPoly(p, a));
  return h;
}
function selfIntersects(poly: readonly P2[]): boolean {
  const n = poly.length;
  const orient = (a: P2, b: P2, c: P2) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours through the closing edge
      const c = poly[j];
      const d = poly[(j + 1) % n];
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) return true;
    }
  }
  return false;
}
/** Signed turning angle at every vertex (positive = left turn). */
function turns(poly: readonly P2[]): number[] {
  const n = poly.length;
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n];
    const b = poly[(i + 1) % n];
    const u = [p[0] - a[0], p[1] - a[1]];
    const v = [b[0] - p[0], b[1] - p[1]];
    return Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
  });
}

describe('parametric sticker outlines', () => {
  const star = starSticker();
  const gear = gearSticker();

  it('rebuild exactly what the photo fitter fitted', () => {
    expect(hausdorff(star, REF.star) / MM).toBeLessThan(0.02);
    expect(hausdorff(gear, REF.gear) / MM).toBeLessThan(0.02);
  });

  it('are simple counterclockwise polygons', () => {
    for (const poly of [star, gear]) {
      expect(signedArea(poly)).toBeGreaterThan(0);
      expect(selfIntersects(poly)).toBe(false);
    }
  });

  it('are mirror-symmetric (star about x = y, gear about x = 0)', () => {
    expect(hausdorff(star, star.map(([x, y]): P2 => [y, x])) / MM).toBeLessThan(1e-6);
    expect(hausdorff(gear, gear.map(([x, y]): P2 => [-x, y])) / MM).toBeLessThan(1e-6);
  });

  it('the star is smooth: no concave corners anywhere, sharp convex points only at its four tips', () => {
    const tol = ARC_STEP + 1e-6;
    const st = turns(star);
    expect(Math.min(...st)).toBeGreaterThan(-tol);
    expect(st.filter((t) => t > tol).length).toBe(4); // two inner tips, two fin tips
  });

  it('the traced gear is smooth: gentle turns at every point and no wobble', () => {
    const gt = turns(gear);
    // At most about 5° of turn between neighbouring points, even round the pointed tooth tips ...
    expect(Math.max(...gt.map(Math.abs))).toBeLessThan((8 * Math.PI) / 180);
    // ... and no wobble: the curvature changes sign only where the outline really bends the other way
    // (each tooth's leaf into its neck, on both sides, and into the notches between teeth), counting only
    // bends tighter than a 10 mm radius (gentler ones are straight to the eye).
    const n = gear.length;
    const seg = (i: number) => Math.hypot(gear[(i + 1) % n][0] - gear[i][0], gear[(i + 1) % n][1] - gear[i][1]);
    const kappa = gt.map((t, i) => t / ((seg(i) + seg((i - 1 + n) % n)) / 2) / (1 / MM)); // 1/mm
    const sign = kappa.filter((k) => Math.abs(k) > 0.1).map(Math.sign);
    const flips = sign.filter((s, i) => s !== sign[(i + 1) % sign.length]).length;
    expect(flips).toBeLessThanOrEqual(16);
    // Points no farther apart than 0.1 mm.
    const gaps = gear.map((p, i) => Math.hypot(p[0] - gear[(i + 1) % gear.length][0], p[1] - gear[(i + 1) % gear.length][1]));
    expect(Math.max(...gaps) / MM).toBeLessThan(0.1 + 1e-6);
  });

  it('the gear: two long teeth towards the edge, two short towards the centre, about its hub', () => {
    const reach = (pred: (p: P2) => boolean) => Math.max(...gear.filter(pred).map(([x, y]) => Math.hypot(x, y)));
    const long = reach(([, y]) => y < 0);
    const short = reach(([, y]) => y > 0);
    expect(long / short).toBeGreaterThan(1.1);
    expect(long / short).toBeLessThan(1.3);
    expect(long / MM).toBeGreaterThan(8.5);
    expect(long / MM).toBeLessThan(9.8);
    // The hub (the spin axis) is inside the gear, in the middle of the four teeth.
    expect(Math.min(...gear.map(([x, y]) => Math.hypot(x, y))) / MM).toBeGreaterThan(1);
  });
});
