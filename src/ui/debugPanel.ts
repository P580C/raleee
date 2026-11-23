/** ?debug tuning panel: live sliders over tuning.ts values, persisted locally, with a copy button. */
import { resetTuning, saveTuningOverrides, tuning, tuningDefaults, tuningDiff, type TuningKey } from '../tuning'
import { saveSettings, settings } from './settings'

type Def = [key: TuningKey, min: number, max: number, step: number]

const GROUPS: [string, Def[]][] = [
  [
    'Grip',
    [
      ['gripFront', 0.3, 2.5, 0.01],
      ['gripRear', 0.3, 2.5, 0.01],
      ['handbrakeGrip', 0.05, 1, 0.01],
      ['slideGrip', 0.3, 1.2, 0.01],
      ['slipPeakFront', 0.03, 0.4, 0.005],
      ['slipPeakRear', 0.03, 0.4, 0.005],
      ['throttleRearSlip', 0, 2, 0.05],
      ['weightTransfer', 0, 3, 0.05],
    ],
  ],
  [
    'Drift',
    [
      ['driftAssist', 0, 2, 0.01],
      ['driftAngle', 0, 1.2, 0.01],
      ['driftCarry', 0, 3, 0.05],
      ['maxSlip', 0.5, 2, 0.05],
      ['selfAlign', 0, 1.5, 0.05],
      ['counterSteerBonus', 0, 1.5, 0.05],
    ],
  ],
  [
    'Steering',
    [
      ['steerLow', 0.1, 1, 0.01],
      ['steerHigh', 0.03, 0.6, 0.005],
      ['steerSpeedRef', 10, 70, 1],
      ['steerRate', 0.5, 15, 0.1],
      ['steerReturnRate', 0.5, 20, 0.1],
    ],
  ],
  [
    'Engine / brakes',
    [
      ['engineForce', 2000, 25000, 100],
      ['topSpeed', 15, 80, 0.5],
      ['driveRearBias', 0, 1, 0.05],
      ['autoBrake', 0, 15, 0.1],
      ['handbrakeBrake', 0, 10, 0.1],
      ['airDrag', 0, 3, 0.05],
    ],
  ],
  [
    'Chassis',
    [
      ['inertiaRadius', 0.6, 2.5, 0.05],
      ['cgHeight', 0, 1.5, 0.05],
      ['yawDamping', 0, 3, 0.05],
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
    ],
  ],
  [
    'Suspension (visual)',
    [
      ['rollStiffness', 10, 300, 1],
      ['rollDamping', 0, 40, 0.5],
      ['rollPerG', 0, 0.3, 0.005],
      ['pitchStiffness', 10, 300, 1],
      ['pitchDamping', 0, 40, 0.5],
      ['pitchPerG', 0, 0.3, 0.005],
      ['heaveStiffness', 10, 400, 1],
      ['heaveDamping', 0, 40, 0.5],
      ['landingSquash', 0, 1, 0.01],
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
    'Camera',
    [
      ['camView', 20, 120, 1],
      ['camLookAhead', 0, 1.5, 0.05],
      ['camLookAheadMax', 0, 40, 1],
      ['camAheadFollow', 0.2, 10, 0.1],
      ['camFollow', 1, 30, 0.5],
      ['camDownBias', -10, 25, 0.5],
    ],
  ],
]

function fmt(v: number, step: number): string {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
  return v.toFixed(d)
}

export function createDebugPanel(parent: HTMLElement, onSettingsChanged: () => void): void {
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
  const syncAll = () => {
    for (const r of inputs) {
      r.input.value = String(tuning[r.key])
      r.out.textContent = fmt(tuning[r.key], r.step)
      r.out.classList.toggle('changed', tuning[r.key] !== tuningDefaults[r.key])
    }
  }
  button('Copy values', () => {
    const diff = tuningDiff()
    const text = Object.keys(diff).length
      ? `// Raleee tuning changes\n${JSON.stringify(diff, null, 2)}`
      : '// Raleee tuning: no changes from defaults'
    copyText(text).then((ok) => {
      status.textContent = ok ? 'Copied changed values.' : 'Copy blocked — select the text below.'
      if (!ok) showText(panel, text)
    })
  })
  button('Reset all', () => {
    resetTuning()
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
