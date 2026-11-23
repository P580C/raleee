Name: Raleee
Type: Game

reference/car.png - flat-shaded 80s hatchback (salmon-red body, cream roof, round twin headlights, chunky black bumpers, white-wall-ish wheels). This is the car style.
reference/map.jpg - low-poly isometric diorama: a winding road snaking top to bottom across floating terrain islands (grass, forest, sand/dirt, snow) on a pale background. This is the world style.

Study both images before writing any code. Match their mood: soft flat colours, low-poly, clean shapes, gentle soft shadows, no textures beyond simple colour, plenty of empty pale background.

The game in one paragraph

A fast, smooth, arcade rally game. One car, one track, against the clock. The camera follows the car as the road winds down the screen from top to bottom. The car is a real 3D model with soft suspension, visible body roll and pitch, and it can be thrown into long, controllable drifts. Surfaces change grip (tarmac, mud, grass, mixed). Some sections rise or drop a level. Beat your best time, retry instantly.

Tech stack (decided - do not change without asking)
TypeScript + Vite + three.js. Mobile browser first, installable as a PWA later.
Orthographic camera at a classic isometric-ish angle (roughly 35° pitch, 45° yaw - tune to match map.jpg). This is what gives the "fake 3D" look: nothing shrinks with distance, road width and car size are constant everywhere on screen. Do not use a perspective camera.
Custom arcade vehicle physics written by hand. Do not use a physics engine (no cannon, rapier, ammo). The handling is the product and needs to be fully tunable.
Fixed-timestep simulation (e.g. 120 Hz) with interpolated rendering, so handling feels identical at 60 Hz, 90 Hz and 120 Hz displays.
Performance budget (hard requirements)
Locked 60 fps on a mid-range phone from ~2021 (e.g. iPhone 12, Pixel 5). Test with Chrome DevTools CPU 4x throttle as a proxy.
Flat-shaded materials only (MeshLambertMaterial or a tiny custom shader). No post-processing in v1.
One directional light with a single shadow map that follows the car, small frustum, low resolution. Fall back to blob shadows if shadows cost too much.
Track is built in chunks; only chunks near the camera are in the scene. Merge static geometry per chunk, instance trees and props.
Cap devicePixelRatio at 2. Add an FPS/frame-time overlay toggled by a debug flag.
No per-frame allocations in the hot loop (reuse vectors).
Camera
Follows the car smoothly with slight look-ahead in the direction of travel, so the player sees more road ahead than behind. In portrait the car should sit above centre when driving down-screen, giving room to see what's coming.
The track's overall direction is top to bottom of the screen. Corners swing left and right like map.jpg.
Camera never rotates. Only translates. Subtle shake on landings and hard impacts, with a setting to turn it off.
Car model
Build the car procedurally in code from boxes/bevelled boxes to match reference/car.png: low hatchback, cream roof, salmon body, dark bumpers, round headlights, dark windows, chunky wheels. Keep it under ~1,500 triangles.
Body is a separate node from the wheels so it can roll and pitch on the suspension.
Wheels steer visually (front) and spin with speed.
Handling (the most important section)

Arcade, not sim. It should feel like an exaggerated 80s Group B car: light, lively, loves to slide, always recoverable.

Controls

Go - throttle. Held = accelerate.
Steer - left / right.
Handbrake - held = rear wheels lose most of their grip, car rotates into a drift. Release to regain grip.
No throttle = gentle auto-brake (engine braking plus light drag), not a coast. The car should slow down noticeably but smoothly, never stop dead.
No reverse in v1. If the car gets stuck or leaves the track, auto-reset onto the nearest track point after ~1.5 s (with a short fade).

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
Gravel / mud	low	~85%	loose, easy long drifts, dust/mud particles
Grass	lowest	~70%	slows you down, punishes cutting corners

Mixed sections blend between surfaces per wheel, so two wheels on grass pulls the car sideways. Grip is sampled per wheel from the track data.

Level changes

Ramps and drops between height levels. The car keeps a vertical velocity, can get small amounts of air off crests, and lands on the suspension (big compression, camera shake).
No full 3D physics. Height comes from the track's elevation profile. When airborne, horizontal motion continues, gravity applies, steering does almost nothing.

Tuning

Put every handling number in one tuning.ts file.
Add an on-screen debug panel (behind a flag, e.g. ?debug) with sliders for the key values: grip front/rear, handbrake grip, drift assist, steering rate, auto-brake strength, spring stiffness/damping for roll and pitch. Changes apply live. Add a "copy values" button.
Touch controls (portrait)
Left thumb: steer. Two large invisible zones (left half / right half of the bottom-left area), or a horizontal drag strip - implement both behind a setting, default to drag strip with analogue steering.
Right thumb: a large GO button and a HANDBRAKE button just above/beside it, so the thumb can roll between them.
Buttons are semi-transparent and placed so they never cover the road ahead of the car.
Prevent page scroll, zoom, text selection and long-press menus. Use pointer events. Support multi-touch properly.
Keyboard fallback for desktop testing: Up/W = go, Left/Right or A/D = steer, Space = handbrake, R = restart.
Light haptics via navigator.vibrate where supported, on landing and on hitting grass.
Tracks
Tracks are data, not code. Each track is a JSON file containing a centreline spline (control points with x, z, elevation), road width, and per-segment surface type. Generate the road mesh, verges, shoulders and terrain islands from that data.
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