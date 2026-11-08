import type { Face } from './geometry';

/**
 * Constants for the Maltese Gear Cube. Change them here only.
 *
 * Model units: 1 = the distance from the centre to a face plane = 30 mm (face-to-face 60 mm, measured
 * on the user's puzzle; the museum lists 60 mm too). Sticker outlines live in `outlines.ts`.
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
 * so a gear hub is tan 22.5° = 12.4 mm from its face centre; the photo outlines are scaled from that.
 */
export const DIM = {
  /** Plastic rim around every sticker (sticker → plateau edge). */
  rimMm: 0.3,
  /** Gap left between neighbouring pieces (taken off each piece). */
  gapMm: 0.15,
  /** Corner star plateaus: thickness above the moat floor. */
  plateauMm: 3.0,
  /**
   * The corner stars' two inner arms end in points that rest in the gears' side notches. The photo
   * outlines touch the gear petals by ~0.2 mm there (within the photo fit's accuracy), so those two
   * tips are cut back by this much. Outer arms and fins are untouched.
   */
  armTipCutMm: 0.6,
  /**
   * Bevel along every cube edge: the plateaus stop where the stars end (about 26.6 mm from a face
   * centre) and a flat 45° bevel joins neighbouring faces there.
   */
  bevelStartMm: 26.7,
  /** Corner walls: slabs between these distances from the centre planes (outside every ring channel). */
  wallInnerMm: 10.0,
  wallOuterMm: 14.4,
  /** The see-through tunnel along each body diagonal. */
  tunnelRadiusMm: 1.8,
  /** Gears: petal body depth under the cap (along the gear axis), its taper, and the hub post. */
  gearBodyMm: 3.0,
  gearTaper: 0.35,
  gearPostRadiusMm: 2.1,
  /** Centres and edges share one square column (they swap slots). User's measurement: ≈5.2 mm. */
  columnMm: 5.2,
  /** Inner end of the columns and gear posts, from the centre. */
  innerMm: 18.0,
  /** Edge piece: shoulders 9 mm and crest 11 mm proud of the face when it sits in a centre slot. */
  edgeShoulderMm: 39.0,
  edgeCrestMm: 41.0,
  /** Centre sticker (square) and its corner rounding. */
  centreStickerMm: 3.6,
  stickerRoundMm: 0.4,
  /** Edge stickers: inset from the roof face's edges. */
  edgeStickerInsetMm: 0.35,
  /** Stickers sit just above the plastic. */
  stickerLiftMm: 0.05,
  /** Fixed black core, visible deep in the gaps; tunnels let you see through the corners. */
  coreRadiusMm: 15.6,
};

export const LOOK = {
  bodyColor: '#141416',
  coreColor: '#0b0b0d',
  /** Segments for circular features (core, posts, tunnels). */
  segments: 64,
};

export const TIMING = {
  /** Duration of a quarter turn; longer moves take proportionally a little longer. */
  moveMs: 320,
  fastMoveMs: 80,
};
