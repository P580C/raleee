/**
 * How the weather looks: a dimmer sun and sky tint (via Lighting), rain streaks or snowflakes, and fog.
 *
 * Rain and snow are one instanced mesh each, drawn over the scene (no depth test: they fall between the
 * camera and the stage). Particles live in world space so they scroll past as the camera follows the car,
 * and wrap round the view in camera right/up axes, so a fixed pool covers the screen forever.
 *
 * Fog is a DOM overlay under the HUD: a radial gradient centred on the car, clear round it and 80% fog
 * colour (20% visibility) by the screen edges. It only moves by transform, so it's nearly free.
 */
import {
  type Camera,
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  type Mesh,
  type OrthographicCamera,
  type Scene,
  Quaternion,
  Vector3,
  BoxGeometry,
} from 'three'
import type { Track } from '../sim/track'
import type { TimeOfDay, Weather } from '../sim/weather'
import { buildSnowDrifts } from './snowDrifts'
import { BACKGROUND, type Lighting } from './lighting'

interface Look {
  /** Sun (and shadow, bounce) multiplier. */
  sun: number
  /** Floor / sky colour. */
  background: string
  /** Headlight glow, 0..1. */
  lights: number
  /** Headlight beams on the road: only when it's dark or murky (rain, fog; night when it's added). */
  beams: boolean
}

const LOOKS: Record<Weather, Look> = {
  clear: { sun: 1, background: BACKGROUND, lights: 0, beams: false },
  rain: { sun: 0.55, background: '#d9dbe4', lights: 0.8, beams: true },
  snow: { sun: 0.8, background: '#e6e9f1', lights: 0.6, beams: false },
  fog: { sun: 0.65, background: '#e4e4ea', lights: 1, beams: true },
}

/** Night: a dim blue moon, little sky fill, a dark floor (per weather), headlights full on with beams. */
const NIGHT = { sun: 0.14, ambient: 0.16, moon: '#8fa6ff' }
const NIGHT_BACKGROUND: Record<Weather, string> = {
  clear: '#121827',
  rain: '#10141f',
  snow: '#1a2133',
  fog: '#262d3b',
}

/**
 * Fog profile: opacity at fractions of the half-screen distance from the car (one layer: 20% visibility
 * at the edges), then thickened: N layers let through (1 - opacity)^N.
 */
const FOG_PROFILE: [number, number][] = [
  [0, 0],
  [0.22, 0],
  [0.42, 0.2],
  [0.62, 0.44],
  [0.82, 0.65],
  [1, 0.8],
]
const FOG_THICKNESS = 2

interface Precip {
  count: number
  /** Fall speed (m/s) and its random spread. */
  fall: number
  fallVar: number
  /** Gusting sideways sway (m/s) on top of the wind. */
  sway: number
  /** Wind (m/s, horizontal): rain falls straight, snow is blown. Direction is random per race. */
  wind: number
}

const RAIN: Precip = { count: 420, fall: 34, fallVar: 8, sway: 0, wind: 0 }
const SNOW: Precip = { count: 400, fall: 6.4, fallVar: 2.8, sway: 2.5, wind: 7 }
/** Extra margin round the view (m) so particles wrap off screen. */
const MARGIN = 3
/** Depth range (m) along the view direction the particles are spread through (only affects wrapping). */
const DEPTH = 30
/** At night, snow is only seen in the headlights: the flakes gather in a box this size (m) round the beams. */
const NIGHT_BOX = 15

const _m = new Matrix4()
const _q = new Quaternion()
const _s = new Vector3(1, 1, 1)
const _zero = new Vector3(0, 0, 0)
const _p = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _proj = new Vector3()

/**
 * The headlight beams on the ground (matches CarView's beam): a flake shows when the ground point it
 * sits over on screen is inside a beam. Returns 0..1, brightest near the lamps.
 */
export class BeamMask {
  x = 0
  y = 0
  z = 0
  fx = 0
  fz = 1
  /** Beam start (m ahead of the car's centre), length, and half-width at the near and far ends. */
  constructor(
    public nose = 4,
    readonly len = 18,
    readonly halfNear = 1.2,
    readonly halfFar = 4.5,
  ) {}

  set(pos: Vector3, heading: number): void {
    this.x = pos.x
    this.y = pos.y
    this.z = pos.z
    this.fx = Math.sin(heading)
    this.fz = Math.cos(heading)
  }

  /** Light on the ground point (gx, gz), 0..1. */
  at(gx: number, gz: number): number {
    const dx = gx - this.x
    const dz = gz - this.z
    const f = dx * this.fx + dz * this.fz - this.nose
    if (f < 0 || f > this.len) return 0
    const t = f / this.len
    const lat = Math.abs(dx * this.fz - dz * this.fx)
    const half = this.halfNear + (this.halfFar - this.halfNear) * t
    if (lat > half) return 0
    const side = 1 - (lat / half) ** 2
    const near = Math.min(1, f / 1.2)
    return side * near * (1 - t) ** 0.8
  }
}

class Particles {
  readonly mesh: InstancedMesh
  private readonly pos: Float32Array
  private readonly speed: Float32Array
  private readonly phase: Float32Array
  private seeded = false
  private time = 0
  private windX = 0
  private windZ = 0

  constructor(
    private readonly kind: Precip,
    geo: BoxGeometry | IcosahedronGeometry,
    color: string,
    opacity: number,
  ) {
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false })
    this.mesh = new InstancedMesh(geo, mat, kind.count)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 10
    this.mesh.visible = false
    this.pos = new Float32Array(kind.count * 3)
    this.speed = new Float32Array(kind.count)
    this.phase = new Float32Array(kind.count)
    for (let i = 0; i < kind.count; i++) {
      this.speed[i] = kind.fall + (Math.random() - 0.5) * 2 * kind.fallVar
      this.phase[i] = Math.random() * Math.PI * 2
    }
  }

  /** Scatter afresh, with a new wind direction. */
  reset(): void {
    this.seeded = false
    const a = Math.random() * Math.PI * 2
    this.windX = Math.cos(a) * this.kind.wind
    this.windZ = Math.sin(a) * this.kind.wind
  }

  /**
   * Move, wrap and place every particle. They wrap round the whole view, or with `mask` (night) round
   * the headlight beams only, and only the ones over a lit patch of ground are drawn, sized by the light.
   */
  update(dt: number, cam: OrthographicCamera, mask?: BeamMask): void {
    _right.setFromMatrixColumn(cam.matrixWorld, 0)
    _up.setFromMatrixColumn(cam.matrixWorld, 1)
    const cx = cam.position.x
    const cy = cam.position.y
    const cz = cam.position.z
    // Camera's forward (into the screen): the third basis column points back out.
    const bx = cam.matrixWorld.elements[8]
    const by = cam.matrixWorld.elements[9]
    const bz = cam.matrixWorld.elements[10]
    // Wrap region on screen: centre (ax, ay) relative to the camera, half extents (hw, hh).
    let ax = 0
    let ay = 0
    let hw = (cam.right - cam.left) / 2 + MARGIN
    let hh = (cam.top - cam.bottom) / 2 + MARGIN
    if (mask) {
      const mid = mask.nose + mask.len * 0.5
      const px = mask.x + mask.fx * mid - cx
      const py = mask.y - cy
      const pz = mask.z + mask.fz * mid - cz
      ax = px * _right.x + py * _right.y + pz * _right.z
      ay = px * _up.x + py * _up.y + pz * _up.z
      hw = hh = NIGHT_BOX
    }
    const P = this.pos
    const n = this.kind.count
    if (!this.seeded) {
      // Scatter over the region, some way in front of the camera.
      for (let i = 0; i < n; i++) {
        const sx = ax + (Math.random() * 2 - 1) * hw
        const sy = ay + (Math.random() * 2 - 1) * hh
        const d = 80 + Math.random() * DEPTH
        P[i * 3] = cx + _right.x * sx + _up.x * sy - bx * d
        P[i * 3 + 1] = cy + _right.y * sx + _up.y * sy - by * d
        P[i * 3 + 2] = cz + _right.z * sx + _up.z * sy - bz * d
      }
      this.seeded = true
    }
    this.time += dt
    const sway = this.kind.sway
    // Gusts: the wind swells and drops for everyone together.
    const gust = 0.7 + 0.3 * Math.sin(this.time * 0.9) + 0.15 * Math.sin(this.time * 2.3)
    const wx = this.windX * gust * dt
    const wz = this.windZ * gust * dt
    for (let i = 0; i < n; i++) {
      const k = i * 3
      let x = P[k] + wx
      let y = P[k + 1] - this.speed[i] * dt
      let z = P[k + 2] + wz
      if (sway > 0) {
        const w = Math.sin(this.time * 2.1 + this.phase[i]) * sway * dt
        x += _right.x * w
        z += _right.z * w
      }
      // Wrap round the region in screen axes.
      const dx = x - cx
      const dy = y - cy
      const dz = z - cz
      const sx = dx * _right.x + dy * _right.y + dz * _right.z - ax
      const sy = dx * _up.x + dy * _up.y + dz * _up.z - ay
      if (sx > hw) {
        x -= _right.x * 2 * hw
        y -= _right.y * 2 * hw
        z -= _right.z * 2 * hw
      } else if (sx < -hw) {
        x += _right.x * 2 * hw
        y += _right.y * 2 * hw
        z += _right.z * 2 * hw
      }
      if (sy > hh) {
        x -= _up.x * 2 * hh
        y -= _up.y * 2 * hh
        z -= _up.z * 2 * hh
      } else if (sy < -hh) {
        x += _up.x * 2 * hh
        y += _up.y * 2 * hh
        z += _up.z * 2 * hh
      }
      // Keep within the depth band (moving along the view axis doesn't move it on screen). Falling moves
      // them away from the camera; following the car up-screen brings them closer, past the near plane
      // if left alone. Wrap both ways.
      const sd = -((x - cx) * bx + (y - cy) * by + (z - cz) * bz)
      if (sd > 80 + DEPTH) {
        x += bx * DEPTH
        y += by * DEPTH
        z += bz * DEPTH
      } else if (sd < 80) {
        x -= bx * DEPTH
        y -= by * DEPTH
        z -= bz * DEPTH
      }
      P[k] = x
      P[k + 1] = y
      P[k + 2] = z
      _p.set(x, y, z)
      if (mask) {
        // The ground point this flake sits over on screen: along the view ray down to the car's height.
        const t = (mask.y - y) / -by
        const lit = mask.at(x - bx * t, z - bz * t)
        if (lit <= 0.02) {
          _m.compose(_p, _q, _zero)
        } else {
          const r = Math.sqrt(lit)
          _s.set(r, r, r)
          _m.compose(_p, _q, _s)
          _s.set(1, 1, 1)
        }
      } else _m.compose(_p, _q, _s)
      this.mesh.setMatrixAt(i, _m)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}

export class WeatherView {
  weather: Weather = 'clear'
  private readonly rain = new Particles(RAIN, new BoxGeometry(0.1, 2, 0.1), '#7f93bb', 0.6)
  private readonly snow = new Particles(SNOW, new IcosahedronGeometry(0.15, 0), '#ffffff', 0.95)
  private readonly fogEl: HTMLDivElement
  private width = 1
  private height = 1
  private track: Track | null = null
  night = false
  private background = BACKGROUND
  private drifts: Mesh | null = null

  constructor(
    private readonly scene: Scene,
    private readonly parent: HTMLElement,
    private readonly lighting: Lighting,
  ) {
    scene.add(this.rain.mesh, this.snow.mesh)
    this.fogEl = document.createElement('div')
    this.fogEl.className = 'fog'
    this.fogEl.style.display = 'none'
    parent.appendChild(this.fogEl)
  }

  /** Headlight strength for this weather (CarView.setLightLevel). */
  get lightLevel(): number {
    return this.night ? 1 : LOOKS[this.weather].lights
  }

  /** Whether the headlight beams show (CarView.setLightLevel). */
  get beams(): boolean {
    return this.night || LOOKS[this.weather].beams
  }

  /** A new stage: drop its snow drifts (rebuilt the first time it snows there). */
  setTrack(track: Track): void {
    this.track = track
    if (this.drifts) {
      this.scene.remove(this.drifts)
      this.drifts.geometry.dispose()
      this.drifts = null
    }
  }

  set(w: Weather, time: TimeOfDay = 'day'): void {
    this.weather = w
    this.night = time === 'night'
    const look = LOOKS[w]
    this.background = this.night ? NIGHT_BACKGROUND[w] : look.background
    if (this.night) this.lighting.setWeather(look.sun * NIGHT.sun, this.background, NIGHT.ambient, NIGHT.moon)
    else this.lighting.setWeather(look.sun, this.background)
    // Light HUD text on a dark night.
    this.parent.classList.toggle('night', this.night)
    if (w === 'snow' && !this.drifts && this.track) {
      this.drifts = buildSnowDrifts(this.track)
      this.lighting.prepareObject(this.drifts)
      this.scene.add(this.drifts)
    }
    if (this.drifts) this.drifts.visible = w === 'snow'
    this.rain.mesh.visible = w === 'rain'
    this.snow.mesh.visible = w === 'snow'
    this.rain.reset()
    this.snow.reset()
    this.fogEl.style.display = w === 'fog' ? 'block' : 'none'
    this.styleFog()
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.styleFog()
  }

  /** Where the headlight beams fall (from CarView): at night, snow is only seen in them. */
  readonly beamMask = new BeamMask()

  /** Per frame, after the camera moved. `focus` is the car (fog clears round it), `heading` its yaw. */
  update(dt: number, cam: OrthographicCamera, focus: Vector3, heading: number): void {
    this.beamMask.set(focus, heading)
    if (this.weather === 'rain') this.rain.update(dt, cam)
    else if (this.weather === 'snow') this.snow.update(dt, cam, this.night ? this.beamMask : undefined)
    else if (this.weather === 'fog') this.moveFog(cam, focus)
  }

  /** The fog layer is 4x the screen, centred on the car; its gradient reaches the edge colour one half-screen out. */
  private styleFog(): void {
    if (this.weather !== 'fog') return
    const c = new Color(this.background)
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`
    const s = this.fogEl.style
    s.width = `${this.width * 4}px`
    s.height = `${this.height * 4}px`
    const stops = FOG_PROFILE.map(([r, a]) => `rgba(${rgb},${(1 - (1 - a) ** FOG_THICKNESS).toFixed(3)}) ${r * 100}%`)
    s.background = `radial-gradient(ellipse ${this.width * 0.5}px ${this.height * 0.5}px at 50% 50%, ${stops.join(', ')})`
  }

  private moveFog(cam: Camera, focus: Vector3): void {
    _proj.copy(focus).project(cam)
    const x = (_proj.x * 0.5 + 0.5) * this.width - this.width * 2
    const y = (-_proj.y * 0.5 + 0.5) * this.height - this.height * 2
    this.fogEl.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`
  }
}
