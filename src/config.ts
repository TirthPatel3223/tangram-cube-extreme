import type { FaceId } from './puzzle/pieces';

/**
 * Cut offset as a fraction of the edge length. Fitted (least squares over all six families of cut
 * lines) to a face-on photo of a real Tangram Cube Extreme: 0.31 to 0.316. Change it here only.
 */
export const CUT_S = 0.31;

/**
 * Solved colours. From the retail photo (green top, white left, orange right) plus the standard
 * opposite-colour scheme; the turning corners are orange/yellow/green and red/white/blue.
 */
export const FACE_COLORS: Readonly<Record<FaceId, string>> = {
  '+x': '#ff6a13', // orange
  '+y': '#ffd21f', // yellow
  '+z': '#11a94f', // green
  '-x': '#d0142c', // red
  '-y': '#f5f5f2', // white
  '-z': '#1557d6', // blue
};

/** Physical look, in millimetres (converted to model units using the variant's edge length). */
export const LOOK = {
  bodyColor: '#141416',
  gapMm: 0.35, // gap between neighbouring pieces
  bevelOuterMm: 0.55, // bevel width on the outer (sticker) faces of the plastic
  bevelInnerMm: 0.12, // bevel width on the hidden cut faces (kept small so the rim stays even)
  stickerMarginMm: 1.0, // black border around every sticker
  stickerRadiusMm: 1.1, // sticker corner rounding
  stickerLiftMm: 0.06, // stickers sit just above the plastic
};

export const TIMING = {
  moveMs: 280,
  fastMoveMs: 70,
};
