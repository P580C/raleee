/**
 * Dust kicked up by the driven tyres on loose ground (gravel, grass, off the road). Low-poly puffs in one
 * instanced mesh, recycled from a fixed pool (oldest first). Puffs are opaque and flat-shaded like the
 * world: they swell, drift back and up, then shrink away instead of fading, so there's no transparency
 * sorting or overdraw. Purely visual: driven by the sim's per-wheel `dust` amounts. No allocation per frame.
 */
import { Color, DynamicDrawUsage, IcosahedronGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import type { CarState } from '../sim/vehicle'
import { tuning as T } from '../tuning'
import { matte } from './materials'

const MAX = 192
/** Puffs per second from one wheel at full dust. */
const RATE = 34
/** Lifetime range (s). */
const LIFE_MIN = 0.55
const LIFE_MAX = 1.3
/** Full-grown puff radius range (m). */
const SIZE_MIN = 0.8
const SIZE_MAX = 1.5
/** Velocity damping per second (air drag on the dust). */
const DRAG = 2.6
/** Upward drift (m/s²): dust hangs and rises a little. */
const LIFT = 0.8

const GRAVEL_DUST = new Color('#e0c49c')
const GRASS_DUST = new Color('#c9c597')

const UP = new Vector3(0, 1, 0)
const ZERO = new Matrix4().makeScale(0, 0, 0)

export class Dust {
  readonly mesh: InstancedMesh
  private readonly px = new Float32Array(MAX)
  private readonly py = new Float32Array(MAX)
  private readonly pz = new Float32Array(MAX)
  private readonly vx = new Float32Array(MAX)
  private readonly vy = new Float32Array(MAX)
  private readonly vz = new Float32Array(MAX)
  private readonly age = new Float32Array(MAX)
  private readonly life = new Float32Array(MAX)
  private readonly size = new Float32Array(MAX)
  private readonly spin = new Float32Array(MAX)
  private readonly carry = new Float32Array(4)
  private head = 0
  private alive = 0
  private readonly m = new Matrix4()
  private readonly q = new Quaternion()
  private readonly p = new Vector3()
  private readonly s = new Vector3()
  private readonly c = new Color()

  constructor() {
    const geo = new IcosahedronGeometry(1, 0)
    this.mesh = new InstancedMesh(geo, matte({ roughness: 1 }), MAX)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.receiveShadow = true
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, ZERO)
      this.mesh.setColorAt(i, GRAVEL_DUST)
      this.life[i] = 1
      this.age[i] = 1
    }
    this.mesh.instanceColor!.setUsage(DynamicDrawUsage)
    this.mesh.visible = false
  }

  clear(): void {
    for (let i = 0; i < MAX; i++) {
      this.age[i] = this.life[i]
      this.mesh.setMatrixAt(i, ZERO)
    }
    this.carry.fill(0)
    this.alive = 0
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.visible = false
  }

  /**
   * Call once per frame: spawn from each wheel's ground point (render-interpolated) by the sim's dust
   * amounts, then move and resize every live puff.
   */
  update(dt: number, ground: Vector3[], car: CarState): void {
    const fx = Math.sin(car.heading)
    const fz = Math.cos(car.heading)
    const rate = RATE * T.dustAmount
    let spawned = false
    for (let w = 0; w < 4; w++) {
      const d = car.dust[w]
      if (d <= 0.02 || rate <= 0) {
        this.carry[w] = 0
        continue
      }
      this.carry[w] += d * rate * dt
      while (this.carry[w] >= 1) {
        this.carry[w] -= 1
        this.spawn(ground[w], car, fx, fz, d, car.wheelGrass[w], w & 1 ? 1 : -1)
        spawned = true
      }
    }
    if (!spawned && this.alive === 0) return

    const damp = Math.exp(-DRAG * dt)
    let alive = 0
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= this.life[i]) continue
      this.age[i] += dt
      if (this.age[i] >= this.life[i]) {
        this.mesh.setMatrixAt(i, ZERO)
        continue
      }
      alive++
      this.vx[i] *= damp
      this.vz[i] *= damp
      this.vy[i] = this.vy[i] * damp + LIFT * dt
      this.px[i] += this.vx[i] * dt
      this.py[i] += this.vy[i] * dt
      this.pz[i] += this.vz[i] * dt
      const t = this.age[i] / this.life[i]
      // Pop in quickly, keep swelling, shrink away at the end.
      const grow = Math.min(1, t / 0.12)
      const r = this.size[i] * grow * (0.55 + 0.6 * t) * (1 - t * t * t)
      this.p.set(this.px[i], this.py[i], this.pz[i])
      this.q.setFromAxisAngle(UP, this.spin[i] + t * 1.5)
      this.s.set(r, r * 0.8, r)
      this.m.compose(this.p, this.q, this.s)
      this.mesh.setMatrixAt(i, this.m)
    }
    this.alive = alive
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.visible = alive > 0
  }

  private spawn(at: Vector3, car: CarState, fx: number, fz: number, d: number, grass: number, side: number): void {
    const i = this.head
    this.head = (this.head + 1) % MAX
    // Thrown back off the tyre and a little outward, carried partly along with the car.
    const kick = 2 + 4 * d
    const out = (0.3 + Math.random() * 1.2) * side
    const jitter = () => (Math.random() - 0.5) * 2.4
    this.px[i] = at.x + jitter() * 0.3
    this.py[i] = at.y + 0.15
    this.pz[i] = at.z + jitter() * 0.3
    this.vx[i] = car.vx * 0.3 - fx * kick - fz * out + jitter()
    this.vz[i] = car.vz * 0.3 - fz * kick + fx * out + jitter()
    this.vy[i] = 0.8 + Math.random() * 1.6 * d
    this.age[i] = 0
    this.life[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN)
    this.size[i] = (SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN)) * (0.6 + 0.4 * d)
    this.spin[i] = Math.random() * Math.PI * 2
    this.c.copy(GRAVEL_DUST).lerp(GRASS_DUST, grass)
    this.mesh.setColorAt(i, this.c)
    this.mesh.instanceColor!.needsUpdate = true
  }
}
