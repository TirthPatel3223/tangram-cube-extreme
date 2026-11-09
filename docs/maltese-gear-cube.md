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
  - spins each of that ring's 8 gears 270° about its own outward axis.
- **Spin direction and amount.** The gears spin counterclockwise seen from outside: a gear rolls between the turning layer and the fixed opposite layer, like a differential's spider gear. The user confirmed the direction on the real puzzle. Their earlier Macro Explorer artifact spun them the other way. On 2026-11-09 the user measured the amount: 270° per quarter turn, not 90° as the app first had it (`GEAR_SPIN_PER_QUARTER = 3` in `moves.ts`). A gear therefore comes to rest where a 90° clockwise spin would leave it; the user checked that after `U` the front middle gears have their lower half proud.
- **Spin timing.** In the user's video (IMG_3517) a U turn is held half way and then finished. It was first read as: half way, the moving gear still has its starting orientation; it reaches 45° about three quarters of the way, and 90° at the end. (That reading predates the 270° measurement above and gave the wrong amount and resting pose.) Retailers mention the gears clicking at each position. The app first copied this (spin during the second half of each quarter turn). On 2026-11-09 the user asked for uniform rotation instead: the gears now spin in step with the face, from the start of the turn to the end (`gearSpinProgress` in `moves.ts`).
- **Consequences** (all tested in `tests/maltese/engine.test.ts`):
  - every face has order 8: its ring must turn 8 × 45°;
  - `X4` turns the ring half way and leaves everything flush;
  - `X2` and `X2'` are different moves;
  - `U D = D U`: the E ring ends where it started, with its gears turned 180°;
  - `U D'` is the whole-cube rotation y;
  - after `U`, every E-ring gear has its lower half proud;
  - `U R` turns the FR edge 90° in the UF slot, as in the user's photo.

### Exact bookkeeping

Every centre, edge and gear has a pose (slot, k): it sits in its slot turned k·90° about the slot's outward axis.

- **Slot frames.**
  - Edge slots: x runs along the ridge.
  - Centre slots: x is the first coordinate axis perpendicular to the slot.
  - Gear slots: y points towards the gear's face centre.
- **Why poses stay exact.** Every move takes slot frames to slot frames, up to quarter turns. So the move tables (`moves.ts`) are built once by matching rotated frames, and nothing drifts.
- **Carried gears flip.** Carrying a gear 45° maps its frame onto the next slot's frame turned 180°. With the 270° spin (3 quarter turns), a clockwise move therefore takes a ring gear's k to k + 1.
- **Corners** use the 24 cube rotations.

### Cross-check against the user's Macro Explorer

The engine was checked against the artifact's tables. Its gear permutations for `U U' L L' F F'` match exactly. For all 5,161 catalogued macros, the corner-sticker, gear-colour and gear-orientation change counts agree. These counts don't depend on the spin direction. The macro data was used locally only and is not in the repository.

## Geometry

### Measured and fitted

| Quantity | Value | Source |
|---|---|---|
| Face to face | 60 mm | user's measurement |
| Gear hub from face centre | 12.43 mm (tan 22.5°) | symmetry |
| Edge in a centre slot | shoulders 9 mm proud, crest 11 mm, ~2 mm crest-to-shoulder roof | user's measurement and profile photo |
| Edge/centre column | 5.2 mm square | profile photo (centres and edges share slots) |
| Star and gear sticker outlines | constrained sketches (lines and tangent arcs), fitted | top-down photo (below) |
| Long / short gear teeth | 9.16 mm / 7.69 mm from the hub (1.19 : 1), the long pair towards the edge when flush | user's gear drawing, sized on the photo |
| Plastic margin around every sticker | 0.5 mm | fit: the largest that fits |

### Why the gears looked "too far out": bevelled edges

In the photos the gear hubs sit at about 0.45–0.49 of the visible face half-width. Radial 22.5° axes predict 0.414 if the stickers reached the cube's edges. They don't:

- **Bevelled edges.** Every cube edge is a black band with no stickers, about 3 mm wide. The edge-on photos show it, and so does the band between the stars of two faces.
- **Hollow vertices.** Each vertex is cut away into an open box; the museum calls the shape a "star", and its face photo is a Maltese cross.

The fitted stars' sticker arms end 26.5 mm from the face centre, and their plastic 27.0 mm (where the bevel starts), against a 30 mm face plane. With that, 12.43 mm hubs match the photos.

### Sticker outlines (`src/maltese/stickers.ts`)

The outlines used to be photo traces smoothed with Fourier series, and their edges wobbled.

- **Star:** now a sketch built from straight lines and circular arcs, joined by tangent fillets and mirror-symmetric by construction. Sharp corners appear only at its four points.
- **Gear:** traced from the user's own drawing of it (see below), because the equation-built gear didn't look right.

The star's numbers, the scale and the padding were fitted to a top-down shop photo of the puzzle with `tools/maltese/fit_stickers.py`:

1. **Rectify.** It finds the homography from face to photo that makes the blue sticker mask most symmetric under the face's own symmetry group D4 (4-fold turns and mirrors). The photo turned out to be rotated 43° and very slightly tilted (perspective terms −0.014, +0.010). The rectified face is drawn on a 30 × 30 grid of 2 mm cells (the blueprint).
2. **Average.** The eight D4 images of the face are sampled and averaged, so all four stars and all four gears count and the result is exactly symmetric.
3. **Fit.** Each sketch is rasterised, blurred with a fitted Gaussian (the photo's own blur), and compared with the averaged photo pixel by pixel (least squares). The pixel RMS is 0.072 for the star on a 0–1 sticker score. A parametric gear (hub circle and four petals) is fitted the same way, but only to locate the gear hubs.
4. **Scale.** The fitted gear hub sits at tan 22.5° × 30 mm, which gives 25.14 mm per photo unit.
5. **Padding.** The fitter projects every sticker from the cube centre onto the face plane and measures the smallest spacing between neighbours, over all four orientations of each gear. That spacing gives the largest margin that keeps every pair of plateaus 0.3 mm apart:
   - With the stickers exactly as fitted, the limit was 0.21 mm. The cause was the star's thin inner points against a gear turned 90°.
   - The margin has a floor of 0.5 mm, so the fit was rerun with that clearance as a constraint. The inner points came back 0.9 mm, and the pixel fit improved (0.082 to 0.072): the free fit had over-long, thin tips.
   - The tightest pair is now a star point against a gear at k = 1 or 3, 1.33 mm apart.
6. **Output.** The parameter block in `stickers.ts` (generated: don't edit it by hand), reference polygons in `tests/maltese/fixtures/sticker-reference.ts`, and the blueprint and report in `--out`.

The star (UFR on F, face coordinates; one half sketched, mirrored about x = y):

| Parameter | mm | Meaning |
|---|---|---|
| `hc`, `t` | 12.32, 3.38 | inner arm centre line x = hc, its sharp point at y = t |
| `wi` | 1.99 | inner arm half-width at its root |
| `yl`, `yu` | 11.03, 13.51 | outer arm's lower and upper edge |
| `bx`, `r4` | 20.09, 2.35 | the fin's inner edge leaves the arm at x = bx (fillet r4) |
| `fx`, `fy` | 22.76, 3.58 | the fin's sharp point (towards the edge midpoint) |
| `ue`, `ye`, `re` | 26.52, 12.59, 0.08 | arm end x = ue; the fin's outer edge meets it at y = ye; corner fillets |
| `r1`, `r2`, `r3` | 3.16, 2.15, 1.76 | fillets: between the inner arms, at the inner arm's root, between the outer arms |

To re-run the fit: `python -I tools/maltese/fit_stickers.py <photo> --out <dir> --write`. Use `--old <file>` to overlay previous outlines on the blueprint.

**The gear** is traced from the user's drawing (`gear_final.jpg`: a clean blue silhouette with two long teeth and two short ones) by `tools/maltese/trace_gear.py`:
1. **Mirror axis.** The line that maps the silhouette onto itself best: 44.2°, with 3% of the area asymmetric (slightly propeller-like teeth).
2. **Hub.** The centre of the largest circle on that axis that fits where the four teeth meet (the X's crossing). The gear spins about it.
3. **Outline.** The silhouette is resampled in the gear's frame as a signed distance field and averaged with its mirror image, so it is exactly symmetric. Averaging the silhouettes themselves would leave a flat 50% band where the drawing is lopsided, and the contour would wander in it.
   - The field is contoured with sub-pixel accuracy, passed through a periodic smoothing spline (0.1 px RMS, enough to remove JPEG wobble), and resampled: at most 0.1 mm and 5° of turn between points, so the points are dense at the pointed tooth tips.
   - The curvature changes sign only 14 times (leaf into neck on each tooth, and the notches), so there is no wobble.
4. **Size.** The outline is placed on the photo's gears, with the hub where the star fit found it. Only its scale is fitted, with the same forward model as the star (pixel RMS 0.045, much better than the parametric gear's 0.079).
   - Long teeth reach 9.16 mm from the hub, short teeth 7.69 mm.
   - Letting the hub slide along the axis moves it by under 0.1 mm, so the drawing's centre and the photo's hub agree.
5. **Clearance.** Checked against the fitted star, the columns and the neighbouring gear in every orientation, with the 0.5 mm padding: it fits up to 0.55 mm. The tightest pair is a star point against a gear at k = 1 or 3, 1.41 mm apart.
6. **Output.** The outline in mm, as `GEAR_OUTLINE_MM` (generated) in `stickers.ts`, plus the gear's reference polygon in the test fixtures.

To re-run: `python -I tools/maltese/trace_gear.py <gear drawing> <photo> --out <dir> --write`. Run it after `fit_stickers.py` if you refit the star.

### Piece solids (`src/maltese/render/pieces.ts`)

Every body is a **cone from the cube centre**: each cross-section is the plateau (the sticker grown by the 0.5 mm margin) shrunk towards the centre, all the way down to the core ball. The sloped walls run along the sticker's outline and merge into the core.

- **Why cones.** Every move turns pieces about an axis through the centre, so a cone stays a cone. Two bodies can only meet where their footprints on the sphere of directions meet. So the deep parts never collide more than the plateaus would, and the fitter's clearance check in the face plane covers the whole body.
- **Building them.** `CrossSection.extrude` with `scaleTop`. The scale must be a 2-vector: manifold-3d reads a bare number `s` as `[s, 0]` and builds a wedge. That was the old gear body's bug: its top collapsed to a ridge, so a tilted gear's sticker floated up to 4.4 mm above its plastic.

The pieces:

- **Corner (built at UFR).**
  - Seen from the centre, its three star plateaus and their bridges over the bevels lie over one plane perpendicular to the body diagonal. They form a ring around the **hollow cube** at the vertex: [14.0 mm, 30 mm]^3, the face's corner square beyond the stars' outer arms.
  - So the corner is one cone over one 2D ring, built in that diagonal frame. Building it this way avoids 3D unions of cones, which were four times slower.
  - The hollow cube stays open all the way down to the core.
  - The bevel starts one margin past the sticker arms' ends, so the margin is uniform there too.
- **Gear (slot frame).**
  - The plateau in the cap plane is projected from the centre onto the plane perpendicular to the spin axis. It is coned and cut by the cap plane, which is tilted 22.5° to the axis, so it is flush only at k = 0.
  - Tilts: k = 1 and 3 tilt the cap about 31°, k = 2 tilts it 45° (up to 4.8 mm proud).
  - The plastic rises with the sticker in every orientation (tested).
- **Centre and edge.** One 5.2 mm column (less 0.15 mm gaps). Its corners are rounded 0.9 mm, so the 4.9 mm column's top keeps the 0.5 mm margin around a 3.9 mm sticker with 0.4 mm corners.
  - The column runs straight from the core (28 mm) up to its top.
  - The edge adds the 45° roof with a 1.1 mm flat crest. Its two roof stickers are the roof faces less the margin.
- **Core** (user's request). A big hollow ball: a 2 mm shell of 28 mm outer radius, so it nearly reaches the centre pieces (whose tops are at 30 mm). Every piece rests on it, stopping 0.02 mm outside.
  - It is fixed, and every move turns pieces about its centre, so nothing ever runs into it.
  - **Pockets.** At each vertex the ball is cut back to the hollow cube [14.0 mm, ...]^3. The corner of that cube (24.3 mm from the centre) lies inside the empty middle (26 mm), so each pocket opens into it.
  - **See-through.** Looking straight down a body diagonal you see through the puzzle: in through one corner's pocket, across the empty ball, out through the opposite corner's. Every other line of sight is blocked (tested with rays). That matches Oskar's description: "hollow corners, allowing you to see all the way through".

**Rounded edges.** A rolling ball rounds every edge, the same engine as the Curvy Copter's (`src/render/fillet.ts`, shared now):
- **Radii.** 0.4 mm on plateau rims, bevels, column tops and roofs.
- **Analytic surfaces.** The engine needs exact surfaces: planes, the core ball, and the cone walls over an outline (`src/maltese/render/surfaces.ts`). A wall's distance is measured to its tangent plane through the centre at the nearest outline point.
- **Clean outlines.** Every plateau outline is simplified (points within 0.003 mm of a line dropped) before it is coned. Round-join offsets leave near-duplicate vertices and microscopic back-and-forth spikes. Their segments have meaningless directions, which handed the rolling ball wrong wall normals: there were jagged dents in the gear's rim until this was fixed. Simplifying also made the whole build about 5× faster: about 0.45 s in the browser.
- **Two Maltese-only options:**
  - `maxReach` shrinks the ball on acute edges, so a fillet never reaches more than 0.35 mm onto a face. A plateau's far side overhangs about 48°, where a full ball would reach 0.9 mm, past the 0.5 mm margin.
  - `maxTurn` places a profile at every 10° of turn round a sticker's points.
- **Concave edges** (union seams) are never rounded.
- `?round=0` shows the sharp bodies.
- **Picking** uses the sharp bodies, on an invisible layer.

### Clearances (tests)

- **At rest.** `tests/maltese/meshes.test.ts` intersects the exact solids, solved and in six seeded 20-move scrambles. Every overlap stays under 0.01 mm³. A direction-cone broad phase makes this fast: since the bodies are cones, two pieces can only meet if their cones of directions overlap.
- **Other tests:**
  - the same margin around every sticker;
  - stickers on the flat part of their plateaus;
  - the gear's plastic under its whole sticker, from just under it down to the core, in every orientation;
  - the hollow core with its eight pockets;
  - see-through only along the body diagonals;
  - for the outlines: the traced gear's smoothness (no wobble), its symmetry, and its long/short teeth.
- **Mid-turn.** The earlier U-turn sweep found the deepest contact (about 0.8 mm) where a passing gear brushes a star's fin. The cone bodies don't change that picture: they meet only where the plateaus' footprints would.

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
- A top-down shop photo of the puzzle (`016657-26341.jpg`, not in the repository), for the sticker fit, and the user's gear drawing (`gear_final.jpg`, not in the repository) for the gear.
