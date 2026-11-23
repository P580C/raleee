import { settings } from '../ui/settings'

let last = 0

/** Light vibration where supported (Android Chrome; iOS Safari ignores it). */
export function haptic(ms: number): void {
  if (!settings.haptics || typeof navigator.vibrate !== 'function') return
  const now = performance.now()
  if (now - last < 120) return
  last = now
  navigator.vibrate(ms)
}
