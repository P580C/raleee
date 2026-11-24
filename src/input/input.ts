import type { Controls } from '../sim/vehicle'
import { TouchControls } from './touch'

/** Merges keyboard and touch into one Controls object (reused, never reallocated). */
export class Input {
  readonly controls: Controls = { throttle: 0, steer: 0, handbrake: false, brake: 0 }
  readonly touch: TouchControls | null
  private readonly keys = new Set<string>()
  private restart = false

  constructor(parent: HTMLElement) {
    const coarse =
      window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || new URLSearchParams(location.search).has('touch')
    this.touch = coarse ? new TouchControls(parent) : null

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
      if (e.code === 'KeyR' && !e.repeat) this.restart = true
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
  }

  requestRestart(): void {
    this.restart = true
  }

  /** Returns true once per restart request. */
  consumeRestart(): boolean {
    const r = this.restart
    this.restart = false
    return r
  }

  update(): Controls {
    const k = this.keys
    const c = this.controls
    let steer = 0
    if (k.has('ArrowLeft') || k.has('KeyA')) steer -= 1
    if (k.has('ArrowRight') || k.has('KeyD')) steer += 1
    let throttle = k.has('ArrowUp') || k.has('KeyW') ? 1 : 0
    const brake = k.has('ArrowDown') || k.has('KeyS') ? 1 : 0
    let hb = k.has('Space')
    const t = this.touch
    if (t) {
      if (t.steer !== 0) steer = t.steer
      if (t.go) throttle = 1
      if (t.handbrake) hb = true
    }
    c.steer = Math.max(-1, Math.min(1, steer))
    c.brake = brake
    c.throttle = brake > 0 ? 0 : throttle
    c.handbrake = hb
    return c
  }
}
