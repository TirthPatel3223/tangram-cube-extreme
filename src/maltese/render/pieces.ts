import type { CrossSection, Manifold, ManifoldToplevel, Mat4, Vec2 } from 'manifold-3d';
import { scoped } from '../../render/manifold';
import { type Vec3, cross, normalize } from '../../puzzle/vec';
import { DIM, LOOK, MM } from '../config';
import { GEAR_TILT } from '../geometry';
import { GEAR_OUTLINE, STAR_OUTLINE } from '../outlines';

/**
 * The four piece shapes, built once with manifold-3d and shown as rotated instances.
 *
 * - Corner (built at UFR): three photo-traced star plateaus on a moat floor, the arms continued over
 *   the bevelled cube edges ("bridges"), three walls that stay outside every ring's channel, the hollow
 *   vertex box (simply left empty), and a tunnel along the body diagonal you can see through.
 * - Gear (built in its slot frame: z = spin axis, +y towards the face centre): the petal body is a
 *   tapered prism along the spin axis, sheared so its top is the cap plane, tilted 22.5° to the axis
 *   and flush with the face only at k = 0; plus a hub post.
 * - Centre and edge (slot frame: z radial; edge ridge along x): one 5.2 mm square column; the edge
 *   adds a 45° roof with a flat crest (user's measurement: 9 mm shoulders, 11 mm crest).
 * - Core: a black sphere with the four diagonal tunnels.
 */

export interface BodyMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
}

export interface StickerMesh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly normal: Vec3;
}

export interface PrototypeGeometry {
  readonly body: BodyMesh;
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
const TAN = Math.tan(GEAR_TILT);
/** Hub distance along a gear's axis: its cap is flush with the face plane at k = 0. */
export const HUB_Z = 1 / COS;
/** Gear cap normal in the gear's slot frame (tilted 22.5° towards the face centre). */
export const GEAR_CAP_NORMAL: Vec3 = [0, SIN, COS];

/** Bevel: the plane x + y = BEVEL (etc.) passes through the plateau edge (bevelStart, 1). */
export const BEVEL = 1 + DIM.bevelStartMm * MM;

/** Where the star's inner arm tips end (face coordinates), from the photo outline. */
const STAR_INNER_TIP = Math.min(...STAR_OUTLINE.filter((_, i) => i % 2 === 0));

/** Edges sharper than this keep split normals (plateau tops, column corners); curved walls stay smooth. */
const SHARP_DEG = 50;

function pts(flat: readonly number[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

/** Column-major Mat4 from a row-major 3x3 rotation/linear map and a translation. */
function mat4(r: readonly number[], t: Vec3 = [0, 0, 0]): Mat4 {
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, t[0], t[1], t[2], 1];
}

/** The 3-fold turn about (1,1,1): (x, y, z) -> (z, x, y) takes the F face of UFR to its R face. */
const CYC: readonly number[] = [0, 0, 1, 1, 0, 0, 0, 1, 0];
const CYC2: readonly number[] = [0, 1, 0, 0, 0, 1, 1, 0, 0];
const apply3 = (r: readonly number[], p: Vec3): Vec3 => [
  r[0] * p[0] + r[1] * p[1] + r[2] * p[2],
  r[3] * p[0] + r[4] * p[1] + r[5] * p[2],
  r[6] * p[0] + r[7] * p[1] + r[8] * p[2],
];

function perp(n: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(ref, n));
  return [u, cross(n, u)];
}

/** The half-space { p : n·p <= d } (a large box), n unit. */
function halfSpace(wasm: ManifoldToplevel, keep: Keep, n: Vec3, d: number): Manifold {
  const L = 8;
  const box = keep(keep(wasm.Manifold.cube([2 * L, 2 * L, 2 * L])).translate([-L, -L, -2 * L]));
  const [u, w] = perp(n);
  return keep(box.transform([u[0], u[1], u[2], 0, w[0], w[1], w[2], 0, n[0], n[1], n[2], 0, n[0] * d, n[1] * d, n[2] * d, 1]));
}

/** A cylinder of radius r along the unit axis a, from -back to +len along it. */
function rod(wasm: ManifoldToplevel, keep: Keep, a: Vec3, r: number, len: number, back = 0.2): Manifold {
  const c = keep(wasm.Manifold.cylinder(len + back, r, r, LOOK.segments));
  const [u, w] = perp(a);
  return keep(c.transform([u[0], u[1], u[2], 0, w[0], w[1], w[2], 0, a[0], a[1], a[2], 0, -a[0] * back, -a[1] * back, -a[2] * back, 1]));
}

function bodyMesh(m: Manifold, keep: Keep): BodyMesh {
  const mesh = keep(m.calculateNormals(0, SHARP_DEG)).getMesh();
  const P = mesh.numProp;
  const n = mesh.vertProperties.length / P;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      positions[3 * i + k] = mesh.vertProperties[i * P + k];
      normals[3 * i + k] = mesh.vertProperties[i * P + 3 + k];
    }
  }
  return { positions, normals, indices: Uint32Array.from(mesh.triVerts) };
}

/** Triangulate a 2D sticker and place it with `place` (2D -> 3D), facing `normal`. */
function stickerMesh(wasm: ManifoldToplevel, cs: CrossSection, place: (p: Vec2) => Vec3, normal: Vec3): StickerMesh {
  const polys = cs.toPolygons();
  const flat: Vec2[] = polys.flat();
  const tris = wasm.triangulate(polys, 1e-9);
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
const rimGap = () => (DIM.rimMm - DIM.gapMm) * MM;

// ------------------------------------------------------------------------------------------ corner

function buildCorner(wasm: ManifoldToplevel, keep: Keep): Proto {
  const { Manifold, CrossSection } = wasm;
  const sticker = keep(new CrossSection([pts(STAR_OUTLINE)], 'Positive'));
  const plateau = keep(sticker.offset(rimGap(), 'Round', 2, 48));
  // Continue the two outer arms (with their fins) across the bevel: these become the bridges.
  const strip = keep(keep(CrossSection.square([1, 0.012])).translate([0, 0.854]));
  const b = keep(CrossSection.intersection(plateau, strip)).bounds();
  const up = keep(keep(CrossSection.square([b.max[0] - b.min[0], 0.6])).translate([b.min[0], 0.84]));
  const right = keep(keep(CrossSection.square([0.6, b.max[0] - b.min[0]])).translate([0.84, b.min[0]]));
  // Blunt the two inner arm tips (left arm along -x near y ≈ 0.43, down arm along -y near x ≈ 0.43).
  const tip = STAR_INNER_TIP + DIM.armTipCutMm * MM;
  const cutLeft = keep(keep(CrossSection.square([tip, 0.6])).translate([0, 0.1]));
  const cutDown = keep(keep(CrossSection.square([0.6, tip])).translate([0.1, 0]));
  const blunted = keep(CrossSection.difference([plateau, cutLeft, cutDown]));
  const plate2d = keep(CrossSection.union([blunted, up, right]));
  const t = DIM.plateauMm * MM;
  const plateF = keep(keep(plate2d.extrude(t)).translate([0, 0, 1 - t]));
  const plates = [plateF, keep(plateF.transform(mat4(CYC))), keep(plateF.transform(mat4(CYC2)))];
  // Walls: slabs between wallInner and wallOuter, up to the moat floor (1 - t).
  const a0 = DIM.wallInnerMm * MM;
  const a1 = DIM.wallOuterMm * MM;
  const top = 1 - t + 0.2 * MM;
  const slab = (sx: number, sy: number, sz: number) => keep(keep(Manifold.cube([sx, sy, sz])).translate([a0, a0, a0]));
  const walls = [slab(a1 - a0, top - a0, top - a0), slab(top - a0, a1 - a0, top - a0), slab(top - a0, top - a0, a1 - a0)];
  let solid = keep(Manifold.union([...plates, ...walls]));
  const s = Math.SQRT1_2;
  for (const n of [[s, s, 0], [0, s, s], [s, 0, s]] as Vec3[]) solid = keep(solid.intersect(halfSpace(wasm, keep, n, BEVEL * s)));
  for (const n of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) solid = keep(solid.intersect(halfSpace(wasm, keep, n, 1)));
  const d = normalize([1, 1, 1]);
  solid = keep(solid.subtract(rod(wasm, keep, d, DIM.tunnelRadiusMm * MM, 2.5)));
  const stickerTip = tip + rimGap();
  const sticker2 = keep(
    CrossSection.difference([
      sticker,
      keep(keep(CrossSection.square([stickerTip, 0.6])).translate([0, 0.1])),
      keep(keep(CrossSection.square([0.6, stickerTip])).translate([0.1, 0])),
    ]),
  );
  const L = lift();
  const onF = (p: Vec2): Vec3 => [p[0], p[1], 1 + L];
  const stickers: StickerMesh[] = [
    stickerMesh(wasm, sticker2, (p) => apply3(CYC2, onF(p)), [0, 1, 0]), // U
    stickerMesh(wasm, sticker2, onF, [0, 0, 1]), // F
    stickerMesh(wasm, sticker2, (p) => apply3(CYC, onF(p)), [1, 0, 0]), // R
  ];
  return { solid, stickers };
}

// ------------------------------------------------------------------------------------------ gear

function buildGear(wasm: ManifoldToplevel, keep: Keep): Proto {
  const { Manifold, CrossSection } = wasm;
  const cap = keep(new CrossSection([pts(GEAR_OUTLINE)], 'Positive'));
  const plateau = keep(cap.offset(rimGap(), 'Round', 2, 48));
  // Cross-section perpendicular to the spin axis: the cap outline seen along the axis.
  const section = keep(plateau.scale([1, COS]));
  const depth = DIM.gearBodyMm * MM;
  const k = 1 - DIM.gearTaper;
  const body0 = keep(keep(keep(section.scale(k)).extrude(depth, 0, 0, 1 / k)).translate([0, 0, -depth]));
  // Shear (u, v, w) -> (u, v, HUB_Z - tan·v + w): w = 0 becomes the tilted cap, walls follow the axis.
  const body = keep(body0.transform([1, 0, 0, 0, 0, 1, -TAN, 0, 0, 0, 1, 0, 0, 0, HUB_Z, 1]));
  const inner = DIM.innerMm * MM;
  const r = DIM.gearPostRadiusMm * MM;
  const post = keep(keep(Manifold.cylinder(HUB_Z - depth + 0.03 - inner, r, r, 48)).translate([0, 0, inner]));
  const solid = keep(body.add(post));
  const L = lift();
  const n = GEAR_CAP_NORMAL;
  const place = (p: Vec2): Vec3 => [p[0] + n[0] * L, p[1] * COS + n[1] * L, HUB_Z - p[1] * SIN + n[2] * L];
  return { solid, stickers: [stickerMesh(wasm, cap, place, n)] };
}

// ------------------------------------------------------------------------------------------ centre and edge

function roundedSquare(wasm: ManifoldToplevel, keep: Keep, w: number, h: number, r: number): CrossSection {
  return keep(keep(wasm.CrossSection.square([w - 2 * r, h - 2 * r], true)).offset(r, 'Round', 2, 32));
}

function column(wasm: ManifoldToplevel, keep: Keep, top: number): Manifold {
  const a = (DIM.columnMm - 2 * DIM.gapMm) * MM;
  const inner = DIM.innerMm * MM;
  return keep(keep(wasm.Manifold.cube([a, a, top - inner])).translate([-a / 2, -a / 2, inner]));
}

function buildCentre(wasm: ManifoldToplevel, keep: Keep): Proto {
  const solid = column(wasm, keep, 1);
  const s = DIM.centreStickerMm * MM;
  const sq = roundedSquare(wasm, keep, s, s, DIM.stickerRoundMm * MM);
  const L = lift();
  return { solid, stickers: [stickerMesh(wasm, sq, (p) => [p[0], p[1], 1 + L], [0, 0, 1])] };
}

function buildEdge(wasm: ManifoldToplevel, keep: Keep): Proto {
  const g = DIM.gapMm * MM;
  const crest = DIM.edgeCrestMm * MM - g;
  const half = (DIM.columnMm / 2) * MM - g;
  // Roof planes ±y + z = c0 through the shoulders (y = ±half at the shoulder height), 45° each,
  // moved in by the gap like every other cut face.
  const c0 = (DIM.columnMm / 2 + DIM.edgeShoulderMm) * MM - g * Math.SQRT2;
  const s = Math.SQRT1_2;
  let solid = column(wasm, keep, crest);
  solid = keep(solid.intersect(halfSpace(wasm, keep, [0, s, s], c0 * s)));
  solid = keep(solid.intersect(halfSpace(wasm, keep, [0, -s, s], c0 * s)));
  // Stickers on the two roof faces: from the shoulder (y = ±half, z = c0 - half) to the crest edge.
  const yCrest = c0 - crest; // |y| where the roof face meets the crest
  const slope = (half - yCrest) * Math.SQRT2; // roof face width along the slope
  const m = DIM.edgeStickerInsetMm * MM;
  const a = 2 * half;
  const rect = roundedSquare(wasm, keep, a - 2 * m, slope - 2 * m, DIM.stickerRoundMm * MM * 0.6);
  const L = lift();
  const face = (sign: 1 | -1) => {
    // Face centre, in-face slope direction (shoulder -> crest) and outward normal.
    const yc = sign * (half + yCrest) / 2;
    const zc = c0 - sign * yc;
    const e2: Vec3 = [0, -sign * s, s];
    const nrm: Vec3 = [0, sign * s, s];
    return stickerMesh(
      wasm,
      rect,
      (p) => [p[0] + nrm[0] * L, yc + p[1] * e2[1] + nrm[1] * L, zc + p[1] * e2[2] + nrm[2] * L],
      nrm,
    );
  };
  return { solid, stickers: [face(1), face(-1)] };
}

// ------------------------------------------------------------------------------------------ core

function buildCore(wasm: ManifoldToplevel, keep: Keep): Manifold {
  let core = keep(wasm.Manifold.sphere(DIM.coreRadiusMm * MM, 96));
  for (const d of [[1, 1, 1], [-1, 1, 1], [1, -1, 1], [1, 1, -1]] as Vec3[]) {
    core = keep(core.subtract(rod(wasm, keep, normalize(d), DIM.tunnelRadiusMm * MM, 2, 2)));
  }
  return core;
}

interface Proto {
  readonly solid: Manifold;
  readonly stickers: readonly StickerMesh[];
}

export interface PrototypeSolids {
  readonly corner: Proto;
  readonly centre: Proto;
  readonly edge: Proto;
  readonly gear: Proto;
  readonly core: Manifold;
}

/** The exact solids (owned by `keep`'s scope), for tests that check overlaps with booleans. */
export function buildPrototypeSolids(wasm: ManifoldToplevel, keep: Keep): PrototypeSolids {
  return {
    corner: buildCorner(wasm, keep),
    centre: buildCentre(wasm, keep),
    edge: buildEdge(wasm, keep),
    gear: buildGear(wasm, keep),
    core: buildCore(wasm, keep),
  };
}

/** Build every prototype as render meshes (takes well under a second). */
export function buildMalteseGeometry(wasm: ManifoldToplevel): MalteseGeometry {
  return scoped((keep) => {
    const s = buildPrototypeSolids(wasm, keep);
    const geo = (p: Proto): PrototypeGeometry => ({ body: bodyMesh(p.solid, keep), stickers: p.stickers, volume: p.solid.volume() });
    return { corner: geo(s.corner), centre: geo(s.centre), edge: geo(s.edge), gear: geo(s.gear), core: bodyMesh(s.core, keep) };
  });
}
