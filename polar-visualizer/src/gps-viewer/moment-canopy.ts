/**
 * Canopy legend formatter for MomentInset.
 *
 * Shows brake L/R and front riser L/R as unipolar [0–100%] bars.
 * Canopy controls are always non-negative (pull only).
 */

import type {
  MomentLegendFormatter,
  AxisMoments,
  WingsuitControls,
  CanopyControls,
} from './moment-types'
import { formatColorKey, formatAxisMoments } from './moment-types'

// ─── Bar Formatter ──────────────────────────────────────────────────────────

/** Format canopy control as unipolar bar [0–100%] (pull amount) */
function fmtBrake(v: number, label: string): string {
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 100)
  const pctStr = String(pct).padStart(3, ' ') + '%'
  const filled = Math.min(10, Math.round(v * 10))
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)
  return `  ${label} ${bar} ${pctStr}`
}

// ─── Formatter ──────────────────────────────────────────────────────────────

export class CanopyLegendFormatter implements MomentLegendFormatter {
  private ctrl: CanopyControls = {
    brakeLeft: 0, brakeRight: 0,
    frontRiserLeft: 0, frontRiserRight: 0,
  }

  setControls(controls: WingsuitControls | CanopyControls): void {
    const c = controls as CanopyControls
    this.ctrl = {
      brakeLeft: c.brakeLeft ?? 0,
      brakeRight: c.brakeRight ?? 0,
      frontRiserLeft: c.frontRiserLeft ?? 0,
      frontRiserRight: c.frontRiserRight ?? 0,
    }
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
    return [
      `─────────`,
      formatAxisMoments('Pitch', moments.pitch),
      formatAxisMoments('Roll', moments.roll),
      formatAxisMoments('Yaw', moments.yaw),
    ].join('<br>')
  }
}
