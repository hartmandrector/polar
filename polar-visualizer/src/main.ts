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
import { loadModel, applyAlphaBeta, LoadedModel, ModelType } from './viewer/model-loader.ts'
import { createForceVectors, updateForceVectors, ForceVectors } from './viewer/vectors.ts'
import { setupControls, FlightState } from './ui/controls.ts'
import { updateReadout } from './ui/readout.ts'
import { initCharts, updateChartSweep, updateChartCursor } from './ui/polar-charts.ts'
import { getAllCoefficients, continuousPolars, legacyPolars, getLegacyCoefficients } from './polar/index.ts'
import type { ContinuousPolar } from './polar/index.ts'

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
  return `${s.polarKey}|${s.beta_deg}|${s.delta}|${s.dirty}|${s.airspeed}|${s.rho}`
}

function updateVisualization(state: FlightState): void {
  flightState = state

  // Get the continuous polar
  const polar: ContinuousPolar = continuousPolars[state.polarKey] || continuousPolars.aurafive

  // Evaluate coefficients
  const coeffs = getAllCoefficients(state.alpha_deg, state.beta_deg, state.delta, polar, state.dirty)

  // Update force vectors
  updateForceVectors(
    forceVectors,
    coeffs,
    polar,
    state.alpha_deg,
    state.beta_deg,
    state.airspeed,
    state.rho,
    state.frameMode,
    currentModel?.bodyLength ?? 2.0
  )

  // Update model rotation
  if (currentModel) {
    applyAlphaBeta(currentModel.group, state.alpha_deg, state.beta_deg, state.frameMode)
  }

  // Legacy comparison
  let legacyCoeffs: { cl: number, cd: number, cp: number } | undefined
  if (state.showLegacy) {
    const legacyPolar = legacyPolars[state.polarKey]
    if (legacyPolar) {
      legacyCoeffs = getLegacyCoefficients(state.alpha_deg, legacyPolar)
    }
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
    }, state.alpha_deg)
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

  // Setup UI controls — this returns the initial state
  flightState = setupControls((state) => {
    // When controls change, switch model if needed, then update
    switchModel(state.modelType).then(() => updateVisualization(state))
  })

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
