/**
 * Procedural low-poly 80s hatchback (reference/RetroCar.png, the game's original car): salmon-red body,
 * cream roof that wraps down the rear pillars, dark glass, quad round headlamps in a black grille, chunky
 * black bumpers and white-wall wheels with pale blue-grey hubs.
 *
 * Same conventions as the rally coupe in carModel.ts: 1x scale in metres, car faces +z, local +x is the
 * car's left, ground at y = 0, one merged mesh per colour.
 */
import type { Group } from 'three'
import { Builder, type V3, type WheelStyle } from './carModel'

export const HATCH_COLORS = {
  body: '#e2705c',
  cream: '#f2ebd9',
  glass: '#4f7595',
  black: '#2c2d33',
  grille: '#3a3b42',
  light: '#fbf6e4',
  plate: '#f4f4f0',
  tail: '#b3332b',
  reverse: '#a9a7a2',
  amber: '#f0a640',
}

export const HATCH_WHEEL: WheelStyle = { rim: '#b9c3e0', rimR: 0.56, rimSides: 10, wall: '#f2ebd9' }

/** Arch top above the top of the tyre at rest (1x scale): soft lips, not box flares. */
export const HATCH_ARCH_RISE = 0.1

export function buildHatchShell(wheelZF: number, wheelZR: number, wheelR: number): Group {
  const b = new Builder(HATCH_COLORS)
  const W = 0.76
  const ZF = 1.95
  const ZR = -1.92
  const sill = 0.26
  /** Shoulder line: low nose rising gently to the tail. */
  const waist = (z: number) => 0.7 + ((ZF - z) / (ZF - ZR)) * 0.1

  // ── Lower body ──
  b.hexa('body', [
    [W, sill, ZF], [-W, sill, ZF], [-W, sill, ZR], [W, sill, ZR],
    [W - 0.03, waist(ZF), ZF - 0.05], [-W + 0.03, waist(ZF), ZF - 0.05], [-W, waist(ZR), ZR], [W, waist(ZR), ZR],
  ], ['bottom'])

  // ── Greenhouse: dark glass, cream roof slab, cream C-pillars either side of the hatch glass ──
  const zWs = 0.62 // windscreen base
  const zRg = -1.62 // rear glass base
  const roof = 1.3
  const gx0 = W - 0.04
  const gx1 = W - 0.15
  b.hexa('glass', [
    [gx0, waist(zWs), zWs], [-gx0, waist(zWs), zWs], [-gx0, waist(zRg), zRg], [gx0, waist(zRg), zRg],
    [gx1, roof, -0.06], [-gx1, roof, -0.06], [-gx1, roof, -1.2], [gx1, roof, -1.2],
  ], ['bottom'])
  b.hexa('cream', [
    [gx1 + 0.03, roof - 0.04, 0], [-gx1 - 0.03, roof - 0.04, 0], [-gx1 - 0.03, roof - 0.04, -1.26], [gx1 + 0.03, roof - 0.04, -1.26],
    [gx1 + 0.02, roof + 0.04, -0.03], [-gx1 - 0.02, roof + 0.04, -0.03], [-gx1 - 0.02, roof + 0.04, -1.23], [gx1 + 0.02, roof + 0.04, -1.23],
  ], ['bottom'])
  for (const sx of [1, -1]) {
    // C-pillar: a cream wedge over the rear of each side window, sitting just proud of the glass.
    const o0 = sx * (gx0 + 0.012)
    const i0 = sx * (gx0 - 0.3)
    const o1 = sx * (gx1 + 0.012)
    const i1 = sx * (gx1 - 0.22)
    b.hexa('cream', [
      [o0, waist(-1.02), -1.02], [i0, waist(-1.02), -1.02], [i0, waist(zRg - 0.05), zRg - 0.05], [o0, waist(zRg - 0.05), zRg - 0.05],
      [o1, roof, -0.9], [i1, roof, -0.9], [i1, roof, -1.25], [o1, roof, -1.25],
    ], ['bottom'])
    // A-pillar and B-pillar in body colour.
    const pill = (zb: number, zt: number, w: number) =>
      b.hexa('body', [
        [sx * (gx0 + 0.012), waist(zb), zb + w], [sx * (gx0 - 0.04), waist(zb), zb + w], [sx * (gx0 - 0.04), waist(zb), zb - w], [sx * (gx0 + 0.012), waist(zb), zb - w],
        [sx * (gx1 + 0.012), roof - 0.02, zt + w], [sx * (gx1 - 0.04), roof - 0.02, zt + w], [sx * (gx1 - 0.04), roof - 0.02, zt - w], [sx * (gx1 + 0.012), roof - 0.02, zt - w],
      ], ['bottom'])
    pill(zWs - 0.03, -0.03, 0.04)
    pill(-0.5, -0.5, 0.045)
    // Door mirror.
    b.box('black', 0.1, 0.08, 0.12, sx * (W + 0.04), waist(0.45) + 0.08, 0.45)
    // Door handle.
    b.box('black', 0.01, 0.03, 0.12, sx * (W + 0.004), waist(-0.6) - 0.08, -0.6)
  }

  // ── Wheel arches: soft lips in body colour ──
  for (const zc of [wheelZF, wheelZR]) {
    const l = wheelR + 0.1
    for (const sx of [1, -1]) {
      const xi = sx * (W - 0.02)
      const xo = sx * (W + 0.1)
      const top = wheelR * 2 + HATCH_ARCH_RISE
      const yb = wheelR + 0.02
      const topIn = Math.max(top + 0.02, waist(zc) - 0.04)
      b.hexa('body', [
        [xi, yb, zc + l], [xo, yb, zc + l - 0.06], [xo, yb, zc - l + 0.06], [xi, yb, zc - l],
        [xi, topIn, zc + l - 0.1], [xo - sx * 0.03, top, zc + l - 0.16], [xo - sx * 0.03, top, zc - l + 0.16], [xi, topIn, zc - l + 0.1],
      ], ['bottom'])
    }
  }

  // ── Nose: black grille with four round headlamps, chunky bumper, white plate, amber corners ──
  const nz = ZF - 0.03
  b.box('grille', W * 2 - 0.12, 0.22, 0.04, 0, 0.55, nz, ['rear'])
  for (const sx of [1, -1]) {
    b.lamp('light', 0.085, 0.06, sx * 0.4, 0.55, nz + 0.03, 10)
    b.lamp('light', 0.085, 0.06, sx * 0.6, 0.55, nz + 0.03, 10)
    b.box('amber', 0.12, 0.05, 0.04, sx * 0.62, 0.4, nz + 0.01, ['rear'])
  }
  b.box('black', W * 2 + 0.08, 0.15, 0.16, 0, sill + 0.06, ZF + 0.02)
  b.box('plate', 0.36, 0.1, 0.02, 0, sill + 0.06, ZF + 0.11, ['rear'])
  // Bonnet bulge (a lighter panel in the reference): a low raised plate.
  const bonnet: V3[] = [
    [0.34, waist(1.6) + 0.004, 1.6], [-0.34, waist(1.6) + 0.004, 1.6], [-0.3, waist(0.9) + 0.004, 0.9], [0.3, waist(0.9) + 0.004, 0.9],
  ]
  b.quad('body', bonnet[0], bonnet[1], bonnet[2], bonnet[3], [0, 0, 1.2])

  // ── Tail: lamps each side, reversing lamps between, bumper ──
  for (const sx of [1, -1]) {
    b.box('tail', 0.34, 0.15, 0.04, sx * 0.52, 0.62, ZR - 0.01, ['front'])
    b.box('reverse', 0.12, 0.09, 0.03, sx * 0.24, 0.62, ZR - 0.02, ['front'])
  }
  b.box('black', W * 2 + 0.08, 0.15, 0.16, 0, sill + 0.06, ZR - 0.02)
  b.box('plate', 0.36, 0.1, 0.02, 0, 0.45, ZR - 0.01, ['front'])

  return b.build()
}
