/**
 * Portrait touch controls.
 * Left thumb: steering (analogue drag strip, or two digital zones).
 * Right thumb: big GO button with HANDBRAKE just above-left so the thumb can roll between them.
 * One full-screen layer handles every pointer, so a thumb can slide from button to button.
 */
import { settings } from '../ui/settings'

interface Ptr {
  role: 'steer' | 'pad'
  anchorX: number
  x: number
  y: number
  /** 0 none, 1 GO, 2 HANDBRAKE */
  btn: number
  order: number
}

interface Circle {
  x: number
  y: number
  r: number
}

export class TouchControls {
  steer = 0
  go = false
  handbrake = false
  /** True once any touch has been seen (used to hide keyboard hints, etc). */
  active = false

  private readonly layer: HTMLDivElement
  private readonly goEl: HTMLDivElement
  private readonly hbEl: HTMLDivElement
  private readonly strip: HTMLDivElement
  private readonly knob: HTMLDivElement
  private readonly hint: HTMLDivElement
  private readonly ptrs = new Map<number, Ptr>()
  private goC: Circle = { x: 0, y: 0, r: 0 }
  private hbC: Circle = { x: 0, y: 0, r: 0 }
  private counter = 0

  constructor(parent: HTMLElement) {
    this.layer = el('div', 'touch-layer', parent)
    this.hint = el('div', 'steer-hint', this.layer)
    this.strip = el('div', 'steer-strip', this.layer)
    this.knob = el('div', 'steer-knob', this.strip)
    this.hbEl = el('div', 'btn btn-hb', this.layer)
    this.hbEl.textContent = 'BRAKE'
    this.goEl = el('div', 'btn btn-go', this.layer)
    this.goEl.textContent = 'GO'

    const l = this.layer
    l.addEventListener('pointerdown', (e) => this.down(e))
    l.addEventListener('pointermove', (e) => this.move(e))
    l.addEventListener('pointerup', (e) => this.up(e))
    l.addEventListener('pointercancel', (e) => this.up(e))
    l.addEventListener('lostpointercapture', (e) => this.up(e))
    window.addEventListener('resize', () => this.layout())
    window.addEventListener('blur', () => this.releaseAll())
    document.addEventListener('visibilitychange', () => this.releaseAll())
    this.layout()
    this.refreshMode()
  }

  /** Call after changing settings.steerMode. */
  refreshMode(): void {
    this.hint.textContent = settings.steerMode === 'drag' ? '◀  drag to steer  ▶' : '◀ left      right ▶'
    this.hint.classList.toggle('zones', settings.steerMode === 'zones')
    this.recompute()
  }

  private layout(): void {
    const circ = (e: HTMLElement, c: Circle) => {
      const r = e.getBoundingClientRect()
      c.x = r.left + r.width / 2
      c.y = r.top + r.height / 2
      c.r = r.width / 2
    }
    circ(this.goEl, this.goC)
    circ(this.hbEl, this.hbC)
  }

  private hitButton(x: number, y: number): number {
    const dg = Math.hypot(x - this.goC.x, y - this.goC.y) - this.goC.r
    const dh = Math.hypot(x - this.hbC.x, y - this.hbC.y) - this.hbC.r
    // Generous padding; when both are in reach pick the nearer edge.
    const pad = 22
    if (dg > pad && dh > pad) return 0
    return dg <= dh ? 1 : 2
  }

  private down(e: PointerEvent): void {
    e.preventDefault()
    this.active = true
    if (this.goC.r === 0) this.layout()
    const btn = this.hitButton(e.clientX, e.clientY)
    const role = btn !== 0 || e.clientX > window.innerWidth * 0.55 ? 'pad' : 'steer'
    this.ptrs.set(e.pointerId, { role, anchorX: e.clientX, x: e.clientX, y: e.clientY, btn, order: this.counter++ })
    try {
      this.layer.setPointerCapture(e.pointerId)
    } catch {
      /* not all browsers allow it */
    }
    this.recompute()
  }

  private move(e: PointerEvent): void {
    const p = this.ptrs.get(e.pointerId)
    if (!p) return
    e.preventDefault()
    p.x = e.clientX
    p.y = e.clientY
    if (p.role === 'pad') p.btn = this.hitButton(p.x, p.y)
    else if (settings.steerMode === 'drag') {
      // Drag the anchor along when pushing past full lock, so reversing responds immediately.
      const range = settings.dragRange
      if (p.x - p.anchorX > range) p.anchorX = p.x - range
      else if (p.anchorX - p.x > range) p.anchorX = p.x + range
    }
    this.recompute()
  }

  private up(e: PointerEvent): void {
    if (this.ptrs.delete(e.pointerId)) this.recompute()
  }

  private releaseAll(): void {
    this.ptrs.clear()
    this.recompute()
  }

  private recompute(): void {
    let steerP: Ptr | null = null
    let go = false
    let hb = false
    for (const p of this.ptrs.values()) {
      if (p.role === 'steer') {
        if (!steerP || p.order > steerP.order) steerP = p
      } else if (p.btn === 1) go = true
      else if (p.btn === 2) hb = true
    }
    this.go = go
    this.handbrake = hb
    this.goEl.classList.toggle('on', go)
    this.hbEl.classList.toggle('on', hb)

    if (!steerP) {
      this.steer = 0
      this.strip.style.display = 'none'
      this.hint.style.display = ''
      return
    }
    this.hint.style.display = 'none'
    if (settings.steerMode === 'drag') {
      const range = settings.dragRange
      let v = (steerP.x - steerP.anchorX) / range
      if (Math.abs(v) < 0.04) v = 0
      this.steer = Math.max(-1, Math.min(1, v))
      this.strip.style.display = 'block'
      this.strip.style.width = `${range * 2}px`
      this.strip.style.left = `${steerP.anchorX - range}px`
      this.strip.style.top = `${steerP.y - 6}px`
      this.knob.style.transform = `translateX(${range + this.steer * range - 22}px)`
    } else {
      this.steer = steerP.x < window.innerWidth * 0.275 ? -1 : 1
      this.strip.style.display = 'none'
    }
  }
}

function el(tag: 'div', cls: string, parent: HTMLElement): HTMLDivElement {
  const e = document.createElement(tag)
  e.className = cls
  parent.appendChild(e)
  return e
}
