import './style.css'
import { Game } from './game'
import { haptic } from './input/haptics'
import { Input } from './input/input'
import { CameraRig, SCREEN_UP } from './render/cameraRig'
import { CarView } from './render/carView'
import { Lighting } from './render/lighting'
import { look, LOOKS, loadLookOverrides } from './render/look'
import { createScene } from './render/scene'
import { buildScenery, obstacleLines } from './render/scenery'
import { buildTrackView } from './render/trackView'
import { Track, type TrackData } from './sim/track'
import { CarState, placeCar, SIM_DT, stepCar } from './sim/vehicle'
import trackData from './tracks/stage1.json'
import { loadTuningOverrides } from './tuning'
import { createDebugPanel } from './ui/debugPanel'
import { FpsMeter } from './ui/fpsMeter'
import { Hud } from './ui/hud'
import { loadSettings, settings } from './ui/settings'

const debug = new URLSearchParams(location.search).has('debug')
if (debug) {
  loadTuningOverrides()
  loadLookOverrides()
}
// ?look=soft|studio|gi|overcast|outdoor picks a lighting preset (handy on a phone without the panel).
{
  const want = new URLSearchParams(location.search).get('look')?.toLowerCase().replace(/[^a-z]/g, '')
  const preset = want ? LOOKS.find((l) => l.label.toLowerCase().replace(/[^a-z]/g, '').startsWith(want)) : undefined
  if (preset) Object.assign(look, preset.values)
}
loadSettings()

const app = document.getElementById('app')!
const { renderer, scene } = createScene(app)
const track = new Track(trackData as TrackData)
scene.add(buildTrackView(track))
const carView = new CarView()
// Real shadows replace the blob shadow (carView.shadowRoot stays available as a cheap fallback).
scene.add(carView.root)
const rig = new CameraRig()
const lighting = new Lighting(renderer, scene, rig.camera)
buildScenery(track)
  .then(({ group, obstacles }) => {
    group.traverse((o) => {
      const m = (o as { material?: import('three').Material }).material
      if (m) lighting.prepareMaterial(m)
    })
    scene.add(group)
    track.obstacles = obstacles
    if (debug) scene.add(obstacleLines(obstacles))
  })
  .catch((e) => console.warn('Scenery failed to load', e))

// Frame-rate meter: ?fps or ?debug. Tapping it cycles the lighting presets.
const lookName = () => LOOKS.find((l) => Object.entries(l.values).every(([k, v]) => look[k as keyof typeof look] === v))?.label ?? 'custom'
let lookIdx = Math.max(0, LOOKS.findIndex((l) => l.label === lookName()))
const fpsMeter =
  debug || new URLSearchParams(location.search).has('fps')
    ? new FpsMeter(app, () => {
        lookIdx = (lookIdx + 1) % LOOKS.length
        Object.assign(look, LOOKS[lookIdx].values)
        lighting.apply()
        return LOOKS[lookIdx].label
      })
    : null
fpsMeter?.setLabel(lookName())
// Dev aid (like the mini-game's window.brickSnap): poke the look from the console.
if (debug) (window as unknown as Record<string, unknown>).raleee = { look, lighting, renderer }
rig.shakeEnabled = settings.cameraShake

const input = new Input(app)
const hud = new Hud(app, () => input.requestRestart(), debug)
if (debug)
  createDebugPanel(app, () => lighting.apply(), () => {
    rig.shakeEnabled = settings.cameraShake
    input.touch?.refreshMode()
  })

const prev = new CarState()
const curr = new CarState()
placeCar(curr, track, track.startIdx)
prev.copyFrom(curr)
rig.snap(curr.x, curr.y, curr.z)

const game = new Game(track, prev, curr, () => {
  carView.update(curr, curr, 1)
  rig.snap(curr.x, curr.y, curr.z)
})

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
  if (input.consumeRestart()) game.restart()

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
  const simMs = performance.now() - simStart
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
  const renderStart = performance.now()
  lighting.render()
  fpsMeter?.frame(frameMs, simMs, performance.now() - renderStart)
}
requestAnimationFrame(frame)
