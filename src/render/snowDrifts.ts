/**
 * Snow banked along both road edges: a low-poly white drift that hides the edge line and the road's
 * sharp edge, with a ragged inner edge that creeps a random distance onto the tarmac (more in some
 * places, tongues of snow here and there). Built once per stage the first time it snows there.
 * Roundabouts are left clear. Seeded from the stage, so the same stage always gets the same drifts.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh } from 'three'
import type { Track } from '../sim/track'
import { matte } from './materials'

/** Road edge line width (m): matches trackView's EDGE_W. */
const EDGE_W = 0.35
/** Sample spacing of the drift (in track samples, ~1 m each): low-poly. */
const STEP = 2
/** How far the snow creeps onto the road past its edge (m): min, plus up to this much more. */
const CREEP_MIN = 0.25
const CREEP_VAR = 1.4
/** Drift crest height above the road (m), and how far out the drift runs past the edge line. */
const CREST_H = 0.18
const CREST_VAR = 0.22
const OUTER = 1.6

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Smooth 1D value noise in [0, 1] along the track: random knots every `period` samples, cosine-eased. */
function noise1(n: number, period: number, rand: () => number): Float32Array {
  const knots = new Float32Array(Math.ceil(n / period) + 2)
  for (let i = 0; i < knots.length; i++) knots[i] = rand()
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const f = i / period
    const k = Math.floor(f)
    const t = (1 - Math.cos((f - k) * Math.PI)) * 0.5
    out[i] = knots[k] + (knots[k + 1] - knots[k]) * t
  }
  return out
}

export function buildSnowDrifts(track: Track): Mesh {
  const n = track.n
  const half = track.width / 2
  const rand = mulberry32(Math.round(track.length * 1000) ^ n)
  const pos: number[] = []

  const inJunction = new Uint8Array(n)
  for (const j of track.junctions) {
    const r2 = (j.reach + 1) ** 2
    for (let i = 0; i < n; i++) if ((track.px[i] - j.x) ** 2 + (track.pz[i] - j.z) ** 2 < r2) inJunction[i] = 1
  }

  for (const side of [1, -1]) {
    // Two scales of noise: long swells in how far the snow reaches, and short ragged bites.
    const swell = noise1(n, 14, rand)
    const bite = noise1(n, 3, rand)
    const crest = noise1(n, 5, rand)
    // Profile across the drift (lateral offset outward from the centreline, height above the road).
    const lat = new Float32Array(4)
    const hgt = new Float32Array(4)
    const prev = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    let have = false
    const last = track.closed ? n : n - 1
    for (let i = 0; i <= last; i += STEP) {
      const k = track.closed ? i % n : Math.min(i, n - 1)
      if (inJunction[k]) {
        have = false
        continue
      }
      // Ragged: smooth swells, short bites, a per-vertex jitter and the odd long tongue onto the road.
      const tongue = rand() < 0.07 ? 0.8 + rand() * 1.2 : 0
      const creep = CREEP_MIN + CREEP_VAR * (0.55 * swell[k] ** 1.4 + 0.3 * bite[k] + 0.25 * rand()) + tongue
      lat[0] = half - creep
      hgt[0] = 0.05
      lat[1] = half - creep * (0.25 + 0.3 * rand())
      hgt[1] = 0.09 + 0.06 * bite[k]
      lat[2] = half + EDGE_W + 0.25 + 0.3 * crest[k]
      hgt[2] = CREST_H + CREST_VAR * crest[k]
      lat[3] = half + EDGE_W + OUTER + 0.6 * swell[k]
      hgt[3] = -0.02
      const rx = -track.tz[k] * side
      const rz = track.tx[k] * side
      const e = track.pe[k]
      const cur: number[] = []
      for (let r = 0; r < 4; r++) cur.push(track.px[k] + rx * lat[r], e + hgt[r], track.pz[k] + rz * lat[r])
      if (have) {
        for (let r = 0; r < 3; r++) {
          const a = r * 3
          const b = (r + 1) * 3
          // quad: prev[r], prev[r+1], cur[r+1], cur[r]
          pos.push(prev[a], prev[a + 1], prev[a + 2], prev[b], prev[b + 1], prev[b + 2], cur[b], cur[b + 1], cur[b + 2])
          pos.push(prev[a], prev[a + 1], prev[a + 2], cur[b], cur[b + 1], cur[b + 2], cur[a], cur[a + 1], cur[a + 2])
        }
      }
      for (let q = 0; q < 12; q++) prev[q] = cur[q]
      have = true
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.computeVertexNormals()
  // Double-sided: the strips' winding differs per side; flat shading takes the normal from the
  // screen-space slope, so both sides light the same.
  const mesh = new Mesh(geo, matte({ color: '#ffffff', emissive: '#3a3e48', side: DoubleSide, roughness: 1 }))
  mesh.receiveShadow = true
  mesh.name = 'snowDrifts'
  return mesh
}
