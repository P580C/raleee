/**
 * Stage scenery: models placed in the editor (TrackData.scenery), plus, unless the stage turns it off, test
 * mounds scattered along the road. Each copy is instanced and becomes an obstacle the car can hit.
 */
import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineLoop } from 'three'
import { makeObstacle, type Obstacle } from '../sim/obstacles'
import { makeGroundSample, type SceneryItem, type Track } from '../sim/track'
import { instanceLego } from './lego'
import { loadCatalog, loadScenery, type LoadedScenery } from './sceneryCatalog'

/** The model scattered along the road when a stage has autoScenery on. */
const AUTO_MODEL = 'mound1'

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

/** Ground height for a placed model: the road height nearest to it. */
export function groundHeightAt(track: Track, x: number, z: number): number {
  const g = makeGroundSample()
  track.query(x, z, -1, g)
  return g.height
}

/** Mounds alternating either side of the road, clear of other road, roundabouts and placed scenery. */
function autoPlacements(track: Track, s: LoadedScenery, placed: { x: number; z: number; r: number }[]): number[] {
  const rand = mulberry32(42)
  const half = track.width / 2
  const radius = s.radius
  const out: number[] = []
  let side = 1
  for (let d = 20; d < track.length - 10; d += radius * (1 + rand() * 0.6)) {
    const i = indexAt(track, d)
    const lat = side * (half + 0.35 + radius * 0.9 + 2 + rand() * radius * 0.5)
    const x = track.px[i] - track.tz[i] * lat
    const z = track.pz[i] + track.tx[i] * lat
    let clear = true
    for (let j = 0; j < track.n && clear; j += 4) {
      if (Math.hypot(track.px[j] - x, track.pz[j] - z) < half + radius + 1) clear = false
    }
    for (const j of track.junctions) if (Math.hypot(j.x - x, j.z - z) < j.reach + radius + 1) clear = false
    for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < p.r + radius) clear = false
    if (clear) out.push(x, track.pe[i], z, rand() * Math.PI * 2)
    side = -side
  }
  return out
}

export async function buildScenery(
  track: Track,
  opts: { scenery?: SceneryItem[]; autoScenery?: boolean } = {},
): Promise<{ group: Group; obstacles: Obstacle[] }> {
  const catalog = await loadCatalog()
  const group = new Group()
  const obstacles: Obstacle[] = []
  const add = (s: LoadedScenery, placements: number[]) => {
    if (!placements.length) return
    group.add(instanceLego(s.model, placements))
    if (!s.outline.length) return
    for (let i = 0; i < placements.length; i += 4) {
      obstacles.push(makeObstacle(s.outline, s.height, placements[i], placements[i + 1], placements[i + 2], placements[i + 3]))
    }
  }
  // Placed models, instanced per model.
  const byModel = new Map<string, number[]>()
  for (const it of opts.scenery ?? []) {
    let list = byModel.get(it.m)
    if (!list) byModel.set(it.m, (list = []))
    list.push(it.x, groundHeightAt(track, it.x, it.z), it.z, (it.r * Math.PI) / 180)
  }
  const placedCircles: { x: number; z: number; r: number }[] = []
  for (const [id, placements] of byModel) {
    const def = catalog.find((d) => d.id === id)
    if (!def) continue // model no longer in the catalog
    const s = await loadScenery(def)
    for (let i = 0; i < placements.length; i += 4) placedCircles.push({ x: placements[i], z: placements[i + 2], r: s.radius })
    add(s, placements)
  }
  if (opts.autoScenery !== false) {
    const def = catalog.find((d) => d.id === AUTO_MODEL)
    if (def) {
      const s = await loadScenery(def)
      add(s, autoPlacements(track, s, placedCircles))
    }
  }
  return { group, obstacles }
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
