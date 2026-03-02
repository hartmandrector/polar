/**
 * Simulation UI — Control panel with gamepad visualization and HUD.
 *
 * Positioned on the right edge of the viewport, just left of the chart column.
 * Shows:
 *   - Start/Stop button
 *   - HUD telemetry (alt, speed, α, β, time)
 *   - Gamepad connection status
 *   - Two analog stick visualizations (circles with moving dots)
 *   - Two trigger bar visualizations
 *   - Semantic control labels (vehicle-aware)
 */

import { SimRunner } from './sim-runner.ts'
import type { SimRunnerCallbacks } from './sim-runner.ts'
import type { SimConfig } from '../polar/sim-state.ts'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Spherical, Vector3 } from 'three'
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
let panelEl: HTMLDivElement | null = null
let buttonEl: HTMLButtonElement | null = null
let hudUpdateInterval = 0

/** Gamepad Menu button (button 9) toggle — edge-triggered */
const MENU_BUTTON = 9
let menuWasPressed = false

/** Gamepad Back/View button (button 8) — cycle view frame */
const VIEW_BUTTON = 8
let viewWasPressed = false

/** Gamepad bumpers (LB=4, RB=5) — cycle polar selection */
const LB_BUTTON = 4
const RB_BUTTON = 5
let lbWasPressed = false
let rbWasPressed = false

/** Cycle a <select> element forward or backward, triggering change event */
function cycleSelect(selectId: string, direction: 1 | -1): void {
  const sel = document.getElementById(selectId) as HTMLSelectElement | null
  if (!sel || sel.options.length === 0) return
  sel.selectedIndex = (sel.selectedIndex + direction + sel.options.length) % sel.options.length
  sel.dispatchEvent(new Event('change'))
}

// ─── Gamepad Visualization ──────────────────────────────────────────────────

const STICK_SIZE = 64        // px — diameter of stick circle
const STICK_DOT = 10         // px — diameter of moving dot
const TRIGGER_W = 20         // px — trigger bar width
const TRIGGER_H = 50         // px — trigger bar height

function createStickSVG(id: string): string {
  const r = STICK_SIZE / 2
  const dr = STICK_DOT / 2
  return `
    <svg id="${id}" width="${STICK_SIZE}" height="${STICK_SIZE}" viewBox="0 0 ${STICK_SIZE} ${STICK_SIZE}">
      <circle cx="${r}" cy="${r}" r="${r - 1}" fill="none" stroke="#555" stroke-width="1"/>
      <line x1="${r}" y1="2" x2="${r}" y2="${STICK_SIZE - 2}" stroke="#333" stroke-width="0.5"/>
      <line x1="2" y1="${r}" x2="${STICK_SIZE - 2}" y2="${r}" stroke="#333" stroke-width="0.5"/>
      <circle id="${id}-dot" cx="${r}" cy="${r}" r="${dr}" fill="#0f0"/>
    </svg>
  `
}

function createTriggerSVG(id: string): string {
  return `
    <svg id="${id}" width="${TRIGGER_W}" height="${TRIGGER_H}" viewBox="0 0 ${TRIGGER_W} ${TRIGGER_H}">
      <rect x="1" y="1" width="${TRIGGER_W - 2}" height="${TRIGGER_H - 2}" fill="none" stroke="#555" stroke-width="1" rx="2"/>
      <rect id="${id}-fill" x="2" y="${TRIGGER_H - 2}" width="${TRIGGER_W - 4}" height="0" fill="#0f0" rx="1"/>
    </svg>
  `
}

function updateStick(id: string, x: number, y: number): void {
  const dot = document.getElementById(`${id}-dot`)
  if (!dot) return
  const r = STICK_SIZE / 2
  const range = r - STICK_DOT / 2 - 2
  dot.setAttribute('cx', String(r + x * range))
  dot.setAttribute('cy', String(r + y * range))

  // Color: green at center, yellow at edges
  const mag = Math.sqrt(x * x + y * y)
  const g = Math.round(255 - mag * 100)
  const rr = Math.round(mag * 200)
  dot.setAttribute('fill', `rgb(${rr},${g},0)`)
}

function updateTrigger(id: string, value: number): void {
  const fill = document.getElementById(`${id}-fill`)
  if (!fill) return
  const h = value * (TRIGGER_H - 4)
  fill.setAttribute('y', String(TRIGGER_H - 2 - h))
  fill.setAttribute('height', String(h))

  // Color: green→yellow→red
  const r = Math.round(Math.min(255, value * 2 * 255))
  const g = Math.round(Math.min(255, (1 - value) * 2 * 255))
  fill.setAttribute('fill', `rgb(${r},${g},0)`)
}

// ─── Panel Construction ─────────────────────────────────────────────────────

function createPanel(): HTMLDivElement {
  const panel = document.createElement('div')
  panel.id = 'sim-panel'
  panel.style.cssText = `
    position: fixed;
    top: 10px;
    right: 490px;
    z-index: 1000;
    background: rgba(0,0,0,0.65);
    color: #0f0;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 12px;
    padding: 10px;
    border-radius: 6px;
    pointer-events: auto;
    min-width: 200px;
    user-select: none;
  `

  panel.innerHTML = `
    <div id="sim-hud" style="margin-bottom: 8px;">
      <div style="color:#888; font-size:11px;">SIM IDLE</div>
    </div>

    <div style="border-top: 1px solid #333; padding-top: 8px; margin-bottom: 6px;">
      <div id="gp-status" style="color:#888; font-size:11px; margin-bottom: 6px;">Gamepad: —</div>

      <div id="gp-controls" style="display: flex; gap: 12px; align-items: flex-start;">
        <!-- Left side: LT trigger + left stick -->
        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
          <div style="font-size:10px; color:#888;" id="lt-label">LT</div>
          ${createTriggerSVG('lt')}
          <div style="font-size:10px; color:#888;" id="ls-label">L Stick</div>
          ${createStickSVG('ls')}
          <div id="ls-values" style="font-size:10px; color:#666;">0.00, 0.00</div>
        </div>

        <!-- Right side: RT trigger + right stick -->
        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
          <div style="font-size:10px; color:#888;" id="rt-label">RT</div>
          ${createTriggerSVG('rt')}
          <div style="font-size:10px; color:#888;" id="rs-label">R Stick</div>
          ${createStickSVG('rs')}
          <div id="rs-values" style="font-size:10px; color:#666;">0.00, 0.00</div>
        </div>
      </div>
    </div>
  `

  document.body.appendChild(panel)
  return panel
}

function updateGamepadViz(modelType: string): void {
  const gp = navigator.getGamepads()[0]
  const statusEl = document.getElementById('gp-status')

  if (!gp) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#888;">Gamepad: —</span>'
    updateStick('ls', 0, 0)
    updateStick('rs', 0, 0)
    updateTrigger('lt', 0)
    updateTrigger('rt', 0)
    return
  }

  if (statusEl) statusEl.innerHTML = '<span style="color:#0f0;">🎮 Connected</span>'

  // Raw axes
  const lx = gp.axes[0] ?? 0
  const ly = gp.axes[1] ?? 0
  const rx = gp.axes[2] ?? 0
  const ry = gp.axes[3] ?? 0
  const lt = gp.buttons[6]?.value ?? 0
  const rt = gp.buttons[7]?.value ?? 0

  updateStick('ls', lx, ly)
  updateStick('rs', rx, ry)
  updateTrigger('lt', lt)
  updateTrigger('rt', rt)

  // Numeric values
  const lsVal = document.getElementById('ls-values')
  const rsVal = document.getElementById('rs-values')
  if (lsVal) lsVal.textContent = `${lx.toFixed(2)}, ${ly.toFixed(2)}`
  if (rsVal) rsVal.textContent = `${rx.toFixed(2)}, ${ry.toFixed(2)}`

  // Update labels based on vehicle type
  const ltLabel = document.getElementById('lt-label')
  const rtLabel = document.getElementById('rt-label')
  const lsLabel = document.getElementById('ls-label')
  const rsLabel = document.getElementById('rs-label')

  const isCanopy = modelType === 'Canopy'
  if (ltLabel) ltLabel.textContent = isCanopy ? 'L Brake' : 'Yaw L'
  if (rtLabel) rtLabel.textContent = isCanopy ? 'R Brake' : 'Yaw R'
  if (lsLabel) lsLabel.textContent = isCanopy ? 'L Riser' : 'Camera'
  if (rsLabel) rsLabel.textContent = isCanopy ? 'R Riser' : 'Pitch / Roll'
}

// ─── HUD Update ─────────────────────────────────────────────────────────────

function updateHUD(r: SimRunner, modelType: string): void {
  const hudEl = document.getElementById('sim-hud')
  if (!hudEl) return

  const alt = r.altitude
  const spd = r.speed
  const t = r.time
  const s = r.state

  hudEl.innerHTML = `
    <div style="color:#ff6; font-weight:bold; margin-bottom:2px;">⏱ SIM RUNNING</div>
    <div>t: ${t.toFixed(1)}s</div>
    <div>Alt: ${alt.toFixed(0)}m</div>
    <div>V: ${spd.toFixed(1)} m/s (${(spd * 2.237).toFixed(0)} mph)</div>
    <div>α: ${(Math.atan2(s.w, s.u) * 180 / Math.PI).toFixed(1)}°</div>
    <div>β: ${(Math.asin(Math.max(-1, Math.min(1, s.v / Math.max(spd, 0.1)))) * 180 / Math.PI).toFixed(1)}°</div>
  `

  updateGamepadViz(modelType)
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create and inject the simulation control panel.
 */
export function setupSimUI(ctx: SimUIContext): void {
  panelEl = createPanel()

  // Add Start/Stop button at the bottom of the panel
  const btn = document.createElement('button')
  btn.id = 'sim-toggle'
  btn.textContent = '▶ Start Sim'
  btn.style.cssText = `
    display: block;
    width: 100%;
    margin-top: 8px;
    background: #1a5;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: bold;
    cursor: pointer;
    font-family: system-ui, sans-serif;
  `
  btn.addEventListener('click', () => toggleSim(ctx))
  panelEl.appendChild(btn)
  buttonEl = btn

  // Poll gamepad even when sim isn't running (shows connection status + menu button)
  setInterval(() => {
    const polar = ctx.getPolar()
    const modelType = polar.type ?? ''

    if (!runner?.isRunning) {
      updateGamepadViz(modelType)
    }

    // Menu button (button 9) — edge-triggered sim toggle
    const gp = navigator.getGamepads()[0]
    const menuPressed = gp ? (gp.buttons[MENU_BUTTON]?.pressed ?? false) : false
    if (menuPressed && !menuWasPressed) {
      toggleSim(ctx)
    }
    menuWasPressed = menuPressed

    // View button (button 8) — cycle view frame (Body ↔ Inertial)
    const viewPressed = gp ? (gp.buttons[VIEW_BUTTON]?.pressed ?? false) : false
    if (viewPressed && !viewWasPressed) {
      cycleSelect('frame-select', 1)
    }
    viewWasPressed = viewPressed

    // Bumpers (LB=4, RB=5) — cycle polar selection
    const lbPressed = gp ? (gp.buttons[LB_BUTTON]?.pressed ?? false) : false
    if (lbPressed && !lbWasPressed) {
      cycleSelect('polar-select', -1)
    }
    lbWasPressed = lbPressed

    const rbPressed = gp ? (gp.buttons[RB_BUTTON]?.pressed ?? false) : false
    if (rbPressed && !rbWasPressed) {
      cycleSelect('polar-select', 1)
    }
    rbWasPressed = rbPressed
  }, 100)
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
      const state = ctx.getFlightState()
      const controls = ctx.buildControls(state)

      const segments = polar.aeroSegments ?? []
      const cgMeters = polar.massSegments && polar.massSegments.length > 0
        ? computeCenterOfMass(polar.massSegments, massRef, polar.m)
        : { x: 0, y: 0, z: 0 }
      const inertia = polar.massSegments
        ? computeInertia(polar.inertiaMassSegments ?? polar.massSegments, massRef, polar.m)
        : ZERO_INERTIA

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

  // HUD update at 10 Hz
  const polar = ctx.getPolar()
  const modelType = polar.type ?? ''
  hudUpdateInterval = window.setInterval(() => {
    if (runner) updateHUD(runner, modelType)
  }, 100)

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
  if (hudUpdateInterval) {
    clearInterval(hudUpdateInterval)
    hudUpdateInterval = 0
  }

  // Reset HUD to idle
  const hudEl = document.getElementById('sim-hud')
  if (hudEl) hudEl.innerHTML = '<div style="color:#888; font-size:11px;">SIM IDLE</div>'

  if (buttonEl) {
    buttonEl.textContent = '▶ Start Sim'
    buttonEl.style.background = '#1a5'
  }
}

// ─── Gamepad Orbit Controls ─────────────────────────────────────────────────

/** Orbit speed in radians per frame at full stick deflection */
const ORBIT_SPEED = 0.03

/** Deadzone for orbit stick (same as flight controls) */
const ORBIT_DEADZONE = 0.08

/**
 * Drive orbit camera from left stick (wingsuit mode only).
 * Call this every frame from the render loop.
 *
 * Left stick X → azimuthal rotation (orbit horizontal)
 * Left stick Y → polar rotation (orbit vertical)
 *
 * Only active when a wingsuit polar is selected (canopy uses left stick for risers).
 */
export function updateGamepadOrbit(controls: OrbitControls, polarType: string): void {
  if (polarType === 'Canopy') return  // canopy uses left stick for risers

  const gp = navigator.getGamepads()[0]
  if (!gp) return

  const lx = gp.axes[0] ?? 0
  const ly = gp.axes[1] ?? 0

  // Apply deadzone
  const dx = Math.abs(lx) > ORBIT_DEADZONE ? lx : 0
  const dy = Math.abs(ly) > ORBIT_DEADZONE ? ly : 0

  if (dx === 0 && dy === 0) return

  // Compute spherical offset relative to target
  const offset = controls.object.position.clone().sub(controls.target)
  const spherical = new Spherical().setFromVector3(offset)

  // OrbitControls uses theta for azimuthal (horizontal), phi for polar (vertical)
  spherical.theta -= dx * ORBIT_SPEED
  spherical.phi   -= dy * ORBIT_SPEED

  // Clamp phi to avoid flipping (stay within 0.1 – π-0.1)
  spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi))

  offset.setFromSpherical(spherical)
  controls.object.position.copy(controls.target).add(offset)
  controls.object.lookAt(controls.target)
}
