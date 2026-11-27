/**
 * The cars the player can pick. Each has its own body, wheels and a few handling numbers laid over the
 * shared tuning (tuning.ts stays the base, so the ?debug sliders still work on whichever car is driving).
 */
import type { Group } from 'three'
import { buildHatchShell, HATCH_ARCH_RISE, HATCH_COLORS, HATCH_WHEEL } from './render/carHatch'
import { ARCH_RISE, buildCarShell, CAR_COLORS, RALLY_WHEEL, type WheelStyle } from './render/carModel'
import { tuning, type Tuning } from './tuning'

export interface CarDef {
  id: string
  name: string
  /** One line for the menu card. */
  blurb: string
  /** Menu card swatch: body, roof / band, trim. */
  swatch: [string, string, string]
  /** 1..5 bars on the menu card. */
  stats: { power: number; grip: number; drift: number }
  buildShell: (wheelZF: number, wheelZR: number, wheelR: number) => Group
  wheel: WheelStyle
  /** Arch top above the tyre at rest (1x model scale): caps how far a wheel may rise into the body. */
  archRise: number
  /** Handling overrides on top of tuning.ts. */
  tuning: Partial<Tuning>
}

export const CARS: CarDef[] = [
  {
    id: 'coupe',
    name: 'Group B Coupe',
    blurb: '4WD rally weapon. Big grip, throttle pulls it round.',
    swatch: [CAR_COLORS.body, CAR_COLORS.yellow, CAR_COLORS.red],
    stats: { power: 5, grip: 5, drift: 3 },
    buildShell: buildCarShell,
    wheel: RALLY_WHEEL,
    archRise: ARCH_RISE,
    tuning: {},
  },
  {
    id: 'hatch',
    name: 'Retro Hatch',
    blurb: 'The original. Rear-drive, light and tail-happy.',
    swatch: [HATCH_COLORS.body, HATCH_COLORS.cream, HATCH_COLORS.black],
    stats: { power: 3, grip: 3, drift: 5 },
    buildShell: buildHatchShell,
    wheel: HATCH_WHEEL,
    archRise: HATCH_ARCH_RISE,
    // Two-wheel drive: no 4WD pull, less power, and a rear that lets go sooner.
    tuning: { awdPull: 0, driveFront: 0, engineForce: 17000, topSpeed: 52, gripFront: 1.7, gripRear: 1.85, slideGrip: 0.8, frontLatGrip: 0, handbrakeFrontGrip: 0 },
  },
]

export function carById(id: string | null | undefined): CarDef {
  return CARS.find((c) => c.id === id) ?? CARS[0]
}

let base: Tuning | null = null

/** Lay a car's handling over the base tuning (taken the first time, after any ?debug overrides load). */
export function applyCarTuning(car: CarDef): void {
  base ??= { ...tuning }
  Object.assign(tuning, base, car.tuning)
}
