export type SteerMode = 'drag' | 'zones'

export interface Settings {
  /** 'drag' = analogue horizontal drag strip, 'zones' = left/right halves. */
  steerMode: SteerMode
  /** Pixels of thumb travel for full lock in drag mode. */
  dragRange: number
  cameraShake: boolean
  haptics: boolean
}

const KEY = 'raleee.settings'

export const settings: Settings = {
  steerMode: 'drag',
  dragRange: 70,
  cameraShake: true,
  haptics: true,
}

export function loadSettings(): void {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) Object.assign(settings, JSON.parse(raw))
  } catch {
    /* ignore */
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    /* ignore */
  }
}
