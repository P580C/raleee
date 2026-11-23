/**
 * Grey-box track meshes generated from Track samples: floating grass island,
 * road coloured by surface, white edge lines, shoulders, centre dashes,
 * edge posts and a scatter of cone trees for speed reference.
 * Everything static is merged into one geometry.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
} from 'three'
import { makeGroundSample, type Track } from '../sim/track'

const C = {
  grass: new Color('#93c95f'),
  grassDark: new Color('#7fb552'),
  skirt: new Color('#9a7552'),
  skirtDark: new Color('#7b5b40'),
  tarmac: new Color('#4c5059'),
  gravel: new Color('#c39a6b'),
  roadGrass: new Color('#86b85a'),
  edge: new Color('#f6f4ee'),
  shoulder: new Color('#d9ccb0'),
  dash: new Color('#f6f4ee'),
  checkA: new Color('#f6f4ee'),
  checkB: new Color('#26272c'),
}

class GeoBuilder {
  pos: number[] = []
  col: number[] = []

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c1: Color, c2: Color, c3: Color): void {
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz)
    this.col.push(c1.r, c1.g, c1.b, c2.r, c2.g, c2.b, c3.r, c3.g, c3.b)
  }

  build(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3))
    g.computeVertexNormals()
    return g
  }
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildTrackView(track: Track): Group {
  const group = new Group()
  const geo = new GeoBuilder()
  const n = track.n
  const segs = track.closed ? n : n - 1
  const half = track.width / 2
  const isl = track.island
  const tmp1 = new Color()
  const tmp2 = new Color()

  const rx = (i: number) => -track.tz[i]
  const rz = (i: number) => track.tx[i]

  /**
   * Strip between lateral offsets/heights A and B along every segment.
   * Normal = (B - A) × forward, so A=left→B=right faces up, top→bottom on the right faces out.
   */
  const strip = (
    latA: number,
    yA: number,
    latB: number,
    yB: number,
    color: (i: number, out: Color) => Color,
    filter?: (i: number) => boolean,
  ) => {
    for (let i = 0; i < segs; i++) {
      if (filter && !filter(i)) continue
      const j = (i + 1) % n
      const ci = color(i, tmp1)
      const cj = color(j, tmp2)
      const ei = track.pe[i]
      const ej = track.pe[j]
      const aix = track.px[i] + rx(i) * latA
      const aiz = track.pz[i] + rz(i) * latA
      const bix = track.px[i] + rx(i) * latB
      const biz = track.pz[i] + rz(i) * latB
      const ajx = track.px[j] + rx(j) * latA
      const ajz = track.pz[j] + rz(j) * latA
      const bjx = track.px[j] + rx(j) * latB
      const bjz = track.pz[j] + rz(j) * latB
      geo.tri(aix, ei + yA, aiz, bix, ei + yB, biz, ajx, ej + yA, ajz, ci, ci, cj)
      geo.tri(bix, ei + yB, biz, bjx, ej + yB, bjz, ajx, ej + yA, ajz, ci, cj, cj)
    }
  }

  const solid = (c: Color) => (_i: number, out: Color) => out.copy(c)
  const roadColor = (i: number, out: Color) => {
    const a = track.wt[i]
    const b = track.wg[i]
    const c = track.wr[i]
    return out.setRGB(
      C.tarmac.r * a + C.gravel.r * b + C.roadGrass.r * c,
      C.tarmac.g * a + C.gravel.g * b + C.roadGrass.g * c,
      C.tarmac.b * a + C.gravel.b * b + C.roadGrass.b * c,
    )
  }

  // Island top, then its sides (tapered, like a floating chunk of earth).
  strip(-isl, 0, isl, 0, (i, out) => out.copy(C.grass).lerp(C.grassDark, 0.5 + 0.5 * Math.sin(i * 0.05)))
  strip(isl, 0, isl - 2.5, -4, solid(C.skirt))
  strip(-isl + 2.5, -4, -isl, 0, solid(C.skirtDark))
  strip(isl - 2.5, -4, -isl + 2.5, -4, solid(C.skirtDark)) // underside, rarely seen

  // Shoulders, edge lines, road.
  strip(half + 0.35, 0.015, half + 1.4, 0.015, solid(C.shoulder))
  strip(-half - 1.4, 0.015, -half - 0.35, 0.015, solid(C.shoulder))
  strip(half, 0.02, half + 0.35, 0.02, solid(C.edge))
  strip(-half - 0.35, 0.02, -half, 0.02, solid(C.edge))
  strip(-half, 0.025, half, 0.025, roadColor)

  // Centre dashes on tarmac: 3 m on, 3 m off.
  strip(-0.13, 0.035, 0.13, 0.035, solid(C.dash), (i) => track.wt[i] > 0.6 && Math.floor(track.ps[i] / 3) % 2 === 0)

  // Chequered start line across the road.
  {
    const cols = 8
    for (let k = 0; k < cols; k++) {
      const a = -half + (k * track.width) / cols
      const b = a + track.width / cols
      for (let row = 0; row < 2; row++) {
        const i0 = (track.startIdx + row) % n
        const c = (k + row) % 2 === 0 ? C.checkA : C.checkB
        strip(a, 0.04, b, 0.04, solid(c), (i) => i === i0)
      }
    }
  }

  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true })
  group.add(new Mesh(geo.build(), mat))

  // Edge posts every 12 m, alternating red/white.
  const m4 = new Matrix4()
  const postIdx: number[] = []
  for (let i = 0; i < n; i += 12) postIdx.push(i)
  const posts = new InstancedMesh(new BoxGeometry(0.3, 0.9, 0.3), new MeshLambertMaterial({ flatShading: true }), postIdx.length * 2)
  const red = new Color('#d9534a')
  const white = new Color('#f6f4ee')
  let k = 0
  for (const i of postIdx) {
    for (const side of [-1, 1]) {
      const lat = side * (half + 1.9)
      m4.makeTranslation(track.px[i] + rx(i) * lat, track.pe[i] + 0.45, track.pz[i] + rz(i) * lat)
      posts.setMatrixAt(k, m4)
      posts.setColorAt(k, (i / 12) % 2 === 0 ? red : white)
      k++
    }
  }
  group.add(posts)

  // Cone trees scattered on the island, away from any road.
  const rand = mulberry32(1234)
  const q = makeGroundSample()
  const spots: number[] = []
  for (let i = 0; i < n; i += 5) {
    for (const side of [-1, 1]) {
      if (rand() > 0.45) continue
      const lat = side * (half + 4 + rand() * (isl - half - 6))
      const x = track.px[i] + rx(i) * lat + (rand() - 0.5) * 3
      const z = track.pz[i] + rz(i) * lat + (rand() - 0.5) * 3
      track.query(x, z, -1, q)
      if (Math.abs(q.lateral) < half + 3.5 || !q.onIsland) continue
      spots.push(x, q.height, z, 0.7 + rand() * 0.6)
    }
  }
  const treeGeo = new ConeGeometry(1.3, 4, 6)
  treeGeo.translate(0, 2, 0)
  const trees = new InstancedMesh(treeGeo, new MeshLambertMaterial({ color: '#4e8f4a', flatShading: true }), spots.length / 4)
  for (let t = 0; t < spots.length / 4; t++) {
    const s = spots[t * 4 + 3]
    m4.makeScale(s, s, s).setPosition(spots[t * 4], spots[t * 4 + 1], spots[t * 4 + 2])
    trees.setMatrixAt(t, m4)
  }
  group.add(trees)

  return group
}
