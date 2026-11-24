/**
 * Track mesh generated from Track samples: the road on its own (no terrain or scenery yet), as a slab with
 * a surface coloured by surface type, edge lines, a double-width centre dash and chequered start/finish
 * lines. Everything is merged into one geometry.
 */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, LessDepth, Mesh, ShadowMaterial } from 'three'
import { matte } from './materials'
import type { Track } from '../sim/track'

/**
 * Colours are calibrated so a sunlit road surface shows the design colour on screen under the default
 * look ("Outdoor lite"): tarmac #53555E, stripes #E5F1F0. Lighting darkens and blues them, so the inputs
 * are brighter. Stripes can't get there from albedo alone (white renders #dfe6f0), so they're white with a
 * little emissive. Re-calibrate if the default look changes.
 */
const C = {
  /** Renders as #53555E in the sun. */
  tarmac: new Color('#676466'),
  gravel: new Color('#c39a6b'),
  roadGrass: new Color('#86b85a'),
  checkB: new Color('#26272c'),
}
/** Stripes (edge lines, centre dashes, white chequers): white + emissive renders as #E5F1F0 in the sun. */
const STRIPE_EMISSIVE = '#4c6200'
const WHITE = new Color('#ffffff')
/** How deep the road slab is below its surface (m): gives it visible sides against the floor. */
const SLAB = 0.8
/** Edge line width (m), outside the driving surface. Centre dash is 2x the old 0.26 m. */
const EDGE_W = 0.35
const DASH_W = 0.52

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

export function buildTrackView(track: Track): Group {
  const group = new Group()
  const road = new GeoBuilder()
  const lines = new GeoBuilder()
  let geo = road
  const n = track.n
  const segs = track.closed ? n : n - 1
  const half = track.width / 2
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

  // Road slab sides (the road floats on its own over the floor).
  const outer = half + EDGE_W
  strip(outer, 0.02, outer, -SLAB, roadColor)
  strip(-outer, -SLAB, -outer, 0.02, roadColor)
  // End caps on a point-to-point stage (both windings, so whichever faces outward draws).
  if (!track.closed) {
    for (const i of [0, n - 1]) {
      const c = roadColor(i, tmp1)
      const e = track.pe[i]
      const lx = track.px[i] - rx(i) * outer
      const lz = track.pz[i] - rz(i) * outer
      const qx = track.px[i] + rx(i) * outer
      const qz = track.pz[i] + rz(i) * outer
      for (const flip of [false, true]) {
        const [ax, az, bx, bz] = flip ? [qx, qz, lx, lz] : [lx, lz, qx, qz]
        geo.tri(ax, e + 0.025, az, bx, e + 0.025, bz, bx, e - SLAB, bz, c, c, c)
        geo.tri(ax, e + 0.025, az, bx, e - SLAB, bz, ax, e - SLAB, az, c, c, c)
      }
    }
  }

  // Road surface.
  strip(-half, 0.025, half, 0.025, roadColor)

  // Stripes go in their own mesh: edge lines, then centre dashes on tarmac (3 m on, 3 m off, double width).
  geo = lines
  strip(half, 0.02, outer, 0.02, solid(WHITE))
  strip(-outer, 0.02, -half, 0.02, solid(WHITE))
  strip(-DASH_W / 2, 0.035, DASH_W / 2, 0.035, solid(WHITE), (i) => track.wt[i] > 0.6 && Math.floor(track.ps[i] / 3) % 2 === 0)

  // Chequered start and finish lines across the road.
  const chequer = (at: number) => {
    const cols = 8
    for (let k = 0; k < cols; k++) {
      const a = -half + (k * track.width) / cols
      const b = a + track.width / cols
      for (let row = 0; row < 2; row++) {
        const i0 = (at + row) % n
        const white = (k + row) % 2 === 0
        geo = white ? lines : road
        strip(a, 0.04, b, 0.04, solid(white ? WHITE : C.checkB), (i) => i === i0)
      }
    }
  }
  chequer(track.startIdx)
  if (track.finishIdx !== track.startIdx) chequer(track.finishIdx)

  const roadMesh = new Mesh(road.build(), matte({ vertexColors: true }))
  roadMesh.receiveShadow = true
  roadMesh.castShadow = true
  const lineMesh = new Mesh(lines.build(), matte({ color: WHITE, emissive: STRIPE_EMISSIVE }))
  lineMesh.receiveShadow = true
  group.add(roadMesh, lineMesh)

  // Ground: the drivable island (track.island either side) at road height that shows only shadows, so the floor keeps its
  // exact colour everywhere else. It is opaque to depth, so the road sits on it. On the inside of tight
  // bends the strip folds over itself: double-sided so nothing is culled, and LessDepth so the overlapping
  // layer doesn't darken shadows twice.
  const ground = new GeoBuilder()
  geo = ground
  strip(-track.island, -0.01, track.island, -0.01, solid(WHITE))
  const groundMat = new ShadowMaterial({ color: '#2b2840', opacity: 0.35, side: DoubleSide, depthFunc: LessDepth })
  const groundMesh = new Mesh(ground.build(), groundMat)
  groundMesh.receiveShadow = true
  groundMesh.renderOrder = -1
  group.add(groundMesh)

  return group
}
