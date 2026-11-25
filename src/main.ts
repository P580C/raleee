import './style.css'
import type { Group, InstancedMesh } from 'three'
import { applyCarTuning, carById, type CarDef } from './cars'
import { Editor } from './editor/editor'
import { Game } from './game'
import { haptic } from './input/haptics'
import { Input } from './input/input'
import { CameraRig, SCREEN_UP } from './render/cameraRig'
import { CarView } from './render/carView'
import { Lighting } from './render/lighting'
import { look, LOOKS, loadLookOverrides } from './render/look'
import { createScene } from './render/scene'
import { SkidMarks } from './render/skidMarks'
import { buildScenery, obstacleLines } from './render/scenery'
import { buildTrackView, disposeGroup } from './render/trackView'
import { Track } from './sim/track'
import { CarState, placeCar, SIM_DT, stepCar } from './sim/vehicle'
import { findTrack, listTracks, trackDataOf } from './tracks/registry'
import { loadTuningOverrides } from './tuning'
import { createDebugPanel } from './ui/debugPanel'
import { FpsMeter } from './ui/fpsMeter'
import { Hud } from './ui/hud'
import { Menu } from './ui/menu'
import { loadSettings, settings } from './ui/settings'

const params = new URLSearchParams(location.search)
const debug = params.has('debug')
if (debug) {
  loadTuningOverrides()
  loadLookOverrides()
}
// ?look=soft|studio|gi|overcast|outdoor picks a lighting preset (handy on a phone without the panel).
{
  const want = params.get('look')?.toLowerCase().replace(/[^a-z]/g, '')
  const preset = want ? LOOKS.find((l) => l.label.toLowerCase().replace(/[^a-z]/g, '').startsWith(want)) : undefined
  if (preset) Object.assign(look, preset.values)
}
loadSettings()

// ── Selection (stage + car), remembered between visits ──────────────────
const SEL_KEY = 'raleee.selection'
const selection = { track: 'valley', car: 'coupe' }
try {
  Object.assign(selection, JSON.parse(localStorage.getItem(SEL_KEY) ?? '{}'))
} catch {
  /* ignore */
}
if (params.get('track')) selection.track = params.get('track')!
if (params.get('car')) selection.car = params.get('car')!
if (!findTrack(selection.track)) selection.track = listTracks()[0].id
const saveSelection = () => {
  try {
    localStorage.setItem(SEL_KEY, JSON.stringify(selection))
  } catch {
    /* ignore */
  }
}

const app = document.getElementById('app')!
const { renderer, scene } = createScene(app)
const rig = new CameraRig()
const lighting = new Lighting(renderer, scene, rig.camera)
const skids = new SkidMarks()
scene.add(skids.mesh)

// Frame-rate meter: ?fps or ?debug. Tapping it cycles the lighting presets.
const lookName = () => LOOKS.find((l) => Object.entries(l.values).every(([k, v]) => look[k as keyof typeof look] === v))?.label ?? 'custom'
let lookIdx = Math.max(0, LOOKS.findIndex((l) => l.label === lookName()))
const fpsMeter =
  debug || params.has('fps')
    ? new FpsMeter(app, () => {
        lookIdx = (lookIdx + 1) % LOOKS.length
        Object.assign(look, LOOKS[lookIdx].values)
        lighting.apply()
        return LOOKS[lookIdx].label
      })
    : null
fpsMeter?.setLabel(lookName())
rig.shakeEnabled = settings.cameraShake

const input = new Input(app)
const hud = new Hud(app, () => input.requestRestart(), () => back(), debug)
if (debug)
  createDebugPanel(app, () => lighting.apply(), () => {
    rig.shakeEnabled = settings.cameraShake
    input.touch?.refreshMode()
  })

const prev = new CarState()
const curr = new CarState()

// ── Car ────────────────────────────────────────────────────────────────
let carDef: CarDef = carById(selection.car)
let carView: CarView
function setCar(def: CarDef): void {
  carDef = def
  applyCarTuning(def)
  if (carView) {
    scene.remove(carView.root)
    carView.dispose()
  }
  carView = new CarView(def)
  lighting.prepareObject(carView.root)
  scene.add(carView.root)
  carView.update(curr, curr, 1)
}
setCar(carDef)

// ── Stage ──────────────────────────────────────────────────────────────
let track: Track
let game: Game
let trackGroup: Group | null = null
let sceneryGroup: Group | null = null
let debugLines: Group | null = null
let stageToken = 0
let loadedId = ''

function placeAtStart(): void {
  placeCar(curr, track, track.startIdx)
  prev.copyFrom(curr)
  carView.update(curr, curr, 1)
  rig.snap(curr.x, curr.y, curr.z)
  skids.clear()
}

/** Build a stage (skipped if it's already loaded, unless `force`: the editor may have changed it). */
function loadStage(id: string, force = false): void {
  const entry = findTrack(id) ?? listTracks()[0]
  if (!force && entry.id === loadedId) {
    placeAtStart()
    return
  }
  loadedId = entry.id
  const token = ++stageToken
  if (trackGroup) {
    scene.remove(trackGroup)
    disposeGroup(trackGroup)
  }
  if (sceneryGroup) {
    scene.remove(sceneryGroup)
    // Instances share the cached model's geometry: free only the instance buffers.
    sceneryGroup.traverse((o) => (o as InstancedMesh).isInstancedMesh && (o as InstancedMesh).dispose())
    sceneryGroup = null
  }
  if (debugLines) {
    scene.remove(debugLines)
    disposeGroup(debugLines)
    debugLines = null
  }
  const data = trackDataOf(entry)
  track = new Track(data)
  trackGroup = buildTrackView(track)
  lighting.prepareObject(trackGroup)
  scene.add(trackGroup)
  game = new Game(track, prev, curr, () => {
    carView.update(curr, curr, 1)
    rig.snap(curr.x, curr.y, curr.z)
    skids.breakAll()
  })
  placeAtStart()
  const t = track
  buildScenery(t, data)
    .then(({ group, obstacles }) => {
      if (token !== stageToken) {
        group.traverse((o) => (o as InstancedMesh).isInstancedMesh && (o as InstancedMesh).dispose())
        return
      }
      lighting.prepareObject(group)
      scene.add(group)
      sceneryGroup = group
      t.obstacles = obstacles
      if (debug) scene.add((debugLines = obstacleLines(obstacles)))
    })
    .catch((e) => console.warn('Scenery failed to load', e))
}
loadStage(selection.track)

// ── Modes: menu → race, menu ↔ editor → test drive ─────────────────────
type Mode = 'menu' | 'race' | 'editor'
let mode: Mode = 'menu'
/** Test-driving from the editor: the back button returns there. */
let testingFrom: string | null = null

const menu = new Menu(app, {
  selectTrack(id) {
    selection.track = id
    saveSelection()
    loadStage(id)
  },
  selectCar(id) {
    selection.car = id
    saveSelection()
    setCar(carById(id))
  },
  race: () => startRace(),
  edit: (id) => openEditor(id),
})

const editor = new Editor(app, {
  scene,
  rig,
  lighting,
  canvas: renderer.domElement,
  exit(trackId) {
    editor.close()
    if (trackId) selection.track = trackId
    if (!findTrack(selection.track)) selection.track = listTracks()[0].id
    saveSelection()
    showMenu(true)
  },
  test(trackId) {
    editor.close()
    testingFrom = trackId
    selection.track = trackId
    saveSelection()
    startRace(true)
  },
})

function setRaceUi(on: boolean): void {
  hud.setVisible(on)
  input.touch?.setVisible(on)
}

function showMenu(fromEditor = false): void {
  mode = 'menu'
  testingFrom = null
  setRaceUi(false)
  loadStage(selection.track, fromEditor)
  if (sceneryGroup) sceneryGroup.visible = true
  carView.root.visible = true
  skids.mesh.visible = true
  if (trackGroup) trackGroup.visible = true
  menu.show(selection.track, selection.car)
}

function startRace(fromEditor = false): void {
  mode = 'race'
  menu.hide()
  loadStage(selection.track, fromEditor)
  if (trackGroup) trackGroup.visible = true
  if (sceneryGroup) sceneryGroup.visible = true
  carView.root.visible = true
  skids.mesh.visible = true
  hud.setBackLabel(testingFrom ? 'EDIT' : 'MENU')
  setRaceUi(true)
  game.restart()
  input.consumeRestart()
  input.consumeBack()
}

function openEditor(trackId: string | null): void {
  mode = 'editor'
  menu.hide()
  setRaceUi(false)
  // The editor draws its own copy of the stage; hide the race scene.
  carView.root.visible = false
  skids.mesh.visible = false
  if (trackGroup) trackGroup.visible = false
  if (sceneryGroup) sceneryGroup.visible = false
  if (debugLines) debugLines.visible = false
  editor.open(trackId)
}

/** HUD back button / Escape: from a test drive back to the editor, otherwise to the menu. */
function back(): void {
  if (mode !== 'race') return
  if (testingFrom) openEditor(testingFrom)
  else showMenu()
}

if (debug) (window as unknown as Record<string, unknown>).raleee = { look, lighting, renderer, skids, rig, editor }

function resize(): void {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(w, h)
  rig.resize(w, h)
  lighting.resize(w, h)
}
window.addEventListener('resize', resize)
resize()
showMenu()
if (params.has('race')) startRace()

// Block page gestures (scroll, pinch-zoom, double-tap zoom, long-press menus) outside the tuning panel.
const inPanel = (e: Event) => e.target instanceof Element && e.target.closest('.dbg-panel') !== null
document.addEventListener('touchmove', (e) => !inPanel(e) && e.preventDefault(), { passive: false })
document.addEventListener('gesturestart', (e) => e.preventDefault())
document.addEventListener('dblclick', (e) => e.preventDefault())
document.addEventListener('contextmenu', (e) => e.preventDefault())

let acc = 0
let last = performance.now()
let grassBefore = false

function frame(now: number): void {
  requestAnimationFrame(frame)
  const frameMs = now - last
  last = now
  const dt = Math.min(frameMs / 1000, 0.25)

  const c = input.update()
  let simMs = 0
  if (mode === 'race') {
    if (input.consumeBack()) back()
    if (input.consumeRestart()) {
      game.restart()
      skids.clear()
    }
  }
  if (mode === 'race') {
    // Fixed-timestep simulation; render interpolates between the last two states.
    const simStart = performance.now()
    acc += dt
    while (acc >= SIM_DT) {
      prev.copyFrom(curr)
      game.filterControls(c)
      stepCar(curr, c, track, SIM_DT)
      game.stepRules(c, SIM_DT)
      acc -= SIM_DT
    }
    simMs = performance.now() - simStart
    game.frame(dt)

    // Feedback events.
    if (curr.landImpact > 0) {
      if (curr.landImpact > 2) {
        rig.addShake(Math.min(0.8, curr.landImpact / 14))
        haptic(Math.min(40, 10 + curr.landImpact * 3))
      }
      curr.landImpact = 0
    }
    // Hits: haptic only (the body knock in the sim shows the impact; no camera shake).
    if (curr.hitImpact > 0) {
      if (curr.hitImpact > 2) haptic(Math.min(60, 15 + curr.hitImpact * 3))
      curr.hitImpact = 0
    }
    const onGrass = curr.wheelsOnGrass >= 2 && curr.speed > 5
    if (onGrass && !grassBefore) haptic(12)
    grassBefore = onGrass

    const alpha = acc / SIM_DT
    carView.update(prev, curr, alpha)
    skids.update(carView.wheelGround, curr.skidF, curr.skidR)
    rig.update(dt, carView.pos.x, carView.pos.y, carView.pos.z, curr.vx, curr.vz)
    hud.setSpeed(curr.speed)
    hud.setTime(game.time, game.status === 'finished')
    hud.setFade(game.fade)
    if (debug) {
      hud.perf(
        frameMs,
        `slip ${curr.slipAngle.toFixed(2)}  air ${curr.grounded ? '-' : curr.airTime.toFixed(2)}  grass ${curr.wheelsOnGrass}  steer ${c.steer.toFixed(2)}`,
      )
    }
    lighting.update(carView.pos.x, carView.pos.y, carView.pos.z, SCREEN_UP.x, SCREEN_UP.z)
  } else if (mode === 'editor') {
    acc = 0
    hud.setFade(0)
    editor.update()
    lighting.update(editor.focus.x, editor.focus.y, editor.focus.z, SCREEN_UP.x, SCREEN_UP.z)
  } else {
    // Menu: the car waits on the start line.
    acc = 0
    hud.setFade(0)
    rig.update(dt, carView.pos.x, carView.pos.y, carView.pos.z, 0, 0)
    lighting.update(carView.pos.x, carView.pos.y, carView.pos.z, SCREEN_UP.x, SCREEN_UP.z)
  }
  const renderStart = performance.now()
  lighting.render()
  fpsMeter?.frame(frameMs, simMs, performance.now() - renderStart)
}
requestAnimationFrame(frame)
