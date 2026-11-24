/**
 * LEGO models imported with tools/import_lego.py (GLB, 1 unit = 1 stud). Scenery is drawn instanced: one
 * InstancedMesh per primitive (opaque / transparent), so any number of copies costs a couple of draw calls.
 */
import { Box3, type BufferGeometry, Group, InstancedMesh, type Material, Matrix4, type Mesh, type MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { convexHull } from '../sim/obstacles'
import { plasticMapped } from './materials'

/** Metres per LEGO stud in the game world. The road is 14 m wide (17.5 studs at 0.8). Tune with the car. */
export const STUD = 0.8

export interface LegoModel {
  parts: { geometry: BufferGeometry; material: Material }[]
  /** Footprint size in metres after scaling (x, y, z). */
  size: Vector3
}

const loader = new GLTFLoader()

/**
 * Load a scenery GLB: its "body" is baked into geometry scaled to metres, standing on y = 0 and centred on
 * its footprint, with the palette texture moved onto the game's plastic material. `scale` multiplies the
 * stud size for this model only (scenery can be built smaller than the car's scale).
 */
export async function loadLegoModel(url: string, scale = 1): Promise<LegoModel> {
  const k = STUD * scale
  const gltf = await loader.loadAsync(url)
  gltf.scene.updateMatrixWorld(true)
  const meshes: Mesh[] = []
  gltf.scene.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh && (m.userData.role ?? m.parent?.userData.role) !== 'wheel') meshes.push(m)
  })
  const box = new Box3()
  for (const m of meshes) box.expandByObject(m)
  const centre = box.getCenter(new Vector3())
  const shift = new Matrix4().makeScale(k, k, k).multiply(new Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z))
  const parts = meshes.map((m) => {
    const geometry = m.geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(shift, m.matrixWorld))
    const src = m.material as MeshStandardMaterial
    return { geometry, material: plasticMapped(src.map!, src.transparent) as Material }
  })
  return { parts, size: box.getSize(new Vector3()).multiplyScalar(k) }
}

/**
 * Ground outline for collisions: the convex hull (x, z) of every vertex higher than `minHeight` above the
 * model's base, so thin base plates you can drive over don't count. Returns the outline and the model height.
 */
export function legoFootprint(model: LegoModel, minHeight: number): { outline: Float64Array; height: number } {
  const xz: number[] = []
  let height = 0
  for (const part of model.parts) {
    const p = part.geometry.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i)
      height = Math.max(height, y)
      if (y > minHeight) xz.push(p.getX(i), p.getZ(i))
    }
  }
  return { outline: xz.length >= 6 ? convexHull(xz) : new Float64Array(0), height }
}

/** Instances of a model at (x, y, z, yaw) placements. */
export function instanceLego(model: LegoModel, placements: number[]): Group {
  const g = new Group()
  const count = placements.length / 4
  const m4 = new Matrix4()
  const q = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const pos = new Vector3()
  const one = new Vector3(1, 1, 1)
  for (const part of model.parts) {
    const im = new InstancedMesh(part.geometry, part.material, count)
    for (let i = 0; i < count; i++) {
      q.setFromAxisAngle(up, placements[i * 4 + 3])
      pos.set(placements[i * 4], placements[i * 4 + 1], placements[i * 4 + 2])
      im.setMatrixAt(i, m4.compose(pos, q, one))
    }
    im.castShadow = true
    im.receiveShadow = true
    im.computeBoundingSphere()
    g.add(im)
  }
  return g
}
