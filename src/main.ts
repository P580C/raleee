import './style.css'
import { Game } from './game'
import { haptic } from './input/haptics'
import { Input } from './input/input'
import { CameraRig } from './render/cameraRig'
import { CarView } from './render/carView'
import { createScene } from './render/scene'
import { buildTrackView } from './render/trackView'
import { Track, type TrackData } from './sim/track'
import { CarState, placeCar, SIM_DT, stepCar } from './sim/vehicle'
import trackData from './tracks/greybox.json'
import { loadTuningOverrides } from './tuning'
import { createDebugPanel } from './ui/debugPanel'
import { Hud } from './ui/hud'
import { loadSettings, settings } from './ui/settings'

const debug = new URLSearchParams(location.search).has('debug')
if (debug) loadTuningOverrides()
loadSettings()

const app = document.getElementById('app')!
const { renderer, scene } = createScene(app)
const track = new Track(trackData as TrackData)
scene.add(buildTrackView(track))
const carView = new CarView()
scene.add(carView.root, carView.shadowRoot)
const rig = new CameraRig()
rig.shakeEnabled = settings.cameraShake

const input = new Input(app)
const hud = new Hud(app, () => input.requestRestart(), debug)
if (debug)
  createDebugPanel(app, () => {
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
  const onGrass = curr.wheelsOnGrass >= 2 && curr.speed > 5
  if (onGrass && !grassBefore) haptic(12)
  grassBefore = onGrass

  const alpha = acc / SIM_DT
  carView.update(prev, curr, alpha)
  rig.update(dt, carView.pos.x, carView.pos.y, carView.pos.z, curr.vx, curr.vz)
  hud.setSpeed(curr.speed)
  hud.setFade(game.fade)
  if (debug) {
    hud.perf(
      frameMs,
      simMs,
      `slip ${curr.slipAngle.toFixed(2)}  air ${curr.grounded ? '-' : curr.airTime.toFixed(2)}  grass ${curr.wheelsOnGrass}  steer ${c.steer.toFixed(2)}`,
    )
  }
  renderer.render(scene, rig.camera)
}
requestAnimationFrame(frame)
