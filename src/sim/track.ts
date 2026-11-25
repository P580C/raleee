/**
 * Track data → dense centreline samples, plus ground queries for the simulation.
 * Pure: no three.js. Used by both sim and render.
 */
import { smoothstep } from './math'
import type { Obstacle } from './obstacles'

export type SurfaceName = 'tarmac' | 'gravel' | 'grass'
export const SURFACES: readonly SurfaceName[] = ['tarmac', 'gravel', 'grass']

export interface TrackPoint {
  x: number
  z: number
  /** Elevation (m). Interpolated linearly between points, so ramps and drops are easy to author. */
  e: number
  /** Surface of the segment from this point to the next. Inherits from the previous point if omitted. */
  surface?: SurfaceName
  /** Marks the finish line (point-to-point stages). */
  finish?: boolean
}

/** A roundabout: ring road round an island with four arms, centred at (x, z). The centreline runs through it. */
export interface JunctionData {
  x: number
  z: number
  e: number
  /** Heading (degrees) of the entry: the arms point along it, against it and to both sides. */
  deg: number
  exit: 'L' | 'R' | 'S'
  surface: SurfaceName
  /** Centre to the end of each arm (m). */
  reach: number
  /** Ring centreline radius (m). */
  ring: number
}

/** JunctionData plus what queries and meshes need. */
export interface Junction extends JunctionData {
  /** Arm directions (unit, outward): ahead, behind, right, left of the entry heading. */
  ax: number[]
  az: number[]
  rIn: number
  rOut: number
  surfIdx: number
}

/** A scenery model placed in the editor: catalog id, position on the ground, turn about +y in degrees. */
export interface SceneryItem {
  m: string
  x: number
  z: number
  r: number
}

export interface TrackData {
  name: string
  /** Road width (m). */
  width: number
  /** Shoulder width beyond the road edge (m). */
  verge: number
  /** Half-width of the terrain island around the centreline (m). Beyond it you fall. */
  island: number
  closed: boolean
  /** Distance along the track (m) of the start line. */
  start?: number
  points: TrackPoint[]
  /** Roundabouts (from piece stages). */
  junctions?: JunctionData[]
  /** Placed scenery (drawn and collided with by the renderer; the sim ignores it). */
  scenery?: SceneryItem[]
  /** Scatter the test mounds along the road (default true). */
  autoScenery?: boolean
}

export interface GroundSample {
  /** Index of the segment start sample. Feed back as a hint for the next query. */
  idx: number
  /** Distance along the track (m). */
  s: number
  /** Signed distance from centreline, positive to the right of travel (m). */
  lateral: number
  height: number
  onIsland: boolean
  /** 0..1, how much of the road (vs off-road) is under this point. */
  roadness: number
  /** Distance (m) outside the nearest road edge; 0 on the road. */
  offDist: number
  wTarmac: number
  wGravel: number
  wGrass: number
}

export function makeGroundSample(): GroundSample {
  return { idx: -1, s: 0, lateral: 0, height: 0, onIsland: true, roadness: 1, offDist: 0, wTarmac: 1, wGravel: 0, wGrass: 0 }
}

const SPACING = 1.0
const SEARCH_WINDOW = 24
const SURFACE_BLEND = 3

interface P2 {
  x: number
  z: number
}

function catmullRom(p0: P2, p1: P2, p2: P2, p3: P2, t: number, out: P2): void {
  // Centripetal Catmull-Rom (Barry–Goldman), avoids cusps and loops.
  const k = (a: P2, b: P2) => Math.max(Math.pow(Math.hypot(b.x - a.x, b.z - a.z), 0.5), 1e-4)
  const t0 = 0
  const t1 = t0 + k(p0, p1)
  const t2 = t1 + k(p1, p2)
  const t3 = t2 + k(p2, p3)
  const tt = t1 + (t2 - t1) * t
  const mix = (a: number, b: number, ta: number, tb: number) => ((tb - tt) / (tb - ta)) * a + ((tt - ta) / (tb - ta)) * b
  for (const c of ['x', 'z'] as const) {
    const a1 = mix(p0[c], p1[c], t0, t1)
    const a2 = mix(p1[c], p2[c], t1, t2)
    const a3 = mix(p2[c], p3[c], t2, t3)
    const b1 = mix(a1, a2, t0, t2)
    const b2 = mix(a2, a3, t1, t3)
    out[c] = mix(b1, b2, t1, t2)
  }
}

export class Track {
  readonly name: string
  readonly closed: boolean
  readonly width: number
  readonly verge: number
  readonly island: number
  /** Scenery the car can hit. Filled in by whoever places scenery (static after that). */
  obstacles: Obstacle[] = []
  readonly junctions: Junction[]
  readonly n: number
  readonly length: number
  readonly startIdx: number
  /** Finish line sample and distance. Closed tracks without a finish point use the start line. */
  readonly finishIdx: number
  readonly finishS: number
  /** Sample positions, elevation, unit tangent, distance along. */
  readonly px: Float64Array
  readonly pz: Float64Array
  readonly pe: Float64Array
  readonly tx: Float64Array
  readonly tz: Float64Array
  readonly ps: Float64Array
  /** Road surface weights per sample (blended along the track). */
  readonly wt: Float32Array
  readonly wg: Float32Array
  readonly wr: Float32Array

  // query scratch
  private _t = 0
  private _lat = 0
  private _len = 0

  constructor(data: TrackData) {
    this.name = data.name
    this.closed = data.closed
    this.width = data.width
    this.verge = data.verge
    this.island = data.island
    const halfW = data.width / 2
    this.junctions = (data.junctions ?? []).map((j) => {
      const h = (j.deg * Math.PI) / 180
      const fx = Math.sin(h)
      const fz = Math.cos(h)
      return {
        ...j,
        ax: [fx, -fx, -fz, fz],
        az: [fz, -fz, fx, -fx],
        rIn: j.ring - halfW,
        rOut: j.ring + halfW,
        surfIdx: Math.max(0, SURFACES.indexOf(j.surface)),
      }
    })
    const P = data.points
    const np = P.length
    if (np < (data.closed ? 3 : 2)) throw new Error('Track needs more points')

    const get = (i: number): P2 => {
      if (this.closed) return P[((i % np) + np) % np]
      if (i < 0) return { x: 2 * P[0].x - P[1].x, z: 2 * P[0].z - P[1].z }
      if (i >= np) return { x: 2 * P[np - 1].x - P[np - 2].x, z: 2 * P[np - 1].z - P[np - 2].z }
      return P[i]
    }

    const segSurf: number[] = []
    let cur: SurfaceName = 'tarmac'
    for (let i = 0; i < np; i++) {
      if (P[i].surface) cur = P[i].surface!
      segSurf.push(SURFACES.indexOf(cur))
    }

    const xs: number[] = []
    const zs: number[] = []
    const es: number[] = []
    const ss: number[] = []
    const segs = this.closed ? np : np - 1
    const tmp: P2 = { x: 0, z: 0 }
    const pointIdx: number[] = []
    for (let i = 0; i < segs; i++) {
      pointIdx.push(xs.length)
      const p0 = get(i - 1)
      const p1 = get(i)
      const p2 = get(i + 1)
      const p3 = get(i + 2)
      const e1 = P[i].e
      const e2 = P[(i + 1) % np].e
      let len = 0
      let lx = p1.x
      let lz = p1.z
      for (let k = 1; k <= 24; k++) {
        catmullRom(p0, p1, p2, p3, k / 24, tmp)
        len += Math.hypot(tmp.x - lx, tmp.z - lz)
        lx = tmp.x
        lz = tmp.z
      }
      const count = Math.max(1, Math.round(len / SPACING))
      for (let k = 0; k < count; k++) {
        const t = k / count
        catmullRom(p0, p1, p2, p3, t, tmp)
        xs.push(tmp.x)
        zs.push(tmp.z)
        es.push(e1 + (e2 - e1) * t)
        ss.push(segSurf[i])
      }
    }
    if (!this.closed) {
      pointIdx.push(xs.length)
      xs.push(P[np - 1].x)
      zs.push(P[np - 1].z)
      es.push(P[np - 1].e)
      ss.push(segSurf[np - 1])
    }

    const n = xs.length
    this.n = n
    this.px = Float64Array.from(xs)
    this.pz = Float64Array.from(zs)
    this.pe = Float64Array.from(es)
    this.tx = new Float64Array(n)
    this.tz = new Float64Array(n)
    this.ps = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const a = this.closed ? (i - 1 + n) % n : Math.max(0, i - 1)
      const b = this.closed ? (i + 1) % n : Math.min(n - 1, i + 1)
      const dx = xs[b] - xs[a]
      const dz = zs[b] - zs[a]
      const l = Math.hypot(dx, dz) || 1
      this.tx[i] = dx / l
      this.tz[i] = dz / l
      if (i > 0) this.ps[i] = this.ps[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1])
    }
    this.length = this.ps[n - 1] + (this.closed ? Math.hypot(xs[0] - xs[n - 1], zs[0] - zs[n - 1]) : 0)

    // Blend surfaces along the track so transitions aren't a hard line.
    this.wt = new Float32Array(n)
    this.wg = new Float32Array(n)
    this.wr = new Float32Array(n)
    const outs = [this.wt, this.wg, this.wr]
    for (let i = 0; i < n; i++) {
      let cnt = 0
      for (let k = -SURFACE_BLEND; k <= SURFACE_BLEND; k++) {
        let j = i + k
        if (this.closed) j = (j + n) % n
        else if (j < 0 || j >= n) continue
        outs[ss[j]][i] += 1
        cnt++
      }
      for (const o of outs) o[i] /= cnt
    }

    let si = 0
    while (si < n - 1 && this.ps[si] < (data.start ?? 0)) si++
    this.startIdx = si
    const fp = P.findIndex((p) => p.finish)
    this.finishIdx = fp >= 0 ? pointIdx[fp] : this.closed ? this.startIdx : n - 1
    this.finishS = this.ps[this.finishIdx]
  }

  headingAt(i: number): number {
    return Math.atan2(this.tx[i], this.tz[i])
  }

  private wrap(i: number): number {
    return this.closed ? ((i % this.n) + this.n) % this.n : i
  }

  /** Signed shortest index distance from a to b. */
  private indexDelta(a: number, b: number): number {
    let d = b - a
    if (this.closed) {
      const n = this.n
      if (d > n / 2) d -= n
      else if (d < -n / 2) d += n
    }
    return d
  }

  /** Project (x,z) onto segment a→b. Returns squared distance; sets _t, _lat, _len. */
  private projectSeg(a: number, b: number, x: number, z: number): number {
    const ax = this.px[a]
    const az = this.pz[a]
    const dx = this.px[b] - ax
    const dz = this.pz[b] - az
    const len = Math.hypot(dx, dz) || 1e-6
    const ux = dx / len
    const uz = dz / len
    const rx = x - ax
    const rz = z - az
    let t = (rx * ux + rz * uz) / len
    if (t < 0) t = 0
    else if (t > 1) t = 1
    const qx = x - (ax + dx * t)
    const qz = z - (az + dz * t)
    // right of travel = (-uz, ux)
    const side = qx * -uz + qz * ux
    const d2 = qx * qx + qz * qz
    this._t = t
    this._lat = side >= 0 ? Math.sqrt(d2) : -Math.sqrt(d2)
    this._len = len
    return d2
  }

  /**
   * Ground under (x,z). `hint` is the idx from a previous query (or -1 for a global search).
   * Writes into `out`; allocates nothing.
   */
  query(x: number, z: number, hint: number, out: GroundSample): void {
    const n = this.n
    const px = this.px
    const pz = this.pz
    let best = 0
    let bestD = Infinity
    if (hint < 0 || hint >= n) {
      for (let i = 0; i < n; i++) {
        const dx = px[i] - x
        const dz = pz[i] - z
        const d = dx * dx + dz * dz
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
    } else {
      let center = hint
      for (let iter = 0; iter < 64; iter++) {
        bestD = Infinity
        for (let k = -SEARCH_WINDOW; k <= SEARCH_WINDOW; k++) {
          let i = center + k
          if (this.closed) i = (i + n) % n
          else if (i < 0 || i >= n) continue
          const dx = px[i] - x
          const dz = pz[i] - z
          const d = dx * dx + dz * dz
          if (d < bestD) {
            bestD = d
            best = i
          }
        }
        if (Math.abs(this.indexDelta(center, best)) < SEARCH_WINDOW - 1) break
        center = best
      }
    }

    // Refine on the two segments touching the nearest sample.
    let segA = best
    let d2 = Infinity
    let t = 0
    let lat = 0
    let len = 1
    const prev = this.closed ? this.wrap(best - 1) : best - 1
    const next = this.closed ? this.wrap(best + 1) : best + 1
    if (prev >= 0) {
      d2 = this.projectSeg(prev, best, x, z)
      segA = prev
      t = this._t
      lat = this._lat
      len = this._len
    }
    if (next < n) {
      const d = this.projectSeg(best, next, x, z)
      if (d < d2) {
        d2 = d
        segA = best
        t = this._t
        lat = this._lat
        len = this._len
      }
    }
    const segB = this.closed ? this.wrap(segA + 1) : Math.min(segA + 1, n - 1)

    out.idx = segA
    out.s = this.ps[segA] + t * len
    out.lateral = lat
    out.height = this.pe[segA] + (this.pe[segB] - this.pe[segA]) * t
    const absLat = Math.abs(lat)
    out.onIsland = absLat < this.island
    const half = this.width * 0.5
    const roadness = 1 - smoothstep(half - 0.2, half + this.verge * 0.8, absLat)
    out.roadness = roadness
    out.offDist = Math.max(0, absLat - half)
    const rt = this.wt[segA] + (this.wt[segB] - this.wt[segA]) * t
    const rg = this.wg[segA] + (this.wg[segB] - this.wg[segA]) * t
    const rr = this.wr[segA] + (this.wr[segB] - this.wr[segA]) * t
    out.wTarmac = rt * roadness
    out.wGravel = rg * roadness
    out.wGrass = rr * roadness + (1 - roadness)
    if (this.junctions.length) this.junctionGround(x, z, out)
  }

  /** Roundabouts: the whole ring and all four arms are road, not just the driving line through them. */
  private junctionGround(x: number, z: number, out: GroundSample): void {
    const half = this.width * 0.5
    const v = this.verge
    for (const j of this.junctions) {
      const dx = x - j.x
      const dz = z - j.z
      const lim = j.reach + v
      const d2 = dx * dx + dz * dz
      if (d2 > lim * lim) continue
      const d = Math.sqrt(d2)
      // Distance outside the ring's road (negative on it); the island inside is off-road.
      const ringOff = Math.max(j.rIn - d, d - j.rOut)
      let off = Math.max(0, ringOff)
      let r = 1 - smoothstep(-0.2, v * 0.8, ringOff)
      for (let k = 0; k < 4; k++) {
        const along = dx * j.ax[k] + dz * j.az[k]
        // Arms run from the ring out to the piece edge (as drawn), never across the island.
        if (along < j.rOut - 3 || along > j.reach + 0.5) continue
        const lat = Math.abs(dx * j.az[k] - dz * j.ax[k])
        r = Math.max(r, 1 - smoothstep(half - 0.2, half + v * 0.8, lat))
        off = Math.min(off, Math.max(0, lat - half))
      }
      out.offDist = Math.min(out.offDist, off)
      if (r <= out.roadness) continue
      out.roadness = r
      out.wTarmac = j.surfIdx === 0 ? r : 0
      out.wGravel = j.surfIdx === 1 ? r : 0
      out.wGrass = (j.surfIdx === 2 ? r : 0) + (1 - r)
    }
  }
}
