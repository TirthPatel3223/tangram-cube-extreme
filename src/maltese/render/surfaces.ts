import type { Mat3, Vec3 } from '../../puzzle/vec';
import type { Surface } from '../../render/fillet';

/**
 * Exact bounding surfaces of the Maltese pieces, for the rolling-ball rounding (src/render/fillet.ts):
 * planes, the core sphere, the see-through rod, and the walls of a body built over a 2D outline, either
 * coned to the cube centre (`radialWall`) or straight (`prismWall`).
 *
 * The walls take their distance from the nearest point of the outline: for a cone from the centre over
 * an outline drawn in the plane z = 1 of a frame, the wall's tangent plane along the ruling through that
 * point contains the centre, so g(p) is the distance to that plane (exact on the ruling, first order
 * next to it: plenty for fillets of a few tenths of a millimetre on curves of a millimetre or more).
 */

export interface SurfaceOpts {
  readonly kind: string;
  readonly outer: boolean;
  readonly group: number;
}

type P = readonly [number, number];

/** Map local frame coordinates to the model frame (columns of m are the frame's axes) and back. */
const toModel = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
const toLocal = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

/** The half-space n·p <= d (n a unit vector). */
export function planeSurface(n: Vec3, d: number, o: SurfaceOpts): Surface {
  return { ...o, g: (p) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d, n: () => n };
}

/** Outside the ball of radius R about the centre (a piece resting on the core). */
export function outsideSphere(R: number, o: SurfaceOpts): Surface {
  return {
    ...o,
    g: (p) => R - Math.hypot(p[0], p[1], p[2]),
    n: (p) => {
      const l = Math.hypot(p[0], p[1], p[2]) || 1;
      return [-p[0] / l, -p[1] / l, -p[2] / l];
    },
  };
}

/** Inside the ball of radius R (the core itself). */
export function insideSphere(R: number, o: SurfaceOpts): Surface {
  return {
    ...o,
    g: (p) => Math.hypot(p[0], p[1], p[2]) - R,
    n: (p) => {
      const l = Math.hypot(p[0], p[1], p[2]) || 1;
      return [p[0] / l, p[1] / l, p[2] / l];
    },
  };
}

/** Outside the cylinder of radius r around the line through the centre along the unit vector a. */
export function outsideRod(a: Vec3, r: number, o: SurfaceOpts): Surface {
  const radial = (p: Vec3): Vec3 => {
    const t = a[0] * p[0] + a[1] * p[1] + a[2] * p[2];
    return [p[0] - a[0] * t, p[1] - a[1] * t, p[2] - a[2] * t];
  };
  return {
    ...o,
    g: (p) => r - Math.hypot(...radial(p)),
    n: (p) => {
      const q = radial(p);
      const l = Math.hypot(...q) || 1;
      return [-q[0] / l, -q[1] / l, -q[2] / l];
    },
  };
}

interface Seg {
  readonly a: P;
  readonly b: P;
  /** Outward unit normal (outer rings counterclockwise, holes clockwise: material on the left). */
  readonly m: P;
  /** Pseudo-normals at the two ends (average with the neighbouring segment's normal). */
  readonly ma: P;
  readonly mb: P;
}

export interface Nearest {
  /** Nearest outline point. */
  readonly q: P;
  /** Signed distance (positive outside) and the outward direction of the distance gradient. */
  readonly d: number;
  readonly m: P;
}

/**
 * The boundary of a 2D region (manifold-3d polygons: outer rings counterclockwise, holes clockwise),
 * with a bucket grid for nearest-point queries. `skip` drops segments that are not walls (e.g. the
 * seams where a corner's three face regions meet).
 */
export class Outline {
  private readonly segs: Seg[] = [];
  private readonly grid = new Map<number, number[]>();
  private readonly cell: number;
  private readonly x0: number;
  private readonly y0: number;

  constructor(polys: readonly (readonly P[])[], skip: (a: P, b: P) => boolean = () => false, cell = 0.02) {
    this.cell = cell;
    let x0 = Infinity;
    let y0 = Infinity;
    for (const raw of polys) {
      // No zero-length segments (their direction is undefined).
      const poly = raw.filter((p, i) => {
        const q = raw[(i + 1) % raw.length];
        return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9;
      });
      const n = poly.length;
      const normals: P[] = [];
      for (let i = 0; i < n; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        normals.push([(b[1] - a[1]) / l, -(b[0] - a[0]) / l]);
      }
      const avg = (u: P, v: P): P => {
        const s: P = [u[0] + v[0], u[1] + v[1]];
        const l = Math.hypot(s[0], s[1]) || 1;
        return [s[0] / l, s[1] / l];
      };
      for (let i = 0; i < n; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        if (skip(a, b)) continue;
        this.segs.push({ a, b, m: normals[i], ma: avg(normals[(i - 1 + n) % n], normals[i]), mb: avg(normals[i], normals[(i + 1) % n]) });
        x0 = Math.min(x0, a[0], b[0]);
        y0 = Math.min(y0, a[1], b[1]);
      }
    }
    this.x0 = x0 - 2 * cell;
    this.y0 = y0 - 2 * cell;
    this.segs.forEach((s, i) => {
      const [i0, j0] = this.ij(Math.min(s.a[0], s.b[0]) - cell, Math.min(s.a[1], s.b[1]) - cell);
      const [i1, j1] = this.ij(Math.max(s.a[0], s.b[0]) + cell, Math.max(s.a[1], s.b[1]) + cell);
      for (let ii = i0; ii <= i1; ii++) {
        for (let jj = j0; jj <= j1; jj++) {
          const k = this.key(ii, jj);
          let l = this.grid.get(k);
          if (!l) this.grid.set(k, (l = []));
          l.push(i);
        }
      }
    });
  }

  private ij(x: number, y: number): [number, number] {
    return [Math.floor((x - this.x0) / this.cell), Math.floor((y - this.y0) / this.cell)];
  }

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  nearest(q: P): Nearest {
    const [i, j] = this.ij(q[0], q[1]);
    // Rings of cells around q: once the best distance is within the ring's reach, nothing farther
    // can beat it (every segment is filed in every cell within one cell of it).
    let best: Nearest | null = null;
    const seen = new Set<number>();
    for (let ring = 0; ring <= 24; ring++) {
      const idx: number[] = [];
      for (let ii = i - ring; ii <= i + ring; ii++) {
        for (let jj = j - ring; jj <= j + ring; jj++) {
          if (Math.max(Math.abs(ii - i), Math.abs(jj - j)) !== ring) continue;
          for (const k of this.grid.get(this.key(ii, jj)) ?? []) {
            if (!seen.has(k)) {
              seen.add(k);
              idx.push(k);
            }
          }
        }
      }
      if (idx.length) {
        const b = this.scan(q, idx);
        if (b && (!best || Math.abs(b.d) < Math.abs(best.d))) best = b;
      }
      if (best && Math.abs(best.d) <= ring * this.cell) return best;
    }
    return best ?? this.scan(q, null)!; // very far away: check everything
  }

  private scan(q: P, idx: readonly number[] | null): Nearest | null {
    let bestD2 = Infinity;
    let out: Nearest | null = null;
    const n = idx ? idx.length : this.segs.length;
    for (let k = 0; k < n; k++) {
      const s = this.segs[idx ? idx[k] : k];
      const dx = s.b[0] - s.a[0];
      const dy = s.b[1] - s.a[1];
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((q[0] - s.a[0]) * dx + (q[1] - s.a[1]) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = s.a[0] + t * dx;
      const py = s.a[1] + t * dy;
      const d2 = (q[0] - px) ** 2 + (q[1] - py) ** 2;
      if (d2 >= bestD2) continue;
      bestD2 = d2;
      const pseudo = t <= 0 ? s.ma : t >= 1 ? s.mb : s.m;
      const ex = q[0] - px;
      const ey = q[1] - py;
      const dist = Math.sqrt(d2);
      const sign = ex * pseudo[0] + ey * pseudo[1] >= 0 ? 1 : -1;
      // Beside a segment the gradient is exactly its normal. Only beside a vertex is it the direction to
      // the point, and only once that is measurable: for points on the outline (as after a Newton
      // projection) that direction is rounding noise.
      let m: P;
      if (t > 0 && t < 1) m = s.m;
      else if (dist > 1e-7) m = [(sign * ex) / dist, (sign * ey) / dist];
      else m = pseudo;
      out = { q: [px, py], d: sign * dist, m };
    }
    return out;
  }
}

/** Remember the last evaluation (g and n are nearly always asked for together at the same point). */
function memo<T>(f: (p: Vec3) => T): (p: Vec3) => T {
  let lp: Vec3 | null = null;
  let lv!: T;
  return (p) => {
    if (lp && lp[0] === p[0] && lp[1] === p[1] && lp[2] === p[2]) return lv;
    lp = p;
    lv = f(p);
    return lv;
  };
}

/**
 * The wall of the cone from the cube centre over a 2D region drawn in the plane z = 1 of `frame`
 * (the region's cross-section at height z is the region scaled by z).
 */
export function radialWall(frame: Mat3, outline: Outline, o: SurfaceOpts): Surface {
  // Points on one ruling share their nearest outline point (mesh vertices stacked up a wall do).
  const byRay = new Map<string, Vec3>();
  const ev = memo((p: Vec3): { g: number; n: Vec3 } => {
    const l = toLocal(frame, p);
    if (l[2] <= 1e-9) return { g: 1, n: toModel(frame, [0, 0, -1]) };
    const q: P = [l[0] / l[2], l[1] / l[2]];
    const key = `${Math.round(q[0] * 1e9)},${Math.round(q[1] * 1e9)}`;
    let nl = byRay.get(key);
    if (!nl) {
      const near = outline.nearest(q);
      // Tangent plane through the centre along the ruling: normal (m, -m·q*).
      const N: Vec3 = [near.m[0], near.m[1], -(near.m[0] * near.q[0] + near.m[1] * near.q[1])];
      const len = Math.hypot(N[0], N[1], N[2]);
      nl = [N[0] / len, N[1] / len, N[2] / len];
      if (byRay.size < 200000) byRay.set(key, nl);
    }
    return { g: nl[0] * l[0] + nl[1] * l[1] + nl[2] * l[2], n: toModel(frame, nl) };
  });
  return { ...o, g: (p) => ev(p).g, n: (p) => ev(p).n };
}

/** The wall of a prism along the frame's z over a 2D region drawn in the frame's xy plane. */
export function prismWall(frame: Mat3, outline: Outline, o: SurfaceOpts): Surface {
  const ev = memo((p: Vec3): { g: number; n: Vec3 } => {
    const l = toLocal(frame, p);
    const near = outline.nearest([l[0], l[1]]);
    return { g: near.d, n: toModel(frame, [near.m[0], near.m[1], 0]) };
  });
  return { ...o, g: (p) => ev(p).g, n: (p) => ev(p).n };
}
