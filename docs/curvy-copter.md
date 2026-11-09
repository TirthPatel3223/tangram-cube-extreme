# Curvy Copter and Curvy Copter Plus: research notes

These notes record what the two puzzles are, how they move, how their exact curved cut geometry
was established, and how the app models jumbling and bandaging.

## Identity

| | Curvy Copter | Curvy Copter Plus |
|---|---|---|
| Designer | Tom van der Zanden (TomZ), 2010 | Tom van der Zanden, 2010 |
| Mass production | Meffert's, 2011 | Meffert's, 2014 |
| Museum | [pkey 1574](https://twistypuzzles.com/app/museum/museum_showitem.php?pkey=1574), Cube (Shape Preserving) | [pkey 1687](https://twistypuzzles.com/app/museum/museum_showitem.php?pkey=1687), Cube (Shape Changing) |
| Edge length | 57 mm | "the same size as a regular Curvy Copter" |
| Pieces | 44: 12 edges, 8 corners, 24 X-pieces | 68: 12 edges, 8 corners, 24 petals, 24 small triangles |
| Shapes per face | 12 | 16 |

- **Curvy Copter.** A Helicopter Cube with curved cuts that "reveal the otherwise hidden centre pieces" (museum). The cuts also expose 12 edge pieces.
- **Curvy Copter Plus.** The museum calls it "a Curvy Copter with split up X-pieces". Splitting them removes much of the bandaging that jumbling causes on the Curvy Copter. It "still has overhang bandaging".

## How it moves

- **Axes.** Every one of the 12 edges turns about its axis (towards the edge midpoint).
  - 180° turns keep the cube shape.
  - The edge piece flips in place; it never leaves its slot.
- **Jumbling.** Turn an edge part way, and at certain angles the cuts of two of its four neighbours line up again inside the turned part. Those neighbours can then turn, carrying pieces into other orbits and changing the shape.
- **Stop angles.** The stops are at **arccos(1/3) = 70.53°** and **109.47°**, then 180°.
  - Seen down an edge axis, its four neighbours' axes sit at azimuths ±54.74° and ±125.26°.
  - A turn of 70.53° carries one neighbour's cut onto another's; 109.47° does the same for the other pair.
  - So the stop angles follow from the axis system alone, for any cut shape.
  - A 60° turn unlocks nothing (tested). The "60°" click felt on the real puzzle is this 70.53° stop.
- **Exact matrices.** At these angles the turn matrices are rational (entries k/3), so the app represents orientations exactly.

## Exact cut geometry

The cube is `[-1, 1]^3`, with x = R, y = U and z = F.

### The cuts are cones

Meffert's product page (with the designer's text) says:

> Instead of normal planar cuts, the cutting line is placed at an angle of 32 degrees to give parabolic cuts.

A turning part must be a solid of revolution about its axis, so a "tilted cutting line" is a cone.
- **Shape.** The Helicopter Cube's flat cut through the two neighbouring face centres, tilted 32° about those centres, gives a cone of **half-angle 58°**.
- **Apex.** It lies on the edge axis at `APEX = (1 − tan 32°)/√2 = 0.26526` from the centre.
- **Moving part.** An edge's moving part is everything inside its cone.

### Fit to a face-on photo of the user's puzzle

The face corners were rectified with a homography. Then the homography, the cone tilt and a uniform sticker inset were least-squares fitted to the outlines of 18 stickers (robust loss).

| Tilt θ | 26° | 28° | 30° | 31° | **32°** | **33°** | 34° | 36° | 38° |
|---|---|---|---|---|---|---|---|---|---|
| RMS residual (units) | 0.0277 | 0.0263 | 0.0218 | 0.0199 | **0.0188** | **0.0185** | 0.0190 | 0.0221 | 0.0264 |

- **Tilt.** The best fit is about 32.5°, matching the stated 32°. The app uses `CUT_TILT_DEG = 32` in `src/curvy/config.ts`.
- **Apex position.** Moving the apex ±0.02 off "through the face centres" fits clearly worse (0.0247 / 0.0214 versus 0.0188), so the cones do pass through the face centres.
- **Sticker inset.** The inset from the cut line came out at 0.073 units, about **2.1 mm** at 57 mm.
- **Consequences on each face.**
  - A corner's arc meets the face edge 0.348 from the edge midpoint.
  - The corner stickers are convex (they bulge towards the face centre); the photo shows a sagitta ratio of 0.072 against 0.068 predicted.

### The Plus split: small triangles are "inner corners"

- **The extra cut.** Each X-piece of the Curvy Copter (on face `n`, next to corner `c`) is split by one extra cone, of the same size, with axis `X = (4n − c⊥)/√18`. For example, the F-face piece next to UFR uses `X = (−1,−1,4)/√18`.
  - This cone is the FR cone turned −70.53° about UF, i.e. the edge cone carried by one jumble turn.
  - The part inside it is the small dotted triangle. On the face the cut crosses the diagonal 0.360 from the centre, which matches the photo.
- **Why triangles and corners swap.**
  - A triangle is bounded by three cones (UF, FR, X) that are mutually 60° apart and symmetric about the axis (1,1,5)/√27, exactly like a corner's three cones about (1,1,1).
  - Corners and triangles are therefore mechanically identical: a jumble moves corners into triangle slots and triangles into corner holes.
  - Only their outer faces differ. A corner in a triangle slot stands about 18.6 mm proud (photo 4); a triangle in a corner slot sits deep in a black hole (photo 5).
- **Twisted pieces.** The triangle's 3-fold axis is tilted 15.8° from the face normal. A triangle twisted by 120° in a slot is therefore no longer flush: it tilts about 27° and stands about 4 mm proud (photo 2).
- **Flipped petals.** Each petal has a 2-fold axis, (1,1,2)/√6 for F·UFR, which swaps its corner cone with its X cone. A flipped petal stands proud in the same way (photo 3).

### Pieces

Every piece also lies inside the cube and outside a core sphere of radius 0.45.

| Piece | Inside cones | Outside cones |
|---|---|---|
| Edge | own | its 4 neighbours |
| Corner | its 3 edges | |
| X-piece (Curvy Copter) | 2 face-edge cones | the third cone at that corner |
| Petal (Plus) | 2 face-edge cones | the third corner cone and its X cone |
| Triangle (Plus) | 2 face-edge cones and its X cone | |

- **Edge tips.** The edge lens tapers to a sliver at each face centre. The real pieces stop about 0.27 from the centre (photo), so the model trims the sliver within 0.26 of the face's centre line (`EDGE_TIP_R`).
- **Checks** (`tests/curvy/geometry.test.ts`):
  - every sampled point outside the core is in exactly one piece;
  - pieces of one kind are congruent;
  - the 24 cube rotations of 3 or 4 prototype shapes give all 44 or 68 pieces.

## Legality: how bandaging is modelled

A turn is checked against the real 3D piece shapes. Each shape carries a few thousand surface sample points, and point-in-piece tests are exact constraint checks, so no mesh is involved.

1. **Free turns.** If no piece crosses the edge's cut cone (by more than 1e-6), the turn is free. This is the normal case, with the cuts aligned.
2. **Assigning crossing pieces.**
   - Edge pieces are screwed to the core on their own axis and never ride along.
   - Any other crossing piece goes with the side that holds most of it.
3. **Swept collision.** The turn is swept in 2° steps along its actual path. If a piece would push more than **0.3 mm** (`OVERLAP_TOL`) into another, the turn is blocked, and those pieces are reported and shown in red.
   - Overhangs into empty space don't block; real collisions do.
   - This covers both kinds of bandaging: misaligned cuts ("primary" edge pieces in the way), and overhang from pieces sticking out (corners in triangle slots, twisted triangles).
4. **Stops.**
   - A jumble stop is an angle where one of the moving pieces' cone axes lands exactly on another edge's axis, with that edge's cut crossed just before and just after.
   - Candidates are computed exactly with atan2 from the vectors.
   - Stops beyond a blocked part of the path are not offered.

## Behaviours reproduced (tests in `tests/curvy/`)

| Behaviour | Both | Plus | Curvy Copter |
|---|---|---|---|
| From a cube, every edge turns 180° both ways; each edge part holds 7 (Curvy Copter) or 11 (Plus) pieces | ✓ | | |
| Stops at ±70.53° (2 neighbours unlock), ±109.47° (the other 2) and 180° (all 4); nothing unlocks at 60° | ✓ | | |
| User's example: UL anticlockwise, FR anticlockwise (to the first stop), then UF 180° | ✓ | | |
| User's combo `UL- FR- UF FR+ UL+` (and all 48 rotated or mirrored versions) returns a flush, fully turnable cube with pieces moved between orbits | ✓ | | |
| After `UF+`, UR and FL are blocked by the turned edge piece, and UB and DF by its corner and petal | ✓ | | |
| The forum commutator `UR+ UF- UR- UF+` has order 6 | | ✓ | |
| `UF+ UL UF-` puts two corners in triangle slots 0.654 units (about 18.6 mm) proud and two triangles in corner holes; FR, FL, DF and DL are then blocked | | ✓ | |
| Commutator ×3: twisted triangles stand proud and block the edges across their faces (UB, UL, FL, BR, DF, DR) | | ✓ | |
| The commutator's third move (UR-) is blocked by an unsplit X-piece: the bandaging the Plus removes | | | ✓ |

## Notation

- `UF` is a 180° turn of the UF edge.
- `UF+` / `UF-` turn UF clockwise / anticlockwise (seen from outside, looking at the edge) to its next stop.
  - This is the TwistyPuzzles forum convention for jumbling copters.
  - Stops depend on the state, so the move history stores the exact angle.

## Scramble (the user's recipe)

1. 20 random 180° turns.
2. Shape-preserving algorithms, each in a random orientation (24 rotations, plain or mirrored) and each followed by two or three 180° turns. The cube stays flush.
   - Curvy Copter: six rounds of the user's combo `UL- FR- UF FR+ UL+`.
   - Curvy Copter Plus (2026-11-09): six combos and six rounds of the user's triangle-splitting algorithm, shuffled together. The algorithm is `UR+ DL+ BR- BR- BR- DF- DF- DF- UR- DL- DR+ DR+ DR+ DL+ UR+ DF+ DF+ DF+ DL- BR+ BR+ BR+ UR-`. It separates the small triangles from the pieces next to them and returns a flush cube. All 48 orientations are legal from any flush state. It needs the split X-pieces: on the original Curvy Copter, move 9 is bandaged.
3. Real jumbling.
   - Curvy Copter: two jumble blocks `A± B A∓`. B is a neighbour unlocked by A's stop and is turned 180°; A returns exactly to where it started. Pieces end up swapped between kinds and the shape changes.
   - Curvy Copter Plus: the user's shape-shifting algorithm `UF- UR+ UF+ UR- UF- UR+ UF+ UR- FR- UF+ FR+ UF- FR- UF+ FR+ UF-`, twice, each time in a random orientation. One run swaps a corner with a small triangle. An orientation that would bring back the cube shape is skipped.

## Checks to do on the physical puzzle

Each of these is a prediction from the model, and a mismatch would point to a constant to tune in `src/curvy/config.ts`.

1. Turn UF clockwise to its first stop. UL and FR turn; UR and FL don't. UB and DF should also be blocked (by the swung-out corner and petal).
2. After `UF+ UL UF-`, two corners stand proud of the F and L faces, and FR, FL, DF and DL are blocked.
3. `UR+ UF- UR- UF+`, done six times, returns the puzzle to solved.
4. `UL- FR- UF FR+ UL+` brings the cube back to a flush shape.

## Sources

- Meffert's product page, Curvy Copter (archived): "the cutting line is placed at an angle of 32 degrees" <https://www.cs.brandeis.edu/~storer/JimPuzzles/RUBIK/HelicopterCurvy/Notes/CurvyCopterMeffertsPage.pdf>
- TwistyPuzzles museum: Curvy Copter <https://twistypuzzles.com/app/museum/museum_showitem.php?pkey=1574>; Curvy Copter Plus <https://twistypuzzles.com/app/museum/museum_showitem.php?pkey=1687>
- TwistyPuzzles forum:
  - "Curvy Copter plus" (TomZ's announcement; Matt Galla on "Liberty unbandaging" and corners ≡ small triangles) <https://twistypuzzles.com/forum/viewtopic.php?t=19131>
  - "How to solve the Mefferts Curvy Copter Plus?" (notation `UR+`/`UF-`, the order-6 commutator, overhang bandaging) <https://twistypuzzles.com/forum/viewtopic.php?t=26929>
  - "Curvy Copter Plus Twist" <https://twistypuzzles.com/forum/viewtopic.php?t=31431>
  - "Curvy Copter - Now on Shapeways" <https://twistypuzzles.com/forum/viewtopic.php?t=16267>
- Tom van der Zanden, Curvy Copter and Curvy Copter plus pages <https://www.tomvanderzanden.nl/puzzle.php?puz=Curvy+Copter>
- J. Scherphuis, Helicopter Cube (jumbling, orbits, Curvy Copter edge parity) <https://www.jaapsch.net/puzzles/helicopter.htm>
- Wikipedia, Helicopter Cube <https://en.wikipedia.org/wiki/Helicopter_Cube>
- O. van Deventer and B. Cohen, "Twisty Puzzles that Jumble" <https://twistypuzzles.com/articles/other-twistypuzzlesthatjumble>
- TheCubicle, Meffert's Curvy Copter Plus (product photos) <https://www.thecubicle.com/products/mefferts-curvy-copter-plus>
- Five photos of the user's own Curvy Copter Plus (not included in the repository).
