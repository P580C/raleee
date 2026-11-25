/**
 * Stage editor: lay slot-car style pieces end to end, seen through the game's own isometric camera.
 *
 * Tap a piece in the bottom bar to add it after the selected piece (the arrow shows where it goes). Tap the
 * road to select a piece, then change its surface or level, flip its turn, or delete it. Drag to pan, pinch
 * or scroll to zoom. Every change is saved to the player's stages straight away.
 */
import { ConeGeometry, Group, Mesh, MeshBasicMaterial, Plane, Raycaster, Vector2, Vector3, type Scene } from 'three'
import type { CameraRig } from '../render/cameraRig'
import { SCREEN_UP } from '../render/cameraRig'
import type { Lighting } from '../render/lighting'
import { buildRoadOverlay, buildTrackView, disposeGroup } from '../render/trackView'
import {
  findOverlaps,
  layoutPieces,
  LEVEL,
  pieceAt,
  PIECE_KINDS,
  PIECES,
  piecesToTrackData,
  type Piece,
  type PieceKind,
  type PieceLayout,
  type PieceTrackData,
  type Turn,
} from '../sim/pieces'
import { makeGroundSample, SURFACES, Track, type SurfaceName } from '../sim/track'
import { deleteUserTrack, findTrack, isPieceTrack, listTracks, saveUserTrack } from '../tracks/registry'
import { escapeHtml } from '../ui/menu'

export interface EditorHost {
  scene: Scene
  rig: CameraRig
  lighting: Lighting
  canvas: HTMLCanvasElement
  /** Leave the editor (back to the menu); `trackId` is the stage being edited, if it was saved. */
  exit(trackId: string | null): void
  /** Test-drive the stage. */
  test(trackId: string): void
}

const ISO = Math.SQRT1_2
const SIN_PITCH = Math.sin((35 * Math.PI) / 180)
const SEL_COLOR = '#efe27c'
const BAD_COLOR = '#e0563f'

/** Bottom-bar icon: the piece's centreline as seen from above, entering from the bottom. */
function pieceIcon(kind: PieceKind, turn: Turn): string {
  const spec = PIECES[kind]
  let d: string
  if (kind === 'roundabout') {
    const exit = turn === 'L' ? 'M12 20 L1 20' : turn === 'R' ? 'M32 20 L43 20' : 'M22 10 L22 1'
    d = `M22 43 L22 30 M32 20 A10 10 0 1 0 12 20 A10 10 0 1 0 32 20 ${exit}`
  } else if (spec.angle === 0) d = 'M22 40 L22 6'
  else {
    const r = kind === 'small90' ? 11 : kind === 'bend90' ? 19 : 27
    const th = (spec.angle * Math.PI) / 180
    const s = turn === 'L' ? 1 : -1
    const x0 = 22 + s * (spec.angle === 90 ? r / 2 : 6)
    const y0 = 40
    const x1 = x0 - s * r * (1 - Math.cos(th))
    const y1 = y0 - r * Math.sin(th)
    d = `M${x0} ${y0} A${r} ${r} 0 0 ${turn === 'L' ? 0 : 1} ${x1.toFixed(1)} ${y1.toFixed(1)}`
  }
  return `<svg viewBox="0 0 44 44" aria-hidden="true"><path d="${d}" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="butt"/><path d="${d}" fill="none" stroke="#53555e" stroke-width="7"/></svg>`
}

/** Resolve inherited surfaces so every piece carries its own (editing one piece then changes only it). */
function explicitSurfaces(pieces: Piece[]): Piece[] {
  let cur: SurfaceName = 'tarmac'
  return pieces.map((p) => {
    cur = p.surface ?? cur
    return { ...p, surface: cur }
  })
}

function newStageName(): string {
  const mine = listTracks().filter((t) => !t.builtIn).length
  return `My Stage ${mine + 1}`
}

export class Editor {
  readonly focus = new Vector3()
  private readonly el: HTMLDivElement
  private readonly nameEl: HTMLInputElement
  private readonly infoEl: HTMLDivElement
  private readonly piecesEl: HTMLDivElement
  private readonly attrsEl: HTMLDivElement
  private readonly moreEl: HTMLDivElement
  private readonly group = new Group()
  private readonly marker: Mesh
  private data: PieceTrackData = { format: 'pieces', name: '', heading: 225, pieces: [] }
  private id: string | null = null
  private sel = -1
  /** Turn toggle: L / R, or S (straight on, roundabouts only). */
  private turn: Turn = 'L'
  /** The last L / R picked: what new bends use while the toggle is on S. */
  private bendTurn: 'L' | 'R' = 'L'
  private surface: SurfaceName = 'tarmac'
  private track: Track | null = null
  private layout: PieceLayout | null = null
  private overlaps = new Set<number>()
  private undoStack: string[] = []
  private zoom = 0.3
  private active = false
  private readonly ptrs = new Map<number, { x: number; y: number; sx: number; sy: number }>()
  private pinch = 0
  private readonly ray = new Raycaster()
  private readonly ndc = new Vector2()
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0)
  private readonly hit = new Vector3()
  private readonly gs = makeGroundSample()

  constructor(
    parent: HTMLElement,
    private readonly host: EditorHost,
  ) {
    const el = document.createElement('div')
    el.className = 'ed'
    el.style.display = 'none'
    el.innerHTML = `
      <div class="ed-top">
        <button data-a="back">◀ MENU</button>
        <input class="ed-name" maxlength="24" spellcheck="false" />
        <button data-a="test" class="hot">DRIVE ▶</button>
      </div>
      <div class="ed-tools">
        <button data-a="undo">UNDO</button>
        <button data-a="del">DELETE</button>
        <button data-a="fit">FIT</button>
        <button data-a="rotate">ROTATE ⟳</button>
        <button data-a="more">•••</button>
      </div>
      <div class="ed-more" style="display:none">
        <button data-a="new">NEW STAGE</button>
        <button data-a="export">COPY JSON</button>
        <button data-a="import">PASTE JSON</button>
        <button data-a="remove" class="danger">DELETE STAGE</button>
      </div>
      <div class="ed-info"></div>
      <div class="ed-bottom">
        <div class="ed-attrs"></div>
        <div class="ed-pieces"></div>
      </div>`
    parent.appendChild(el)
    this.el = el
    this.nameEl = el.querySelector('.ed-name')!
    this.infoEl = el.querySelector('.ed-info')!
    this.piecesEl = el.querySelector('.ed-pieces')!
    this.attrsEl = el.querySelector('.ed-attrs')!
    this.moreEl = el.querySelector('.ed-more')!

    el.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('button[data-a]') as HTMLButtonElement | null
      if (b) this.action(b.dataset.a!, b.dataset.v)
    })
    this.nameEl.addEventListener('input', () => {
      this.data.name = this.nameEl.value.trim() || 'Untitled'
      this.persist()
    })
    // The piece bar scrolls sideways on touch.
    el.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true })

    this.marker = new Mesh(new ConeGeometry(2.2, 5, 4), new MeshBasicMaterial({ color: BAD_COLOR, depthTest: false, transparent: true, opacity: 0.9 }))
    this.marker.renderOrder = 5

    const c = host.canvas
    c.addEventListener('pointerdown', (e) => this.down(e))
    c.addEventListener('pointermove', (e) => this.move(e))
    c.addEventListener('pointerup', (e) => this.up(e))
    c.addEventListener('pointercancel', (e) => this.up(e))
    c.addEventListener('wheel', (e) => {
      if (!this.active) return
      e.preventDefault()
      this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015))
    }, { passive: false })
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.target instanceof HTMLInputElement) return
      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) this.action('undo')
      else if (e.key === 'Delete' || e.key === 'Backspace') this.action('del')
    })
  }

  get isOpen(): boolean {
    return this.active
  }

  /** Open on a stage: one of the player's (edited in place), a built-in piece stage (edited as a copy), or new. */
  open(trackId: string | null): void {
    const entry = trackId ? findTrack(trackId) : undefined
    if (entry && isPieceTrack(entry.source)) {
      const src = entry.source
      this.data = { ...src, name: entry.builtIn ? `${src.name} copy` : src.name, pieces: explicitSurfaces(src.pieces) }
      this.id = entry.builtIn ? null : entry.id
    } else {
      this.data = { format: 'pieces', name: newStageName(), heading: 225, pieces: [] }
      this.id = null
    }
    this.sel = this.data.pieces.length - 1
    this.surface = this.data.pieces.at(-1)?.surface ?? 'tarmac'
    this.undoStack = []
    this.nameEl.value = this.data.name
    this.active = true
    this.el.style.display = ''
    this.moreEl.style.display = 'none'
    this.host.scene.add(this.group)
    // Zoomed out, the stage spans far more depth than the race camera's near/far planes allow.
    const cam = this.host.rig.camera
    cam.near = -3000
    cam.far = 3000
    cam.updateProjectionMatrix()
    this.rebuild()
    this.fit()
  }

  close(): void {
    this.active = false
    this.el.style.display = 'none'
    this.host.scene.remove(this.group)
    this.clearGroup()
    const cam = this.host.rig.camera
    cam.zoom = 1
    cam.near = 10
    cam.far = 600
    cam.updateProjectionMatrix()
  }

  /** Per frame: hold the camera on the editor's focus point. */
  update(): void {
    const cam = this.host.rig.camera
    if (cam.zoom !== this.zoom) {
      cam.zoom = this.zoom
      cam.updateProjectionMatrix()
    }
    this.host.rig.snap(this.focus.x, this.focus.y, this.focus.z)
  }

  // ── Editing ──────────────────────────────────────────

  private action(a: string, v?: string): void {
    switch (a) {
      case 'back':
        this.host.exit(this.id)
        return
      case 'test':
        if (!this.data.pieces.length) {
          this.flash('Add some pieces first')
          return
        }
        this.persist()
        this.host.test(this.id!)
        return
      case 'piece':
        this.change(() => {
          const kind = v as PieceKind
          const p: Piece = { k: kind, surface: this.surface }
          if (kind === 'roundabout') p.t = this.turn
          else if (PIECES[kind].angle) p.t = this.bendTurn
          this.data.pieces.splice(this.sel + 1, 0, p)
          this.sel++
        })
        return
      case 'turn':
        this.turn = v as Turn
        if (v !== 'S') this.bendTurn = v as 'L' | 'R'
        if (this.selPiece?.k === 'roundabout') this.change(() => (this.selPiece!.t = this.turn))
        else if (this.selPiece && PIECES[this.selPiece.k].angle && v !== 'S') this.change(() => (this.selPiece!.t = this.turn))
        else this.renderBar()
        return
      case 'surface':
        this.surface = v as SurfaceName
        if (this.selPiece) this.change(() => (this.selPiece!.surface = this.surface))
        else this.renderBar()
        return
      case 'level':
        if (!this.selPiece) {
          this.flash('Select a piece to ramp it')
          return
        }
        if (this.selPiece.k === 'roundabout') {
          this.flash('Roundabouts stay level')
          return
        }
        this.change(() => {
          const rise = Number(v) * LEVEL
          if (rise) this.selPiece!.rise = rise
          else delete this.selPiece!.rise
        })
        return
      case 'del':
        if (this.sel < 0) return
        this.change(() => {
          this.data.pieces.splice(this.sel, 1)
          this.sel = Math.min(this.sel, this.data.pieces.length) - 1
          if (this.sel < 0 && this.data.pieces.length) this.sel = 0
        })
        return
      case 'undo': {
        const prev = this.undoStack.pop()
        if (!prev) return
        const st = JSON.parse(prev) as { data: PieceTrackData; sel: number }
        this.data = st.data
        this.sel = st.sel
        this.nameEl.value = this.data.name
        this.persist()
        this.rebuild()
        return
      }
      case 'fit':
        this.fit()
        return
      case 'rotate':
        this.change(() => (this.data.heading = (this.data.heading + 45) % 360))
        this.fit()
        return
      case 'more':
        this.moreEl.style.display = this.moreEl.style.display === 'none' ? '' : 'none'
        return
      case 'new':
        this.moreEl.style.display = 'none'
        this.open(null)
        return
      case 'export': {
        this.moreEl.style.display = 'none'
        const json = JSON.stringify(this.data)
        navigator.clipboard?.writeText(json).then(
          () => this.flash('Stage copied as JSON'),
          () => window.prompt('Copy this stage:', json),
        ) ?? window.prompt('Copy this stage:', json)
        return
      }
      case 'import': {
        this.moreEl.style.display = 'none'
        const raw = window.prompt('Paste a stage (JSON):')
        if (!raw) return
        try {
          const d = JSON.parse(raw) as PieceTrackData
          if (d.format !== 'pieces' || !Array.isArray(d.pieces) || d.pieces.some((p) => !PIECES[p.k])) throw new Error('not a stage')
          this.change(() => {
            this.data = { format: 'pieces', name: d.name || 'Imported', heading: Number(d.heading) || 225, pieces: explicitSurfaces(d.pieces) }
            this.sel = this.data.pieces.length - 1
          })
          this.nameEl.value = this.data.name
          this.fit()
        } catch {
          this.flash("That isn't a stage")
        }
        return
      }
      case 'remove':
        this.moreEl.style.display = 'none'
        if (this.id && window.confirm(`Delete "${this.data.name}"?`)) {
          deleteUserTrack(this.id)
          this.id = null
          this.host.exit(null)
        } else if (!this.id) this.host.exit(null)
        return
    }
  }

  private get selPiece(): Piece | null {
    return this.data.pieces[this.sel] ?? null
  }

  /** Apply an edit with undo, save and redraw. */
  private change(fn: () => void): void {
    this.undoStack.push(JSON.stringify({ data: this.data, sel: this.sel }))
    if (this.undoStack.length > 200) this.undoStack.shift()
    fn()
    this.persist()
    this.rebuild()
  }

  /** Save to the player's stages (once it has a piece). */
  private persist(): void {
    if (!this.data.pieces.length && !this.id) return
    this.id = saveUserTrack(this.id, this.data)
  }

  // ── Drawing ──────────────────────────────────────────

  private clearGroup(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c)
      if (c !== this.marker) disposeGroup(c)
    }
  }

  private rebuild(): void {
    this.clearGroup()
    const td = piecesToTrackData(this.data)
    this.track = new Track(td)
    this.layout = layoutPieces(this.data)
    this.overlaps = findOverlaps(this.layout, td.width)
    const view = buildTrackView(this.track)
    this.host.lighting.prepareObject(view)
    this.group.add(view)
    const idx = (s: number) => {
      const ps = this.track!.ps
      let lo = 0
      let hi = ps.length - 1
      while (lo < hi) {
        const m = (lo + hi) >> 1
        if (ps[m] < s) lo = m + 1
        else hi = m
      }
      return lo
    }
    const span = (i: number) => [idx(this.layout!.pieceS[i]), idx(this.layout!.pieceS[i + 1])] as const
    for (const i of this.overlaps) {
      const [a, b] = span(i)
      this.group.add(buildRoadOverlay(this.track, a, b, BAD_COLOR, 0.55))
    }
    if (this.sel >= 0 && this.sel < this.data.pieces.length) {
      const [a, b] = span(this.sel)
      this.group.add(buildRoadOverlay(this.track, a, b, SEL_COLOR, 0.5, 1.12))
    }
    // Arrow where the next piece will go.
    const at = this.sel >= 0 ? this.layout.ends[this.sel] : this.layout.start
    const h = (at.deg * Math.PI) / 180
    this.marker.position.set(at.x + Math.sin(h) * 3, at.e + 2, at.z + Math.cos(h) * 3)
    this.marker.rotation.set(0, 0, 0)
    this.marker.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(Math.sin(h), 0, Math.cos(h)))
    this.group.add(this.marker)
    this.renderBar()
  }

  private renderBar(): void {
    const sp = this.selPiece
    const turnBtn = (t: Turn, label: string) => `<button data-a="turn" data-v="${t}" class="${this.turn === t ? 'on' : ''}">${label}</button>`
    this.piecesEl.innerHTML =
      `<div class="ed-turn">${turnBtn('L', '◀ L')}${turnBtn('S', '▲')}${turnBtn('R', 'R ▶')}</div>` +
      PIECE_KINDS.map(
        (k) =>
          `<button data-a="piece" data-v="${k}" class="ed-piece">${pieceIcon(k, k === 'roundabout' ? this.turn : this.bendTurn)}<span>${PIECES[k].label}</span></button>`,
      ).join('')
    const surf = sp?.surface ?? this.surface
    const rise = sp?.rise ?? 0
    this.attrsEl.innerHTML =
      `<div class="ed-chips">${SURFACES.map((s) => `<button data-a="surface" data-v="${s}" class="chip s-${s} ${surf === s ? 'on' : ''}">${s.toUpperCase()}</button>`).join('')}</div>` +
      `<div class="ed-chips">${[
        [-1, '▼ DOWN'],
        [0, 'LEVEL'],
        [1, '▲ UP'],
      ]
        .map(([v, l]) => `<button data-a="level" data-v="${v}" class="chip ${sp && Math.sign(rise) === v ? 'on' : ''}" ${sp && sp.k !== 'roundabout' ? '' : 'disabled'}>${l}</button>`)
        .join('')}</div>`
    const len = this.layout ? this.layout.pieceS.at(-1)! - this.layout.pieceS[0] : 0
    const exitName = { L: 'exit left', R: 'exit right', S: 'straight on' }
    const what = sp
      ? `${PIECES[sp.k].label}${sp.t ? ` ${sp.k === 'roundabout' ? exitName[sp.t] : sp.t}` : ''} selected (#${this.sel + 1})`
      : 'Start line selected'
    this.infoEl.innerHTML =
      `<b>${this.data.pieces.length}</b> pieces · <b>${(len / 1000).toFixed(2)}</b> km · ${escapeHtml(what)}` +
      (this.overlaps.size ? ` · <span class="warn">${this.overlaps.size} overlapping</span>` : '')
  }

  private flashTimer = 0

  private flash(msg: string): void {
    this.infoEl.innerHTML = `<span class="warn">${escapeHtml(msg)}</span>`
    clearTimeout(this.flashTimer)
    this.flashTimer = window.setTimeout(() => this.renderBar(), 1800)
  }

  // ── Camera ───────────────────────────────────────────

  private setZoom(z: number): void {
    this.zoom = Math.max(0.06, Math.min(2.5, z))
  }

  /** World metres per screen pixel at the current zoom. */
  private worldPerPx(): number {
    const cam = this.host.rig.camera
    return (cam.right - cam.left) / cam.zoom / this.host.canvas.clientWidth
  }

  /** Frame the whole stage (from just before the start line). */
  private fit(): void {
    const L = this.layout
    if (!L) return
    const pts: number[] = []
    for (const g of L.piecePts) pts.push(...g)
    // Start line and the last bit of lead-in, plus the run-out.
    pts.push(L.start.x, L.start.z, 0, ...L.leadPts.slice(-30), ...L.runPts)
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (let i = 0; i < pts.length; i += 3) {
      const sx = (pts[i] - pts[i + 1]) * ISO
      const sy = (pts[i] + pts[i + 1]) * ISO
      x0 = Math.min(x0, sx)
      x1 = Math.max(x1, sx)
      y0 = Math.min(y0, sy)
      y1 = Math.max(y1, sy)
    }
    const cam = this.host.rig.camera
    const w = cam.right - cam.left
    const h = cam.top - cam.bottom
    // Leave room for the bars at the top and bottom of the screen.
    const z = Math.min(w / ((x1 - x0) + 40), (h * 0.6) / ((y1 - y0) * SIN_PITCH + 40))
    this.setZoom(z)
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    // Nudge down the screen a little: the bottom bar is taller than the top one.
    const nudge = (h / this.zoom) * 0.06 / SIN_PITCH
    this.focus.set((cx + cy) / (2 * ISO) - SCREEN_UP.x * nudge, 0, (cy - cx) / (2 * ISO) - SCREEN_UP.z * nudge)
  }

  private pan(dx: number, dy: number): void {
    const k = this.worldPerPx()
    // Screen right is (1, 0, -1)/√2 on the ground; screen down is -SCREEN_UP, foreshortened by sin(pitch).
    this.focus.x -= ISO * dx * k
    this.focus.z -= -ISO * dx * k
    this.focus.x += (SCREEN_UP.x * dy * k) / SIN_PITCH
    this.focus.z += (SCREEN_UP.z * dy * k) / SIN_PITCH
  }

  // ── Pointer ──────────────────────────────────────────

  private down(e: PointerEvent): void {
    if (!this.active) return
    this.host.canvas.setPointerCapture(e.pointerId)
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY })
    if (this.ptrs.size === 2) this.pinch = this.pinchDist()
  }

  private move(e: PointerEvent): void {
    const p = this.ptrs.get(e.pointerId)
    if (!this.active || !p) return
    if (this.ptrs.size === 1) this.pan(e.clientX - p.x, e.clientY - p.y)
    p.x = e.clientX
    p.y = e.clientY
    if (this.ptrs.size === 2) {
      const d = this.pinchDist()
      if (this.pinch > 0) this.setZoom(this.zoom * (d / this.pinch))
      this.pinch = d
    }
  }

  private up(e: PointerEvent): void {
    const p = this.ptrs.get(e.pointerId)
    if (!p) return
    this.ptrs.delete(e.pointerId)
    this.pinch = 0
    if (this.active && this.ptrs.size === 0 && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 8) this.tap(e.clientX, e.clientY)
  }

  private pinchDist(): number {
    const [a, b] = [...this.ptrs.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  /** Select the piece under a screen point. */
  private tap(x: number, y: number): void {
    const t = this.track
    if (!t || !this.layout) return
    const r = this.host.canvas.getBoundingClientRect()
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(this.ndc, this.host.rig.camera)
    let h = 0
    for (let k = 0; k < 3; k++) {
      this.plane.constant = -h
      if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return
      t.query(this.hit.x, this.hit.z, -1, this.gs)
      h = this.gs.height
    }
    if (Math.abs(this.gs.lateral) > t.width / 2 + 4) return
    const i = pieceAt(this.layout, this.gs.s)
    this.sel = Math.min(i, this.data.pieces.length - 1)
    if (this.selPiece) {
      this.surface = this.selPiece.surface ?? this.surface
      if (this.selPiece.t) this.turn = this.selPiece.t
      if (this.selPiece.t && this.selPiece.t !== 'S') this.bendTurn = this.selPiece.t
    }
    this.rebuild()
  }
}
