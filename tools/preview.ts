/**
 * Model preview with the game's lighting and camera angle: /tools/preview.html?a=<glb>&b=<glb>&pitch=35
 * Draws model a (top row) and b (bottom row) at four turns, to check an import for holes.
 */
import { Box3, Group, Mesh, MeshStandardMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Lighting } from '../src/render/lighting'

const q = new URLSearchParams(location.search)
const W = 900
const H = 460
const r = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
r.setPixelRatio(1)
r.setSize(W, H)
document.body.appendChild(r.domElement)
const scene = new Scene()
const pitch = (Number(q.get('pitch') ?? 35) * Math.PI) / 180
const cam = new OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 1, 2000)
const yaw = Math.PI / 4
cam.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(500)
cam.lookAt(0, 0, 0)
cam.zoom = Number(q.get('zoom') ?? 22)
cam.updateProjectionMatrix()
const L = new Lighting(r, scene, cam)
L.resize(W, H)
const loader = new GLTFLoader()
const files = [q.get('a'), q.get('b')].filter(Boolean) as string[]
const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
Promise.all(files.map((f) => loader.loadAsync(f))).then((gltfs) => {
  gltfs.forEach((g, row) => {
    for (let k = 0; k < 4; k++) {
      const holder = new Group()
      const m = g.scene.clone()
      m.traverse((o) => {
        const mesh = o as Mesh
        if (mesh.isMesh) {
          mesh.castShadow = true
          ;(mesh.material as MeshStandardMaterial).side = 0
        }
      })
      const box = new Box3().setFromObject(m)
      const c = box.getCenter(new Vector3())
      m.position.sub(c)
      holder.add(m)
      holder.rotation.y = (k * Math.PI) / 2 + 0.4
      const sx = ((k - 1.5) * W) / 4 / cam.zoom
      const sy = ((0.5 - row) * H) / 2 / cam.zoom
      holder.position.copy(right).multiplyScalar(sx).addScaledVector(up, sy)
      scene.add(holder)
    }
  })
  L.update(0, 0, 0, 0, -1)
  L.render()
  let tris = 0
  scene.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3
  })
  document.title = 'done ' + tris
})
