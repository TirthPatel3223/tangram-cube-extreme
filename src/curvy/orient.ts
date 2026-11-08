import { IDENTITY3, type Mat3, type Vec3, cross, dot, mat3Mul } from '../puzzle/vec';

/**
 * Piece orientations as interned ids.
 *
 * A jumbling puzzle has no finite rotation group, so the Tangram's closed group won't do. But every
 * reachable orientation is a rational matrix: a jumble turn of arccos(1/3) about an edge axis has
 * entries k/3. So orientations are interned. A product that lands within 1e-9 of a known matrix
 * reuses that matrix exactly. Long sessions therefore never drift, and states compare by id.
 */
export class OrientationTable {
  private readonly mats: Mat3[] = [IDENTITY3];
  private readonly keys = new Map<string, number>([[OrientationTable.key(IDENTITY3), 0]]);
  private readonly products = new Map<string, number>();

  static readonly IDENTITY = 0;

  private static key(m: Mat3): string {
    let s = '';
    for (let i = 0; i < 9; i++) s += Math.round(m[i] * 1e6) + ',';
    return s;
  }

  get size(): number {
    return this.mats.length;
  }

  get(id: number): Mat3 {
    return this.mats[id];
  }

  /** Id of a rotation matrix, adding it if new. */
  intern(m: Mat3): number {
    const k = OrientationTable.key(m);
    const hit = this.keys.get(k);
    if (hit !== undefined) return hit;
    // Rounding boundaries: fall back to an approximate scan before adding a new element.
    for (let i = 0; i < this.mats.length; i++) {
      const e = this.mats[i];
      let same = true;
      for (let j = 0; j < 9 && same; j++) if (Math.abs(e[j] - m[j]) > 1e-9) same = false;
      if (same) {
        this.keys.set(k, i);
        return i;
      }
    }
    this.mats.push(m);
    this.keys.set(k, this.mats.length - 1);
    return this.mats.length - 1;
  }

  /** Id of mats[a] · mats[b]. */
  mul(a: number, b: number): number {
    const k = `${a},${b}`;
    const hit = this.products.get(k);
    if (hit !== undefined) return hit;
    const id = this.intern(mat3Mul(this.mats[a], this.mats[b]));
    this.products.set(k, id);
    return id;
  }
}

const S8 = (2 * Math.SQRT2) / 3; // sin(arccos(1/3))

/**
 * Cosine and sine of a turn angle, exact for the puzzle's special angles (half turns and the two
 * jumble angles), so their matrices come out exactly rational.
 */
export function cosSin(angle: number): [number, number] {
  const a = Math.abs(angle);
  const sign = angle < 0 ? -1 : 1;
  const near = (x: number) => Math.abs(a - x) < 1e-12;
  if (near(Math.PI)) return [-1, 0];
  if (near(Math.acos(1 / 3))) return [1 / 3, sign * S8];
  if (near(Math.PI - Math.acos(1 / 3))) return [-1 / 3, sign * S8];
  if (near(0)) return [1, 0];
  return [Math.cos(angle), Math.sin(angle)];
}

/** Right-handed rotation about the unit axis a with the given cosine and sine (Rodrigues). */
export function rotation(a: Vec3, c: number, s: number): Mat3 {
  const [x, y, z] = a;
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

export function rotationByAngle(a: Vec3, angle: number): Mat3 {
  const [c, s] = cosSin(angle);
  return rotation(a, c, s);
}

/**
 * The turn about unit axis a that carries direction `from` onto direction `to`, which must make
 * the same angle with a. Cosine and sine come straight from the vectors, so the result is as exact
 * as the inputs. Returns null when `from` lies on the axis.
 */
export function aligningTurn(a: Vec3, from: Vec3, to: Vec3): { angle: number; c: number; s: number } | null {
  const fa = dot(from, a);
  const ta = dot(to, a);
  const fp: Vec3 = [from[0] - fa * a[0], from[1] - fa * a[1], from[2] - fa * a[2]];
  const tp: Vec3 = [to[0] - ta * a[0], to[1] - ta * a[1], to[2] - ta * a[2]];
  const n2 = dot(fp, fp);
  if (n2 < 1e-12) return null;
  const c = dot(fp, tp) / n2;
  const s = dot(a, cross(fp, tp)) / n2;
  return { angle: Math.atan2(s, c), c, s };
}
