import { describe, expect, it } from 'vitest'
import greybox from '../src/tracks/greybox.json'
import { makeGroundSample, Track, type TrackData } from '../src/sim/track'
import { CarState, placeCar, SIM_DT, stepCar, type Controls } from '../src/sim/vehicle'
import { tuning } from '../src/tuning'

function straight(surface: 'tarmac' | 'gravel' | 'grass', extra: Partial<TrackData> = {}): Track {
  return new Track({
    name: 'straight',
    width: 10,
    verge: 1.5,
    island: 18,
    closed: false,
    points: [
      { x: 0, z: 0, e: 0, surface },
      { x: 0, z: 400, e: 0 },
      { x: 0, z: 800, e: 0 },
      { x: 0, z: 1200, e: 0 },
    ],
    ...extra,
  })
}

function run(track: Track, s: CarState, c: Controls, seconds: number, each?: (s: CarState) => void): void {
  const steps = Math.round(seconds / SIM_DT)
  for (let i = 0; i < steps; i++) {
    stepCar(s, c, track, SIM_DT)
    each?.(s)
  }
}

const go: Controls = { throttle: 1, steer: 0, handbrake: false }
const coast: Controls = { throttle: 0, steer: 0, handbrake: false }

describe('track', () => {
  it('builds the grey-box loop and answers ground queries', () => {
    const t = new Track(greybox as TrackData)
    expect(t.length).toBeGreaterThan(900)
    expect(t.length).toBeLessThan(2000)
    const q = makeGroundSample()
    t.query(t.px[100], t.pz[100], -1, q)
    expect(Math.abs(q.lateral)).toBeLessThan(0.01)
    expect(q.onIsland).toBe(true)
    // 30 m to the side is off the island
    t.query(t.px[100] - t.tz[100] * 30, t.pz[100] + t.tx[100] * 30, q.idx, q)
    expect(q.onIsland).toBe(false)
  })
})

describe('vehicle', () => {
  it('accelerates briskly and respects top speed', () => {
    const t = straight('tarmac')
    const s = new CarState()
    placeCar(s, t, 2)
    run(t, s, go, 4)
    expect(s.speed).toBeGreaterThan(20)
    run(t, s, go, 20)
    expect(s.speed).toBeLessThan(tuning.topSpeed)
    expect(s.speed).toBeGreaterThan(tuning.topSpeed * 0.85)
  })

  it('gravel has a lower top speed than tarmac', () => {
    const a = new CarState()
    const b = new CarState()
    const ta = straight('tarmac')
    const tb = straight('gravel')
    placeCar(a, ta, 2)
    placeCar(b, tb, 2)
    run(ta, a, go, 25)
    run(tb, b, go, 25)
    expect(b.speed).toBeLessThan(a.speed * 0.92)
  })

  it('auto-brakes smoothly when throttle is released', () => {
    const t = straight('tarmac')
    const s = new CarState()
    placeCar(s, t, 2)
    run(t, s, go, 6)
    const v0 = s.speed
    run(t, s, coast, 2)
    expect(s.speed).toBeLessThan(v0 - 5)
    expect(s.speed).toBeGreaterThan(v0 - 15)
  })

  it('handbrake + steer starts a drift that is recoverable', () => {
    // Wide road so the car stays on tarmac while sliding.
    const t = straight('tarmac', { width: 80, island: 100 })
    const s = new CarState()
    placeCar(s, t, 2)
    run(t, s, go, 5)
    let maxSlip = 0
    run(t, s, { throttle: 1, steer: 1, handbrake: true }, 0.5, (st) => (maxSlip = Math.max(maxSlip, Math.abs(st.slipAngle))))
    expect(maxSlip).toBeGreaterThan(0.25)
    run(t, s, { throttle: 0.5, steer: 0, handbrake: false }, 2.5)
    expect(Math.abs(s.slipAngle)).toBeLessThan(0.1)
    expect(s.speed).toBeGreaterThan(8)
  })

  it('is deterministic', () => {
    const t = straight('gravel')
    const a = new CarState()
    const b = new CarState()
    placeCar(a, t, 2)
    placeCar(b, t, 2)
    const script = (i: number): Controls => ({ throttle: 1, steer: Math.sin(i * 0.01), handbrake: i % 300 < 40 })
    for (let i = 0; i < 1200; i++) {
      stepCar(a, script(i), t, SIM_DT)
      stepCar(b, script(i), t, SIM_DT)
    }
    expect(a.x).toBe(b.x)
    expect(a.z).toBe(b.z)
    expect(a.heading).toBe(b.heading)
  })

  it('launches off a kicker and lands', () => {
    const t = new Track({
      name: 'kicker',
      width: 10,
      verge: 1.5,
      island: 18,
      closed: false,
      points: [
        { x: 0, z: 0, e: 0, surface: 'tarmac' },
        { x: 0, z: 150, e: 0 },
        { x: 0, z: 162, e: 1.8 },
        { x: 0, z: 166, e: 0 },
        { x: 0, z: 400, e: 0 },
      ],
    })
    const s = new CarState()
    placeCar(s, t, 2)
    let maxAir = 0
    let impact = 0
    run(t, s, go, 10, (st) => {
      maxAir = Math.max(maxAir, st.airTime)
      impact = Math.max(impact, st.landImpact)
    })
    expect(maxAir).toBeGreaterThan(0.3)
    expect(impact).toBeGreaterThan(1)
    expect(s.grounded).toBe(true)
  })

  it('falls when it leaves the island', () => {
    const t = straight('tarmac')
    const s = new CarState()
    placeCar(s, t, 20)
    s.heading = Math.PI / 2 // face sideways (+x)
    run(t, s, go, 3)
    expect(s.onIsland).toBe(false)
    expect(s.y).toBeLessThan(-1)
  })
})
