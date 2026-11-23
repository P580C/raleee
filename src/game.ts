/**
 * Game rules around the car: auto-reset when stuck or fallen, restart, fades, events.
 * Runs inside the fixed-timestep loop (stepRules) and per frame (frame).
 */
import type { Track } from './sim/track'
import { CarState, placeCar, type Controls } from './sim/vehicle'

const FALL_RESET = 1.0
const STUCK_RESET = 1.5
const FADE_OUT = 0.22
const FADE_IN = 0.3

export class Game {
  fade = 0
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
    this.teleport(this.track.startIdx)
    this.phase = 'in'
    this.fade = 0.6
  }

  /** Called every sim step. */
  stepRules(c: Controls, dt: number): void {
    const s = this.curr
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
