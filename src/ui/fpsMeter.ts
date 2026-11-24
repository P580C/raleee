/**
 * Frame-rate meter (shown with ?fps or ?debug): fps, average and worst frame time, CPU time spent in the
 * simulation and in render submission, and a scrolling frame-time graph with 60 fps and 30 fps lines.
 * Tap it to cycle the lighting presets, to see what the look costs on the device.
 */
const W = 150
const H = 44
const MAX_MS = 50

export class FpsMeter {
  private readonly el: HTMLDivElement
  private readonly text: HTMLDivElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly hist = new Float32Array(W)
  private head = 0
  private frames = 0
  private sum = 0
  private worst = 0
  private simSum = 0
  private renderSum = 0
  private acc = 0
  private label = ''

  constructor(parent: HTMLElement, onTap: () => string) {
    this.el = document.createElement('div')
    this.el.className = 'fps-meter'
    this.text = document.createElement('div')
    const canvas = document.createElement('canvas')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = W * dpr
    canvas.height = H * dpr
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    this.ctx = canvas.getContext('2d')!
    this.ctx.scale(dpr, dpr)
    this.el.append(this.text, canvas)
    parent.appendChild(this.el)
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      e.preventDefault()
      this.label = onTap()
    })
  }

  setLabel(label: string): void {
    this.label = label
  }

  /** Call once per frame with the real frame interval and the CPU time of the sim and render calls. */
  frame(frameMs: number, simMs: number, renderMs: number): void {
    this.hist[this.head] = frameMs
    this.head = (this.head + 1) % W
    this.frames++
    this.sum += frameMs
    this.simSum += simMs
    this.renderSum += renderMs
    if (frameMs > this.worst) this.worst = frameMs
    this.acc += frameMs
    if (this.acc < 500) return
    const avg = this.sum / this.frames
    this.text.textContent =
      `${(1000 / avg).toFixed(0)} fps  ${avg.toFixed(1)} ms  worst ${this.worst.toFixed(0)}\n` +
      `render ${(this.renderSum / this.frames).toFixed(1)}  sim ${(this.simSum / this.frames).toFixed(2)} ms\n` +
      `look: ${this.label}  (tap)`
    this.frames = 0
    this.sum = 0
    this.simSum = 0
    this.renderSum = 0
    this.worst = 0
    this.acc = 0
    this.draw()
  }

  private draw(): void {
    const g = this.ctx
    g.clearRect(0, 0, W, H)
    const y = (ms: number) => H - (Math.min(ms, MAX_MS) / MAX_MS) * H
    g.strokeStyle = 'rgba(255,255,255,0.35)'
    g.lineWidth = 1
    for (const ms of [1000 / 60, 1000 / 30]) {
      g.beginPath()
      g.moveTo(0, y(ms) + 0.5)
      g.lineTo(W, y(ms) + 0.5)
      g.stroke()
    }
    for (let i = 0; i < W; i++) {
      const ms = this.hist[(this.head + i) % W]
      if (!ms) continue
      g.fillStyle = ms > 34 ? '#e2564a' : ms > 18 ? '#efc94c' : '#7ed37a'
      g.fillRect(i, y(ms), 1, H - y(ms))
    }
  }
}
