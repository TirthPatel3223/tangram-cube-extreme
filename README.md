# Twisty puzzles: 3D simulators

Interactive 3D recreations of real twisty puzzles in the browser (three.js). Pick a puzzle from the bar above the 3D view:

| Tab | Puzzle | What makes it special |
|---|---|---|
| **Tangram Cube Extreme** | DaYan Tangram Cube Extreme (design by Daqing Bao) | 60° corner turns that shape-shift, edge flips |
| **Tangram Cube** | The original DaYan Tangram Cube | 120° corner turns and edge flips; always stays a cube |
| **Curvy Copter** | Meffert's Curvy Copter (design by Tom van der Zanden) | Curved (conical) cuts, 12 edges turning 180°, jumbling |
| **Curvy Copter Plus** | Meffert's Curvy Copter Plus | Split X-pieces: small "inner corner" triangles swap with corners; real bandaging |
| **Maltese Gear Cube** | Meffert's Maltese Gear Cube (design by Oskar van Deventer) | 90° face turns gear the middle layer 45°: centres and edges trade places, 24 gears spin and tilt |

**Live site:** https://tirthpatel3223.github.io/tangram-cube-extreme/

## Tangram Cube

- **Real cut geometry.** Every piece is generated from the puzzle's actual cut planes. The cut depth was measured from a photo of a real puzzle: 11 shapes per face, 44 visible pieces.
- **Real moves.** The two corner layers turn in 60° steps (120° on the original) and the three edges flip 180°.
- **Shape-shifting.** A 60° corner turn pushes pieces out of the cube outline, exactly as on the physical puzzle.

See [`docs/tangram-cube.md`](docs/tangram-cube.md).

## Curvy Copter and Curvy Copter Plus

- **Real curved cuts.**
  - Every cut is a cone tilted 32° from the Helicopter Cube's flat cut. Meffert's own description gives this angle, and a fit to a photo of a real puzzle gave 32.5°.
  - The pieces are built with exact mesh booleans (manifold-3d, WebAssembly).
  - **Rounded edges**, like the Tangram's bevels: a rolling ball of 0.55 mm rounds every edge on the outside and 0.3 mm every edge between two cuts (seen mid-turn and when jumbled).
- **Every move the real puzzle allows, and only those.**
  - **180° turns.** Plus jumbling turns to the stops where cuts realign: 70.53° (arccos 1/3), 109.47° and 180°.
  - **Shape-shifting and jumbling.** Corners can end up standing proud in small-triangle slots, triangles sink into corner holes, and petals flip.
  - **Bandaging.** Each turn is swept against the real 3D piece shapes. A turn that would make pieces collide is refused, and the pieces in the way glow red.
- **Controls.**
  - A *180° / Jumble* mode switch. In Jumble mode a click turns to the next stop; Shift-click goes anticlockwise.
  - Keys `Q W E R` / `A S D F` / `Z X C V` for the three rows of edges, `J` to toggle Jumble, and `Ctrl+Z` / `Ctrl+Y` to undo and redo.
- **Scramble.** 180° turns, then a shape-preserving jumble combo in random orientations, then a couple of real jumbles.

See [`docs/curvy-copter.md`](docs/curvy-copter.md) for the research, the photo fit, the bandaging model and the sources.

## Maltese Gear Cube

- **Real gearing.**
  - A 90° face turn drives the middle layer 45°.
  - That layer's 8 gears each spin a quarter turn, counterclockwise as seen from outside (checked on the real puzzle), during the second half of the turn as in the user's video.
  - A face needs 8 quarter turns to come back.
- **Mixup and shape-shifting.**
  - Centres and edges share one set of slots.
  - An edge in a centre slot stands 11 mm proud; a centre in an edge slot sinks.
  - Edges can sit turned 90° in their own slots.
  - Each gear is flush in only one of its four orientations, tilting 31° or 45° in the others.
- **Geometry from the user's puzzle.**
  - Gear axes 22.5° off the face normals; star and gear outlines traced from photos.
  - Bevelled edges and hollow, see-through vertices.
  - 60 mm, with the edge-piece profile measured.
- **Exact engine.** Pieces have discrete poses (slot + quarter turns), cross-checked against more than 5,000 macros from the user's own puzzle model.

See [`docs/maltese-gear-cube.md`](docs/maltese-gear-cube.md).

## Common controls

- **Free rotation, anywhere over the puzzle area** (everything except the side panel). There are no angle limits; it rolls over in any direction.
  - Two-finger trackpad swipe, or click-drag / one-finger drag, rotates (a quick flick keeps it spinning briefly).
  - Two-finger touch: move to rotate, pinch to zoom.
  - Trackpad pinch or `Ctrl` + mouse wheel zooms.
- **Click to turn.** Click a piece to turn its highlighted part. Shift-click or right-click turns the other way.
- **Undo/redo, move history, algorithm input and scramble.**
- **Light and dark themes.** Light by default; the button in the top-left corner switches (and remembers the choice).

## Notation

**Tangram Cube.** Hold the puzzle with one turning corner on top (the *Corner up* view).

| Move | Meaning |
|---|---|
| `U`, `U'`, `U2`, `U2'`, `U3` | Top corner layer, clockwise seen from the top corner. Extreme: 60° per step. Original: 120° (`U`, `U'`). |
| `D`, `D'`, … | Bottom corner layer, clockwise seen from the bottom corner. |
| `F`, `R`, `L` | 180° flips of the front, right-back and left-back edges (self-inverse). |

**Curvy Copter / Plus.** Edges are named by their two faces: `UF UR UB UL FR FL BR BL DF DR DB DL`.

| Move | Meaning |
|---|---|
| `UF` | Turn the UF edge 180°. |
| `UF+` | Turn UF clockwise (seen from outside, looking at the edge) to its next jumble stop. |
| `UF-` | Turn UF anticlockwise to its next stop. |

Example: `UL- FR- UF FR+ UL+` jumbles pieces between orbits and returns a flush cube.

**Maltese Gear Cube.** Faces `U D F B L R`, white on top and green in front.

| Move | Meaning |
|---|---|
| `U` | Top face 90° clockwise seen from above; the middle layer follows 45° and its gears spin. |
| `U'` | Counterclockwise. |
| `U2`, `U2'` | Two quarter turns. They differ: the middle layer ends 90° one way or the other. |
| `U4` | Turns the middle layer half way round and leaves everything flush (`U8` = a full cycle). |

Keys `U D F B L R` turn faces, and `Shift` gives the counterclockwise turn.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine, notation, history, animator and mesh tests
npm run build      # type-check + production build into dist/
```

URL options:
- `?puzzle=tangram-cube`, `?puzzle=curvy-copter`, `?puzzle=curvy-copter-plus` or `?puzzle=maltese-gear-cube` opens that tab (no parameter: the Tangram Cube Extreme). Older links (`?variant=original`, `?puzzle=tangram`) still work.
- `?s=0.315` overrides the Tangram cut fraction, for calibration.
- `?round=0` builds the Curvy pieces with sharp edges, for comparison.

## Project layout

```
src/main.ts      bootstrap: theme toggle, then the app for the selected tab (lazily loaded)
src/apps/        the Tangram app (Extreme and original)
src/puzzle/      Tangram engine: cut planes, convex cells, rotation group, moves, state; generic undo history
src/render/      shared stage, gestures and the Tangram's meshes, animator, picking, labels
src/ui/          puzzle selector, the Tangram panel and keyboard
src/curvy/       Curvy Copter engine (cones, pieces, legality, jumble stops, notation, scramble),
                 render/ (manifold-3d meshes and fillets, animator, picking, labels) and ui/ (panel, keyboard)
src/maltese/     Maltese Gear Cube engine (slots and frames, exact move tables, state, notation, scramble),
                 photo-traced outlines, render/ (manifold-3d piece solids, animator with gear spin, picking,
                 labels) and ui/ (panel, keyboard)
tests/           Vitest suites (tests/curvy/ and tests/maltese/ for those puzzles)
docs/            research notes and the reusable puzzle-app playbook
.github/         GitHub Pages deployment workflow
```

## Deploy (GitHub Pages)

Every push to `main` runs `.github/workflows/deploy.yml`. It installs the dependencies, runs the tests, builds `dist/` and publishes it to GitHub Pages; the repository's Pages source is set to **GitHub Actions**.

The build uses relative asset paths (`base: './'` in `vite.config.ts`), so the same `dist/` also works from any static host or sub-folder.
