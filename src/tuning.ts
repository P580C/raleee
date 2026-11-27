/**
 * Every handling number lives here.
 * Units: metres, seconds, kilograms, radians, Newtons. Speeds in m/s (x3.6 for km/h).
 *
 * With ?debug in the URL these can be changed live from the TUNE panel;
 * the panel's "Copy" button gives you the changed values to paste back here.
 */
export const tuning = {
  // ── Chassis ────────────────────────────────────────────
  mass: 1000,
  /** Geometry: where the wheels sit (for surface sampling, slopes and visuals). Not used for handling. */
  cgToFront: 2.3,
  cgToRear: 2.5,
  trackWidth: 3.0,
  wheelRadius: 0.68,

  // ── Engine & brakes ────────────────────────────────────
  /** Drive force at standstill (N). Falls off towards top speed. */
  engineForce: 25200,
  /** Top speed on tarmac (m/s). 60 m/s = 216 km/h. */
  topSpeed: 60,
  /** Deceleration with no throttle (m/s²). Fades out smoothly near standstill. */
  autoBrake: 4.5,
  /** Extra deceleration while handbrake is held (m/s²). */
  handbrakeBrake: 3,
  /** Footbrake deceleration on tarmac (m/s²), on top of auto-brake. Less on loose surfaces. */
  brakeDecel: 13,
  airDrag: 0.5,
  /** Reverse: brake held below this forward speed (m/s) drives backwards. */
  reverseEngage: 0.8,
  /** Reverse drive force (N) and top reverse speed (m/s). 7 m/s = 25 km/h. */
  reverseForce: 9000,
  reverseSpeed: 7,

  // ── Steering ───────────────────────────────────────────
  /** Full-lock turn radius at walking pace (m). */
  turnRadiusLow: 5.5,
  /** Full-lock turn radius at steerSpeedRef and above (m). Radius grows with speed squared in between. */
  turnRadiusHigh: 55,
  steerSpeedRef: 45,
  /** How fast the yaw rate reaches what the steering asks for (1/s). Higher = sharper turn-in. */
  yawResponse: 14,
  /** How fast steering input moves toward the stick (full lock per second). */
  steerRate: 8,
  /** How fast steering returns to centre / swaps sides. */
  steerReturnRate: 8,
  /** Extra rotation when off the throttle or braking (weight on the nose). 0.3 = 30% more at full brake. */
  liftTurnIn: 0.3,
  /** Grip-mode rotation is capped at this x the rear grip, so full lock on tarmac carves the tightest
   *  line the tyres can hold instead of over-rotating into a slide and running wide. */
  gripRotateCap: 0.9,
  /** Extra over-rotation allowed on loose surfaces (x grip lost vs tarmac), so gravel still slides into drifts. */
  looseRotate: 3,
  /** How far the front wheels swing toward the direction of travel in a slide (visual counter-steer). */
  counterSteerVisual: 0.35,
  /** Max visual front wheel angle (rad). */
  steerVisual: 0.55,

  // ── Grip ───────────────────────────────────────────────
  /** Front grip: how much of the steering request the car can deliver (x surface grip, capped at 1). */
  gripFront: 1.8,
  /** Rear lateral grip in g (x surface grip). Above this the car slides. */
  gripRear: 2.3,
  /** Front tyres' share of lateral grip in g (x surface grip): pulls the line round with the nose. Fades out in a drift. */
  frontLatGrip: 0.25,
  /** Front lateral grip (g, x surface grip) while handbrake is held: the fronts keep biting while the rear is loose,
   *  so a handbrake turn pulls round the corner instead of carrying straight on. */
  handbrakeFrontGrip: 0.6,
  /** How stiffly small sideways motion is killed while gripping (1/s). */
  latStiffness: 12,
  /** Slide angle (rad) where the car counts as sliding; fully sliding at 2.5x this. */
  slipPeak: 0.14,
  /** Fraction of rear grip left once fully sliding. <1 = slides keep sliding. */
  slideGrip: 0.85,
  /** Rear grip multiplier while handbrake is held. */
  handbrakeGrip: 0.25,
  /** Extra nose rotation while handbrake is held (x steering request). */
  handbrakeYaw: 1.7,
  /** Outside a drift, how fast a slide straightens itself (1/s). */
  slideRecover: 3,
  /** Fraction of that recovery throttle cancels (throttle keeps a loose car sliding). */
  slideRecoverThrottle: 0.75,
  /** How much throttle eats rear grip in a slide (throttle pushes slides wider). */
  throttleRearSlip: 0.35,
  /** How strongly one side's wheels on grass tug the nose that way. */
  grassTug: 0.12,

  // ── Drifting ───────────────────────────────────────────
  /** How fully the drift model takes over once drifting. 0 = off (pure grip model), 1 = full. */
  driftAssist: 1,
  /** Slide angle (rad) of a drift with the steering centred. */
  driftAngle: 0.26,
  /** Extra slide angle (rad) with full steering into the corner. */
  driftAngleSteer: 0.26,
  /** Extra slide angle (rad) at full throttle. */
  driftAngleThrottle: 0.08,
  /** How fast the nose is pulled to the drift's slide angle (1/s). */
  driftHold: 5,
  /** How fast (rad/s) a drift's line turns at full lock. Partial steering gives a proportionally wider sweep. */
  driftTurn: 1.05,
  /** Extra line turn (rad/s) while handbrake is held in a drift. */
  driftHandbrakeTurn: 0.35,
  /** Fraction full throttle widens the line by. */
  driftThrottleWiden: 0.12,
  /** Max sideways g a drift's line can pull. */
  driftMaxG: 2.4,
  /** How quickly the line follows the steering (1/s). */
  driftLineResponse: 4,
  /** Speed lost to the slide (m/s² at 90° sideways). */
  /** Four-wheel drive: share of engine drive that pulls along the nose in a drift (0 = rear-drive feel).
   *  Higher = throttle tightens the line and pulls the car out of the slide. */
  awdPull: 0.4,
  /** 1 = the front wheels are driven too (4WD), 0 = rear-drive. Only decides which tyres kick up dust. */
  driveFront: 1,
  driftScrub: 7,
  /** Natural slide angle (rad) that turns into a drift while on throttle. */
  driftEntryAngle: 0.25,
  /** Below this speed (m/s) drifts end. */
  driftMinSpeed: 7,
  /** How fast a drift builds while throttle is held (per second). */
  driftEntryRate: 3,
  /** Steering into the corner (0..1) needed to keep a drift alive. */
  driftKeepSteer: 0.12,
  /** How fast a drift unwinds with the steering centred (per second). */
  driftCentreRate: 1,
  /** How fast a drift ends while holding opposite lock (per second). */
  driftExitRate: 2.5,
  /** How fast a drift ends after lifting off the throttle (per second). */
  driftLiftRate: 1.4,
  /** Beyond this slide angle (rad) the car is firmly pulled back. Prevents spins. */
  maxSlip: 1.2,

  // ── Scandi flick ───────────────────────────────────────
  /** Yaw kick (rad/s) when a flick fires. 0 disables flicks. */
  flick: 0.8,
  /** Time (s) allowed between the feint and the swing the other way. */
  flickWindow: 0.5,
  /** Min speed (m/s) for a flick. */
  flickMinSpeed: 12,
  /** The feint must have the car rotating at least this fast (rad/s) the other way. */
  flickMinYaw: 0.2,

  // ── Surfaces (grip multiplier, top-speed multiplier, drag per second) ─
  tarmacGrip: 1.0,
  tarmacSpeed: 1.0,
  tarmacDrag: 0.01,
  gravelGrip: 0.6,
  gravelSpeed: 0.85,
  gravelDrag: 0.05,
  grassGrip: 0.45,
  grassSpeed: 0.7,
  grassDrag: 0.16,
  /** The off-track slowdown starts once the car's centre is this far beyond the road edge (m): one car width. */
  offroadMargin: 3.6,
  /** Off the track: speed kept when leaving it, and the top speed off-road (fractions). */
  offroadSpeed: 0.5,
  /** How hard leaving the track slows the car to offroadSpeed (m/s²). */
  offroadBrake: 22,
  /** Weather grip (x all surfaces): rain and snow. */
  rainGrip: 0.9,
  snowGrip: 0.75,
  /** Dust puffs from the driven tyres on loose ground: x the base rate (0 = off). */
  dustAmount: 1,

  // ── Air ────────────────────────────────────────────────
  /** Vertical gravity for jumps (arcade, heavier than real). */
  gravity: 20,
  /** Tiny yaw control while airborne (rad/s²). */
  airSteer: 0.8,

  // ── Suspension (visual, damped springs) ────────────────
  rollStiffness: 60,
  rollDamping: 5.5,
  /** Body roll (rad) per g of lateral acceleration. */
  rollPerG: 0.045,
  /** Extra body roll (rad) per radian of slide angle, so drifts lean even on loose surfaces. */
  rollPerSlip: 0.05,
  /** Roll limit (rad). */
  maxRoll: 0.12,
  pitchStiffness: 55,
  pitchDamping: 5,
  /** Body pitch (rad) per g of longitudinal acceleration. */
  pitchPerG: 0.05,
  /** Pitch limit (rad). */
  maxPitch: 0.12,
  heaveStiffness: 90,
  heaveDamping: 7,
  /** How much a landing / bump compresses the body. */
  landingSquash: 0.35,
  suspTravel: 0.4,

  // ── Collisions (scenery) ──────────────────────────────
  /** Radius of each of the car's two collision circles (m). */
  carRadius: 1.85,
  /** Distance of the circles ahead of and behind the car's centre (m). */
  carCircleOffset: 2.1,
  /** Yaw inertia as a radius of gyration (m): smaller = off-centre hits spin the car more. */
  carGyration: 2.2,
  /** Bounce off scenery: 0 = dead stop against it, 1 = full bounce. */
  hitRestitution: 0.3,
  /** Scrub along scenery while sliding against it (friction coefficient). */
  hitFriction: 0.3,
  /** Body knock on a hit: pitch / roll spring kick (rad/s) per m/s of velocity change. */
  knockPitch: 0.07,
  knockRoll: 0.09,
  /** Upward jolt (m/s of heave) per m/s of velocity change. */
  knockHeave: 0.025,
  /** Cap on any one knock (rad/s or m/s), so big crashes stay readable. */
  knockMax: 2.2,

  // ── Camera ─────────────────────────────────────────────
  /** Width of view across the short side of the screen (m). */
  camView: 66,
  /** Look ahead along velocity (seconds of travel). */
  camLookAhead: 0.45,
  camLookAheadMax: 18,
  camAheadFollow: 2.5,
  camFollow: 10,
  /** Constant shift toward screen-top (the direction of the stage) so the car sits below centre (m). */
  camUpBias: 6,
}

export type Tuning = typeof tuning
export type TuningKey = keyof Tuning

export const tuningDefaults: Readonly<Tuning> = Object.freeze({ ...tuning })

const STORAGE_KEY = 'raleee.tuning.v2'

export function loadTuningOverrides(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const o = JSON.parse(raw) as Record<string, unknown>
    for (const k of Object.keys(o)) {
      if (k in tuning && typeof o[k] === 'number') (tuning as Record<string, number>)[k] = o[k] as number
    }
  } catch {
    /* ignore corrupt storage */
  }
}

export function tuningDiff(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of Object.keys(tuning) as TuningKey[]) {
    if (tuning[k] !== tuningDefaults[k]) out[k] = tuning[k]
  }
  return out
}

export function saveTuningOverrides(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tuningDiff()))
  } catch {
    /* storage may be unavailable */
  }
}

export function resetTuning(): void {
  Object.assign(tuning, tuningDefaults)
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
