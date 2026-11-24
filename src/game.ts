/**
 * Game rules around the car: stage timer and finish, auto-reset when stuck or fallen, restart, fades.
 * Runs inside the fixed-timestep loop (stepRules) and per frame (frame).
 */
import type { Track } from './sim/track'
import { CarState, placeCar, type Controls } from './sim/vehicle'

const FALL_RESET = 1.0
const STUCK_RESET = 1.5
const FADE_OUT = 0.22
const FADE_IN = 0.3

export type StageStatus = 'waiting' | 'running' | 'finished'

export class Game {
  fade = 0
  /** Waiting at the line until the first throttle; the clock runs until the finish line. */
  status: StageStatus = 'waiting'
  /** Stage time (s), advanced in fixed sim steps so it's frame-rate independent. */
  time = 0
  private fallT = 0
  private stuckT = 0
  private phase: 'drive' | 'out' | 'in' = 'drive'
  private pendingIdx = 0

  constructor(
    private readonly track: Track,
    private readonly prev: CarState,
    private readonly curr: CarState,
    private readonly onTeleport: () => void,
  ) {}

  restart(): void {
    this.status = 'waiting'
    this.time = 0
    this.teleport(this.track.startIdx)
    this.phase = 'in'
    this.fade = 0.6
  }

  /** Called every sim step, before stepCar. After the finish the car just rolls to a stop. */
  filterControls(c: Controls): void {
    if (this.status === 'finished') {
      c.throttle = 0
      c.handbrake = false
      c.brake = 0
    }
  }

  /** Called every sim step, after stepCar. */
  stepRules(c: Controls, dt: number): void {
    const s = this.curr
    if (this.status === 'waiting' && c.throttle > 0 && this.phase === 'drive') this.status = 'running'
    if (this.status === 'running') {
      this.time += dt
      if (s.trackS >= this.track.finishS && s.onIsland) this.status = 'finished'
    }
    if (this.phase !== 'drive') return
    this.fallT = !s.onIsland || s.y < s.groundY - 1.5 ? this.fallT + dt : 0
    this.stuckT = c.throttle > 0.5 && s.speed < 1.5 && s.grounded ? this.stuckT + dt : 0
    if (this.fallT > FALL_RESET || this.stuckT > STUCK_RESET || s.y < -40) {
      this.phase = 'out'
      this.pendingIdx = s.trackIdx
    }
  }

  /** Called every rendered frame with real elapsed time. */
  frame(dt: number): void {
    if (this.phase === 'out') {
      this.fade = Math.min(1, this.fade + dt / FADE_OUT)
      if (this.fade >= 1) {
        // Step back a few metres so we never respawn on a ramp lip.
        const n = this.track.n
        const idx = this.track.closed ? (this.pendingIdx - 4 + n) % n : Math.max(0, this.pendingIdx - 4)
        this.teleport(idx)
        this.phase = 'in'
      }
    } else if (this.phase === 'in') {
      this.fade = Math.max(0, this.fade - dt / FADE_IN)
      if (this.fade <= 0) this.phase = 'drive'
    }
  }

  private teleport(idx: number): void {
    placeCar(this.curr, this.track, idx)
    this.prev.copyFrom(this.curr)
    this.fallT = 0
    this.stuckT = 0
    this.onTeleport()
  }
}
