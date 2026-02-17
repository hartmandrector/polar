/**
 * Debug Parameter Override Panel
 *
 * Collapsible panel that exposes sliders for every numeric ContinuousPolar
 * parameter. Overrides are applied on top of the currently selected polar
 * (from the Polar dropdown). Switching polars resets all sliders to that
 * polar's baseline values.
 *
 * Segment mode:
 * When the active polar has `aeroSegments`, a segment selector dropdown
 * appears at the top of the panel. Selecting a segment switches all sliders
 * to that segment's own ContinuousPolar. Overrides are stored per-segment
 * so switching between segments preserves changes.
 *
 * Architecture:
 * - Reads the base polar from the registry (e.g. aurafiveContinuous)
 * - Each slider shows the current value and allows adjustment within a
 *   sensible range derived from the parameter's baseline
 * - getOverriddenPolar() returns a new ContinuousPolar with overrides applied
 * - getSegmentPolarOverrides() returns a map of segment name → overridden polar
 * - A "Reset" button restores all sliders to the baseline
 */

import type { ContinuousPolar, AeroSegment } from '../polar/continuous-polar.ts'
import type { SegmentForceResult } from '../polar/aero-segment.ts'

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

// Segment-level override state
/** Currently selected segment name, or 'system' for whole-polar overrides */
let selectedSegment = 'system'
/** Per-segment overrides: segmentName → Map<paramKey, value> */
const segmentOverrides: Map<string, Map<string, number>> = new Map()
/** Cached reference to segments from the current polar */
let currentSegments: AeroSegment[] | undefined

// DOM references
let panelEl: HTMLElement | null = null
let toggleBtn: HTMLElement | null = null
let segmentSelector: HTMLSelectElement | null = null
let segmentSelectorRow: HTMLElement | null = null
const sliderEls: Map<string, HTMLInputElement> = new Map()
const valueEls: Map<string, HTMLSpanElement> = new Map()
const rowEls: Map<string, HTMLElement> = new Map()
let systemViewEl: HTMLElement | null = null

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

  // Build segment selector (hidden until a polar with segments is synced)
  segmentSelectorRow = document.createElement('div')
  segmentSelectorRow.className = 'debug-row debug-segment-selector-row'
  segmentSelectorRow.style.display = 'none'

  const segLabel = document.createElement('label')
  segLabel.className = 'debug-label'
  segLabel.textContent = 'Segment'
  segmentSelectorRow.appendChild(segLabel)

  segmentSelector = document.createElement('select')
  segmentSelector.className = 'debug-segment-select'
  segmentSelector.addEventListener('change', () => {
    switchToSegment(segmentSelector!.value)
  })
  segmentSelectorRow.appendChild(segmentSelector)

  panelEl.appendChild(segmentSelectorRow)

  // System summary view (shown when 'system' selected on segmented polars)
  systemViewEl = document.createElement('div')
  systemViewEl.id = 'debug-system-view'
  systemViewEl.style.display = 'none'
  panelEl.appendChild(systemViewEl)

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
  segmentOverrides.clear()
  selectedSegment = 'system'
  currentSegments = polar.aeroSegments

  // Update segment selector dropdown
  if (segmentSelector && segmentSelectorRow) {
    segmentSelector.innerHTML = ''

    if (currentSegments && currentSegments.length > 0) {
      segmentSelectorRow.style.display = ''

      // System-level option
      const sysOpt = document.createElement('option')
      sysOpt.value = 'system'
      sysOpt.textContent = 'System (whole polar)'
      segmentSelector.appendChild(sysOpt)

      // One option per segment
      for (const seg of currentSegments) {
        const opt = document.createElement('option')
        opt.value = seg.name
        // Nicer label: capitalize, show type
        const segType = seg.polar
          ? (seg.pitchOffset_deg ? 'lifting body' : (seg.name.startsWith('flap_') ? 'flap' : 'cell'))
          : 'parasitic'
        opt.textContent = `${seg.name} (${segType})`
        segmentSelector.appendChild(opt)
      }
      segmentSelector.value = 'system'
    } else {
      segmentSelectorRow.style.display = 'none'
    }
  }

  // Update all sliders to the system polar's values
  syncSlidersToBaseline(polar)
}

/**
 * Returns a ContinuousPolar with debug overrides applied.
 * If no overrides are active, returns the base polar unchanged.
 *
 * Only applies system-level overrides (segment='system').
 * For per-segment overrides, use getSegmentPolarOverrides().
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
 * Returns a map of segment name → overridden ContinuousPolar for segments
 * that have active debug overrides.
 *
 * Only populated when debug panel is open and segment-level overrides exist.
 * Segments not in the map should use their default polar unchanged.
 *
 * For parasitic segments (no .polar), overrides for 'cd_0' and 's' are
 * stored but applied differently — the caller should read 'cd_0' as the
 * parasitic CD and 's' as the reference area.
 */
export function getSegmentPolarOverrides(): Map<string, Map<string, number>> {
  if (!panelVisible) return new Map()
  // Return a copy so callers can't mutate our state
  const result = new Map<string, Map<string, number>>()
  for (const [name, ov] of segmentOverrides) {
    if (ov.size > 0) {
      result.set(name, new Map(ov))
    }
  }
  return result
}

/**
 * Returns true if the debug panel is open and has active overrides,
 * useful for adding the debug overrides to the sweep key so charts
 * recompute when sliders change.
 */
export function debugSweepKey(): string {
  if (!panelVisible) return ''

  // System-level overrides
  const parts: string[] = []
  for (const [k, v] of overrides) {
    parts.push(`sys:${k}:${v}`)
  }

  // Per-segment overrides
  for (const [segName, segOv] of segmentOverrides) {
    for (const [k, v] of segOv) {
      parts.push(`${segName}:${k}:${v}`)
    }
  }

  if (parts.length === 0) return ''
  return parts.sort().join(',')
}

// ─── Internal: Build DOM ─────────────────────────────────────────────────────

function formatVal(val: number, def: ParamDef): string {
  return `${val.toFixed(def.decimals)} ${def.unit}`
}

/**
 * Get the baseline polar for the currently selected segment.
 * - 'system' → basePolar
 * - segment with .polar → that segment's ContinuousPolar
 * - parasitic segment → synthesized mini-polar from S/CD
 */
function getBaselineForSelection(): ContinuousPolar | null {
  if (selectedSegment === 'system') return basePolar
  const seg = currentSegments?.find(s => s.name === selectedSegment)
  if (!seg) return basePolar
  if (seg.polar) return seg.polar
  // Parasitic: build a fake polar so the S, cd_0, and chord sliders work
  return { ...basePolar!, s: seg.S, cd_0: seg.getCoeffs(0, 0, dummyControls()).cd, chord: seg.chord }
}

/** Minimal controls for reading parasitic segment baseline CD */
function dummyControls() {
  return {
    brakeLeft: 0, brakeRight: 0,
    frontRiserLeft: 0, frontRiserRight: 0,
    rearRiserLeft: 0, rearRiserRight: 0,
    weightShiftLR: 0,
    elevator: 0, rudder: 0, aileronLeft: 0, aileronRight: 0, flap: 0,
    pitchThrottle: 0, yawThrottle: 0, rollThrottle: 0, dihedral: 0.5, wingsuitDeploy: 0,
    delta: 0, dirty: 0, unzip: 0, pilotPitch: 0, deploy: 1,
  }
}

/**
 * Get the active overrides map for the current selection.
 */
function getActiveOverrides(): Map<string, number> {
  if (selectedSegment === 'system') return overrides
  if (!segmentOverrides.has(selectedSegment)) {
    segmentOverrides.set(selectedSegment, new Map())
  }
  return segmentOverrides.get(selectedSegment)!
}

/** Which PARAM_DEFS keys are relevant for parasitic segments (no full polar) */
const PARASITIC_KEYS: Set<string> = new Set(['s', 'cd_0', 'chord'])

/** Keys to HIDE for flap segments (S/chord are computed dynamically from brake input) */
const FLAP_HIDDEN_KEYS: Set<string> = new Set(['s', 'chord', 'm', 'cg', 'cp_lateral'])

/**
 * Sync all slider positions and value labels to a given polar baseline.
 * Resets "modified" highlights based on current active overrides.
 */
function syncSlidersToBaseline(polar: ContinuousPolar): void {
  const selectedSeg = selectedSegment !== 'system'
    ? currentSegments?.find(s => s.name === selectedSegment)
    : undefined
  const isParasitic = selectedSeg ? !selectedSeg.polar : false
  const isFlap = selectedSegment.startsWith('flap_')

  // System selection on a segmented polar → hide all sliders
  // (system-level Kirchhoff model is not used when segments exist)
  const isSystemWithSegments = selectedSegment === 'system' &&
    currentSegments && currentSegments.length > 0

  const activeOv = getActiveOverrides()

  for (const def of PARAM_DEFS) {
    const slider = sliderEls.get(def.key)
    const label = valueEls.get(def.key)
    const row = rowEls.get(def.key)

    // Hide sliders: all for system+segments, non-parasitic-keys for parasitic,
    // dynamic params for flap segments (S/chord computed from brake input)
    if (row) {
      if (isSystemWithSegments) {
        row.style.display = 'none'
      } else if (isParasitic && !PARASITIC_KEYS.has(def.key)) {
        row.style.display = 'none'
      } else if (isFlap && FLAP_HIDDEN_KEYS.has(def.key)) {
        row.style.display = 'none'
      } else {
        row.style.display = ''
      }
    }

    const val = activeOv.has(def.key) ? activeOv.get(def.key)! : (polar[def.key] as number ?? 0)
    if (slider) {
      slider.min = String(def.min)
      slider.max = String(def.max)
      slider.step = String(def.step)
      slider.value = String(val)
    }
    if (label) {
      label.textContent = formatVal(val, def)
    }
    if (row) {
      row.classList.toggle('debug-modified', activeOv.has(def.key))
    }
  }

  // Also hide/show group headers
  if (panelEl) {
    const headers = panelEl.querySelectorAll<HTMLElement>('.debug-group-header')
    const resetBtn = panelEl.querySelector<HTMLElement>('#debug-reset')
    headers.forEach(h => {
      if (isSystemWithSegments) {
        h.style.display = 'none'
      } else if (isParasitic) {
        const text = h.textContent || ''
        h.style.display = (text === 'Drag Model' || text === 'Physical') ? '' : 'none'
      } else {
        h.style.display = ''
      }
    })
    // Hide reset button when system is selected on segmented polar
    if (resetBtn) {
      resetBtn.style.display = isSystemWithSegments ? 'none' : ''
    }
  }

  // Show/hide system summary view
  if (systemViewEl) {
    systemViewEl.style.display = isSystemWithSegments ? '' : 'none'
  }
}

/**
 * Switch the debug panel to show/edit a different segment (or system).
 */
function switchToSegment(segName: string): void {
  selectedSegment = segName
  const baseline = getBaselineForSelection()
  if (baseline) {
    syncSlidersToBaseline(baseline)
  }
}

function buildSliders(container: HTMLElement): void {
  // Reset button
  const resetBtn = document.createElement('button')
  resetBtn.id = 'debug-reset'
  resetBtn.textContent = 'Reset to Baseline'
  resetBtn.addEventListener('click', () => {
    if (basePolar) {
      overrides.clear()
      segmentOverrides.clear()
      selectedSegment = 'system'
      if (segmentSelector) segmentSelector.value = 'system'
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
    rowEls.set(def.key, row)

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

    // Input handler — routes to system or segment overrides based on selection
    slider.addEventListener('input', () => {
      const numVal = parseFloat(slider.value)
      valSpan.textContent = formatVal(numVal, def)

      const baseline = getBaselineForSelection()
      const activeOv = getActiveOverrides()

      if (baseline) {
        const baseVal = baseline[def.key] as number ?? 0
        if (Math.abs(numVal - baseVal) < Number(def.step) * 0.5) {
          activeOv.delete(def.key)
          row.classList.remove('debug-modified')
        } else {
          activeOv.set(def.key, numVal)
          row.classList.add('debug-modified')
        }
      } else {
        activeOv.set(def.key, numVal)
        row.classList.add('debug-modified')
      }

      onChange?.()
    })

    // Double-click to reset individual param
    slider.addEventListener('dblclick', () => {
      const baseline = getBaselineForSelection()
      if (baseline) {
        const baseVal = baseline[def.key] as number ?? 0
        slider.value = String(baseVal)
        valSpan.textContent = formatVal(baseVal, def)
        const activeOv = getActiveOverrides()
        activeOv.delete(def.key)
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

// ─── System Summary View ─────────────────────────────────────────────────────

/**
 * Data needed to render the system summary view.
 */
export interface SystemViewData {
  // Mass breakdown
  massBreakdown: {
    name: string
    mass_kg: number
    isWeight: boolean     // contributes to gravitational force
    isInertia: boolean    // contributes to rotational inertia
  }[]
  totalWeight_kg: number
  totalInertia_kg: number

  // System aero summary (pseudo-coefficients from segment sum)
  cl: number
  cd: number
  cy: number
  cm: number
  ld: number
  vxs: number
  vys: number

  // Per-segment force contributions
  segmentForces: {
    name: string
    lift: number
    drag: number
    side: number
  }[]
  totalLift: number
  totalDrag: number
  totalSide: number
}

/**
 * Update the system summary view with current flight state data.
 * Called from the main render loop when segments exist and panel is visible.
 */
export function updateSystemView(data: SystemViewData): void {
  if (!systemViewEl || systemViewEl.style.display === 'none') return

  const html: string[] = []

  // ── Mass breakdown ──
  html.push('<h4 class="debug-group-header">Mass Breakdown</h4>')
  html.push('<table class="debug-system-table">')
  html.push('<tr><th>Component</th><th>Mass</th><th>Weight</th><th>Inertia</th></tr>')

  for (const m of data.massBreakdown) {
    const w = m.isWeight ? '✓' : '—'
    const i = m.isInertia ? '✓' : '—'
    html.push(`<tr><td>${m.name}</td><td>${m.mass_kg.toFixed(1)} kg</td><td>${w}</td><td>${i}</td></tr>`)
  }

  html.push(`<tr class="debug-total-row"><td>Weight total</td><td>${data.totalWeight_kg.toFixed(1)} kg</td><td>✓</td><td></td></tr>`)
  html.push(`<tr class="debug-total-row"><td>Inertia total</td><td>${data.totalInertia_kg.toFixed(1)} kg</td><td></td><td>✓</td></tr>`)
  html.push('</table>')

  // ── Aero summary ──
  html.push('<h4 class="debug-group-header">System Aero Summary</h4>')
  html.push('<table class="debug-system-table">')
  html.push(`<tr><td>CL</td><td>${data.cl.toFixed(3)}</td><td>CD</td><td>${data.cd.toFixed(3)}</td></tr>`)
  html.push(`<tr><td>CY</td><td>${data.cy.toFixed(3)}</td><td>CM</td><td>${data.cm.toFixed(3)}</td></tr>`)
  html.push(`<tr><td>L/D</td><td>${data.ld.toFixed(2)}</td><td></td><td></td></tr>`)
  html.push(`<tr><td>Vxs</td><td>${data.vxs.toFixed(1)} m/s</td><td>Vys</td><td>${data.vys.toFixed(1)} m/s</td></tr>`)
  html.push('</table>')

  // ── Per-segment forces ──
  html.push('<h4 class="debug-group-header">Segment Forces</h4>')
  html.push('<table class="debug-system-table">')
  html.push('<tr><th>Segment</th><th>Lift (N)</th><th>Drag (N)</th><th>Side (N)</th></tr>')

  for (const sf of data.segmentForces) {
    const liftPct = data.totalLift !== 0 ? ` (${(sf.lift / data.totalLift * 100).toFixed(0)}%)` : ''
    const dragPct = data.totalDrag !== 0 ? ` (${(sf.drag / data.totalDrag * 100).toFixed(0)}%)` : ''
    html.push(`<tr><td>${sf.name}</td><td>${sf.lift.toFixed(1)}${liftPct}</td><td>${sf.drag.toFixed(1)}${dragPct}</td><td>${sf.side.toFixed(1)}</td></tr>`)
  }

  html.push(`<tr class="debug-total-row"><td>Total</td><td>${data.totalLift.toFixed(1)}</td><td>${data.totalDrag.toFixed(1)}</td><td>${data.totalSide.toFixed(1)}</td></tr>`)
  html.push('</table>')

  systemViewEl.innerHTML = html.join('')
}
