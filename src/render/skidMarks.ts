/**
 * Tyre marks: each wheel lays a strip of dark quads on the ground while it slides, locks or spins, with
 * darkness from the sim's skid strength. All marks live in one ring-buffer mesh (oldest overwritten first)
 * and only the quads written this frame are uploaded. No allocation per frame.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicMaterial, type Vector3 } from 'three'

const MAX_QUADS = 4096
/** Mark width (m): the tyre's tread. */
const WIDTH = 0.5
/** Length of each laid segment (m). */
const STEP = 0.4
/** Below this skid strength nothing is laid (and the strip breaks). */
const MIN_SKID = 0.08
/** Darkest mark opacity. */
const MAX_ALPHA = 0.8
/** Marks float just above the road surface. */
const LIFT = 0.06

interface Trail {
  active: boolean
  x: number
  y: number
  z: number
  a: number
}

export class SkidMarks {
  readonly mesh: Mesh
  private readonly pos: BufferAttribute
  private readonly col: BufferAttribute
  private head = 0
  private count = 0
  private readonly trails: Trail[] = []

  constructor() {
    const geo = new BufferGeometry()
    this.pos = new BufferAttribute(new Float32Array(MAX_QUADS * 6 * 3), 3)
    this.col = new BufferAttribute(new Float32Array(MAX_QUADS * 6 * 4), 4)
    this.pos.setUsage(DynamicDrawUsage)
    this.col.setUsage(DynamicDrawUsage)
    geo.setAttribute('position', this.pos)
    geo.setAttribute('color', this.col)
    geo.setDrawRange(0, 0)
    const mat = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: DoubleSide, // strips wind either way depending on direction of travel
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    this.mesh = new Mesh(geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
    for (let w = 0; w < 4; w++) this.trails.push({ active: false, x: 0, y: 0, z: 0, a: 0 })
  }

  /** Remove every mark (new run). */
  clear(): void {
    this.head = 0
    this.count = 0
    this.mesh.geometry.setDrawRange(0, 0)
    this.breakAll()
  }

  /** End all strips without removing marks (car teleported). */
  breakAll(): void {
    for (const t of this.trails) t.active = false
  }

  /** Call once per frame with each wheel's ground point and skid strengths (front, rear axles). */
  update(ground: Vector3[], skidF: number, skidR: number): void {
    for (let w = 0; w < 4; w++) this.lay(w, ground[w], w < 2 ? skidF : skidR)
  }

  private vert(i: number, x: number, y: number, z: number, alpha: number): void {
    const P = this.pos.array as Float32Array
    const C = this.col.array as Float32Array
    P[i * 3] = x
    P[i * 3 + 1] = y
    P[i * 3 + 2] = z
    C[i * 4] = 0.02
    C[i * 4 + 1] = 0.02
    C[i * 4 + 2] = 0.03
    C[i * 4 + 3] = alpha
  }

  private lay(w: number, p: Vector3, skid: number): void {
    const t = this.trails[w]
    if (skid < MIN_SKID) {
      t.active = false
      return
    }
    const a = Math.min(1, skid) * MAX_ALPHA
    if (!t.active) {
      t.active = true
      t.x = p.x
      t.y = p.y
      t.z = p.z
      t.a = 0 // strips fade in from nothing
      return
    }
    const dx = p.x - t.x
    const dz = p.z - t.z
    const d = Math.hypot(dx, dz)
    if (d < STEP) return
    if (d > 6) {
      // Jumped (reset or teleport): start a new strip here.
      t.x = p.x
      t.y = p.y
      t.z = p.z
      t.a = 0
      return
    }
    const hx = (-dz / d) * WIDTH * 0.5
    const hz = (dx / d) * WIDTH * 0.5
    const q = this.head
    const y0 = t.y + LIFT
    const y1 = p.y + LIFT
    // Two triangles: (a0, b0, b1), (a0, b1, a1). a = left edge, b = right edge; 0 = last point, 1 = now.
    this.vert(q * 6, t.x + hx, y0, t.z + hz, t.a)
    this.vert(q * 6 + 1, t.x - hx, y0, t.z - hz, t.a)
    this.vert(q * 6 + 2, p.x - hx, y1, p.z - hz, a)
    this.vert(q * 6 + 3, t.x + hx, y0, t.z + hz, t.a)
    this.vert(q * 6 + 4, p.x - hx, y1, p.z - hz, a)
    this.vert(q * 6 + 5, p.x + hx, y1, p.z + hz, a)
    this.pos.addUpdateRange(q * 18, 18)
    this.col.addUpdateRange(q * 24, 24)
    this.pos.needsUpdate = true
    this.col.needsUpdate = true
    this.head = (q + 1) % MAX_QUADS
    this.count = Math.min(this.count + 1, MAX_QUADS)
    this.mesh.geometry.setDrawRange(0, this.count * 6)
    t.x = p.x
    t.y = p.y
    t.z = p.z
    t.a = a
  }
}
