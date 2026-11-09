import type { CrossSection, Manifold, ManifoldToplevel, Mat4, Vec2 } from 'manifold-3d';
import { type Mat3, type Vec3, cross, normalize } from '../../puzzle/vec';
import {
  type BodyData,
  type FilletOptions,
  type MeshData,
  type Surface,
  bodyData,
  creaseRemovers,
  findCreases,
  meshData,
} from '../../render/fillet';
import { scoped } from '../../render/manifold';
import { DIM, LOOK, MM } from '../config';
import { GEAR_TILT } from '../geometry';
import { STAR_MM, gearSticker, starSticker } from '../stickers';
import { Outline, insideSphere, outsideSphere, planeSurface, prismWall, radialWall } from './surfaces';

/**
 * The four piece shapes, built once with manifold-3d and shown as rotated instances.
 *
 * Every body is a cone from the cube centre: its cross-sections are its plateau (the sticker grown by
 * the padding) shrunk towards the centre, down to the black core ball. Every move turns pieces about an
 * axis through the centre, so a cone stays a cone, and two bodies can only meet where their footprints
 * on the sphere of directions meet: the deep parts never collide more than the plateaus would.
 *
 * - Corner (built at UFR): a cone over each face's star plateau, each outer arm continued straight to
 *   the face's edge so it folds over the bevel as a bridge to the next face; the three are unioned and
 *   cut by the faces and bevels. The hollow cube at the vertex stays open down to the core.
 * - Gear (built in its slot frame: z = spin axis, +y towards the face centre): a cone over the cap
 *   (the plateau, tilted 22.5° to the axis), so the plastic rises with the sticker when the gear turns.
 * - Centre and edge (slot frame: z radial; edge ridge along x): one rounded 5.2 mm column, straight down
 *   to 2 mm below the face plane, then coned to the core; the edge adds a 45° roof with a flat crest.
 * - Core: a hollow ball (2 mm shell, 28 mm radius) that nearly reaches the centre pieces, cut back to
 *   the hollow cube at each vertex, where it opens into its empty middle: you can see through there.
 *
 * All edges are rounded by a rolling ball (src/render/fillet.ts), like the Curvy Copter's.
 */

export type BodyMesh = BodyData;

export interface StickerMesh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly normal: Vec3;
}

export interface PrototypeGeometry {
  /** Rounded body with analytic normals. */
  readonly body: BodyMesh;
  /** The sharp body: far fewer triangles, used (invisibly) for picking. */
  readonly pick: MeshData;
  /** In the order of `MaltesePiece.colors`. */
  readonly stickers: readonly StickerMesh[];
  readonly volume: number;
}

export interface MalteseGeometry {
  readonly corner: PrototypeGeometry;
  readonly centre: PrototypeGeometry;
  readonly edge: PrototypeGeometry;
  readonly gear: PrototypeGeometry;
  readonly core: BodyMesh;
}

type Keep = <M extends { delete(): void }>(m: M) => M;

const COS = Math.cos(GEAR_TILT);
const SIN = Math.sin(GEAR_TILT);
/** Hub distance along a gear's axis: its cap is flush with the face plane at k = 0. */
export const HUB_Z = 1 / COS;
/** Gear cap normal in the gear's slot frame (tilted 22.5° towards the face centre). */
export const GEAR_CAP_NORMAL: Vec3 = [0, SIN, COS];
/** Bevel: the plane x + z = BEVEL (etc.) passes through the plateau edge (bevelStart, 1). */
export const BEVEL = 1 + DIM.bevelStartMm * MM;
/** Plastic margin around every sticker. */
export const PAD = DIM.paddingMm * MM;
/** Pieces stop this far outside the core ball (so they never touch it). */
const CORE_CLEAR = 0.02 * MM;
const R_CORE = DIM.coreRadiusMm * MM;
/** Cones start inside the core (the core sphere then cuts them). */
const CONE_FLOOR = R_CORE - 0.3 * MM;
const SEG = LOOK.offsetSegments;

export function defaultFillet(): FilletOptions {
  return {
    outerRadius: DIM.roundOuterMm * MM,
    innerRadius: DIM.roundInnerMm * MM,
    step: LOOK.filletStepMm * MM,
    arcStep: (LOOK.filletArcStepDeg * Math.PI) / 180,
    // Cone walls make acute edges on a plateau's far side: the fillets there shrink so they stay
    // inside the sticker's margin.
    maxReach: (DIM.paddingMm - 0.15) * MM,
    // Plateaus turn tightly round the stars' points and in the gears' notches.
    maxTurn: (10 * Math.PI) / 180,
  };
}

const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** The 3-fold turn about (1,1,1): (x, y, z) -> (z, x, y) takes the F face of UFR to its R face. */
const CYC: Mat3 = [0, 0, 1, 1, 0, 0, 0, 1, 0];
const CYC2: Mat3 = [0, 1, 0, 0, 0, 1, 1, 0, 0];
const apply3 = (r: Mat3, p: Vec3): Vec3 => [
  r[0] * p[0] + r[1] * p[1] + r[2] * p[2],
  r[3] * p[0] + r[4] * p[1] + r[5] * p[2],
  r[6] * p[0] + r[7] * p[1] + r[8] * p[2],
];

/** Column-major Mat4 from a row-major 3x3 and a translation. */
function mat4(r: Mat3, t: Vec3 = [0, 0, 0]): Mat4 {
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, t[0], t[1], t[2], 1];
}

function perp(n: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(ref, n));
  return [u, cross(n, u)];
}

/** Surfaces of one shape and which surfaces each tagged primitive's triangles can lie on. */
class Shape {
  readonly surfaces: Surface[] = [];
  readonly prims = new Map<number, readonly number[]>();
  /** Fillets of creases on these surfaces are clipped to the given solid. */
  readonly clips = new Map<number, Manifold>();
  private nextGroup = 0;

  constructor(
    readonly wasm: ManifoldToplevel,
    readonly keep: Keep,
  ) {}

  group(): number {
    return this.nextGroup++;
  }

  surface(s: Surface): number {
    return this.surfaces.push(s) - 1;
  }

  /** Tag a primitive: its triangles lie on one of `surfaces`. */
  mark(m: Manifold, ...surfaces: number[]): Manifold {
    const o = this.keep(m.asOriginal());
    this.prims.set(o.originalID(), surfaces);
    return o;
  }

  /** The half-space { p : n·p <= d } (a large box), n unit. */
  halfSpace(n: Vec3, d: number): Manifold {
    const L = 8;
    const { keep } = this;
    const box = keep(keep(this.wasm.Manifold.cube([2 * L, 2 * L, 2 * L])).translate([-L, -L, -2 * L]));
    const [u, w] = perp(n);
    return keep(box.transform([u[0], u[1], u[2], 0, w[0], w[1], w[2], 0, n[0], n[1], n[2], 0, n[0] * d, n[1] * d, n[2] * d, 1]));
  }

  /**
   * The cone from the centre over a region drawn in the plane z = 1, between heights z0 and z1.
   * `divisions` splits its walls into bands, which keeps triangles short where long walls meet the
   * fillets (much faster booleans).
   */
  cone(region: CrossSection, z0: number, z1: number, divisions = 0): Manifold {
    const { keep } = this;
    const k = z1 / z0;
    // scaleTop must be a 2-vector: manifold-3d reads a bare number as [s, 0] (a wedge).
    return keep(keep(keep(region.scale([z0, z0])).extrude(z1 - z0, divisions, 0, [k, k])).translate([0, 0, z0]));
  }

  /** The core ball the pieces rest on, as a tagged primitive for subtraction. */
  core(): Manifold {
    const s = this.surface(outsideSphere(R_CORE + CORE_CLEAR, { kind: 'core', outer: false, group: WALLS }));
    return this.mark(this.keep(this.wasm.Manifold.sphere(R_CORE + CORE_CLEAR, LOOK.coreSegments)), s);
  }
}

/** Group 0 of every shape holds its walls (and the core): never rounded against each other. */
const WALLS = 0;

/** The lowest height a cone over this region needs to start inside the core. */
function coneStart(region: CrossSection): number {
  const b = region.bounds();
  const far = Math.max(Math.hypot(b.min[0], b.min[1]), Math.hypot(b.min[0], b.max[1]), Math.hypot(b.max[0], b.min[1]), Math.hypot(b.max[0], b.max[1]));
  return CONE_FLOOR / Math.sqrt(1 + far * far);
}

function polys(cs: CrossSection): [number, number][][] {
  return cs.toPolygons().map((p) => p.map((v) => [v[0], v[1]] as [number, number]));
}

function stickerMesh(wasm: ManifoldToplevel, cs: CrossSection, place: (p: Vec2) => Vec3, normal: Vec3): StickerMesh {
  const ps = cs.toPolygons();
  const flat: Vec2[] = ps.flat();
  const tris = wasm.triangulate(ps, 1e-9);
  const positions = new Float32Array(flat.length * 3);
  flat.forEach((p, i) => positions.set(place(p), 3 * i));
  const indices = new Uint32Array(tris.length * 3);
  // Wind every triangle counterclockwise seen from `normal` (placements may mirror the 2D frame).
  const at = (v: number): Vec3 => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
  tris.forEach((t, i) => {
    const [a, b, c] = [at(t[0]), at(t[1]), at(t[2])];
    const n = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    const flip = n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0;
    indices.set(flip ? [t[0], t[2], t[1]] : t, 3 * i);
  });
  return { positions, indices, normal };
}

const lift = () => DIM.stickerLiftMm * MM;

export interface Proto {
  /** The exact body with sharp edges. */
  readonly sharp: Manifold;
  readonly shape: Shape;
  readonly stickers: readonly StickerMesh[];
}

/** Smallest inside-corner radius of a plateau outline (mm). */
const PLATEAU_NOTCH_MM = 0.3;

/**
 * The plateau: the sticker grown by the padding. Where the sticker has an inside corner tighter than the
 * padding, growing it leaves a sharp notch; those notches get a small radius so the edge can be rounded.
 */
function plateauOf(sticker: CrossSection, keep: Keep): CrossSection {
  const grown = keep(sticker.offset(PAD, 'Round', 2, SEG));
  const c = PLATEAU_NOTCH_MM * MM;
  return clean(keep(keep(grown.offset(c, 'Round', 2, SEG)).offset(-c, 'Round', 2, SEG)), keep);
}

/**
 * Round-join offsets leave near-duplicate vertices (a thousandth of a millimetre apart) and the odd
 * microscopic back-and-forth spike. Their segments have meaningless directions, which would hand the
 * rolling ball a wrong wall normal; drop every vertex within 0.003 mm of the line through its
 * neighbours (an invisible change).
 */
function clean(cs: CrossSection, keep: Keep): CrossSection {
  return keep(cs.simplify(0.003 * MM));
}

// ------------------------------------------------------------------------------------------ corner

/** The corner's region on its F face (face coordinates, z = 1 plane): plateau plus bridges. */
export function cornerRegions(wasm: ManifoldToplevel, keep: Keep): { star: CrossSection; region: CrossSection } {
  const { CrossSection } = wasm;
  const star = keep(new CrossSection([starSticker() as Vec2[]], 'Positive'));
  const plateau = plateauOf(star, keep);
  const ue = STAR_MM.ue * MM;
  const lo = STAR_MM.ye * MM - PAD;
  const hi = STAR_MM.yu * MM + PAD;
  // Each outer arm's end runs on over the bevel: the bridge to the neighbouring face's star.
  const bridgeR = keep(keep(CrossSection.square([1.2 - ue, hi - lo])).translate([ue, lo]));
  const bridgeU = keep(keep(CrossSection.square([hi - lo, 1.2 - ue])).translate([lo, ue]));
  // Up to the face's edges (a hair past them, so the three faces' regions overlap at the seams).
  const edge = 1 + 1e-4;
  const face = keep(keep(CrossSection.square([edge + 0.4, edge + 0.4])).translate([-0.4, -0.4]));
  const close = 0.5 * MM; // round the inside corners where a bridge leaves the plateau
  let region = keep(CrossSection.union([plateau, bridgeR, bridgeU]));
  region = keep(keep(region.offset(close, 'Round', 2, SEG)).offset(-close, 'Round', 2, SEG));
  region = clean(keep(region.intersect(face)), keep);
  return { star, region };
}

/**
 * The corner is built in its diagonal frame (z along (1,1,1)): seen from the centre, all three stars
 * and their bridges lie over one plane perpendicular to the diagonal, so the whole corner is one cone
 * over one 2D region, a ring around the hollow cube (no 3D unions of cones, which are slow).
 */
const DIAG: Mat3 = (() => {
  const e1 = normalize([1, -1, 0]);
  const d = normalize([1, 1, 1]);
  const e2 = cross(d, e1);
  return [e1[0], e2[0], d[0], e1[1], e2[1], d[1], e1[2], e2[2], d[2]];
})();

/** A face region of the UFR corner (face coordinates of F, turned to its face by `fr`), seen on the diagonal plane. */
function onDiagonal(cs: CrossSection, fr: Mat3): Vec2[][] {
  return cs.toPolygons().map((poly) => {
    const out = poly.map(([u, v]): Vec2 => {
      const p = apply3(fr, [u, v, 1]);
      const w = DIAG[2] * p[0] + DIAG[5] * p[1] + DIAG[8] * p[2];
      return [(DIAG[0] * p[0] + DIAG[3] * p[1] + DIAG[6] * p[2]) / w, (DIAG[1] * p[0] + DIAG[4] * p[1] + DIAG[7] * p[2]) / w];
    });
    let area = 0;
    for (let i = 0; i < out.length; i++) {
      const [x0, y0] = out[i];
      const [x1, y1] = out[(i + 1) % out.length];
      area += x0 * y1 - x1 * y0;
    }
    return area >= 0 === (signedArea(poly) >= 0) ? out : out.reverse();
  });
}

function signedArea(poly: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    area += x0 * y1 - x1 * y0;
  }
  return area;
}

function buildCorner(wasm: ManifoldToplevel, keep: Keep): Proto {
  const { CrossSection } = wasm;
  const sh = new Shape(wasm, keep);
  const { star, region } = cornerRegions(wasm, keep);
  const s = Math.SQRT1_2;
  const faces: Mat3[] = [I3, CYC, CYC2]; // F, R, U of the UFR corner
  // Three stars with bridges: one ring around the hollow cube at the vertex.
  const ring = clean(keep(new CrossSection(faces.flatMap((fr) => onDiagonal(region, fr)), 'Positive')), keep);
  const wall = sh.surface(radialWall(DIAG, new Outline(polys(ring)), { kind: 'wall', outer: false, group: WALLS }));
  const top = 1.8; // past the vertex (|(1,1,1)| = 1.73), where the faces cut everything off
  // Built in the diagonal frame, where the cone's caps are flat (fast booleans), then turned into place.
  let solid = sh.mark(sh.cone(ring, coneStart(ring), top, 6), wall);
  solid = keep(solid.subtract(sh.core())); // the core is a ball about the centre: same in any frame
  solid = keep(solid.transform(mat4(DIAG)));
  // Faces and bevels.
  const cuts: [Vec3, number, string][] = [
    [[1, 0, 0], 1, 'face'],
    [[0, 1, 0], 1, 'face'],
    [[0, 0, 1], 1, 'face'],
    [[s, s, 0], BEVEL * s, 'bevel'],
    [[0, s, s], BEVEL * s, 'bevel'],
    [[s, 0, s], BEVEL * s, 'bevel'],
  ];
  for (const [n, d, kind] of cuts) {
    const k = sh.surface(planeSurface(n, d, { kind, outer: true, group: sh.group() + 1 }));
    solid = keep(solid.intersect(sh.mark(sh.halfSpace(n, d), k)));
  }
  const L = lift();
  const onF = (p: Vec2): Vec3 => [p[0], p[1], 1 + L];
  const stickers: StickerMesh[] = [
    stickerMesh(wasm, star, (p) => apply3(CYC2, onF(p)), [0, 1, 0]), // U
    stickerMesh(wasm, star, onF, [0, 0, 1]), // F
    stickerMesh(wasm, star, (p) => apply3(CYC, onF(p)), [1, 0, 0]), // R
  ];
  return { sharp: solid, shape: sh, stickers };
}

// ------------------------------------------------------------------------------------------ gear

/** The gear's plateau (cap + padding) in the cap plane, and its cone section on the plane z = 1. */
export function gearRegions(wasm: ManifoldToplevel, keep: Keep): { cap: CrossSection; plateau: CrossSection; section: CrossSection } {
  const { CrossSection } = wasm;
  const cap = keep(new CrossSection([gearSticker() as Vec2[]], 'Positive'));
  const plateau = plateauOf(cap, keep);
  // Cap point (x, y) sits at (x, y cos, HUB_Z - y sin); seen from the centre it crosses z = 1 at:
  const proj = plateau.toPolygons().map((poly) =>
    poly.map(([x, y]): Vec2 => {
      const z = HUB_Z - y * SIN;
      return [x / z, (y * COS) / z];
    }),
  );
  return { cap, plateau, section: clean(keep(new CrossSection(proj, 'Positive')), keep) };
}

function buildGear(wasm: ManifoldToplevel, keep: Keep): Proto {
  const sh = new Shape(wasm, keep);
  const { cap, section } = gearRegions(wasm, keep);
  const wall = sh.surface(radialWall(I3, new Outline(polys(section)), { kind: 'wall', outer: false, group: WALLS }));
  const n = GEAR_CAP_NORMAL;
  const capS = sh.surface(planeSurface(n, 1, { kind: 'cap', outer: true, group: sh.group() + 1 })); // through (0, 0, HUB_Z)
  let solid = sh.mark(sh.cone(section, coneStart(section), HUB_Z + 0.25), wall);
  solid = keep(solid.intersect(sh.mark(sh.halfSpace(n, 1), capS)));
  solid = keep(solid.subtract(sh.core()));
  const L = lift();
  const place = (p: Vec2): Vec3 => [p[0] + n[0] * L, p[1] * COS + n[1] * L, HUB_Z - p[1] * SIN + n[2] * L];
  return { sharp: solid, shape: sh, stickers: [stickerMesh(wasm, cap, place, n)] };
}

// ------------------------------------------------------------------------------------------ centre and edge

/** The column's section: 5.2 mm less the gaps, corners rounded so the sticker keeps the padding. */
export function columnSection(wasm: ManifoldToplevel, keep: Keep): CrossSection {
  const a = (DIM.columnMm - 2 * DIM.gapMm) * MM;
  const r = DIM.columnRoundMm * MM;
  return clean(keep(keep(wasm.CrossSection.square([a - 2 * r, a - 2 * r], true)).offset(r, 'Round', 2, SEG)), keep);
}

/** Straight from `top` (+ a little, cut later) down to 2 mm below the face plane, then coned to the core. */
function column(sh: Shape, top: number): Manifold {
  const { keep, wasm } = sh;
  const sq = columnSection(wasm, keep);
  const zk = 1 - DIM.columnStraightMm * MM;
  const coneSec = keep(sq.scale([1 / zk, 1 / zk]));
  const side = sh.surface(prismWall(I3, new Outline(polys(sq)), { kind: 'column', outer: true, group: WALLS }));
  const coned = sh.surface(radialWall(I3, new Outline(polys(coneSec)), { kind: 'column', outer: false, group: WALLS }));
  const straight = sh.mark(keep(keep(sq.extrude(top + 0.05 - zk)).translate([0, 0, zk])), side);
  const below = sh.mark(sh.cone(coneSec, coneStart(coneSec), zk), coned);
  return keep(wasm.Manifold.union([straight, below]));
}

function buildCentre(wasm: ManifoldToplevel, keep: Keep): Proto {
  const sh = new Shape(wasm, keep);
  let solid = column(sh, 1);
  const top = sh.surface(planeSurface([0, 0, 1], 1, { kind: 'top', outer: true, group: sh.group() + 1 }));
  solid = keep(solid.intersect(sh.mark(sh.halfSpace([0, 0, 1], 1), top)));
  solid = keep(solid.subtract(sh.core()));
  const sticker = keep(columnSection(wasm, keep).offset(-PAD, 'Round', 2, SEG));
  const L = lift();
  return { sharp: solid, shape: sh, stickers: [stickerMesh(wasm, sticker, (p) => [p[0], p[1], 1 + L], [0, 0, 1])] };
}

/** Edge roof: planes ±y + z = c0 through the shoulders (9 mm proud in a centre slot), crest 11 mm. */
export function edgeRoof(): { c0: number; crest: number; yCrest: number } {
  const g = DIM.gapMm * MM;
  const crest = DIM.edgeCrestMm * MM - g;
  const c0 = (DIM.columnMm / 2 + DIM.edgeShoulderMm) * MM - g * Math.SQRT2;
  return { c0, crest, yCrest: c0 - crest };
}

function buildEdge(wasm: ManifoldToplevel, keep: Keep): Proto {
  const sh = new Shape(wasm, keep);
  const { c0, crest, yCrest } = edgeRoof();
  const s = Math.SQRT1_2;
  let solid = column(sh, crest);
  const cuts: [Vec3, number, string][] = [
    [[0, s, s], c0 * s, 'roof'],
    [[0, -s, s], c0 * s, 'roof'],
    [[0, 0, 1], crest, 'crest'],
  ];
  for (const [n, d, kind] of cuts) {
    const k = sh.surface(planeSurface(n, d, { kind, outer: true, group: sh.group() + 1 }));
    solid = keep(solid.intersect(sh.mark(sh.halfSpace(n, d), k)));
  }
  solid = keep(solid.subtract(sh.core()));
  // Each roof face, flattened (x along the ridge, w down the slope from the crest), less the padding.
  const sq = columnSection(wasm, keep);
  const half = keep(keep(wasm.CrossSection.square([2, 2])).translate([-1, yCrest]));
  const roofFace = keep(keep(keep(sq.intersect(half)).translate([0, -yCrest])).scale([1, Math.SQRT2]));
  const sticker = keep(roofFace.offset(-PAD, 'Round', 2, SEG));
  const L = lift();
  const face = (sign: 1 | -1) => {
    const nrm: Vec3 = [0, sign * s, s];
    return stickerMesh(
      wasm,
      sticker,
      (p) => {
        const y = yCrest + p[1] / Math.SQRT2;
        return [p[0] + nrm[0] * L, sign * y + nrm[1] * L, c0 - y + nrm[2] * L];
      },
      nrm,
    );
  };
  return { sharp: solid, shape: sh, stickers: [face(1), face(-1)] };
}

// ------------------------------------------------------------------------------------------ core

function buildCore(wasm: ManifoldToplevel, keep: Keep): { solid: Manifold; shape: Shape } {
  const { Manifold } = wasm;
  const sh = new Shape(wasm, keep);
  const rIn = R_CORE - DIM.coreShellMm * MM;
  const outer = sh.mark(keep(Manifold.sphere(R_CORE, LOOK.coreSegments)), sh.surface(insideSphere(R_CORE, { kind: 'core', outer: false, group: WALLS })));
  const inner = sh.mark(keep(Manifold.sphere(rIn, LOOK.coreSegments)), sh.surface(outsideSphere(rIn, { kind: 'core inside', outer: false, group: WALLS })));
  // The hollow cube at each vertex, [a, ...]^3 with that vertex's signs.
  const a = DIM.vertexBoxMm * MM;
  const boxes: Manifold[] = [];
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) {
        const planes = ([
          [sx, 0, 0],
          [0, sy, 0],
          [0, 0, sz],
        ] as Vec3[]).map((n) => sh.surface(planeSurface(n, a, { kind: 'pocket', outer: false, group: WALLS })));
        const cube = keep(keep(Manifold.cube([1, 1, 1])).translate([a, a, a]));
        boxes.push(sh.mark(keep(cube.scale([sx, sy, sz])), ...planes));
      }
    }
  }
  return { solid: keep(Manifold.difference([outer, inner, ...boxes])), shape: sh };
}

// ------------------------------------------------------------------------------------------ assembly

/** The body with every convex crease rounded (or the sharp body when `fillet` is null). */
export function roundedSolid(proto: Proto, fillet: FilletOptions | null): Manifold {
  if (!fillet) return proto.sharp;
  const { surfaces, prims, clips, wasm, keep } = proto.shape;
  const removers = findCreases(proto.sharp.getMesh(), surfaces, prims).flatMap((c) =>
    creaseRemovers(wasm, surfaces[c.a], surfaces[c.b], c.points, fillet).map((m) => {
      let out = keep(m);
      for (const k of [c.a, c.b]) {
        const clip = clips.get(k);
        if (clip) out = keep(out.intersect(clip));
      }
      return out;
    }),
  );
  if (!removers.length) return proto.sharp;
  const body = keep(wasm.Manifold.difference([proto.sharp, ...removers]));
  // Overlapping removers can leave zero-volume slivers behind: keep the body itself.
  const parts = body.decompose().map(keep);
  return parts.length > 1 ? parts.reduce((a, b) => (b.volume() > a.volume() ? b : a)) : body;
}

export interface PrototypeSolids {
  readonly corner: Proto;
  readonly centre: Proto;
  readonly edge: Proto;
  readonly gear: Proto;
  readonly core: Manifold;
}

/** The exact (sharp) solids, owned by `keep`'s scope: for tests that check overlaps with booleans. */
export function buildPrototypeSolids(wasm: ManifoldToplevel, keep: Keep): PrototypeSolids {
  return {
    corner: buildCorner(wasm, keep),
    centre: buildCentre(wasm, keep),
    edge: buildEdge(wasm, keep),
    gear: buildGear(wasm, keep),
    core: buildCore(wasm, keep).solid,
  };
}

/** Build every prototype as render meshes (rounded unless `fillet` is null). */
export function buildMalteseGeometry(wasm: ManifoldToplevel, fillet: FilletOptions | null = defaultFillet()): MalteseGeometry {
  return scoped((keep) => {
    const geo = (p: Proto): PrototypeGeometry => {
      const body = roundedSolid(p, fillet);
      return {
        body: bodyData(body.getMesh(), p.shape.surfaces, p.shape.prims),
        pick: meshData(p.sharp.getMesh()),
        stickers: p.stickers,
        volume: p.sharp.volume(),
      };
    };
    const core = buildCore(wasm, keep);
    return {
      corner: geo(buildCorner(wasm, keep)),
      centre: geo(buildCentre(wasm, keep)),
      edge: geo(buildEdge(wasm, keep)),
      gear: geo(buildGear(wasm, keep)),
      core: bodyData(core.solid.getMesh(), core.shape.surfaces, core.shape.prims),
    };
  });
}
