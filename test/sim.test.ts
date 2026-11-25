import { describe, expect, it } from 'vitest'
import stage1 from '../src/tracks/stage1.json'
import { convexHull, makeObstacle } from '../src/sim/obstacles'
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

const go: Controls = { throttle: 1, steer: 0, handbrake: false, brake: 0 }
const coast: Controls = { throttle: 0, steer: 0, handbrake: false, brake: 0 }

describe('track', () => {
  it('builds the grey-box stage and answers ground queries', () => {
    const t = new Track(stage1 as TrackData)
    expect(t.closed).toBe(false)
    expect(t.length).toBeGreaterThan(1200)
    expect(t.length).toBeLessThan(2500)
    expect(t.finishS).toBeGreaterThan(t.ps[t.startIdx] + 1000)
    expect(t.finishS).toBeLessThan(t.length - 100)
    // The stage runs up the screen: screen-up on the ground is world (-x, -z).
    const up = (i: number) => -(t.px[i] + t.pz[i])
    expect(up(t.finishIdx)).toBeGreaterThan(up(t.startIdx) + 1000)
    const q = makeGroundSample()
    t.query(t.px[100], t.pz[100], -1, q)
    expect(Math.abs(q.lateral)).toBeLessThan(0.01)
    expect(q.onIsland).toBe(true)
    // 60 m to the side is off the island (50 m half-width)
    t.query(t.px[100] - t.tz[100] * 60, t.pz[100] + t.tx[100] * 60, q.idx, q)
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

  it('footbrake stops hard, harder on tarmac than gravel', () => {
    const brake: Controls = { throttle: 0, steer: 0, handbrake: false, brake: 1 }
    const stopFrom = (surface: 'tarmac' | 'gravel') => {
      const t = straight(surface)
      const s = new CarState()
      placeCar(s, t, 2)
      run(t, s, go, 8)
      const v0 = s.speed
      const s0 = s.trackS
      let time = 0
      while (s.speed > 0.5 && time < 10) {
        stepCar(s, brake, t, SIM_DT)
        time += SIM_DT
      }
      return { v0, time, dist: s.trackS - s0, s }
    }
    const tar = stopFrom('tarmac')
    // Average deceleration of well over 1.5 g on tarmac, and no rolling backwards.
    expect(tar.v0 / tar.time).toBeGreaterThan(15)
    expect(tar.s.speed).toBeGreaterThanOrEqual(0)
    const grav = stopFrom('gravel')
    expect(grav.dist / grav.v0 ** 2).toBeGreaterThan(tar.dist / tar.v0 ** 2)
  })

  it('brakes to a stop, then reverses slowly, and throttle drives forward again', () => {
    const t = straight('tarmac')
    const s = new CarState()
    placeCar(s, t, 2)
    run(t, s, go, 4)
    const brake: Controls = { throttle: 0, steer: 0, handbrake: false, brake: 1 }
    let lampWhileStopping = 0
    run(t, s, brake, 1, (st) => (lampWhileStopping = Math.max(lampWhileStopping, st.brakeLamp)))
    expect(lampWhileStopping).toBe(1)
    run(t, s, brake, 5)
    expect(s.reversing).toBe(true)
    expect(s.brakeLamp).toBe(0)
    expect(s.forwardSpeed).toBeLessThan(-0.8 * tuning.reverseSpeed)
    expect(s.forwardSpeed).toBeGreaterThanOrEqual(-tuning.reverseSpeed)
    run(t, s, go, 3)
    expect(s.reversing).toBe(false)
    expect(s.forwardSpeed).toBeGreaterThan(5)
  })

  it('handbrake + steer starts a drift that is recoverable', () => {
    // Wide road so the car stays on tarmac while sliding.
    const t = straight('tarmac', { width: 80, island: 100 })
    const s = new CarState()
    placeCar(s, t, 2)
    run(t, s, go, 5)
    let maxSlip = 0
    run(t, s, { throttle: 1, steer: 1, handbrake: true, brake: 0 }, 0.5, (st) => (maxSlip = Math.max(maxSlip, Math.abs(st.slipAngle))))
    expect(maxSlip).toBeGreaterThan(0.25)
    // Lifting off ends the drift and the car straightens.
    run(t, s, { throttle: 0, steer: 0, handbrake: false, brake: 0 }, 2.5)
    expect(s.driftDir).toBe(0)
    expect(Math.abs(s.slipAngle)).toBeLessThan(0.1)
    expect(s.speed).toBeGreaterThan(8)
  })

  it('holds a long sweeping drift on throttle with a little steering, and centring unwinds it', () => {
    const t = straight('gravel', { width: 600, island: 800 })
    const s = new CarState()
    placeCar(s, t, 2)
    run(t, s, go, 4)
    run(t, s, { throttle: 1, steer: 1, handbrake: true, brake: 0 }, 0.3)
    const dir0 = Math.atan2(s.vx, s.vz)
    run(t, s, { throttle: 1, steer: 0.4, handbrake: false, brake: 0 }, 3)
    expect(s.driftDir).toBe(1)
    expect(Math.abs(s.slipAngle)).toBeGreaterThan(0.35)
    // The line keeps turning: a sweeping arc, not a straight slide.
    const turned = Math.abs(Math.atan2(Math.sin(Math.atan2(s.vx, s.vz) - dir0), Math.cos(Math.atan2(s.vx, s.vz) - dir0)))
    expect(turned).toBeGreaterThan(0.7)
    run(t, s, { throttle: 1, steer: 0, handbrake: false, brake: 0 }, 2.5)
    expect(s.driftDir).toBe(0)
    expect(Math.abs(s.slipAngle)).toBeLessThan(0.15)
  })

  it('scandi flick: a feint then a swing the other way starts a drift on tarmac; a twitch does not', () => {
    const t = straight('tarmac', { width: 600, island: 800 })
    const flick = (feint: number) => {
      const s = new CarState()
      placeCar(s, t, 2)
      run(t, s, go, 3)
      run(t, s, { throttle: 1, steer: -1, handbrake: false, brake: 0 }, feint)
      let drifted = false
      run(t, s, { throttle: 1, steer: 1, handbrake: false, brake: 0 }, 1, (st) => (drifted ||= st.driftDir === 1))
      return drifted
    }
    expect(flick(0.25)).toBe(true)
    expect(flick(0.06)).toBe(false)
  })

  it('full steering on tarmac grips rather than drifting', () => {
    const t = straight('tarmac', { width: 600, island: 800 })
    const s = new CarState()
    placeCar(s, t, 2)
    run(t, s, go, 4)
    run(t, s, { throttle: 1, steer: 1, handbrake: false, brake: 0 }, 2)
    expect(s.driftDir).toBe(0)
    expect(Math.abs(s.slipAngle)).toBeLessThan(0.25)
  })

  it('is deterministic', () => {
    const t = straight('gravel')
    const a = new CarState()
    const b = new CarState()
    placeCar(a, t, 2)
    placeCar(b, t, 2)
    const script = (i: number): Controls => ({ throttle: 1, steer: Math.sin(i * 0.01), handbrake: i % 300 < 40, brake: 0 })
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
        { x: 0, z: 900, e: 0 },
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

describe('obstacles', () => {
  // A 10 x 10 m block (outline from a hull of a square's corners plus an inside point), 3 m tall.
  const block = convexHull([-5, -5, 5, -5, 5, 5, -5, 5, 0, 0])

  it('builds a counter-clockwise hull without inner points', () => {
    expect(block.length).toBe(8)
    let area = 0
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      area += block[i * 2] * block[j * 2 + 1] - block[j * 2] * block[i * 2 + 1]
    }
    expect(area).toBeGreaterThan(0)
  })

  it('stops a car driving straight into it, outside the outline', () => {
    const t = straight('tarmac', { width: 40, island: 60 })
    t.obstacles = [makeObstacle(block, 3, 0, 0, 60, 0)]
    const s = new CarState()
    placeCar(s, t, 2)
    let hit = 0
    run(t, s, go, 6, (st) => {
      hit = Math.max(hit, st.hitImpact)
      // The front circle never gets far inside the block (front face at z = 55).
      expect(st.z + tuning.carCircleOffset + tuning.carRadius).toBeLessThan(55.5)
    })
    expect(hit).toBeGreaterThan(5)
  })

  it('deflects and spins the car on a glancing hit', () => {
    const t = straight('tarmac', { width: 40, island: 60 })
    // Block offset to the car's right so only the right side of the nose clips it.
    t.obstacles = [makeObstacle(block, 3, -6, 0, 60, 0)]
    const s = new CarState()
    placeCar(s, t, 2)
    let maxYaw = 0
    run(t, s, go, 5, (st) => (maxYaw = Math.max(maxYaw, Math.abs(st.yawRate))))
    expect(maxYaw).toBeGreaterThan(1)
    expect(s.z).toBeGreaterThan(70) // carried on past it
    expect(s.x).toBeGreaterThan(2) // pushed away from the block (left of the road, +x)
  })

  it('passes over an obstacle while airborne above it', () => {
    const t = straight('tarmac', { width: 40, island: 60 })
    t.obstacles = [makeObstacle(block, 0.5, 0, 0, 20, 0)]
    const s = new CarState()
    placeCar(s, t, 2)
    s.vz = 25
    s.y = 3
    s.vy = 8
    s.grounded = false
    let hit = 0
    run(t, s, coast, 1.2, (st) => (hit = Math.max(hit, st.hitImpact)))
    expect(hit).toBe(0)
    expect(s.z).toBeGreaterThan(30)
  })
})
