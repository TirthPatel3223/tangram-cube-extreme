export type CurvyVariantId = 'cc' | 'plus';

export interface CurvyVariantDef {
  readonly id: CurvyVariantId;
  readonly name: string;
  readonly designYear: number;
  readonly producedYear: number;
  readonly pieces: number;
  readonly shapesPerFace: number;
  /** The Plus splits every X-piece into a big petal and a small "inner corner" triangle. */
  readonly splitX: boolean;
  readonly about: string;
}

export const CURVY_VARIANTS: Readonly<Record<CurvyVariantId, CurvyVariantDef>> = {
  cc: {
    id: 'cc',
    name: 'Curvy Copter',
    designYear: 2010,
    producedYear: 2011,
    pieces: 44,
    shapesPerFace: 12,
    splitX: false,
    about:
      'A Helicopter Cube with curved cuts: each of the 12 edges turns 180°, and the 32° cones reveal edge pieces ' +
      'and the centres’ orientation. Turn an edge 70.5° (Jumble) and two neighbouring edges unlock, which ' +
      'scrambles pieces between orbits and changes the shape; unsplit X-pieces often bandage the next move.',
  },
  plus: {
    id: 'plus',
    name: 'Curvy Copter Plus',
    designYear: 2010,
    producedYear: 2014,
    pieces: 68,
    shapesPerFace: 16,
    splitX: true,
    about:
      'The Curvy Copter with every X-piece split into a petal and a small dotted triangle. The triangles are ' +
      '"inner corners": jumbling swaps them with real corners (which then stand proud), and twisting one in ' +
      'place blocks the edges opposite it. Jumble stops are at 70.5° and 109.5°.',
  },
};
