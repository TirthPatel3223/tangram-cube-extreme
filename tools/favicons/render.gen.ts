/**
 * Favicon renderer, step 1 of 2: draws one face of every puzzle, scrambled, from its real 3D meshes.
 *
 * Each puzzle's pieces are built exactly as the app builds them (bodies, stickers, rounded edges),
 * put into a seeded scrambled state, and rasterised straight on (orthographic, z-buffered) in the
 * app's own "face" view. The result is a colour-index image per puzzle, which
 * `vectorize.py` traces into the SVG favicons in `public/favicons/`.
 *
 * Run: npx vitest run --config tools/favicons/vitest.config.ts   (writes to tools/favicons/out/)
 * Then: python -I tools/favicons/vectorize.py tools/favicons/out public/favicons
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { it } from 'vitest';
import { CUT_S } from '../../src/config';
import { type PuzzleModel, createModel } from '../../src/puzzle/model';
import { type Axis, type Move, inRegion, mulberry32 } from '../../src/puzzle/moves';
import { PuzzleState } from '../../src/puzzle/state';
import { mat3Vec } from '../../src/puzzle/vec';
import { buildPieceVisuals } from '../../src/render/meshes';
import { buildModel } from '../../src/curvy/pieces';
import { buildShapeGeometry, defaultCsgOptions, loadManifold } from '../../src/curvy/render/csg';
import { buildCore, buildCurvyVisuals, setPieceTransform as setCurvyTransform } from '../../src/curvy/render/meshes';
import { type ScrambleOptions, generateCurvyScramble } from '../../src/curvy/scramble';
import { buildCoreMesh, buildMalteseVisuals, setPieceTransform as setMalteseTransform } from '../../src/maltese/render/meshes';
import { buildMalteseGeometry, defaultFillet } from '../../src/maltese/render/pieces';
import { CENTRE_SLOT_COUNT, RADIAL_SLOTS } from '../../src/maltese/geometry';
import { PIECES as MALTESE_PIECES } from '../../src/maltese/model';
import { generateScramble as generateMalteseScramble } from '../../src/maltese/scramble';
import { MalteseState } from '../../src/maltese/state';

const OUT = join(__dirname, 'out');
/** Half-width of the rendered square, in model units (the cube face is [-1, 1]). */
const EXTENT = 1.03;
const SIZE = 1024;
const PREVIEW = 160;

type Rows = [number[], number[], number[]];
/** The apps' face views: Tangram shows orange (+x) with green on top, the others green (+z) with white on top. */
const TANGRAM_FACE: Rows = [
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 0],
];
const IDENTITY: Rows = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

interface Raster {
  readonly size: number;
  readonly index: Uint8Array;
  readonly palette: string[];
  /** Height of the visible surface above the face plane (model units), per pixel. */
  readonly depth: Float64Array;
  /** Which mesh is visible, per pixel (0 = none), to tell neighbouring stickers apart. */
  readonly mesh: Uint16Array;
}

const BODY = '#141416';
const CORE = '#0b0b0d';
/**
 * Every cube edge is bare plastic (bevel, sticker margin), so nothing coloured shows this close to
 * the face's edge; what the render finds there is a neighbouring face's sticker seen edge-on.
 */
const STICKER_LIMIT = 0.985;

/** Orthographic z-buffer render of every visible (layer 0) mesh under `root`, one colour per material. */
function rasterise(root: THREE.Object3D, rows: Rows, size: number): Raster {
  root.updateMatrixWorld(true);
  const depth = new Float64Array(size * size).fill(-Infinity);
  const index = new Uint8Array(size * size); // 0 = background
  const meshId = new Uint16Array(size * size);
  const palette: string[] = ['none', BODY];
  let meshCount = 0;
  const camLayers = new THREE.Layers();
  const v = new THREE.Vector3();
  const px = (p: THREE.Vector3): [number, number, number] => {
    const x = rows[0][0] * p.x + rows[0][1] * p.y + rows[0][2] * p.z;
    const y = rows[1][0] * p.x + rows[1][1] * p.y + rows[1][2] * p.z;
    const z = rows[2][0] * p.x + rows[2][1] * p.y + rows[2][2] * p.z;
    return [((x + EXTENT) / (2 * EXTENT)) * size, ((EXTENT - y) / (2 * EXTENT)) * size, z];
  };
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.layers.test(camLayers) || !mesh.visible) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const hex = '#' + mat.color.getHexString();
    const mi = ++meshCount;
    let ci = palette.indexOf(hex);
    if (ci < 0) ci = palette.push(hex) - 1;
    const pos = mesh.geometry.getAttribute('position');
    const idx = mesh.geometry.getIndex();
    const nTri = (idx ? idx.count : pos.count) / 3;
    const pts: [number, number, number][] = [];
    for (let i = 0; i < pos.count; i++) pts.push(px(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)));
    for (let t = 0; t < nTri; t++) {
      const a = pts[idx ? idx.getX(3 * t) : 3 * t];
      const b = pts[idx ? idx.getX(3 * t + 1) : 3 * t + 1];
      const c = pts[idx ? idx.getX(3 * t + 2) : 3 * t + 2];
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const x1 = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const y1 = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = y0; y <= y1; y++) {
        const sy = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const sx = x + 0.5;
          const w0 = ((b[0] - sx) * (c[1] - sy) - (b[1] - sy) * (c[0] - sx)) / area;
          const w1 = ((c[0] - sx) * (a[1] - sy) - (c[1] - sy) * (a[0] - sx)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
          const k = y * size + x;
          if (z > depth[k]) {
            depth[k] = z;
            index[k] = ci;
            meshId[k] = mi;
          }
        }
      }
    }
  });
  // Only the face itself: anything poking out sideways from the neighbouring faces is cut off.
  // Inside it, gaps you can see straight through (cuts along the line of sight) and the core read as
  // black plastic, as they do on the real puzzle.
  const body = palette.indexOf(BODY);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      const u = Math.abs(((x + 0.5) / size) * 2 * EXTENT - EXTENT);
      const w = Math.abs(EXTENT - ((y + 0.5) / size) * 2 * EXTENT);
      if (u > 1 || w > 1) {
        index[k] = 0;
        meshId[k] = 0;
      } else if (index[k] === 0 || palette[index[k]] === CORE || u > STICKER_LIMIT || w > STICKER_LIMIT) {
        index[k] = body;
        meshId[k] = 0;
      }
    }
  }
  for (let k = 0; k < depth.length; k++) depth[k] -= 1;
  return { size, index, palette, depth, mesh: meshId };
}

const BLACKS = new Set([BODY, CORE]);

/**
 * How good a scrambled face looks: sticker colours spread evenly (no colour hogging the face),
 * neighbouring stickers mostly in different colours (same-coloured neighbours merge into blocks that
 * look half solved), and, when `flatWeight` is set, stickers flush with the face (proud or sunk
 * pieces read badly at 16 px). Higher is better.
 */
function scrambleScore(r: Raster, flatWeight: number): number {
  const area = new Map<number, number>();
  let total = 0;
  let offPlane = 0;
  r.index.forEach((c, k) => {
    if (c === 0 || BLACKS.has(r.palette[c])) return;
    area.set(c, (area.get(c) ?? 0) + 1);
    total++;
    if (Math.abs(r.depth[k]) > 0.02) offPlane++;
  });
  if (!total) return -Infinity;
  let entropy = 0;
  let maxShare = 0;
  for (const a of area.values()) {
    const p = a / total;
    entropy -= p * Math.log(p);
    maxShare = Math.max(maxShare, p);
  }
  // Neighbouring stickers: pixel pairs a bit more than the widest sticker gap apart, on different stickers.
  const step = Math.max(2, Math.round(r.size * 0.09));
  let pairs = 0;
  let same = 0;
  const isSticker = (k: number) => r.index[k] !== 0 && !BLACKS.has(r.palette[r.index[k]]);
  for (let y = 0; y + step < r.size; y++) {
    for (let x = 0; x + step < r.size; x++) {
      const k = y * r.size + x;
      if (!isSticker(k)) continue;
      for (const n of [k + step, k + step * r.size]) {
        if (!isSticker(n) || r.mesh[n] === r.mesh[k]) continue;
        pairs++;
        if (r.index[n] === r.index[k]) same++;
      }
    }
  }
  const sameShare = pairs ? same / pairs : 0;
  return entropy - 3 * Math.max(0, maxShare - 0.25) - 1.5 * sameShare - flatWeight * (offPlane / total);
}

function save(name: string, r: Raster, note: string): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.idx`), r.index);
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ size: r.size, extent: EXTENT, palette: r.palette, note }, null, 2));
}

/**
 * Try `seeds` scrambles, keep the best looking one that passes `ok`, and render it at full size.
 * `render(seed, size)` returns null when the seed is rejected.
 */
function best(
  name: string,
  seeds: number,
  render: (seed: number, size: number) => Raster | null,
  flatWeight = 0,
): void {
  let pick = -1;
  let score = -Infinity;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = render(seed, PREVIEW);
    if (!r) continue;
    const s = scrambleScore(r, flatWeight);
    if (s > score) {
      score = s;
      pick = seed;
    }
  }
  if (pick < 0) throw new Error(`${name}: no acceptable scramble`);
  save(name, render(pick, SIZE)!, `seed ${pick}, score ${score.toFixed(3)}`);
  console.log(`${name}: seed ${pick} (score ${score.toFixed(3)})`);
}

/**
 * A scrambled Tangram Cube that is a cube again, for a square face.
 *
 * A random walk of 60° turns practically never comes back to the cube shape, and 120° turns alone
 * never use the Extreme's extra cuts (pieces split by them would always move together and show as
 * one-coloured blocks). So the scramble is made of blocks, each one a random corner turn (any
 * multiple of 60°) and a flip, closed by whichever U^a D^b brings the cube shape back, which works for
 * about half of all blocks (e.g. U' D' F U D). Blocks that can't be closed are dropped.
 * Lookup tables (piece x orientation) keep the search fast; the result is replayed on a real
 * PuzzleState, which checks every move.
 */
function cubeScramble(model: PuzzleModel, rng: () => number, blocks: number): { state: PuzzleState; moves: Move[] } {
  const G = model.group;
  const n = model.pieces.length;
  const order = model.variant.cornerOrder;
  const axes: Axis[] = ['U', 'D', 'F', 'R', 'L'];
  const protrudes = model.pieces.map((p) =>
    G.elements.map((m) => p.poly.vertices.some((v) => mat3Vec(m, v).some((c) => Math.abs(c) > 1 + 1e-6))),
  );
  const inside = Object.fromEntries(
    axes.map((a) => [a, model.pieces.map((p) => G.elements.map((m) => inRegion(model.axes[a].region, mat3Vec(m, p.poly.centroid))))]),
  ) as Record<Axis, boolean[][]>;
  const turn = (o: Int32Array, m: Move) => {
    const g = model.moveElement(m);
    for (let i = 0; i < n; i++) if (inside[m.axis][i][o[i]]) o[i] = G.mul(g, o[i]);
  };
  const isCube = (o: Int32Array) => o.every((g, i) => !protrudes[i][g]);
  // Turn amounts normalised to (-order/2, order/2], as the app writes them.
  const norm = (a: number) => (((a % order) + order + Math.floor((order - 1) / 2)) % order) - Math.floor((order - 1) / 2);
  const corner = (a: number, b: number): Move[] => [
    ...(norm(a) ? [{ axis: 'U' as Axis, amount: norm(a) }] : []),
    ...(norm(b) ? [{ axis: 'D' as Axis, amount: norm(b) }] : []),
  ];

  const o = new Int32Array(n).fill(G.identity);
  const moves: Move[] = [];
  let prevFlip: Axis | null = null;
  for (let done = 0, tries = 0; done < blocks && tries < blocks * 20; tries++) {
    const flips = (['F', 'R', 'L'] as Axis[]).filter((f) => f !== prevFlip);
    const flip = flips[Math.floor(rng() * flips.length)];
    const block = [...corner(Math.floor(rng() * order), Math.floor(rng() * order)), { axis: flip, amount: 1 }];
    const t = o.slice();
    for (const m of block) turn(t, m);
    const closers: Move[][] = [];
    for (let a = 0; a < order; a++) {
      for (let b = 0; b < order; b++) {
        const c = corner(a, b);
        const q = t.slice();
        for (const m of c) turn(q, m);
        if (isCube(q)) closers.push(c);
      }
    }
    if (!closers.length) continue;
    const close = closers[Math.floor(rng() * closers.length)];
    for (const m of close) turn(t, m);
    o.set(t);
    moves.push(...block, ...close);
    prevFlip = flip;
    done++;
  }
  const state = PuzzleState.solved(model);
  state.applyAll(moves);
  if (state.protrudingPieces().length || !state.orient.every((g, i) => g === o[i])) throw new Error('cubeScramble out of step');
  return { state, moves };
}

it('tangram faces', () => {
  for (const [name, variant] of [
    ['tangram-cube-extreme', 'extreme'],
    ['tangram-cube', 'original'],
  ] as const) {
    const model = createModel(variant, CUT_S);
    const visuals = buildPieceVisuals(model);
    const root = new THREE.Group();
    for (const vis of visuals) root.add(vis.group);
    best(name, 2000, (seed, size) => {
      const st = cubeScramble(model, mulberry32(seed), 14).state;
      for (const vis of visuals) {
        const [x, y, z, w] = model.group.quats[st.orient[vis.pieceId]];
        vis.group.quaternion.set(x, y, z, w);
      }
      return rasterise(root, TANGRAM_FACE, size);
    });
  }
});

it('curvy copter faces', async () => {
  const wasm = await loadManifold();
  for (const [name, variant] of [
    ['curvy-copter', 'cc'],
    ['curvy-copter-plus', 'plus'],
  ] as const) {
    const model = buildModel(variant);
    const geos = model.shapes.map((s) => buildShapeGeometry(wasm, s, defaultCsgOptions()));
    const visuals = buildCurvyVisuals(model, geos);
    const root = new THREE.Group();
    for (const vis of visuals) root.add(vis.group);
    root.add(buildCore());
    // The app's scramble without its final jumbling phase: pieces still swap between orbits (the
    // corner-swapping combo and, on the Plus, the triangle split), but the cube stays flush.
    const opts: ScrambleOptions =
      variant === 'plus'
        ? { halfTurns: 20, comboRounds: 6, splitRounds: 6, jumbles: 0, shapeShifts: 0 }
        : { halfTurns: 20, comboRounds: 6, splitRounds: 0, jumbles: 0, shapeShifts: 0 };
    const states = new Map<number, ReturnType<typeof generateCurvyScramble>['state']>();
    best(name, 40, (seed, size) => {
      let st = states.get(seed);
      if (!st) {
        st = generateCurvyScramble(model, mulberry32(seed), opts).state;
        states.set(seed, st);
      }
      if (!st.isCubeShape()) return null;
      for (const vis of visuals) setCurvyTransform(vis, st.matrix(vis.pieceId));
      return rasterise(root, IDENTITY, size);
    });
  }
}, 600_000);

/**
 * Whether a scrambled Maltese front face (F) reads cleanly at favicon size. A real scramble
 * shape-shifts, and has to: a flush Maltese can only have its corners in whole-cube-rotation
 * positions (all four stars one colour). Tilted gears read fine, but an edge piece standing in the
 * centre slot, a centre sunk into an edge slot, or an edge turned across the face's border, shows up
 * as stray slivers. So the F face's centre slot must hold a centre, and its four edge slots edges
 * lying along their ridge.
 */
function cleanMalteseFace(st: MalteseState): boolean {
  for (const p of MALTESE_PIECES) {
    if (p.kind !== 'centre' && p.kind !== 'edge') continue;
    const slot = st.slot[p.id];
    if (RADIAL_SLOTS[slot].dir[2] < 0.2) continue; // not on the F face
    if (slot < CENTRE_SLOT_COUNT ? p.kind !== 'centre' : p.kind !== 'edge' || st.ori[p.id] % 2 !== 0) return false;
  }
  return true;
}

it('maltese gear cube face', async () => {
  const wasm = await loadManifold();
  const geo = buildMalteseGeometry(wasm, defaultFillet());
  const visuals = buildMalteseVisuals(geo);
  const root = new THREE.Group();
  for (const vis of visuals) root.add(vis.group);
  root.add(buildCoreMesh(geo));
  // The app's own scramble (25 random face turns).
  best('maltese-gear-cube', 2000, (seed, size) => {
    const st = MalteseState.solved();
    st.applyAll(generateMalteseScramble(mulberry32(seed)));
    if (!cleanMalteseFace(st)) return null;
    for (const vis of visuals) setMalteseTransform(vis, st.matrix(vis.pieceId));
    return rasterise(root, IDENTITY, size);
  }, 1);
}, 900_000);
