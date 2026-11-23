import { OrthographicCamera, Vector3 } from 'three'
import { tuning as T } from '../tuning'

const PITCH = (35 * Math.PI) / 180
const YAW = (45 * Math.PI) / 180
const DISTANCE = 200

/** World direction that points toward the bottom of the screen (on the ground plane). */
export const SCREEN_DOWN = new Vector3(Math.sin(YAW), 0, Math.cos(YAW))

/**
 * Orthographic camera at a fixed isometric-ish angle. It never rotates — it only
 * translates to follow the car, with smoothed look-ahead and optional shake.
 */
export class CameraRig {
  readonly camera: OrthographicCamera
  private readonly offset = new Vector3()
  private readonly focus = new Vector3()
  private readonly ahead = new Vector3()
  private readonly right = new Vector3()
  private readonly up = new Vector3()
  private trauma = 0
  private time = 0
  private width = 1
  private height = 1
  private view = 0
  shakeEnabled = true

  constructor() {
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 10, 600)
    this.offset.set(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH)).multiplyScalar(DISTANCE)
    this.camera.position.copy(this.offset)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateMatrixWorld()
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0)
    this.up.setFromMatrixColumn(this.camera.matrixWorld, 1)
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.view = T.camView
    const half = T.camView / 2
    const c = this.camera
    if (width < height) {
      c.left = -half
      c.right = half
      c.top = (half * height) / width
      c.bottom = -c.top
    } else {
      c.top = half
      c.bottom = -half
      c.right = (half * width) / height
      c.left = -c.right
    }
    c.updateProjectionMatrix()
  }

  /** Jump straight to the car (after a reset). */
  snap(x: number, y: number, z: number): void {
    this.ahead.set(0, 0, 0)
    this.focus.set(x, y, z).addScaledVector(SCREEN_DOWN, T.camDownBias)
    this.apply(0, 0)
  }

  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  update(dt: number, x: number, y: number, z: number, vx: number, vz: number): void {
    if (this.view !== T.camView) this.resize(this.width, this.height)
    this.time += dt

    // Look-ahead along velocity, smoothed slowly so drifts don't swing the view.
    let ax = vx * T.camLookAhead
    let az = vz * T.camLookAhead
    const len = Math.hypot(ax, az)
    if (len > T.camLookAheadMax) {
      ax *= T.camLookAheadMax / len
      az *= T.camLookAheadMax / len
    }
    const ka = 1 - Math.exp(-T.camAheadFollow * dt)
    this.ahead.x += (ax - this.ahead.x) * ka
    this.ahead.z += (az - this.ahead.z) * ka

    const tx = x + this.ahead.x + SCREEN_DOWN.x * T.camDownBias
    const tz = z + this.ahead.z + SCREEN_DOWN.z * T.camDownBias
    const kf = 1 - Math.exp(-T.camFollow * dt)
    this.focus.x += (tx - this.focus.x) * kf
    this.focus.z += (tz - this.focus.z) * kf
    this.focus.y += (y - this.focus.y) * (1 - Math.exp(-4 * dt))

    this.trauma = Math.max(0, this.trauma - 1.6 * dt)
    const amp = this.shakeEnabled ? this.trauma * this.trauma * 0.9 : 0
    const t = this.time
    this.apply(amp * (Math.sin(t * 37.1) + Math.sin(t * 23.7) * 0.5), amp * (Math.sin(t * 41.3 + 1.3) + Math.sin(t * 19.9) * 0.5))
  }

  private apply(sx: number, sy: number): void {
    this.camera.position
      .copy(this.focus)
      .add(this.offset)
      .addScaledVector(this.right, sx)
      .addScaledVector(this.up, sy)
  }
}
