import { Color, DirectionalLight, HemisphereLight, Scene, WebGLRenderer } from 'three'

export const BACKGROUND = '#e9edf0'

export function createScene(container: HTMLElement): { renderer: WebGLRenderer; scene: Scene } {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  container.appendChild(renderer.domElement)

  const scene = new Scene()
  scene.background = new Color(BACKGROUND)

  // Soft, flat look: strong sky fill plus one warm key light.
  scene.add(new HemisphereLight('#ffffff', '#a6aeb8', 1.9))
  const sun = new DirectionalLight('#fff4e2', 1.7)
  sun.position.set(-40, 80, 25)
  scene.add(sun)

  return { renderer, scene }
}
