/**
 * GPS Viewer — Scene Legend Overlays
 * 
 * Color-coded bubble-font text legends for inertial and body frame views.
 * Designed for PNG export: transparent background, high contrast text
 * with thick outlines for readability at any resolution.
 * 
 * Colors match force/moment vector arrows in GPSAeroOverlay.
 */

import type { GPSPipelinePoint } from '../gps/types'

// ─── Color palette (matches gps-aero-overlay.ts) ───────────────────────────
const C = {
  lift:    '#00ff88',
  drag:    '#ff4444',
  side:    '#ffff44',
  vel:     '#44aaff',
  rollM:   '#ff6644',
  pitchM:  '#44ff66',
  yawM:    '#6644ff',
  rollR:   '#ffbb88',
  pitchR:  '#88ffbb',
  yawR:    '#bb88ff',
  white:   '#e0e8f0',
  dim:     '#8090a0',
  heading: '#ffcc44',
  mode:    '#ff8844',
  section: '#e94560',
}

const r2d = 180 / Math.PI

/** Dark outline shadow for all bubble text */
const SHADOW = [
  '-1px -1px 0 #000', '1px -1px 0 #000',
  '-1px 1px 0 #000', '1px 1px 0 #000',
  '0 0 6px rgba(0,0,0,0.9)', '0 0 12px rgba(0,0,0,0.5)',
].join(',')

function section(title: string): string {
  return `<div class="legend-section" style="color:${C.section};text-shadow:${SHADOW}">${title}</div>`
}

function row(label: string, value: string, labelColor = C.dim, valueColor = C.white): string {
  return `<div class="legend-row">` +
    `<span class="legend-label" style="color:${labelColor};text-shadow:${SHADOW}">${label}</span>` +
    `<span class="legend-value" style="color:${valueColor};text-shadow:${SHADOW}">${value}</span>` +
    `</div>`
}

// ─── Inertial Frame Legend ──────────────────────────────────────────────────

export class InertialLegend {
  private el: HTMLDivElement

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'scene-legend'
    parent.appendChild(this.el)
  }

  update(pt: GPSPipelinePoint) {
    const p = pt.processed
    const a = pt.aero
    const fm = pt.flightMode
    const ms2mph = 2.237

    const psiDeg = ((a.psi * r2d) % 360 + 360) % 360

    this.el.innerHTML = [
      section('Flight Mode'),
      row('Mode', fm?.modeString ?? 'N/A', C.dim, C.mode),

      section('Position'),
      row('Altitude', `${(-p.posD).toFixed(0)} m (${(-p.posD * 3.281).toFixed(0)} ft)`),
      row('N / E', `${p.posN.toFixed(0)} / ${p.posE.toFixed(0)} m`),

      section('Velocity'),
      row('Airspeed', `${p.airspeed.toFixed(1)} m/s (${(p.airspeed * ms2mph).toFixed(0)} mph)`, C.dim, C.vel),
      row('Ground', `${p.groundSpeed.toFixed(1)} m/s`, C.dim, C.vel),
      row('Vert', `${(-p.velD).toFixed(1)} m/s`, C.dim, C.vel),

      section('Orientation'),
      row('φ (Bank)', `${(a.roll * r2d).toFixed(1)}°`, C.dim, C.rollM),
      row('θ (Pitch)', `${(a.theta * r2d).toFixed(1)}°`, C.dim, C.pitchM),
      row('ψ (Heading)', `${psiDeg.toFixed(1)}°`, C.dim, C.yawM),
      row('γ (FPA)', `${(a.gamma * r2d).toFixed(1)}°`),
    ].join('')
  }
}

// ─── Body Frame Legend ──────────────────────────────────────────────────────

export interface BodyLegendData {
  pt: GPSPipelinePoint
  converged: boolean
  controlPitch: number
  controlRoll: number
  controlYaw: number
}

export class BodyFrameLegend {
  private el: HTMLDivElement

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'scene-legend'
    parent.appendChild(this.el)
  }

  update(d: BodyLegendData) {
    const pt = d.pt
    const a = pt.aero
    const br = pt.bodyRates

    const convColor = d.converged ? '#44ff66' : '#ff4444'
    const ld = a.cl / Math.max(a.cd, 0.001)

    this.el.innerHTML = [
      section('Body Rates'),
      row('p (roll)', `${(br?.p ?? 0).toFixed(1)} °/s`, C.dim, C.rollR),
      row('q (pitch)', `${(br?.q ?? 0).toFixed(1)} °/s`, C.dim, C.pitchR),
      row('r (yaw)', `${(br?.r ?? 0).toFixed(1)} °/s`, C.dim, C.yawR),

      section('Aerodynamics'),
      row('α (AOA)', `${(a.aoa * r2d).toFixed(1)}°`),
      row('CL', a.cl.toFixed(3), C.dim, C.lift),
      row('CD', a.cd.toFixed(3), C.dim, C.drag),
      row('L/D', ld.toFixed(2)),

      section('Control Solver'),
      row('Converged', d.converged ? 'Yes' : 'No', C.dim, convColor),
      row('Pitch', `${(d.controlPitch * 100).toFixed(0)}%`, C.dim, C.pitchM),
      row('Roll', `${(d.controlRoll * 100).toFixed(0)}%`, C.dim, C.rollM),
      row('Yaw', `${(d.controlYaw * 100).toFixed(0)}%`, C.dim, C.yawM),
    ].join('')
  }
}
