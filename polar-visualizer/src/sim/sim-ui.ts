/**
 * Simulation UI — Start/Stop button and HUD overlay.
 *
 * Wires SimRunner into the existing viewer by:
 *   1. Building SimConfig from the current polar + controls
 *   2. Feeding sim output back through updateVisualization()
 *   3. Showing a minimal HUD (altitude, speed, sim time)
 */

import { SimRunner } from './sim-runner.ts'
import type { SimRunnerCallbacks } from './sim-runner.ts'
import type { SimConfig } from '../polar/sim-state.ts'
import type { FlightState } from '../ui/controls.ts'
import type { ContinuousPolar, AeroSegment, SegmentControls } from '../polar/continuous-polar.ts'
import type { InertiaComponents } from '../polar/inertia.ts'
import { computeCenterOfMass, computeInertia, ZERO_INERTIA } from '../polar/inertia.ts'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SimUIContext {
  /** Get current FlightState from sliders */
  getFlightState: () => FlightState
  /** Get current ContinuousPolar (with overrides applied) */
  getPolar: () => ContinuousPolar
  /** Get mass reference for current vehicle */
  getMassReference: () => number
  /** Get current inertia */
  getInertia: () => InertiaComponents
  /** Build SegmentControls from FlightState */
  buildControls: (state: FlightState) => SegmentControls
  /** Push updated FlightState to the viewer */
  updateVisualization: (state: FlightState) => void
}

// ─── State ──────────────────────────────────────────────────────────────────

let runner: SimRunner | null = null
let hudEl: HTMLDivElement | null = null
let buttonEl: HTMLButtonElement | null = null
let hudUpdateInterval = 0

// ─── HUD ────────────────────────────────────────────────────────────────────

function createHUD(): HTMLDivElement {
  const hud = document.createElement('div')
  hud.id = 'sim-hud'
  hud.style.cssText = `
    position: fixed; top: 10px; right: 10px; z-index: 1000;
    background: rgba(0,0,0,0.75); color: #0f0; font-family: monospace;
    font-size: 14px; padding: 8px 12px; border-radius: 6px;
    pointer-events: none; min-width: 180px;
  `
  document.body.appendChild(hud)
  return hud
}

function updateHUD(r: SimRunner): void {
  if (!hudEl) return
  const alt = r.altitude
  const spd = r.speed
  const t = r.time
  const s = r.state

  // Vertical speed: NED z-dot (positive = descending)
  const vspeed = s.u * Math.sin(s.theta) - s.v * Math.sin(s.phi) * Math.cos(s.theta) - s.w * Math.cos(s.phi) * Math.cos(s.theta)
  // Approximation: body-frame w projected to inertial vertical ≈ -zDot
  // More precise: use the full DCM, but this is close enough for HUD

  hudEl.innerHTML = `
    <div style="color:#ff6; font-weight:bold; margin-bottom:4px;">⏱ SIM RUNNING</div>
    <div>t: ${t.toFixed(1)}s</div>
    <div>Alt: ${alt.toFixed(0)}m</div>
    <div>V: ${spd.toFixed(1)} m/s (${(spd * 2.237).toFixed(0)} mph)</div>
    <div>α: ${(Math.atan2(s.w, s.u) * 180 / Math.PI).toFixed(1)}°</div>
    <div>β: ${(Math.asin(Math.max(-1, Math.min(1, s.v / Math.max(spd, 0.1)))) * 180 / Math.PI).toFixed(1)}°</div>
    <div style="color:#888; font-size:11px; margin-top:4px;">Gamepad: ${navigator.getGamepads()[0] ? '🎮 Connected' : '—'}</div>
  `
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create and inject the Start/Stop Simulation button.
 */
export function setupSimUI(ctx: SimUIContext): void {
  const btn = document.createElement('button')
  btn.id = 'sim-toggle'
  btn.textContent = '▶ Start Sim'
  btn.style.cssText = `
    position: fixed; bottom: 10px; right: 10px; z-index: 1000;
    background: #1a5; color: white; border: none; border-radius: 6px;
    padding: 10px 18px; font-size: 14px; font-weight: bold; cursor: pointer;
    font-family: system-ui, sans-serif;
  `
  btn.addEventListener('click', () => toggleSim(ctx))
  document.body.appendChild(btn)
  buttonEl = btn
}

function toggleSim(ctx: SimUIContext): void {
  if (runner?.isRunning) {
    stopSim()
  } else {
    startSim(ctx)
  }
}

function startSim(ctx: SimUIContext): void {
  const flightState = ctx.getFlightState()

  const callbacks: SimRunnerCallbacks = {
    onUpdate: (state: FlightState) => {
      ctx.updateVisualization(state)
    },

    getSimConfig: (): SimConfig => {
      const polar = ctx.getPolar()
      const massRef = ctx.getMassReference()
      const state = ctx.getFlightState()  // for controls
      const controls = ctx.buildControls(state)

      const segments = polar.aeroSegments ?? []
      const cgMeters = polar.massSegments && polar.massSegments.length > 0
        ? computeCenterOfMass(polar.massSegments, massRef, polar.m)
        : { x: 0, y: 0, z: 0 }
      const inertia = polar.massSegments
        ? computeInertia(polar.inertiaMassSegments ?? polar.massSegments, massRef, polar.m)
        : ZERO_INERTIA

      // TODO: Apparent mass integration — currently using isotropic mass.
      // Apparent mass is computed dynamically in composite-frame.ts;
      // will need to be wired in for canopy sim (affects translational EOM).

      return {
        segments,
        controls,
        cgMeters,
        inertia,
        mass: polar.m,
        height: polar.referenceLength,
        rho: state.rho,
      }
    },

    getBaseState: () => ctx.getFlightState(),
  }

  runner = new SimRunner(flightState, callbacks)
  runner.start()

  // HUD
  hudEl = createHUD()
  hudUpdateInterval = window.setInterval(() => {
    if (runner) updateHUD(runner)
  }, 100)  // 10 Hz HUD update

  if (buttonEl) {
    buttonEl.textContent = '⏹ Stop Sim'
    buttonEl.style.background = '#a33'
  }
}

function stopSim(): void {
  if (runner) {
    runner.stop()
    runner = null
  }
  if (hudEl) {
    hudEl.remove()
    hudEl = null
  }
  if (hudUpdateInterval) {
    clearInterval(hudUpdateInterval)
    hudUpdateInterval = 0
  }
  if (buttonEl) {
    buttonEl.textContent = '▶ Start Sim'
    buttonEl.style.background = '#1a5'
  }
}
