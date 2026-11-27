/**
 * Stage weather: rolled at random each time you load into a race (retry keeps it). Pure: the sim reads
 * only the grip multiplier; the look of each kind lives in render/weatherView.ts.
 */
import { tuning as T } from '../tuning'

export type Weather = 'clear' | 'rain' | 'snow' | 'fog'
export const WEATHERS: readonly Weather[] = ['clear', 'rain', 'snow', 'fog']

/** Tyre grip multiplier for the weather (all surfaces). */
export function weatherGrip(w: Weather): number {
  return w === 'rain' ? T.rainGrip : w === 'snow' ? T.snowGrip : 1
}

export type TimeOfDay = 'day' | 'night'
/** Chance a race is at night (any weather). */
export const NIGHT_CHANCE = 0.3

/** Day or night: `rand` in [0, 1). ?time=day|night forces it. */
export function rollTime(rand: number, force?: string | null): TimeOfDay {
  if (force === 'day' || force === 'night') return force
  return rand < NIGHT_CHANCE ? 'night' : 'day'
}

/** Pick the weather: each kind equally likely. `rand` in [0, 1). A valid `force` (?weather=rain) wins. */
export function rollWeather(rand: number, force?: string | null): Weather {
  if (force && (WEATHERS as readonly string[]).includes(force)) return force as Weather
  return WEATHERS[Math.min(WEATHERS.length - 1, Math.floor(rand * WEATHERS.length))]
}
