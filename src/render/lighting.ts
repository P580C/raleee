/**
 * Lights, shadows, environment fill, ambient occlusion, depth of field, bloom and tone mapping, all driven
 * live from `look`. Ported from the Brick Snap Lab mini-game (src/lighting.ts there) so both games share
 * one look; converted to metres, an orthographic camera, and a sun + shadow map that follow the car.
 *
 * Must be imported before any material compiles (it patches three's shadow chunk for PCSS).
 */
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  Box3,
  Color,
  DirectionalLight,
  HalfFloatType,
  HemisphereLight,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  MathUtils,
  NeutralToneMapping,
  type Object3D,
  type OrthographicCamera,
  PCFShadowMap,
  PCFSoftShadowMap,
  PMREMGenerator,
  type Scene,
  ShaderChunk,
  type IUniform,
  Vector2,
  Vector3,
  VSMShadowMap,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { look } from './look'
import { plasticUniforms } from './materials'

// ---------- Contact-hardening soft shadows (PCSS) ----------
// Patched into three's PCF shadow path before any material compiles. Enabled per material by the
// USE_PCSS define. Reuses the light's shadow.radius uniform as k: penumbra width in shadow-map UV per
// unit of (receiver - blocker) depth.
const PCSS_GLSL = /* glsl */ `
#ifdef USE_PCSS
#define PCSS_SAMPLES 16
vec2 pcssDisk( int i, float spin ) {
	float r = sqrt( ( float( i ) + 0.5 ) / float( PCSS_SAMPLES ) );
	float a = float( i ) * 2.39996323 + spin;
	return vec2( cos( a ), sin( a ) ) * r;
}
float PCSS( sampler2D shadowMap, vec4 c, float k, vec2 mapSize ) {
	float spin = 6.2831853 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
	float searchR = k * 0.1;
	float zSum = 0.0, n = 0.0;
	for ( int i = 0; i < PCSS_SAMPLES; i ++ ) {
		float d = unpackRGBAToDepth( texture2D( shadowMap, c.xy + pcssDisk( i, spin ) * searchR ) );
		if ( d < c.z ) { zSum += d; n += 1.0; }
	}
	if ( n < 1.0 ) return 1.0;
	float pen = max( k * ( c.z - zSum / n ), 1.0 / mapSize.x );
	float s = 0.0;
	for ( int i = 0; i < PCSS_SAMPLES; i ++ ) s += texture2DCompare( shadowMap, c.xy + pcssDisk( i, spin + 1.3 ) * pen, c.z );
	return s / float( PCSS_SAMPLES );
}
#endif
`
let pcssInstalled = false
;(function installPCSS() {
  const src = ShaderChunk.shadowmap_pars_fragment
  const fn = src.indexOf('float getShadow(')
  const branch = '#if defined( SHADOWMAP_TYPE_PCF )'
  const at = src.indexOf(branch, fn)
  if (fn < 0 || at < 0) {
    console.warn('PCSS: shadow chunk layout not recognised; Contact shadows unavailable')
    return
  }
  ShaderChunk.shadowmap_pars_fragment =
    src.slice(0, fn) +
    PCSS_GLSL +
    src.slice(fn, at) +
    '#if defined( SHADOWMAP_TYPE_PCF ) && defined( USE_PCSS )\n\t\t\tshadow = PCSS( shadowMap, shadowCoord, shadowRadius, shadowMapSize );\n\t\t#elif defined( SHADOWMAP_TYPE_PCF )' +
    src.slice(at + branch.length)
  pcssInstalled = true
})()

// ---------- Constants (metres) ----------
const SUN_DIST = 150
/** Shadow camera half-width: covers the visible stretch of stage around the car. */
const SHADOW_HALF = 75
const SHADOW_MAP = 2048
const SHADOW_NEAR = 1
const SHADOW_FAR = 400
/** A typical blocker height (the car, a tree) for the Soft blur penumbra. */
const BLOCKER_H = 2.6
const HEMI_BASE = 0.9
const ENV_BASE = 0.55
const BOUNCE_ALBEDO = 0.5
// Depth of field: blur = (focus depth - pixel depth) x aperture, clamped to maxblur (UV).
const DOF_APERTURE = 5e-4
const DOF_MAXBLUR = 0.012
/** Floor colour around the road. */
export const BACKGROUND = '#eae9f2'

const WHITE = new Color(0xffffff)
const GOLDEN = new Color(0xffc48a)
const SHADOW_TYPES = { pcfSoft: PCFSoftShadowMap, vsm: VSMShadowMap, pcss: PCFShadowMap } as const
const TONE_MAPS = { aces: ACESFilmicToneMapping, agx: AgXToneMapping, neutral: NeutralToneMapping } as const

function makeSky(scale: number): Sky {
  const s = new Sky()
  s.scale.setScalar(scale)
  const u = s.material.uniforms
  u.rayleigh.value = 1.2
  u.mieCoefficient.value = 0.004
  u.mieDirectionalG.value = 0.8
  return s
}

export class Lighting {
  private readonly sun = new DirectionalLight(0xffffff, 2.2)
  private readonly hemi = new HemisphereLight(0xffffff, 0xd8d2c8, HEMI_BASE)
  /** Fake bounce: black from above, coloured from below, so only faces turned to the ground get it. */
  private readonly bounceLight = new HemisphereLight(0x000000, 0x000000, 0)
  private readonly bounceSource = new Color(BACKGROUND)
  private readonly pmrem: PMREMGenerator
  private readonly studioEnv
  private readonly envScene: Scene
  private readonly envSky = makeSky(90)
  private skyEnv: WebGLRenderTarget | null = null
  private skyEnvKey = ''
  private readonly composer: EffectComposer
  private readonly gtao: GTAOPass
  private readonly bokeh: BokehPass
  private readonly bloom: UnrealBloomPass
  private appliedShadow: string | null = null
  private sunScale = 1
  private ambientScale = 1
  private readonly sunTint = new Color(0xffffff)
  private readonly sunDir = new Vector3()
  private readonly lightRight = new Vector3()
  private readonly lightUp = new Vector3()
  private readonly focus = new Vector3()
  private readonly clip = new Box3()
  private readonly fwd = new Vector3()

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: OrthographicCamera,
  ) {
    scene.background = new Color(BACKGROUND)
    renderer.shadowMap.enabled = true

    this.pmrem = new PMREMGenerator(renderer)
    this.studioEnv = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = this.studioEnv
    this.envScene = new (scene.constructor as new () => Scene)()
    // No sun disc in the captured environment: the directional light already is the sun.
    this.envSky.material.fragmentShader = this.envSky.material.fragmentShader.replace('L0 += ( vSunE * 19000.0 * Fex ) * sundisk;', '')
    this.envScene.add(this.envSky)

    const sun = this.sun
    sun.castShadow = true
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP)
    Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: SHADOW_NEAR, far: SHADOW_FAR })
    sun.shadow.camera.updateProjectionMatrix()
    sun.shadow.bias = -0.0003
    sun.shadow.normalBias = 0.05
    scene.add(this.hemi, this.bounceLight, sun, sun.target)

    // Post chain, used only when AO, DoF or bloom is on.
    const size = renderer.getSize(new Vector2())
    const pr = renderer.getPixelRatio()
    this.composer = new EffectComposer(renderer, new WebGLRenderTarget(size.x * pr, size.y * pr, { type: HalfFloatType, samples: 4 }))
    this.composer.addPass(new RenderPass(scene, camera))
    this.gtao = new GTAOPass(scene, camera, size.x, size.y)
    this.composer.addPass(this.gtao)
    if (new URLSearchParams(location.search).get('ao') === 'debug') this.gtao.output = GTAOPass.OUTPUT.Denoise
    this.bokeh = new BokehPass(scene, camera, { focus: 100, aperture: 0, maxblur: DOF_MAXBLUR })
    // Orthographic camera: linear depth, and the aspect comes from the viewport (camera.aspect is undefined).
    const bm = (this.bokeh as unknown as { materialBokeh: { defines: Record<string, number>; needsUpdate: boolean } }).materialBokeh
    bm.defines.PERSPECTIVE_CAMERA = 0
    bm.needsUpdate = true
    this.composer.addPass(this.bokeh)
    this.bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0, 0.4, 0.9)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.apply()
  }

  /**
   * Weather and time of day: dims the sun (and its shadows and bounce), tints it (moonlight), scales the
   * sky / environment fill, and changes the floor colour. (1, BACKGROUND, 1, white) = a clear day.
   */
  setWeather(sunScale: number, background: string, ambientScale = 1, sunTint: string = '#ffffff'): void {
    this.sunScale = sunScale
    this.ambientScale = ambientScale
    this.sunTint.set(sunTint)
    ;(this.scene.background as Color).set(background)
    this.apply()
  }

  /** The colour the sun bounces off (the grass). */
  setBounceSource(c: Color | string): void {
    this.bounceSource.set(c)
    this.apply()
  }

  resize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this.composer.setSize(width, height)
    const u = this.bokeh.uniforms as Record<string, IUniform>
    u.aspect.value = width / height
  }

  /** Give a material created after start-up the current shadow setup. */
  prepareMaterial(m: Material): void {
    if (look.shadowType === 'pcss' && pcssInstalled) {
      m.defines ??= {}
      m.defines.USE_PCSS = ''
    }
  }

  /** prepareMaterial for every material under an object added after startup (stages, cars). */
  prepareObject(o: Object3D): void {
    o.traverse((c) => {
      const m = (c as Mesh).material as Material | Material[] | undefined
      if (Array.isArray(m)) m.forEach((x) => this.prepareMaterial(x))
      else if (m) this.prepareMaterial(m)
    })
  }

  private setShadowType(): void {
    if (this.appliedShadow === look.shadowType) return
    this.appliedShadow = look.shadowType
    const usePcss = look.shadowType === 'pcss' && pcssInstalled
    this.renderer.shadowMap.type = usePcss ? PCFShadowMap : look.shadowType === 'pcss' ? PCFSoftShadowMap : SHADOW_TYPES[look.shadowType]
    this.sun.shadow.map?.dispose()
    ;(this.sun.shadow as { map: unknown }).map = null // rebuilt in the right format on the next render
    this.scene.traverse((o) => {
      const m = (o as Mesh).material as Material | undefined
      if (!m || !((m as MeshStandardMaterial).isMeshStandardMaterial || (m as { isShadowMaterial?: boolean }).isShadowMaterial)) return
      m.defines ??= {}
      if (usePcss) m.defines.USE_PCSS = ''
      else delete m.defines.USE_PCSS
      m.needsUpdate = true
    })
  }

  private applySky(): void {
    const s = this.envSky.material.uniforms
    s.sunPosition.value.copy(this.sunDir)
    s.turbidity.value = look.skyHaze
    if (look.environment === 'sky') {
      const d = this.sunDir
      const key = `${d.x.toFixed(4)},${d.y.toFixed(4)},${d.z.toFixed(4)}|${look.skyHaze}`
      if (key !== this.skyEnvKey) {
        this.skyEnvKey = key
        this.skyEnv?.dispose()
        this.skyEnv = this.pmrem.fromScene(this.envScene, 0, 0.1, 100)
      }
      this.scene.environment = this.skyEnv!.texture
    } else {
      this.scene.environment = this.studioEnv
    }
  }

  /** Push the look parameters into the scene. Cheap; call on any change. */
  apply(): void {
    this.setShadowType()
    const el = MathUtils.degToRad(look.sunElevation)
    const az = MathUtils.degToRad(look.sunAzimuth)
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
    // Shadow-map axes, for snapping the follow position to whole texels (no shimmer while driving).
    this.lightRight.set(0, 1, 0).cross(this.sunDir).normalize()
    this.lightUp.copy(this.sunDir).cross(this.lightRight).normalize()
    this.applySky()
    const sun = this.sun
    sun.color.lerpColors(WHITE, GOLDEN, look.sunWarmth).multiply(this.sunTint)
    sun.intensity = look.sunIntensity * this.sunScale
    sun.shadow.intensity = look.shadowStrength * this.sunScale
    const spread = Math.tan(MathUtils.degToRad(look.sunSize))
    if (look.shadowType === 'vsm') {
      const texel = (2 * SHADOW_HALF) / SHADOW_MAP
      sun.shadow.radius = Math.max(1, (BLOCKER_H * spread) / texel)
      sun.shadow.blurSamples = 16
    } else if (look.shadowType === 'pcss') {
      sun.shadow.radius = ((SHADOW_FAR - SHADOW_NEAR) * spread) / (2 * SHADOW_HALF)
    } else {
      sun.shadow.radius = 4
    }
    this.hemi.intensity = HEMI_BASE * look.skyLight * this.ambientScale
    this.bounceLight.groundColor.copy(this.bounceSource).multiply(sun.color)
    this.bounceLight.intensity = look.bounce * look.sunIntensity * this.sunScale * BOUNCE_ALBEDO
    plasticUniforms.plasticGlow.value = look.glow
    this.scene.environmentIntensity = ENV_BASE * look.skyLight * this.ambientScale
    this.renderer.toneMapping = TONE_MAPS[look.toneMap]
    this.renderer.toneMappingExposure = look.exposure
    // GTAO's `scale` is an exponent on the occlusion term; it's the real strength control.
    this.gtao.blendIntensity = 1
    this.gtao.updateGtaoMaterial({ radius: look.aoRadius, thickness: look.aoRadius, distanceFallOff: 1, scale: look.ao })
    this.gtao.enabled = look.ao > 0
    this.bokeh.enabled = look.dof > 0
    ;(this.bokeh.uniforms as Record<string, IUniform>).aperture.value = look.dof * DOF_APERTURE
    this.bloom.enabled = look.bloom > 0
    this.bloom.strength = look.bloom
  }

  /**
   * Call once per frame after the camera moved. `fx, fy, fz` is the car: the sun and its shadow map are
   * centred a little up-screen of it, and depth of field focuses on it.
   */
  update(fx: number, fy: number, fz: number, upX: number, upZ: number): void {
    // Centre the shadow box ahead (up-screen) of the car, where most of the visible stage is.
    const f = this.focus.set(fx + upX * 25, fy, fz + upZ * 25)
    const texel = (2 * SHADOW_HALF) / SHADOW_MAP
    const a = Math.round(f.dot(this.lightRight) / texel) * texel - f.dot(this.lightRight)
    const b = Math.round(f.dot(this.lightUp) / texel) * texel - f.dot(this.lightUp)
    f.addScaledVector(this.lightRight, a).addScaledVector(this.lightUp, b)
    this.sun.target.position.copy(f)
    this.sun.position.copy(f).addScaledVector(this.sunDir, SUN_DIST)
    this.sun.target.updateMatrixWorld()

    if (look.ao > 0) {
      this.clip.min.set(fx - 120, fy - 40, fz - 120)
      this.clip.max.set(fx + 120, fy + 40, fz + 120)
      this.gtao.setSceneClipBox(this.clip)
    }
    if (look.dof > 0) {
      this.camera.getWorldDirection(this.fwd)
      const depth = (fx - this.camera.position.x) * this.fwd.x + (fy - this.camera.position.y) * this.fwd.y + (fz - this.camera.position.z) * this.fwd.z
      ;(this.bokeh.uniforms as Record<string, IUniform>).focus.value = depth
    }
  }

  /** Render one frame: straight to screen, or through the composer when any effect is on. */
  render(): void {
    if (look.ao > 0 || look.dof > 0 || look.bloom > 0) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }
}
