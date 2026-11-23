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
  /** Yaw inertia = mass * inertiaRadius². Lower = car rotates more eagerly. */
  inertiaRadius: 1.2,
  cgToFront: 1.15,
  cgToRear: 1.25,
  /** Height of centre of mass; drives longitudinal weight transfer. */
  cgHeight: 0.55,
  trackWidth: 1.5,
  wheelRadius: 0.34,

  // ── Engine & brakes ────────────────────────────────────
  /** Drive force at standstill (N). Falls off towards top speed. */
  engineForce: 9500,
  /** Top speed on tarmac (m/s). 44 m/s ≈ 158 km/h. */
  topSpeed: 44,
  /** 0 = front-wheel drive, 1 = rear-wheel drive. */
  driveRearBias: 0.65,
  /** Deceleration with no throttle (m/s²). Fades out smoothly near standstill. */
  autoBrake: 4.5,
  /** Extra deceleration while handbrake is held (m/s²). */
  handbrakeBrake: 2.5,
  airDrag: 0.5,

  // ── Steering ───────────────────────────────────────────
  /** Max front wheel angle at standstill (rad). */
  steerLow: 0.6,
  /** Max front wheel angle at steerSpeedRef and above (rad). */
  steerHigh: 0.16,
  steerSpeedRef: 38,
  /** How fast the wheels turn towards the input (rad/s). */
  steerRate: 5,
  /** How fast the wheels return to centre / swap sides (rad/s). */
  steerReturnRate: 8,
  /** Extra lock allowed when counter-steering a slide (fraction of slip angle). */
  counterSteerBonus: 0.5,
  /** With steering released, front wheels swing toward the direction of travel (caster). 0 = off. */
  selfAlign: 0.8,

  // ── Tyres ──────────────────────────────────────────────
  /** Lateral friction coefficients (x surface grip). */
  gripFront: 1.25,
  gripRear: 1.15,
  /** Slip angle (rad) at which each axle reaches peak grip. Smaller = sharper, stiffer. */
  slipPeakFront: 0.14,
  slipPeakRear: 0.12,
  /** Fraction of peak grip left once fully sliding. <1 = slides keep sliding. */
  slideGrip: 0.78,
  /** Rear grip multiplier while handbrake is held. */
  handbrakeGrip: 0.3,
  /** How much rear drive force eats into rear lateral grip (throttle widens slides). */
  throttleRearSlip: 0.6,
  /** Scales weight transfer (lift-off oversteer, braking turn-in). */
  weightTransfer: 1.0,
  /** Below this speed slip angles are softened to avoid jitter (m/s). */
  lowSpeedFloor: 4,
  yawDamping: 0.4,

  // ── Drift assist ───────────────────────────────────────
  /** How strongly the slide angle is pulled toward the steering input. 0 = off. */
  driftAssist: 0.5,
  /** Slide angle (rad) that full steering input asks for. */
  driftAngle: 0.55,
  /** How fast (rad/s) a sliding car's velocity swings toward where the nose points, without losing speed. */
  driftCarry: 0.6,
  /** Beyond this slide angle (rad) the car is firmly pulled back. Prevents spins. */
  maxSlip: 1.25,

  // ── Surfaces (grip multiplier, top-speed multiplier, drag per second) ─
  tarmacGrip: 1.0,
  tarmacSpeed: 1.0,
  tarmacDrag: 0.01,
  gravelGrip: 0.62,
  gravelSpeed: 0.85,
  gravelDrag: 0.05,
  grassGrip: 0.48,
  grassSpeed: 0.7,
  grassDrag: 0.16,

  // ── Air ────────────────────────────────────────────────
  /** Vertical gravity for jumps (arcade, heavier than real). */
  gravity: 20,
  /** Tiny yaw control while airborne (rad/s²). */
  airSteer: 0.8,

  // ── Suspension (visual, damped springs) ────────────────
  rollStiffness: 90,
  rollDamping: 7,
  /** Body roll (rad) per g of lateral acceleration. */
  rollPerG: 0.09,
  pitchStiffness: 80,
  pitchDamping: 7,
  /** Body pitch (rad) per g of longitudinal acceleration. */
  pitchPerG: 0.06,
  heaveStiffness: 140,
  heaveDamping: 9,
  /** How much a landing / bump compresses the body. */
  landingSquash: 0.3,
  suspTravel: 0.22,

  // ── Camera ─────────────────────────────────────────────
  /** Width of view across the short side of the screen (m). */
  camView: 46,
  /** Look ahead along velocity (seconds of travel). */
  camLookAhead: 0.45,
  camLookAheadMax: 18,
  camAheadFollow: 2.5,
  camFollow: 10,
  /** Constant shift toward screen-bottom so the car sits above centre (m). */
  camDownBias: 4,
}

export type Tuning = typeof tuning
export type TuningKey = keyof Tuning

export const tuningDefaults: Readonly<Tuning> = Object.freeze({ ...tuning })

const STORAGE_KEY = 'raleee.tuning'

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
