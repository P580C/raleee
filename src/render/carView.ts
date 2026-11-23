/**
 * Milestone 1 grey-box car: coloured boxes in the reference palette.
 * Hierarchy: root (position + yaw) → body (suspension pitch/roll/heave) and wheels.
 */
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Vector3,
} from 'three'
import { clamp, lerp, lerpAngle } from '../sim/math'
import type { CarState } from '../sim/vehicle'
import { tuning as T } from '../tuning'

const SALMON = '#e2705c'
const CREAM = '#f2ebd9'
const GLASS = '#3f5a74'
const DARK = '#2c2d33'
const HUB = '#c9cfe6'

function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), new MeshLambertMaterial({ color, flatShading: true }))
  m.position.set(x, y, z)
  return m
}

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

  constructor() {
    const R = T.wheelRadius
    // Body (car faces +z, local +x is the car's left).
    this.body.add(box(1.68, 0.56, 3.8, SALMON, 0, 0.64, 0))
    this.body.add(box(1.5, 0.5, 1.95, GLASS, 0, 1.15, -0.3))
    this.body.add(box(1.54, 0.09, 1.9, CREAM, 0, 1.44, -0.35))
    this.body.add(box(1.76, 0.2, 0.2, DARK, 0, 0.42, 1.9))
    this.body.add(box(1.76, 0.2, 0.2, DARK, 0, 0.42, -1.9))
    this.body.add(box(0.3, 0.2, 0.06, CREAM, 0.52, 0.7, 1.91))
    this.body.add(box(0.3, 0.2, 0.06, CREAM, -0.52, 0.7, 1.91))
    this.body.add(box(0.3, 0.14, 0.06, '#b3332b', 0.55, 0.72, -1.91))
    this.body.add(box(0.3, 0.14, 0.06, '#b3332b', -0.55, 0.72, -1.91))
    this.root.add(this.body)

    const tyreGeo = new CylinderGeometry(R, R, 0.26, 12)
    tyreGeo.rotateZ(Math.PI / 2)
    const tyreMat = new MeshLambertMaterial({ color: DARK, flatShading: true })
    const hubGeo = new BoxGeometry(0.28, R * 1.1, 0.16)
    const hubMat = new MeshLambertMaterial({ color: HUB, flatShading: true })
    const halfTw = T.trackWidth / 2
    for (let w = 0; w < 4; w++) {
      const node = new Group()
      // sim wheel order FL, FR, RL, RR; car's left is local +x
      node.position.set(w & 1 ? -halfTw : halfTw, R, w < 2 ? T.cgToFront : -T.cgToRear)
      const steer = new Group()
      const spin = new Group()
      spin.add(new Mesh(tyreGeo, tyreMat))
      spin.add(new Mesh(hubGeo, hubMat))
      steer.add(spin)
      node.add(steer)
      this.root.add(node)
      this.wheelNodes.push(node)
      this.steerNodes.push(steer)
      this.spinNodes.push(spin)
    }

    this.shadowMat = new MeshBasicMaterial({ map: blobTexture(), transparent: true, opacity: 0.32, depthWrite: false, color: '#26303c' })
    const shadow = new Mesh(new PlaneGeometry(2.6, 4.8), this.shadowMat)
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

    this.body.position.y = sum * 0.25 + lerp(p.heave, c.heave, t)
    this.body.rotation.x = lerp(p.groundPitch, c.groundPitch, t) + lerp(p.pitch, c.pitch, t)
    this.body.rotation.z = lerp(p.groundRoll, c.groundRoll, t) + lerp(p.roll, c.roll, t)

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
