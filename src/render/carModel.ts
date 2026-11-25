/**
 * Procedural low-poly 80s four-wheel-drive rally coupe (reference/Cars.jpg): boxy wedge body in pale
 * blue-grey, yellow lower band, red and black side stripes, box-flared arches, raised rear wing, quad spot
 * lamps and white five-spoke wheels.
 *
 * Built at 1x in metres (car faces +z, local +x is the car's left, ground at y = 0) and merged into one mesh
 * per colour, so the whole shell is a handful of draw calls.
 */
import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, Vector3 } from 'three'
import { matte, plastic } from './materials'

export const CAR_COLORS = {
  body: '#c4dde3',
  yellow: '#efe27c',
  red: '#e0563f',
  black: '#2b2e35',
  glass: '#5d8db0',
  light: '#fbf6e4',
  tail: '#9e2a24',
  reverse: '#a9a7a2',
  amber: '#f0a640',
  tyre: '#2b2e35',
  rim: '#f3f3ef',
}
type ColorKey = keyof typeof CAR_COLORS

type V3 = [number, number, number]

const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _n = new Vector3()
const _o = new Vector3()

/** Collects flat-shaded triangles per colour. Every face is wound to point away from a given inside point. */
class Builder {
  readonly parts = new Map<ColorKey, number[]>()

  tri(col: ColorKey, a: V3, b: V3, c: V3, inside: V3): void {
    _a.set(...a)
    _b.set(...b)
    _c.set(...c)
    _n.subVectors(_b, _a).cross(_o.subVectors(_c, _a))
    _o.set((a[0] + b[0] + c[0]) / 3 - inside[0], (a[1] + b[1] + c[1]) / 3 - inside[1], (a[2] + b[2] + c[2]) / 3 - inside[2])
    let arr = this.parts.get(col)
    if (!arr) this.parts.set(col, (arr = []))
    if (_n.dot(_o) >= 0) arr.push(...a, ...b, ...c)
    else arr.push(...a, ...c, ...b)
  }

  quad(col: ColorKey, a: V3, b: V3, c: V3, d: V3, inside: V3): void {
    this.tri(col, a, b, c, inside)
    this.tri(col, a, c, d, inside)
  }

  /**
   * Hexahedron from 8 corners: bottom ring [0..3] then top ring [4..7], both in the order
   * left-front, right-front, right-rear, left-rear. `skip` drops faces nobody sees ('bottom', 'top', ...).
   */
  hexa(col: ColorKey, p: V3[], skip: string[] = []): void {
    const ins: V3 = [0, 0, 0]
    for (const q of p) for (let i = 0; i < 3; i++) ins[i] += q[i] / 8
    const f = (name: string, a: number, b: number, c: number, d: number) => {
      if (!skip.includes(name)) this.quad(col, p[a], p[b], p[c], p[d], ins)
    }
    f('bottom', 0, 1, 2, 3)
    f('top', 4, 5, 6, 7)
    f('front', 0, 1, 5, 4)
    f('rear', 3, 2, 6, 7)
    f('left', 0, 3, 7, 4)
    f('right', 1, 2, 6, 5)
  }

  /** Axis-aligned box centred at (x, y, z). */
  box(col: ColorKey, w: number, h: number, d: number, x: number, y: number, z: number, skip: string[] = []): void {
    const x0 = x + w / 2
    const x1 = x - w / 2
    const y0 = y - h / 2
    const y1 = y + h / 2
    const z0 = z + d / 2
    const z1 = z - d / 2
    this.hexa(
      col,
      [
        [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
        [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
      ],
      skip,
    )
  }

  /** Flat polygon on the car's side at |x| = `x`, given as (z, y) outline points; mirrored to both sides. */
  side(col: ColorKey, x: number, pts: [number, number][]): void {
    for (const sx of [1, -1]) {
      const inside: V3 = [0, 0.6, 0]
      for (let i = 1; i < pts.length - 1; i++) {
        this.tri(col, [sx * x, pts[0][1], pts[0][0]], [sx * x, pts[i][1], pts[i][0]], [sx * x, pts[i + 1][1], pts[i + 1][0]], inside)
      }
    }
  }

  /** A short cylinder (lamp) pointing along +z or -z, added as raw triangles. */
  lamp(col: ColorKey, r: number, depth: number, x: number, y: number, z: number, segs = 8): void {
    const g = new CylinderGeometry(r, r, depth, segs, 1).toNonIndexed()
    g.applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2).setPosition(x, y, z))
    const pos = g.getAttribute('position').array
    let arr = this.parts.get(col)
    if (!arr) this.parts.set(col, (arr = []))
    for (let i = 0; i < pos.length; i++) arr.push(pos[i])
    g.dispose()
  }

  build(): Group {
    const g = new Group()
    for (const [col, arr] of this.parts) {
      const geo = new BufferGeometry()
      geo.setAttribute('position', new Float32BufferAttribute(arr, 3))
      geo.computeVertexNormals()
      // Lamps get their own (uncached) material so they can glow: CarView drives their emissive.
      const mat =
        col === 'tail' || col === 'reverse'
          ? matte({ color: CAR_COLORS[col], roughness: 0.35, emissive: col === 'tail' ? '#ff1405' : '#fff6e0', emissiveIntensity: 0 })
          : col === 'black' || col === 'tyre'
            ? matte({ color: CAR_COLORS[col], roughness: 0.6 })
            : plastic(CAR_COLORS[col])
      const m = new Mesh(geo, mat)
      m.name = col
      m.castShadow = true
      m.receiveShadow = true
      g.add(m)
    }
    return g
  }
}

/** Height of the waist line (top of the lower body) at a given z: a wedge that rises toward the tail. */
function waist(z: number): number {
  const front = 0.72
  const back = 0.84
  const t = (1.98 - z) / 3.96
  return front + (back - front) * t
}

/** How far the arch top sits above the top of the tyre at rest (1x scale). */
export const ARCH_RISE = 0.12

/**
 * The body shell at 1x scale (about 4.0 m long, 1.85 m wide). `wheelZ` are the front and rear axle
 * positions at 1x, `wheelR` the wheel radius at 1x.
 */
export function buildCarShell(wheelZF: number, wheelZR: number, wheelR: number): Group {
  const b = new Builder()
  const W = 0.74 // half width of the main body
  const ZF = 1.98 // nose
  const ZR = -1.98 // tail
  const sill = 0.24
  const band = 0.4 // top of the yellow lower band

  // ── Lower body: yellow band, then the pale wedge above it ──
  b.box('yellow', W * 2, band - sill, ZF - ZR, 0, (band + sill) / 2, 0, ['top'])
  b.hexa('body', [
    [W, band, ZF], [-W, band, ZF], [-W, band, ZR], [W, band, ZR],
    [W, waist(ZF), ZF - 0.04], [-W, waist(ZF), ZF - 0.04], [-W, waist(ZR), ZR], [W, waist(ZR), ZR],
  ], ['bottom'])

  // ── Cabin: glass greenhouse, pale roof and pillars ──
  const zWs = 0.5 // windscreen base
  const zRw = -1.2 // rear window base
  const roofY = 1.24
  const zRoofF = -0.2
  const zRoofR = -0.95
  const gW = 0.7
  const rW = 0.6
  b.hexa('glass', [
    [gW, waist(zWs), zWs], [-gW, waist(zWs), zWs], [-gW, waist(zRw), zRw], [gW, waist(zRw), zRw],
    [rW, roofY, zRoofF], [-rW, roofY, zRoofF], [-rW, roofY, zRoofR], [rW, roofY, zRoofR],
  ], ['bottom'])
  // Roof panel, a touch proud of the glass.
  b.hexa('body', [
    [rW + 0.02, roofY - 0.02, zRoofF + 0.02], [-rW - 0.02, roofY - 0.02, zRoofF + 0.02], [-rW - 0.02, roofY - 0.02, zRoofR - 0.02], [rW + 0.02, roofY - 0.02, zRoofR - 0.02],
    [rW, roofY + 0.04, zRoofF], [-rW, roofY + 0.04, zRoofF], [-rW, roofY + 0.04, zRoofR], [rW, roofY + 0.04, zRoofR],
  ], ['bottom'])
  // Thick C-pillars (body colour) covering the rear quarter of the greenhouse.
  for (const sx of [1, -1]) {
    const o = 0.015
    const xb = sx * (gW + o)
    const xt = sx * (rW + o)
    const xbi = sx * (gW - 0.12)
    const xti = sx * (rW - 0.12)
    b.hexa('body', [
      [xb, waist(-0.7), -0.7], [xbi, waist(-0.7), -0.7], [xbi, waist(zRw), zRw], [xb, waist(zRw), zRw],
      [xt, roofY - 0.01, zRoofR + 0.12], [xti, roofY - 0.01, zRoofR + 0.12], [xti, roofY - 0.01, zRoofR], [xt, roofY - 0.01, zRoofR],
    ], ['bottom'])
    // B-pillar (black) between the door glass and the rear quarter glass.
    const zb = -0.42
    b.hexa('black', [
      [sx * (gW + 0.01), waist(zb), zb + 0.05], [sx * (gW - 0.05), waist(zb), zb + 0.05], [sx * (gW - 0.05), waist(zb), zb - 0.05], [sx * (gW + 0.01), waist(zb), zb - 0.05],
      [sx * (rW + 0.01), roofY - 0.01, zb + 0.08], [sx * (rW - 0.05), roofY - 0.01, zb + 0.08], [sx * (rW - 0.05), roofY - 0.01, zb - 0.02], [sx * (rW + 0.01), roofY - 0.01, zb - 0.02],
    ], ['bottom'])
    // Mirrors.
    b.box('black', 0.1, 0.08, 0.1, sx * (W + 0.03), waist(0.42) + 0.06, 0.42)
  }

  // ── Box-flared wheel arches (pale, with the yellow band carried round the bottom) ──
  // Wide and tall enough that the tyre stays inside on full bump (carView also caps wheel rise to the arch).
  const flareW = 0.19
  for (const zc of [wheelZF, wheelZR]) {
    const l = wheelR + 0.155
    for (const sx of [1, -1]) {
      const xi = sx * (W - 0.02)
      const xo = sx * (W + flareW)
      const top = wheelR * 2 + ARCH_RISE
      const yb = wheelR - 0.02
      const topIn = Math.max(top + 0.02, waist(zc) + 0.02)
      b.hexa('body', [
        [xi, yb, zc + l], [xo, yb, zc + l - 0.05], [xo, yb, zc - l + 0.05], [xi, yb, zc - l],
        [xi, topIn, zc + l - 0.06], [xo - sx * 0.03, top, zc + l - 0.1], [xo - sx * 0.03, top, zc - l + 0.1], [xi, topIn, zc - l + 0.06],
      ], ['bottom'])
    }
  }
  // Side skirts between the arches.
  for (const sx of [1, -1]) {
    const z0 = wheelZF - wheelR - 0.155
    const z1 = wheelZR + wheelR + 0.155
    b.hexa('yellow', [
      [sx * W, sill, z0], [sx * (W + 0.11), sill, z0], [sx * (W + 0.11), sill, z1], [sx * W, sill, z1],
      [sx * W, band, z0], [sx * (W + 0.085), band, z0], [sx * (W + 0.085), band, z1], [sx * W, band, z1],
    ], ['bottom'])
  }

  // ── Livery: red stripe sweeping up from the front wing to the cabin, black pinstripe at the waist ──
  const sx0 = W + 0.004
  const sw = 0.055
  b.side('red', sx0, [
    [1.55, band + 0.02], [1.55, band + 0.02 + sw * 1.6], [zWs + 0.05, waist(zWs + 0.05) - 0.02], [zWs - 0.1, waist(zWs - 0.1) - 0.02], [zWs - 0.1, waist(zWs - 0.1) - 0.02 - sw], [zWs + 0.05, waist(zWs + 0.05) - 0.02 - sw],
  ])
  b.side('red', sx0, [[zWs - 0.1, waist(zWs - 0.1) - 0.02], [-1.9, waist(-1.9) - 0.02], [-1.9, waist(-1.9) - 0.02 - sw], [zWs - 0.1, waist(zWs - 0.1) - 0.02 - sw]])
  b.side('black', sx0, [[1.9, waist(1.9) - 0.012], [-1.92, waist(-1.92) - 0.012], [-1.92, waist(-1.92) - 0.035], [1.9, waist(1.9) - 0.035]])
  // Bonnet stripes.
  for (const sx of [1, -1]) {
    const x0 = sx * 0.45
    const x1 = sx * 0.52
    const y = (z: number) => waist(z) + 0.006
    b.quad('black', [x0, y(1.85), 1.85], [x1, y(1.85), 1.85], [x1, y(0.7), 0.7], [x0, y(0.7), 0.7], [0, 0, 1.2])
  }

  // ── Nose: black grille, square headlamps, quad spot lamps, amber indicators ──
  const nz = ZF - 0.02
  b.box('black', 1.24, 0.19, 0.04, 0, 0.56, nz, ['rear'])
  for (const sx of [1, -1]) {
    b.box('light', 0.2, 0.14, 0.04, sx * 0.48, 0.56, nz + 0.01, ['rear'])
    b.box('amber', 0.1, 0.07, 0.04, sx * 0.68, 0.5, nz + 0.01, ['rear'])
    b.lamp('light', 0.07, 0.08, sx * 0.18, 0.34, ZF + 0.04)
    b.lamp('light', 0.07, 0.08, sx * 0.4, 0.34, ZF + 0.04)
  }
  // Front lip.
  b.box('black', W * 2 + 0.04, 0.06, 0.12, 0, sill + 0.02, ZF - 0.02)

  // ── Tail: full-width tail lamps, black lower panel, raised wing ──
  b.box('tail', W * 2 - 0.1, 0.13, 0.04, 0, 0.68, ZR - 0.01, ['front'])
  for (const sx of [1, -1]) b.box('reverse', 0.16, 0.09, 0.03, sx * 0.26, 0.68, ZR - 0.035, ['front'])
  b.box('black', W * 2 + 0.02, 0.1, 0.08, 0, sill + 0.04, ZR + 0.02)
  // Low boot-lid wing on two short stands.
  const wingY = waist(ZR) + 0.13
  for (const sx of [1, -1]) b.box('black', 0.05, 0.13, 0.1, sx * 0.5, waist(ZR) + 0.06, ZR + 0.16)
  b.hexa('body', [
    [0.78, wingY, ZR + 0.36], [-0.78, wingY, ZR + 0.36], [-0.78, wingY - 0.01, ZR - 0.04], [0.78, wingY - 0.01, ZR - 0.04],
    [0.78, wingY + 0.03, ZR + 0.36], [-0.78, wingY + 0.03, ZR + 0.36], [-0.78, wingY + 0.07, ZR - 0.04], [0.78, wingY + 0.07, ZR - 0.04],
  ])
  b.box('black', 1.58, 0.03, 0.03, 0, wingY + 0.07, ZR - 0.05)

  return b.build()
}

const TYRE_MAT = matte({ color: CAR_COLORS.tyre, roughness: 0.9 })

/** One wheel: dark tyre with a white five-spoke-look rim on the outer face. Axle along x. */
export function buildWheel(radius: number, width: number, outward: 1 | -1): Group {
  const g = new Group()
  const tyre = new CylinderGeometry(radius, radius, width, 12)
  tyre.rotateZ(Math.PI / 2)
  const tyreMesh = new Mesh(tyre, TYRE_MAT)
  tyreMesh.castShadow = true
  g.add(tyreMesh)
  // Pentagonal white rim disc, then a small dark hub: reads as a five-spoke wheel at this size.
  const rim = new CylinderGeometry(radius * 0.66, radius * 0.66, width * 0.2, 5)
  rim.rotateZ(Math.PI / 2)
  rim.translate((outward * width) / 2, 0, 0)
  const rimMesh = new Mesh(rim, plastic(CAR_COLORS.rim))
  rimMesh.castShadow = true
  g.add(rimMesh)
  const hub = new CylinderGeometry(radius * 0.18, radius * 0.18, width * 0.24, 6)
  hub.rotateZ(Math.PI / 2)
  hub.translate((outward * width) / 2, 0, 0)
  g.add(new Mesh(hub, TYRE_MAT))
  return g
}
