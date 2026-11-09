import type { Face } from './geometry';
import { PADDING_MM, STAR_MM } from './stickers';

/**
 * Constants for the Maltese Gear Cube. Change them here only.
 *
 * Model units: 1 = the distance from the centre to a face plane = 30 mm (face-to-face 60 mm, measured
 * on the user's puzzle; the museum lists 60 mm too). Sticker outlines live in `stickers.ts`.
 */
export const EDGE_MM = 60;
/** Model units per millimetre. */
export const MM = 2 / EDGE_MM;

/** Solved colours (user's choice): white top, green front, purple right. */
export const COLORS: Readonly<Record<Face, string>> = {
  U: '#f5f5f2', // white
  D: '#ffd21f', // yellow
  F: '#11a94f', // green
  B: '#1557d6', // blue
  R: '#8b3ec2', // purple (the puzzle's sixth colour, sampled from photos)
  L: '#d0142c', // red
};

/**
 * Piece geometry (mm unless noted). The gear axes sit 22.5° from the face normals (symmetry forces it),
 * so a gear hub is tan 22.5° = 12.43 mm from its face centre; the fitted sticker outlines are scaled
 * from that (see stickers.ts).
 *
 * Every piece body is a cone from the cube centre over its plateau (the sticker plus the padding):
 * its cross-sections are the plateau shrunk towards the centre, down to the core ball.
 */
const STICKER_ROUND_MM = 0.4;
export const DIM = {
  /** Plastic margin around every sticker, the same on every piece (fitted: the largest that fits). */
  paddingMm: PADDING_MM,
  /** Gap left between neighbouring pieces (taken off each column; the fit keeps plateaus this far apart). */
  gapMm: 0.15,
  /** Bevel along every cube edge: it starts one padding past the ends of the stars' sticker arms. */
  bevelStartMm: STAR_MM.ue + PADDING_MM,
  /**
   * The hollow cube at each vertex: [this, 30 mm]^3, the face's corner square beyond the stars' outer
   * arms (their plastic edges sit exactly here). The core ball is cut back to it.
   */
  vertexBoxMm: STAR_MM.yu + PADDING_MM,
  /** Centres and edges share one square column (they swap slots). User's measurement: ≈5.2 mm. */
  columnMm: 5.2,
  /** Column corners, rounded so the centre sticker keeps the padding at its rounded corners too. */
  columnRoundMm: STICKER_ROUND_MM + PADDING_MM,
  /** Columns are straight from their top down to this far below the face plane, then coned to the core. */
  columnStraightMm: 2.0,
  /** Edge piece: shoulders 9 mm and crest 11 mm proud of the face when it sits in a centre slot. */
  edgeShoulderMm: 39.0,
  edgeCrestMm: 41.0,
  /** Corner rounding of the centre sticker. */
  stickerRoundMm: STICKER_ROUND_MM,
  /** Stickers sit just above the plastic. */
  stickerLiftMm: 0.05,
  /**
   * The fixed core: a hollow ball (a shell this thick) that nearly reaches the centre pieces, every piece
   * resting on it. At each vertex it is cut back to the hollow cube, which opens into its empty middle,
   * so you can see through the puzzle there and only there.
   */
  coreRadiusMm: 28.0,
  coreShellMm: 2.0,
  /** Rolling-ball rounding: plateau rims, bevels and column tops (never more than the padding allows). */
  roundOuterMm: Math.min(0.5, PADDING_MM - 0.1),
  /** Rolling-ball rounding of edges between two inner surfaces (none on the current pieces). */
  roundInnerMm: 0.3,
};

export const LOOK = {
  bodyColor: '#141416',
  coreColor: '#0b0b0d',
  /** Segments for circular features (tunnels) and for the core ball. */
  segments: 64,
  coreSegments: 96,
  /** Segments per full circle for the rounded joins of the plateau outlines. */
  offsetSegments: 72,
  /** Profiles along each rounded crease, and the largest angle between points of one fillet arc. */
  filletStepMm: 1.0,
  filletArcStepDeg: 15,
};

export const TIMING = {
  /** Duration of a quarter turn; longer moves take proportionally a little longer. */
  moveMs: 320,
  fastMoveMs: 80,
};
