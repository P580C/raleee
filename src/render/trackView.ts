/**
 * Track mesh generated from Track samples: the road on its own (no terrain or scenery yet), as a slab with
 * a surface coloured by surface type, edge lines, a double-width centre dash and chequered start/finish
 * lines. Everything is merged into one geometry.
 */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, LessDepth, type Material, Mesh, MeshBasicMaterial, type Object3D, ShadowMaterial } from 'three'
import { matte } from './materials'
import type { Junction, Track } from '../sim/track'

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
  checkB: new Color('#26272c'),
}
/** Stripes (edge lines, centre dashes, white chequers): white + emissive renders as #E5F1F0 in the sun. */
const STRIPE_EMISSIVE = '#4c6200'
/** Stripes at night: a dim neutral grey glow, so the lines are just readable in the dark. */
const NIGHT_STRIPE_EMISSIVE = '#3c3c3c'
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

  // Inside a roundabout the ring and arms are drawn whole (below), so the plain road band skips it.
  const inJunction = new Uint8Array(n)
  for (const j of track.junctions) {
    const r2 = (j.reach - 0.05) ** 2
    for (let i = 0; i < n; i++) if ((track.px[i] - j.x) ** 2 + (track.pz[i] - j.z) ** 2 < r2) inJunction[i] = 1
  }
  let skipJunctions = true

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
      if (skipJunctions && (inJunction[i] || inJunction[j])) continue
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
    return out.setRGB(C.tarmac.r * a + C.gravel.r * b, C.tarmac.g * a + C.gravel.g * b, C.tarmac.b * a + C.gravel.b * b)
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
  skipJunctions = false
  chequer(track.startIdx)
  if (track.finishIdx !== track.startIdx) chequer(track.finishIdx)
  skipJunctions = true

  for (const j of track.junctions) buildJunction(j, half, road, lines)

  const roadMesh = new Mesh(road.build(), matte({ vertexColors: true }))
  roadMesh.receiveShadow = true
  roadMesh.castShadow = true
  const lineMat = matte({ color: WHITE, emissive: STRIPE_EMISSIVE })
  // At night (weatherView) the lines keep a faint neutral glow, like reflective paint, instead of the
  // daytime yellow-green that balances the sun.
  lineMat.userData.nightEmissive = NIGHT_STRIPE_EMISSIVE
  const lineMesh = new Mesh(lines.build(), lineMat)
  lineMesh.receiveShadow = true
  group.add(roadMesh, lineMesh)

  // Ground: the drivable island (track.island either side) at road height that shows only shadows, so the floor keeps its
  // exact colour everywhere else. It is opaque to depth, so the road sits on it. On the inside of tight
  // bends the strip folds over itself: double-sided so nothing is culled, and LessDepth so the overlapping
  // layer doesn't darken shadows twice.
  const ground = new GeoBuilder()
  geo = ground
  skipJunctions = false
  strip(-track.island, -0.01, track.island, -0.01, solid(WHITE))
  const groundMat = new ShadowMaterial({ color: '#2b2840', opacity: 0.35, side: DoubleSide, depthFunc: LessDepth })
  const groundMesh = new Mesh(ground.build(), groundMat)
  groundMesh.receiveShadow = true
  groundMesh.renderOrder = -1
  group.add(groundMesh)

  return group
}

const ISLAND = new Color('#86b85a')
const SURFACE_COLORS = [C.tarmac, C.gravel]

type P3 = [number, number, number]

/** Triangle wound so its face normal points along (nx, ny, nz). */
function face(g: GeoBuilder, a: P3, b: P3, c: P3, col: Color, nx: number, ny: number, nz: number): void {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const cx = uy * vz - uz * vy
  const cy = uz * vx - ux * vz
  const cz = ux * vy - uy * vx
  if (cx * nx + cy * ny + cz * nz >= 0) g.tri(...a, ...b, ...c, col, col, col)
  else g.tri(...a, ...c, ...b, col, col, col)
}

function quad(g: GeoBuilder, a: P3, b: P3, c: P3, d: P3, col: Color, nx: number, ny: number, nz: number): void {
  face(g, a, b, c, col, nx, ny, nz)
  face(g, a, c, d, col, nx, ny, nz)
}

/**
 * A roundabout as in map.jpg: ring road round a raised grass island with a white kerb, edge lines, a dashed
 * line round the ring and four arms. Arms the stage doesn't use end in a cap.
 */
function buildJunction(j: Junction, half: number, road: GeoBuilder, lines: GeoBuilder): void {
  const e = j.e
  const col = SURFACE_COLORS[j.surfIdx]
  const yRoad = e + 0.025
  const yLine = e + 0.02
  const SEG = 72
  const armAng = j.ax.map((ax, k) => Math.atan2(j.az[k], ax))
  const opening = Math.asin(Math.min(1, (half + EDGE_W) / j.rOut)) + 0.01
  const inArm = (a: number) =>
    armAng.some((t) => {
      const d = Math.abs(((a - t + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      return d < opening
    })
  const pt = (a: number, r: number, y: number): P3 => [j.x + Math.cos(a) * r, y, j.z + Math.sin(a) * r]
  /** Flat ring between radii, optionally leaving gaps where the arms join. */
  const annulus = (g: GeoBuilder, r0: number, r1: number, y: number, c: Color, gaps: boolean, keep?: (k: number) => boolean) => {
    for (let k = 0; k < SEG; k++) {
      const a0 = (k / SEG) * Math.PI * 2
      const a1 = ((k + 1) / SEG) * Math.PI * 2
      if (gaps && inArm((a0 + a1) / 2)) continue
      if (keep && !keep(k)) continue
      quad(g, pt(a0, r0, y), pt(a0, r1, y), pt(a1, r1, y), pt(a1, r0, y), c, 0, 1, 0)
    }
  }
  /** Vertical cylinder wall facing out (or in). */
  const wall = (g: GeoBuilder, r: number, yTop: number, yBot: number, c: Color, gaps: boolean) => {
    for (let k = 0; k < SEG; k++) {
      const a0 = (k / SEG) * Math.PI * 2
      const a1 = ((k + 1) / SEG) * Math.PI * 2
      if (gaps && inArm((a0 + a1) / 2)) continue
      const am = (a0 + a1) / 2
      quad(g, pt(a0, r, yTop), pt(a1, r, yTop), pt(a1, r, yBot), pt(a0, r, yBot), c, Math.cos(am), 0, Math.sin(am))
    }
  }

  // Ring road, its outer edge line and slab side (open where the arms join).
  annulus(road, j.rIn - 0.01, j.rOut + 0.01, yRoad, col, false)
  annulus(lines, j.rOut, j.rOut + EDGE_W, yLine, WHITE, true)
  wall(road, j.rOut + EDGE_W, yLine, e - SLAB, col, true)
  // Dashed line round the middle of the ring (3 m on, 3 m off).
  const dashes = Math.round((Math.PI * 2 * j.ring) / 6) * 2
  const dashSeg = SEG
  annulus(lines, j.ring - DASH_W / 4, j.ring + DASH_W / 4, e + 0.035, WHITE, false, (k) => Math.floor((k / dashSeg) * dashes) % 2 === 0)
  // Island: inner edge line, white kerb, raised grass top.
  const rIsl = j.rIn - EDGE_W
  annulus(lines, rIsl, j.rIn, yLine, WHITE, false)
  const yIsl = e + 0.35
  for (let k = 0; k < SEG; k++) {
    const a0 = (k / SEG) * Math.PI * 2
    const a1 = ((k + 1) / SEG) * Math.PI * 2
    face(road, [j.x, yIsl, j.z], pt(a0, rIsl, yIsl), pt(a1, rIsl, yIsl), ISLAND, 0, 1, 0)
  }
  wall(lines, rIsl, yIsl, yLine, WHITE, false)

  // Arms: road out to the piece edge, with edge lines, a centre dash and slab sides. Unused arms are capped.
  const used = [j.exit === 'S', true, j.exit === 'R', j.exit === 'L']
  const outer = half + EDGE_W
  const lineStart = Math.sqrt(Math.max(0, j.rOut * j.rOut - half * half))
  for (let k = 0; k < 4; k++) {
    const ax = j.ax[k]
    const az = j.az[k]
    const px = -az
    const pz = ax
    const P = (along: number, lat: number, y: number): P3 => [j.x + ax * along + px * lat, y, j.z + az * along + pz * lat]
    const a0 = j.rOut - 3
    const a1 = j.reach
    quad(road, P(a0, -half, yRoad), P(a0, half, yRoad), P(a1, half, yRoad), P(a1, -half, yRoad), col, 0, 1, 0)
    for (const sd of [1, -1]) {
      quad(lines, P(lineStart, sd * half, yLine), P(lineStart, sd * outer, yLine), P(a1, sd * outer, yLine), P(a1, sd * half, yLine), WHITE, 0, 1, 0)
      quad(road, P(lineStart, sd * outer, yLine), P(a1, sd * outer, yLine), P(a1, sd * outer, e - SLAB), P(lineStart, sd * outer, e - SLAB), col, sd * px, 0, sd * pz)
    }
    for (let d = lineStart; d < a1; d += 6) {
      const d1 = Math.min(a1, d + 3)
      quad(lines, P(d, -DASH_W / 2, e + 0.035), P(d, DASH_W / 2, e + 0.035), P(d1, DASH_W / 2, e + 0.035), P(d1, -DASH_W / 2, e + 0.035), WHITE, 0, 1, 0)
    }
    if (!used[k]) quad(road, P(a1, -outer, yLine), P(a1, outer, yLine), P(a1, outer, e - SLAB), P(a1, -outer, e - SLAB), col, ax, 0, az)
  }
}

/**
 * A flat translucent band over the road between samples i0 and i1 (editor highlights: the selected piece,
 * pieces that overlap). Drawn on top of the road, never written to depth.
 */
export function buildRoadOverlay(track: Track, i0: number, i1: number, color: string, opacity: number, widen = 1): Mesh {
  const pos: number[] = []
  const half = (track.width / 2 + EDGE_W) * widen
  const a = Math.max(0, i0)
  const b = Math.min(track.n - 1, i1)
  for (let i = a; i < b; i++) {
    const j = i + 1
    const lx = (k: number) => track.px[k] - -track.tz[k] * half
    const lz = (k: number) => track.pz[k] - track.tx[k] * half
    const qx = (k: number) => track.px[k] + -track.tz[k] * half
    const qz = (k: number) => track.pz[k] + track.tx[k] * half
    const yi = track.pe[i] + 0.08
    const yj = track.pe[j] + 0.08
    pos.push(lx(i), yi, lz(i), qx(i), yi, qz(i), lx(j), yj, lz(j))
    pos.push(qx(i), yi, qz(i), qx(j), yj, qz(j), lx(j), yj, lz(j))
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  const m = new Mesh(g, new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide }))
  m.renderOrder = 3
  return m
}

/** Free the geometry and materials of a group built here (or any other group that owns its own). */
export function disposeGroup(g: Object3D): void {
  g.traverse((o) => {
    const m = o as Mesh
    m.geometry?.dispose()
    const mat = m.material as Material | Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose()
  })
}
