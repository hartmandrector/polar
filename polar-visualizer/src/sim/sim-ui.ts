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
import {
  initKeyboard, consumeKeyPress, updateKeyboardOrbit, updateZoom,
  getWingsuitKeyboardViz, getCanopyKeyboardViz,
} from './sim-keyboard.ts'

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
// Cached at 10 Hz (setInterval) and consumed every rAF frame so trail.update()
// never touches the DOM at 60 fps, and is never blocked by input scheduling.
let trailInertialMode = false

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
  const isCanopy = modelType === 'Canopy'

  // Labels (same for gamepad + keyboard)
  const ltLabel = document.getElementById('lt-label')
  const rtLabel = document.getElementById('rt-label')
  const lsLabel = document.getElementById('ls-label')
  const rsLabel = document.getElementById('rs-label')
  if (ltLabel) ltLabel.textContent = isCanopy ? 'L Brake' : 'Yaw L'
  if (rtLabel) rtLabel.textContent = isCanopy ? 'R Brake' : 'Yaw R'
  if (lsLabel) lsLabel.textContent = isCanopy ? 'L Riser' : 'Camera'
  if (rsLabel) rsLabel.textContent = isCanopy ? 'R Riser' : 'Pitch / Roll'

  if (!gp) {
    // Keyboard fallback — feed smoothed key values into the same viz.
    const k = isCanopy ? getCanopyKeyboardViz() : getWingsuitKeyboardViz()
    const active = Math.abs(k.lx) + Math.abs(k.ly) + Math.abs(k.rx) + Math.abs(k.ry) + k.lt + k.rt > 0.01
    if (statusEl) statusEl.innerHTML = active
      ? '<span style="color:#6cf;">⌨ Keyboard</span>'
      : '<span style="color:#888;">Gamepad: — <span style="color:#567;">(keyboard ready)</span></span>'
    updateStick('ls', k.lx, k.ly)
    updateStick('rs', k.rx, k.ry)
    updateTrigger('lt', k.lt)
    updateTrigger('rt', k.rt)
    const lsVal = document.getElementById('ls-values')
    const rsVal = document.getElementById('rs-values')
    if (lsVal) lsVal.textContent = `${k.lx.toFixed(2)}, ${k.ly.toFixed(2)}`
    if (rsVal) rsVal.textContent = `${k.rx.toFixed(2)}, ${k.ry.toFixed(2)}`
    return
  }

  // Diagnostic: show which buttons are currently pressed (helps map Start/View)
  const pressedIdx: number[] = []
  for (let i = 0; i < gp.buttons.length; i++) {
    if (gp.buttons[i]?.pressed) pressedIdx.push(i)
  }
  const pressedStr = pressedIdx.length > 0 ? ` btn:[${pressedIdx.join(',')}]` : ''
  if (statusEl) statusEl.innerHTML = `<span style="color:#0f0;">🎮 Connected</span><span style="color:#ff6;">${pressedStr}</span>`

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
}

/** Update debug-mode gamepad viz (suffixed element IDs) */
function updateGamepadVizDebug(modelType: string): void {
  const gp = navigator.getGamepads()[0]
  const statusEl = document.getElementById('gp-status-debug')
  const isCanopy = modelType === 'Canopy'

  const ltLabel = document.getElementById('lt-label-debug')
  const rtLabel = document.getElementById('rt-label-debug')
  const lsLabel = document.getElementById('ls-label-debug')
  const rsLabel = document.getElementById('rs-label-debug')
  if (ltLabel) ltLabel.textContent = isCanopy ? 'L Brake' : 'Yaw L'
  if (rtLabel) rtLabel.textContent = isCanopy ? 'R Brake' : 'Yaw R'
  if (lsLabel) lsLabel.textContent = isCanopy ? 'L Riser' : 'Camera'
  if (rsLabel) rsLabel.textContent = isCanopy ? 'R Riser' : 'Pitch / Roll'

  if (!gp) {
    const k = isCanopy ? getCanopyKeyboardViz() : getWingsuitKeyboardViz()
    const active = Math.abs(k.lx) + Math.abs(k.ly) + Math.abs(k.rx) + Math.abs(k.ry) + k.lt + k.rt > 0.01
    if (statusEl) statusEl.innerHTML = active
      ? '<span style="color:#6cf;">⌨ Keyboard</span>'
      : '<span style="color:#888;">Gamepad: —</span>'
    updateStick('ls-debug', k.lx, k.ly)
    updateStick('rs-debug', k.rx, k.ry)
    updateTrigger('lt-debug', k.lt)
    updateTrigger('rt-debug', k.rt)
    const lsVal = document.getElementById('ls-values-debug')
    const rsVal = document.getElementById('rs-values-debug')
    if (lsVal) lsVal.textContent = `${k.lx.toFixed(2)}, ${k.ly.toFixed(2)}`
    if (rsVal) rsVal.textContent = `${k.rx.toFixed(2)}, ${k.ry.toFixed(2)}`
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

          // Line twist warning during deploy
          const twistDeg = r.lineTwist
          const absTwist = Math.abs(twistDeg)
          const twistRate = r.lineTwistRate
          if (absTwist > 90) {
            const flash = Math.floor(t * 2) % 2 === 0
            const dir = twistDeg > 0 ? 'RIGHT' : 'LEFT'
            const recovering = (twistDeg > 0 && twistRate < -5) || (twistDeg < 0 && twistRate > 5)
            html += `<div style="color:${flash ? '#f00' : '#f88'}; font-weight:bold;">⚡ LINE TWIST ${absTwist.toFixed(0)}° ${dir} — KICK TO RECOVER ⚡</div>`
            if (recovering) {
              html += `<div style="color:#0f0;">↻ Recovering ${Math.abs(twistRate).toFixed(0)}°/s</div>`
            } else {
              html += `<div style="color:#f88;">Right stick X to kick</div>`
            }
          } else if (absTwist > 10) {
            const dir = twistDeg > 0 ? 'R' : 'L'
            html += `<div style="color:#fa0;">Twist: ${absTwist.toFixed(0)}°${dir} · ${Math.abs(twistRate).toFixed(0)}°/s</div>`
          }

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
          const brakesStowed = cds && !cds.brakesUnstowed
          const brakeLabel = brakesStowed
            ? '<span style="color:#fa0;">STOWED</span>'
            : '<span style="color:#0f0;">UNSTOWED</span>'
          html += `<div>GR: ${gr.toFixed(1)} · Deploy: ${cds ? (cds.deploy * 100).toFixed(0) + '%' : '100%'} · Brakes: ${brakeLabel}</div>`
          html += `<div>Controls: risers/${brakesStowed ? '<span style="color:#fa0;">brakes (stowed)</span>' : 'brakes'}/weight shift</div>`

          // Line twist warning during canopy flight
          const twistDeg = r.lineTwist
          const absTwist = Math.abs(twistDeg)
          const twistRate = r.lineTwistRate
          if (absTwist > 90) {
            const flash = Math.floor(t * 2) % 2 === 0
            const dir = twistDeg > 0 ? 'RIGHT' : 'LEFT'
            const recovering = (twistDeg > 0 && twistRate < -5) || (twistDeg < 0 && twistRate > 5)
            html += `<div style="color:${flash ? '#f00' : '#f88'}; font-weight:bold;">⚡ LINE TWIST ${absTwist.toFixed(0)}° ${dir} — KICK TO RECOVER ⚡</div>`
            if (recovering) {
              html += `<div style="color:#0f0;">↻ Recovering ${Math.abs(twistRate).toFixed(0)}°/s</div>`
            } else {
              html += `<div style="color:#f88;">Right stick X to kick</div>`
            }
          } else if (absTwist > 10) {
            const dir = twistDeg > 0 ? 'R' : 'L'
            html += `<div style="color:#fa0;">Twist: ${absTwist.toFixed(0)}°${dir} · ${Math.abs(twistRate).toFixed(0)}°/s</div>`
          }
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

// ─── Keyboard Help Overlay ──────────────────────────────────────────────────

/**
 * Creates a small '⌨ Keys' button at the bottom of the sim panel.
 * Clicking it opens a floating overlay listing all keyboard controls.
 * Dismiss: click anywhere outside the card, or press Escape.
 *
 * Must be called BEFORE initKeyboard() so our Escape capture listener is
 * registered first — initKeyboard's capture handler calls stopPropagation
 * which would swallow Escape before a later listener could see it.
 */
function createKeyboardHelp(panel: HTMLDivElement): void {
  // ── Help button ──────────────────────────────────────────────────────────
  const helpBtn = document.createElement('button')
  helpBtn.title = 'Keyboard controls reference'
  helpBtn.textContent = '⌨ Keys'
  helpBtn.style.cssText = [
    'display:block', 'width:100%', 'margin-top:4px',
    'background:#1c2535', 'color:#7af', 'border:1px solid #3a4d6a',
    'border-radius:4px', 'padding:5px 12px', 'font-size:12px',
    'cursor:pointer', 'font-family:system-ui,sans-serif',
  ].join(';')
  panel.appendChild(helpBtn)

  // ── Overlay backdrop ─────────────────────────────────────────────────────
  const overlay = document.createElement('div')
  overlay.style.cssText = [
    'display:none', 'position:fixed', 'inset:0',
    'background:rgba(0,0,0,0.55)', 'z-index:2000',
    'align-items:center', 'justify-content:center',
  ].join(';')

  // ── Content card ─────────────────────────────────────────────────────────
  const card = document.createElement('div')
  card.style.cssText = [
    'background:#141922', 'border:1px solid #3a4d6a', 'border-radius:10px',
    'padding:18px 22px', 'max-width:400px', 'width:90vw',
    'color:#ccd', 'font-family:system-ui,sans-serif', 'font-size:13px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.75)',
  ].join(';')
  card.addEventListener('click', e => e.stopPropagation())  // don't close on card click

  const row = (k: string, d: string): string =>
    `<tr><td style="font-family:monospace;font-size:12px;color:#7af;` +
    `padding:3px 12px 3px 0;white-space:nowrap">${k}</td>` +
    `<td style="color:#aab;padding:3px 0">${d}</td></tr>`
  const section = (title: string, rows: string): string =>
    `<tr><td colspan="2" style="padding-top:12px;padding-bottom:4px;` +
    `font-size:10px;color:#567;font-weight:700;text-transform:uppercase;` +
    `letter-spacing:1px">${title}</td></tr>${rows}`

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span style="font-size:15px;font-weight:700;color:#9cf">⌨ Keyboard Controls</span>
      <button id="key-help-close" style="background:none;border:none;color:#667;
        font-size:20px;line-height:1;cursor:pointer;padding:0 2px">&#x2715;</button>
    </div>
    <table style="border-collapse:collapse;width:100%">
      ${section('Wingsuit flight',
        row('↑ / ↓',   'Pitch nose-up / nose-down') +
        row('← / →',   'Roll left / right') +
        row('Q / E',   'Yaw left / right'))}
      ${section('Canopy',
        row('Q / E',   'Left / right brake') +
        row('↑ / ↓',   'Front / rear risers') +
        row('← / →',   'Weight shift'))}
      ${section('Camera',
        row('W A S D', 'Orbit camera') +
        row('Z / X',   'Zoom in / out'))}
      ${section('Simulator',
        row('Space',   'Start / Stop') +
        row('V',       'Toggle Body ↔ Inertial frame') +
        row('Enter',   'Pilot chute toss') +
        row('B',       'Unzip (deploy phase)'))}
    </table>
    <div style="margin-top:12px;font-size:11px;color:#445;text-align:center">
      Click outside or press Esc to close
    </div>`

  overlay.appendChild(card)
  document.body.appendChild(overlay)

  // ── Wiring ───────────────────────────────────────────────────────────────
  const open  = (): void => { overlay.style.display = 'flex' }
  const close = (): void => { overlay.style.display = 'none' }

  helpBtn.addEventListener('click', e => { e.stopPropagation(); open() })
  overlay.addEventListener('click', close)        // backdrop click closes
  document.getElementById('key-help-close')?.addEventListener('click', close)

  // Escape: capture phase so it fires before initKeyboard's stopPropagation.
  window.addEventListener('keydown', e => {
    if (e.code === 'Escape' && overlay.style.display !== 'none') {
      e.preventDefault()
      close()
    }
  }, { capture: true })
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create and inject the simulation control panel.
 */
export function setupSimUI(ctx: SimUIContext): void {
  panelEl = createPanel()
  // Help overlay listener must be registered BEFORE initKeyboard so the Escape
  // capture handler fires first (initKeyboard's capture handler calls
  // stopPropagation which would otherwise swallow Escape).
  createKeyboardHelp(panelEl)
  initKeyboard()

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
      console.log('[gamepad] MENU button (9) → toggleSim')
      toggleSim(ctx)
    }
    menuWasPressed = menuPressed

    // View button (button 8) — cycle view frame (Body ↔ Inertial)
    const viewPressed = gp ? (gp.buttons[VIEW_BUTTON]?.pressed ?? false) : false
    if (viewPressed && !viewWasPressed) {
      console.log('[gamepad] VIEW button (8) → cycle frame')
      cycleSelect('frame-select', 1)
    }
    viewWasPressed = viewPressed

    // A button (button 0) — pilot chute toss event (scenario mode only)
    const aPressed = gp ? (gp.buttons[A_BUTTON]?.pressed ?? false) : false
    if (aPressed && !aWasPressed) {
      handlePilotChuteToss(ctx)
    }
    aWasPressed = aPressed

    // ── Keyboard meta keys (gamepad-absent equivalents) ──
    if (consumeKeyPress('Space')) {
      console.log('[keyboard] Space → toggleSim')
      toggleSim(ctx)
    }
    if (consumeKeyPress('KeyV')) {
      console.log('[keyboard] V → cycle frame')
      cycleSelect('frame-select', 1)
    }
    if (consumeKeyPress('Enter')) {
      handlePilotChuteToss(ctx)
    }
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
  // Canopy yaw rate coupling — turns drag the pilot through line torque
  // Pilot inertia resists → relative twist. Scale: at r=0.5 rad/s (~30°/s turn),
  // steady-state twist ≈ coupling * r / stiffness ≈ 5 * 0.5 / 20 ≈ 0.125 rad ≈ 7°
  const twistYawCoupling = 5  // [N·m·s/rad]

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
    twistYawCoupling,
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
      // Trail runs at rAF rate (immune to input-event scheduler priority).
      // setInterval only caches the frame flag and sets trail.visible.
      if (trail && trailInertialMode && runner) trail.update(runner.state)
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
    if (!runner) return

    // Update trail visibility + gate flag (10 Hz is plenty for a mode toggle;
    // the actual trail.update() call is now in onUpdate/rAF so it is never
    // blocked by the browser deferring timers during active key input).
    trailInertialMode = ctx.getFlightState().frameMode === 'inertial'
    if (trail) trail.visible = trailInertialMode

    const polar = ctx.getPolar()
    const mt = polar.type ?? ''
    try {
      updateHUD(runner, mt, ctx)
    } catch (err) {
      console.error('[SimUI] updateHUD failed:', err)
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
  // Zoom works in all modes (camera-only): gamepad L3/R3 + Z/X keys.
  updateZoom(controls)

  if (polarType === 'Canopy' || polarType === 'canopy') return  // canopy uses left stick for risers

  // Keyboard camera orbit (WASD) — wingsuit only, mirrors gamepad left stick.
  updateKeyboardOrbit(controls)

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
