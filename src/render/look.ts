/**
 * Look (lighting and rendering) parameters, ported from the Brick Snap Lab mini-game so both share one
 * look. Distances are in metres here (the mini-game used LDU; 1 brick height ≈ 2.6 m car height).
 * Sun azimuth is measured like the mini-game (0° = from +z, positive toward +x); the presets are rotated
 * so the sun sits in the same place relative to this game's camera (yaw 45°) as in the mini-game (yaw ~29°).
 */
export type ShadowType = 'pcfSoft' | 'vsm' | 'pcss'
export type ToneMap = 'aces' | 'agx' | 'neutral'
export type EnvMode = 'studio' | 'sky'

export interface Look {
  environment: EnvMode
  shadowType: ShadowType
  toneMap: ToneMap
  /** Bigger light, softer shadows (degrees; Soft blur and Contact only). */
  sunSize: number
  shadowStrength: number
  sunIntensity: number
  sunElevation: number
  sunAzimuth: number
  /** White to golden-hour orange. */
  sunWarmth: number
  /** Outdoor sky only: low is deep blue, high is pale and milky. */
  skyHaze: number
  /** Soft fill from the environment and sky. */
  skyLight: number
  /** Sunlight reflected off the grass onto undersides, tinted by it. */
  bounce: number
  /** Car paint: light wrapping past the shadow line with a richer tint (fake subsurface). */
  glow: number
  /** Screen-space ambient occlusion strength (post-processing; costs frame rate). 0 = off. */
  ao: number
  /** AO radius (m). */
  aoRadius: number
  /** Depth of field (tilt-shift), focused on the car. 0 = off. */
  dof: number
  /** Bloom on the brightest highlights. 0 = off. */
  bloom: number
  exposure: number
}

/** Mini-game azimuths are relative to its camera yaw (~29°); this camera is at 45°. */
const AZ = 16

export const LOOKS: { label: string; values: Look }[] = [
  { label: 'Studio', values: { environment: 'studio', shadowType: 'pcfSoft', toneMap: 'aces', sunWarmth: 0, skyHaze: 2, sunSize: 3, shadowStrength: 1, sunIntensity: 2.2, sunElevation: 54.5, sunAzimuth: 38 + AZ, skyLight: 1, ao: 0, aoRadius: 1.3, exposure: 1, bounce: 0, glow: 0, dof: 0, bloom: 0 } },
  { label: 'Soft', values: { environment: 'studio', shadowType: 'pcss', toneMap: 'aces', sunWarmth: 0, skyHaze: 2, sunSize: 5, shadowStrength: 0.9, sunIntensity: 1.8, sunElevation: 50, sunAzimuth: -45 + AZ, skyLight: 1.3, ao: 0, aoRadius: 1.3, exposure: 1, bounce: 0, glow: 0, dof: 0, bloom: 0 } },
  { label: 'GI look', values: { environment: 'studio', shadowType: 'pcss', toneMap: 'neutral', sunWarmth: 0, skyHaze: 2, sunSize: 8, shadowStrength: 0.8, sunIntensity: 1.4, sunElevation: 55, sunAzimuth: -45 + AZ, skyLight: 1.7, ao: 2.5, aoRadius: 1.8, exposure: 1.05, bounce: 0.4, glow: 0, dof: 0, bloom: 0 } },
  { label: 'Overcast', values: { environment: 'studio', shadowType: 'vsm', toneMap: 'agx', sunWarmth: 0, skyHaze: 2, sunSize: 12, shadowStrength: 0.6, sunIntensity: 0.9, sunElevation: 70, sunAzimuth: -30 + AZ, skyLight: 2.2, ao: 2, aoRadius: 2.6, exposure: 1.1, bounce: 0, glow: 0, dof: 0, bloom: 0 } },
  { label: 'Outdoor', values: { environment: 'sky', shadowType: 'pcss', toneMap: 'neutral', sunWarmth: 0.55, skyHaze: 2.5, sunSize: 3, shadowStrength: 0.9, sunIntensity: 2.6, sunElevation: 22, sunAzimuth: -45 + AZ, skyLight: 1, ao: 2, aoRadius: 1.8, exposure: 1, bounce: 0.7, glow: 0.6, dof: 0.5, bloom: 0.15 } },
  // Outdoor without the post-processing chain (AO, DoF, bloom): ~4x cheaper per frame. Not in the mini-game.
  { label: 'Outdoor lite', values: { environment: 'sky', shadowType: 'pcss', toneMap: 'neutral', sunWarmth: 0.55, skyHaze: 2.5, sunSize: 3, shadowStrength: 0.9, sunIntensity: 2.6, sunElevation: 22, sunAzimuth: -45 + AZ, skyLight: 1, ao: 0, aoRadius: 1.8, exposure: 1, bounce: 0.7, glow: 0.6, dof: 0, bloom: 0 } },
]

/**
 * Default look: "Outdoor lite" (low warm sun, sky fill, contact shadows, plastic glow, no post-processing).
 * Full "Outdoor" adds AO, tilt-shift DoF and bloom but measured ~30 ms a frame even on an M4 Mac.
 */
export const lookDefaults: Readonly<Look> = Object.freeze({ ...LOOKS[5].values })
/** Live look values. Mutated in place. */
export const look: Look = { ...lookDefaults }

export type LookNumberKey = { [K in keyof Look]: Look[K] extends number ? K : never }[keyof Look]
export type LookChoiceKey = 'environment' | 'shadowType' | 'toneMap'

export const LOOK_CHOICES: [LookChoiceKey, string, [string, string][]][] = [
  ['environment', 'Environment', [['studio', 'Studio'], ['sky', 'Outdoor sky']]],
  ['shadowType', 'Shadows', [['pcfSoft', 'Studio'], ['vsm', 'Soft blur'], ['pcss', 'Contact']]],
  ['toneMap', 'Tone mapping', [['aces', 'ACES'], ['agx', 'AgX'], ['neutral', 'Neutral']]],
]

export const LOOK_SLIDERS: [LookNumberKey, number, number, number][] = [
  ['sunSize', 0.5, 20, 0.5],
  ['shadowStrength', 0, 1, 0.01],
  ['sunIntensity', 0, 4, 0.05],
  ['sunElevation', 15, 89, 0.5],
  ['sunAzimuth', -180, 180, 1],
  ['sunWarmth', 0, 1, 0.01],
  ['skyHaze', 1, 10, 0.1],
  ['skyLight', 0, 3, 0.05],
  ['bounce', 0, 1.5, 0.05],
  ['glow', 0, 1, 0.05],
  ['ao', 0, 4, 0.05],
  ['aoRadius', 0.2, 5, 0.1],
  ['dof', 0, 1, 0.01],
  ['bloom', 0, 1, 0.01],
  ['exposure', 0.5, 2, 0.01],
]

const STORAGE_KEY = 'raleee.look.v1'

export function loadLookOverrides(): void {
  try {
    const o = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Record<string, unknown> | null
    if (!o) return
    for (const k of Object.keys(lookDefaults) as (keyof Look)[]) {
      if (k in o && typeof o[k] === typeof lookDefaults[k]) (look as unknown as Record<string, unknown>)[k] = o[k]
    }
  } catch {
    /* ignore corrupt storage */
  }
}

export function lookDiff(): Partial<Look> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(look) as (keyof Look)[]) if (look[k] !== lookDefaults[k]) out[k] = look[k]
  return out as Partial<Look>
}

export function saveLookOverrides(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lookDiff()))
  } catch {
    /* storage may be unavailable */
  }
}

export function resetLook(): void {
  Object.assign(look, lookDefaults)
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
