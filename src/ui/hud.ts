/** Minimal race HUD: stage timer, finish banner, speed readout, restart button, fade overlay, perf overlay. */

export function formatTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`
}

export class Hud {
  private readonly speedEl: HTMLDivElement
  private readonly timeEl: HTMLDivElement
  private readonly finishEl: HTMLDivElement
  private shownTime = ''
  private shownFinished = false
  private readonly fadeEl: HTMLDivElement
  private readonly perfEl: HTMLDivElement | null
  private shownSpeed = -1

  private acc = 0
  private readonly els: HTMLElement[] = []
  private readonly backEl: HTMLButtonElement

  constructor(parent: HTMLElement, onRestart: () => void, onBack: () => void, debug: boolean) {
    const speed = document.createElement('div')
    speed.className = 'hud-speed'
    parent.appendChild(speed)
    this.speedEl = speed

    const time = document.createElement('div')
    time.className = 'hud-time'
    parent.appendChild(time)
    this.timeEl = time

    const finish = document.createElement('div')
    finish.className = 'hud-finish'
    finish.style.display = 'none'
    parent.appendChild(finish)
    this.finishEl = finish

    const restart = document.createElement('button')
    restart.className = 'hud-restart'
    restart.textContent = '↺'
    restart.setAttribute('aria-label', 'Restart')
    restart.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      e.preventDefault()
      onRestart()
    })
    parent.appendChild(restart)

    const back = document.createElement('button')
    back.className = 'hud-back'
    back.textContent = 'MENU'
    back.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      e.preventDefault()
      onBack()
    })
    parent.appendChild(back)
    this.backEl = back
    this.els.push(speed, time, restart, back)

    const fade = document.createElement('div')
    fade.className = 'fade'
    parent.appendChild(fade)
    this.fadeEl = fade

    if (debug) {
      const perf = document.createElement('div')
      perf.className = 'perf'
      parent.appendChild(perf)
      this.perfEl = perf
    } else this.perfEl = null
  }

  /** Hidden on the menu and in the editor. */
  setVisible(v: boolean): void {
    for (const e of this.els) e.style.visibility = v ? '' : 'hidden'
    if (!v) this.finishEl.style.display = 'none'
    else if (this.shownFinished) this.finishEl.style.display = 'block'
  }

  /** The back button's label: MENU, or EDIT when test-driving from the editor. */
  setBackLabel(label: string): void {
    this.backEl.textContent = label
  }

  setSpeed(ms: number): void {
    const kmh = Math.round(ms * 3.6)
    if (kmh === this.shownSpeed) return
    this.shownSpeed = kmh
    this.speedEl.innerHTML = `${kmh}<span>km/h</span>`
  }

  setTime(t: number, finished: boolean): void {
    const txt = formatTime(t)
    if (txt !== this.shownTime) {
      this.shownTime = txt
      this.timeEl.textContent = txt
    }
    if (finished !== this.shownFinished) {
      this.shownFinished = finished
      this.finishEl.style.display = finished ? 'block' : 'none'
      if (finished) this.finishEl.innerHTML = `<b>STAGE COMPLETE</b>${txt}<small>↺ or R to retry · Esc for menu</small>`
    }
  }

  setFade(opacity: number): void {
    this.fadeEl.style.opacity = opacity.toFixed(3)
  }

  /** Debug telemetry line (timing lives in the FPS meter). Updated twice a second. */
  perf(frameMs: number, extra: string): void {
    if (!this.perfEl) return
    this.acc += frameMs
    if (this.acc < 500) return
    this.perfEl.textContent = extra
    this.acc = 0
  }
}
