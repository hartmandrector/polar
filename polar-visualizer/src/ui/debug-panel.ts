/**
 * Debug Parameter Override Panel
 *
 * Collapsible panel that exposes sliders for every numeric ContinuousPolar
 * parameter. Overrides are applied on top of the currently selected polar
 * (from the Polar dropdown). Switching polars resets all sliders to that
 * polar's baseline values.
 *
 * Architecture:
 * - Reads the base polar from the registry (e.g. aurafiveContinuous)
 * - Each slider shows the current value and allows adjustment within a
 *   sensible range derived from the parameter's baseline
 * - getOverriddenPolar() returns a new ContinuousPolar with overrides applied
 * - A "Reset" button restores all sliders to the baseline
 */

import type { ContinuousPolar } from '../polar/continuous-polar.ts'

// ─── Parameter Definitions ───────────────────────────────────────────────────

interface ParamDef {
  key: keyof ContinuousPolar
  label: string
  unit: string
  min: number
  max: number
  step: number
  decimals: number
  group: string
}

/**
 * Define all tunable parameters with sensible universal ranges that cover
 * wingsuit, canopy, skydiver, and airplane regimes.
 */
const PARAM_DEFS: ParamDef[] = [
  // Attached-flow lift
  { key: 'cl_alpha',        label: 'CL_α',           unit: '/rad', min: 0.5,   max: 7.0,   step: 0.05,  decimals: 2, group: 'Lift Model' },
  { key: 'alpha_0',         label: 'α₀',             unit: '°',    min: -15,   max: 15,    step: 0.5,   decimals: 1, group: 'Lift Model' },

  // Drag
  { key: 'cd_0',            label: 'CD₀',            unit: '',     min: 0.005, max: 0.8,   step: 0.005, decimals: 3, group: 'Drag Model' },
  { key: 'k',               label: 'K',              unit: '',     min: 0.01,  max: 1.5,   step: 0.01,  decimals: 3, group: 'Drag Model' },

  // Flat-plate / separated
  { key: 'cd_n',            label: 'CD_n',            unit: '',     min: 0.3,   max: 2.5,   step: 0.05,  decimals: 2, group: 'Separated Flow' },
  { key: 'cd_n_lateral',    label: 'CD_n lat',        unit: '',     min: 0.3,   max: 2.5,   step: 0.05,  decimals: 2, group: 'Separated Flow' },

  // Stall
  { key: 'alpha_stall_fwd', label: 'α stall fwd',     unit: '°',    min: 5,     max: 70,    step: 0.5,   decimals: 1, group: 'Stall' },
  { key: 's1_fwd',          label: 's₁ fwd',          unit: '°',    min: 0.5,   max: 20,    step: 0.5,   decimals: 1, group: 'Stall' },
  { key: 'alpha_stall_back',label: 'α stall back',    unit: '°',    min: -70,   max: -1,    step: 0.5,   decimals: 1, group: 'Stall' },
  { key: 's1_back',         label: 's₁ back',         unit: '°',    min: 0.5,   max: 20,    step: 0.5,   decimals: 1, group: 'Stall' },

  // Sideslip
  { key: 'cy_beta',         label: 'CY_β',            unit: '/rad', min: -1.0,  max: 0,     step: 0.05,  decimals: 2, group: 'Sideslip' },
  { key: 'cn_beta',         label: 'Cn_β',            unit: '/rad', min: -0.2,  max: 0.5,   step: 0.01,  decimals: 2, group: 'Sideslip' },
  { key: 'cl_beta',         label: 'Cl_β',            unit: '/rad', min: -0.5,  max: 0.2,   step: 0.01,  decimals: 2, group: 'Sideslip' },

  // Pitching moment
  { key: 'cm_0',            label: 'CM₀',             unit: '',     min: -0.2,  max: 0.2,   step: 0.005, decimals: 3, group: 'Pitch / CP' },
  { key: 'cm_alpha',        label: 'CM_α',            unit: '/rad', min: -0.3,  max: 0.1,   step: 0.005, decimals: 3, group: 'Pitch / CP' },

  // Center of pressure
  { key: 'cp_0',            label: 'CP₀',             unit: 'c',    min: 0.1,   max: 0.7,   step: 0.01,  decimals: 2, group: 'Pitch / CP' },
  { key: 'cp_alpha',        label: 'CP_α',            unit: '/rad', min: -0.15, max: 0.05,  step: 0.005, decimals: 3, group: 'Pitch / CP' },
  { key: 'cg',              label: 'CG',              unit: 'c',    min: 0.1,   max: 0.7,   step: 0.01,  decimals: 2, group: 'Pitch / CP' },
  { key: 'cp_lateral',      label: 'CP lat',           unit: 'c',    min: 0.1,   max: 0.7,   step: 0.01,  decimals: 2, group: 'Pitch / CP' },

  // Physical
  { key: 's',               label: 'S (area)',         unit: 'm²',   min: 0.1,   max: 30,    step: 0.1,   decimals: 1, group: 'Physical' },
  { key: 'm',               label: 'm (mass)',         unit: 'kg',   min: 30,    max: 200,   step: 0.5,   decimals: 1, group: 'Physical' },
  { key: 'chord',           label: 'chord',            unit: 'm',    min: 0.5,   max: 15,    step: 0.1,   decimals: 1, group: 'Physical' },
]

// ─── State ───────────────────────────────────────────────────────────────────

export type DebugChangeCallback = () => void

let basePolar: ContinuousPolar | null = null
let overrides: Map<string, number> = new Map()
let onChange: DebugChangeCallback | null = null
let panelVisible = false

// DOM references
let panelEl: HTMLElement | null = null
let toggleBtn: HTMLElement | null = null
const sliderEls: Map<string, HTMLInputElement> = new Map()
const valueEls: Map<string, HTMLSpanElement> = new Map()

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the debug panel. Call once at startup.
 * @param cb  Called whenever any slider changes.
 */
export function setupDebugPanel(cb: DebugChangeCallback): void {
  onChange = cb

  panelEl = document.getElementById('debug-panel')
  toggleBtn = document.getElementById('debug-toggle')

  if (!panelEl || !toggleBtn) {
    console.warn('Debug panel DOM elements not found')
    return
  }

  // Build slider groups
  buildSliders(panelEl)

  // Toggle visibility
  toggleBtn.addEventListener('click', () => {
    panelVisible = !panelVisible
    panelEl!.style.display = panelVisible ? 'block' : 'none'
    toggleBtn!.textContent = panelVisible ? '▼ Debug Overrides' : '▶ Debug Overrides'
    toggleBtn!.classList.toggle('debug-active', panelVisible)
  })

  // Start collapsed
  panelEl.style.display = 'none'
}

/**
 * Called when the polar dropdown changes. Resets all overrides to the
 * new polar's baseline values.
 */
export function syncDebugPanel(polar: ContinuousPolar): void {
  basePolar = { ...polar }   // shallow clone as our baseline reference
  overrides.clear()

  // Update all sliders to the new polar's values
  for (const def of PARAM_DEFS) {
    const val = polar[def.key] as number
    const slider = sliderEls.get(def.key)
    const label = valueEls.get(def.key)
    if (slider) {
      slider.min = String(def.min)
      slider.max = String(def.max)
      slider.step = String(def.step)
      slider.value = String(val)
    }
    if (label) {
      label.textContent = formatVal(val, def)
    }
  }
}

/**
 * Returns a ContinuousPolar with debug overrides applied.
 * If no overrides are active, returns the base polar unchanged.
 */
export function getOverriddenPolar(polar: ContinuousPolar): ContinuousPolar {
  if (overrides.size === 0 || !panelVisible) return polar

  const p: any = { ...polar }
  for (const [key, val] of overrides) {
    p[key] = val
  }
  return p as ContinuousPolar
}

/**
 * Returns true if the debug panel is open and has active overrides,
 * useful for adding the debug overrides to the sweep key so charts
 * recompute when sliders change.
 */
export function debugSweepKey(): string {
  if (!panelVisible || overrides.size === 0) return ''
  // Create a deterministic key from overrides
  const parts: string[] = []
  for (const [k, v] of overrides) {
    parts.push(`${k}:${v}`)
  }
  return parts.sort().join(',')
}

// ─── Internal: Build DOM ─────────────────────────────────────────────────────

function formatVal(val: number, def: ParamDef): string {
  return `${val.toFixed(def.decimals)} ${def.unit}`
}

function buildSliders(container: HTMLElement): void {
  // Reset button
  const resetBtn = document.createElement('button')
  resetBtn.id = 'debug-reset'
  resetBtn.textContent = 'Reset to Baseline'
  resetBtn.addEventListener('click', () => {
    if (basePolar) {
      overrides.clear()
      syncDebugPanel(basePolar)
      onChange?.()
    }
  })
  container.appendChild(resetBtn)

  // Group sliders
  let currentGroup = ''

  for (const def of PARAM_DEFS) {
    // Group header
    if (def.group !== currentGroup) {
      currentGroup = def.group
      const h4 = document.createElement('h4')
      h4.className = 'debug-group-header'
      h4.textContent = currentGroup
      container.appendChild(h4)
    }

    // Row
    const row = document.createElement('div')
    row.className = 'debug-row'

    // Label
    const label = document.createElement('label')
    label.className = 'debug-label'
    label.textContent = def.label

    // Value display
    const valSpan = document.createElement('span')
    valSpan.className = 'debug-value'
    valSpan.textContent = '—'
    valueEls.set(def.key, valSpan)

    // Slider
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(def.min)
    slider.max = String(def.max)
    slider.step = String(def.step)
    slider.value = '0'
    slider.className = 'debug-slider'
    sliderEls.set(def.key, slider)

    // Input handler
    slider.addEventListener('input', () => {
      const numVal = parseFloat(slider.value)
      valSpan.textContent = formatVal(numVal, def)

      // Check if this differs from the baseline
      if (basePolar) {
        const baseVal = basePolar[def.key] as number
        if (Math.abs(numVal - baseVal) < Number(def.step) * 0.5) {
          overrides.delete(def.key)
          row.classList.remove('debug-modified')
        } else {
          overrides.set(def.key, numVal)
          row.classList.add('debug-modified')
        }
      } else {
        overrides.set(def.key, numVal)
        row.classList.add('debug-modified')
      }

      onChange?.()
    })

    // Double-click to reset individual param
    slider.addEventListener('dblclick', () => {
      if (basePolar) {
        const baseVal = basePolar[def.key] as number
        slider.value = String(baseVal)
        valSpan.textContent = formatVal(baseVal, def)
        overrides.delete(def.key)
        row.classList.remove('debug-modified')
        onChange?.()
      }
    })

    const labelRow = document.createElement('div')
    labelRow.className = 'debug-label-row'
    labelRow.appendChild(label)
    labelRow.appendChild(valSpan)

    row.appendChild(labelRow)
    row.appendChild(slider)
    container.appendChild(row)
  }
}
