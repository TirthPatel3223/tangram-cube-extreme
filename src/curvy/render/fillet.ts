import { type Vec3, dot, length, normalize, scale, sub } from '../../puzzle/vec';
import type { Surface } from '../../render/fillet';
import { CORE_R, EDGE_TIP_DEPTH, EDGE_TIP_R } from '../config';
import { APEX, COS_A, type Constraint, FACE_NORMAL, SIN_A } from '../geometry';

/**
 * The analytic surfaces of the curved puzzles' pieces, for the rolling-ball rounding in
 * `src/render/fillet.ts`. Every piece is an intersection of smooth regions (cube faces, cones, the core
 * sphere, the tip cylinders), so every crease between two of its surfaces is a convex edge.
 */
export {
  type Crease,
  type FilletOptions,
  type Surface,
  creaseRemovers,
  findCreases,
  projectPair,
  triangleOrigins,
  triangleSurface,
} from '../../render/fillet';

export interface ShapeSurfaces {
  readonly surfaces: readonly Surface[];
  /** For each constraint of the shape, the surfaces it contributes. */
  readonly byConstraint: readonly (readonly number[])[];
}

function coneNormal(p: Vec3, a: Vec3): Vec3 {
  const d = sub(p, scale(a, APEX));
  const perp = sub(d, scale(a, dot(d, a)));
  const pl = length(perp);
  if (pl < 1e-12) return scale(a, -1);
  return sub(scale(perp, COS_A / pl), scale(a, SIN_A));
}

function coneValue(p: Vec3, a: Vec3): number {
  const d = sub(p, scale(a, APEX));
  const along = dot(d, a);
  const perp = Math.sqrt(Math.max(0, dot(d, d) - along * along));
  return perp * COS_A - along * SIN_A;
}

/** The analytic surfaces of a shape whose cut surfaces are moved `shrink` into the piece (cube faces stay). */
export function shapeSurfaces(constraints: readonly Constraint[], shrink: number): ShapeSurfaces {
  const surfaces: Surface[] = [];
  const byConstraint: number[][] = [];
  const addSurface = (s: Surface) => surfaces.push(s) - 1;
  for (const c of constraints) {
    const group = surfaces.length;
    switch (c.kind) {
      case 'cube':
        byConstraint.push(
          Object.values(FACE_NORMAL).map((n, i) =>
            addSurface({ kind: 'face', g: (p) => dot(n, p) - 1, n: () => n, outer: true, group: group + i }),
          ),
        );
        break;
      case 'cone': {
        const s = c.inside ? 1 : -1;
        byConstraint.push([
          addSurface({
            kind: 'cone',
            g: (p) => s * coneValue(p, c.axis) + shrink,
            n: (p) => scale(coneNormal(p, c.axis), s),
            outer: false,
            group,
          }),
        ]);
        break;
      }
      case 'core': {
        const R = CORE_R + shrink;
        byConstraint.push([
          addSurface({
            kind: 'core',
            g: (p) => R - length(p),
            n: (p) => scale(normalize(p), -1),
            outer: false,
            group,
          }),
        ]);
        break;
      }
      case 'tip': {
        // The body is outside the cylinder OR below its end cap: those two surfaces meet in a concave crease.
        const f = c.face;
        const R = EDGE_TIP_R + shrink;
        const h0 = EDGE_TIP_DEPTH - shrink;
        const radial = (p: Vec3) => sub(p, scale(f, dot(p, f)));
        byConstraint.push([
          addSurface({
            kind: 'tipSide',
            g: (p) => R - length(radial(p)),
            n: (p) => scale(normalize(radial(p)), -1),
            outer: false,
            group,
            union: true,
          }),
          addSurface({ kind: 'tipCap', g: (p) => dot(p, f) - h0, n: () => f, outer: false, group, union: true }),
        ]);
        break;
      }
    }
  }
  return { surfaces, byConstraint };
}
