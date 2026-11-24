/**
 * Shared materials, matching the Brick Snap Lab look: the car is glossy toy plastic (clearcoat plus a
 * fake-subsurface "glow"), the world is matte. Both stay flat-shaded for the low-poly style.
 */
import { type ColorRepresentation, MeshPhysicalMaterial, type Texture, MeshStandardMaterial, type MeshStandardMaterialParameters, ShaderChunk, type WebGLProgramParametersWithUniforms } from 'three'

/** Shared by every plastic material; lighting.ts sets it from look.glow. 0 = plain physical shading. */
export const plasticUniforms = { plasticGlow: { value: 0 } }

// Fake subsurface scattering: after three's Lambert diffuse for each direct light, add a "wrapped" diffuse
// term that reaches past the terminator, in a more saturated version of the colour. Largest where the
// light grazes (edges, bevels), zero where it faces head on. Specular and clearcoat are untouched.
const DIFFUSE_LINE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );'
const GLOW_GLSL = `
	{
		float nl = dot( geometryNormal, directLight.direction );
		float w = plasticGlow * 0.6;
		float wrapNL = saturate( ( nl + w ) / ( 1.0 + w ) );
		vec3 scatter = pow( material.diffuseColor, vec3( 1.5 ) ) * 1.3;
		reflectedLight.directDiffuse += max( wrapNL - saturate( nl ), 0.0 ) * ( 1.0 + plasticGlow ) * directLight.color * BRDF_Lambert( scatter );
	}`
const glowChunk = ShaderChunk.lights_physical_pars_fragment.includes(DIFFUSE_LINE)
  ? ShaderChunk.lights_physical_pars_fragment.replace(DIFFUSE_LINE, DIFFUSE_LINE + GLOW_GLSL)
  : null
if (!glowChunk) console.warn('Plastic glow: lighting chunk layout not recognised; glow unavailable')

function onPlasticCompile(shader: WebGLProgramParametersWithUniforms): void {
  if (!glowChunk) return
  Object.assign(shader.uniforms, plasticUniforms)
  shader.fragmentShader = 'uniform float plasticGlow;\n' + shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', glowChunk)
}

const plasticCache = new Map<string, MeshPhysicalMaterial>()

/** Glossy toy plastic (the car). Cached per colour. */
export function plastic(color: ColorRepresentation): MeshPhysicalMaterial {
  const key = String(color)
  let m = plasticCache.get(key)
  if (!m) {
    m = new MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 0.35, clearcoatRoughness: 0.25, flatShading: true })
    m.onBeforeCompile = onPlasticCompile
    m.customProgramCacheKey = () => 'plastic'
    plasticCache.set(key, m)
  }
  return m
}

/**
 * Toy plastic that takes its colours from a texture: LEGO imports carry a shared palette texture (one texel
 * per LDraw colour, NEAREST filtered) and per-vertex UVs into it. Smooth normals come from the import.
 */
export function plasticMapped(map: Texture, transparent = false): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({ map, roughness: 0.3, clearcoat: 0.35, clearcoatRoughness: 0.25, transparent, opacity: transparent ? 0.6 : 1 })
  m.onBeforeCompile = onPlasticCompile
  m.customProgramCacheKey = () => 'plastic'
  return m
}

/** Matte world surfaces (ground, road, trees, props). */
export function matte(params: MeshStandardMaterialParameters = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true, ...params })
}
