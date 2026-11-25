import { describe, expect, it } from 'vitest'
import stage1 from '../src/tracks/stage1.json'
import { convexHull, makeObstacle } from '../src/sim/obstacles'
import { makeGroundSample, Track, type TrackData } from '../src/sim/track'
import { CarState, placeCar, SIM_DT, stepCar, type Controls } from '../src/sim/vehicle'
import { tuning } from '../src/tuning'
import { findOverlaps, layoutPieces, LEVEL, parsePieces, PIECES, ROUNDABOUT, piecesToTrackData, type Piece, type PieceTrackData } from '../src/sim/pieces'
import valley from '../src/tracks/valley.json'
import sprint from '../src/tracks/sprint.json'

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
      // Long enough that 25 s flat out never runs off the end (off the track now costs half your speed).
      { x: 0, z: 3200, e: 0 },
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

  it('leaving the track halves your speed, then holds you to half top speed', () => {
    const t = straight('tarmac', { island: 400 })
    const s = new CarState()
    placeCar(s, t, 200)
    // Flat out, pointing straight off the side of the road.
    s.heading = Math.PI / 2
    s.vx = 40
    s.vz = 0
    s.speed = 40
    let entry = 0
    let lowest = Infinity
    let lowAt = 0
    let time = 0
    run(t, s, go, 2.5, (c) => {
      time += SIM_DT
      if (c.offTrack && !entry) entry = Math.hypot(c.vx, c.vz)
      if (entry && c.speed < lowest) {
        lowest = c.speed
        lowAt = time
      }
    })
    expect(entry).toBeGreaterThan(30)
    expect(s.offTrack).toBe(true)
    // Down to half the speed it left the road at, within about a second.
    expect(lowest).toBeLessThan(entry * tuning.offroadSpeed + 0.5)
    expect(lowAt).toBeLessThan(1.5)
    // Keep going: it may build back up, but only to half top speed.
    run(t, s, go, 8)
    expect(s.speed).toBeLessThan(tuning.topSpeed * tuning.offroadSpeed + 0.5)
    expect(s.speed).toBeGreaterThan(tuning.topSpeed * tuning.offroadSpeed * 0.6)
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

describe('track pieces', () => {
  const base = (pieces: Piece[], heading = 0): PieceTrackData => ({ format: 'pieces', name: 't', heading, pieces })

  it('four 90 degree bends of each size turn the heading right round and close the square', () => {
    for (const k of ['bend90', 'large90', 'small90'] as const) {
      const lay = layoutPieces(base([{ k, t: 'L' }, { k, t: 'L' }, { k, t: 'L' }, { k, t: 'L' }]))
      const end = lay.ends[3]
      expect(end.deg).toBe(0)
      expect(Math.hypot(end.x, end.z)).toBeLessThan(1e-6)
      // Quarter turn left from heading +z ends at (r, r): the car's left is +x.
      expect(lay.ends[0].x).toBeCloseTo(PIECES[k].radius, 6)
      expect(lay.ends[0].z).toBeCloseTo(PIECES[k].radius, 6)
    }
  })

  it('45 degree bends and straights keep exact headings and lengths', () => {
    const lay = layoutPieces(base([{ k: 'bend45', t: 'R' }, { k: 'straight' }, { k: 'bend45', t: 'R' }], 225))
    expect(lay.ends.map((e) => e.deg)).toEqual([180, 180, 135])
    expect(lay.pieceS[1] - lay.pieceS[0]).toBeCloseTo((40 * Math.PI) / 4, 6)
    expect(lay.pieceS[2] - lay.pieceS[1]).toBeCloseTo(32, 6)
  })

  it('becomes a sim track: start line at the first piece, finish after the last, ramps change height', () => {
    const data = base(parsePieces('S S^ gravel L90 S'), 225)
    const t = new Track(piecesToTrackData(data))
    expect(Math.hypot(t.px[t.startIdx], t.pz[t.startIdx])).toBeLessThan(1)
    const stage = 32 + 32 + (32 * Math.PI) / 2 + 32
    expect(t.finishS - t.ps[t.startIdx]).toBeCloseTo(stage, -0.5)
    expect(t.pe[t.finishIdx]).toBeCloseTo(LEVEL, 3)
    const g = makeGroundSample()
    // Middle of the bend is gravel.
    const lay = layoutPieces(data)
    const [x, z] = lay.piecePts[2].slice(Math.floor(lay.piecePts[2].length / 6) * 3)
    t.query(x, z, -1, g)
    expect(g.wGravel).toBeGreaterThan(0.9)
  })

  it('flags pieces that run into other road', () => {
    // A spiral of small bends with straights folds back over itself.
    const lay = layoutPieces(base(parsePieces('S RS RS S S RS RS S S S')))
    expect(findOverlaps(lay, 14).size).toBeGreaterThan(0)
    const clean = layoutPieces(base(parsePieces('S L90 S R90 S')))
    expect(findOverlaps(clean, 14).size).toBe(0)
  })

  it('built-in stages are clean and drivable', () => {
    for (const d of [valley, sprint] as PieceTrackData[]) {
      const lay = layoutPieces(d)
      expect(findOverlaps(lay, 14).size).toBe(0)
      const t = new Track(piecesToTrackData(d))
      const s = new CarState()
      placeCar(s, t, t.startIdx)
      run(t, s, go, 3)
      expect(s.speed).toBeGreaterThan(15)
      expect(s.onIsland).toBe(true)
    }
  })
})

describe('roundabouts', () => {
  const data = (t: 'L' | 'R' | 'S'): PieceTrackData => ({ format: 'pieces', name: 'rb', heading: 0, pieces: [{ k: 'roundabout', t }, { k: 'straight' }] })

  it('exits left, right or straight on, ending where a 90 bend or two straights would', () => {
    const C = ROUNDABOUT.reach
    const want = { L: [C, C, 90], R: [-C, C, 270], S: [0, 2 * C, 0] } as const
    for (const t of ['L', 'R', 'S'] as const) {
      const end = layoutPieces(data(t)).ends[0]
      expect(end.x).toBeCloseTo(want[t][0], 6)
      expect(end.z).toBeCloseTo(want[t][1], 6)
      expect(end.deg).toBe(want[t][2])
    }
  })

  it('has a smooth driving line (no jumps between points, gentle direction changes)', () => {
    for (const t of ['L', 'R', 'S'] as const) {
      const p = layoutPieces(data(t)).piecePts[0]
      // Only the driving line: the ring / arm footprint points are appended after it.
      const line: number[][] = []
      for (let i = 0; i < p.length; i += 3) line.push([p[i], p[i + 1]])
      const drive = line.slice(0, line.length - 18)
      for (let i = 1; i < drive.length; i++) expect(Math.hypot(drive[i][0] - drive[i - 1][0], drive[i][1] - drive[i - 1][1])).toBeLessThan(4.5)
      for (let i = 2; i < drive.length; i++) {
        const a = Math.atan2(drive[i - 1][0] - drive[i - 2][0], drive[i - 1][1] - drive[i - 2][1])
        const b = Math.atan2(drive[i][0] - drive[i - 1][0], drive[i][1] - drive[i - 1][1])
        expect(Math.abs(wrap(b - a))).toBeLessThan(0.5)
      }
    }
  })

  it('counts the whole ring and every arm as road, the island as grass', () => {
    const t = new Track(piecesToTrackData(data('L')))
    const g = makeGroundSample()
    const C = ROUNDABOUT.reach
    // Far side of the ring from the driving line (centre is at (0, C)); the unused right arm; the island.
    t.query(-ROUNDABOUT.ring, C, -1, g)
    expect(g.roadness).toBeGreaterThan(0.95)
    t.query(-C + 2, C, -1, g)
    expect(g.roadness).toBeGreaterThan(0.95)
    t.query(2, C + 2, -1, g)
    expect(g.wGrass).toBeGreaterThan(0.9)
  })

  it('can be driven through', () => {
    const t = new Track(piecesToTrackData({ format: 'pieces', name: 'rb', heading: 225, pieces: parsePieces('S OS S S') }))
    const s = new CarState()
    placeCar(s, t, t.startIdx)
    let offRoad = 0
    for (let i = 0; i < Math.round(25 / SIM_DT); i++) {
      const j = Math.min(t.n - 1, s.trackIdx + 8)
      const want = Math.atan2(t.px[j] - s.x, t.pz[j] - s.z)
      const travel = s.speed > 3 ? Math.atan2(s.vx, s.vz) : s.heading
      const c: Controls = { throttle: s.speed < 14 ? 1 : 0, steer: Math.max(-1, Math.min(1, wrap(travel - want) * 4)), handbrake: false, brake: 0 }
      stepCar(s, c, t, SIM_DT)
      if (s.wheelsOnGrass >= 2) offRoad++
      if (s.trackS > t.finishS) break
    }
    expect(s.trackS).toBeGreaterThan(t.finishS)
    expect(offRoad * SIM_DT).toBeLessThan(0.5)
  })
})

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}
