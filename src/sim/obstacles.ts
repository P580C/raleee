/**
 * Static obstacles (scenery the car can hit), as convex outlines on the ground plane with a top height.
 * Pure data and maths, no three.js: the renderer builds the outlines from imported models and hands them
 * to the sim through `Track.obstacles`.
 *
 * The car is two circles along its centreline. Each is pushed out of any outline it overlaps, and the car
 * gets an impulse at the contact point (bounce + friction + spin), like a light rigid body.
 */

export interface Obstacle {
  /** Bounding circle (broad phase). */
  cx: number
  cz: number
  r: number
  /** World height of the base. */
  base: number
  /** World height of the top: a car above it (mid-jump) passes over. */
  top: number
  /** Convex outline, counter-clockwise in (x, z): x0, z0, x1, z1, ... */
  pts: Float64Array
  n: number
}

/** Convex hull (monotone chain) of points given as x0, z0, x1, z1, ...; counter-clockwise in (x, z). */
export function convexHull(xz: ArrayLike<number>): Float64Array {
  const n = xz.length / 2
  const idx = Array.from({ length: n }, (_, i) => i)
  idx.sort((a, b) => xz[a * 2] - xz[b * 2] || xz[a * 2 + 1] - xz[b * 2 + 1])
  const cross = (o: number, a: number, b: number) =>
    (xz[a * 2] - xz[o * 2]) * (xz[b * 2 + 1] - xz[o * 2 + 1]) - (xz[a * 2 + 1] - xz[o * 2 + 1]) * (xz[b * 2] - xz[o * 2])
  const lower: number[] = []
  for (const p of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: number[] = []
  for (let k = idx.length - 1; k >= 0; k--) {
    const p = idx[k]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  const out = new Float64Array(hull.length * 2)
  hull.forEach((p, i) => {
    out[i * 2] = xz[p * 2]
    out[i * 2 + 1] = xz[p * 2 + 1]
  })
  return out
}

/** Place a local outline (from convexHull) at (x, z), turned by yaw about +y, with its base at height y. */
export function makeObstacle(local: Float64Array, height: number, x: number, y: number, z: number, yaw: number): Obstacle {
  const n = local.length / 2
  const pts = new Float64Array(local.length)
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  let cx = 0
  let cz = 0
  for (let i = 0; i < n; i++) {
    const lx = local[i * 2]
    const lz = local[i * 2 + 1]
    // Rotation about +y keeps the winding: x' = x cos + z sin, z' = -x sin + z cos.
    pts[i * 2] = x + lx * c + lz * s
    pts[i * 2 + 1] = z - lx * s + lz * c
    cx += pts[i * 2] / n
    cz += pts[i * 2 + 1] / n
  }
  let r = 0
  for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(pts[i * 2] - cx, pts[i * 2 + 1] - cz))
  return { cx, cz, r, base: y, top: y + height, pts, n }
}

/** Result of a circle test (reused, never reallocated). */
export const contact = { depth: 0, nx: 0, nz: 0, px: 0, pz: 0 }

/**
 * Circle (x, z, radius) against a convex outline. Returns true on overlap and fills `contact`: depth to push
 * the circle out along (nx, nz), and the contact point (px, pz) on the outline.
 */
export function circleVsObstacle(x: number, z: number, radius: number, o: Obstacle): boolean {
  const dx0 = x - o.cx
  const dz0 = z - o.cz
  const reach = o.r + radius
  if (dx0 * dx0 + dz0 * dz0 > reach * reach) return false
  const p = o.pts
  const n = o.n
  // Deepest edge (largest signed distance outward); all <= 0 means the centre is inside.
  let maxSep = -Infinity
  let bnx = 0
  let bnz = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ax = p[i * 2]
    const az = p[i * 2 + 1]
    const ex = p[j * 2] - ax
    const ez = p[j * 2 + 1] - az
    const len = Math.hypot(ex, ez) || 1
    // Outward normal of a counter-clockwise edge in (x, z): (ez, -ex).
    const nx = ez / len
    const nz = -ex / len
    const sep = (x - ax) * nx + (z - az) * nz
    if (sep > maxSep) {
      maxSep = sep
      bnx = nx
      bnz = nz
    }
  }
  if (maxSep <= 0) {
    contact.depth = radius - maxSep
    contact.nx = bnx
    contact.nz = bnz
    contact.px = x - bnx * (radius + maxSep)
    contact.pz = z - bnz * (radius + maxSep)
    return true
  }
  if (maxSep >= radius) return false
  // Outside: nearest point on the boundary.
  let best = Infinity
  let qx = 0
  let qz = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ax = p[i * 2]
    const az = p[i * 2 + 1]
    const ex = p[j * 2] - ax
    const ez = p[j * 2 + 1] - az
    const l2 = ex * ex + ez * ez || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2))
    const cx = ax + ex * t
    const cz = az + ez * t
    const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz)
    if (d2 < best) {
      best = d2
      qx = cx
      qz = cz
    }
  }
  const d = Math.sqrt(best)
  if (d >= radius || d < 1e-9) return false
  contact.depth = radius - d
  contact.nx = (x - qx) / d
  contact.nz = (z - qz) / d
  contact.px = qx
  contact.pz = qz
  return true
}
