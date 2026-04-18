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

/** Build one cell of the HTML bar (filled or empty) */
function cell(on: boolean): string {
  const bg = on ? '#ccc' : 'rgba(255,255,255,0.15)'
  return `<span style="display:inline-block;width:6px;height:8px;background:${bg};margin:0 0.5px;"></span>`
}

/** Format control input as HTML bar (bipolar: -100% to +100%) */
function fmtCtrl(v: number): string {
  const pct = Math.round(v * 100)
  const pctStr = (pct >= 0 ? '+' : '') + String(pct).padStart(3, ' ') + '%'
  const filled = Math.min(5, Math.round(Math.abs(v) * 5))
  let bar = ''
  if (v >= 0) {
    for (let i = 0; i < 5; i++) bar += cell(false)
    for (let i = 0; i < 5; i++) bar += cell(i < filled)
  } else {
    for (let i = 0; i < 5; i++) bar += cell(i >= 5 - filled)
    for (let i = 0; i < 5; i++) bar += cell(false)
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
