Name: Raleee
Type: Game

reference/Cars.jpg - the player's car: low-poly 80s 4WD rally coupe (pale blue-grey, yellow/red/black stripes, rear wing).
reference/car.png - flat-shaded 80s hatchback (salmon-red body, cream roof, round twin headlights, chunky black bumpers, white-wall-ish wheels). This is the car style.
reference/map.jpg - low-poly isometric diorama: a winding road snaking top to bottom across floating terrain islands (grass, forest, sand/dirt, snow) on a pale background. This is the world style.

Study both images before writing any code. Match their mood: soft flat colours, low-poly, clean shapes, gentle soft shadows, no textures beyond simple colour, plenty of empty pale background.

The game in one paragraph

A fast, smooth, arcade rally game. One car, one track, against the clock. It is a point-to-point rally stage, not a loop: the camera follows the car as the road winds up the screen from bottom to top, start line to finish line. The car is a real 3D model with soft suspension, visible body roll and pitch, and it can be thrown into long, controllable drifts. Surfaces change grip (tarmac, gravel, grass off the road). Some sections rise or drop a level. Weather and night are rolled at random each time you load in. Beat your best time, retry instantly.

Tech stack (decided - do not change without asking)
TypeScript + Vite + three.js. Mobile browser first, installable as a PWA later.
Orthographic camera at a classic isometric-ish angle (roughly 35° pitch, 45° yaw - tune to match map.jpg). This is what gives the "fake 3D" look: nothing shrinks with distance, road width and car size are constant everywhere on screen. Do not use a perspective camera.
Custom arcade vehicle physics written by hand. Do not use a physics engine (no cannon, rapier, ammo). The handling is the product and needs to be fully tunable.
Fixed-timestep simulation (e.g. 120 Hz) with interpolated rendering, so handling feels identical at 60 Hz, 90 Hz and 120 Hz displays.
Performance budget (hard requirements)
Locked 60 fps on a mid-range phone from ~2021 (e.g. iPhone 12, Pixel 5). Test with Chrome DevTools CPU 4x throttle as a proxy.
Rendering and lighting follow the look of the Brick Snap Lab mini-game (../Brick Build, see BRICK_CLAUDE.md), ported in src/render/lighting.ts, look.ts and materials.ts: flat-shaded MeshStandard (world) and clearcoat plastic with a fake-subsurface glow (car), studio or Preetham-sky environment fill, a sun with PCSS contact-hardening shadows whose shadow map follows the car, fake bounce light, ACES/AgX/Neutral tone mapping, and optional GTAO, tilt-shift depth of field and bloom (post chain only runs when one is > 0). Presets: Studio, Soft, GI look, Overcast, Outdoor, Outdoor lite (default: Outdoor without the post chain; AO + DoF + bloom measured ~4x the frame cost, 29.5 ms vs 7 ms on an M4 Mac); pick with ?look=name or the Look section of ?debug. three is pinned to 0.170.0 to match the mini-game (the PCSS patch needs its shadow chunk). ?fps (or ?debug) shows a frame-time meter; tap it to cycle presets and compare their cost on the device.
Track is built in chunks; only chunks near the camera are in the scene. Merge static geometry per chunk, instance trees and props.
Cap devicePixelRatio at 2. Add an FPS/frame-time overlay toggled by a debug flag.
No per-frame allocations in the hot loop (reuse vectors).
Camera
Follows the car smoothly with slight look-ahead in the direction of travel, so the player sees more road ahead than behind. In portrait the car should sit below centre when driving up-screen, giving room to see what's coming.
The track's overall direction is bottom to top of the screen (the car drives upwards). Corners swing left and right like map.jpg.
Camera never rotates. Only translates. Subtle shake on landings and hard impacts, with a setting to turn it off.
LEGO models (car and scenery)
The car and scenery will be LEGO models built in BrickLink Studio and exported as LDraw. Import them with tools/import_lego.py, which reuses the Brick Snap Lab pipeline (../Brick Build/assets/ldraw_to_glb.py) without changing it: the brick game keeps full-detail whole parts, this game strips everything the camera can't see. Body/scenery: merged, keeps only faces visible from at least 15° above the horizon (undersides, tubes, insides and faces hidden between bricks go). Submodels named "wheel*" become separate wheel meshes (one per use, culled to their outer half since they spin). Studs use 8-sided primitives. Test car (tools/test/testCar.mpd): 16,076 tris full detail -> 4,650. Check imports with /tools/preview.html?a=<full.glb>&b=<game.glb>&pitch=35. One-time setup: python3 -m venv tools/.venv && tools/.venv/bin/pip install numpy pillow trimesh embreex scipy rtree.

Car model
Build the car procedurally in code (src/render/carModel.ts) to match reference/Cars.jpg: a boxy wedge-shaped 80s four-wheel-drive rally coupe, pale blue-grey body, yellow lower band, red and black side stripes, box-flared arches, low rear wing, quad spot lamps, white five-spoke wheels, two tail lamps with the white reversing lamps inboard. (reference/car.png was the original hatchback and still sets the general flat-shaded style.) The car is 4WD: strong traction, and drifts are four-wheel drifts where throttle pulls the car round (tuning: awdPull). The front tyres also hold the line: a little lateral grip in normal cornering (frontLatGrip) and more while the handbrake is held (handbrakeFrontGrip), so handbrake turns pull round instead of understeering wide. Keep it under ~1,500 triangles.
Lamps (src/render/carView.ts, positions per car in cars.ts lamps): headlamp glow and brake / reversing lamp glow are soft sprites (fake bloom, no post pass). Headlight beams are a fading texture on the ground ahead, drawn after the road and scenery but before the car (no depth test), so a rising road never hides them and they never cover the car. At night a real SpotLight (no shadows) lights the road and scenery; it only exists at night, so daytime pays nothing.
Body is a separate node from the wheels so it can roll and pitch on the suspension.
Wheels steer visually (front) and spin with speed.
Handling (the most important section)

Arcade, not sim. It should feel like an exaggerated 80s Group B car: light, lively, loves to slide, always recoverable.

Controls

Go - throttle. Held = accelerate.
Steer - left / right.
Handbrake - held = rear wheels lose most of their grip, car rotates into a drift. Release to regain grip.
No throttle = gentle auto-brake (engine braking plus light drag), not a coast. The car should slow down noticeably but smoothly, never stop dead.
Brake - S / Down, or the BRAKE touch button above GO. Held at a standstill it reverses (slowly, ~25 km/h); throttle drives forward again. Brake lamps glow under braking and while the handbrake is held, white reversing lamps in reverse. If the car gets stuck or leaves the track, auto-reset onto the nearest track point after ~1.5 s (with a short fade).

Model

2D top-down vehicle model (bicycle model or a simple 4-wheel model) for the main dynamics: position, heading, velocity, angular velocity.
Separate front and rear lateral grip. Drift happens when rear grip is exceeded. Handbrake cuts rear grip sharply.
Counter-steer should hold and steer a drift. Throttle in a drift should push the slide wider and keep it alive.
Speed-sensitive steering: lots of lock at low speed, less at high speed.
A light "drift assist" that gently pulls the slide angle toward the steering input so drifts are controllable on a touch screen. Make its strength a tunable value.

Suspension and body motion (visual, driven by the physics)

Body roll from lateral acceleration, pitch from longitudinal acceleration (squat on throttle, dive on braking).
Each is a damped spring: soft, slightly bouncy, overshoots a little then settles. Exaggerate it, this is a big part of the charm.
Wheels follow the ground height. Body follows the wheels through springs, so bumps and level changes visibly compress and extend the suspension.

Surfaces

Surface	Grip	Top speed	Feel
Tarmac	high	100%	precise, drifts need handbrake
Gravel	low	~85%	loose, easy long drifts
Grass (off the road only)	lowest	~70%	slows you down, punishes cutting corners

Road surfaces are tarmac and gravel only (SurfaceName). Grass is not a road surface any more: it is the ground off the road. Stages saved with a grass road load it as gravel (roadSurface() in track.ts).
Mixed sections blend between surfaces per wheel, so two wheels on grass pulls the car sideways. Grip is sampled per wheel from the track data.
Dust (src/render/dust.ts): the driven tyres (all four on the coupe, rears on the hatch; tuning driveFront) kick up low-poly puffs on any loose ground (gravel, grass, off the road). Amount from the sim's per-wheel dust (rolling speed, throttle/wheelspin, slides); sandy on gravel, greener on grass. Puffs shrink away instead of fading (opaque, one instanced draw call). Tuning: dustAmount.

Level changes

Ramps and drops between height levels. The car keeps a vertical velocity, can get small amounts of air off crests, and lands on the suspension (big compression, camera shake).
No full 3D physics. Height comes from the track's elevation profile. When airborne, horizontal motion continues, gravity applies, steering does almost nothing.

Weather and time of day

Rolled at random each time you load into a race (menu RACE or an editor DRIVE); retry keeps it. Weather (src/sim/weather.ts): clear, rain, snow or fog, equally likely. Time: night with NIGHT_CHANCE (30%), combined with any weather. The HUD shows it under the timer. Menu and editor are always a clear day. Force with ?weather=clear|rain|snow|fog and ?time=day|night.
Grip: rain x rainGrip (0.9), snow x snowGrip (0.7), fog and clear 1. Track.weatherGrip scales every tyre force, including the ones capped on a dry road (steering bite, braking, traction), so it is felt below the limit, not only at it.
Look (src/render/weatherView.ts, per-weather table LOOKS): sun dimming and floor colour via Lighting.setWeather. Rain streaks and wind-blown snow are world-anchored instanced particles drawn over the scene, wrapped round the view in screen axes (and in depth). Snow banks the road edges with ragged white drifts (snowDrifts.ts, built per stage the first time it snows). Fog is a DOM radial gradient centred on the car, 2x thick (4% visibility at the screen edges). Headlight glow per weather (none on a clear day), beams in rain and fog.
Night: near-black floor, almost no moon or sky fill, every self-lit material switched off except the car's lamps and the road lines (a faint neutral glow, userData.nightEmissive), headlights full on with beams and the SpotLight, light HUD text (.night class). Rain and snow at night only show inside the headlight beams (BeamMask) and gather round them.

Tuning

Put every handling number in one tuning.ts file.
Add an on-screen debug panel (behind a flag, e.g. ?debug) with sliders for the key values: grip front/rear, handbrake grip, drift assist, steering rate, auto-brake strength, spring stiffness/damping for roll and pitch. Changes apply live. Add a "copy values" button.
Touch controls (portrait)
Left thumb: steer. Two large invisible zones (left half / right half of the bottom-left area), or a horizontal drag strip - implement both behind a setting, default to drag strip with analogue steering.
Right thumb: a large GO button and a HANDBRAKE button just above/beside it, so the thumb can roll between them.
Buttons are semi-transparent and placed so they never cover the road ahead of the car.
Prevent page scroll, zoom, text selection and long-press menus. Use pointer events. Support multi-touch properly.
Keyboard fallback for desktop testing: Up/W = go, Down/S = brake / reverse, Left/Right or A/D = steer, Space = handbrake, R = restart, Esc = menu. URL shortcuts: ?track=<id>&car=<id>&race skips the menu; ?weather=<kind> and ?time=day|night force the conditions.
Light haptics via navigator.vibrate where supported, on landing and on hitting grass.
Tracks
Tracks are data, not code. Each track is a JSON file containing a centreline spline (control points with x, z, elevation), road width, and per-segment surface type.
Stages are built from slot-car style pieces (like a Scalextric set, src/sim/pieces.ts): straight (32 m), 45° bend (r 40), 90° bend (r 32), large 90° (r 56), small 90° (r 18), each left or right, with a surface (tarmac or gravel) and an optional ramp of one level (2.5 m) up or down; plus a roundabout (ring radius 20 round a grass island, four arms ending 32 m from the centre, exit left / straight on / right, always level). The whole ring and all arms are road for the physics (Track.junctions); unused arms are capped. Headings stay on multiples of 45°, so straights follow the isometric grid like map.jpg. A piece stage is JSON ({format: "pieces", heading, pieces}) converted to the spline format on load; a 200 m lead-in puts the road off the bottom of the screen and a 60 m run-out follows the finish. Built-in stages: src/tracks/valley.json, sprint.json (piece stages) and stage1.json ("Classic", spline). src/tracks/registry.ts lists them plus the player's own (localStorage).
Menu (src/ui/menu.ts): pick a stage and a car, RACE, or open the editor. Cars (src/cars.ts): the 4WD Group B coupe (carModel.ts, Cars.jpg) and the original Retro Hatch (carHatch.ts, RetroCar.png: rear-drive, less power, tail-happy); each lays its own handling numbers over tuning.ts.
Track editor (src/editor/editor.ts), two tabs. TRACK: every piece variant in one grid (straight, 45/90/wide/tight left and right, roundabout left/ahead/right); tap to add after the selected piece, tap the road to select, change surface / level, FLIP, delete, undo, fit; ROTATE STAGE in the ••• menu. SCENERY: the models in public/models/scenery.json (thumbnails rendered on load); tap one to drop it in the middle of the view, tap a placed model to select, drag to move, ⟲/⟳ (or Q/E) turn 15°, COPY, DELETE, SNAP (1 m / 15°), AUTO MOUNDS (scatter test mounds when racing). Placed scenery is stored in the stage ({m, x, z, r}), sits on the road height nearest it, is instanced in the race and collides (parts above collideAbove). Drag empty ground to pan, pinch or scroll to zoom.
Scenery models: build in BrickLink Studio, export LDraw, then tools/.venv/bin/python tools/import_lego.py ldraw/X.ldr public/models/x.glb --scenery "Name" [--game-scale 3] [--collide-above 1.2] adds it to the catalog. Overlapping road shows red. Changes save automatically; DRIVE test-drives the stage and EDIT returns to the editor. COPY JSON / PASTE JSON move stages between devices. Generate the road mesh, verges, shoulders and terrain islands from that data.
The world style follows map.jpg: road on top of low-poly floating islands of terrain, themed scenery (pine trees, rocks, dead trees on sand, snow patches), small props (signs, a few parked cars, animals as tiny static low-poly shapes). Pale background around the islands.
Make one complete track for v1, about 60-90 seconds for a good run, passing through at least three themes (e.g. village tarmac -> forest gravel -> sandy dirt with a jump -> snow finish) and including at least two level changes.
Off-road: the car can leave the road onto the island terrain (grass/sand grip). Falling off an island edge triggers a reset.
Simple checkpoints along the spline so shortcuts can't skip the track, and to drive the reset position.
Game loop and UI
Title screen -> 3-2-1 countdown -> race -> finish screen with time, best time, and the delta. "Retry" is one tap and instant. Retry speed matters more than anything else on the menus.
During the race: timer at the top, split time vs best at each checkpoint (green/red), small speed readout.
Best times and a ghost of the best run saved in localStorage. Ghost is a translucent car replaying recorded positions.
Typography and UI style should feel 80s rally: bold condensed type, chunky shapes, a limited palette pulled from the reference images.
Audio (simple, can be v1.1)
Synthesised engine note with Web Audio (pitch follows RPM/speed), tyre skid noise whose volume follows slip, surface sounds for gravel and grass. Audio must start on the first user tap (mobile autoplay rules).
How to work
Milestone 1 - feel first. Grey-box flat test track (one big loop with a few corners, one tarmac section, one gravel section, one ramp), the car as coloured boxes, orthographic camera, touch + keyboard controls, the tuning panel. Stop here and tell me so I can drive it on my phone and tune the handling before any art. Run it with vite --host so I can open it on my phone on the same Wi-Fi.
Milestone 2 - look. Procedural car matching car.png, body roll/pitch, track mesh generator from JSON, island terrain and scenery matching map.jpg, shadows, particles.
Milestone 3 - game. Timer, checkpoints, best time, ghost, menus, finish screen, audio.
Milestone 4 - polish and performance pass on a real phone. Profile and fix anything under 60 fps.

Keep the code organised: sim/ (physics, pure and deterministic, no three.js imports), render/ (three.js scene, car, track meshes), input/, ui/, tracks/. The simulation should be testable without rendering.

After each milestone, give me a short list of what's done, what to test, and what values in tuning.ts you'd suggest I try first.