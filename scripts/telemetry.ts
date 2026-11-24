/**
 * Headless sanity run: a crude autopilot drives the grey-box stage from start to finish
 * and prints stage time, slides, jumps and resets. Run with: npx vite-node scripts/telemetry.ts
 */
import stage from '../src/tracks/stage1.json'
import { wrapAngle } from '../src/sim/math'
import { Track, type TrackData } from '../src/sim/track'
import { CarState, placeCar, SIM_DT, stepCar, type Controls } from '../src/sim/vehicle'

const track = new Track(stage as TrackData)
const s = new CarState()
placeCar(s, track, track.startIdx)
const c: Controls = { throttle: 1, steer: 0, handbrake: false, brake: 0 }

console.log(`track length ${track.length.toFixed(0)} m, stage ${(track.finishS - track.ps[track.startIdx]).toFixed(0)} m, ${track.n} samples`)
let t = 0
let maxSlip = 0
let maxAir = 0
let maxRoll = 0
let offIsland = 0
let grassTime = 0
let slideTime = 0
let finished = false
const log: string[] = []
while (t < 180) {
  const look = Math.round(10 + s.speed * 0.7)
  const i = Math.min(track.n - 1, s.trackIdx + look)
  const want = Math.atan2(track.px[i] - s.x, track.pz[i] - s.z)
  // Aim by the direction of travel, not the nose (in a drift the nose points inside the corner).
  const travel = s.speed > 3 ? Math.atan2(s.vx, s.vz) : s.heading
  const err = wrapAngle(travel - want) // positive = target is to the right
  // Plan a corner speed from how much the road turns over the next stretch.
  const j = Math.min(track.n - 1, s.trackIdx + 70)
  const bend = Math.abs(wrapAngle(track.headingAt(j) - track.headingAt(s.trackIdx)))
  const target = bend > 0.15 ? Math.max(18, Math.sqrt((18 * 70) / bend)) : 99
  c.steer = Math.max(-1, Math.min(1, err * (s.driftDir !== 0 ? 6 : 4)))
  c.handbrake = Math.abs(err) > 0.45 && s.speed > 18 && s.driftDir === 0
  c.throttle = s.speed > target + 2 || (Math.abs(err) > 0.35 && s.speed > 24) ? 0 : 1
  stepCar(s, c, track, SIM_DT)
  t += SIM_DT
  maxSlip = Math.max(maxSlip, Math.abs(s.slipAngle))
  maxAir = Math.max(maxAir, s.airTime)
  maxRoll = Math.max(maxRoll, Math.abs(s.roll))
  if (Math.abs(s.slipAngle) > 0.2) slideTime += SIM_DT
  if (s.wheelsOnGrass >= 2) grassTime += SIM_DT
  if (s.landImpact > 0) {
    log.push(`  t=${t.toFixed(2)} landed, impact ${s.landImpact.toFixed(1)} m/s`)
    s.landImpact = 0
  }
  if (!s.onIsland) {
    offIsland++
    log.push(`  t=${t.toFixed(2)} OFF ISLAND at s=${s.trackS.toFixed(0)} — reset`)
    placeCar(s, track, Math.max(0, s.trackIdx - 4))
  }
  if (s.trackS >= track.finishS) {
    finished = true
    break
  }
  if (Math.round(t / SIM_DT) % 240 === 0) {
    log.push(
      `  t=${t.toFixed(1)} s=${s.trackS.toFixed(0)} v=${(s.speed * 3.6).toFixed(0)}km/h slip=${s.slipAngle.toFixed(2)} roll=${s.roll.toFixed(2)} lat=${s.lateral.toFixed(1)} y=${s.y.toFixed(2)}`,
    )
  }
}
console.log(log.join('\n'))
console.log(finished ? `FINISHED in ${t.toFixed(2)} s` : `did not finish (t=${t.toFixed(0)} s, s=${s.trackS.toFixed(0)})`)
console.log(
  `maxSlip ${maxSlip.toFixed(2)} rad, sliding ${slideTime.toFixed(1)} s, maxRoll ${maxRoll.toFixed(2)} rad, maxAir ${maxAir.toFixed(2)} s, resets ${offIsland}, grass ${grassTime.toFixed(1)} s`,
)
