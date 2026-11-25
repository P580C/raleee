/**
 * The scenery models the editor can place: public/models/scenery.json lists each LEGO model exported with
 * tools/import_lego.py (`--scenery "Name"` adds it to the list). Models load once and are shared.
 *
 *   { "id": "mound1", "name": "Mound", "file": "mound1.glb", "scale": 3, "collideAbove": 1.2 }
 *
 * `scale` multiplies the stud size (scenery can be built smaller than the car's scale); parts lower than
 * `collideAbove` metres (base plates, road markings) can be driven over.
 */
import { DirectionalLight, Group, HemisphereLight, Mesh, OrthographicCamera, Scene, WebGLRenderer } from 'three'
import { legoFootprint, loadLegoModel, type LegoModel } from './lego'

export interface SceneryDef {
  id: string
  name: string
  file: string
  scale: number
  collideAbove: number
}

const FALLBACK: SceneryDef[] = [{ id: 'mound1', name: 'Mound', file: 'mound1.glb', scale: 3, collideAbove: 1.2 }]

let catalog: Promise<SceneryDef[]> | null = null

export function loadCatalog(): Promise<SceneryDef[]> {
  catalog ??= fetch(`${import.meta.env.BASE_URL}models/scenery.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Partial<SceneryDef>[]>) : FALLBACK))
    .then((list) =>
      list
        .filter((d) => d.id && d.file)
        .map((d) => ({ id: d.id!, name: d.name ?? d.id!, file: d.file!, scale: d.scale ?? 1, collideAbove: d.collideAbove ?? 0.3 })),
    )
    .catch(() => FALLBACK)
  return catalog
}

export interface LoadedScenery {
  def: SceneryDef
  model: LegoModel
  /** Collision outline (local x, z, counter-clockwise) and height. */
  outline: Float64Array
  height: number
  /** Footprint radius (m), for picking and spacing. */
  radius: number
}

const loaded = new Map<string, Promise<LoadedScenery>>()

export function loadScenery(def: SceneryDef): Promise<LoadedScenery> {
  let p = loaded.get(def.id)
  if (!p) {
    p = loadLegoModel(`${import.meta.env.BASE_URL}models/${def.file}`, def.scale).then((model) => {
      const { outline, height } = legoFootprint(model, def.collideAbove)
      // Nothing tall enough to hit (a flat road marking, say): no outline.
      return { def, model, outline: outline.length >= 6 ? outline : new Float64Array(0), height, radius: Math.hypot(model.size.x, model.size.z) / 2 }
    })
    loaded.set(def.id, p)
  }
  return p
}

/** One placed copy as plain meshes (shared geometry and materials), for the editor. */
export function sceneryObject(s: LoadedScenery): Group {
  const g = new Group()
  for (const part of s.model.parts) {
    const m = new Mesh(part.geometry, part.material)
    m.castShadow = true
    m.receiveShadow = true
    g.add(m)
  }
  return g
}

let thumbRenderer: WebGLRenderer | null = null
const thumbs = new Map<string, Promise<string>>()

/** A small picture of the model from the game's camera angle, as a data URL. */
export function sceneryThumb(s: LoadedScenery): Promise<string> {
  let p = thumbs.get(s.def.id)
  if (!p) {
    p = Promise.resolve().then(() => {
      const size = 128
      thumbRenderer ??= new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
      thumbRenderer.setPixelRatio(1)
      thumbRenderer.setSize(size, size, false)
      const scene = new Scene()
      scene.add(new HemisphereLight('#ffffff', '#b9b6c8', 2.2))
      const sun = new DirectionalLight('#ffffff', 2.4)
      sun.position.set(-1, 2, 1.5)
      scene.add(sun)
      const obj = sceneryObject(s)
      scene.add(obj)
      const { x, y, z } = s.model.size
      const half = Math.max(x, z) * 0.62 + y * 0.2
      const cam = new OrthographicCamera(-half, half, half, -half, -1000, 1000)
      const yaw = Math.PI / 4
      const pitch = (35 * Math.PI) / 180
      cam.position.set(Math.sin(yaw) * Math.cos(pitch) * 100, y * 0.4 + Math.sin(pitch) * 100, Math.cos(yaw) * Math.cos(pitch) * 100)
      cam.lookAt(0, y * 0.4, 0)
      thumbRenderer.render(scene, cam)
      return thumbRenderer.domElement.toDataURL()
    })
    thumbs.set(s.def.id, p)
  }
  return p
}
