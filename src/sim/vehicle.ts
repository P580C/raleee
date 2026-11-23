/**
 * Arcade rally car: 2D bicycle model for the main dynamics, plus a 1D vertical
 * model for jumps and damped springs for the visual body motion.
 *
 * Pure and deterministic: no three.js, no Date/random, no allocation per step.
 *
 * Conventions (world): y is up, the car's forward is (sin h, cos h) in (x, z),
 * its right is (-cos h, sin h). Positive yawRate = turning right, which
 * DEcreases heading. Positive steer = right. Positive slip angle (β) = the car
 * is moving to the right of where its nose points.
 */
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
    this.wheelH.set(o.wheelH)
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
  s.steerAngle = 0
  s.roll = s.rollVel = s.pitch = s.pitchVel = s.heave = s.heaveVel = 0
  s.groundPitch = s.groundRoll = 0
  s.axF = s.ayF = 0
  s.speed = s.forwardSpeed = s.slipAngle = 0
  s.wheelsOnGrass = 0
  s.trackIdx = i
  s.trackS = track.ps[i]
  s.lateral = 0
  s.landImpact = 0
  s.wheelH.fill(s.y)
}

/** Tyre force shape: rises to 1 at x=1 (peak), then sags to slideGrip by x=3. Odd-symmetric. */
function tyreCurve(alpha: number, peak: number): number {
  const x = Math.abs(alpha) / peak
  const f = x < 1 ? x * (2 - x) : 1 - (1 - T.slideGrip) * smoothstep(1, 3, x)
  return alpha < 0 ? -f : f
}

// Per-step scratch (no allocation in the hot loop).
const centerQ = makeGroundSample()
const wheelQ = [makeGroundSample(), makeGroundSample(), makeGroundSample(), makeGroundSample()]
const wheelDrag = new Float64Array(4)

export function stepCar(s: CarState, c: Controls, track: Track, dt: number): void {
  const m = T.mass
  const a = T.cgToFront
  const b = T.cgToRear
  const L = a + b
  const halfTw = T.trackWidth * 0.5
  const I = m * T.inertiaRadius * T.inertiaRadius

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

  let gripF = 0
  let gripR = 0
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
    if (w < 2) gripF += grip * 0.5
    else gripR += grip * 0.5
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

  // ── Steering ────────────────────────────────────────────
  let vF = s.vx * fx + s.vz * fz
  let vL = s.vx * rx + s.vz * rz
  const absVF = Math.abs(vF)
  {
    const beta = Math.atan2(vL, Math.max(absVF, 0.5))
    let maxSteer = T.steerLow + (T.steerHigh - T.steerLow) * Math.min(1, absVF / T.steerSpeedRef)
    // Counter-steering (steering the same way the car is sliding) gets extra lock.
    if (c.steer * beta > 0) maxSteer += Math.min(Math.abs(beta), 0.6) * T.counterSteerBonus
    // Caster self-alignment: with the wheel relaxed, the fronts swing toward the direction of travel.
    const relaxed = 1 - Math.min(1, Math.abs(c.steer))
    const target = c.steer * maxSteer + relaxed * clamp(beta, -0.6, 0.6) * T.selfAlign
    const returning = Math.abs(target) < Math.abs(s.steerAngle) || target * s.steerAngle < 0
    s.steerAngle = moveTowards(s.steerAngle, target, (returning ? T.steerReturnRate : T.steerRate) * dt)
  }

  // ── Tyre and drive forces (ground only) ─────────────────
  let ax = 0
  let ay = 0
  // World-frame acceleration from tyres this step (for the drift assist).
  let awx = 0
  let awz = 0
  if (s.grounded) {
    const delta = s.steerAngle
    const cosD = Math.cos(delta)
    const sinD = Math.sin(delta)
    const den = Math.max(absVF, T.lowSpeedFloor)
    const r = s.yawRate
    const dirSign = vF >= 0 ? 1 : -1
    // Fade steering's slip contribution in from walking pace, so a parked car doesn't twitch.
    const steerEff = delta * dirSign * Math.min(1, absVF / 3)
    const alphaF = Math.atan2(vL + r * a, den) - steerEff
    const alphaR = Math.atan2(vL - r * b, den)

    // Loads with longitudinal weight transfer (lift-off = lighter rear = more rotation).
    const Nf0 = (m * G * b) / L
    const Nr0 = (m * G * a) / L
    const dN = (T.weightTransfer * m * s.axF * T.cgHeight) / L
    const Nf = Math.max(Nf0 - dN, 0.3 * Nf0)
    const Nr = Math.max(Nr0 + dN, 0.3 * Nr0)

    const muF = T.gripFront * gripF * Nf
    let muR = T.gripRear * gripR * Nr
    if (c.handbrake) muR *= T.handbrakeGrip

    let drive = 0
    if (c.throttle > 0) {
      const vmax = T.topSpeed * speedFactor
      const k = vF > 0 ? vF / vmax : 0
      drive = c.throttle * T.engineForce * Math.max(0, 1 - k * k)
    }
    const dF = Math.min(drive * (1 - T.driveRearBias), muF * 0.9)
    const dR = Math.min(drive * T.driveRearBias, muR * 0.9)

    // Friction circle: drive force uses up lateral grip.
    const latF = Math.sqrt(Math.max(muF * muF - dF * dF, 0.09 * muF * muF))
    const usedR = dR * T.throttleRearSlip
    const latR = Math.sqrt(Math.max(muR * muR - usedR * usedR, 0.0625 * muR * muR))
    const Fyf = -latF * tyreCurve(alphaF, T.slipPeakFront)
    const Fyr = -latR * tyreCurve(alphaR, T.slipPeakRear)

    let Fx = dF * cosD - Fyf * sinD + dR
    const Fy = dF * sinD + Fyf * cosD + Fyr
    let torque = a * (dF * sinD + Fyf * cosD) - b * Fyr

    // Off-throttle: smooth engine braking that fades to nothing at standstill.
    if (c.throttle < 0.05) Fx -= dirSign * m * Math.min(T.autoBrake, absVF * 1.5)
    if (c.handbrake) Fx -= dirSign * m * Math.min(T.handbrakeBrake, absVF * 2)

    // Per-wheel surface drag: two wheels on grass tug the car sideways.
    for (let w = 0; w < 4; w++) {
      const lat = w & 1 ? halfTw : -halfTw
      const fd = -wheelDrag[w] * m * 0.25 * vF
      Fx += fd
      torque -= lat * fd
    }

    // Slopes.
    const slope = (s.wheelH[0] + s.wheelH[1] - s.wheelH[2] - s.wheelH[3]) * 0.5 / L
    Fx -= m * G * clamp(slope, -0.6, 0.6)

    ax = Fx / m
    ay = Fy / m
    awx = (fx * Fx + rx * Fy) / m
    awz = (fz * Fx + rz * Fy) / m
    s.vx += awx * dt
    s.vz += awz * dt
    s.yawRate += (torque / I) * dt
    s.yawRate /= 1 + T.yawDamping * dt
  } else {
    s.yawRate += c.steer * T.airSteer * dt
    s.yawRate /= 1 + 0.5 * dt
  }

  // Air drag.
  {
    const sp = Math.hypot(s.vx, s.vz)
    const k = Math.min(1, ((T.airDrag * sp) / m) * dt)
    s.vx -= s.vx * k
    s.vz -= s.vz * k
  }

  // ── Integrate ──────────────────────────────────────────
  s.heading = wrapAngle(s.heading - s.yawRate * dt)
  s.x += s.vx * dt
  s.z += s.vz * dt

  // ── Drift assist ───────────────────────────────────────
  fx = Math.sin(s.heading)
  fz = Math.cos(s.heading)
  rx = -fz
  rz = fx
  vF = s.vx * fx + s.vz * fz
  vL = s.vx * rx + s.vz * rz
  const speed = Math.hypot(s.vx, s.vz)
  let beta = speed > 0.5 ? Math.atan2(vL, vF) : 0
  if (s.grounded && speed > 4) {
    const fade = smoothstep(4, 10, speed)
    // Handbrake means "I want to slide": the assist engages fully so the car rotates in promptly.
    const slide = Math.max(smoothstep(0.03, 0.15, Math.abs(beta)), c.handbrake ? 1 : 0) * fade
    if (slide > 0) {
      // Drive yaw rate toward: (how fast the path is turning) + (correction toward the slide angle
      // the steering asks for). Right steer = nose right of travel. Neutral steer = straighten up.
      const target = -c.steer * T.driftAngle
      const pathYaw = (awx * -s.vz + awz * s.vx) / (speed * speed) // right-positive turn rate of velocity
      const yawTarget = pathYaw + (beta - target) * 3
      s.yawRate += (yawTarget - s.yawRate) * Math.min(1, T.driftAssist * 8 * slide * dt)
      // Swing the velocity toward the nose without bleeding speed: carries the drift round the corner.
      const carry = Math.min(Math.abs(beta), T.driftCarry * slide * dt) * Math.sign(beta)
      const cs = Math.cos(carry)
      const sn = Math.sin(carry)
      const nvx = s.vx * cs + s.vz * sn
      const nvz = -s.vx * sn + s.vz * cs
      s.vx = nvx
      s.vz = nvz
    }
    // Spin protection: always recoverable.
    if (Math.abs(beta) > T.maxSlip) {
      const excess = beta - Math.sign(beta) * T.maxSlip
      s.heading = wrapAngle(s.heading - excess * 12 * dt)
      s.yawRate *= Math.max(0, 1 - 6 * dt)
    }
    fx = Math.sin(s.heading)
    fz = Math.cos(s.heading)
    vF = s.vx * fx + s.vz * fz
    vL = s.vx * -fz + s.vz * fx
    beta = Math.atan2(vL, vF)
  }
  s.speed = speed
  s.forwardSpeed = vF
  s.slipAngle = beta

  // ── Wheels spin ────────────────────────────────────────
  const spin = (vF / T.wheelRadius) * dt
  s.spinFront = (s.spinFront + spin) % (Math.PI * 2)
  if (!(c.handbrake && s.grounded)) s.spinRear = (s.spinRear + spin) % (Math.PI * 2)

  // ── Visual suspension springs ──────────────────────────
  const fa = Math.min(1, 10 * dt)
  s.axF += (ax - s.axF) * fa
  s.ayF += (ay - s.ayF) * fa
  const rollTarget = clamp((-s.ayF / G) * T.rollPerG, -0.3, 0.3)
  s.rollVel += (T.rollStiffness * (rollTarget - s.roll) - T.rollDamping * s.rollVel) * dt
  s.roll += s.rollVel * dt
  const pitchTarget = clamp((-s.axF / G) * T.pitchPerG, -0.25, 0.25)
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
