# DaYan Tangram Cube Extreme: research notes

These notes record what the puzzle is, how it moves, and how its exact cut geometry was established for this simulator.

## Identity

| | Tangram Cube | Tangram Cube Extreme |
|---|---|---|
| Inventor | Daqing Bao | Daqing Bao |
| Producer | DaYan | DaYan |
| Year | 2016 | 2017 (some shops say 2016) |
| Edge length | 59 mm | 61 mm |
| Shapes per face | 7 ("七巧板", tangram) | 11 ("十一巧板", printed on the box as "11 Tangram Magic Cube") |
| Museum section | Cube (Shape Preserving) | Cube (Shape Changing) |
| Mechanism | 3-layer prism | 3-layer prism |
| Piece-type signature | `PIII1mp[RX3a1/ T3]` | `PIII2mp[O T1 X2 T3][]` (bandaged variant) |

The Twisty Puzzles museum describes the original as "a triangular prism transformed into a cube but with six identically looking sides". It describes the Extreme as "a Tangram Cube with additional stored cuts. A bandaged hexagonal prism in shape of a cube."

In Andreas Nortmann's signature notation:
- `PIII` means three side axes lying in one plane, plus the perpendicular prism axis.
- The digit is the number of cuts per side axis: 1 for the triangular prism, 2 for the hexagonal prism.
- `m` and `p` mean there is a middle layer and a pair of outer layers, i.e. three layers.

## How it moves

- **Prism axis.** The prism's main axis is a body diagonal of the cube, joining two opposite *turning corners*.
- **Corner layers.** The layer around each turning corner turns about that diagonal:
  - 120° steps on the original;
  - 60° steps on the Extreme.
- **Edge flips.** The prism's side axes are the three cube-edge axes perpendicular to the diagonal. Each flips a slab by 180°.
- **Middle layer.** On the Extreme, the middle layer keeps only the original three cuts. That is the "bandaging": only 3 of a hexagonal prism's 6 side turns exist. The museum puts it as "the middle layer allows only three turns".
- **Original stays a cube.** All of the original's moves are symmetries of the cube, so it never changes shape.
- **Extreme shape-shifts.** A 60° corner turn is not a cube symmetry. A single such turn pushes 16 of the 19 corner-layer pieces outside the cube outline.

## Jumbling vs. shape-shifting

Oskar van Deventer and Bram Cohen give the strict definition: "A twisty puzzle 'jumbles' when it cannot be unbandaged into a doctrinaire puzzle". A doctrinaire puzzle is one that "returns to the same three-dimensional shape after each turn". The Helicopter Cube is the classic jumbler: turn an edge about 70.5° and neighbouring edges can turn.

The Extreme is a *bandaged doctrinaire* puzzle that shape-shifts:
- Every cut realigns after every move, so no move is ever blocked.
- No partial-angle turn unlocks anything.
- Pieces do travel into slots where differently shaped pieces were, which is why it feels like jumbling.

The simulator still models every piece as a true 3D solid with a geometric legality check, which is the approach jumbling simulators use. Shape-shifting therefore needs no special cases.

## Exact cut geometry

Coordinates: the cube is `[-1, 1]^3`, the turning corners are `T = (1,1,1)` and `B = (-1,-1,-1)`, and

```
s ≈ 0.31   (cut offset as a fraction of the edge length)
b = 2s,  c = 1 − 2s
```

| Cut | Planes | Where |
|---|---|---|
| Layer cuts | `x+y+z = +c`, `x+y+z = −c` | everywhere (3 layers along the T–B diagonal) |
| Full edge cuts | `x−y = b`, `y−z = b`, `z−x = b` | all layers |
| Extreme-only edge cuts | `x−y = −b`, `y−z = −b`, `z−x = −b` | top and bottom layers only |

- **Flips.** The slab `{x−y > b}` rotates 180° about `(1,−1,0)` (F). Likewise `{y−z > b}` about `(0,1,−1)` (R) and `{z−x > b}` about `(−1,0,1)` (L).
- **Why lines end on edges.** Since `c + b = 1`, three cut planes meet exactly on a cube edge, so every cut line on the surface ends on a cube edge with no slivers.
- **Face pattern.** Look at a face from outside with its turning corner at the bottom-right, using face coordinates `u` (right) and `v` (down) in `[0,1]`:
  - `u+v = s` and `u+v = 1−s` (the layer cuts);
  - `v−u = s` (full edge cut);
  - `v = 1−s` (full edge cut);
  - Extreme only, in the corner-layer region `u+v > 1−s`: `v−u = −s` and `u = 1−s`.

### How `s` was measured

The user photographed a face of their own Tangram Cube Extreme straight on (3024×4032). The six families of cut lines were then fitted:
1. The centre lines of the black gaps were sampled with OpenCV.
2. A homography (photo to face square) and `s` were fitted together by least squares.

The fitted value is `s = 0.314` (internal lines only) or `0.316` (with the face outline). Fixing `s = 0.30`, `0.309` or `1/3` fits worse. `CUT_S = 0.31` is used. That is accurate to about ±0.01 of the edge (about ±0.6 mm), and a caliper measurement could refine it.

The model reproduces the real puzzle exactly:

| | Cells | Visible pieces | Shapes per face |
|---|---|---|---|
| Extreme | 45 (19 / 7 / 19) | 44 + hidden core | 11 |
| Original | 21 (7 / 7 / 7) | 20 + hidden core | 7 |

The original's 20 pieces match Jaap Scherphuis' Pentahedron: 6 corners, 6 edges and 2 centres in the outer layers, plus 3 face centres and 3 edges in the middle.

Piece orientations always lie in D6 (12 rotations) on the Extreme and in D3 (6) on the original.

Reachable configurations, counting with the middle layer as the frame and every piece as distinct:
- **Extreme:** about 4.75 × 10²⁸.
- **Original:** 111,974,400, which is Jaap's 3,110,400 × 36 because the corner and turning-edge orientations are visible.

### Solved colours

The retail photo (black body) shows green on top, white front-left and orange front-right. With the standard opposite pairs (white/yellow, red/orange, blue/green), the turning corners are orange-yellow-green and red-white-blue. This is set in `src/config.ts` and should be confirmed against a solved physical puzzle.

## Notation used in the app

- **Convention.** It follows Jaap Scherphuis' Pentahedron convention, holding the puzzle with corner T on top.
- **`U` / `D`.** Turn the top / bottom corner layer clockwise as seen from that corner.
  - Extreme: one step is 60° (`U U2 U3 U2' U'`).
  - Original: one step is 120° (`U U'`).
- **`F` `R` `L`.** 180° edge flips about `(1,−1,0)`, `(0,1,−1)`, `(−1,0,1)`. Seen from T, F → R → L runs counter-clockwise. A flip is its own inverse.

## Sources

- Twisty Puzzles museum: Tangram Cube <https://twistypuzzles.com/app/museum/museum_showitem.php?pkey=5768>
- Twisty Puzzles museum: Tangram Extreme Cube <https://twistypuzzles.com/app/museum/museum_showitem.php?pkey=6441>
- O. van Deventer and B. Cohen, "Twisty Puzzles that Jumble" <https://twistypuzzles.com/articles/other-twistypuzzlesthatjumble>
- A. Nortmann, "Piece type signatures" (PDF) <https://mail.twistypuzzles.com/articles/other-classification/PieceSignature.pdf>
- J. Scherphuis, "Pentahedron" <https://www.jaapsch.net/puzzles/pentahed.htm>
- TheCubicle, DaYan Tangram Cube Extreme (product data and photos) <https://www.thecubicle.com/products/dayan-tangram-cube-extreme>
- TwistyPuzzle, an exact-arithmetic jumbling simulator (MIT) <https://pypi.org/project/twistypuzzle/>
- A face-on photo of the user's own puzzle (not included in the repository).
