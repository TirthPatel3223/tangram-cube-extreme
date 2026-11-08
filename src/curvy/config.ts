/**
 * Constants for the Curvy Copter family. Change them here only.
 *
 * Model units: the cube is [-1, 1]^3, so 1 unit = half the edge length.
 */

/**
 * Tilt of every cut cone away from the Helicopter Cube's flat cut, in degrees. Meffert's product
 * text (written with the designer) says: "the cutting line is placed at an angle of 32 degrees to
 * give parabolic cuts". A least-squares fit to a face-on photo of a real Curvy Copter Plus gave
 * 32.5° (32° and 33° fit almost equally well; 28° and 36° clearly worse).
 */
export const CUT_TILT_DEG = 32;

/** Edge length of the real puzzle (TwistyPuzzles museum: 57 mm; the Plus is "the same size"). */
export const EDGE_MM = 57;

/** Model units per millimetre. */
export const MM = 2 / EDGE_MM;

/**
 * Radius of the fixed central core. Every cut cone's apex is 0.265 from the centre; only the edge
 * pieces reach inside 0.48, so the core only trims the edges' stalks.
 */
export const CORE_R = 0.45;

/**
 * The edge pieces' lens-shaped stickers taper to a sliver at each face centre. The real pieces stop
 * about 0.27 from the face centre (photo), so the sliver within this distance of the face's centre
 * line (and above TIP_DEPTH along it) is cut away.
 */
export const EDGE_TIP_R = 0.26;
export const EDGE_TIP_DEPTH = 0.5;

/**
 * Turn legality.
 * - EXACT_TOL: a piece counts as straddling a cut only if it crosses it by more than this (units).
 *   Aligned cuts give values around 1e-15.
 * - OVERLAP_TOL: how far one piece may push into another during a turn before the turn is blocked.
 *   The real puzzle has gaps and rounded edges, so tiny overhangs into empty space don't stop it,
 *   while real collisions do.
 */
export const EXACT_TOL = 1e-6;
export const OVERLAP_TOL = 0.3 * MM;
/** Angular step of the swept-collision check along a turn. */
export const SWEEP_STEP_DEG = 2;

/** Spacing of the surface sample points used for legality checks (units). */
export const SAMPLE_SPACING = 0.025;

/**
 * Solved colours, standard scheme: white top, green front, red right (yellow / blue / orange opposite).
 * Shared hex values with the Tangram app so the two look like the same sticker set.
 */
export const COLORS = {
  U: '#f5f5f2', // white
  D: '#ffd21f', // yellow
  F: '#11a94f', // green
  B: '#1557d6', // blue
  R: '#d0142c', // red
  L: '#ff6a13', // orange
} as const;

/** Physical look in millimetres (converted with MM). Sticker inset fitted to the photo: 2.1 mm. */
export const LOOK = {
  bodyColor: '#141416',
  coreColor: '#0b0b0d',
  gapMm: 0.35, // gap between neighbouring pieces
  stickerInsetMm: 2.1, // from the cut line to the sticker edge
  stickerRadiusMm: 1.2, // sticker corner rounding
  stickerLiftMm: 0.06, // stickers sit just above the plastic
  dotDiameterMm: 3.1, // the black dot on the Plus's small triangles
  coneSegments: 256, // smoothness of the curved cuts
  // Rounded piece edges (rolling-ball fillets, see render/fillet.ts). The outer radius matches the
  // Tangram's 0.55 mm bevel; edges between two cuts only show mid-turn or when jumbled.
  edgeRoundMm: 0.55, // where a cut meets a face, and the cube's own edges
  cutRoundMm: 0.3, // where two cuts (or a cut and the core) meet
  // Fillet resolution. The normals are analytic, so a coarse mesh still shades smoothly.
  filletStepMm: 1.0, // spacing of the fillet's profiles along each edge
  filletArcStepDeg: 15, // largest angle between neighbouring points across a fillet
};

export const TIMING = {
  /** Duration of a 180-degree turn; partial turns are a little quicker. */
  moveMs: 300,
  fastMoveMs: 70,
};
