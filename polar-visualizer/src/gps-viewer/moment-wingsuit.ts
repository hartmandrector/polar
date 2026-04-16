/**
 * Wingsuit legend formatter for MomentInset.
 *
 * Shows pitch/roll/yaw throttle controls as ±100% bars.
 */

import type {
  MomentLegendFormatter,
  AxisMoments,
  WingsuitControls,
  CanopyControls,
} from './moment-types'
import { formatColorKey, formatAxisMoments } from './moment-types'

// ─── Bar Formatter ──────────────────────────────────────────────────────────

/** Format control input as fixed-width percentage bar (bipolar: -100% to +100%) */
function fmtCtrl(v: number): string {
  const pct = Math.round(v * 100)
  const pctStr = (pct >= 0 ? '+' : '') + String(pct).padStart(3, ' ') + '%'
  const filled = Math.min(5, Math.round(Math.abs(v) * 5))
  let bar: string
  if (v >= 0) {
    bar = '░░░░░' + '█'.repeat(filled) + '░'.repeat(5 - filled)
  } else {
    bar = '░'.repeat(5 - filled) + '█'.repeat(filled) + '░░░░░'
  }
  return `${bar} ${pctStr}`
}

// ─── Formatter ──────────────────────────────────────────────────────────────

export class WingsuitLegendFormatter implements MomentLegendFormatter {
  private ctrl: WingsuitControls = { pitch: 0, roll: 0, yaw: 0 }

  setControls(controls: WingsuitControls | CanopyControls): void {
    const c = controls as WingsuitControls
    this.ctrl = { pitch: c.pitch ?? 0, roll: c.roll ?? 0, yaw: c.yaw ?? 0 }
  }

  formatControls(converged: boolean): string {
    const convStr = converged === false ? ' <span style="color:#f44">✗</span>' : ''
    return [
      formatColorKey(),
      `─────────`,
      `<b>Controls</b>${convStr}`,
      `  Pitch ${fmtCtrl(this.ctrl.pitch)}`,
      `  Roll  ${fmtCtrl(this.ctrl.roll)}`,
      `  Yaw   ${fmtCtrl(this.ctrl.yaw)}`,
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
