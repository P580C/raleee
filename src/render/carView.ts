/**
 * The player's car: the procedural 4WD rally coupe from carModel.ts.
 * Hierarchy: root (position + yaw) → body (suspension pitch/roll/heave) and wheels.
 */
import { CanvasTexture, Group, Mesh, MeshBasicMaterial, type MeshStandardMaterial, PlaneGeometry, Vector3 } from 'three'
import { clamp, lerp, lerpAngle } from '../sim/math'
import type { CarState } from '../sim/vehicle'
import { tuning as T } from '../tuning'
import { ARCH_RISE, buildCarShell, buildWheel } from './carModel'

/** Body shell is modelled at 1x and scaled up; wheel positions come from tuning (already at full size). */
const BODY_SCALE = 2
/** Ride height: the body sits this far (m) above its wheels' rest position, about 5% of the car's height. */
const RIDE_LIFT = 0.12
/** How far a wheel may rise above its rest position relative to the body (m) before it would show through the arch. */
const ARCH_CLEAR = ARCH_RISE * BODY_SCALE - 0.08

function blobTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32)
  grad.addColorStop(0, 'rgba(0,0,0,1)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new CanvasTexture(c)
}

export class CarView {
  readonly root = new Group()
  readonly body = new Group()
  readonly shadowRoot = new Group()
  /** Interpolated position this frame (for the camera). */
  readonly pos = new Vector3()
  private readonly wheelNodes: Group[] = []
  private readonly steerNodes: Group[] = []
  private readonly spinNodes: Group[] = []
  private readonly shadowMat: MeshBasicMaterial
  private readonly brakeMat: MeshStandardMaterial | null
  private readonly reverseMat: MeshStandardMaterial | null
  /** Ground contact point under each wheel this frame (world), for tyre marks. FL, FR, RL, RR. */
  readonly wheelGround = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]

  constructor() {
    const R = T.wheelRadius
    // Body (car faces +z, local +x is the car's left).
    const shell = buildCarShell(T.cgToFront / BODY_SCALE, -T.cgToRear / BODY_SCALE, R / BODY_SCALE)
    shell.scale.setScalar(BODY_SCALE)
    this.brakeMat = ((shell.getObjectByName('tail') as Mesh | undefined)?.material as MeshStandardMaterial) ?? null
    this.reverseMat = ((shell.getObjectByName('reverse') as Mesh | undefined)?.material as MeshStandardMaterial) ?? null
    this.body.add(shell)
    this.root.add(this.body)

    const halfTw = T.trackWidth / 2
    for (let w = 0; w < 4; w++) {
      const node = new Group()
      // sim wheel order FL, FR, RL, RR; car's left is local +x
      const left = (w & 1) === 0
      node.position.set(left ? halfTw : -halfTw, R, w < 2 ? T.cgToFront : -T.cgToRear)
      const steer = new Group()
      const spin = buildWheel(R, 0.26 * BODY_SCALE, left ? 1 : -1)
      steer.add(spin)
      node.add(steer)
      this.root.add(node)
      this.wheelNodes.push(node)
      this.steerNodes.push(steer)
      this.spinNodes.push(spin)
    }

    this.shadowMat = new MeshBasicMaterial({ map: blobTexture(), transparent: true, opacity: 0.32, depthWrite: false, color: '#26303c' })
    const shadow = new Mesh(new PlaneGeometry(2.7 * BODY_SCALE, 5 * BODY_SCALE), this.shadowMat)
    shadow.rotation.x = -Math.PI / 2
    shadow.renderOrder = 1
    this.shadowRoot.add(shadow)
  }

  update(p: CarState, c: CarState, t: number): void {
    const x = lerp(p.x, c.x, t)
    const y = lerp(p.y, c.y, t)
    const z = lerp(p.z, c.z, t)
    const heading = lerpAngle(p.heading, c.heading, t)
    this.pos.set(x, y, z)
    this.root.position.set(x, y, z)
    this.root.rotation.y = heading

    const R = T.wheelRadius
    const travel = T.suspTravel
    let sum = 0
    for (let w = 0; w < 4; w++) {
      const local = clamp(lerp(p.wheelH[w], c.wheelH[w], t) - y, -travel, travel)
      sum += local
      this.wheelNodes[w].position.y = R + local
    }
    const steer = lerp(p.steerAngle, c.steerAngle, t)
    this.steerNodes[0].rotation.y = -steer
    this.steerNodes[1].rotation.y = -steer
    const sf = lerpAngle(p.spinFront, c.spinFront, t)
    const sr = lerpAngle(p.spinRear, c.spinRear, t)
    this.spinNodes[0].rotation.x = sf
    this.spinNodes[1].rotation.x = sf
    this.spinNodes[2].rotation.x = sr
    this.spinNodes[3].rotation.x = sr

    // Lamps: brake lamps glow with the footbrake, white reversing lamps in reverse.
    if (this.brakeMat) this.brakeMat.emissiveIntensity = 1.3 * lerp(p.brakeLamp, c.brakeLamp, t)
    if (this.reverseMat) this.reverseMat.emissiveIntensity = c.reversing ? 1.2 : 0

    // Where each tyre touches the ground (for skid marks).
    const ch = Math.cos(heading)
    const sh = Math.sin(heading)
    for (let w = 0; w < 4; w++) {
      const n = this.wheelNodes[w].position
      this.wheelGround[w].set(x + n.x * ch + n.z * sh, lerp(p.wheelH[w], c.wheelH[w], t), z - n.x * sh + n.z * ch)
    }

    const by = RIDE_LIFT + sum * 0.25 + lerp(p.heave, c.heave, t)
    const rx = lerp(p.groundPitch, c.groundPitch, t) + lerp(p.pitch, c.pitch, t)
    const rz = lerp(p.groundRoll, c.groundRoll, t) + lerp(p.roll, c.roll, t)
    this.body.position.y = by
    this.body.rotation.x = rx
    this.body.rotation.z = rz
    // Keep each tyre inside its arch on full bump: the arch above a wheel at (wx, wz) sits at about
    // by + wx*sin(roll) - wz*sin(pitch); the wheel may rise at most ARCH_CLEAR above its rest height there.
    const srz = Math.sin(rz)
    const srx = Math.sin(rx)
    for (let w = 0; w < 4; w++) {
      const n = this.wheelNodes[w].position
      const cap = R + by + n.x * srz - n.z * srx + ARCH_CLEAR
      if (n.y > cap) n.y = cap
    }

    const gy = c.groundY > -Infinity ? c.groundY : y - 50
    const h = Math.max(0, y - gy)
    this.shadowRoot.visible = c.groundY > -Infinity
    this.shadowRoot.position.set(x, gy + 0.06, z)
    this.shadowRoot.rotation.y = heading
    const sc = 1 + h * 0.12
    this.shadowRoot.scale.set(sc, 1, sc)
    this.shadowMat.opacity = 0.32 / (1 + h * 0.5)
  }
}
