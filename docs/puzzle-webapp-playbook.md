# Playbook: building a 3D twisty-puzzle web app

Context for an agent (e.g. Opus 5.5 in Claude Code) asked to recreate a physical twisty puzzle as an interactive 3D web app. It is deliberately short: puzzles vary a lot, so use it as a checklist and adapt. It was written after building the DaYan Tangram Cube Extreme simulator in this repo.

**The one rule:** get the real geometry from the real puzzle *before* building rendering or UI. Most rework comes from guessing cut positions from low-resolution product photos.

## 1. Ask the user first

Ask in one batch (most users are happy to help, and many own the puzzle):

1. **Which puzzle exactly?** Get the maker, name, version and year, plus any links. Ask whether they own it.
2. **Photos**, the most valuable input:
   - One straight-on, high-resolution photo of a face (perpendicular, whole face in frame, good light). A scrambled puzzle is fine, as long as its outline is still the original shape.
   - The solved puzzle from two opposite corners, to get the colour scheme.
   - Optionally, a short video of each move type.
3. **Measurements.** Edge length, and the distance from an edge to the nearest cut line (ruler or calipers).
4. **Scope.**
   - Variants to include.
   - Turning UI: buttons, keyboard, click-to-turn, drag-to-turn.
   - Extras: undo/redo, notation input, scramble, timer, solve detection, share links.
   - Visual style.
   - Platform (web, or Blender for renders).
   - Hosting (GitHub Pages, Vercel, etc.).

Say clearly which facts are still guesses. Ask again the moment the evidence and the model disagree.

## 2. Research (what to find, where)

- **Twisty Puzzles museum.** Use `https://twistypuzzles.com/app/museum/museum_showitem.php?pkey=N`; the old `cgi-bin` URLs block automated fetches. Read:
  - the description (often states the axes, the turn angles, and whether the shape changes);
  - the section (e.g. "Shape Preserving" or "Shape Changing");
  - the mechanism, the designer and the year;
  - the *piece-type signature*, decoded with Andreas Nortmann's `PieceSignature.pdf`. For example, `PIII2mp` means 3 side axes, 2 cuts per axis, and 3 layers (a hexagonal prism).
- **Jaap's Puzzle Page, Ruwix, Speedsolving wiki.** Mechanism, piece counts, notation, state counts.
- **Retail pages.** Shopify stores expose `…/products/<handle>.json`, which lists every product image URL. Many shops return 403/429 to fetchers, so open them in the browser tool instead.
- **The box and packaging.** These can reveal counts (the Tangram Extreme box says "11 Tangram", meaning 11 shapes per face).
- **Classify the puzzle.**
  - Turning type: face, corner, edge, or a hybrid.
  - Axes and layers per axis, and the turn angles.
  - Cut type: plane or sphere (curvy).
  - Behaviour: *doctrinaire* (cuts always realign), *bandaged*, *shape-shifting*, or *jumbling*. A puzzle jumbles when it "cannot be unbandaged into a doctrinaire puzzle" (van Deventer & Cohen); the Helicopter Cube's 70.5° turns are the classic case. Users often say "jumbling" to mean shape-shifting, so clarify.
- **Licences.** 3D models online may be off-limits as input; Sketchfab "NoAI" tags, for example. Prefer photos and first principles.

## 3. Pin down the geometry (the critical step)

1. **Build a parametric model.** Write every cut as a plane `n·x = d` (or a sphere), grouped by axis and layer. Symmetry usually leaves only 1–3 unknown offsets.
2. **Predict the face pattern.** Compute the lines each cut leaves on a face, then count shapes per face and total pieces. Check these against known numbers (museum text, box, reviews, piece lists). A wrong family of guesses can match some counts; check them all.
3. **Fit to the head-on photo.**
   - Rectify the face with a homography.
   - Sample the centre lines of the black gaps (OpenCV, by darkness).
   - Least-squares fit the offsets and the homography together.
   - Compare fits with candidate "nice" values (1/3, golden ratio, etc.). Keep the fitted value in one config constant.
4. **Check handedness.** Mirror-image cut sets look almost the same. Find an asymmetric feature in the photo (which line is full-length versus partial) and match it.
5. **Look for coincidences.** Cuts meeting exactly on cube edges (on the Tangram, `c + b = 1`) reveal design intent and remove free parameters.

*Lesson from the Tangram build:* the first hypothesis put a corner cut on the face diagonal. It reproduced some counts but was wrong. One straight-on photo from the user fixed it immediately. Ask for that photo in step 1, not after building.

## 4. Architecture that works

- **Stack.** Vite + TypeScript + three.js, Vitest for the engine, no UI framework needed.
- **Engine (pure TypeScript, no DOM).**
  - Pieces are convex cells: enumerate the sign combinations of the cut planes per layer, then use the H-representation and vertex enumeration. Drop empty cells.
  - Non-planar cuts (curvy/spherical) need mesh booleans instead (e.g. `manifold-3d`).
  - **Doctrinaire, all axes through the centre:** store each piece's orientation as an index into a finite rotation group, built by closure with integer multiplication tables. Nothing drifts.
  - **Jumbling or partial angles:** store full transforms. A move is legal when no piece straddles the moving region's boundary; snap only to angles where cuts realign.
  - A move is a region (`n·x > d`) plus a rotation. Apply it to the pieces whose centroid is in the region.
  - Keep notation parsing, scramble (seeded random moves), undo/redo history and an animation queue as separate, testable modules.
- **Rendering.**
  - Bodies: take the convex hull of each face polygon inset *within its own plane*. Rolling-ball rounding erodes faces at acute cuts, which makes stickers overhang the plastic.
  - Stickers: the face polygon inset by a margin, with rounded corners, lifted slightly off the surface.
  - Tone mapping: `NeutralToneMapping` keeps sticker colours true.
- **Interaction.**
  - Fixed camera; rotate the puzzle root like a trackball (free rotation, no pole limits).
  - Pointer events: drag rotates, two-finger trackpad (wheel) rotates, Ctrl+wheel or pinch zooms. Treat a press as a tap only if it moved less than about 6 px and involved one pointer.
  - Click-to-turn: of the parts containing the clicked piece, pick the one whose handle (corner or edge midpoint) is nearest the hit point. Highlight it on hover.

## 5. Verify, with numbers where possible

- **Unit tests.**
  - Piece and sticker counts, and shapes per face.
  - Cell volumes sum to the solid.
  - Face-pattern edges lie on the predicted lines.
  - Rotation group size, and move orders (`Uⁿ = id`).
  - A random walk followed by its inverse returns to solved.
  - Legality, and shape-shift expectations (how many pieces protrude after a turn).
  - Notation round-trips.
  - Undo/redo through the real animator, headless.
- **Visual checks (browser tool).**
  - A face-on render compared with the user's photo.
  - The solved view compared with a retail photo.
  - Screenshots after each move type, and scrambled states.
  - Phone width, using an iframe at 390 px.
  - The production build, with no console errors.
- **Measure visual complaints.** When the user reports a visual flaw, measure it before and after the fix (e.g. ray-cast the plastic rim around every sticker).
- **Testing gotchas.** Background tabs throttle `requestAnimationFrame`, so animations look stuck in automated tests. Simulate touch with synthetic `PointerEvent`s and trackpad swipes with `WheelEvent`s.

## 6. Ship

- **GitHub Pages:** set `base: './'` in `vite.config.ts` and deploy `dist/` with a GitHub Actions workflow (`actions/upload-pages-artifact` + `actions/deploy-pages`). Free accounts need a public repo for Pages.
- **Before the first commit:** keep personal photos and other large reference files out of the repo (`.gitignore`), and document the research and its sources in `docs/`.
