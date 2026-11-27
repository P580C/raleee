/** ?debug tuning panel: live sliders over tuning.ts values, persisted locally, with a copy button. */
import { resetTuning, saveTuningOverrides, tuning, tuningDefaults, tuningDiff, type TuningKey } from '../tuning'
import { look, lookDefaults, lookDiff, LOOK_CHOICES, LOOK_SLIDERS, LOOKS, resetLook, saveLookOverrides, type Look } from '../render/look'
import { saveSettings, settings } from './settings'

type Def = [key: TuningKey, min: number, max: number, step: number]

const GROUPS: [string, Def[]][] = [
  [
    'Grip',
    [
      ['gripFront', 0.3, 3, 0.01],
      ['gripRear', 0.3, 4, 0.01],
      ['latStiffness', 2, 40, 0.5],
      ['slipPeak', 0.03, 0.4, 0.005],
      ['slideGrip', 0.2, 1.2, 0.01],
      ['handbrakeGrip', 0.05, 1, 0.01],
      ['handbrakeYaw', 1, 3, 0.05],
      ['frontLatGrip', 0, 1.5, 0.05],
      ['handbrakeFrontGrip', 0, 2, 0.05],
      ['throttleRearSlip', 0, 1, 0.01],
      ['slideRecover', 0, 10, 0.1],
      ['slideRecoverThrottle', 0, 1, 0.01],
      ['grassTug', 0, 0.5, 0.01],
    ],
  ],
  [
    'Drift',
    [
      ['driftAssist', 0, 1, 0.01],
      ['driftAngle', 0, 1.2, 0.01],
      ['driftAngleSteer', 0, 0.6, 0.01],
      ['driftHold', 0.5, 12, 0.1],
      ['driftTurn', 0, 2.5, 0.01],
      ['driftHandbrakeTurn', 0, 1, 0.01],
      ['driftMaxG', 0.5, 4, 0.05],
      ['awdPull', 0, 1, 0.05],
      ['driftScrub', 0, 15, 0.1],
      ['driftEntryAngle', 0.1, 0.8, 0.01],
      ['driftKeepSteer', 0, 0.6, 0.01],
      ['driftCentreRate', 0.2, 5, 0.1],
      ['driftLiftRate', 0.2, 5, 0.1],
      ['driftExitRate', 0.2, 6, 0.1],
      ['maxSlip', 0.5, 2, 0.05],
    ],
  ],
  [
    'Scandi flick',
    [
      ['flick', 0, 3, 0.05],
      ['flickWindow', 0.1, 1, 0.01],
      ['flickMinSpeed', 0, 30, 0.5],
      ['flickMinYaw', 0, 1, 0.01],
    ],
  ],
  [
    'Steering',
    [
      ['turnRadiusLow', 2, 30, 0.5],
      ['turnRadiusHigh', 15, 200, 1],
      ['steerSpeedRef', 10, 70, 1],
      ['yawResponse', 1, 25, 0.5],
      ['steerRate', 0.5, 15, 0.1],
      ['gripRotateCap', 0.5, 2, 0.05],
      ['looseRotate', 0, 6, 0.1],
      ['counterSteerVisual', 0, 1, 0.05],
      ['liftTurnIn', 0, 1, 0.05],
      ['steerReturnRate', 0.5, 20, 0.1],
    ],
  ],
  [
    'Engine / brakes',
    [
      ['engineForce', 2000, 25000, 100],
      ['topSpeed', 15, 80, 0.5],
      ['autoBrake', 0, 15, 0.1],
      ['handbrakeBrake', 0, 10, 0.1],
      ['brakeDecel', 0, 30, 0.5],
      ['reverseForce', 0, 20000, 100],
      ['reverseSpeed', 1, 20, 0.5],
      ['airDrag', 0, 3, 0.05],
    ],
  ],
  [
    'Surfaces',
    [
      ['tarmacGrip', 0.2, 1.5, 0.01],
      ['gravelGrip', 0.2, 1.5, 0.01],
      ['gravelSpeed', 0.4, 1.2, 0.01],
      ['gravelDrag', 0, 0.5, 0.005],
      ['grassGrip', 0.1, 1.5, 0.01],
      ['grassSpeed', 0.3, 1.2, 0.01],
      ['grassDrag', 0, 1, 0.01],
      ['offroadMargin', 0, 15, 0.1],
      ['offroadSpeed', 0.2, 1, 0.01],
      ['offroadBrake', 0, 40, 0.5],
      ['dustAmount', 0, 3, 0.05],
      ['rainGrip', 0.3, 1, 0.01],
      ['snowGrip', 0.3, 1, 0.01],
    ],
  ],
  [
    'Suspension (visual)',
    [
      ['rollStiffness', 10, 300, 1],
      ['rollDamping', 0, 40, 0.5],
      ['rollPerG', 0, 0.5, 0.005],
      ['rollPerSlip', 0, 0.8, 0.01],
      ['maxRoll', 0.05, 0.8, 0.01],
      ['pitchStiffness', 10, 300, 1],
      ['pitchDamping', 0, 40, 0.5],
      ['pitchPerG', 0, 0.4, 0.005],
      ['maxPitch', 0.05, 0.6, 0.01],
      ['heaveStiffness', 10, 400, 1],
      ['heaveDamping', 0, 40, 0.5],
      ['landingSquash', 0, 1.5, 0.01],
      ['suspTravel', 0.05, 1.2, 0.01],
    ],
  ],
  [
    'Air',
    [
      ['gravity', 5, 40, 0.5],
      ['airSteer', 0, 5, 0.1],
    ],
  ],
  [
    'Collisions',
    [
      ['carRadius', 0.5, 3, 0.05],
      ['carCircleOffset', 0, 4, 0.05],
      ['carGyration', 0.5, 5, 0.05],
      ['hitRestitution', 0, 1, 0.01],
      ['hitFriction', 0, 1, 0.01],
      ['knockPitch', 0, 0.3, 0.005],
      ['knockRoll', 0, 0.3, 0.005],
      ['knockHeave', 0, 0.1, 0.001],
      ['knockMax', 0, 5, 0.05],
    ],
  ],
  [
    'Camera',
    [
      ['camView', 20, 120, 1],
      ['camLookAhead', 0, 1.5, 0.05],
      ['camLookAheadMax', 0, 40, 1],
      ['camAheadFollow', 0.2, 10, 0.1],
      ['camFollow', 1, 30, 0.5],
      ['camUpBias', -10, 25, 0.5],
    ],
  ],
]

function fmt(v: number, step: number): string {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
  return v.toFixed(d)
}

export function createDebugPanel(parent: HTMLElement, onLookChanged: () => void, onSettingsChanged: () => void): void {
  const toggle = document.createElement('button')
  toggle.className = 'dbg-toggle'
  toggle.textContent = 'TUNE'
  parent.appendChild(toggle)

  const panel = document.createElement('div')
  panel.className = 'dbg-panel'
  panel.style.display = 'none'
  parent.appendChild(panel)

  toggle.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    e.preventDefault()
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
  })
  for (const ev of ['pointerdown', 'pointermove', 'pointerup'] as const) panel.addEventListener(ev, (e) => e.stopPropagation())

  // Actions
  const actions = document.createElement('div')
  actions.className = 'dbg-actions'
  panel.appendChild(actions)
  const status = document.createElement('div')
  status.className = 'dbg-status'

  const button = (label: string, fn: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.addEventListener('click', fn)
    actions.appendChild(b)
  }
  const inputs: { key: TuningKey; input: HTMLInputElement; out: HTMLSpanElement; step: number }[] = []
  const lookSyncs: (() => void)[] = []
  const syncAll = () => {
    for (const r of inputs) {
      r.input.value = String(tuning[r.key])
      r.out.textContent = fmt(tuning[r.key], r.step)
      r.out.classList.toggle('changed', tuning[r.key] !== tuningDefaults[r.key])
    }
    for (const f of lookSyncs) f()
  }
  button('Copy values', () => {
    const diff = tuningDiff()
    const ld = lookDiff()
    const parts: string[] = []
    if (Object.keys(diff).length) parts.push(`// Raleee tuning changes\n${JSON.stringify(diff, null, 2)}`)
    if (Object.keys(ld).length) parts.push(`// Raleee look changes\n${JSON.stringify(ld, null, 2)}`)
    const text = parts.length ? parts.join('\n') : '// Raleee: no changes from defaults'
    copyText(text).then((ok) => {
      status.textContent = ok ? 'Copied changed values.' : 'Copy blocked — select the text below.'
      if (!ok) showText(panel, text)
    })
  })
  button('Reset all', () => {
    resetTuning()
    resetLook()
    onLookChanged()
    syncAll()
    status.textContent = 'Defaults restored.'
  })
  button('Close', () => (panel.style.display = 'none'))
  panel.appendChild(status)

  // Settings
  const sGroup = section(panel, 'Settings')
  checkbox(sGroup, 'Drag-strip steering (off = zones)', settings.steerMode === 'drag', (v) => {
    settings.steerMode = v ? 'drag' : 'zones'
    saveSettings()
    onSettingsChanged()
  })
  checkbox(sGroup, 'Camera shake', settings.cameraShake, (v) => {
    settings.cameraShake = v
    saveSettings()
    onSettingsChanged()
  })
  checkbox(sGroup, 'Haptics', settings.haptics, (v) => {
    settings.haptics = v
    saveSettings()
  })
  {
    const row = document.createElement('label')
    row.className = 'dbg-row'
    const name = document.createElement('span')
    name.textContent = 'dragRange (px)'
    const out = document.createElement('span')
    out.className = 'dbg-val'
    out.textContent = String(settings.dragRange)
    const input = document.createElement('input')
    input.type = 'range'
    input.min = '30'
    input.max = '160'
    input.step = '1'
    input.value = String(settings.dragRange)
    input.addEventListener('input', () => {
      settings.dragRange = Number(input.value)
      out.textContent = input.value
      saveSettings()
    })
    row.append(name, out, input)
    sGroup.appendChild(row)
  }

  // Look (lighting and rendering), shared with the Brick Snap Lab mini-game.
  {
    const g = section(panel, 'Look')
    const presetRow = document.createElement('div')
    presetRow.className = 'dbg-choices'
    for (const p of LOOKS) {
      const b = document.createElement('button')
      b.textContent = p.label
      b.addEventListener('click', () => {
        Object.assign(look, p.values)
        saveLookOverrides()
        onLookChanged()
        syncAll()
      })
      presetRow.appendChild(b)
    }
    g.appendChild(presetRow)
    const changed = () => {
      saveLookOverrides()
      onLookChanged()
    }
    for (const [key, label, options] of LOOK_CHOICES) {
      const row = document.createElement('div')
      row.className = 'dbg-choices'
      const name = document.createElement('span')
      name.textContent = label
      row.appendChild(name)
      const buttons: [string, HTMLButtonElement][] = []
      for (const [value, text] of options) {
        const b = document.createElement('button')
        b.textContent = text
        b.addEventListener('click', () => {
          ;(look as unknown as Record<string, string>)[key] = value
          changed()
          syncAll()
        })
        buttons.push([value, b])
        row.appendChild(b)
      }
      lookSyncs.push(() => {
        for (const [value, b] of buttons) b.classList.toggle('on', look[key] === value)
      })
      g.appendChild(row)
    }
    for (const [key, min, max, step] of LOOK_SLIDERS) {
      const row = document.createElement('label')
      row.className = 'dbg-row'
      const name = document.createElement('span')
      name.textContent = key
      const out = document.createElement('span')
      out.className = 'dbg-val'
      const input = document.createElement('input')
      input.type = 'range'
      input.min = String(min)
      input.max = String(max)
      input.step = String(step)
      const sync = () => {
        input.value = String(look[key])
        out.textContent = fmt(look[key], step)
        out.classList.toggle('changed', look[key] !== (lookDefaults as Look)[key])
      }
      input.addEventListener('input', () => {
        look[key] = Number(input.value)
        sync()
        changed()
      })
      lookSyncs.push(sync)
      row.append(name, out, input)
      g.appendChild(row)
    }
  }

  for (const [title, defs] of GROUPS) {
    const g = section(panel, title)
    for (const [key, min, max, step] of defs) {
      const row = document.createElement('label')
      row.className = 'dbg-row'
      const name = document.createElement('span')
      name.textContent = key
      const out = document.createElement('span')
      out.className = 'dbg-val'
      const input = document.createElement('input')
      input.type = 'range'
      input.min = String(min)
      input.max = String(max)
      input.step = String(step)
      input.addEventListener('input', () => {
        tuning[key] = Number(input.value)
        out.textContent = fmt(tuning[key], step)
        out.classList.toggle('changed', tuning[key] !== tuningDefaults[key])
        saveTuningOverrides()
      })
      row.append(name, out, input)
      g.appendChild(row)
      inputs.push({ key, input, out, step })
    }
  }
  syncAll()
}

function section(panel: HTMLElement, title: string): HTMLDivElement {
  const h = document.createElement('div')
  h.className = 'dbg-h'
  h.textContent = title
  panel.appendChild(h)
  const g = document.createElement('div')
  panel.appendChild(g)
  return g
}

function checkbox(parent: HTMLElement, label: string, value: boolean, fn: (v: boolean) => void): void {
  const row = document.createElement('label')
  row.className = 'dbg-check'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = value
  input.addEventListener('change', () => fn(input.checked))
  row.append(input, document.createTextNode(' ' + label))
  parent.appendChild(row)
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  // Plain-http LAN pages have no clipboard API; fall back to a selected textarea.
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}

function showText(panel: HTMLElement, text: string): void {
  let ta = panel.querySelector<HTMLTextAreaElement>('.dbg-text')
  if (!ta) {
    ta = document.createElement('textarea')
    ta.className = 'dbg-text'
    ta.readOnly = true
    panel.insertBefore(ta, panel.children[2] ?? null)
  }
  ta.value = text
  ta.focus()
  ta.select()
}
