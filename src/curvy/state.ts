import { type Mat3, type Vec3, dot, mat3Mul, mat3Transpose, mat3Vec } from '../puzzle/vec';
import { EXACT_TOL, OVERLAP_TOL, SWEEP_STEP_DEG } from './config';
import { APEX, COS_A, EDGES, EDGE_AXIS, type EdgeName, FACE_NORMAL, type CubeFace, SIN_A, faceOf, pieceValue } from './geometry';
import { OrientationTable, aligningTurn, rotation } from './orient';
import type { CurvyModel } from './pieces';

/** An exact turn: edge, signed angle (right-handed about the edge's outward axis) and its cos/sin. */
export interface Turn {
  readonly edge: EdgeName;
  readonly angle: number;
  readonly c: number;
  readonly s: number;
}

export interface TurnCheck {
  readonly ok: boolean;
  /** Pieces that turn with the edge. */
  readonly moving: readonly number[];
  /** Pieces in the way (only when blocked). */
  readonly blockers: readonly number[];
}

/** A jumble stop: an angle where this edge's turning part lines up with another edge's cut. */
export interface Stop extends Turn {
  /** Edges whose cut the turning part is aligned with at this angle. */
  readonly unlocks: readonly EdgeName[];
}

/** Partition of the pieces by an edge's cut cone. */
interface Partition {
  readonly moving: number[];
  readonly stationary: number[];
  /** Straddlers riding with the turn whose outside part reaches more than OVERLAP_TOL beyond the cut. */
  readonly deepMoving: number[];
  /** Straddlers staying put whose inside part reaches more than OVERLAP_TOL into the turning part. */
  readonly deepStationary: number[];
}

/** Angle offset used to tell an isolated alignment (a stop) from a cut that is always clear. */
const STOP_PROBE = 0.004;
const TWO_PI = 2 * Math.PI;

/**
 * State of a Curvy Copter: one interned orientation per piece. All turns are about axes through
 * the centre, so a piece's orientation fixes where it is; the piece's world transform is
 * orientation · home.
 *
 * Legality follows the physical puzzle:
 *   1. A turn is free when no piece crosses the edge's cut cone (the normal case: cuts aligned).
 *   2. Otherwise each crossing piece is assigned to a side (edge pieces stay anchored to their own
 *      axis, other pieces go with the side holding most of them), and the turn is swept in small
 *      steps: if any piece would push more than OVERLAP_TOL into another, the turn is blocked.
 *      So overhangs into empty space don't block, but real collisions do (bandaging).
 */
export class CurvyState {
  readonly orient: Int32Array;
  private readonly mats: Array<Mat3 | null>;

  constructor(
    readonly model: CurvyModel,
    orient?: Int32Array,
  ) {
    this.orient = orient ?? new Int32Array(model.pieces.length).fill(OrientationTable.IDENTITY);
    this.mats = new Array(model.pieces.length).fill(null);
  }

  static solved(model: CurvyModel): CurvyState {
    return new CurvyState(model);
  }

  clone(): CurvyState {
    return new CurvyState(this.model, this.orient.slice());
  }

  equals(other: CurvyState): boolean {
    return this.orient.every((g, i) => g === other.orient[i]);
  }

  /** Every piece back home in its home orientation (identity-solved). */
  isHome(): boolean {
    return this.orient.every((g) => g === OrientationTable.IDENTITY);
  }

  /** World transform of a piece (orientation · home). */
  matrix(i: number): Mat3 {
    let m = this.mats[i];
    if (!m) {
      m = mat3Mul(this.model.table.get(this.orient[i]), this.model.pieces[i].home);
      this.mats[i] = m;
    }
    return m;
  }

  private shapeOf(i: number) {
    return this.model.shapes[this.model.pieces[i].shape];
  }

  /** Bounding-sphere centre of a piece in the world, optionally after an extra rotation. */
  private worldCenter(i: number, extra: Mat3 | null): Vec3 {
    const c = mat3Vec(this.matrix(i), this.shapeOf(i).samples.center);
    return extra ? mat3Vec(extra, c) : c;
  }

  /**
   * Min and max of the cone signed distance over a piece's samples (negative = inside the cut).
   * The axis is moved into the piece's own frame instead of moving thousands of points.
   * `bail` returns early once both signs beyond `tol` are seen.
   */
  private coneRange(i: number, a: Vec3, extra: Mat3 | null, tol: number, bail: boolean): [number, number, number] {
    const shape = this.shapeOf(i);
    const s = shape.samples;
    const m = extra ? mat3Mul(extra, this.matrix(i)) : this.matrix(i);
    // Bounding sphere prefilter: the signed distance is 1-Lipschitz.
    const cw = mat3Vec(m, s.center);
    const cv = coneSdVec(cw, a);
    if (cv > s.radius + tol) return [cv - s.radius, cv + s.radius, 0];
    if (cv < -s.radius - tol) return [cv - s.radius, cv + s.radius, s.count];
    const la = mat3Vec(mat3Transpose(m), a); // axis in the piece's frame
    const ax = la[0];
    const ay = la[1];
    const az = la[2];
    const px = APEX * ax;
    const py = APEX * ay;
    const pz = APEX * az;
    const pts = s.pts;
    let lo = Infinity;
    let hi = -Infinity;
    let inside = 0;
    for (let k = 0; k < s.count; k++) {
      const dx = pts[3 * k] - px;
      const dy = pts[3 * k + 1] - py;
      const dz = pts[3 * k + 2] - pz;
      const along = dx * ax + dy * ay + dz * az;
      const perp = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
      const v = perp * COS_A - along * SIN_A;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      if (v < 0) inside++;
      if (bail && lo < -tol && hi > tol) return [lo, hi, inside];
    }
    return [lo, hi, inside];
  }

  /** Split the pieces by an edge's cut (without sweeping). */
  private partition(edge: EdgeName): Partition {
    const a = EDGE_AXIS[edge];
    const moving: number[] = [];
    const stationary: number[] = [];
    const deepMoving: number[] = [];
    const deepStationary: number[] = [];
    for (let i = 0; i < this.model.pieces.length; i++) {
      const [lo, hi, inside] = this.coneRange(i, a, null, EXACT_TOL, false);
      if (hi <= EXACT_TOL) {
        moving.push(i);
      } else if (lo >= -EXACT_TOL) {
        stationary.push(i);
      } else {
        // Straddler. Edge pieces are screwed to the core on their own axis and never ride along.
        const piece = this.model.pieces[i];
        const anchored = piece.kind === 'edge' && piece.slot !== edge;
        const rides = !anchored && inside > this.shapeOf(i).samples.count / 2;
        if (rides) {
          moving.push(i);
          if (hi > OVERLAP_TOL) deepMoving.push(i);
        } else {
          stationary.push(i);
          if (-lo > OVERLAP_TOL) deepStationary.push(i);
        }
      }
    }
    return { moving, stationary, deepMoving, deepStationary };
  }

  /** Pieces that turn with an edge (the highlight set), legal or not. */
  movingPieces(edge: EdgeName): number[] {
    return this.partition(edge).moving;
  }

  /** Can the edge turn by `angle` (radians, signed), sweeping the whole path? */
  turnCheck(edge: EdgeName, angle: number): TurnCheck {
    return this.checkPartition(edge, angle, this.partition(edge));
  }

  private checkPartition(edge: EdgeName, angle: number, part: Partition): TurnCheck {
    if (!part.deepMoving.length && !part.deepStationary.length) return { ok: true, moving: part.moving, blockers: [] };
    const blockers = this.sweep(EDGE_AXIS[edge], angle, part);
    return { ok: blockers.length === 0, moving: part.moving, blockers };
  }

  /** Strict test used by the tests: does any piece cross the edge's cut at all? */
  straddlers(edge: EdgeName): number[] {
    const a = EDGE_AXIS[edge];
    const out: number[] = [];
    for (let i = 0; i < this.model.pieces.length; i++) {
      const [lo, hi] = this.coneRange(i, a, null, EXACT_TOL, true);
      if (lo < -EXACT_TOL && hi > EXACT_TOL) out.push(i);
    }
    return out;
  }

  /**
   * Swept collision test. Rotating the moving part in SWEEP_STEP_DEG steps:
   *  - points of stationary straddlers inside the cut must not end up inside a moving piece;
   *  - points of moving straddlers outside the cut must not end up inside a stationary piece.
   * "Inside" means deeper than OVERLAP_TOL. Returns the straddlers that collide.
   */
  private sweep(a: Vec3, angle: number, part: Partition): number[] {
    const steps = Math.max(1, Math.ceil(Math.abs(angle) / ((SWEEP_STEP_DEG * Math.PI) / 180)));
    const hits = new Set<number>();
    const pointsOf = (i: number, wantInside: boolean): Float64Array => {
      const m = this.matrix(i);
      const s = this.shapeOf(i).samples;
      const out: number[] = [];
      for (let k = 0; k < s.count; k++) {
        const p = mat3Vec(m, [s.pts[3 * k], s.pts[3 * k + 1], s.pts[3 * k + 2]]);
        const v = coneSdVec(p, a);
        if (wantInside ? v < -OVERLAP_TOL : v > OVERLAP_TOL) out.push(p[0], p[1], p[2]);
      }
      return Float64Array.from(out);
    };
    const sphere = (pts: Float64Array): [Vec3, number] => {
      const n = pts.length / 3;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let k = 0; k < n; k++) {
        cx += pts[3 * k];
        cy += pts[3 * k + 1];
        cz += pts[3 * k + 2];
      }
      const c: Vec3 = [cx / n, cy / n, cz / n];
      let r = 0;
      for (let k = 0; k < n; k++) {
        r = Math.max(r, Math.hypot(pts[3 * k] - c[0], pts[3 * k + 1] - c[1], pts[3 * k + 2] - c[2]));
      }
      return [c, r];
    };
    const hitsPiece = (pts: Float64Array, toLocal: Mat3, j: number): boolean => {
      const cons = this.shapeOf(j).constraints;
      for (let k = 0; k < pts.length; k += 3) {
        const x = toLocal[0] * pts[k] + toLocal[1] * pts[k + 1] + toLocal[2] * pts[k + 2];
        const y = toLocal[3] * pts[k] + toLocal[4] * pts[k + 1] + toLocal[5] * pts[k + 2];
        const z = toLocal[6] * pts[k] + toLocal[7] * pts[k + 1] + toLocal[8] * pts[k + 2];
        if (pieceValue(cons, x, y, z) < -OVERLAP_TOL) return true;
      }
      return false;
    };
    // Stationary straddlers poking into the turning part, against the rotating moving pieces.
    for (const s of part.deepStationary) {
      const pts = pointsOf(s, true);
      if (!pts.length) continue;
      const [pc, pr] = sphere(pts);
      outer: for (let k = 1; k <= steps; k++) {
        const t = (angle * k) / steps;
        const q = rotation(a, Math.cos(t), Math.sin(t));
        for (const j of part.moving) {
          const jc = this.worldCenter(j, q);
          if (Math.hypot(jc[0] - pc[0], jc[1] - pc[1], jc[2] - pc[2]) > pr + this.shapeOf(j).samples.radius) continue;
          // world -> piece j's frame after the rotation: (q · M_j)^T
          if (hitsPiece(pts, mat3Transpose(mat3Mul(q, this.matrix(j))), j)) {
            hits.add(s);
            break outer;
          }
        }
      }
    }
    // Moving straddlers sticking out of the turning part, against the stationary pieces.
    for (const m of part.deepMoving) {
      const pts0 = pointsOf(m, false);
      if (!pts0.length) continue;
      const [pc0, pr] = sphere(pts0);
      outer: for (let k = 1; k <= steps; k++) {
        const t = (angle * k) / steps;
        const q = rotation(a, Math.cos(t), Math.sin(t));
        const pc = mat3Vec(q, pc0);
        for (const j of part.stationary) {
          const jc = this.worldCenter(j, null);
          if (Math.hypot(jc[0] - pc[0], jc[1] - pc[1], jc[2] - pc[2]) > pr + this.shapeOf(j).samples.radius) continue;
          // rotated point q·p into j's frame: M_j^T · q
          if (hitsPiece(pts0, mat3Mul(mat3Transpose(this.matrix(j)), q), j)) {
            hits.add(m);
            break outer;
          }
        }
      }
    }
    return [...hits];
  }

  /**
   * Is the turning part of an edge (rotated by `rot`) clear of another edge's cut? Only the pieces
   * that turn are checked: the rest don't move, so they can't make a stop appear or disappear.
   */
  private movingClearOf(moving: readonly number[], rot: Mat3, c: Vec3): boolean {
    for (const i of moving) {
      const [lo, hi] = this.coneRange(i, c, rot, EXACT_TOL, true);
      if (lo < -EXACT_TOL && hi > EXACT_TOL) return false;
    }
    return true;
  }

  /**
   * Jumble stops of an edge turned in a direction (+1 = clockwise seen from outside the edge,
   * i.e. negative angles; -1 = anticlockwise), nearest first, up to `limit`. A stop is an angle where
   * the turning part lines up exactly with another edge's cut that it crosses just before and after.
   * Stops beyond a blocked part of the path are not returned.
   */
  stops(edge: EdgeName, dir: 1 | -1, limit = 6): Stop[] {
    const a = EDGE_AXIS[edge];
    const part = this.partition(edge);
    type Cand = { angle: number; c: number; s: number; edges: Set<EdgeName> };
    const cands: Cand[] = [];
    for (const i of part.moving) {
      const m = this.matrix(i);
      for (const local of this.shapeOf(i).coneAxes) {
        const d = mat3Vec(m, local);
        const da = dot(d, a);
        if (Math.abs(Math.abs(da) - 1) < 1e-9) continue;
        for (const e of EDGES) {
          if (e === edge) continue;
          const ce = EDGE_AXIS[e];
          if (Math.abs(dot(ce, a) - da) > 1e-9) continue;
          const t = aligningTurn(a, d, ce);
          if (!t) continue;
          let ang = t.angle;
          if (dir > 0) ang = ang < -1e-9 ? ang : ang - TWO_PI;
          else ang = ang > 1e-9 ? ang : ang + TWO_PI;
          if (Math.abs(ang) >= TWO_PI - 1e-9) continue;
          const hit = cands.find((x) => Math.abs(x.angle - ang) < 1e-9);
          if (hit) hit.edges.add(e);
          else cands.push({ angle: ang, c: t.c, s: t.s, edges: new Set([e]) });
        }
      }
    }
    cands.sort((p, q) => Math.abs(p.angle) - Math.abs(q.angle));
    const out: Stop[] = [];
    for (const cand of cands) {
      const rot = rotation(a, cand.c, cand.s);
      // Just short of the stop and just past it (clockwise turns have negative angles).
      const short = cand.angle + dir * STOP_PROBE;
      const past = cand.angle - dir * STOP_PROBE;
      const before = rotation(a, Math.cos(short), Math.sin(short));
      const after = rotation(a, Math.cos(past), Math.sin(past));
      const unlocks: EdgeName[] = [];
      for (const e of cand.edges) {
        const c = EDGE_AXIS[e];
        if (!this.movingClearOf(part.moving, rot, c)) continue;
        if (this.movingClearOf(part.moving, before, c) && this.movingClearOf(part.moving, after, c)) continue;
        unlocks.push(e);
      }
      if (!unlocks.length) continue;
      if (!this.checkPartition(edge, cand.angle, part).ok) break;
      out.push({ edge, angle: cand.angle, c: cand.c, s: cand.s, unlocks: EDGES.filter((e) => unlocks.includes(e)) });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Apply a turn. Throws if it is blocked. Returns the pieces that moved. */
  apply(t: Turn, check = true): number[] {
    let moving: readonly number[];
    if (check) {
      const res = this.turnCheck(t.edge, t.angle);
      if (!res.ok) throw new Error(`turn ${t.edge} by ${((t.angle * 180) / Math.PI).toFixed(2)}° is blocked`);
      moving = res.moving;
    } else {
      moving = this.partition(t.edge).moving;
    }
    const table = this.model.table;
    const q = table.intern(rotation(EDGE_AXIS[t.edge], t.c, t.s));
    for (const i of moving) {
      this.orient[i] = table.mul(q, this.orient[i]);
      this.mats[i] = null;
    }
    return [...moving];
  }

  /** World normal of each of a piece's stickers. */
  stickerNormals(i: number): Vec3[] {
    const m = this.matrix(i);
    return this.model.pieces[i].stickers.map((s) => mat3Vec(m, FACE_NORMAL[s.face]));
  }

  /**
   * The puzzle is a cube: every sticker lies flat on a cube face. (Corners may be twisted, a corner
   * is symmetric; a twisted triangle or flipped petal is not flat, so it fails.)
   */
  isCubeShape(): boolean {
    for (let i = 0; i < this.model.pieces.length; i++) {
      for (const n of this.stickerNormals(i)) if (!faceOf(n)) return false;
    }
    return true;
  }

  /** Pieces sticking out of the cube outline. */
  protruding(eps = 1e-6): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.model.pieces.length; i++) {
      const m = this.matrix(i);
      const s = this.shapeOf(i).samples;
      for (let k = 0; k < s.count; k++) {
        const x = s.pts[3 * k];
        const y = s.pts[3 * k + 1];
        const z = s.pts[3 * k + 2];
        const wx = m[0] * x + m[1] * y + m[2] * z;
        const wy = m[3] * x + m[4] * y + m[5] * z;
        const wz = m[6] * x + m[7] * y + m[8] * z;
        if (Math.abs(wx) > 1 + eps || Math.abs(wy) > 1 + eps || Math.abs(wz) > 1 + eps) {
          out.push(i);
          break;
        }
      }
    }
    return out;
  }

  /** Solved by colour: a cube with one colour per face (identical pieces may be swapped). */
  isColourSolved(): boolean {
    if (!this.isCubeShape()) return false;
    const faceColour = new Map<CubeFace, CubeFace>();
    for (let i = 0; i < this.model.pieces.length; i++) {
      const p = this.model.pieces[i];
      const normals = this.stickerNormals(i);
      for (let k = 0; k < p.stickers.length; k++) {
        const f = faceOf(normals[k])!;
        const prev = faceColour.get(f);
        if (prev && prev !== p.stickers[k].color) return false;
        faceColour.set(f, p.stickers[k].color);
      }
    }
    return true;
  }
}

function coneSdVec(p: Vec3, a: Vec3): number {
  const dx = p[0] - APEX * a[0];
  const dy = p[1] - APEX * a[1];
  const dz = p[2] - APEX * a[2];
  const along = dx * a[0] + dy * a[1] + dz * a[2];
  const perp = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
  return perp * COS_A - along * SIN_A;
}
