/**
 * Colour calibration: renders a flat, sunlit patch with the game's real lighting and camera, and solves for
 * the material colour (or white + emissive, if albedo alone can't reach it) that shows a design colour on
 * screen. Open /tools/calibrate.html?c=53555e,e5f1f0 with the dev server running; results are in the tab title.
 * Re-run when the default look changes and paste the results into trackView.ts.
 */
import { Color, Mesh, PlaneGeometry, Scene, WebGLRenderer } from 'three'
import { CameraRig } from '../src/render/cameraRig'
import { Lighting } from '../src/render/lighting'
import { matte } from '../src/render/materials'
const r = new WebGLRenderer({ antialias: false }); r.setPixelRatio(1); r.setSize(200, 200); document.body.appendChild(r.domElement)
const scene = new Scene(); const rig = new CameraRig(); rig.resize(200, 200)
const L = new Lighting(r, scene, rig.camera); L.resize(200, 200)
const mat = matte({ color: '#ffffff', emissive: '#000000' })
const quad = new Mesh(new PlaneGeometry(400, 400), mat); quad.rotation.x = -Math.PI / 2; quad.receiveShadow = true; scene.add(quad)
rig.snap(0, 0, 0); rig.update(0.016, 0, 0, 0, 0, 0)
L.update(0, 0, 0, 0, -1)
const gl = r.getContext(); const buf = new Uint8Array(4)
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const out: string[] = []
for (const target of (new URLSearchParams(location.search).get('c') ?? '53555e,e5f1f0').split(',')) {
  const t = [0, 2, 4].map((i) => parseInt(target.slice(i, i + 2), 16))
  const c = new Color('#' + target) // linear working colour
  let got = [0, 0, 0]
  for (let it = 0; it < 12; it++) {
    mat.color.copy(c)
    L.render()
    gl.readPixels(100, 100, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    got = [buf[0], buf[1], buf[2]]
    const k = [0, 1, 2].map((j) => lin(t[j]) / Math.max(lin(got[j]), 1e-5))
    c.setRGB(Math.min(1, c.r * k[0]), Math.min(1, c.g * k[1]), Math.min(1, c.b * k[2]))
  }
  if (got.some((v, j) => Math.abs(v - t[j]) > 1)) {
    // Albedo maxed out: keep white and add emissive light until it reaches the target.
    mat.color.set('#ffffff')
    const e = new Color(0, 0, 0)
    for (let it = 0; it < 40; it++) {
      mat.emissive.copy(e)
      L.render()
      gl.readPixels(100, 100, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      got = [buf[0], buf[1], buf[2]]
      e.setRGB(Math.max(0, e.r + (lin(t[0]) - lin(got[0])) * 0.8), Math.max(0, e.g + (lin(t[1]) - lin(got[1])) * 0.8), Math.max(0, e.b + (lin(t[2]) - lin(got[2])) * 0.8))
    }
    out.push(`${target}=>white+emissive #${e.getHexString()} renders #${got.map((v) => v.toString(16).padStart(2, '0')).join('')}`)
    continue
  }
  out.push(`${target}=>#${c.getHexString()} renders #${got.map((v) => v.toString(16).padStart(2, '0')).join('')}`)
}
document.title = out.join(' ; ')
