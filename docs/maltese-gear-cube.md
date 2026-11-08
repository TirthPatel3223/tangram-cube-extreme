# Maltese Gear Cube: research notes

These notes record what the puzzle is, how it moves, how its geometry was worked out from the user's puzzle, and what the app does with it.

## Identity

| | |
|---|---|
| Puzzle | Meffert's *Maltese Gear Cube* (museum name "Maltese Gears") |
| Designer | Oskar van Deventer, 2013 (Meffert's later mass-produced it) |
| Museum | [pkey 3858](https://twistypuzzles.com/app/museum/museum_showitem.php?pkey=3858): "A combination of the Geared Mixup and the Void Cube", 60 mm |
| Size | 60 mm face to face (user's measurement, matching the museum) |
| Pieces | 50: 8 corners, 6 centres, 12 edges, 24 gears |
| Colours | white top, green front, purple right, red left, blue back, yellow bottom |

## Terminology: mixup, shape-shifting, jumbling

- **Mixup.** A 45° turn of a middle slice carries centres into edge slots and edges into centre slots (Mixup Cube, Geared Mixup). Here the gearing forces that 45° turn on every face turn, so the 6 centres and 12 edges share one orbit of 18 slots.
- **Shape-shifting.** Pieces leave the cube's outline:
  - an edge in a centre slot stands 11 mm proud;
  - a centre in an edge slot sits about 11 mm deep;
  - an edge can sit in its own slot turned 90°;
  - a gear's cap is flush in only one of its four orientations.
- **Not jumbling.** In the van Deventer–Cohen sense, jumbling means cuts that never realign. Here every face turn lands every piece back in a slot, and every move is always possible. So the state space is finite and the engine is exact and discrete, unlike the Curvy Copter's.

## How it moves

The cube is `[-1, 1]^3` (1 unit = 30 mm), with x = R, y = U and z = F.

- **Rings.** Each middle ring (M ⟂ x, E ⟂ y, S ⟂ z) has 16 slots, 22.5° apart:
  - centre and edge slots alternate at 0°, 45°, 90°, …;
  - gears sit at 22.5°, 67.5°, ….
  This matches the user's sketch: per side, edge – gear – centre – gear – edge.
- **Gear axes.** They point from the centre, 22.5° from the face normal. Symmetry forces this exact angle: a 45° turn must carry one gear slot onto the next, and the face pattern is mirror-symmetric. So a gear hub sits tan 22.5° = 12.4 mm from its face centre.
- **Layers.** A face layer holds 17 pieces:
  - its 4 corners, centre slot and 4 edges;
  - its 4 face gears;
  - the 4 gears of its column on the neighbouring faces.
  Its ring holds the other 16 (4 centre slots, 4 edge slots, 8 gears).
- **A clockwise quarter turn of face X** (`X`):
  - turns X's layer −90° about X's outward normal;
  - drives the ring perpendicular to it −45°;
  - leaves the opposite layer fixed;
  - spins each of that ring's 8 gears 90° about its own outward axis.
- **Spin direction.** The gears spin counterclockwise seen from outside: a gear rolls between the turning layer and the fixed opposite layer, like a differential's spider gear. The user confirmed this on the real puzzle. Their earlier Macro Explorer artifact spun them the other way.
- **Spin timing.** In the user's video (IMG_3517) a U turn is held half way and then finished. Half way, the moving gear still has its starting orientation. It reaches 45° about three quarters of the way, and 90° at the end. So the app spins ring gears during the second half of each quarter turn (`gearSpinProgress` in `moves.ts`). Retailers mention the gears clicking at each position.
- **Consequences** (all tested in `tests/maltese/engine.test.ts`):
  - every face has order 8: its ring must turn 8 × 45°;
  - `X4` turns the ring half way and leaves everything flush;
  - `X2` and `X2'` are different moves;
  - `U D = D U`: the E ring ends where it started, with its gears turned 180°;
  - `U D'` is the whole-cube rotation y;
  - after `U`, every E-ring gear has its upper half proud;
  - `U R` turns the FR edge 90° in the UF slot, as in the user's photo.

### Exact bookkeeping

Every centre, edge and gear has a pose (slot, k): it sits in its slot turned k·90° about the slot's outward axis.

- **Slot frames.**
  - Edge slots: x runs along the ridge.
  - Centre slots: x is the first coordinate axis perpendicular to the slot.
  - Gear slots: y points towards the gear's face centre.
- **Why poses stay exact.** Every move takes slot frames to slot frames, up to quarter turns. So the move tables (`moves.ts`) are built once by matching rotated frames, and nothing drifts.
- **Carried gears flip.** Carrying a gear 45° maps its frame onto the next slot's frame turned 180°. With the spin, a clockwise move therefore takes a ring gear's k to k − 1.
- **Corners** use the 24 cube rotations.

### Cross-check against the user's Macro Explorer

The engine was checked against the artifact's tables. Its gear permutations for `U U' L L' F F'` match exactly. For all 5,161 catalogued macros, the corner-sticker, gear-colour and gear-orientation change counts agree. These counts don't depend on the spin direction. The macro data was used locally only and is not in the repository.

## Geometry

### Measured and fitted

| Quantity | Value | Source |
|---|---|---|
| Face to face | 60 mm | user's measurement |
| Gear hub from face centre | 12.4 mm (tan 22.5°) | symmetry |
| Edge in a centre slot | shoulders 9 mm proud, crest 11 mm, ~2 mm crest-to-shoulder roof | user's measurement and profile photo |
| Edge/centre column | 5.2 mm square | profile photo (centres and edges share slots) |
| Star and gear sticker outlines | Fourier curves | face photo and close-ups (below) |
| Long / short gear petals | 1.16 : 1 (long pair towards the edge when flush) | close-up photo and 3 gears in the face photo |

### Why the gears looked "too far out": bevelled edges

In the photos the gear hubs sit at about 0.47–0.49 of the visible face half-width. Radial 22.5° axes predict 0.414 if the stickers reached the cube's edges. They don't:

- **Bevelled edges.** Every cube edge is a black band with no stickers, about 3 mm wide. The edge-on photos show it, and so does the band between the stars of two faces.
- **Hollow vertices.** Each vertex is cut away into an open box; the museum calls the shape a "star", and its face photo is a Maltese cross.

The stars end 26.4 mm from the face centre, against a 30 mm face plane. With that, 12.4 mm hubs match the photos. Oskar's 3D-printed original gives 0.44 (narrower bevels).

### Outlines

`src/maltese/outlines.ts` is generated and holds both outlines. The process:

1. In the face-on photo, the four corner stars and the three flush gears were segmented.
2. Each was rotated into one frame, scaled from the 12.4 mm hub offset, and the shapes were averaged.
3. Each averaged shape was mirrored about its symmetry axis: the star about its diagonal, the gear about its outward axis.
4. The result was smoothed with a 60- and 48-harmonic Fourier series.

A high-resolution close-up checked the gear: the hub is a true circle and the long petals are 15.5% longer. Overlaid on the photo at true scale, the outlines sit on the stickers.

### Piece solids (`src/maltese/render/pieces.ts`)

- **Corner.**
  - Three 3 mm star plateaus.
  - Their outer arms continue over the bevel as bridges.
  - Three walls, 10–14.4 mm from the centre planes, so outside every ring's channel.
  - The open vertex box, plus a 1.8 mm tunnel along the body diagonal, so you can see through the puzzle.
- **Gear.**
  - The petal body is a prism along the spin axis, tapered 35% over 3 mm, plus a hub post.
  - It is sheared so its top is the cap plane. The cap is tilted 22.5° to the spin axis, so it is flush only at k = 0.
  - Tilt for each orientation: k = 1 and 3 tilt about 31°, k = 2 tilts 45° (the inner side then stands about 8 mm proud).
  - The photographed outline is the cap; the section perpendicular to the axis is that outline × cos 22.5° in the radial direction.
- **Centre and edge.** One 5.2 mm column. The edge adds the 45° roof with a 1.2 mm flat crest, so at home its sticker faces lie 0.6 mm under the face planes.
- **Plastic.** A 0.3 mm rim around every sticker and a 0.15 mm gap on every piece.

### Clearances (collision sweep and tests)

A sweep of a full U turn (scratchpad Python) checked every gear orientation against:

- the corners of both outer layers;
- the gears of both outer layers.

The photo shapes interleave almost perfectly: the visible gears really do mesh with the corner arms and with each other's petals. Results:

- **Mid-turn.** The deepest contact is about 0.8 mm, where a passing gear (2.5 mm proud mid-turn) brushes a star's fin, or threads past a neighbouring gear's petals.
- **Spin direction.** Clockwise spin would be worse in every orientation.
- **Spin profiles.** Uniform and second-half spin give the same clearance.

`tests/maltese/meshes.test.ts` intersects the exact solids in the solved state and in seeded scrambles. Two changes and one tolerance came out of it:

- The two pointed inner arms of each star were cut back 0.6 mm. Their tips rest in the gears' side notches, and the photo outlines touch the petals there by about 0.2 mm.
- What remains at rest is a sliver of at most 0.04 mm³ in the top 0.5 mm of those notches, black on black. The gear walls follow its 22.5° axis and the arm walls follow the face normal, so they converge just under the surface.
- The test allows 0.05 mm³.

## Notation

| Move | Meaning |
|---|---|
| `U` | Top face 90° clockwise (seen from above); the E ring follows 45° and its 8 gears spin. |
| `U'` | Counterclockwise. |
| `U2`, `U2'` | Two quarter turns either way. They are different moves: the ring ends 90° one way or the other. |
| `U3`, `U3'`, `U4` | `U4` turns the ring half way round. `U8` is a full cycle and is rejected as "no effect". |

The same applies to `D F B L R`.

## Checks to do on the physical puzzle

Each is a prediction of the model:

1. `U4`: every E-ring gear is back to the tilt it had (the pieces moved half way round).
2. `U2` from a cube shape: all 8 E-ring gears tilted the same way, 45°.
3. Hold `U'` half way: the middle gears should still show their starting orientation (the video showed this for `U`).
4. `U R` from solved: the FR edge sits in the UF slot turned 90° (both stickers side by side, facing up-front).

## Sources

- TwistyPuzzles museum:
  - Maltese Gears <https://twistypuzzles.com/app/museum/museum_showitem.php?pkey=3858>
  - Geared Mixup <https://twistypuzzles.com/cgi-bin/puzzle.cgi?pkey=2506>
- Oskar van Deventer's Meffert's page <https://oskarvandeventer.nl/meffert.html>: "similar functionality to a gear mixup cube, but this one has even more gears and also features hollow corners, allowing you to see all the way through the puzzle".
- J. Storer, Geared Mixup and Mixup Cube pages:
  - <https://www.cs.brandeis.edu/~storer/JimPuzzles/ZPAGES/zzzGearedMixup.html>
  - <https://www.cs.brandeis.edu/~storer/JimPuzzles/ZPAGES/zzzMixupCube.html>
- J. Scherphuis, Gear Cube (2:1 middle-layer gearing) <https://www.jaapsch.net/puzzles/gearcube.htm>
- The user's photos, two videos, axis sketch, profile measurement, and Macro Explorer artifact (not in the repository).
