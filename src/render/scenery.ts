/**
 * Test scenery: LEGO mounds dotted beside the road. Placement is procedural for now; it will move into the
 * track JSON once there are more assets. Each placement also becomes an obstacle the car can hit.
 */
import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineLoop } from 'three'
import { makeObstacle, type Obstacle } from '../sim/obstacles'
import type { Track } from '../sim/track'
import { instanceLego, legoFootprint, loadLegoModel, type LegoModel } from './lego'

/** Mound1 is built small: 3x the car's stud scale (about 30 m across). */
const MOUND_SCALE = 3
/** Parts lower than this (m) don't collide: at 3x scale the mound's base plates are about 1 m tall. */
const MOUND_COLLIDE_ABOVE = 1.2

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Sample index at distance s along the track (ps is increasing). */
function indexAt(track: Track, s: number): number {
  let lo = 0
  let hi = track.n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (track.ps[mid] < s) lo = mid + 1
    else hi = mid
  }
  return lo
}

let moundModel: Promise<LegoModel> | null = null

export async function buildScenery(track: Track): Promise<{ group: Group; obstacles: Obstacle[] }> {
  // Loaded once and shared by every stage (the instanced meshes reuse its geometry).
  moundModel ??= loadLegoModel(`${import.meta.env.BASE_URL}models/mound1.glb`, MOUND_SCALE)
  const mound = await moundModel
  const rand = mulberry32(42)
  const half = track.width / 2
  const radius = Math.hypot(mound.size.x, mound.size.z) / 2
  const placements: number[] = []
  let side = 1
  // Alternating sides, so each side gets one about every 2 diameters.
  for (let s = 20; s < track.length - 10; s += radius * (1 + rand() * 0.6)) {
    const i = indexAt(track, s)
    const lat = side * (half + 0.35 + radius * 0.9 + 2 + rand() * radius * 0.5)
    const x = track.px[i] - track.tz[i] * lat
    const z = track.pz[i] + track.tx[i] * lat
    // Keep clear of other stretches of road (hairpins fold the road back on itself).
    let clear = true
    for (let j = 0; j < track.n && clear; j += 4) {
      if (Math.hypot(track.px[j] - x, track.pz[j] - z) < half + radius + 1) clear = false
    }
    if (clear) placements.push(x, track.pe[i], z, rand() * Math.PI * 2)
    side = -side
  }
  const { outline, height } = legoFootprint(mound, MOUND_COLLIDE_ABOVE)
  const obstacles: Obstacle[] = []
  for (let i = 0; i < placements.length; i += 4) {
    if (outline.length) obstacles.push(makeObstacle(outline, height, placements[i], placements[i + 1], placements[i + 2], placements[i + 3]))
  }
  return { group: instanceLego(mound, placements), obstacles }
}

/** Debug view: obstacle outlines as red lines just above the ground. */
export function obstacleLines(obstacles: Obstacle[]): Group {
  const g = new Group()
  const mat = new LineBasicMaterial({ color: '#ff3b30', depthTest: false, transparent: true })
  for (const o of obstacles) {
    const v: number[] = []
    for (let i = 0; i < o.n; i++) v.push(o.pts[i * 2], o.base + 0.15, o.pts[i * 2 + 1])
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(v, 3))
    const line = new LineLoop(geo, mat)
    line.renderOrder = 10
    g.add(line)
  }
  return g
}
