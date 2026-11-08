# Twisty puzzles: 3D simulators

Interactive 3D recreations of real twisty puzzles in the browser (three.js), one tab per puzzle:

| Tab | Puzzle | What makes it special |
|---|---|---|
| **Tangram Cube** | DaYan Tangram Cube Extreme (design by Daqing Bao), with the original Tangram Cube as a toggle | 60° corner turns that shape-shift, edge flips |
| **Curvy Copter** | Meffert's Curvy Copter (design by Tom van der Zanden) | Curved (conical) cuts, 12 edges turning 180°, jumbling |
| **Curvy Copter Plus** | Meffert's Curvy Copter Plus | Split X-pieces: small "inner corner" triangles swap with corners; real bandaging |

**Live site:** https://tirthpatel3223.github.io/tangram-cube-extreme/

## Tangram Cube

- **Real cut geometry.** Every piece is generated from the puzzle's actual cut planes. The cut depth was measured from a photo of a real puzzle: 11 shapes per face, 44 visible pieces.
- **Real moves.** The two corner layers turn in 60° steps (120° on the original) and the three edges flip 180°.
- **Shape-shifting.** A 60° corner turn pushes pieces out of the cube outline, exactly as on the physical puzzle.

See [`docs/research.md`](docs/research.md).

## Curvy Copter and Curvy Copter Plus

- **Real curved cuts.**
  - Every cut is a cone tilted 32° from the Helicopter Cube's flat cut. Meffert's own description gives this angle, and a fit to a photo of a real puzzle gave 32.5°.
  - The pieces are built with exact mesh booleans (manifold-3d, WebAssembly).
- **Every move the real puzzle allows, and only those.**
  - **180° turns.** Plus jumbling turns to the stops where cuts realign: 70.53° (arccos 1/3), 109.47° and 180°.
  - **Shape-shifting and jumbling.** Corners can end up standing proud in small-triangle slots, triangles sink into corner holes, and petals flip.
  - **Bandaging.** Each turn is swept against the real 3D piece shapes. A turn that would make pieces collide is refused, and the pieces in the way glow red.
- **Controls.**
  - A *180° / Jumble* mode switch. In Jumble mode a click turns to the next stop; Shift-click goes anticlockwise.
  - Keys `Q W E R` / `A S D F` / `Z X C V` for the three rows of edges, `J` to toggle Jumble, and `Ctrl+Z` / `Ctrl+Y` to undo and redo.
- **Scramble.** 180° turns, then a shape-preserving jumble combo in random orientations, then a couple of real jumbles.

See [`docs/curvy-copter.md`](docs/curvy-copter.md) for the research, the photo fit, the bandaging model and the sources.

## Common controls

- **Free rotation, anywhere over the puzzle area** (everything except the side panel). There are no angle limits; it rolls over in any direction.
  - Two-finger trackpad swipe, or click-drag / one-finger drag, rotates (a quick flick keeps it spinning briefly).
  - Two-finger touch: move to rotate, pinch to zoom.
  - Trackpad pinch or `Ctrl` + mouse wheel zooms.
- **Click to turn.** Click a piece to turn its highlighted part. Shift-click or right-click turns the other way.
- **Undo/redo, move history, algorithm input and scramble.**

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

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine, notation, history, animator and mesh tests
npm run build      # type-check + production build into dist/
```

URL options:
- `?puzzle=curvy-copter` or `?puzzle=curvy-copter-plus` opens a Curvy tab (no parameter: the Tangram Cube).
- `?variant=original` opens the original Tangram Cube.
- `?s=0.315` overrides the Tangram cut fraction, for calibration.

## Project layout

```
src/main.ts      bootstrap: theme toggle, then the app for the selected tab (lazily loaded)
src/apps/        the Tangram app
src/puzzle/      Tangram engine: cut planes, convex cells, rotation group, moves, state; generic undo history
src/render/      shared stage, gestures and the Tangram's meshes, animator, picking, labels
src/ui/          puzzle tabs, the Tangram panel and keyboard
src/curvy/       Curvy Copter engine (cones, pieces, legality, jumble stops, notation, scramble),
                 render/ (manifold-3d meshes, animator, picking, labels) and ui/ (panel, keyboard)
tests/           Vitest suites (tests/curvy/ for the Curvy puzzles)
docs/            research notes and the reusable puzzle-app playbook
.github/         GitHub Pages deployment workflow
```

## Deploy (GitHub Pages)

Every push to `main` runs `.github/workflows/deploy.yml`. It installs the dependencies, runs the tests, builds `dist/` and publishes it to GitHub Pages; the repository's Pages source is set to **GitHub Actions**.

The build uses relative asset paths (`base: './'` in `vite.config.ts`), so the same `dist/` also works from any static host or sub-folder.
