# Playbook: building a 3D twisty-puzzle web app

Context for an agent (e.g. Opus 5.5 in Claude Code) asked to recreate a physical twisty puzzle as an interactive 3D web app. It is deliberately short: puzzles vary a lot, so use it as a checklist and adapt. It was written after building the DaYan Tangram Cube Extreme simulator in this repo and extended after the Curvy Copter and Curvy Copter Plus (curved cuts, jumbling, bandaging) and the Maltese Gear Cube (geared mixup, shape-shifting gears).

**The one rule:** get the real geometry from the real puzzle *before* building rendering or UI. Most rework comes from guessing cut positions from low-resolution product photos.

## 1. Ask the user first

Ask in one batch (most users are happy to help, and many own the puzzle):

1. **Which puzzle exactly?** Get the maker, name, version and year, plus any links. Ask whether they own it.
2. **Photos**, the most valuable input:
   - One straight-on, high-resolution photo of a face (perpendicular, whole face in frame, good light). A scrambled puzzle is fine, as long as its outline is still the original shape.
   - The solved puzzle from two opposite corners, to get the colour scheme.
   - Optionally, a short video of each move type. For geared puzzles, ask for one turn held half way, then finished: it shows how the gears move mid-turn.
3. **Measurements.** Edge length, and the distance from an edge to the nearest cut line (ruler or calipers).
4. **Scope.**
   - Variants to include.
   - Turning UI: buttons, keyboard, click-to-turn, drag-to-turn.
   - Extras: undo/redo, notation input, scramble, timer, solve detection, share links.
   - Visual style.
   - Platform (web, or Blender for renders).
   - Hosting (GitHub Pages, Vercel, etc.).

Say clearly which facts are still guesses. Ask again the moment the evidence and the model disagree.

Ask for quick physical checks of directions, e.g. "turn the top clockwise: which way does a front middle gear spin?" It takes the user ten seconds and settles what photos can't. On the Maltese Gear Cube the user's own earlier model had the spin backwards.

## 2. Research (what to find, where)

- **Twisty Puzzles museum.** Use `https://twistypuzzles.com/app/museum/museum_showitem.php?pkey=N`; the old `cgi-bin` URLs block automated fetches. Read:
  - the description (often states the axes, the turn angles, and whether the shape changes);
  - the section (e.g. "Shape Preserving" or "Shape Changing");
  - the mechanism, the designer and the year;
  - the *piece-type signature*, decoded with Andreas Nortmann's `PieceSignature.pdf`. For example, `PIII2mp` means 3 side axes, 2 cuts per axis, and 3 layers (a hexagonal prism).
- **Jaap's Puzzle Page, Ruwix, Speedsolving wiki.** Mechanism, piece counts, notation, state counts.
- **Retail pages.** Shopify stores expose `…/products/<handle>.json`, which lists every product image URL. Many shops return 403/429 to fetchers, so open them in the browser tool instead.
- **The box and packaging.** These can reveal counts (the Tangram Extreme box says "11 Tangram", meaning 11 shapes per face).
- **The maker's own words.** Product pages can state the geometry outright. Meffert's Curvy Copter page says the cut is "placed at an angle of 32 degrees"; the photo fit gave 32.5°. Archived copies (web.archive.org, collectors' PDFs) help when shops block fetchers.
- **Forum threads by the designer and owners.** They hold notation, known algorithms with their orders (e.g. a commutator of order 6), and which moves real puzzles block. All of these make good tests.
- **Classify the puzzle.**
  - Turning type: face, corner, edge, or a hybrid.
  - Axes and layers per axis, and the turn angles.
  - Cut type: plane, or curved. A turning part must be a solid of revolution about its axis, so a curved cut is a cone or sphere centred on the axis ("parabolic" lines on a face are cone sections).
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
6. **Jumble angles come from the axes, not the cut shape.** A partial turn unlocks a neighbour only when it carries one axis onto another at the same angle from the turning axis. For the 12 edge axes that is arccos(1/3) = 70.53° and 109.47°. Owners often describe these clicks as "60°" or "120°", so show them the numbers.
7. **Prototype numerically before building the app.** A Python voxel model of the cut arrangement, with a strict straddle test, reproduced the piece counts and every behaviour the user described: unlock pairs, corner/triangle swaps, which twisted pieces block which edges, and the order of a known commutator. The TS engine's tests then reuse those numbers.
8. **Fit the free parameters, then test alternatives.** For the cones, fit the tilt, then move the apex off the face centres and confirm the fit gets worse. A wrong family of guesses can still match a few counts.
9. **When symmetry and photos disagree, look for hidden geometry before doubting the symmetry.** The Maltese Gear Cube's 22.5° gear axes predict hubs at 0.414 of the half-width, but the photos gave 0.47–0.49. The cause: the stickers stop short of bevelled edges and cut-away vertices. Edge-on photos showed the bevel band.
10. **Trace outlines from several copies on one photo.** Rotate each copy into one frame and average the masks. Then mirror about the shape's symmetry axis, smooth with a Fourier series, and check by overlaying the result on the photo at true scale.

*Lesson from the Tangram build:* the first hypothesis put a corner cut on the face diagonal. It reproduced some counts but was wrong. One straight-on photo from the user fixed it immediately. Ask for that photo in step 1, not after building.

*Lesson from the Curvy Copter build:* the extra pieces of a "plus" or unbandaged variant are often the original cuts turned by a jumble angle. On the Plus, the small triangle's third cut is the FR cone turned −70.53° about UF. That makes it mechanically identical to a corner, which is why the two swap places.

## 4. Architecture that works

- **Stack.** Vite + TypeScript + three.js, Vitest for the engine, no UI framework needed.
- **Engine (pure TypeScript, no DOM).**
  - Pieces are convex cells: enumerate the sign combinations of the cut planes per layer, then use the H-representation and vertex enumeration. Drop empty cells.
  - Non-planar cuts (curvy/spherical) need mesh booleans instead (e.g. `manifold-3d`).
    - A cone is a ruled surface: one ring of triangles is exact along its generators.
    - Offset a cone by sliding its apex along the axis by offset / sin(half-angle); that gives the piece gaps.
    - Build only the distinct shapes. The cube's 24 rotations turned 3 or 4 prototype shapes into 44 or 68 pieces, which takes milliseconds.
  - **Doctrinaire, all axes through the centre:** store each piece's orientation as an index into a finite rotation group, built by closure with integer multiplication tables. Nothing drifts.
  - **Jumbling or partial angles:** store full transforms. A move is legal when no piece straddles the moving region's boundary; snap only to angles where cuts realign.
    - Intern orientations (a table of matrices keyed to 1e-9) so long sessions don't drift and states compare by id. Jumble rotations are often rational (entries k/3), so matrices stay exact.
    - Represent pieces by constraint lists (inside/outside each cut, inside the cube, outside the core) with surface sample points. Point-in-piece tests are then exact, and no mesh is needed in the engine.
    - Physical legality has two stages:
      1. No straddlers means the turn is free.
      2. Otherwise, anchor edge pieces to their own axis and assign other crossing pieces by majority. Then sweep the turn in small steps and block on collisions deeper than a small tolerance (0.3 mm). Overhangs into empty space then pass and real collisions don't, which is what owners see.
    - Find stops exactly: the angles where a moving piece's cut axis lands on another turning axis (atan2 from the vectors), and that edge's cut is clear there but not just before or after.
    - Context-dependent notation (`UF+` = to the next stop) needs the exact angle in the history, so undo stays exact.
  - A move is a region (`n·x > d`) plus a rotation. Apply it to the pieces whose centroid is in the region.
- **Geared mixups (pieces trading slots through 45° turns):**
  - Store each piece as (slot, k), meaning k quarter turns about the slot's outward axis.
  - Pick slot frames so every move maps frames to frames, then build the move tables by matching rotated frames. The state stays exact and finite.
  - A gear carried 45° lands in the next slot's frame turned 180°, so add the gear spin on top of that.
  - Keep notation parsing, scramble (seeded random moves), undo/redo history and an animation queue as separate, testable modules.
- **Rendering.**
  - Bodies: take the convex hull of each face polygon inset *within its own plane*. Rolling-ball rounding erodes faces at acute cuts, which makes stickers overhang the plastic.
  - Non-convex (curved) bodies can't use a hull, and a general Minkowski rounding takes seconds per piece. If each piece is an intersection of smooth regions, every crease is convex: sweep "the corner outside a ball of radius r" along each crease (found by tracing each output triangle back to its input surface), extend it a little past the ends, and subtract it. Use analytic normals (cone, sphere, and the swept fillet normal), so a coarse mesh still shades smoothly, and pick against the light sharp mesh on a hidden layer. Test that no vertex sits deeper than r(1 − cos φ/2) below its surfaces, and that the ball under every sticker point fits inside the body.
  - Bodies that must stay clear of each other while layers turn about axes through the centre: make each one a cone from the centre over its top region. Rotations keep cones cones, so two bodies only meet where their footprints on the sphere of directions meet, and a 2D clearance check (project everything from the centre onto a face) covers the whole depth.
  - manifold-3d gotcha: `CrossSection.extrude(h, n, twist, scaleTop)` reads a bare number `scaleTop` as `[s, 0]` and builds a wedge. Always pass `[s, s]`.
  - Rolling-ball fillets on acute edges reach far onto the faces (r·tan(φ/2)); cap that reach where a sticker's margin is thin, and add profiles where a crease turns tightly (around a sticker's sharp point), or the sweep cuts across the turn.
  - Simplify every offset outline (`CrossSection.simplify`, a few µm) before building walls or analytic surfaces from it: round-join offsets leave near-duplicate vertices and microscopic spikes whose segment directions are noise, which gives a rolling ball wrong normals (jagged dents) and makes every boolean slower.
  - Outlines traced from a drawing: symmetrise by averaging signed distance fields (not the silhouettes, which leaves a 50% band where the drawing is lopsided), contour, then a light periodic smoothing spline and curvature-adaptive resampling.
  - Sticker outlines from photos: fit a constrained sketch (lines, tangent arcs, mirror symmetry) to the photo with a forward model (rasterise, blur, compare pixels) after rectifying the photo by its own symmetry. Fourier-smoothed traces look wobbly.
  - Stickers: the face polygon inset by a margin, with rounded corners, lifted slightly off the surface. For curved pieces: slice the exact solid just under the face, then use a 2D offset of −(margin + r) followed by +r with round joins. Subtract any printed details, such as the Plus's dot.
  - Tone mapping: `NeutralToneMapping` keeps sticker colours true.
  - Glossy black plastic seen head-on reads as grey under a wide specular lobe. A lower base `specularIntensity` (about 0.35) plus a little clearcoat keeps it black.
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
  - A face-on render compared with the user's photo: rectify the photo with the fitted homography and put the two side by side.
  - The solved view compared with a retail photo.
  - Screenshots after each move type, and scrambled states.
  - Phone width, using an iframe at 390 px.
  - The production build, with no console errors.
- **Measure visual complaints.** When the user reports a visual flaw, measure it before and after the fix (e.g. ray-cast the plastic rim around every sticker).
- **Cross-check against the user's own model, if they have one** (e.g. a macro catalogue). Compare quantities that don't depend on conventions, such as how many pieces each macro changes.
- **Overlaps.** Intersect the exact solids (manifold booleans) at rest in solved and scrambled states. Sweep each move type for mid-turn contacts, and report the worst depth honestly.
- **Testing gotchas.** Background tabs throttle `requestAnimationFrame`, so animations look stuck in automated tests. Simulate touch with synthetic `PointerEvent`s and trackpad swipes with `WheelEvent`s.
- **Jumbling tests.** On a bandaging puzzle a hand-written sequence can be legitimately blocked. Take test sequences from verified sources (the user, forum algorithms) or generate them with the engine, and assert the blocked sets exactly.

## 6. Ship

- **GitHub Pages:** set `base: './'` in `vite.config.ts` and deploy `dist/` with a GitHub Actions workflow (`actions/upload-pages-artifact` + `actions/deploy-pages`). Free accounts need a public repo for Pages.
- **Before the first commit:** keep personal photos and other large reference files out of the repo (`.gitignore`), and document the research and its sources in `docs/`.
- **Several puzzles on one site:** give each puzzle (and each variant worth its own page) a tab that is a plain `?puzzle=` link, and load each app with a dynamic `import()`. A heavy dependency, such as the 208 kB gzipped WebAssembly geometry kernel, is then downloaded only on the tabs that need it.
