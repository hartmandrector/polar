/**
 * Polar Visualizer — main entry point.
 * 
 * Wires together:
 * - Three.js scene
 * - 3D model loading
 * - Force vector visualization
 * - UI controls
 * - Continuous polar math
 * - Coefficient readout
 */

import { createScene, resizeRenderer, SceneContext } from './viewer/scene.ts'
import { loadModel, applyAttitude, LoadedModel, ModelType } from './viewer/model-loader.ts'
import { createForceVectors, updateForceVectors, ForceVectors } from './viewer/vectors.ts'
import { setupControls, FlightState } from './ui/controls.ts'
import { updateReadout } from './ui/readout.ts'
import { initCharts, updateChartSweep, updateChartCursor } from './ui/polar-charts.ts'
import { getAllCoefficients, continuousPolars, legacyPolars, getLegacyCoefficients } from './polar/index.ts'
import type { ContinuousPolar } from './polar/index.ts'
import { setupDebugPanel, syncDebugPanel, getOverriddenPolar, debugSweepKey } from './ui/debug-panel.ts'
import { bodyToInertialQuat, bodyQuatFromWindAttitude } from './viewer/frames.ts'
import * as THREE from 'three'

// ─── App State ───────────────────────────────────────────────────────────────

let sceneCtx: SceneContext
let currentModel: LoadedModel | null = null
let forceVectors: ForceVectors
let flightState: FlightState
let loadingModel = false

// ─── Model Management ────────────────────────────────────────────────────────

async function switchModel(modelType: ModelType): Promise<void> {
  if (loadingModel) return
  if (currentModel && currentModel.type === modelType) return

  loadingModel = true

  // Remove old model
  if (currentModel) {
    sceneCtx.scene.remove(currentModel.group)
  }

  try {
    currentModel = await loadModel(modelType)
    sceneCtx.scene.add(currentModel.group)
  } catch (err) {
    console.error(`Failed to load model ${modelType}:`, err)
    currentModel = null
  }

  loadingModel = false
}

// ─── Update Loop ─────────────────────────────────────────────────────────────

/** Track sweep-affecting params to detect when only α changes (cursor-only). */
let prevSweepKey = ''

function sweepKey(s: FlightState): string {
  return `${s.polarKey}|${s.beta_deg}|${s.delta}|${s.dirty}|${s.airspeed}|${s.rho}|${debugSweepKey()}`
}

function updateVisualization(state: FlightState): void {
  flightState = state

  // Get the continuous polar (with debug overrides if panel is open)
  const basePolar: ContinuousPolar = continuousPolars[state.polarKey] || continuousPolars.aurafive
  const polar: ContinuousPolar = getOverriddenPolar(basePolar)

  // Evaluate coefficients
  const coeffs = getAllCoefficients(state.alpha_deg, state.beta_deg, state.delta, polar, state.dirty)

  // ── Compute body-to-inertial rotation ──
  // null = body frame (no rotation); Quaternion = inertial frame
  const DEG2RAD = Math.PI / 180
  let bodyQuat: THREE.Quaternion | null = null
  let bodyMatrix: THREE.Matrix4 | null = null

  if (state.frameMode === 'inertial') {
    if (state.attitudeMode === 'wind') {
      // Sliders specify wind direction; combine with α/β to get body attitude
      bodyQuat = bodyQuatFromWindAttitude(
        state.roll_deg * DEG2RAD,
        state.pitch_deg * DEG2RAD,
        state.yaw_deg * DEG2RAD,
        state.alpha_deg * DEG2RAD,
        state.beta_deg * DEG2RAD
      )
    } else {
      // Sliders specify body attitude directly
      bodyQuat = bodyToInertialQuat(
        state.roll_deg * DEG2RAD,
        state.pitch_deg * DEG2RAD,
        state.yaw_deg * DEG2RAD
      )
    }
    bodyMatrix = new THREE.Matrix4().makeRotationFromQuaternion(bodyQuat)
  }

  // Update force vectors
  updateForceVectors(
    forceVectors,
    coeffs,
    polar,
    state.alpha_deg,
    state.beta_deg,
    state.airspeed,
    state.rho,
    currentModel?.bodyLength ?? 2.0,
    bodyMatrix
  )

  // Update model rotation
  if (currentModel) {
    applyAttitude(currentModel.group, bodyQuat)
  }

  // Legacy comparison
  const legacyPolar = legacyPolars[state.polarKey]
  let legacyCoeffs: { cl: number, cd: number, cp: number } | undefined
  if (state.showLegacy && legacyPolar) {
    legacyCoeffs = getLegacyCoefficients(state.alpha_deg, legacyPolar)
  }

  // Update readout panel
  updateReadout(coeffs, polar, state.airspeed, state.rho, legacyCoeffs)

  // ─── Charts ──────────────────────────────────────────────────────────────

  const key = sweepKey(state)
  if (key !== prevSweepKey) {
    // Full sweep-affecting parameter changed → recompute sweep
    prevSweepKey = key
    updateChartSweep(polar, {
      minAlpha: -180,
      maxAlpha: 180,
      beta_deg: state.beta_deg,
      delta: state.delta,
      dirty: state.dirty,
      rho: state.rho,
      airspeed: state.airspeed,
    }, state.alpha_deg, legacyPolar)
  } else {
    // Only α changed → move cursor
    updateChartCursor(state.alpha_deg)
  }
}

// ─── Initialization ──────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const canvas = document.getElementById('three-canvas') as HTMLCanvasElement
  const viewport = document.getElementById('viewport') as HTMLElement

  // Create Three.js scene
  sceneCtx = createScene(canvas)
  resizeRenderer(sceneCtx, viewport)

  // Create force vectors
  forceVectors = createForceVectors()
  sceneCtx.scene.add(forceVectors.group)

  // Initialize chart panels
  initCharts()

  // Setup debug override panel
  setupDebugPanel(() => {
    // When any debug slider changes, re-run visualization with current flight state
    if (flightState) updateVisualization(flightState)
  })

  // Track polar selection to only sync debug panel when it actually changes
  let prevPolarKey = ''

  // Setup UI controls — this returns the initial state
  flightState = setupControls((state) => {
    // When polar selection changes, sync debug panel to new baseline
    if (state.polarKey !== prevPolarKey) {
      prevPolarKey = state.polarKey
      const basePolar = continuousPolars[state.polarKey] || continuousPolars.aurafive
      syncDebugPanel(basePolar)
    }

    // When controls change, switch model if needed, then update
    switchModel(state.modelType).then(() => updateVisualization(state))
  })

  // Sync debug panel to initial polar
  prevPolarKey = flightState.polarKey
  const initialPolar = continuousPolars[flightState.polarKey] || continuousPolars.aurafive
  syncDebugPanel(initialPolar)

  // Load initial model
  await switchModel(flightState.modelType)

  // Initial visualization update
  updateVisualization(flightState)

  // Resize handler
  window.addEventListener('resize', () => {
    resizeRenderer(sceneCtx, viewport)
  })

  // also check once after a short delay (for initial layout)
  setTimeout(() => resizeRenderer(sceneCtx, viewport), 100)

  // Render loop
  function animate(): void {
    requestAnimationFrame(animate)
    sceneCtx.controls.update()
    sceneCtx.renderer.render(sceneCtx.scene, sceneCtx.camera)
  }
  animate()
}

// ─── Start ───────────────────────────────────────────────────────────────────

init().catch((err) => {
  console.error('Failed to initialize Polar Visualizer:', err)
  document.body.innerHTML = `<div style="color:red;padding:2em;">Initialization failed: ${err.message}</div>`
})
