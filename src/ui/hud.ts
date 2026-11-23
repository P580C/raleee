/** Minimal race HUD for milestone 1: speed readout, restart button, fade overlay, perf overlay. */
export class Hud {
  private readonly speedEl: HTMLDivElement
  private readonly fadeEl: HTMLDivElement
  private readonly perfEl: HTMLDivElement | null
  private shownSpeed = -1

  // perf accumulators
  private frames = 0
  private sum = 0
  private max = 0
  private simSum = 0
  private acc = 0

  constructor(parent: HTMLElement, onRestart: () => void, debug: boolean) {
    const speed = document.createElement('div')
    speed.className = 'hud-speed'
    parent.appendChild(speed)
    this.speedEl = speed

    const restart = document.createElement('button')
    restart.className = 'hud-restart'
    restart.textContent = '↺'
    restart.setAttribute('aria-label', 'Restart')
    restart.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      e.preventDefault()
      onRestart()
    })
    parent.appendChild(restart)

    const fade = document.createElement('div')
    fade.className = 'fade'
    parent.appendChild(fade)
    this.fadeEl = fade

    if (debug) {
      const perf = document.createElement('div')
      perf.className = 'perf'
      parent.appendChild(perf)
      this.perfEl = perf
    } else this.perfEl = null
  }

  setSpeed(ms: number): void {
    const kmh = Math.round(ms * 3.6)
    if (kmh === this.shownSpeed) return
    this.shownSpeed = kmh
    this.speedEl.innerHTML = `${kmh}<span>km/h</span>`
  }

  setFade(opacity: number): void {
    this.fadeEl.style.opacity = opacity.toFixed(3)
  }

  /** frameMs: wall time since last frame. simMs: time spent stepping physics this frame. */
  perf(frameMs: number, simMs: number, extra: string): void {
    if (!this.perfEl) return
    this.frames++
    this.sum += frameMs
    this.simSum += simMs
    if (frameMs > this.max) this.max = frameMs
    this.acc += frameMs
    if (this.acc < 500) return
    const avg = this.sum / this.frames
    this.perfEl.textContent = `${(1000 / avg).toFixed(0)} fps  ${avg.toFixed(1)} ms avg  ${this.max.toFixed(1)} max  sim ${(this.simSum / this.frames).toFixed(2)} ms\n${extra}`
    this.frames = 0
    this.sum = 0
    this.max = 0
    this.simSum = 0
    this.acc = 0
  }
}
