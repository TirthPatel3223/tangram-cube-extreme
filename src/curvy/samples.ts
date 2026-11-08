import { type Vec3, dot } from '../puzzle/vec';
import { CORE_R, EDGE_TIP_DEPTH, EDGE_TIP_R } from './config';
import { APEX, COS_A, type Constraint, SIN_A, constraintValue, perpBasis } from './geometry';

/** Surface sample points of one piece shape (in its own frame), for legality and collision checks. */
export interface ShapeSamples {
  /** x,y,z triples. */
  readonly pts: Float64Array;
  readonly count: number;
  /** Bounding sphere of the samples. */
  readonly center: Vec3;
  readonly radius: number;
}

const ON = 1e-9;

/**
 * Sample the boundary of the solid described by `cons`.
 *
 * Each bounding surface (cone, cube face, core sphere, tip cylinder) is covered by a grid of
 * roughly `spacing` and only points that satisfy every other constraint are kept. The result hugs
 * the real surface, curved edges included, without needing a mesh.
 */
export function sampleShape(cons: readonly Constraint[], spacing: number): ShapeSamples {
  const out: number[] = [];
  const keep = (x: number, y: number, z: number, self: number) => {
    for (let k = 0; k < cons.length; k++) {
      if (k === self) continue;
      if (constraintValue(cons[k], x, y, z) > ON) return;
    }
    out.push(x, y, z);
  };

  cons.forEach((c, k) => {
    switch (c.kind) {
      case 'cone': {
        const a = c.axis;
        const [u, w] = perpBasis(a);
        const sMax = APEX + Math.sqrt(3) + 0.05;
        for (let s = spacing / 2; s <= sMax; s += spacing) {
          const r = s * SIN_A;
          const n = Math.max(8, Math.ceil((2 * Math.PI * r) / spacing));
          const phase = (s / spacing) * 0.618;
          for (let j = 0; j < n; j++) {
            const t = ((j + phase) / n) * 2 * Math.PI;
            const cu = Math.cos(t) * r;
            const cw = Math.sin(t) * r;
            const x = APEX * a[0] + s * COS_A * a[0] + cu * u[0] + cw * w[0];
            const y = APEX * a[1] + s * COS_A * a[1] + cu * u[1] + cw * w[1];
            const z = APEX * a[2] + s * COS_A * a[2] + cu * u[2] + cw * w[2];
            if (Math.abs(x) > 1 + ON || Math.abs(y) > 1 + ON || Math.abs(z) > 1 + ON) continue;
            keep(x, y, z, k);
          }
        }
        break;
      }
      case 'cube': {
        const n = Math.ceil(2 / spacing);
        for (let axis = 0; axis < 3; axis++) {
          for (const sgn of [1, -1]) {
            for (let i = 0; i < n; i++) {
              for (let j = 0; j < n; j++) {
                const p = -1 + ((i + 0.5) * 2) / n;
                const q = -1 + ((j + 0.5) * 2) / n;
                const v: [number, number, number] = [0, 0, 0];
                v[axis] = sgn;
                v[(axis + 1) % 3] = p;
                v[(axis + 2) % 3] = q;
                keep(v[0], v[1], v[2], k);
              }
            }
          }
        }
        break;
      }
      case 'core': {
        // Fibonacci sphere.
        const n = Math.ceil((4 * Math.PI * CORE_R * CORE_R) / (spacing * spacing));
        const golden = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < n; i++) {
          const y = 1 - (2 * (i + 0.5)) / n;
          const rr = Math.sqrt(1 - y * y);
          const t = golden * i;
          keep(CORE_R * Math.cos(t) * rr, CORE_R * y, CORE_R * Math.sin(t) * rr, k);
        }
        break;
      }
      case 'tip': {
        const f = c.face;
        const [u, w] = perpBasis(f);
        // Cylinder wall: rho = EDGE_TIP_R, from EDGE_TIP_DEPTH to the face.
        const n = Math.max(12, Math.ceil((2 * Math.PI * EDGE_TIP_R) / spacing));
        for (let h = EDGE_TIP_DEPTH + spacing / 2; h <= 1; h += spacing) {
          for (let j = 0; j < n; j++) {
            const t = (j / n) * 2 * Math.PI;
            const cu = Math.cos(t) * EDGE_TIP_R;
            const cw = Math.sin(t) * EDGE_TIP_R;
            keep(h * f[0] + cu * u[0] + cw * w[0], h * f[1] + cu * u[1] + cw * w[1], h * f[2] + cu * u[2] + cw * w[2], k);
          }
        }
        // Bottom disc at EDGE_TIP_DEPTH.
        for (let r = spacing / 2; r < EDGE_TIP_R; r += spacing) {
          const m = Math.max(6, Math.ceil((2 * Math.PI * r) / spacing));
          for (let j = 0; j < m; j++) {
            const t = (j / m) * 2 * Math.PI;
            const cu = Math.cos(t) * r;
            const cw = Math.sin(t) * r;
            const h = EDGE_TIP_DEPTH;
            keep(h * f[0] + cu * u[0] + cw * w[0], h * f[1] + cu * u[1] + cw * w[1], h * f[2] + cu * u[2] + cw * w[2], k);
          }
        }
        break;
      }
    }
  });

  const pts = Float64Array.from(out);
  const count = pts.length / 3;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    cx += pts[3 * i];
    cy += pts[3 * i + 1];
    cz += pts[3 * i + 2];
  }
  const center: Vec3 = count ? [cx / count, cy / count, cz / count] : [0, 0, 0];
  let radius = 0;
  for (let i = 0; i < count; i++) {
    const dx = pts[3 * i] - center[0];
    const dy = pts[3 * i + 1] - center[1];
    const dz = pts[3 * i + 2] - center[2];
    radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  return { pts, count, center, radius };
}

/** Centroid direction helper used to name slots: the mean sample point. */
export function sampleCentroid(s: ShapeSamples): Vec3 {
  return s.center;
}

/** Signed distance of a sample cloud's farthest point along a direction (for tests/debug). */
export function extent(s: ShapeSamples, dir: Vec3): number {
  let best = -Infinity;
  for (let i = 0; i < s.count; i++) {
    best = Math.max(best, dot([s.pts[3 * i], s.pts[3 * i + 1], s.pts[3 * i + 2]], dir));
  }
  return best;
}
