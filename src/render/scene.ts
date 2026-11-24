import { Scene, WebGLRenderer } from 'three'

/** Renderer and empty scene. Lights, environment, shadows and post-processing live in lighting.ts. */
export function createScene(container: HTMLElement): { renderer: WebGLRenderer; scene: Scene } {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  container.appendChild(renderer.domElement)
  return { renderer, scene: new Scene() }
}
