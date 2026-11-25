/**
 * Slot-car style track pieces: a stage is a start heading plus a list of pieces laid end to end, like a
 * Scalextric set. Headings stay on multiples of 45 degrees, so straights line up with the isometric grid
 * (they run along the screen diagonals, or straight up the screen after a 45 degree bend).
 *
 * Pure data and maths (no three.js). `piecesToTrackData` turns a piece list into the spline format the sim
 * already uses: points every few metres along exact arcs, so the centreline is the true geometry.
 */
import type { JunctionData, SceneryItem, SurfaceName, TrackData, TrackPoint } from './track'

export type PieceKind = 'straight' | 'bend45' | 'bend90' | 'large90' | 'small90' | 'roundabout'
/** L / R for bends; roundabouts also take S (straight on). */
export type Turn = 'L' | 'R' | 'S'

export interface Piece {
  k: PieceKind
  /** Bends: turn left or right (driver's view). Roundabouts: which exit (L, S = straight on, R). */
  t?: Turn
  /** Surface from this piece on (inherits from the previous piece if omitted). */
  surface?: SurfaceName
  /** Height change over the piece (m): ramps up or down a level. */
  rise?: number
}

export interface PieceTrackData {
  format: 'pieces'
  name: string
  /** Start heading in degrees (multiple of 45): 0 = +z, 90 = +x. 225 drives straight up the screen. */
  heading: number
  width?: number
  verge?: number
  island?: number
  pieces: Piece[]
  /** Scenery placed in the editor. */
  scenery?: SceneryItem[]
  /** Scatter the test mounds along the road (default true). */
  autoScenery?: boolean
}

export interface PieceSpec {
  label: string
  /** Turn angle (degrees); 0 for a straight. */
  angle: number
  /** Centreline radius (m) for bends. */
  radius: number
  /** Length (m) for straights. */
  length: number
}

export const PIECES: Record<PieceKind, PieceSpec> = {
  straight: { label: 'Straight', angle: 0, radius: 0, length: 32 },
  bend45: { label: '45° bend', angle: 45, radius: 40, length: 0 },
  bend90: { label: '90° bend', angle: 90, radius: 32, length: 0 },
  large90: { label: 'Large 90°', angle: 90, radius: 56, length: 0 },
  small90: { label: 'Small 90°', angle: 90, radius: 18, length: 0 },
  // Footprint like a 90° bend (or two straights when going straight on): exits sit `radius` from the centre.
  roundabout: { label: 'Roundabout', angle: 90, radius: 32, length: 0 },
}

/**
 * Roundabout geometry (m). The centre sits REACH ahead of the entry; the four arms end REACH from it, so the
 * piece lines up with the grid like a 90° bend. You turn right onto the ring, go round with the island on
 * your left, and turn right off it (driver's view): approach, entry fillet, ring arc, exit fillet, exit.
 */
export const ROUNDABOUT = { reach: 32, ring: 20, fillet: 12 }
const RB_Y1 = ROUNDABOUT.reach - Math.sqrt((ROUNDABOUT.ring + ROUNDABOUT.fillet) ** 2 - ROUNDABOUT.fillet ** 2)
/** Fillet turn angle (rad); the ring is joined DELTA past the arm's own direction. */
const RB_ALPHA = -Math.atan2(RB_Y1 - ROUNDABOUT.reach, ROUNDABOUT.fillet)
const RB_DELTA = Math.PI / 2 - RB_ALPHA
/** Exit arm angle around the centre, measured from the right (local frame, x right, y forward). */
const RB_EXIT: Record<string, number> = { R: 0, S: Math.PI / 2, L: Math.PI }

/** Exit heading change (degrees, + = left). */
function turnDegOf(p: Piece): number {
  if (p.k === 'roundabout') return p.t === 'L' ? 90 : p.t === 'R' ? -90 : 0
  return PIECES[p.k].angle * (p.t === 'R' ? -1 : 1)
}

/** Driving line through a roundabout as local (x right, y forward) points about `step` apart. */
function roundaboutLine(exit: Turn, step: number): { pts: [number, number][]; length: number } {
  const { reach: C, ring: R, fillet: F } = ROUNDABOUT
  const entry: [number, number][] = []
  const n1 = Math.max(1, Math.ceil(RB_Y1 / step))
  for (let k = 1; k <= n1; k++) entry.push([0, (RB_Y1 * k) / n1])
  const n2 = Math.max(2, Math.ceil((F * RB_ALPHA) / step))
  for (let k = 1; k <= n2; k++) {
    const t = (RB_ALPHA * k) / n2
    entry.push([F - F * Math.cos(t), RB_Y1 + F * Math.sin(t)])
  }
  const phi0 = -Math.PI / 2 + RB_DELTA
  const psi = RB_EXIT[exit] ?? RB_EXIT.S
  const phi1 = psi - RB_DELTA
  const ring: [number, number][] = []
  const n3 = Math.max(2, Math.ceil((R * (phi1 - phi0)) / step))
  for (let k = 1; k <= n3; k++) {
    const a = phi0 + ((phi1 - phi0) * k) / n3
    ring.push([R * Math.cos(a), C + R * Math.sin(a)])
  }
  // Exit: the entry mirrored across the line through the centre halfway between the two arms, reversed.
  const m2 = -Math.PI / 2 + psi
  const c2 = Math.cos(m2)
  const s2 = Math.sin(m2)
  const mirror = ([x, y]: [number, number]): [number, number] => {
    const vy = y - C
    return [x * c2 + vy * s2, C + x * s2 - vy * c2]
  }
  const exitPts = [[0, 0] as [number, number], ...entry.slice(0, -1)].reverse().map(mirror)
  return {
    pts: [...entry, ...ring, ...exitPts],
    length: 2 * RB_Y1 + 2 * F * RB_ALPHA + R * (phi1 - phi0),
  }
}
export const PIECE_KINDS = Object.keys(PIECES) as PieceKind[]

/** Height of one level (m): the editor's ramp pieces rise or drop by this. */
export const LEVEL = 2.5
/** Straight road before the start line, so the stage begins off the bottom of the screen (m). */
export const LEAD_IN = 200
/** Straight road after the finish line, to stop on (m). */
export const RUN_OUT = 60
/** Spacing of the generated centreline points (m). */
const STEP = 4

const DEFAULTS = { width: 14, verge: 2, island: 50 }

export function pieceLength(p: Piece): number {
  if (p.k === 'roundabout') return roundaboutLine(p.t ?? 'S', 4).length
  const s = PIECES[p.k]
  return s.angle === 0 ? s.length : (s.radius * s.angle * Math.PI) / 180
}

/** Position and heading on the ground. `deg` is the heading in degrees (kept exact), e the elevation. */
export interface Pose {
  x: number
  z: number
  deg: number
  e: number
}

export interface PieceLayout {
  points: TrackPoint[]
  /** Distance along the track (from the start of the lead-in) where each piece starts; one extra at the end. */
  pieceS: number[]
  /** Pose at the end of each piece (index -1 → the start line, use `start`). */
  ends: Pose[]
  start: Pose
  /** Centreline points per piece, for overlap tests: x, z, e triples. */
  piecePts: number[][]
  /** Lead-in and run-out points (x, z, e triples). */
  leadPts: number[]
  runPts: number[]
  junctions: JunctionData[]
}

/** Lay the pieces out from the origin. Points are spaced about STEP metres along exact arcs. */
export function layoutPieces(data: PieceTrackData): PieceLayout {
  const points: TrackPoint[] = []
  const pieceS: number[] = []
  const ends: Pose[] = []
  const piecePts: number[][] = []
  const junctions: JunctionData[] = []
  const pose: Pose = { x: 0, z: 0, deg: data.heading, e: 0 }
  const start = { ...pose }
  let s = 0

  const rad = (d: number) => (d * Math.PI) / 180
  const push = (x: number, z: number, e: number, out?: number[]) => {
    points.push({ x, z, e })
    out?.push(x, z, e)
  }
  /** Walk `len` metres turning `turnDeg` (signed, + = left) from the current pose, rising `rise`. */
  const walk = (len: number, turnDeg: number, rise: number, out?: number[]) => {
    const h0 = rad(pose.deg)
    const dx = Math.sin(h0)
    const dz = Math.cos(h0)
    // Left of travel (the car's local +x): d/dh of the heading vector. Turning left increases the heading.
    const lx = Math.cos(h0)
    const lz = -Math.sin(h0)
    const count = Math.max(1, Math.ceil(len / STEP))
    const x0 = pose.x
    const z0 = pose.z
    const e0 = pose.e
    const th = rad(Math.abs(turnDeg))
    const sg = Math.sign(turnDeg)
    const r = th > 0 ? len / th : 0
    for (let k = 1; k <= count; k++) {
      const f = k / count
      let x: number
      let z: number
      if (th === 0) {
        x = x0 + dx * len * f
        z = z0 + dz * len * f
      } else {
        const a = th * f
        x = x0 + r * (sg * lx * (1 - Math.cos(a)) + dx * Math.sin(a))
        z = z0 + r * (sg * lz * (1 - Math.cos(a)) + dz * Math.sin(a))
      }
      push(x, z, e0 + rise * f, out)
    }
    const last = points[points.length - 1]
    pose.x = last.x
    pose.z = last.z
    pose.e = last.e
    pose.deg = (((pose.deg + turnDeg) % 360) + 360) % 360
    s += len
  }

  /** A roundabout from the current pose (always flat). */
  const roundabout = (exit: Turn, out: number[]) => {
    const h0 = rad(pose.deg)
    const fx = Math.sin(h0)
    const fz = Math.cos(h0)
    // Right of travel = minus the left vector.
    const rx = -Math.cos(h0)
    const rz = Math.sin(h0)
    const line = roundaboutLine(exit, STEP)
    const x0 = pose.x
    const z0 = pose.z
    for (const [lx, ly] of line.pts) push(x0 + rx * lx + fx * ly, z0 + rz * lx + fz * ly, pose.e, out)
    const C = ROUNDABOUT.reach
    const cx = x0 + fx * C
    const cz = z0 + fz * C
    junctions.push({ x: cx, z: cz, e: pose.e, deg: pose.deg, exit, surface, reach: C, ring: ROUNDABOUT.ring })
    // The whole ring and the side arms take up space too (for overlap tests and framing).
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2
      out.push(cx + Math.cos(a) * ROUNDABOUT.ring, cz + Math.sin(a) * ROUNDABOUT.ring, pose.e)
    }
    for (const [ax, az] of [[rx, rz], [-rx, -rz]]) out.push(cx + ax * C, cz + az * C, pose.e)
    const last = points[points.length - 1]
    pose.x = last.x
    pose.z = last.z
    pose.deg = (((pose.deg + turnDegOf({ k: 'roundabout', t: exit })) % 360) + 360) % 360
    s += line.length
  }

  // Lead-in: start LEAD_IN metres behind the origin, heading in.
  const h = rad(data.heading)
  let surface: SurfaceName = data.pieces[0]?.surface ?? 'tarmac'
  const leadPts: number[] = []
  pose.x = -Math.sin(h) * LEAD_IN
  pose.z = -Math.cos(h) * LEAD_IN
  push(pose.x, pose.z, 0, leadPts)
  points[0].surface = surface
  walk(LEAD_IN, 0, 0, leadPts)

  for (const p of data.pieces) {
    if (p.surface && p.surface !== surface) {
      surface = p.surface
      points[points.length - 1].surface = surface
    }
    pieceS.push(s)
    const pts: number[] = []
    if (p.k === 'roundabout') roundabout(p.t ?? 'S', pts)
    else walk(pieceLength(p), turnDegOf(p), p.rise ?? 0, pts)
    piecePts.push(pts)
    ends.push({ ...pose })
  }
  pieceS.push(s)
  points[points.length - 1].finish = true
  const runPts: number[] = []
  walk(RUN_OUT, 0, 0, runPts)
  return { points, pieceS, ends, start, piecePts, leadPts, runPts, junctions }
}

export function piecesToTrackData(data: PieceTrackData): TrackData {
  const { points, junctions } = layoutPieces(data)
  return {
    junctions,
    scenery: data.scenery,
    autoScenery: data.autoScenery,
    name: data.name,
    width: data.width ?? DEFAULTS.width,
    verge: data.verge ?? DEFAULTS.verge,
    island: data.island ?? DEFAULTS.island,
    closed: false,
    start: LEAD_IN - 0.5,
    points,
  }
}

/**
 * Pieces whose road runs into another stretch of road at about the same height (a crossing or a pile-up).
 * Neighbouring pieces always touch, so only pieces at least two apart are compared.
 */
export function findOverlaps(layout: PieceLayout, width: number): Set<number> {
  const out = new Set<number>()
  const min2 = (width + 1) * (width + 1)
  // The lead-in and run-out count as pieces -1 and n.
  const groups = [layout.leadPts, ...layout.piecePts, layout.runPts]
  const n = groups.length
  for (let i = 0; i < n; i++) {
    const a = groups[i]
    for (let j = i + 2; j < n; j++) {
      const b = groups[j]
      let hit = false
      for (let p = 0; p < a.length && !hit; p += 3) {
        for (let q = 0; q < b.length; q += 3) {
          const dx = a[p] - b[q]
          const dz = a[p + 1] - b[q + 1]
          if (dx * dx + dz * dz < min2 && Math.abs(a[p + 2] - b[q + 2]) < 4) {
            hit = true
            break
          }
        }
      }
      if (hit) {
        if (i >= 1 && i <= n - 2) out.add(i - 1)
        if (j >= 1 && j <= n - 2) out.add(j - 1)
      }
    }
  }
  return out
}

/** Index of the piece at distance s along the track (-1 in the lead-in, pieces.length in the run-out). */
export function pieceAt(layout: PieceLayout, s: number): number {
  const ps = layout.pieceS
  if (s < ps[0]) return -1
  for (let i = 0; i < ps.length - 1; i++) if (s < ps[i + 1]) return i
  return ps.length - 1
}

/**
 * Compact notation for writing stages by hand: S = straight, L45/R45, L90/R90, LL/RL (large 90),
 * LS/RS (small 90), OL/OS/OR (roundabout, exit left / straight on / right). Append ^ to rise a level or v to drop one. A surface name changes the surface from the
 * next piece on.
 */
export function parsePieces(src: string): Piece[] {
  const out: Piece[] = []
  let surface: SurfaceName | undefined
  for (const tok of src.trim().split(/\s+/)) {
    if (tok === 'tarmac' || tok === 'gravel' || tok === 'grass') {
      surface = tok
      continue
    }
    const m = /^(S|L45|R45|L90|R90|LL|RL|LS|RS|OL|OS|OR)([\^v]*)$/.exec(tok)
    if (!m) throw new Error(`Unknown piece "${tok}"`)
    const code = m[1]
    const p: Piece =
      code === 'S'
        ? { k: 'straight' }
        : code[0] === 'O'
          ? { k: 'roundabout', t: code[1] as Turn }
          : {
            k: code.endsWith('45') ? 'bend45' : code.endsWith('90') ? 'bend90' : code[1] === 'L' ? 'large90' : 'small90',
            t: code[0] as Turn,
          }
    const rise = (m[2].split('^').length - 1 - (m[2].split('v').length - 1)) * LEVEL
    if (rise) p.rise = rise
    if (surface) {
      p.surface = surface
      surface = undefined
    }
    out.push(p)
  }
  return out
}
