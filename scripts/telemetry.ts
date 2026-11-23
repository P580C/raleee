/**
 * Headless sanity run: a crude autopilot drives the grey-box loop and prints
 * lap time, slides, jumps and resets. Run with: npx vite-node scripts/telemetry.ts
 */
import greybox from '../src/tracks/greybox.json'
import { wrapAngle } from '../src/sim/math'
import { Track, type TrackData } from '../src/sim/track'
import { CarState, placeCar, SIM_DT, stepCar, type Controls } from '../src/sim/vehicle'

const track = new Track(greybox as TrackData)
const s = new CarState()
placeCar(s, track, track.startIdx)
const c: Controls = { throttle: 1, steer: 0, handbrake: false }

console.log(`track length ${track.length.toFixed(0)} m, ${track.n} samples`)
let lastS = s.trackS
let dist = 0
let t = 0
let maxSlip = 0
let maxAir = 0
let offIsland = 0
let lapStart = 0
let laps = 0
let grassTime = 0
const log: string[] = []
while (t < 180 && laps < 2) {
  const look = Math.round(8 + s.speed * 0.6)
  const i = (s.trackIdx + look) % track.n
  const want = Math.atan2(track.px[i] - s.x, track.pz[i] - s.z)
  const err = wrapAngle(s.heading - want) // positive = target is to the right
  c.steer = Math.max(-1, Math.min(1, err * 2.5 + s.slipAngle * 0.8))
  c.handbrake = Math.abs(err) > 0.5 && s.speed > 18
  c.throttle = Math.abs(err) > 0.35 && s.speed > 24 ? 0 : 1
  stepCar(s, c, track, SIM_DT)
  t += SIM_DT
  let ds = s.trackS - lastS
  if (ds < -track.length / 2) ds += track.length
  if (ds > track.length / 2) ds -= track.length
  dist += ds
  lastS = s.trackS
  maxSlip = Math.max(maxSlip, Math.abs(s.slipAngle))
  maxAir = Math.max(maxAir, s.airTime)
  if (s.wheelsOnGrass >= 2) grassTime += SIM_DT
  if (s.landImpact > 0) {
    log.push(`  t=${t.toFixed(2)} landed, impact ${s.landImpact.toFixed(1)} m/s`)
    s.landImpact = 0
  }
  if (!s.onIsland) {
    offIsland++
    log.push(`  t=${t.toFixed(2)} OFF ISLAND at s=${s.trackS.toFixed(0)} — reset`)
    const idx = s.trackIdx
    placeCar(s, track, idx)
  }
  if (dist >= track.length * (laps + 1)) {
    laps++
    console.log(`lap ${laps}: ${(t - lapStart).toFixed(2)} s`)
    lapStart = t
  }
  if (Math.round(t / SIM_DT) % 240 === 0) {
    log.push(
      `  t=${t.toFixed(1)} s=${s.trackS.toFixed(0)} v=${(s.speed * 3.6).toFixed(0)}km/h slip=${s.slipAngle.toFixed(2)} lat=${s.lateral.toFixed(1)} y=${s.y.toFixed(2)}`,
    )
  }
}
console.log(log.join('\n'))
console.log(`laps ${laps}, maxSlip ${maxSlip.toFixed(2)} rad, maxAir ${maxAir.toFixed(2)} s, resets ${offIsland}, grass ${grassTime.toFixed(1)} s`)
