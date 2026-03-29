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
}

/** Create a bubble-font span: colored text with dark outline for readability */
function bubble(text: string, color: string): string {
  const shadow = [
    '-1px -1px 0 #000', '1px -1px 0 #000',
    '-1px 1px 0 #000', '1px 1px 0 #000',
    '0 0 4px rgba(0,0,0,0.8)',
  ].join(',')
  return `<span style="color:${color};text-shadow:${shadow}">${text}</span>`
}

function fmt(v: number, decimals = 1): string {
  return v.toFixed(decimals)
}

function fmtDeg(v: number, decimals = 1): string {
  return `${(v * 180 / Math.PI).toFixed(decimals)}°`
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
    const mode = pt.flightMode?.modeString ?? 'Unknown'
    const alt = p.posD ? (-p.posD).toFixed(0) : '—'
    const altFt = p.posD ? (-p.posD * 3.281).toFixed(0) : '—'
    const gs = Math.sqrt(p.velN * p.velN + p.velE * p.velE + p.velD * p.velD)
    const hs = p.groundSpeed
    const vs = -p.velD

    this.el.innerHTML = [
      `<div class="legend-row">${bubble(mode, C.mode)}</div>`,
      `<div class="legend-row">${bubble(`${alt}m`, C.white)} ${bubble(`(${altFt}ft)`, C.dim)}</div>`,
      `<div class="legend-row">${bubble(`GS ${fmt(gs)}`, C.vel)} ${bubble(`H ${fmt(hs)}`, C.vel)} ${bubble(`V ${fmt(vs)}`, C.vel)} ${bubble('m/s', C.dim)}</div>`,
      `<div class="legend-row">${bubble(`φ ${fmtDeg(pt.aero.roll)}`, C.rollM)} ${bubble(`θ ${fmtDeg(pt.aero.theta)}`, C.pitchM)} ${bubble(`ψ ${fmtDeg(pt.aero.psi)}`, C.yawM)}</div>`,
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

    // Body rates (deg/s from pipeline)
    const p_rate = pt.bodyRates?.p ?? 0
    const q_rate = pt.bodyRates?.q ?? 0
    const r_rate = pt.bodyRates?.r ?? 0

    const convColor = d.converged ? '#00ff88' : '#ff4444'

    this.el.innerHTML = [
      // Body rates
      `<div class="legend-row">${bubble(`p ${fmt(p_rate)}`, C.rollR)} ${bubble(`q ${fmt(q_rate)}`, C.pitchR)} ${bubble(`r ${fmt(r_rate)}°/s`, C.yawR)}</div>`,
      // Aero
      `<div class="legend-row">${bubble(`α ${fmtDeg(a.aoa)}`, C.white)} ${bubble(`CL ${fmt(a.cl, 3)}`, C.lift)} ${bubble(`CD ${fmt(a.cd, 3)}`, C.drag)} ${bubble(`L/D ${fmt(a.cl / Math.max(a.cd, 0.001), 1)}`, C.dim)}</div>`,
      // Controls
      `<div class="legend-row">${bubble(`Ctrl`, convColor)} ${bubble(`P ${fmt(d.controlPitch * 100, 0)}%`, C.pitchM)} ${bubble(`R ${fmt(d.controlRoll * 100, 0)}%`, C.rollM)} ${bubble(`Y ${fmt(d.controlYaw * 100, 0)}%`, C.yawM)}</div>`,
    ].join('')
  }
}
