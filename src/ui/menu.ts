/**
 * Title menu: pick a stage and a car, then RACE (or open the track editor). The 3D scene stays live
 * behind it, showing the chosen car on the chosen stage's start line.
 */
import { CARS, type CarDef } from '../cars'
import { listTracks, trackDataOf, isPieceTrack, type TrackEntry } from '../tracks/registry'
import { Track, type TrackData } from '../sim/track'

export interface MenuActions {
  selectTrack(id: string): void
  selectCar(id: string): void
  race(): void
  /** Open the editor on a stage (null = a new one). */
  edit(trackId: string | null): void
}

const ISO = Math.SQRT1_2
const SIN_PITCH = Math.sin((35 * Math.PI) / 180)

/** Track outline as the game camera sees it: screen x = along (1, 0, -1), screen y = down the screen. */
function drawThumb(canvas: HTMLCanvasElement, data: TrackData): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = canvas.clientWidth || 110
  const h = canvas.clientHeight || 120
  canvas.width = w * dpr
  canvas.height = h * dpr
  const g = canvas.getContext('2d')!
  g.scale(dpr, dpr)
  const pts = data.points.map((p) => [(p.x - p.z) * ISO, (p.x + p.z) * ISO * SIN_PITCH - p.e * 0.8])
  // Skip most of the lead-in (piece stages start 200 m back) so the stage itself fills the card.
  const startAt = data.start ? Math.max(0, Math.floor((data.start - 30) / 4)) : 0
  const view = pts.slice(Math.min(startAt, pts.length - 2))
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const [x, y] of view) {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  const pad = 10
  const k = Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0))
  const ox = (w - (x1 - x0) * k) / 2 - x0 * k
  const oy = (h - (y1 - y0) * k) / 2 - y0 * k
  const path = () => {
    g.beginPath()
    view.forEach(([x, y], i) => (i ? g.lineTo(x * k + ox, y * k + oy) : g.moveTo(x * k + ox, y * k + oy)))
  }
  g.lineJoin = 'round'
  g.lineCap = 'round'
  path()
  g.strokeStyle = '#ffffff'
  g.lineWidth = 7
  g.stroke()
  path()
  g.strokeStyle = '#53555e'
  g.lineWidth = 4.5
  g.stroke()
  const [sx, sy] = view[0]
  g.fillStyle = '#e0563f'
  g.beginPath()
  g.arc(sx * k + ox, sy * k + oy, 3.5, 0, Math.PI * 2)
  g.fill()
}

function trackLength(data: TrackData): number {
  const t = new Track(data)
  return t.finishS - t.ps[t.startIdx]
}

/** Side view of a car in its colours (tiny inline SVG). */
function carSvg(car: CarDef): string {
  const [body, top, trim] = car.swatch
  return `<svg viewBox="0 0 120 52" aria-hidden="true">
    <path d="M8 34 L10 24 L30 20 L44 8 L84 8 L98 20 L112 22 L114 34 Z" fill="${body}"/>
    <path d="M46 10 L82 10 L94 20 L36 20 Z" fill="#4f7595"/>
    <path d="M44 8 L84 8 L86 11 L42 11 Z" fill="${top}"/>
    <rect x="8" y="30" width="106" height="5" fill="${top}"/>
    <rect x="12" y="25" width="98" height="2.5" fill="${trim}"/>
    <rect x="4" y="33" width="14" height="5" rx="1" fill="#2c2d33"/>
    <rect x="104" y="33" width="14" height="5" rx="1" fill="#2c2d33"/>
    <circle cx="30" cy="38" r="9" fill="#2c2d33"/><circle cx="30" cy="38" r="4.5" fill="#f3f3ef"/>
    <circle cx="92" cy="38" r="9" fill="#2c2d33"/><circle cx="92" cy="38" r="4.5" fill="#f3f3ef"/>
  </svg>`
}

function bars(n: number): string {
  let s = ''
  for (let i = 0; i < 5; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`
  return s
}

export class Menu {
  readonly el: HTMLDivElement
  private readonly tracksEl: HTMLDivElement
  private readonly carsEl: HTMLDivElement
  private readonly editBtn: HTMLButtonElement
  private trackId = ''
  private carId = ''

  constructor(parent: HTMLElement, private readonly act: MenuActions) {
    const el = document.createElement('div')
    el.className = 'menu'
    el.innerHTML = `
      <div class="menu-logo"><b>RALEEE</b><span class="stripes"><i></i><i></i><i></i></span></div>
      <div class="menu-panel">
        <h3>STAGE</h3>
        <div class="menu-row menu-tracks"></div>
        <h3>CAR</h3>
        <div class="menu-row menu-cars"></div>
        <div class="menu-actions">
          <button class="menu-edit">EDIT</button>
          <button class="menu-race">RACE</button>
        </div>
      </div>`
    parent.appendChild(el)
    this.el = el
    this.tracksEl = el.querySelector('.menu-tracks')!
    this.carsEl = el.querySelector('.menu-cars')!
    this.editBtn = el.querySelector('.menu-edit')!
    el.querySelector('.menu-race')!.addEventListener('click', () => act.race())
    this.editBtn.addEventListener('click', () => {
      const t = listTracks().find((x) => x.id === this.trackId)
      act.edit(t && isPieceTrack(t.source) ? t.id : null)
    })
    // The menu scrolls sideways on touch: let it, despite the page-wide gesture block.
    el.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true })
  }

  show(trackId: string, carId: string): void {
    this.trackId = trackId
    this.carId = carId
    this.el.style.display = ''
    this.renderTracks()
    this.renderCars()
  }

  hide(): void {
    this.el.style.display = 'none'
  }

  get visible(): boolean {
    return this.el.style.display !== 'none'
  }

  private renderTracks(): void {
    const list = listTracks()
    this.tracksEl.innerHTML = ''
    const card = (t: TrackEntry) => {
      const c = document.createElement('button')
      c.className = 'card track-card' + (t.id === this.trackId ? ' sel' : '')
      const data = trackDataOf(t)
      c.innerHTML = `<canvas></canvas><b>${escapeHtml(t.name)}</b><small>${(trackLength(data) / 1000).toFixed(1)} km${t.builtIn ? '' : ' · MINE'}</small>`
      c.addEventListener('click', () => {
        this.trackId = t.id
        this.act.selectTrack(t.id)
        this.renderTracks()
      })
      this.tracksEl.appendChild(c)
      requestAnimationFrame(() => drawThumb(c.querySelector('canvas')!, data))
    }
    list.forEach(card)
    const add = document.createElement('button')
    add.className = 'card track-card add'
    add.innerHTML = `<span>+</span><b>NEW STAGE</b><small>track editor</small>`
    add.addEventListener('click', () => this.act.edit(null))
    this.tracksEl.appendChild(add)
    const sel = list.find((x) => x.id === this.trackId)
    this.editBtn.textContent = sel && isPieceTrack(sel.source) ? (sel.builtIn ? 'COPY & EDIT' : 'EDIT') : 'NEW STAGE'
  }

  private renderCars(): void {
    this.carsEl.innerHTML = ''
    for (const car of CARS) {
      const c = document.createElement('button')
      c.className = 'card car-card' + (car.id === this.carId ? ' sel' : '')
      c.innerHTML = `${carSvg(car)}<b>${car.name}</b><small>${car.blurb}</small>
        <div class="stats"><span>POWER</span>${bars(car.stats.power)}<span>GRIP</span>${bars(car.stats.grip)}<span>DRIFT</span>${bars(car.stats.drift)}</div>`
      c.addEventListener('click', () => {
        this.carId = car.id
        this.act.selectCar(car.id)
        this.renderCars()
      })
      this.carsEl.appendChild(c)
    }
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
