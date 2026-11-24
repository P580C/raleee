# Brick Snap Lab

Experimental prototype exploring the *feel* of connecting LEGO bricks in a digital context: the attraction, the click, the clutch. This is internal R&D work at LEGO; using LEGO IP (brick geometry, LDraw parts, colours) is permitted here.

The goal is not a building app. The goal is to find out what makes connections feel satisfying on a phone, and to turn that into a reusable connection system that can later go into other projects (first target: the track builder in my Micro Machines-style racing game, which uses Three.js + Rapier + Vite).

## Running, testing, deploying

- Vite 6 + TypeScript, Three.js 0.170.0 from npm. `npm run dev` serves on port 5174 with `host: true` (open the LAN URL on a phone; the racing game uses 5173). `npm run typecheck` / `npm run build`.
- Deployed on every push to `main` by `.github/workflows/deploy.yml`: it builds and pushes `dist/` to the public repo `P580C/brick-snap-lab-site`, served by GitHub Pages at https://p580c.github.io/brick-snap-lab-site/ (public: anyone with the URL can open it). This repo stays private; the workflow uses the `SITE_DEPLOY_KEY` secret (a write deploy key on the site repo). `vite.config.ts` uses `base: './'` so the build works from any folder.
- Open with `?debug` to expose `window.brickSnap = { world, interaction }`. Headless Chrome driven over the DevTools protocol (real mouse input, `import('/src/...')` for the live modules, screen points from `camera.project`) has worked well for checking changes; stored brick poses are only written back when the selection changes, so read live poses from the mesh matrices.
- `brick-snap.html` is the original single-file prototype, kept only as a reference.

## Parts pipeline (LDraw → glTF)

`assets/ldraw_to_glb.py` turns LDraw / BrickLink Studio files into GLBs for the app; `assets/HANDOFF.md` documents it (decisions, connector format, revisions). It now runs here rather than in a separate session.

- Tools (git-ignored): `.venv/` (Python with numpy, Pillow), `.cache/LDCadShadowLibrary` (shallow clone; connector data) and `.cache/LDConfig.ldr` (the current LDraw.org colours, from the gkjohnson/ldraw-parts-library repo; it matches `assets/palette.json`).
- Parts come from Studio's library, `/Applications/Studio 2.0/ldraw`. Its LDConfig is the old colour set, so always pass `--ldconfig`.
- Convert: `.venv/bin/python assets/ldraw_to_glb.py assets/X.ldr assets/X.glb --lib "/Applications/Studio 2.0/ldraw" --ldconfig .cache/LDConfig.ldr --shadow .cache/LDCadShadowLibrary`. Instanced mode (the default) with full detail is what the app wants: no `--ground`, no `--lowres`.
- Output: one mesh per (part, colour), node extras `{part, colour, colourName, connectors}`. Connector `pos` is the mating end, `axis` points out of a stud / into an anti-stud / along a bar, plus `length`, `radius`, `center`; kinds `stud`, `antistud`, `bar`, `clip`, `other`.
- Test files: `assets/testBricks` (3005, 3004, 3003, 2357, 3062a, 54200, 3040b) and `assets/testBricks_2` (4070 headlight brick with a side stud, 60475a brick with a vertical clip, 32828 round plate with a bar), `.ldr` and `.glb`.

## Code

Modules in `src/`:

- `main.ts`: wires world, interaction and UI, loads the imported parts, and runs the frame loop (step → updateImpact → tray → render → camera).
- `stage.ts`: renderer, scene, orbit camera (starting view fits the baseplate).
- `floor.ts`: endless paper floor from `images/paper_grid.png` (512 px tile, 1 px = `floorScale` LDU, default 1). Fades to transparent from 2048 px to 3072 px from the origin. Paints the missing seam line into the tile at load (the PNG has no line on its edges).
- `lighting.ts`: sun, sky/environment fill, shadows, GTAO ambient occlusion (EffectComposer, only used when AO > 0), tone mapping. `applyLighting()` pushes P into the scene; `renderFrame()` renders; `prepareMaterial()` gives materials created later the current shadow setup. Patches a PCSS (contact-hardening) path into three's PCF shadow chunk at load, enabled per material via the `USE_PCSS` define. Environment is either the studio room or a procedural Preetham sky (`Sky` addon) that follows the sun: one copy as an optional backdrop, one captured into a PMREM env map (sun disc removed). Fake bounce: a hemisphere light black from above, coloured from below by the baseplate colour × sun colour, scaled by `bounce` × sun intensity. Post chain (only when AO, DoF or bloom > 0): Render → GTAO → Bokeh DoF (focus eases to `interaction.focusPoint()` or `camTarget`, speed `focusSpeed`) → UnrealBloom → Output. `?ao=debug` shows the raw AO buffer.
- `parts.ts`: part catalogue (`PARTS`), LDU constants, `PartDef`. A part declares `studs` and `antiStuds` (`Conn`: a point plus an optional `dir`, default +y), optional `bars` and `clips`, optional `cells` (the footprint cells it really covers, for shapes like the 2357 corner brick) and optional own `colour`.
- `colours.ts`: LDraw colour code → hex, read from `assets/palette.json` (the pipeline's `--palette-json` output). The only colour table; regenerate the palette instead of editing colours.
- `orient.ts`: the 24 axis-aligned orientations as integer matrices (indices 0..3 are quarter turns about y): `applyOri`, `compose`, `inverse`, `turn(axis, k)`, `oriMatrix`, `snapAxis`.
- `geometry.ts`: builds brick / plate / tile / baseplate meshes from a `PartDef`: rounded-box shell with edges bevelled by `P.bevel`, filleted stud tops, open underside (bottom rim, inside-out cavity, tubes). Cached per part and bevel; `world.refreshGeometry()` rebuilds after a bevel change. Imported parts register their own mesh (`registerImportedGeometry`). `plastic()` materials get a fake-subsurface "glow" term (wrapped diffuse in a more saturated tint) patched into three's direct-light diffuse, driven by `plasticUniforms.plasticGlow` (= `P.glow`).
- `imported.ts`: loads pipeline GLBs into `PartDef`s with `kind: 'imported'`, their own colour and mesh, one per (part, colour). Converts to LDU (1 glTF unit = 20 LDU) and re-centres from the LDraw part origin (varies by part) to the bottom centre of the footprint, with the footprint laid on the stud lattice phased by a vertical stud or anti-stud (so a clip or bar sticking out doesn't knock the connectors off the grid). Reads studs and anti-studs in any direction (centred through-holes skipped), bars and clips. Probes the mesh from above per footprint cell and sets `cells` when some are empty.
- `world.ts`: the `Brick` list (resting pose = origin `pos` + orientation `o`, hex `colour`), the starting layout (`extendLayout` adds to it at runtime; layout entries give `q`, quarter turns about y), and `addBrick` for dropped parts (removed again by Reset).
- `connectors.ts`: connector system. `StudIndex` (studs, bars and clips of the parts not held), seat search (`findSeat`), `links` (what a placed group connects to: count, glow points, partners), collision, support height, connection graph (`liftGroup`: the leader plus its children, i.e. parts plugged onto its studs and bars held in its clips, transitively; `attachedTo`), `openSeats` (free spots for dropping a part). Collision is box-based and boxes rotate with the part: one box over the footprint, or one per covered cell. Parts joined sideways or by a clip are exempt from colliding with each other (they interlock inside each other's boxes). Each seat has an approach direction `n`: up for studs on top, sideways for a side stud or clip.
- `edges.ts`: edge/corner detection for grab-to-turn (`edgeFaces`: a part-local point within `rotateZone` of two or more faces of the part's box, the band capped at 30% of each dimension) and the white edge highlight (a bar along an edge, three arms at a corner, in the part's local frame).
- `interaction.ts`: the state machine for the selected group, pointer input (drag, turn, orbit, pinch, tray taps, mouse hover), and all brick matrices. Draws the ghost and the stud glow (instanced white caps plus halos on each stud the group will connect to, a sleeve on a clip that will take a bar). `dropNew` drops a new part onto a free spot on the baseplate. The group's rotation is `oBase` (one of the 24) turned by `rotVis` about `spinAxis`; finished turns are folded into `oBase` a quarter at a time.
- `tray.ts`: parts tray. Dark (#222) top-down drawings lying flat on the floor in front of the baseplate, in rows each centred on the plate: bricks 2x4, 2x2, 1x1; plates 2x2, 1x2, 1x1; tiles 2x2, 1x2, 1x1; then a row per imported file (`addTrayRow`). Footprint with stud rings knocked out (upward studs only), tiles plain, partial footprints drawn cell by cell. Tapping one drops that part (its own colour, or a random one) onto the plate: it falls `dropHeight` over `dropMs` with the usual edge-first lean and clicks in. A drag that starts on a drawing still orbits. Temporary UI, to be replaced with designed UI later.
- `feedback/`: `audio.ts` (samples for click/pop, synth for the rest), `haptics.ts`, `impact.ts` (stack dip and camera shake; `contactFx` fires them with the sound and haptic).
- `tuning.ts`: `P`, `DEFAULTS`, slider spec and tune panel. `P` is mutated in place, never reassigned.
- `hud.ts`: status, hint, toast. `math.ts`: `clamp`, `lerp`, `spring`.

## The scene

- A 12x12 baseplate (green, fixed; not a real LDraw size) as the playground. Movable parts start seated on it: 2x4 brick 3001 (red, blue), 2x2 brick 3003 (yellow), 2x2 plate 3022 (orange), 1x2 brick 3004 (white), then one of each imported part (`testBricks` across the back half, `testBricks_2` across the middle). Reset restores this layout and removes dropped parts.
- Also in the catalogue for the tray: brick 3005 (1x1), plates 3023 (1x2) and 3024 (1x1), tiles 3068b (2x2), 3069b (1x2), 3070b (1x1). A tile is a plate-height part with no studs (`kind: 'tile'`).
- Built-in part geometry is generated in code to LDraw measurements. Imported parts use the pipeline's mesh as is (full detail, undersides intact, no bevel slider).
- Sounds: the seat click plays a random file from `sounds/click/`, pulling a brick free plays one from `sounds/bloop/` (picked up via `import.meta.glob`, so adding/removing files just works; fetched at load, decoded on first touch, synth fallback until decoded). Pick-up ticks, quarter-turn ticks and the thud are synthesised. Haptics (`navigator.vibrate` on Android; iOS Safari fallback clicks a hidden `<input type="checkbox" switch>`).
- A tune panel with sliders, choice buttons and lighting presets (Studio = original look, Soft, GI look, Overcast, Outdoor); values persist in localStorage, and "Copy values" exports them as JSON. The panel header shows fps while open.
- Mobile first: touch drag and turn, one-finger orbit on empty space, pinch zoom, safe-area padding. With a mouse, hovering an edge highlights it and changes the cursor.

## Units, poses and connections (LDraw units, LDU)

- 1 stud pitch = 20 LDU. Brick height = 24 LDU. Plate = 8 LDU. Stud = 12 LDU diameter, 4 LDU tall. Bar radius = 4 LDU.
- A part's origin is the bottom centre of its footprint (in its own frame). Baseplate is 4 LDU thick, so parts seat on it at y = 4.
- A part's pose is its origin `pos` plus an orientation `o`: one of the 24 axis-aligned orientations (`orient.ts`). Upright parts use 0..3 (quarter turns about y).
- A stud and an anti-stud connect when they're at the same world point with the same direction (keys rounded to 1 LDU), vertical or sideways. A bar fits a clip when they're parallel and the clip's centre lies on the bar; where along the bar is picked from the finger's xz (the middle of a vertical bar).
- Keep everything in LDU. Do not introduce metres or arbitrary scale factors.

## Interaction model (the important part)

The connection is a sequence of moments, not one snap:

1. **Pick up**: touching the middle of a part's face selects it plus its children (a rigid group). The group lifts so its lowest point is at `highest other stud top + lift` and follows the finger on a horizontal plane (with a grab offset so it doesn't jump).
2. **Attraction**: within `attractRadius` of the nearest valid seat (at least one connection, no intersection, ties go to the higher seat), the group is pulled toward it (smoothstep falloff × `attractStrength`): toward a point backed off from the seat along its approach direction, so it hovers above studs on top, or beside a side stud or clip. A ghost shows the target and the studs (or clip) it will connect to glow white.
3. **Lean and commit**: each pick-up rolls a random leading edge and a lean angle between `leanMin` and `leanMax` degrees. While the magnet holds it over studs on top, the group leans by `near × angle`, hinged on that bottom edge of the leader. On release within the radius it moves into the seat over `commitMs`: ease-out across the approach direction, ease-in along it. For studs on top the low edge lands first, then for the last `hingeShare` of the time the rest swings down about that edge, accelerating into the click. Sideways and clip seats slide straight in, without the lean. The lean is separate from `tilt` (clutch peel and wobble, which pivots about the origin).
4. **Click**: on the contact frame, play the click, haptics, stack dip (`press`) and a tiny camera shake together. Click intensity scales with the connection count.
5. **Clutch**: dragging a connected group builds tension. It shifts and tilts (peeling up from the far edge) until finger travel exceeds `clutch * sqrt(studs / 2)`, then it pops free with its own sound and whatever it was attached to jolts. `studs` counts the group's connections to everything outside it.
6. **Turn**: grabbing within `rotateZone` of an edge or corner turns the group about the leader's centre instead of moving it, and that edge or corner highlights white (on press with touch, on hover with a mouse). The axis is the grabbed edge's own direction:
   - a vertical edge, or a corner: spin about y, the finger's angle around the centre read like a dial on a horizontal plane at the grab height;
   - a horizontal edge: tip over that edge (the angle follows the finger along the grabbed point's on-screen path). This is how parts go on their sides for side studs and clips.

   While turning, the group is lifted clear of the parts beneath, with a detent toward each quarter turn (`spinDetent`) and a tick and haptic as each one passes. The ghost and glow show the seat at the nearest quarter, weighted by how close the turn is to it. On release it snaps to the nearest quarter and seats if there's a seat, otherwise rests or falls. A seated group twists first (`twist`): it turns only by `twistGive` of the finger and lifts slightly, then pops free after `twistClutch * sqrt(studs / 2)` degrees and carries on turning. The Rotate button still turns a held group a quarter about y.
7. **Other states**: `loose` (resting on studs unaligned, tap to press in), `falling` (gravity plus bounce with a thud), `ground`.

State machine: `idle | ground | dragging | spinning | committing | connected | clutch | twist | loose | falling`. One group is selected at a time; selecting another first settles the current one instantly. Unselected bricks sit at their stored poses (and dip with the click if attached to the seated group; the baseplate never dips).

Rules:
- **Do not use a physics engine for snapping or connected bricks.** Physics makes connections jittery. Snapping is scripted; connected bricks behave as one rigid group. Physics (Rapier) is only for loose bricks falling or colliding, if needed.
- Feedback for a single event (sound, haptic, dip, shake) must fire on the same frame.
- **Bricks are rigid.** They can move, tilt and dip, but never scale, squash or bend. Brick matrices are translation and rotation only (highlights and glow shapes may scale; they aren't bricks).
- Every feel parameter lives in the `P` object and gets a slider. Never hard-code a feel number in the logic.
- Springs use the `spring(x, v, target, k, zeta, dt)` helper (semi-implicit, 2 substeps, dt capped at 1/30).

## Current tuned defaults

Tuned on device (phone), 18 Nov 2026:

```json
{ "attractRadius": 18.5, "attractStrength": 0.76, "lift": 35, "commitMs": 70, "press": 2, "clutch": 27, "give": 0.59, "volume": 0.8, "haptics": true }
```

What the tuning says: a wide, strong magnet (the brick should find its spot easily), a high lift (it should clearly read as held), and a clutch roughly twice as stiff as the first guess with lots of visible give. Pulling a brick off should feel earned. The click itself (seat speed, press) was right first time. (`squash` was removed on 19 Nov 2026: bricks must stay rigid.)

Not yet tuned on device:
- Added 19 Nov 2026: `"leanMin": 2, "leanMax": 5, "hingeShare": 0.4, "bevel": 0.6`.
- Added 22 Nov 2026: `"studGlow": 0.85, "studGlowHalo": 4, "dropHeight": 90, "dropMs": 320, "traySize": 1, "rotateZone": 5, "edgeGlow": 0.9, "edgeGlowWidth": 1.5, "twistClutch": 30, "twistGive": 0.25, "spinDetent": 0.5`.

Lighting defaults reproduce the original look (the "Studio" preset). The other presets are first guesses to explore from. Note the Studio sun (azimuth 38°) sits almost behind the starting camera (yaw ~29°), which hides most shadows.

These must match `DEFAULTS` in `src/tuning.ts`. Ask me for my latest copied values before changing them.

## History and next steps

Done:
- 19 Nov 2026: Vite + TypeScript port (behaviour-identical); connector system; stacking, connection graph and sub-assembly pull-off; bevelled bricks, lighting, floor.
- 22 Nov 2026: stud glow; parts tray with drops; 1x1 brick, plates and tiles; imported parts from the pipeline (connectors from the LDCad shadow library, colours from `palette.json`); per-cell collision for L-shaped parts; grab an edge or corner to turn, with twist-off; GitHub Pages deploy.
- 23 Nov 2026: 24 orientations and tipping by horizontal edges; sideways studs; bars and clips; pipeline fixes (connector mating ends, scaled lengths, bar/clip kinds, `--ldconfig`).

Open:
1. Test the turn and tip interactions on phones and tune the new defaults.
2. Clips hold a bar only at quarter turns about it (real clips turn freely). Other connector types (Technic pins and axles, hinges, `other` snaps) are ignored. Sideways seats get no landing lean. The tray drops parts upright only.
3. Per-brick falling (only the selected group animates); sub-assemblies held together only from the side.
4. Pipeline: batch runner, more real Studio exports, LODs (see `assets/HANDOFF.md`).
5. Feel experiments: per-stud click ticks when sliding across studs, partial connections (1 stud), angled insertion, two-handed pull on touch.
6. Replace the temporary tray with designed UI (Figma).
7. Later: extract the connector + interaction core as a module for the racing game's track builder. That needs low-detail bricks (instanced, simplified studs) at gameplay camera distance. The racing game is plain JS on Vite 6, but it can import these `.ts` modules directly.

## Conventions

- Keep the prototype phone-first. Test every change on a real phone; desktop mouse is secondary.
- Prefer small, feel-focused changes I can tune live over large feature drops.
- Samples must stay short and preloaded so there is no latency on the click (current ones are 110–170 ms with no leading silence).
- Use LDraw colour codes when adding parts. Hex values come from `assets/palette.json` via `colourHex()` in `colours.ts` (current LDConfig values since 22 Nov 2026, e.g. Blue #1E5AA8). Don't hard-code hex colours for parts.
- New parts from LDraw go through the pipeline (above) rather than being modelled in code.
- When unsure about how something should *feel* or *look*, add a slider and let me decide rather than picking a value silently.
- Lighting must stay phone-friendly: check the fps readout on device when adding anything to the render path.
