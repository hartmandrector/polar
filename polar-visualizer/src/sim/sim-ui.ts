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
import { TrailRenderer } from '../viewer/trail.ts'
import type { SimConfig, PilotCouplingConfig } from '../polar/sim-state.ts'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Spherical, Vector3 } from 'three'
import type * as THREE from 'three'
import type { FlightState } from '../ui/controls.ts'
import type { ContinuousPolar, AeroSegment, SegmentControls } from '../polar/continuous-polar.ts'
import type { InertiaComponents } from '../polar/inertia.ts'
import { computeCenterOfMass, computeInertia, ZERO_INERTIA } from '../polar/inertia.ts'
import { setSimVelocity } from '../ui/polar-charts.ts'

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
  /** Get the Three.js scene for trail rendering */
  getScene: () => THREE.Scene
  /** Get the orbit controls for camera manipulation */
  getControls: () => OrbitControls
  /** Get the camera */
  getCamera: () => THREE.PerspectiveCamera
}

// ─── State ──────────────────────────────────────────────────────────────────

let runner: SimRunner | null = null
let trail: TrailRenderer | null = null

// Phase FSM state
type SimPhase = 'idle' | 'freefall' | 'deployment' | 'canopy' | 'landed'
let currentPhase: SimPhase = 'idle'
let currentScenario: 'debug' | 'wingsuit-base' = 'debug'
let phaseStartTime = 0       // sim time when current phase started
let exitAltitude = 0          // altitude at sim start (for Δh calc)
let exitPosition = { x: 0, y: 0 }  // NED position at sim start (for Δd calc)
let panelEl: HTMLDivElement | null = null
let buttonEl: HTMLButtonElement | null = null
let hudUpdateInterval = 0

/** Gamepad Menu button (button 9) toggle — edge-triggered */
const MENU_BUTTON = 9
let menuWasPressed = false

/** Gamepad Back/View button (button 8) — cycle view frame */
const VIEW_BUTTON = 8
let viewWasPressed = false

/** Gamepad A button (button 0) — pilot chute toss event */
const A_BUTTON = 0
let aWasPressed = false

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
    min-width: 240px;
    user-select: none;
  `

  panel.innerHTML = `
    <!-- Scenario box (outer) -->
    <div id="scenario-box" style="border: 1px solid #444; border-radius: 4px; padding: 6px; margin-bottom: 8px; display: none;">
      <div id="scenario-header" style="color: #ff6; font-weight: bold; font-size: 11px; margin-bottom: 4px;">Scenario: —</div>
      <div id="scenario-telemetry" style="font-size: 11px; color: #aaa; margin-bottom: 6px;"></div>

      <!-- Phase box (inner) -->
      <div id="phase-box" style="border: 1px solid #555; border-radius: 3px; padding: 6px; background: rgba(0,0,0,0.3);">
        <div id="phase-header" style="color: #0ff; font-weight: bold; font-size: 11px; margin-bottom: 4px;">Phase: —</div>
        <div id="phase-telemetry" style="font-size: 11px; margin-bottom: 6px;"></div>

        <!-- Gamepad viz lives inside phase box -->
        <div style="border-top: 1px solid #333; padding-top: 6px;">
          <div id="gp-status" style="color:#888; font-size:11px; margin-bottom: 6px;">Gamepad: —</div>
          <div id="gp-controls" style="display: flex; gap: 12px; align-items: flex-start;">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
              <div style="font-size:10px; color:#888;" id="lt-label">LT</div>
              ${createTriggerSVG('lt')}
              <div style="font-size:10px; color:#888;" id="ls-label">L Stick</div>
              ${createStickSVG('ls')}
              <div id="ls-values" style="font-size:10px; color:#666;">0.00, 0.00</div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
              <div style="font-size:10px; color:#888;" id="rt-label">RT</div>
              ${createTriggerSVG('rt')}
              <div style="font-size:10px; color:#888;" id="rs-label">R Stick</div>
              ${createStickSVG('rs')}
              <div id="rs-values" style="font-size:10px; color:#666;">0.00, 0.00</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Debug mode HUD (when no scenario) -->
    <div id="sim-hud" style="margin-bottom: 8px;">
      <div style="color:#888; font-size:11px;">SIM IDLE</div>
    </div>

    <!-- Debug mode gamepad (outside scenario box) -->
    <div id="debug-gamepad" style="border-top: 1px solid #333; padding-top: 8px; margin-bottom: 6px;">
      <div id="gp-status-debug" style="color:#888; font-size:11px; margin-bottom: 6px;">Gamepad: —</div>
      <div id="gp-controls-debug" style="display: flex; gap: 12px; align-items: flex-start;">
        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
          <div style="font-size:10px; color:#888;" id="lt-label-debug">LT</div>
          ${createTriggerSVG('lt-debug')}
          <div style="font-size:10px; color:#888;" id="ls-label-debug">L Stick</div>
          ${createStickSVG('ls-debug')}
          <div id="ls-values-debug" style="font-size:10px; color:#666;">0.00, 0.00</div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
          <div style="font-size:10px; color:#888;" id="rt-label-debug">RT</div>
          ${createTriggerSVG('rt-debug')}
          <div style="font-size:10px; color:#888;" id="rs-label-debug">R Stick</div>
          ${createStickSVG('rs-debug')}
          <div id="rs-values-debug" style="font-size:10px; color:#666;">0.00, 0.00</div>
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

/** Update debug-mode gamepad viz (suffixed element IDs) */
function updateGamepadVizDebug(modelType: string): void {
  const gp = navigator.getGamepads()[0]
  const statusEl = document.getElementById('gp-status-debug')

  if (!gp) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#888;">Gamepad: —</span>'
    updateStick('ls-debug', 0, 0)
    updateStick('rs-debug', 0, 0)
    updateTrigger('lt-debug', 0)
    updateTrigger('rt-debug', 0)
    return
  }

  if (statusEl) statusEl.innerHTML = '<span style="color:#0f0;">🎮 Connected</span>'

  const lx = gp.axes[0] ?? 0
  const ly = gp.axes[1] ?? 0
  const rx = gp.axes[2] ?? 0
  const ry = gp.axes[3] ?? 0
  const lt = gp.buttons[6]?.value ?? 0
  const rt = gp.buttons[7]?.value ?? 0

  updateStick('ls-debug', lx, ly)
  updateStick('rs-debug', rx, ry)
  updateTrigger('lt-debug', lt)
  updateTrigger('rt-debug', rt)

  const lsVal = document.getElementById('ls-values-debug')
  const rsVal = document.getElementById('rs-values-debug')
  if (lsVal) lsVal.textContent = `${lx.toFixed(2)}, ${ly.toFixed(2)}`
  if (rsVal) rsVal.textContent = `${rx.toFixed(2)}, ${ry.toFixed(2)}`

  const isCanopy = modelType === 'Canopy'
  const ltLabel = document.getElementById('lt-label-debug')
  const rtLabel = document.getElementById('rt-label-debug')
  const lsLabel = document.getElementById('ls-label-debug')
  const rsLabel = document.getElementById('rs-label-debug')
  if (ltLabel) ltLabel.textContent = isCanopy ? 'L Brake' : 'Yaw L'
  if (rtLabel) rtLabel.textContent = isCanopy ? 'R Brake' : 'Yaw R'
  if (lsLabel) lsLabel.textContent = isCanopy ? 'L Riser' : 'Camera'
  if (rsLabel) rsLabel.textContent = isCanopy ? 'R Riser' : 'Pitch / Roll'
}

// ─── HUD Update ─────────────────────────────────────────────────────────────

function updateHUD(r: SimRunner, modelType: string, ctx: SimUIContext): void {
  const hudEl = document.getElementById('sim-hud')
  const scenarioBox = document.getElementById('scenario-box')
  const debugGamepad = document.getElementById('debug-gamepad')
  if (!hudEl) return

  const alt = r.altitude
  const spd = r.speed
  const t = r.time
  const s = r.state

  const isScenario = currentScenario !== 'debug'

  if (isScenario && scenarioBox) {
    // ── Scenario mode: nested display ──
    scenarioBox.style.display = ''
    hudEl.style.display = 'none'
    if (debugGamepad) debugGamepad.style.display = 'none'

    // Scenario header
    const scenarioHeader = document.getElementById('scenario-header')
    const scenarioLabels: Record<string, string> = { 'wingsuit-base': '🪂 Wingsuit BASE' }
    if (scenarioHeader) scenarioHeader.textContent = scenarioLabels[currentScenario] || currentScenario

    // Scenario telemetry
    const scenarioTelemetry = document.getElementById('scenario-telemetry')
    const deltaH = exitAltitude - alt
    const dx = s.x - exitPosition.x
    const dy = s.y - exitPosition.y
    const deltaD = Math.sqrt(dx * dx + dy * dy)
    if (scenarioTelemetry) {
      scenarioTelemetry.innerHTML = `
        <span>Alt: ${alt.toFixed(0)}m AGL</span> · 
        <span>Δh: ${deltaH.toFixed(0)}m</span> · 
        <span>Δd: ${deltaD.toFixed(0)}m</span> · 
        <span>t: ${t.toFixed(1)}s</span>
      `
    }

    // Phase header
    const phaseHeader = document.getElementById('phase-header')
    const phaseColors: Record<SimPhase, string> = {
      idle: '#888', freefall: '#0ff', deployment: '#ff0', canopy: '#0f0', landed: '#888'
    }
    const phaseLabels: Record<SimPhase, string> = {
      idle: 'Idle', freefall: '🦅 Freefall', deployment: '🪂 Deployment', canopy: '🪂 Canopy', landed: '🏁 Landed'
    }
    if (phaseHeader) {
      phaseHeader.style.color = phaseColors[currentPhase]
      phaseHeader.textContent = `Phase: ${phaseLabels[currentPhase]}`
    }

    // Phase telemetry
    const phaseTelemetry = document.getElementById('phase-telemetry')
    const alpha = Math.atan2(s.w, s.u) * 180 / Math.PI
    const beta = Math.asin(Math.max(-1, Math.min(1, s.v / Math.max(spd, 0.1)))) * 180 / Math.PI
    const phaseT = t - phaseStartTime
    if (phaseTelemetry) {
      let html = `
        <div>V: ${spd.toFixed(1)} m/s (${(spd * 2.237).toFixed(0)} mph) · α: ${alpha.toFixed(1)}° · β: ${beta.toFixed(1)}°</div>
        <div>Phase t: ${phaseT.toFixed(1)}s · Controls: ${modelType === 'Canopy' ? 'risers/brakes' : 'pitch/roll/yaw'}</div>
      `
      // Phase transition: freefall → canopy at line stretch
      if (currentPhase === 'freefall' && r.deployRenderState?.phase === 'line_stretch') {
        currentPhase = 'canopy'
        phaseStartTime = t
        console.log(`[FSM] Phase: freefall → canopy (line stretch at t=${t.toFixed(1)}s)`)
      }

      if (currentPhase === 'canopy') {
        const cds = r.canopyDeployState
        const gr = spd > 1 ? Math.abs(r.groundSpeed / r.verticalSpeed) : 0

        if (cds && !cds.unzipped) {
          // ── Deploy / unzipping phase HUD ──
          const deployPct = (cds.deploy * 100).toFixed(0)
          const brakeStatus = cds.unzipTriggered
            ? `UNLOCKING ${(cds.unzipProgress * 100).toFixed(0)}%`
            : 'STOWED'

          const controlLabel = cds.unzipTriggered
            ? `risers (${(0.25 + 0.75 * cds.unzipProgress).toFixed(0) === '1' ? 'full' : (cds.unzipProgress * 100).toFixed(0) + '%'}) · brakes (${brakeStatus})`
            : 'risers (limited) · weight shift'

          html += `<div>GR: ${gr.toFixed(1)} · Deploy: ${deployPct}% · Brakes: ${brakeStatus}</div>`
          html += `<div>Controls: ${controlLabel}</div>`

          if (cds.unzipTriggered && !cds.unzipped) {
            // Unzipping progress bar
            const pct = cds.unzipProgress
            const filled = Math.round(pct * 10)
            const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)
            html += `<div style="color:#ff0;">UNZIPPING [${bar}] ${(pct * 100).toFixed(0)}%</div>`
          } else {
            // Flash "PRESS B TO UNZIP" — toggle on half-second
            const flash = Math.floor(t * 2) % 2 === 0
            html += `<div style="color:${flash ? '#ff0' : '#ff8'}; font-weight:bold;">⚡ PRESS B TO UNZIP ⚡</div>`
          }
        } else {
          // ── Normal canopy flight HUD ──
          const brakesPct = cds ? (cds.brakeLeft * 100).toFixed(0) + '%' : '—'
          html += `<div>GR: ${gr.toFixed(1)} · Deploy: ${cds ? (cds.deploy * 100).toFixed(0) + '%' : '100%'} · Brakes: ${brakesPct}</div>`
          html += `<div>Controls: risers/brakes/weight shift</div>`
        }
      } else if (currentPhase === 'freefall') {
        const ds = r.deployRenderState
        if (ds) {
          html += `<div>🪂 PC dist: ${ds.chainDistance.toFixed(1)}m · T: ${ds.bridleTension.toFixed(0)}N · CD: ${ds.pcCD.toFixed(2)} · Phase: ${ds.phase}</div>`
          if (ds.canopyBag) {
            html += `<div>Canopy bag: dist ${ds.bagDistance.toFixed(1)}m · T: ${ds.bagTension.toFixed(0)}N · yaw ${(ds.canopyBag.yaw * 180 / Math.PI).toFixed(0)}° · pitch ${(ds.canopyBag.pitch * 180 / Math.PI).toFixed(0)}° · roll ${(ds.canopyBag.roll * 180 / Math.PI).toFixed(0)}°</div>`
          }
        } else {
          html += `<div>Next: A = PC toss</div>`
        }
      }
      phaseTelemetry.innerHTML = html
    }
  } else {
    // ── Debug mode: classic HUD ──
    if (scenarioBox) scenarioBox.style.display = 'none'
    hudEl.style.display = ''
    if (debugGamepad) debugGamepad.style.display = ''

    hudEl.innerHTML = `
      <div style="color:#ff6; font-weight:bold; margin-bottom:2px;">⏱ SIM RUNNING</div>
      <div>t: ${t.toFixed(1)}s</div>
      <div>Alt: ${alt.toFixed(0)}m</div>
      <div>V: ${spd.toFixed(1)} m/s (${(spd * 2.237).toFixed(0)} mph)</div>
      <div>α: ${(Math.atan2(s.w, s.u) * 180 / Math.PI).toFixed(1)}°</div>
      <div>β: ${(Math.asin(Math.max(-1, Math.min(1, s.v / Math.max(spd, 0.1)))) * 180 / Math.PI).toFixed(1)}°</div>
    `
  }

  // Push actual sim velocity + acceleration to speed polar
  setSimVelocity({
    vxs: r.groundSpeed,
    vys: r.verticalSpeed,
    aH: r.horizontalAccel,
    aV: r.verticalAccel,
  })

  // Update gamepad viz (both scenario and debug use their respective elements)
  if (isScenario) {
    updateGamepadViz(modelType)
  } else {
    updateGamepadVizDebug(modelType)
  }
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

    // A button (button 0) — pilot chute toss event (scenario mode only)
    const aPressed = gp ? (gp.buttons[A_BUTTON]?.pressed ?? false) : false
    if (aPressed && !aWasPressed) {
      handlePilotChuteToss(ctx)
    }
    aWasPressed = aPressed
  }, 100)
}

/** Handle pilot chute toss — spawn PC sub-sim (stays in freefall) */
function handlePilotChuteToss(ctx: SimUIContext): void {
  const state = ctx.getFlightState()
  // Only works in scenario mode during freefall phase
  if (state.scenario === 'debug' || !runner?.isRunning) return
  if (currentPhase !== 'freefall') return

  // Spawn PC rigid body — does NOT change phase
  runner.tossPilotChute()
  console.log(`[FSM] Pilot chute tossed — still in freefall, PC sub-sim active`)

  // Zoom out camera if too close for deployment visibility
  startDeployZoomOut(ctx)
}

// ─── Deploy Camera Zoom ──────────────────────────────────────────────────────

const DEPLOY_MIN_DISTANCE = 20  // minimum camera distance for deployment
const DEPLOY_ZOOM_DURATION = 2.0  // seconds to reach target distance
let deployZoomActive = false
let deployZoomStart = 0
let deployZoomFrom = 0

function startDeployZoomOut(ctx: SimUIContext): void {
  const camera = ctx.getCamera()
  const controls = ctx.getControls()
  const dist = camera.position.distanceTo(controls.target)
  if (dist >= DEPLOY_MIN_DISTANCE) return  // already far enough
  deployZoomFrom = dist
  deployZoomStart = performance.now()
  deployZoomActive = true
}

/** Call each frame from the sim tick to animate the zoom. */
export function tickDeployZoom(ctx: SimUIContext): void {
  if (!deployZoomActive) return
  const elapsed = (performance.now() - deployZoomStart) / 1000
  const t = Math.min(1, elapsed / DEPLOY_ZOOM_DURATION)
  const eased = 1 - (1 - t) * (1 - t)  // ease-out
  const dist = deployZoomFrom + (DEPLOY_MIN_DISTANCE - deployZoomFrom) * eased

  const camera = ctx.getCamera()
  const controls = ctx.getControls()
  const dir = camera.position.clone().sub(controls.target).normalize()
  camera.position.copy(controls.target).addScaledVector(dir, dist)
  controls.update()

  if (t >= 1) deployZoomActive = false
}

function toggleSim(ctx: SimUIContext): void {
  if (runner?.isRunning) {
    stopSim()
  } else {
    startSim(ctx)
  }
}

// ─── Pilot Coupling Defaults ────────────────────────────────────────────────

/**
 * Build PilotCouplingConfig for the current vehicle.
 * Returns undefined for non-canopy vehicles (no coupling yet).
 */
function buildPilotCoupling(
  polar: ContinuousPolar,
  _state: FlightState,
): PilotCouplingConfig | undefined {
  // Only canopy vehicles have pilot coupling for now
  if (polar.type !== 'Canopy') return undefined

  const pilotMass = polar.m * 0.85  // ~85% of system mass is pilot
  const riserLength = 0.5           // m — riser confluence to pilot CG

  // Pitch pendulum — gravity-restoring
  const pitchInertia = pilotMass * riserLength * riserLength
  const pitchSpring = 5     // small additional spring [N·m/rad]
  const pitchDamp = 2 * Math.sqrt(pitchSpring * pitchInertia) * 0.7  // ~70% critical

  // Lateral — stiff spring (geometric, tracks instantly)
  const lateralInertia = pilotMass * 0.15 * 0.15  // ~15cm lateral radius
  const lateralSpring = 200   // stiff [N·m/rad]
  const lateralDamp = 2 * Math.sqrt(lateralSpring * lateralInertia)  // critical damping

  // Twist — sinusoidal restoring from line geometry
  const twistInertia = pilotMass * 0.2 * 0.2  // ~20cm twist radius
  const twistStiffness = 20   // [N·m] — strong in full flight
  const twistDamp = 2 * Math.sqrt(twistStiffness * twistInertia) * 0.5  // underdamped

  // Filter pilot-body mass segments (exclude canopy cells)
  const CANOPY_NAMES = ['center', 'inner', 'outer', 'tip', 'brake']
  const pilotSegments = (polar.massSegments ?? []).filter(
    seg => !CANOPY_NAMES.some(cn => seg.name.toLowerCase().includes(cn))
  )

  // Pivot point — riser confluence in NED normalised coords
  // Approximation: top of pilot body (x ≈ CG_x, z ≈ 0)
  const pivotNED = { x: 0.4, z: 0 }

  return {
    riserLength,
    pilotMass,
    pitchSpring,
    pitchDamp,
    pitchInertia,
    lateralSpring,
    lateralDamp,
    lateralInertia,
    twistStiffness,
    twistDamp,
    twistInertia,
    pilotSegments,
    pivotNED,
  }
}

function startSim(ctx: SimUIContext): void {
  const flightState = ctx.getFlightState()

  // Set up phase FSM
  currentScenario = flightState.scenario
  if (currentScenario === 'wingsuit-base') {
    currentPhase = 'freefall'
  } else {
    currentPhase = 'freefall'  // debug mode — just label it freefall
  }

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
        pilotCoupling: buildPilotCoupling(polar, state),
      }
    },

    getBaseState: () => ctx.getFlightState(),
  }

  runner = new SimRunner(flightState, callbacks)
  runner.start()

  // Record exit conditions for telemetry
  exitAltitude = runner.altitude
  exitPosition = { x: runner.state.x, y: runner.state.y }
  phaseStartTime = 0

  // Create trail renderer (reset on each sim start)
  if (trail) trail.dispose()
  trail = new TrailRenderer(ctx.getScene())
  // HUD update at 10 Hz — read modelType dynamically for phase transitions
  hudUpdateInterval = window.setInterval(() => {
    if (runner) {
      const polar = ctx.getPolar()
      const mt = polar.type ?? ''
      updateHUD(runner, mt, ctx)
      if (trail) {
        const inertial = ctx.getFlightState().frameMode === 'inertial'
        trail.visible = inertial
        if (inertial) trail.update(runner.state)
      }
    }
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
  if (trail) {
    trail.dispose()
    trail = null
  }
  if (hudUpdateInterval) {
    clearInterval(hudUpdateInterval)
    hudUpdateInterval = 0
  }

  // Reset phase state
  currentPhase = 'idle'

  // Reset HUD to idle
  const hudEl = document.getElementById('sim-hud')
  if (hudEl) {
    hudEl.style.display = ''
    hudEl.innerHTML = '<div style="color:#888; font-size:11px;">SIM IDLE</div>'
  }
  const scenarioBox = document.getElementById('scenario-box')
  if (scenarioBox) scenarioBox.style.display = 'none'
  const debugGamepad = document.getElementById('debug-gamepad')
  if (debugGamepad) debugGamepad.style.display = ''

  // Clear sim velocity dot from speed polar
  setSimVelocity(null)

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
  if (polarType === 'Canopy' || polarType === 'canopy') return  // canopy uses left stick for risers

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
  spherical.theta += dx * ORBIT_SPEED
  spherical.phi   -= dy * ORBIT_SPEED

  // Clamp phi to avoid flipping (stay within 0.1 – π-0.1)
  spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi))

  offset.setFromSpherical(spherical)
  controls.object.position.copy(controls.target).add(offset)
  controls.object.lookAt(controls.target)
}
