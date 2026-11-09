import type { CrossSection, Manifold, ManifoldToplevel, Mat4, Vec2 } from 'manifold-3d';
import { type Vec3, cross, normalize, scale } from '../../puzzle/vec';
import { CORE_R, EDGE_TIP_DEPTH, EDGE_TIP_R, LOOK, MM } from '../config';
import { APEX, type CubeFace, FACE_NORMAL, SIN_A, TAN_A, perpBasis } from '../geometry';
import type { Shape } from '../pieces';
import { type BodyData, type FilletOptions, type MeshData, bodyData, creaseRemovers, findCreases, meshData } from '../../render/fillet';
import { type ShapeSurfaces, shapeSurfaces } from './fillet';

/**
 * Meshes of the curved piece shapes, built with manifold-3d (robust mesh booleans in WebAssembly).
 *
 * Every cut is a right circular cone, i.e. a ruled surface, so a cone made of one ring of
 * `coneSegments` triangles is exact along its generators. Bodies are shrunk by half the piece gap
 * on every cut: an offset cone is the same cone with its apex slid along the axis by
 * offset / sin(half-angle).
 */

export type { BodyData, MeshData };

export interface StickerData extends MeshData {
  /** Face of the shape (own frame) the sticker is on. */
  readonly face: CubeFace;
}

export interface ShapeGeometry {
  readonly body: BodyData;
  /** The same body with sharp edges: far fewer triangles, used (invisibly) for picking. */
  readonly pick: MeshData;
  readonly stickers: readonly StickerData[];
  /** Volume of the exact (gap-free) shape, for tests. */
  readonly volume: number;
}

export interface CsgOptions {
  readonly gap: number;
  readonly stickerInset: number;
  readonly stickerRadius: number;
  readonly stickerLift: number;
  readonly dotRadius: number;
  readonly segments: number;
  /** Rounded edges; null keeps them sharp. */
  readonly fillet: FilletOptions | null;
}

export function defaultCsgOptions(): CsgOptions {
  return {
    gap: LOOK.gapMm * MM,
    stickerInset: LOOK.stickerInsetMm * MM,
    stickerRadius: LOOK.stickerRadiusMm * MM,
    stickerLift: LOOK.stickerLiftMm * MM,
    dotRadius: (LOOK.dotDiameterMm / 2) * MM,
    segments: LOOK.coneSegments,
    fillet: {
      outerRadius: LOOK.edgeRoundMm * MM,
      innerRadius: LOOK.cutRoundMm * MM,
      step: LOOK.filletStepMm * MM,
      arcStep: (LOOK.filletArcStepDeg * Math.PI) / 180,
    },
  };
}

/** Column-major 4x4 that maps +z to `axis` and the origin to `origin`. */
function frameTo(axis: Vec3, origin: Vec3): Mat4 {
  const [u, w] = perpBasis(axis);
  return [u[0], u[1], u[2], 0, w[0], w[1], w[2], 0, axis[0], axis[1], axis[2], 0, origin[0], origin[1], origin[2], 1];
}

/** Rotation (column-major 4x4) that maps the unit normal n to +z. */
function faceToTop(n: Vec3): { m: Mat4; inv: (p: Vec3) => Vec3 } {
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(ref, n));
  const w = cross(n, u);
  // Rows of the rotation are u, w, n (so p -> (u·p, w·p, n·p)); column-major storage.
  const m: Mat4 = [u[0], w[0], n[0], 0, u[1], w[1], n[1], 0, u[2], w[2], n[2], 0, 0, 0, 0, 1];
  const inv = (p: Vec3): Vec3 => [
    u[0] * p[0] + w[0] * p[1] + n[0] * p[2],
    u[1] * p[0] + w[1] * p[1] + n[1] * p[2],
    u[2] * p[0] + w[2] * p[1] + n[2] * p[2],
  ];
  return { m, inv };
}

/** Run `fn` with a list that deletes every WASM object pushed to it afterwards. */
function scoped<T>(fn: (keep: <M extends { delete(): void }>(m: M) => M) => T): T {
  const owned: Array<{ delete(): void }> = [];
  try {
    return fn((m) => {
      owned.push(m);
      return m;
    });
  } finally {
    for (const m of owned) m.delete();
  }
}

/** Records which input primitive (by manifold originalID) carries which analytic surfaces. */
interface Tracking {
  readonly surfaces: ShapeSurfaces;
  readonly prims: Map<number, readonly number[]>;
}

/**
 * The solid of a shape. `shrink` moves every cut surface into the piece by that distance (the
 * cube faces stay put), which leaves the gap between neighbouring pieces. With `track`, each
 * primitive is marked so the triangles of the result can be traced back to their surface.
 */
function shapeSolid(
  wasm: ManifoldToplevel,
  shape: Shape,
  shrink: number,
  segments: number,
  keep: <M extends { delete(): void }>(m: M) => M,
  track?: Tracking,
): Manifold {
  const { Manifold } = wasm;
  const L = 3.2; // cone length: reaches past every cube point from any apex
  const mark = (m: Manifold, constraint: number): Manifold => {
    if (!track || constraint < 0) return m;
    const o = keep(m.asOriginal());
    track.prims.set(o.originalID(), track.surfaces.byConstraint[constraint]);
    return o;
  };
  let solid = mark(
    keep(Manifold.cube([2, 2, 2], true)),
    shape.constraints.findIndex((c) => c.kind === 'cube'),
  );
  shape.constraints.forEach((c, i) => {
    switch (c.kind) {
      case 'cone': {
        const slide = shrink / SIN_A; // offset cone = same cone with the apex slid along the axis
        const apex = APEX + (c.inside ? slide : -slide);
        const cone = keep(Manifold.cylinder(L, 0, L * TAN_A, segments));
        const placed = mark(keep(cone.transform(frameTo(c.axis, [apex * c.axis[0], apex * c.axis[1], apex * c.axis[2]]))), i);
        solid = keep(c.inside ? solid.intersect(placed) : solid.subtract(placed));
        break;
      }
      case 'core': {
        solid = keep(solid.subtract(mark(keep(Manifold.sphere(CORE_R + shrink, 96)), i)));
        break;
      }
      case 'tip': {
        const r = EDGE_TIP_R + shrink;
        const h0 = EDGE_TIP_DEPTH - shrink;
        const cyl = keep(Manifold.cylinder(2, r, r, 64));
        const placed = mark(keep(cyl.transform(frameTo(c.face, [h0 * c.face[0], h0 * c.face[1], h0 * c.face[2]]))), i);
        solid = keep(solid.subtract(placed));
        break;
      }
      case 'cube':
        break;
    }
  });
  return solid;
}

/**
 * The plastic body: the shrunk solid with every crease rounded by a rolling ball (see fillet.ts),
 * plus the original-surface lookup needed for its normals.
 */
function roundedBody(
  wasm: ManifoldToplevel,
  shape: Shape,
  opts: CsgOptions,
  keep: <M extends { delete(): void }>(m: M) => M,
): { body: Manifold; sharp: Manifold; track: Tracking } {
  const track: Tracking = { surfaces: shapeSurfaces(shape.constraints, opts.gap / 2), prims: new Map() };
  const sharp = shapeSolid(wasm, shape, opts.gap / 2, opts.segments, keep, track);
  if (!opts.fillet) return { body: sharp, sharp, track };
  const { surfaces, byConstraint } = track.surfaces;
  // The tip cut is a union: its wall bounds the body only above the cap, and its cap only inside
  // the wall. Fillets on those surfaces are clipped to that region (a hair inside it).
  const { Manifold } = wasm;
  const clips = new Map<number, Manifold>();
  shape.constraints.forEach((c, i) => {
    if (c.kind !== 'tip') return;
    const [side, cap] = byConstraint[i];
    const r = EDGE_TIP_R + opts.gap / 2;
    const h0 = EDGE_TIP_DEPTH - opts.gap / 2;
    const at = (h: number): Vec3 => scale(c.face, h);
    clips.set(side, keep(keep(Manifold.cylinder(2, 2, 2, 16)).transform(frameTo(c.face, at(h0 + 1e-4)))));
    clips.set(cap, keep(keep(Manifold.cylinder(2, r - 1e-4, r - 1e-4, 64)).transform(frameTo(c.face, at(h0 - 1)))));
  });
  const removers = findCreases(sharp.getMesh(), surfaces, track.prims).flatMap((c) =>
    creaseRemovers(wasm, surfaces[c.a], surfaces[c.b], c.points, opts.fillet!).map((m) => {
      let out = keep(m);
      for (const s of [c.a, c.b]) {
        const clip = clips.get(s);
        if (clip) out = keep(out.intersect(clip));
      }
      return out;
    }),
  );
  if (!removers.length) return { body: sharp, sharp, track };
  return { body: keep(wasm.Manifold.difference([sharp, ...removers])), sharp, track };
}

/** Point inside a polygon set farthest from its boundary (where the Plus's dot goes). */
function poleOfInaccessibility(polys: Vec2[][]): Vec2 {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const inside = (x: number, y: number) => {
    let c = false;
    for (const poly of polys) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
    }
    return c;
  };
  const distToEdges = (x: number, y: number) => {
    let d = Infinity;
    for (const poly of polys) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [ax, ay] = poly[j];
        const [bx, by] = poly[i];
        const vx = bx - ax;
        const vy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
        d = Math.min(d, Math.hypot(x - ax - t * vx, y - ay - t * vy));
      }
    }
    return d;
  };
  let best: Vec2 = [(minX + maxX) / 2, (minY + maxY) / 2];
  let bestD = -Infinity;
  let step = Math.max(maxX - minX, maxY - minY) / 40;
  let cx = best[0];
  let cy = best[1];
  let span = Math.max(maxX - minX, maxY - minY) / 2;
  for (let pass = 0; pass < 3; pass++) {
    for (let x = cx - span; x <= cx + span; x += step) {
      for (let y = cy - span; y <= cy + span; y += step) {
        if (!inside(x, y)) continue;
        const d = distToEdges(x, y);
        if (d > bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    }
    [cx, cy] = best;
    span = step * 2;
    step /= 8;
  }
  return best;
}

/** Build the body and sticker meshes of one shape (in the shape's own frame). */
export function buildShapeGeometry(wasm: ManifoldToplevel, shape: Shape, opts: CsgOptions): ShapeGeometry {
  const { CrossSection } = wasm;
  return scoped((keep) => {
    const { body, sharp, track } = roundedBody(wasm, shape, opts, keep);
    const exact = shapeSolid(wasm, shape, 0, opts.segments, keep);
    const stickers: StickerData[] = [];
    for (const face of shape.stickerFaces) {
      const n = FACE_NORMAL[face];
      const { m, inv } = faceToTop(n);
      const top = keep(exact.transform(m));
      const section = keep(top.slice(1 - 1e-4));
      // Inset by margin + radius, then grow by the radius: rounded corners at a uniform margin.
      let sticker: CrossSection = keep(
        keep(section.offset(-(opts.stickerInset + opts.stickerRadius), 'Round', 2, 48)).offset(opts.stickerRadius, 'Round', 2, 48),
      );
      if (shape.kind === 'triangle' && opts.dotRadius > 0) {
        const pole = poleOfInaccessibility(sticker.toPolygons());
        const dot = keep(keep(CrossSection.circle(opts.dotRadius, 48)).translate(pole));
        sticker = keep(sticker.subtract(dot));
      }
      const polys = sticker.toPolygons();
      if (!polys.length) continue;
      const flat: Vec2[] = polys.flat();
      const tris = wasm.triangulate(polys, 1e-9);
      const positions = new Float32Array(flat.length * 3);
      flat.forEach((p, i) => {
        const q = inv([p[0], p[1], 1 + opts.stickerLift]);
        positions[3 * i] = q[0];
        positions[3 * i + 1] = q[1];
        positions[3 * i + 2] = q[2];
      });
      const indices = new Uint32Array(tris.length * 3);
      tris.forEach((t, i) => indices.set(t, 3 * i));
      stickers.push({ face, positions, indices });
    }
    return {
      body: bodyData(body.getMesh(), track.surfaces.surfaces, track.prims),
      pick: meshData(sharp.getMesh()),
      stickers,
      volume: exact.volume(),
    };
  });
}

/** Load manifold-3d. In the browser pass the URL of manifold.wasm; in Node it is found automatically. */
export async function loadManifold(wasmUrl?: string): Promise<ManifoldToplevel> {
  const { default: Module } = await import('manifold-3d');
  const wasm = await Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  wasm.setup();
  return wasm;
}
