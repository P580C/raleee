/**
 * The player's car: the procedural 4WD rally coupe from carModel.ts.
 * Hierarchy: root (position + yaw) → body (suspension pitch/roll/heave) and wheels.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three'
import { clamp, lerp, lerpAngle } from '../sim/math'
import type { CarState } from '../sim/vehicle'
import { tuning as T } from '../tuning'
import type { CarDef } from '../cars'
import { buildWheel } from './carModel'

/** Body shell is modelled at 1x and scaled up; wheel positions come from tuning (already at full size). */
const BODY_SCALE = 2
/** Ride height: the body sits this far (m) above its wheels' rest position, about 5% of the car's height. */
const RIDE_LIFT = 0.12

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

/** Soft round glow (white; tinted by the material). */
function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.18, 'rgba(255,255,255,0.75)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.22)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new CanvasTexture(c)
}

/** Opaque-pass draw order: everything else (0), then the headlight beams, then the car on top of them. */
const BEAM_ORDER = 5
const CAR_ORDER = 6

/** Length of the headlight beams on the ground (m). */
const BEAM_LEN = 18
/** Width of the beam pattern at its far end (m). */
const BEAM_W = 9

/**
 * Two headlight cones on the ground, fading with distance. Canvas top = the near end (at the lamps),
 * bottom = the far end. `lampX` are the beam origins as fractions of the texture width.
 */
function beamTexture(lampX: number[]): CanvasTexture {
  const w = 128
  const h = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.globalCompositeOperation = 'lighter'
  for (const fx of lampX) {
    const x0 = fx * w
    // Each cone spreads out to cover most of the far end.
    g.beginPath()
    g.moveTo(x0 - 3, 0)
    g.lineTo(x0 + 3, 0)
    g.lineTo(x0 + w * 0.42 + (fx - 0.5) * w * 0.3, h)
    g.lineTo(x0 - w * 0.42 + (fx - 0.5) * w * 0.3, h)
    g.closePath()
    const grad = g.createLinearGradient(0, 0, 0, h)
    // Fades in over the first metre or so (no hard edge where it meets the nose), then out with distance.
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.08, 'rgba(255,255,255,0.55)')
    grad.addColorStop(0.35, 'rgba(255,255,255,0.32)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fill()
  }
  // Soften the cone sides: fade the outer columns.
  g.globalCompositeOperation = 'destination-in'
  const side = g.createLinearGradient(0, 0, w, 0)
  side.addColorStop(0, 'rgba(0,0,0,0)')
  side.addColorStop(0.2, 'rgba(0,0,0,1)')
  side.addColorStop(0.8, 'rgba(0,0,0,1)')
  side.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = side
  g.fillRect(0, 0, w, h)
  return new CanvasTexture(c)
}

const GLOW = glowTexture()

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
  /** Lamp glows (fake bloom: soft sprites, no post pass) and the headlight beams. */
  private readonly headGlow: SpriteMaterial
  private readonly tailGlow: SpriteMaterial
  private readonly reverseGlow: SpriteMaterial
  private readonly beamMat: MeshBasicMaterial
  private readonly beamRoot = new Group()
  private lightLevel = 0.4
  private beams = false
  /** A real light from the headlamps, at night only (lights the road and scenery; no shadows). Toggling it
   *  recompiles the lit shaders once, which happens behind the race-start fade. */
  private readonly headLight: SpotLight
  /** Where the headlight beams start, metres ahead of the car's centre (for the night snow mask). */
  readonly beamStart: number
  /** Ground contact point under each wheel this frame (world), for tyre marks. FL, FR, RL, RR. */
  readonly wheelGround = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  /** How far a wheel may rise above its rest position relative to the body (m) before it would show through the arch. */
  private readonly archClear: number

  constructor(car: CarDef) {
    const R = T.wheelRadius
    this.archClear = car.archRise * BODY_SCALE - 0.08
    // Body (car faces +z, local +x is the car's left).
    const shell = car.buildShell(T.cgToFront / BODY_SCALE, -T.cgToRear / BODY_SCALE, R / BODY_SCALE)
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
      const spin = buildWheel(R, 0.26 * BODY_SCALE, left ? 1 : -1, car.wheel)
      steer.add(spin)
      node.add(steer)
      this.root.add(node)
      this.wheelNodes.push(node)
      this.steerNodes.push(steer)
      this.spinNodes.push(spin)
    }

    // Lamp glows: sprites on the body (so they pitch and roll with it), just in front of each lamp.
    // Additive for the white lamps; the red brake glow is a normal-blended halo, since adding red onto the
    // pale body and floor just washes out to white.
    const glowMat = (color: string, additive = true) =>
      new SpriteMaterial({
        map: GLOW,
        color,
        transparent: true,
        blending: additive ? AdditiveBlending : NormalBlending,
        depthWrite: false,
        toneMapped: false,
      })
    this.headGlow = glowMat('#fff1c8')
    this.tailGlow = glowMat('#ff2410', false)
    this.reverseGlow = glowMat('#ffffff')
    this.tailGlow.opacity = 0
    this.reverseGlow.opacity = 0
    for (const [lx, ly, lz, size] of car.lamps.head) {
      const s = new Sprite(this.headGlow)
      s.position.set(lx * BODY_SCALE, ly * BODY_SCALE, lz * BODY_SCALE + 0.15)
      s.scale.setScalar(1.5 * size)
      this.body.add(s)
    }
    for (const [lx, ly, lz] of car.lamps.tail) {
      const s = new Sprite(this.tailGlow)
      s.position.set(lx * BODY_SCALE, ly * BODY_SCALE, lz * BODY_SCALE - 0.15)
      s.scale.setScalar(2.4)
      this.body.add(s)
      // Reversing lamps sit inboard of the tail lamps.
      const r = new Sprite(this.reverseGlow)
      r.position.set(lx * BODY_SCALE * 0.5, ly * BODY_SCALE, lz * BODY_SCALE - 0.15)
      r.scale.setScalar(1.2)
      this.body.add(r)
    }

    // Headlight beams lying on the ground ahead, tilted with the ground under the car.
    const heads = car.lamps.head.filter((l) => l[3] >= 0.8)
    const lampX = heads.map((l) => 0.5 + (l[0] * BODY_SCALE) / BEAM_W)
    this.beamMat = new MeshBasicMaterial({
      map: beamTexture(lampX),
      color: '#fff1c8',
      // Drawn in the opaque pass (additive blending still applies) with no depth test, after the road and
      // scenery but before the car (render orders below): a road rising ahead (crests, ramps, camber) can't
      // hide the beams, and the car is drawn over them rather than under.
      transparent: false,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const beam = new Mesh(new PlaneGeometry(BEAM_W, BEAM_LEN), this.beamMat)
    // Flat on the ground: texture top (the near end) toward the car, texture left = local +x.
    beam.rotation.x = -Math.PI / 2
    const nose = Math.max(...car.lamps.head.map((l) => l[2])) * BODY_SCALE
    beam.position.set(0, 0.07, nose + BEAM_LEN / 2 - 0.2)
    this.beamStart = nose - 0.2
    beam.renderOrder = BEAM_ORDER
    this.beamRoot.add(beam)
    this.root.add(this.beamRoot)
    this.headLight = new SpotLight('#fff0cc', 260, 48, 0.62, 0.75, 1.3)
    this.headLight.position.set(0, 1.1, nose - 0.2)
    const aim = new Object3D()
    aim.position.set(0, 0, nose + 20)
    this.root.add(this.headLight, aim)
    this.headLight.target = aim
    this.headLight.visible = false
    this.setLightLevel(this.lightLevel, this.beams)
    // The car's own meshes draw after the beams.
    this.body.traverse((o) => {
      if ((o as Mesh).isMesh) o.renderOrder = CAR_ORDER
    })
    for (const n of this.wheelNodes) n.traverse((o) => ((o as Mesh).isMesh ? (o.renderOrder = CAR_ORDER) : 0))

    this.shadowMat = new MeshBasicMaterial({ map: blobTexture(), transparent: true, opacity: 0.32, depthWrite: false, color: '#26303c' })
    const shadow = new Mesh(new PlaneGeometry(2.7 * BODY_SCALE, 5 * BODY_SCALE), this.shadowMat)
    shadow.rotation.x = -Math.PI / 2
    shadow.renderOrder = 1
    this.shadowRoot.add(shadow)
  }

  /** Headlights: lamp glow strength 0..1, whether the beams show on the road (rain, fog, night), and
   *  whether they really light the scene (night). */
  setLightLevel(k: number, beams: boolean, night = false): void {
    this.lightLevel = k
    this.beams = beams
    this.headLight.visible = night
    this.headGlow.opacity = 0.35 + 0.55 * k
    this.beamMat.opacity = k
    this.beamRoot.visible = beams && k > 0.01
  }

  /** Free GPU geometry (materials are shared or cheap and left to the GC). */
  dispose(): void {
    this.root.traverse((o) => (o as Mesh).geometry?.dispose())
    this.shadowRoot.traverse((o) => (o as Mesh).geometry?.dispose())
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
    // Tail lamps glow faintly with the headlights on, fully under braking.
    this.tailGlow.opacity = 0.25 * this.lightLevel + 0.85 * lerp(p.brakeLamp, c.brakeLamp, t)
    this.reverseGlow.opacity = c.reversing ? 0.8 : 0
    this.beamRoot.rotation.x = lerp(p.groundPitch, c.groundPitch, t)

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
      const cap = R + by + n.x * srz - n.z * srx + this.archClear
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
