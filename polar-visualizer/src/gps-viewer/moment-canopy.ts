/**
 * Canopy legend formatter for MomentInset.
 *
 * Shows brake L/R and front riser L/R as unipolar [0–100%] bars,
 * plus a control→axis mapping showing which controls drive which moments.
 */

import type {
  MomentLegendFormatter,
  AxisMoments,
  WingsuitControls,
  CanopyControls,
  CanopyControlMap,
  ControlMomentContrib,
} from './moment-types'
import { formatColorKey, formatAxisMoments, fmt } from './moment-types'

// ─── Bar Formatter ──────────────────────────────────────────────────────────

/** Build one cell of the HTML bar (filled or empty) */
function cell(on: boolean): string {
  const bg = on ? '#ccc' : 'rgba(255,255,255,0.15)'
  return `<span style="display:inline-block;width:11px;height:16px;background:${bg};margin:0 1px;"></span>`
}

/** Format canopy control as unipolar bar [0–100%] (pull amount) */
function fmtBrake(v: number, label: string): string {
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 100)
  const pctStr = String(pct).padStart(3, ' ') + '%'
  const filled = Math.min(12, Math.round(v * 12))
  let bar = ''
  for (let i = 0; i < 12; i++) bar += cell(i < filled)
  return `  ${label} ${bar} ${pctStr}`
}

// ─── Control Map Formatting ─────────────────────────────────────────────────

const CTRL_LABELS: { key: keyof CanopyControlMap; label: string }[] = [
  { key: 'brakeLeft',       label: 'BkL' },
  { key: 'brakeRight',      label: 'BkR' },
  { key: 'frontRiserLeft',  label: 'FrL' },
  { key: 'frontRiserRight', label: 'FrR' },
]

/** Format which controls contribute to an axis, sorted by magnitude */
function fmtAxisContrib(
  axis: 'roll' | 'pitch' | 'yaw',
  map: CanopyControlMap,
): string {
  const contribs = CTRL_LABELS
    .map(({ key, label }) => ({ label, value: map[key][axis] }))
    .filter(c => Math.abs(c.value) > 0.5)  // only show meaningful contributions
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

  if (contribs.length === 0) return '  (none)'

  return contribs
    .map(c => `  ${c.label} ${fmt(c.value)}`)
    .join(' ')
}

// ─── Formatter ──────────────────────────────────────────────────────────────

export class CanopyLegendFormatter implements MomentLegendFormatter {
  private ctrl: CanopyControls = {
    brakeLeft: 0, brakeRight: 0,
    frontRiserLeft: 0, frontRiserRight: 0,
  }
  private controlMap: CanopyControlMap | null = null

  setControls(controls: WingsuitControls | CanopyControls): void {
    const c = controls as CanopyControls
    this.ctrl = {
      brakeLeft: c.brakeLeft ?? 0,
      brakeRight: c.brakeRight ?? 0,
      frontRiserLeft: c.frontRiserLeft ?? 0,
      frontRiserRight: c.frontRiserRight ?? 0,
    }
  }

  /** Set the control→axis mapping from the solver */
  setControlMap(map: CanopyControlMap | null): void {
    this.controlMap = map
  }

  formatControls(converged: boolean): string {
    const convStr = converged === false ? ' <span style="color:#f44">✗</span>' : ''
    return [
      formatColorKey(),
      `─────────`,
      `<b>Canopy Controls</b>${convStr}`,
      fmtBrake(this.ctrl.brakeLeft,      'Brake L   '),
      fmtBrake(this.ctrl.brakeRight,     'Brake R   '),
      fmtBrake(this.ctrl.frontRiserLeft,  'F.Riser L '),
      fmtBrake(this.ctrl.frontRiserRight, 'F.Riser R '),
    ].join('<br>')
  }

  formatMoments(moments: AxisMoments): string {
    const lines = [
      `─────────`,
      formatAxisMoments('Pitch', moments.pitch),
      formatAxisMoments('Roll', moments.roll),
      formatAxisMoments('Yaw', moments.yaw),
    ]

    // Append control→axis mapping if available, with spacer to clear arc diagrams
    if (this.controlMap) {
      lines.push(
        ``,
        ``,
        `─────────`,
        `<b>Control → Axis</b>`,
        `<span style="color:#aaf">Pitch:</span>${fmtAxisContrib('pitch', this.controlMap)}`,
        `<span style="color:#aaf">Roll:</span> ${fmtAxisContrib('roll', this.controlMap)}`,
        `<span style="color:#aaf">Yaw:</span>  ${fmtAxisContrib('yaw', this.controlMap)}`,
      )
    }

    return lines.join('<br>')
  }
}
