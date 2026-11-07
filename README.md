# Tangram Cube Extreme: 3D simulator

An interactive 3D recreation of the **DaYan Tangram Cube Extreme** (design by Daqing Bao), with the original **Tangram Cube** as a toggle. It runs in the browser using three.js.

**Live site:** https://tirthpatel3223.github.io/tangram-cube-extreme/

- **Real cut geometry.** Every piece is generated from the puzzle's actual cut planes. The cut depth was measured from a photo of a real puzzle: 11 shapes per face, 44 visible pieces.
- **Real moves.** The two corner layers turn in 60° steps (120° on the original) and the three edges flip 180°.
- **Shape-shifting.** A 60° corner turn pushes pieces out of the cube outline, exactly as on the physical puzzle.
- **Controls.**
  - Click a piece to turn its highlighted part. Shift-click or right-click turns the other way.
  - On-screen buttons.
  - Keyboard: `U D F R L`, with Shift for prime; `Ctrl+Z` / `Ctrl+Y` to undo and redo.
- **Free rotation, anywhere over the puzzle area** (everything except the side panel). There are no angle limits; it rolls over in any direction.
  - Two-finger trackpad swipe, or click-drag / one-finger drag, rotates (a quick flick keeps it spinning briefly).
  - Two-finger touch: move to rotate, pinch to zoom.
  - Trackpad pinch or `Ctrl` + mouse wheel zooms.
  - The *Corner up* / *Cube* buttons reset the view.
- **Undo/redo, move history and algorithm input**, in notation such as `U F U2' R D3 L`.
- **Scramble**, a random-move scramble shown in notation.

See [`docs/research.md`](docs/research.md) for how the puzzle works and how the geometry was derived, and
[`docs/puzzle-webapp-playbook.md`](docs/puzzle-webapp-playbook.md) for a reusable guide to building apps like this for other puzzles.

## Notation

Hold the puzzle with one turning corner on top (the *Corner up* view).

| Move | Meaning |
|---|---|
| `U`, `U'`, `U2`, `U2'`, `U3` | Top corner layer, clockwise seen from the top corner. Extreme: 60° per step. Original: 120° (`U`, `U'`). |
| `D`, `D'`, … | Bottom corner layer, clockwise seen from the bottom corner. |
| `F`, `R`, `L` | 180° flips of the front, right-back and left-back edges (self-inverse). |

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine, notation, history and animator tests
npm run build      # type-check + production build into dist/
```

URL options:
- `?variant=original` opens the original Tangram Cube.
- `?s=0.315` overrides the cut fraction, for calibration.

## Project layout

```
src/puzzle/   pure TypeScript engine: cut planes, convex cells, rotation group, moves, state, history
src/render/   three.js: scene, rounded piece meshes + stickers, move animator, click picking, labels
src/ui/       side panel and keyboard shortcuts
src/config.ts cut fraction, colours, physical sizes, timing
tests/        Vitest suites
docs/         research notes and the reusable puzzle-app playbook
.github/      GitHub Pages deployment workflow
```

## Deploy (GitHub Pages)

Every push to `main` runs `.github/workflows/deploy.yml`. It installs the dependencies, runs the tests, builds `dist/` and publishes it to GitHub Pages; the repository's Pages source is set to **GitHub Actions**.

The build uses relative asset paths (`base: './'` in `vite.config.ts`), so the same `dist/` also works from any static host or sub-folder.
