import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/puzzle/moves';
import { type Mat3, type Vec3, axisAngleMat3, mat3Mul, mat3Vec } from '../../src/puzzle/vec';
import { CORNER_SLOTS, FACES, GEAR_SLOTS, GEAR_TILT, RADIAL_SLOTS } from '../../src/maltese/geometry';
import { PIECES } from '../../src/maltese/model';
import { quarterTable } from '../../src/maltese/moves';
import { type Move, invertSequence, parseAlgorithm } from '../../src/maltese/notation';
import { generateScramble } from '../../src/maltese/scramble';
import { MalteseState } from '../../src/maltese/state';

const alg = (text: string): Move[] => {
  const r = parseAlgorithm(text);
  if (!r.ok) throw new Error(r.error);
  return r.moves;
};
const after = (text: string): MalteseState => {
  const st = MalteseState.solved();
  st.applyAll(alg(text));
  return st;
};
const close = (a: Mat3, b: Mat3) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
const pieceAt = (st: MalteseState, kind: 'radial' | 'gear', slotName: string) => {
  const slots = kind === 'gear' ? GEAR_SLOTS : RADIAL_SLOTS;
  const s = slots.findIndex((x) => x.name === slotName);
  return PIECES.find((p) => (kind === 'gear' ? p.kind === 'gear' : p.kind === 'centre' || p.kind === 'edge') && st.slot[p.id] === s)!;
};

describe('slots and pieces', () => {
  it('has 8 corner, 18 radial (6 centre + 12 edge) and 24 gear slots, and 50 pieces', () => {
    expect(CORNER_SLOTS).toHaveLength(8);
    expect(RADIAL_SLOTS).toHaveLength(18);
    expect(RADIAL_SLOTS.filter((s) => s.kind === 'centre')).toHaveLength(6);
    expect(GEAR_SLOTS).toHaveLength(24);
    expect(PIECES).toHaveLength(50);
  });

  it('places every gear 22.5° from its face normal, its hub 0.414 from the face centre', () => {
    for (const g of GEAR_SLOTS) {
      const n: Vec3 = g.face === 'U' ? [0, 1, 0] : g.face === 'D' ? [0, -1, 0] : g.face === 'F' ? [0, 0, 1] : g.face === 'B' ? [0, 0, -1] : g.face === 'R' ? [1, 0, 0] : [-1, 0, 0];
      const c = g.dir[0] * n[0] + g.dir[1] * n[1] + g.dir[2] * n[2];
      expect(Math.acos(c)).toBeCloseTo(GEAR_TILT, 12);
      expect(Math.tan(Math.acos(c))).toBeCloseTo(0.41421356, 6);
    }
  });

  it('every slot frame is a right-handed rotation', () => {
    for (const s of [...RADIAL_SLOTS, ...GEAR_SLOTS]) {
      const m = s.frame;
      const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
      expect(det).toBeCloseTo(1, 12);
    }
  });
});

describe('moves', () => {
  it('a face turn moves its 17-piece layer 90° and its 16-piece ring 45°', () => {
    const st = MalteseState.solved();
    for (const f of FACES) {
      const { layer, ring } = st.movingParts(f);
      expect(layer).toHaveLength(17);
      expect(ring).toHaveLength(16);
      const kinds = (ids: number[]) => ids.map((i) => PIECES[i].kind).sort().join(',');
      expect(kinds(ring)).toBe(['centre', 'centre', 'centre', 'centre', 'edge', 'edge', 'edge', 'edge', ...Array(8).fill('gear')].sort().join(','));
    }
  });

  it('move tables are permutations of the slots', () => {
    for (const f of FACES) {
      for (const d of [1, -1] as const) {
        const t = quarterTable(f, d);
        const tos = (steps: readonly ({ to: number } | null)[]) => steps.map((s, i) => (s ? s.to : i)).sort((a, b) => a - b);
        expect(tos(t.radial)).toEqual(RADIAL_SLOTS.map((_, i) => i));
        expect(tos(t.gear)).toEqual(GEAR_SLOTS.map((_, i) => i));
      }
    }
  });

  it.each(FACES)('%s has order 8 (its ring needs 8 × 45°)', (f) => {
    const st = MalteseState.solved();
    for (let i = 1; i <= 8; i++) {
      st.apply({ face: f, amount: 1 });
      expect(st.isSolved(), `${f}^${i}`).toBe(i === 8);
    }
  });

  it.each(FACES)('%s4 turns the ring half way round and leaves everything flush', (f) => {
    const st = MalteseState.solved();
    st.apply({ face: f, amount: 4 });
    expect(st.isCubeShape()).toBe(true);
    expect(st.isSolved()).toBe(false);
  });

  it("X2 and X2' are different moves", () => {
    for (const f of FACES) expect(after(`${f}2`).equals(after(`${f}2'`))).toBe(false);
  });

  it('a move followed by its inverse is the identity', () => {
    for (const f of FACES) {
      expect(after(`${f} ${f}'`).isSolved()).toBe(true);
      expect(after(`${f}2' ${f}2`).isSolved()).toBe(true);
    }
  });

  it('U and D commute; U D leaves the E ring in place with its 8 gears turned 180°', () => {
    const ud = after('U D');
    expect(ud.equals(after('D U'))).toBe(true);
    const e = PIECES.filter((p) => p.kind === 'gear' && GEAR_SLOTS[p.home].ring === 1);
    expect(e).toHaveLength(8);
    for (const p of e) {
      expect(ud.slot[p.id]).toBe(p.home);
      expect(ud.ori[p.id]).toBe(2);
    }
  });

  it("U D' is the whole-cube rotation y (every piece turned 90° the U way, no net gear spin)", () => {
    const st = after("U D'");
    const solved = MalteseState.solved();
    const y = axisAngleMat3([0, 1, 0], -Math.PI / 2);
    for (const p of PIECES) expect(close(st.matrix(p.id), mat3Mul(y, solved.matrix(p.id))), p.name).toBe(true);
  });

  it('a random walk followed by its inverse returns to solved', () => {
    const rng = mulberry32(12345);
    for (let trial = 0; trial < 20; trial++) {
      const moves = generateScramble(rng, 40);
      const st = MalteseState.solved();
      st.applyAll(moves);
      st.applyAll(invertSequence(moves));
      expect(st.isSolved()).toBe(true);
    }
  });
});

describe('shape-shifting', () => {
  it('after U: centres sink into the E-ring edge slots and edges stand in the centre slots', () => {
    const st = after('U');
    expect(st.shapeReport()).toEqual({ edgesProud: 4, centresSunk: 4, edgesRotated: 0, gearsTilted: 8 });
    expect(pieceAt(st, 'radial', 'F').name).toBe('FR'); // the FR edge now stands in the F centre slot
    expect(pieceAt(st, 'radial', 'FL').name).toBe('F'); // the F centre sits in the FL edge slot
  });

  it('after U the front middle gears have their upper half proud (they spin counterclockwise)', () => {
    const st = after('U');
    const g = pieceAt(st, 'gear', 'Fl'); // the gear that started right of the F centre
    expect(g.name).toBe('Fr');
    expect(st.ori[g.id]).toBe(3);
    // Cap normal of the prototype: tilted 22.5° from its axis towards the face centre (local +y).
    const cap: Vec3 = [0, Math.sin(GEAR_TILT), Math.cos(GEAR_TILT)];
    const n = mat3Vec(st.matrix(g.id), cap);
    expect(n[1]).toBeLessThan(-0.3); // faces slightly down, so its upper half stands out of the face
  });

  it('gear tilts from a flush cap: k = 1 or 3 → 31.4°, k = 2 → 45°', () => {
    const cap: Vec3 = [0, Math.sin(GEAR_TILT), Math.cos(GEAR_TILT)];
    const tilt = (text: string, slotName: string) => {
      const st = after(text);
      const g = pieceAt(st, 'gear', slotName);
      const n = mat3Vec(st.matrix(g.id), cap);
      return (Math.acos(n[2]) * 180) / Math.PI; // F-face gears: angle from +z
    };
    expect(tilt('U', 'Fl')).toBeCloseTo(31.4, 1);
    expect(tilt('U2', 'Fl')).toBeCloseTo(45, 6);
    expect(tilt('U3', 'Fl')).toBeCloseTo(31.4, 1);
    expect(tilt('U4', 'Fl')).toBeCloseTo(0, 6);
  });

  it('U2 tilts all 8 E-ring gears 45°; U4 makes them flush again', () => {
    expect(after('U2').shapeReport()).toEqual({ edgesProud: 0, centresSunk: 0, edgesRotated: 0, gearsTilted: 8 });
    expect(after('U4').shapeReport()).toEqual({ edgesProud: 0, centresSunk: 0, edgesRotated: 0, gearsTilted: 0 });
  });

  it('U R turns the FR edge 90° in the UF slot (as in the user’s photo of a rotated edge)', () => {
    const st = after('U R');
    const e = pieceAt(st, 'radial', 'UF');
    expect(e.name).toBe('FR');
    expect(st.ori[e.id] % 2).toBe(1);
  });
});
