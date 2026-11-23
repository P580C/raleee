export const TAU = Math.PI * 2

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function moveTowards(v: number, target: number, maxDelta: number): number {
  if (Math.abs(target - v) <= maxDelta) return target
  return v + Math.sign(target - v) * maxDelta
}

export function wrapAngle(a: number): number {
  a = a % TAU
  if (a > Math.PI) a -= TAU
  else if (a <= -Math.PI) a += TAU
  return a
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t
}
