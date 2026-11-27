/**
 * Stage editor, seen through the game's own isometric camera. Two tabs:
 *
 * TRACK: lay slot-car style pieces end to end. Tap a piece in the grid to add it after the selected piece
 * (the arrow shows where it goes). Tap the road to select a piece, then change its surface or level, FLIP
 * it, or delete it.
 *
 * SCENERY: place LEGO models (public/models/scenery.json). Tap a model to drop it in the middle of the view;
 * tap a placed model to select it, drag it to move it, rotate, duplicate or delete it.
 *
 * Drag empty ground to pan, pinch or scroll to zoom. Every change is saved to the player's stages at once.
 */
import { ConeGeometry, Group, LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial, Plane, Raycaster, Vector2, Vector3, type Scene, BufferGeometry, Float32BufferAttribute } from 'three'
import type { CameraRig } from '../render/cameraRig'
import { SCREEN_UP } from '../render/cameraRig'
import type { Lighting } from '../render/lighting'
import { loadCatalog, loadScenery, sceneryObject, sceneryThumb, type LoadedScenery, type SceneryDef } from '../render/sceneryCatalog'
import { buildRoadOverlay, buildTrackView, disposeGroup } from '../render/trackView'
import {
  findOverlaps,
  layoutPieces,
  LEVEL,
  pieceAt,
  PIECES,
  piecesToTrackData,
  type Piece,
  type PieceKind,
  type PieceLayout,
  type PieceTrackData,
  type Turn,
} from '../sim/pieces'
import { makeGroundSample, roadSurface, SURFACES, Track, type SceneryItem, type SurfaceName } from '../sim/track'
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
/** Snap steps for scenery: position (m) and turn (degrees). */
const SNAP_POS = 1
const SNAP_ROT = 15

/** Every piece the grid offers, each turn its own button. */
const PALETTE: { k: PieceKind; t?: Turn; label: string }[] = [
  { k: 'straight', label: 'Straight' },
  { k: 'bend45', t: 'L', label: '45° left' },
  { k: 'bend45', t: 'R', label: '45° right' },
  { k: 'bend90', t: 'L', label: '90° left' },
  { k: 'bend90', t: 'R', label: '90° right' },
  { k: 'roundabout', t: 'L', label: 'Rbt left' },
  { k: 'large90', t: 'L', label: 'Wide left' },
  { k: 'large90', t: 'R', label: 'Wide right' },
  { k: 'small90', t: 'L', label: 'Tight left' },
  { k: 'small90', t: 'R', label: 'Tight right' },
  { k: 'roundabout', t: 'S', label: 'Rbt ahead' },
  { k: 'roundabout', t: 'R', label: 'Rbt right' },
]

/** Grid icon: the piece's centreline seen from above, entering from the bottom. */
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
    cur = roadSurface(p.surface) ?? cur
    return { ...p, surface: cur }
  })
}

function newStageName(): string {
  const mine = listTracks().filter((t) => !t.builtIn).length
  return `My Stage ${mine + 1}`
}

const snap = (v: number, step: number) => Math.round(v / step) * step
const wrapDeg = (d: number) => ((d % 360) + 360) % 360

type Tab = 'track' | 'scenery'

export class Editor {
  readonly focus = new Vector3()
  private readonly el: HTMLDivElement
  private readonly nameEl: HTMLInputElement
  private readonly infoEl: HTMLDivElement
  private readonly toolsEl: HTMLDivElement
  private readonly gridEl: HTMLDivElement
  private readonly attrsEl: HTMLDivElement
  private readonly moreEl: HTMLDivElement
  private readonly group = new Group()
  private readonly sceneryGroup = new Group()
  private readonly marker: Mesh
  private readonly ring: LineLoop
  private data: PieceTrackData = { format: 'pieces', name: '', heading: 225, pieces: [] }
  private id: string | null = null
  private tab: Tab = 'track'
  private sel = -1
  private surface: SurfaceName = 'tarmac'
  private track: Track | null = null
  private layout: PieceLayout | null = null
  private overlaps = new Set<number>()
  private undoStack: string[] = []
  private zoom = 0.3
  private active = false
  // Scenery
  private catalog: SceneryDef[] = []
  private readonly loadedScenery = new Map<string, LoadedScenery>()
  private readonly thumbs = new Map<string, string>()
  private scSel = -1
  private snapOn = true
  private itemObjs: Group[] = []
  private drag: { idx: number; ox: number; oz: number; moved: boolean } | null = null
  // Pointer
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
      <div class="ed-tools"></div>
      <div class="ed-more" style="display:none">
        <button data-a="rotate">ROTATE STAGE ⟳</button>
        <button data-a="new">NEW STAGE</button>
        <button data-a="export">COPY JSON</button>
        <button data-a="import">PASTE JSON</button>
        <button data-a="remove" class="danger">DELETE STAGE</button>
      </div>
      <div class="ed-bottom">
        <div class="ed-tabs">
          <button data-a="tab" data-v="track">TRACK</button>
          <button data-a="tab" data-v="scenery">SCENERY</button>
          <div class="ed-info"></div>
        </div>
        <div class="ed-attrs"></div>
        <div class="ed-grid"></div>
      </div>`
    parent.appendChild(el)
    this.el = el
    this.nameEl = el.querySelector('.ed-name')!
    this.infoEl = el.querySelector('.ed-info')!
    this.toolsEl = el.querySelector('.ed-tools')!
    this.gridEl = el.querySelector('.ed-grid')!
    this.attrsEl = el.querySelector('.ed-attrs')!
    this.moreEl = el.querySelector('.ed-more')!

    el.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('button[data-a]') as HTMLButtonElement | null
      if (b && !b.disabled) this.action(b.dataset.a!, b.dataset.v)
    })
    this.nameEl.addEventListener('input', () => {
      this.data.name = this.nameEl.value.trim() || 'Untitled'
      this.persist()
    })
    // The grids scroll on touch.
    el.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true })

    this.marker = new Mesh(new ConeGeometry(2.2, 5, 4), new MeshBasicMaterial({ color: BAD_COLOR, depthTest: false, transparent: true, opacity: 0.9 }))
    this.marker.renderOrder = 5
    const ringPts: number[] = []
    for (let k = 0; k < 48; k++) ringPts.push(Math.cos((k / 48) * Math.PI * 2), 0, Math.sin((k / 48) * Math.PI * 2))
    const ringGeo = new BufferGeometry()
    ringGeo.setAttribute('position', new Float32BufferAttribute(ringPts, 3))
    this.ring = new LineLoop(ringGeo, new LineBasicMaterial({ color: SEL_COLOR, depthTest: false, transparent: true }))
    this.ring.renderOrder = 6

    const c = host.canvas
    c.addEventListener('pointerdown', (e) => this.down(e))
    c.addEventListener('pointermove', (e) => this.move(e))
    c.addEventListener('pointerup', (e) => this.up(e))
    c.addEventListener('pointercancel', (e) => this.up(e))
    c.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return
        e.preventDefault()
        this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015))
      },
      { passive: false },
    )
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.target instanceof HTMLInputElement) return
      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) this.action('undo')
      else if (e.key === 'Delete' || e.key === 'Backspace') this.action('del')
      else if (this.tab === 'scenery' && (e.key === 'q' || e.key === 'Q')) this.action('turn', '-1')
      else if (this.tab === 'scenery' && (e.key === 'e' || e.key === 'E')) this.action('turn', '1')
    })

    loadCatalog().then((list) => {
      this.catalog = list
      for (const def of list) {
        loadScenery(def)
          .then((s) => {
            this.loadedScenery.set(def.id, s)
            if (this.active) this.rebuildScenery()
            return sceneryThumb(s)
          })
          .then((url) => {
            this.thumbs.set(def.id, url)
            if (this.active && this.tab === 'scenery') this.renderBar()
          })
          .catch((e) => console.warn(`Scenery ${def.id} failed to load`, e))
      }
      if (this.active) this.renderBar()
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
      this.data = {
        ...src,
        name: entry.builtIn ? `${src.name} copy` : src.name,
        pieces: explicitSurfaces(src.pieces),
        scenery: (src.scenery ?? []).map((s) => ({ ...s })),
      }
      this.id = entry.builtIn ? null : entry.id
    } else {
      this.data = { format: 'pieces', name: newStageName(), heading: 225, pieces: [], scenery: [] }
      this.id = null
    }
    this.sel = this.data.pieces.length - 1
    this.scSel = -1
    this.surface = this.data.pieces.at(-1)?.surface ?? 'tarmac'
    this.undoStack = []
    this.nameEl.value = this.data.name
    this.active = true
    this.el.style.display = ''
    this.moreEl.style.display = 'none'
    this.host.scene.add(this.group, this.sceneryGroup)
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
    this.drag = null
    this.el.style.display = 'none'
    this.host.scene.remove(this.group, this.sceneryGroup)
    this.clearGroup()
    this.sceneryGroup.clear()
    this.itemObjs = []
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

  private get items(): SceneryItem[] {
    return (this.data.scenery ??= [])
  }

  private get selPiece(): Piece | null {
    return this.data.pieces[this.sel] ?? null
  }

  private get selItem(): SceneryItem | null {
    return this.items[this.scSel] ?? null
  }

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
      case 'tab':
        this.tab = v as Tab
        this.drag = null
        this.rebuild()
        return
      case 'piece': {
        const [kind, t] = v!.split(':') as [PieceKind, Turn | '']
        this.change(() => {
          const p: Piece = { k: kind, surface: this.surface }
          if (t) p.t = t
          this.data.pieces.splice(this.sel + 1, 0, p)
          this.sel++
        })
        return
      }
      case 'flip': {
        const p = this.selPiece
        if (!p || !p.t) {
          this.flash('Select a bend or roundabout to flip it')
          return
        }
        this.change(() => {
          if (p.k === 'roundabout') p.t = p.t === 'L' ? 'S' : p.t === 'S' ? 'R' : 'L'
          else p.t = p.t === 'L' ? 'R' : 'L'
        })
        return
      }
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
        if (this.tab === 'scenery') {
          if (this.scSel < 0) return
          this.change(() => {
            this.items.splice(this.scSel, 1)
            this.scSel = -1
          })
          return
        }
        if (this.sel < 0) return
        this.change(() => {
          this.data.pieces.splice(this.sel, 1)
          this.sel = Math.min(this.sel, this.data.pieces.length) - 1
          if (this.sel < 0 && this.data.pieces.length) this.sel = 0
        })
        return
      case 'place': {
        const def = this.catalog.find((d) => d.id === v)
        if (!def) return
        const s = this.snapOn ? SNAP_POS : 0.01
        this.change(() => {
          this.items.push({ m: def.id, x: snap(this.focus.x, s), z: snap(this.focus.z, s), r: 0 })
          this.scSel = this.items.length - 1
        })
        return
      }
      case 'turn': {
        const it = this.selItem
        if (!it) {
          this.flash('Select a model to turn it')
          return
        }
        this.change(() => (it.r = wrapDeg(snap(it.r + Number(v) * SNAP_ROT, this.snapOn ? SNAP_ROT : 1))))
        return
      }
      case 'dup': {
        const it = this.selItem
        if (!it) return
        const r = this.loadedScenery.get(it.m)?.radius ?? 5
        const s = this.snapOn ? SNAP_POS : 0.01
        this.change(() => {
          this.items.push({ ...it, x: snap(it.x + r, s), z: snap(it.z + r, s) })
          this.scSel = this.items.length - 1
        })
        return
      }
      case 'snap':
        this.snapOn = !this.snapOn
        this.renderBar()
        return
      case 'auto':
        this.change(() => (this.data.autoScenery = this.data.autoScenery === false))
        return
      case 'undo': {
        const prev = this.undoStack.pop()
        if (!prev) return
        const st = JSON.parse(prev) as { data: PieceTrackData; sel: number; scSel: number }
        this.data = st.data
        this.sel = st.sel
        this.scSel = st.scSel
        this.nameEl.value = this.data.name
        this.persist()
        this.rebuild()
        return
      }
      case 'fit':
        this.fit()
        return
      case 'rotate':
        this.moreEl.style.display = 'none'
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
          const scenery = Array.isArray(d.scenery)
            ? d.scenery.filter((s) => s && typeof s.m === 'string' && isFinite(s.x) && isFinite(s.z)).map((s) => ({ m: s.m, x: +s.x, z: +s.z, r: +s.r || 0 }))
            : []
          this.change(() => {
            this.data = {
              format: 'pieces',
              name: d.name || 'Imported',
              heading: Number(d.heading) || 225,
              pieces: explicitSurfaces(d.pieces),
              scenery,
              ...(d.autoScenery === false ? { autoScenery: false } : {}),
            }
            this.sel = this.data.pieces.length - 1
            this.scSel = -1
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

  /** Snapshot for undo (call before changing anything). */
  private pushUndo(): void {
    this.undoStack.push(JSON.stringify({ data: this.data, sel: this.sel, scSel: this.scSel }))
    if (this.undoStack.length > 200) this.undoStack.shift()
  }

  /** Apply an edit with undo, save and redraw. */
  private change(fn: () => void): void {
    this.pushUndo()
    fn()
    this.persist()
    this.rebuild()
  }

  /** Save to the player's stages (once it has something in it). */
  private persist(): void {
    if (!this.data.pieces.length && !this.items.length && !this.id) return
    this.id = saveUserTrack(this.id, this.data)
  }

  // ── Drawing ──────────────────────────────────────────

  private clearGroup(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c)
      if (c !== this.marker && c !== this.ring) disposeGroup(c)
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
    if (this.tab === 'track') {
      if (this.sel >= 0 && this.sel < this.data.pieces.length) {
        const [a, b] = span(this.sel)
        this.group.add(buildRoadOverlay(this.track, a, b, SEL_COLOR, 0.5, 1.12))
      }
      // Arrow where the next piece will go.
      const at = this.sel >= 0 ? this.layout.ends[this.sel] : this.layout.start
      const h = (at.deg * Math.PI) / 180
      this.marker.position.set(at.x + Math.sin(h) * 3, at.e + 2, at.z + Math.cos(h) * 3)
      this.marker.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(Math.sin(h), 0, Math.cos(h)))
      this.group.add(this.marker)
    }
    this.rebuildScenery()
    this.renderBar()
  }

  /** Placed models as plain meshes (shared geometry), plus the selection ring. */
  private rebuildScenery(): void {
    this.sceneryGroup.clear()
    this.itemObjs = []
    this.items.forEach((it) => {
      const s = this.loadedScenery.get(it.m)
      const obj = s ? sceneryObject(s) : new Group()
      this.host.lighting.prepareObject(obj)
      this.placeObj(obj, it)
      this.sceneryGroup.add(obj)
      this.itemObjs.push(obj)
    })
    this.updateRing()
    this.sceneryGroup.add(this.ring)
  }

  private groundAt(x: number, z: number): number {
    if (!this.track) return 0
    this.track.query(x, z, -1, this.gs)
    return this.gs.height
  }

  private placeObj(obj: Group, it: SceneryItem): void {
    obj.position.set(it.x, this.groundAt(it.x, it.z), it.z)
    obj.rotation.set(0, (it.r * Math.PI) / 180, 0)
  }

  private updateRing(): void {
    const it = this.tab === 'scenery' ? this.selItem : null
    this.ring.visible = !!it
    if (!it) return
    const r = (this.loadedScenery.get(it.m)?.radius ?? 4) * 0.9
    this.ring.position.set(it.x, this.groundAt(it.x, it.z) + 0.3, it.z)
    this.ring.scale.set(r, 1, r)
  }

  private renderBar(): void {
    const tabBtn = this.el.querySelectorAll<HTMLButtonElement>('.ed-tabs button')
    tabBtn.forEach((b) => b.classList.toggle('on', b.dataset.v === this.tab))
    this.el.classList.toggle('scenery', this.tab === 'scenery')
    if (this.tab === 'track') this.renderTrackBar()
    else this.renderSceneryBar()
  }

  private renderTrackBar(): void {
    const sp = this.selPiece
    this.toolsEl.innerHTML = `
      <button data-a="undo">UNDO</button>
      <button data-a="del" ${sp ? '' : 'disabled'}>DELETE</button>
      <button data-a="flip" ${sp?.t ? '' : 'disabled'}>FLIP ⇄</button>
      <button data-a="fit">FIT</button>
      <button data-a="more">•••</button>`
    this.gridEl.className = 'ed-grid pieces'
    this.gridEl.innerHTML = PALETTE.map(
      (p) => `<button data-a="piece" data-v="${p.k}:${p.t ?? ''}" class="ed-piece">${pieceIcon(p.k, p.t ?? 'L')}<span>${p.label}</span></button>`,
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
      ? `#${this.sel + 1} ${PIECES[sp.k].label}${sp.t ? ` ${sp.k === 'roundabout' ? exitName[sp.t] : sp.t === 'L' ? 'left' : 'right'}` : ''}`
      : 'start line'
    this.infoEl.innerHTML =
      `<b>${this.data.pieces.length}</b> pieces · <b>${(len / 1000).toFixed(2)}</b> km · ${escapeHtml(what)}` +
      (this.overlaps.size ? ` · <span class="warn">${this.overlaps.size} overlapping</span>` : '')
  }

  private renderSceneryBar(): void {
    const it = this.selItem
    this.toolsEl.innerHTML = `
      <button data-a="undo">UNDO</button>
      <button data-a="del" ${it ? '' : 'disabled'}>DELETE</button>
      <button data-a="dup" ${it ? '' : 'disabled'}>COPY</button>
      <button data-a="fit">FIT</button>
      <button data-a="more">•••</button>`
    this.attrsEl.innerHTML = `
      <div class="ed-chips">
        <button data-a="turn" data-v="-1" class="chip" ${it ? '' : 'disabled'}>⟲ ${SNAP_ROT}°</button>
        <button data-a="turn" data-v="1" class="chip" ${it ? '' : 'disabled'}>⟳ ${SNAP_ROT}°</button>
        <button data-a="snap" class="chip ${this.snapOn ? 'on' : ''}">SNAP</button>
        <button data-a="auto" class="chip ${this.data.autoScenery !== false ? 'on' : ''}">AUTO MOUNDS</button>
      </div>`
    this.gridEl.className = 'ed-grid models'
    this.gridEl.innerHTML = this.catalog.length
      ? this.catalog
          .map((d) => {
            const img = this.thumbs.get(d.id)
            return `<button data-a="place" data-v="${escapeHtml(d.id)}" class="ed-model">${img ? `<img src="${img}" alt="" />` : '<i></i>'}<span>${escapeHtml(d.name)}</span></button>`
          })
          .join('')
      : '<p class="ed-empty">No scenery yet. Import a model with tools/import_lego.py --scenery "Name".</p>'
    const name = it ? (this.catalog.find((d) => d.id === it.m)?.name ?? it.m) : ''
    this.infoEl.innerHTML = it
      ? `<b>${escapeHtml(name)}</b> · ${Math.round(it.r)}° · drag to move`
      : `<b>${this.items.length}</b> placed · tap a model to drop it in the middle of the view`
  }

  private flashTimer = 0

  private flash(msg: string): void {
    this.infoEl.innerHTML = `<span class="warn">${escapeHtml(msg)}</span>`
    clearTimeout(this.flashTimer)
    this.flashTimer = window.setTimeout(() => this.renderBar(), 1800)
  }

  // ── Camera ───────────────────────────────────────────

  private setZoom(z: number): void {
    this.zoom = Math.max(0.06, Math.min(3, z))
  }

  /** World metres per screen pixel at the current zoom. */
  private worldPerPx(): number {
    const cam = this.host.rig.camera
    return (cam.right - cam.left) / cam.zoom / this.host.canvas.clientWidth
  }

  /** Frame the whole stage (from just before the start line) and its scenery. */
  private fit(): void {
    const L = this.layout
    if (!L) return
    const pts: number[] = []
    for (const g of L.piecePts) pts.push(...g)
    // Start line and the last bit of lead-in, plus the run-out.
    pts.push(L.start.x, L.start.z, 0, ...L.leadPts.slice(-30), ...L.runPts)
    for (const it of this.items) pts.push(it.x, it.z, 0)
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
    const z = Math.min(w / (x1 - x0 + 40), (h * 0.5) / ((y1 - y0) * SIN_PITCH + 40))
    this.setZoom(z)
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    // Nudge down the screen: the bottom panel is taller than the top bars.
    const nudge = ((h / this.zoom) * 0.12) / SIN_PITCH
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

  /** Where a screen point meets the ground (following the road's height). False if it misses. */
  private screenToGround(x: number, y: number): boolean {
    const r = this.host.canvas.getBoundingClientRect()
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(this.ndc, this.host.rig.camera)
    let h = 0
    for (let k = 0; k < 3; k++) {
      this.plane.constant = -h
      if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return false
      if (!this.track) return true
      this.track.query(this.hit.x, this.hit.z, -1, this.gs)
      h = this.gs.height
    }
    return true
  }

  /** The placed model under a screen point (the closest one whose footprint contains it), or -1. */
  private pickItem(x: number, y: number): number {
    if (!this.screenToGround(x, y)) return -1
    let best = -1
    let bestD = Infinity
    this.items.forEach((it, i) => {
      const r = (this.loadedScenery.get(it.m)?.radius ?? 4) * 0.8
      const d = Math.hypot(it.x - this.hit.x, it.z - this.hit.z)
      if (d < r && d < bestD) {
        best = i
        bestD = d
      }
    })
    return best
  }

  private down(e: PointerEvent): void {
    if (!this.active) return
    this.host.canvas.setPointerCapture(e.pointerId)
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY })
    if (this.ptrs.size === 2) {
      this.pinch = this.pinchDist()
      this.endDrag()
    } else if (this.tab === 'scenery') {
      // Pressing on a model grabs it (and selects it); anywhere else pans.
      const i = this.pickItem(e.clientX, e.clientY)
      if (i >= 0) {
        const it = this.items[i]
        if (i !== this.scSel) {
          this.scSel = i
          this.updateRing()
          this.renderBar()
        }
        this.drag = { idx: i, ox: it.x - this.hit.x, oz: it.z - this.hit.z, moved: false }
      }
    }
  }

  private move(e: PointerEvent): void {
    const p = this.ptrs.get(e.pointerId)
    if (!this.active || !p) return
    if (this.drag && this.ptrs.size === 1) {
      if (!this.drag.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6) return
      if (!this.screenToGround(e.clientX, e.clientY)) return
      const it = this.items[this.drag.idx]
      if (!this.drag.moved) {
        this.pushUndo()
        this.drag.moved = true
      }
      const s = this.snapOn ? SNAP_POS : 0.01
      it.x = snap(this.hit.x + this.drag.ox, s)
      it.z = snap(this.hit.z + this.drag.oz, s)
      this.placeObj(this.itemObjs[this.drag.idx], it)
      this.updateRing()
    } else if (this.ptrs.size === 1) this.pan(e.clientX - p.x, e.clientY - p.y)
    p.x = e.clientX
    p.y = e.clientY
    if (this.ptrs.size === 2) {
      const d = this.pinchDist()
      if (this.pinch > 0) this.setZoom(this.zoom * (d / this.pinch))
      this.pinch = d
    }
  }

  private endDrag(): void {
    if (this.drag?.moved) {
      this.persist()
      this.renderBar()
    }
    this.drag = null
  }

  private up(e: PointerEvent): void {
    const p = this.ptrs.get(e.pointerId)
    if (!p) return
    this.ptrs.delete(e.pointerId)
    this.pinch = 0
    const dragged = this.drag !== null
    this.endDrag()
    if (dragged) return
    if (this.active && this.ptrs.size === 0 && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 8) this.tap(e.clientX, e.clientY)
  }

  private pinchDist(): number {
    const [a, b] = [...this.ptrs.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  /** Track tab: select the piece under a screen point. Scenery tab: a tap on empty ground deselects. */
  private tap(x: number, y: number): void {
    if (this.tab === 'scenery') {
      if (this.scSel >= 0) {
        this.scSel = -1
        this.updateRing()
        this.renderBar()
      }
      return
    }
    const t = this.track
    if (!t || !this.layout || !this.screenToGround(x, y)) return
    if (this.gs.offDist > 4) return
    const i = pieceAt(this.layout, this.gs.s)
    this.sel = Math.min(i, this.data.pieces.length - 1)
    if (this.selPiece) this.surface = this.selPiece.surface ?? this.surface
    this.rebuild()
  }
}
