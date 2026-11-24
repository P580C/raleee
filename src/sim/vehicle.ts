/**
 * Arcade rally car: 2D one-track model for the main dynamics, plus a 1D vertical
 * model for jumps and damped springs for the visual body motion.
 *
 * Pure and deterministic: no three.js, no Date/random, no allocation per step.
 *
 * Conventions (world): y is up, the car's forward is (sin h, cos h) in (x, z),
 * its right is (-cos h, sin h). Positive yawRate = turning right, which
 * DEcreases heading. Positive steer = right. Positive slip angle (β) = the car
 * is moving to the right of where its nose points.
 */
import { circleVsObstacle, contact, type Obstacle } from './obstacles'
import { tuning as T } from '../tuning'
import { clamp, moveTowards, smoothstep, wrapAngle } from './math'
import { makeGroundSample, Track } from './track'

export const G = 9.81
export const SIM_HZ = 120
export const SIM_DT = 1 / SIM_HZ

export interface Controls {
  /** 0..1 */
  throttle: number
  /** -1 (left) .. 1 (right) */
  steer: number
  handbrake: boolean
  /** 0..1 footbrake. Overrides throttle. */
  brake: number
}

export class CarState {
  x = 0
  z = 0
  heading = 0
  vx = 0
  vz = 0
  yawRate = 0

  y = 0
  vy = 0
  grounded = true
  groundY = 0
  airTime = 0
  onIsland = true

  /** Smoothed steering input, -1..1. */
  steerInput = 0
  /** How fast the direction of travel is turning (rad/s, right-positive). */
  pathRate = 0
  /** Drift: direction (-1 left, 0 none, 1 right), strength 0..1, and the line's turn rate (rad/s). */
  driftDir = 0
  driftAmt = 0
  driftRate = 0
  /** Recent hard steering, decaying; used to detect the scandi flick. */
  flickMem = 0
  steerAngle = 0
  spinFront = 0
  spinRear = 0

  // visual suspension (body relative to wheels)
  roll = 0
  rollVel = 0
  pitch = 0
  pitchVel = 0
  heave = 0
  heaveVel = 0
  // chassis orientation from the ground under the wheels
  groundPitch = 0
  groundRoll = 0
  // filtered body-frame accelerations (m/s²)
  axF = 0
  ayF = 0

  speed = 0
  forwardSpeed = 0
  slipAngle = 0
  wheelsOnGrass = 0
  trackIdx = -1
  trackS = 0
  lateral = 0
  /** Biggest landing impact (m/s) since last cleared by the game. */
  landImpact = 0
  /** Biggest obstacle hit (closing speed, m/s) since last cleared by the game. */
  hitImpact = 0
  /** Ground height under each wheel: FL, FR, RL, RR. */
  readonly wheelH = new Float64Array(4)

  copyFrom(o: CarState): void {
    this.x = o.x
    this.z = o.z
    this.heading = o.heading
    this.vx = o.vx
    this.vz = o.vz
    this.yawRate = o.yawRate
    this.y = o.y
    this.vy = o.vy
    this.grounded = o.grounded
    this.groundY = o.groundY
    this.airTime = o.airTime
    this.onIsland = o.onIsland
    this.steerInput = o.steerInput
    this.pathRate = o.pathRate
    this.driftDir = o.driftDir
    this.driftAmt = o.driftAmt
    this.driftRate = o.driftRate
    this.flickMem = o.flickMem
    this.steerAngle = o.steerAngle
    this.spinFront = o.spinFront
    this.spinRear = o.spinRear
    this.roll = o.roll
    this.rollVel = o.rollVel
    this.pitch = o.pitch
    this.pitchVel = o.pitchVel
    this.heave = o.heave
    this.heaveVel = o.heaveVel
    this.groundPitch = o.groundPitch
    this.groundRoll = o.groundRoll
    this.axF = o.axF
    this.ayF = o.ayF
    this.speed = o.speed
    this.forwardSpeed = o.forwardSpeed
    this.slipAngle = o.slipAngle
    this.wheelsOnGrass = o.wheelsOnGrass
    this.trackIdx = o.trackIdx
    this.trackS = o.trackS
    this.lateral = o.lateral
    this.landImpact = o.landImpact
    this.hitImpact = o.hitImpact
    this.wheelH.set(o.wheelH)
  }
}

/**
 * Push the car out of any obstacle it overlaps and bounce it off: the car is two circles on its
 * centreline, and each contact applies an impulse at the contact point (restitution plus friction), so
 * glancing and off-centre hits spin it. Arcade rigid body: unit mass, yaw inertia = radius of gyration².
 */
function collideObstacles(s: CarState, obstacles: Obstacle[]): void {
  const fx = Math.sin(s.heading)
  const fz = Math.cos(s.heading)
  const k2 = T.carGyration * T.carGyration
  for (let c = 0; c < 2; c++) {
    const off = c === 0 ? T.carCircleOffset : -T.carCircleOffset
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i]
      if (s.y > o.top - 0.2) continue // airborne over it
      const ccx = s.x + fx * off
      const ccz = s.z + fz * off
      if (!circleVsObstacle(ccx, ccz, T.carRadius, o)) continue
      const nx = contact.nx
      const nz = contact.nz
      s.x += nx * contact.depth
      s.z += nz * contact.depth
      // Lever arm from the car's centre to the contact point; spin about +y is -yawRate.
      const rx = contact.px - s.x
      const rz = contact.pz - s.z
      let wy = -s.yawRate
      const vcx = s.vx + wy * rz
      const vcz = s.vz - wy * rx
      const vn = vcx * nx + vcz * nz
      if (vn >= 0) continue
      const rn = rz * nx - rx * nz
      const jn = (-(1 + T.hitRestitution) * vn) / (1 + (rn * rn) / k2)
      // Friction along the surface, capped by the normal impulse.
      let tx = vcx - vn * nx
      let tz = vcz - vn * nz
      const vt = Math.hypot(tx, tz)
      let jt = 0
      if (vt > 1e-6) {
        tx /= vt
        tz /= vt
        const rt = rz * tx - rx * tz
        jt = -Math.min(vt / (1 + (rt * rt) / k2), T.hitFriction * jn)
        s.vx += tx * jt
        s.vz += tz * jt
        wy += (rt * jt) / k2
      }
      s.vx += nx * jn
      s.vz += nz * jn
      wy += (rn * jn) / k2
      s.yawRate = -wy
      s.hitImpact = Math.max(s.hitImpact, -vn)
      // Body knock: the hit's velocity change throws the body on its springs, like a sharp acceleration
      // (same signs as roll/pitch from acceleration), plus a jolt upward. It then settles on the springs.
      const dvx = nx * jn + tx * jt
      const dvz = nz * jn + tz * jt
      const dvF = dvx * fx + dvz * fz
      const dvL = dvx * -fz + dvz * fx
      const kickMax = T.knockMax
      s.pitchVel += clamp(-dvF * T.knockPitch, -kickMax, kickMax)
      s.rollVel += clamp(-dvL * T.knockRoll, -kickMax, kickMax)
      s.heaveVel += Math.min(Math.hypot(dvx, dvz) * T.knockHeave, kickMax)
      // A hard knock breaks a drift.
      if (-vn > 4) s.driftAmt *= 0.4
    }
  }
}

/** Put the car at rest on the centreline at sample `idx`, facing along the track. */
export function placeCar(s: CarState, track: Track, idx: number): void {
  const i = clamp(Math.round(idx), 0, track.n - 1)
  s.x = track.px[i]
  s.z = track.pz[i]
  s.heading = track.headingAt(i)
  s.vx = s.vz = s.yawRate = 0
  s.y = s.groundY = track.pe[i]
  s.vy = 0
  s.grounded = true
  s.airTime = 0
  s.onIsland = true
  s.steerAngle = s.steerInput = s.pathRate = 0
  s.driftDir = s.driftAmt = s.driftRate = s.flickMem = 0
  s.roll = s.rollVel = s.pitch = s.pitchVel = s.heave = s.heaveVel = 0
  s.groundPitch = s.groundRoll = 0
  s.axF = s.ayF = 0
  s.speed = s.forwardSpeed = s.slipAngle = 0
  s.wheelsOnGrass = 0
  s.trackIdx = i
  s.trackS = track.ps[i]
  s.lateral = 0
  s.landImpact = 0
  s.hitImpact = 0
  s.wheelH.fill(s.y)
}

// Per-step scratch (no allocation in the hot loop).
const centerQ = makeGroundSample()
const wheelQ = [makeGroundSample(), makeGroundSample(), makeGroundSample(), makeGroundSample()]
const wheelDrag = new Float64Array(4)

/**
 * Drift state machine. Returns true on the step a scandi flick fires.
 *  - Enter: handbrake + steer; a quick swing of the steering from one side to the other while the
 *    car is already yawing the first way (the scandi flick); or a natural slide on throttle.
 *  - Keep: throttle held with some steering into the corner. How much steering sets the line:
 *    a little = long sweeping drift, full lock = tight.
 *  - Leave: centre the steering (unwinds over ~1 s), lift off, or opposite lock (quickest).
 *  - Link: handbrake + steer the other way swaps a drift to the other side.
 */
function updateDrift(s: CarState, c: Controls, slideAngle: number, speed: number, dt: number): boolean {
  const raw = c.steer
  let flicked = false
  if (!s.grounded) {
    s.flickMem = moveTowards(s.flickMem, 0, (0.5 / T.flickWindow) * dt)
    return false
  }
  // Scandi flick: hard steer one way (the feint), then hard the other way within the window,
  // with the car already rotating the feint way.
  if (
    T.flick > 0 &&
    s.driftDir === 0 &&
    speed > T.flickMinSpeed &&
    Math.abs(raw) > 0.6 &&
    raw * s.flickMem < 0 &&
    Math.abs(s.flickMem) > 0.5 &&
    -Math.sign(raw) * s.yawRate > T.flickMinYaw
  ) {
    s.driftDir = Math.sign(raw)
    s.driftAmt = 0.55
    flicked = true
  }
  if (raw * s.flickMem >= 0 && Math.abs(raw) >= Math.abs(s.flickMem)) s.flickMem = raw
  else s.flickMem = moveTowards(s.flickMem, 0, (0.5 / T.flickWindow) * dt)

  if (speed > T.driftMinSpeed) {
    if (c.handbrake && Math.abs(raw) > 0.25) {
      const nd = Math.sign(raw)
      if (s.driftDir !== nd) {
        s.driftDir = nd
        s.driftAmt = Math.max(s.driftAmt, 0.35)
      }
    } else if (
      s.driftDir === 0 &&
      Math.abs(slideAngle) > T.driftEntryAngle &&
      c.throttle > 0.3 &&
      raw * slideAngle > 0 &&
      Math.abs(raw) > 0.5
    ) {
      s.driftDir = Math.sign(slideAngle)
      s.driftAmt = 0.3
    }
  }

  if (s.driftDir !== 0) {
    const u = raw * s.driftDir
    let rate: number
    if (speed < T.driftMinSpeed) rate = -3
    else if (c.handbrake) rate = T.driftEntryRate
    else if (u < -0.5) rate = -T.driftExitRate
    else if (c.throttle <= 0.3) rate = -T.driftLiftRate
    else if (u < T.driftKeepSteer && !flicked) rate = -T.driftCentreRate
    else rate = T.driftEntryRate
    s.driftAmt = clamp(s.driftAmt + rate * dt, 0, 1)
    if (s.driftAmt <= 0) {
      s.driftDir = 0
      s.flickMem = 0 // a drift ending is not a feint
    }
  }
  return flicked
}

/**
 * Handling model (arcade one-track model):
 *  - Steering sets the yaw rate the nose is asked to turn at (speed-sensitive turn radius).
 *    Front grip limits how much of that request the car can deliver and how quickly.
 *  - Rear grip limits how fast the velocity can follow the nose. When the nose turns faster
 *    than the rear can follow, the car slides. Handbrake cuts rear grip and adds rotation.
 *  - Drifting is a state (see updateDrift). While drifting, the nose is held at a slide angle,
 *    the engine drives along the direction of travel, and steering sets the line's curvature:
 *    a little steering into the corner = sweeping, full lock = tight. driftAssist blends this in.
 */
export function stepCar(s: CarState, c: Controls, track: Track, dt: number): void {
  const a = T.cgToFront
  const b = T.cgToRear
  const L = a + b
  const halfTw = T.trackWidth * 0.5

  let fx = Math.sin(s.heading)
  let fz = Math.cos(s.heading)
  let rx = -fz
  let rz = fx

  // ── Ground under the car and each wheel ─────────────────
  track.query(s.x, s.z, s.trackIdx, centerQ)
  s.trackIdx = centerQ.idx
  s.trackS = centerQ.s
  s.lateral = centerQ.lateral
  s.onIsland = centerQ.onIsland
  const groundC = centerQ.onIsland ? centerQ.height : -Infinity

  // Surface grip multipliers averaged per axle.
  let surfF = 0
  let surfR = 0
  let speedFactor = 0
  let grass = 0
  for (let w = 0; w < 4; w++) {
    const lon = w < 2 ? a : -b
    const lat = w & 1 ? halfTw : -halfTw
    const q = wheelQ[w]
    track.query(s.x + fx * lon + rx * lat, s.z + fz * lon + rz * lat, s.trackIdx, q)
    s.wheelH[w] = q.onIsland ? q.height : (centerQ.onIsland ? centerQ.height : s.y) - 1
    let grip = q.wTarmac * T.tarmacGrip + q.wGravel * T.gravelGrip + q.wGrass * T.grassGrip
    if (!q.onIsland) grip *= 0.2
    wheelDrag[w] = q.wTarmac * T.tarmacDrag + q.wGravel * T.gravelDrag + q.wGrass * T.grassDrag
    speedFactor += 0.25 * (q.wTarmac * T.tarmacSpeed + q.wGravel * T.gravelSpeed + q.wGrass * T.grassSpeed)
    if (q.wGrass > 0.5) grass++
    if (w < 2) surfF += grip * 0.5
    else surfR += grip * 0.5
  }
  s.wheelsOnGrass = grass

  // ── Vertical: follow the ground, or fly ─────────────────
  const vyBefore = s.vy
  const wasGrounded = s.grounded
  const groundVy = groundC > -Infinity && s.groundY > -Infinity ? (groundC - s.groundY) / dt : 0
  s.groundY = groundC
  s.vy -= T.gravity * dt
  s.y += s.vy * dt
  if (groundC > -Infinity && s.y <= groundC + (wasGrounded ? 0.02 : 0) && s.y > groundC - 1.0) {
    const impact = groundVy - vyBefore
    if (impact > 0.05) {
      s.heaveVel -= impact * T.landingSquash
      if (!wasGrounded && s.airTime > 0.08) s.landImpact = Math.max(s.landImpact, impact)
    }
    s.y = groundC
    s.vy = groundVy
    s.grounded = true
    s.airTime = 0
  } else {
    s.grounded = false
    s.airTime += dt
  }

  // ── Steering input (rate limited so keys and touch feel the same) ──
  {
    const target = c.steer
    const returning = Math.abs(target) < Math.abs(s.steerInput) || target * s.steerInput < 0
    s.steerInput = moveTowards(s.steerInput, target, (returning ? T.steerReturnRate : T.steerRate) * dt)
  }

  let vF = s.vx * fx + s.vz * fz
  let vL = s.vx * rx + s.vz * rz
  const absVF = Math.abs(vF)
  const speed0 = Math.hypot(s.vx, s.vz)
  // Slide angle: positive = nose is right of the direction of travel (a right-hand drift).
  const slideAngle = speed0 > 1 ? -Math.atan2(vL, Math.max(absVF, 1)) : 0
  const dirSign = vF >= 0 ? 1 : -1
  // 0 while gripping, 1 when properly sideways. Kept well above normal cornering slip so turn-in never snaps.
  const slide = smoothstep(T.slipPeak, T.slipPeak * 2.5, Math.abs(slideAngle)) * smoothstep(3, 8, speed0)
  const vx0 = s.vx
  const vz0 = s.vz

  // ── Drift state: entered by handbrake, a scandi flick, or a natural slide; kept alive by throttle ──
  const flicked = updateDrift(s, c, slideAngle, speed0, dt)
  const d = s.driftDir
  const k = s.grounded ? clamp(s.driftAmt * T.driftAssist, 0, 1) : 0
  // Steering relative to the drift: +1 = into the corner, -1 = away from it.
  const u = d !== 0 ? clamp(s.steerInput * d, -1, 1) : 0

  if (s.grounded) {
    // ── Longitudinal ──────────────────────────────────────
    let accF = 0
    let accEngine = 0
    if (c.throttle > 0) {
      const vmax = T.topSpeed * speedFactor
      const kv = vF > 0 ? speed0 / vmax : 0
      accEngine = (c.throttle * T.engineForce * Math.max(0, 1 - kv * kv)) / T.mass
      accF += accEngine
    }
    // Off-throttle: smooth engine braking that fades to nothing at standstill.
    if (c.throttle < 0.05) accF -= dirSign * Math.min(T.autoBrake, absVF * 1.5)
    if (c.handbrake) accF -= dirSign * Math.min(T.handbrakeBrake, absVF * 2)
    // Footbrake: strong, scaled by surface grip (less bite on gravel/grass), eases off at a stop.
    if (c.brake > 0) {
      const bite = 0.35 + 0.65 * Math.min(1, (surfF + surfR) * 0.5)
      accF -= dirSign * Math.min(c.brake * T.brakeDecel * bite, absVF * 6)
    }
    let dragSum = 0
    let tug = 0
    for (let w = 0; w < 4; w++) {
      dragSum += wheelDrag[w] * 0.25
      // Wheels on draggy surfaces on one side tug the nose that way.
      tug += (w & 1 ? 1 : -1) * wheelDrag[w]
    }
    accF -= dragSum * vF
    const slope = ((s.wheelH[0] + s.wheelH[1] - s.wheelH[2] - s.wheelH[3]) * 0.5) / L
    accF -= G * clamp(slope, -0.6, 0.6)

    // ── Grip model: rear grip pulls the velocity in line with the nose ──
    let latGrip = T.gripRear * surfR * G
    if (c.handbrake) latGrip *= T.handbrakeGrip
    // Once sliding, grip drops (slides keep sliding); throttle eats more of it.
    latGrip *= 1 - (1 - T.slideGrip) * slide
    latGrip *= 1 - T.throttleRearSlip * c.throttle * slide
    const accL = clamp(-vL * T.latStiffness, -latGrip, latGrip)
    const g = 1 - k
    s.vx += (fx * accF + rx * accL) * g * dt
    s.vz += (fz * accF + rz * accL) * g * dt

    // ── Drift model: the engine drives along the direction of travel and steering sets the line ──
    if (k > 0 && speed0 > 1) {
      const ux = s.vx / speed0
      const uz = s.vz / speed0
      // Four-wheel drive: the front wheels pull along the nose, so throttle drags the car round the
      // corner and out of the slide (a four-wheel drift) instead of only pushing it along the slide.
      const pull = accEngine * T.awdPull
      const accV = accF - pull - T.driftScrub * Math.abs(Math.sin(slideAngle))
      s.vx += (ux * accV + fx * pull) * k * dt
      s.vz += (uz * accV + fz * pull) * k * dt
      let tr = T.driftTurn * clamp(u, 0, 1)
      if (c.handbrake) tr += T.driftHandbrakeTurn
      tr *= 1 - T.driftThrottleWiden * c.throttle
      tr *= 0.6 + 0.4 * Math.min(1, surfR)
      tr = Math.min(tr, (T.driftMaxG * G) / speed0)
      s.driftRate += (tr * d - s.driftRate) * (1 - Math.exp(-T.driftLineResponse * dt))
      const turn = s.driftRate * k * dt // + = rotate velocity right (decreasing atan2(x, z))
      const cs = Math.cos(turn)
      const sn = Math.sin(turn)
      const nvx = s.vx * cs - s.vz * sn
      const nvz = s.vx * sn + s.vz * cs
      s.vx = nvx
      s.vz = nvz
    }

    // How fast the direction of travel is turning (right-positive).
    const sp2 = s.vx * s.vx + s.vz * s.vz
    s.pathRate = sp2 > 1 ? (vx0 * s.vz - vz0 * s.vx) / (sp2 * dt) : 0
    if (k === 0) s.driftRate = s.pathRate

    // ── Yaw ───────────────────────────────────────────────
    const frontAuth = clamp(T.gripFront * surfF, 0.15, 1)
    const sr = Math.min(1, absVF / T.steerSpeedRef)
    const R = T.turnRadiusLow + (T.turnRadiusHigh - T.turnRadiusLow) * sr * sr
    let yawGrip = ((s.steerInput * absVF) / R) * frontAuth * dirSign
    // Don't ask the nose to turn tighter than the rear can follow on grippy surfaces (that slides and
    // runs wide = understeer). Loose surfaces get more headroom so they still step out into drifts.
    if (absVF > 1) {
      const margin = T.gripRotateCap + T.looseRotate * Math.max(0, 1 - surfR)
      const cap = (margin * T.gripRear * surfR * G) / absVF
      yawGrip = clamp(yawGrip, -cap, cap)
    }
    // Weight on the nose (lift-off or braking) helps the car rotate into a corner.
    yawGrip *= 1 + T.liftTurnIn * Math.max(c.brake, 0.5 * (1 - c.throttle))
    if (c.handbrake) yawGrip *= T.handbrakeYaw
    // Outside a drift, a slide straightens itself: the nose eases back toward the direction of travel.
    // Strong off-throttle; weaker on throttle so a loose car can still slide into a drift.
    if (!c.handbrake) {
      const recover = slide * (1 - T.slideRecoverThrottle * c.throttle)
      yawGrip += (s.pathRate - slideAngle * T.slideRecover - yawGrip) * recover
    }
    // In a drift the nose is held at a slide angle: bigger with more steering into the corner, and with throttle.
    const want = d * Math.max(0.05, T.driftAngle + T.driftAngleSteer * u + T.driftAngleThrottle * c.throttle)
    const yawDrift = s.pathRate + (want - slideAngle) * T.driftHold
    let yawTarget = yawGrip + (yawDrift - yawGrip) * k
    if (Math.abs(slideAngle) > T.maxSlip) {
      yawTarget = s.pathRate - Math.sign(slideAngle) * (Math.abs(slideAngle) - T.maxSlip) * 8
    }
    s.yawRate += (yawTarget - s.yawRate) * (1 - Math.exp(-T.yawResponse * Math.max(frontAuth, k) * dt))
    if (flicked) s.yawRate += d * T.flick
    s.yawRate += tug * T.grassTug * vF * dt
  } else {
    s.pathRate = 0
    s.yawRate += s.steerInput * T.airSteer * dt
    s.yawRate /= 1 + 0.5 * dt
  }

  // Air drag.
  {
    const sp = Math.hypot(s.vx, s.vz)
    const k = Math.min(1, ((T.airDrag * sp) / T.mass) * dt)
    s.vx -= s.vx * k
    s.vz -= s.vz * k
  }

  // Body-frame acceleration this step (drives the visual roll and pitch).
  const ax = ((s.vx - vx0) * fx + (s.vz - vz0) * fz) / dt
  const ay = ((s.vx - vx0) * rx + (s.vz - vz0) * rz) / dt

  // ── Integrate ──────────────────────────────────────────
  s.heading = wrapAngle(s.heading - s.yawRate * dt)
  s.x += s.vx * dt
  s.z += s.vz * dt
  if (track.obstacles.length) collideObstacles(s, track.obstacles)

  fx = Math.sin(s.heading)
  fz = Math.cos(s.heading)
  rx = -fz
  rz = fx
  vF = s.vx * fx + s.vz * fz
  vL = s.vx * rx + s.vz * rz
  const speed = Math.hypot(s.vx, s.vz)
  const beta = speed > 1 ? Math.atan2(vL, Math.max(Math.abs(vF), 1)) : 0
  s.speed = speed
  s.forwardSpeed = vF
  s.slipAngle = beta

  // Visual front wheel angle: steering, swinging toward the direction of travel (counter-steer) in a slide.
  {
    const maxVis = T.steerVisual * (1 - 0.6 * Math.min(1, absVF / T.steerSpeedRef))
    const steerVis = s.steerInput * maxVis
    s.steerAngle = steerVis + (clamp(beta, -0.6, 0.6) - steerVis) * Math.max(slide, k) * T.counterSteerVisual
  }

  // ── Wheels spin ────────────────────────────────────────
  const spin = (vF / T.wheelRadius) * dt
  s.spinFront = (s.spinFront + spin) % (Math.PI * 2)
  if (!(c.handbrake && s.grounded)) s.spinRear = (s.spinRear + spin) % (Math.PI * 2)

  // ── Visual suspension springs ──────────────────────────
  const fa = Math.min(1, 10 * dt)
  s.axF += (ax - s.axF) * fa
  s.ayF += (ay - s.ayF) * fa
  const slipRoll = s.grounded ? clamp(beta, -0.8, 0.8) * T.rollPerSlip * Math.max(slide, k) : 0
  const rollTarget = clamp((-s.ayF / G) * T.rollPerG + slipRoll, -T.maxRoll, T.maxRoll)
  s.rollVel += (T.rollStiffness * (rollTarget - s.roll) - T.rollDamping * s.rollVel) * dt
  s.roll += s.rollVel * dt
  const pitchTarget = clamp((-s.axF / G) * T.pitchPerG, -T.maxPitch, T.maxPitch)
  s.pitchVel += (T.pitchStiffness * (pitchTarget - s.pitch) - T.pitchDamping * s.pitchVel) * dt
  s.pitch += s.pitchVel * dt
  s.heaveVel += (-T.heaveStiffness * s.heave - T.heaveDamping * s.heaveVel) * dt
  s.heave += s.heaveVel * dt
  if (s.heave < -T.suspTravel) {
    s.heave = -T.suspTravel
    if (s.heaveVel < 0) s.heaveVel = 0
  } else if (s.heave > T.suspTravel) {
    s.heave = T.suspTravel
    if (s.heaveVel > 0) s.heaveVel = 0
  }

  // Chassis follows the ground plane under the wheels; in the air it eases toward the trajectory.
  if (s.grounded) {
    const h = s.wheelH
    const gp = Math.atan2((h[2] + h[3] - h[0] - h[1]) * 0.5, L)
    const gr = Math.atan2((h[0] + h[2] - h[1] - h[3]) * 0.5, T.trackWidth)
    const k = Math.min(1, 25 * dt)
    s.groundPitch += (gp - s.groundPitch) * k
    s.groundRoll += (gr - s.groundRoll) * k
  } else {
    const k = Math.min(1, 3 * dt)
    const gp = -Math.atan2(s.vy, Math.max(speed, 1)) * 0.5
    s.groundPitch += (gp - s.groundPitch) * k
    s.groundRoll += (0 - s.groundRoll) * k
  }
}
