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
import { loadModel, applyAttitude, applyCgOffset, LoadedModel, ModelType, PilotType, updateBridleOrientation } from './viewer/model-loader.ts'
import { createForceVectors, updateForceVectors, ForceVectors } from './viewer/vectors.ts'
import { setupControls, FlightState } from './ui/controls.ts'
import { updateReadout } from './ui/readout.ts'
import { initCharts, updateChartSweep, updateChartCursor } from './ui/polar-charts.ts'
import { getAllCoefficients, continuousPolars, legacyPolars, getLegacyCoefficients } from './polar/index.ts'
import type { ContinuousPolar } from './polar/index.ts'
import { setupDebugPanel, syncDebugPanel, getOverriddenPolar, debugSweepKey } from './ui/debug-panel.ts'
import { bodyToInertialQuat, bodyQuatFromWindAttitude } from './viewer/frames.ts'
import { updateInertiaReadout } from './ui/readout.ts'
import { computeInertia, ZERO_INERTIA } from './polar/inertia.ts'
import type { InertiaComponents } from './polar/inertia.ts'
import { createMassOverlay, MassOverlay } from './viewer/mass-overlay.ts'
import * as THREE from 'three'

// ─── App State ───────────────────────────────────────────────────────────────

let sceneCtx: SceneContext
let currentModel: LoadedModel | null = null
let forceVectors: ForceVectors
let flightState: FlightState
let loadingModel = false
let massOverlay: MassOverlay
let currentInertia: InertiaComponents = ZERO_INERTIA
let prevPolarKeyForInertia = ''

// ─── Model Management ────────────────────────────────────────────────────────

async function switchModel(modelType: ModelType, cgOffsetFraction: number = 0, pilotType?: PilotType): Promise<void> {
  if (loadingModel) return
  if (currentModel && currentModel.type === modelType && currentModel.pilotType === pilotType) return

  loadingModel = true

  // Remove old model
  if (currentModel) {
    sceneCtx.scene.remove(currentModel.group)
  }

  try {
    currentModel = await loadModel(modelType, pilotType)
    // Apply CG offset from polar so model is centered at CG, not bbox center
    if (cgOffsetFraction) {
      applyCgOffset(currentModel, cgOffsetFraction)
    }
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

  // Recompute inertia when polar changes
  if (state.polarKey !== prevPolarKeyForInertia) {
    prevPolarKeyForInertia = state.polarKey
    currentInertia = polar.massSegments
      ? computeInertia(polar.massSegments, 1.875, polar.m)
      : ZERO_INERTIA
  }

  // Evaluate coefficients
  const coeffs = getAllCoefficients(state.alpha_deg, state.beta_deg, state.delta, polar, state.dirty)

  // ── Compute body-to-inertial quaternion ──
  // Always computed from attitude sliders (readable even when hidden) so that
  // gravity direction is correct in both body and inertial frame modes.
  //
  // Four cases (frame × attitude mode):
  //   Inertial + Wind:  bodyQuat = windQuat(φ_w,θ_w,ψ_w) · Rx(-α) · Ry(β)
  //   Inertial + Body:  bodyQuat = eulerQuat(φ, θ, ψ)
  //   Body + Wind:      same quat, but only used for gravity rotation
  //   Body + Body:      same quat, but only used for gravity rotation
  const DEG2RAD = Math.PI / 180
  let bodyQuat: THREE.Quaternion
  if (state.attitudeMode === 'wind') {
    bodyQuat = bodyQuatFromWindAttitude(
      state.roll_deg * DEG2RAD,
      state.pitch_deg * DEG2RAD,
      state.yaw_deg * DEG2RAD,
      state.alpha_deg * DEG2RAD,
      state.beta_deg * DEG2RAD
    )
  } else {
    bodyQuat = bodyToInertialQuat(
      state.roll_deg * DEG2RAD,
      state.pitch_deg * DEG2RAD,
      state.yaw_deg * DEG2RAD
    )
  }

  // bodyMatrix is only passed to vectors when rendering in inertial frame
  // (it rotates force arrows from body → world). null = body frame (no rotation).
  let bodyMatrix: THREE.Matrix4 | null = null

  // Compass labels (N/E) only visible in inertial frame
  sceneCtx.compassLabels.visible = state.frameMode === 'inertial'

  if (state.frameMode === 'inertial') {
    bodyMatrix = new THREE.Matrix4().makeRotationFromQuaternion(bodyQuat)
  }

  // ── Gravity direction in current display frame ──
  // Inertial: gravity = (0, -1, 0) — always straight down in Three.js world.
  // Body:     gravity = inverse(bodyQuat) · (0, -1, 0) — inertial down rotated
  //           into body frame. This correctly handles all attitude combinations
  //           (wind mode with α/β, or direct Euler angles).
  let gravityDir: THREE.Vector3
  if (state.frameMode === 'body') {
    const invQuat = bodyQuat.clone().invert()
    gravityDir = new THREE.Vector3(0, -1, 0).applyQuaternion(invQuat).normalize()
  } else {
    gravityDir = new THREE.Vector3(0, -1, 0)
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
    bodyMatrix,
    state.showAccelArcs ? currentInertia : null,
    gravityDir
  )

  // Update model rotation (only in inertial frame — body frame keeps model fixed)
  if (currentModel) {
    applyAttitude(currentModel.group, state.frameMode === 'inertial' ? bodyQuat : null)
    // Orient bridle + pilot chute along relative wind
    updateBridleOrientation(currentModel, state.alpha_deg, state.beta_deg)
  }

  // Legacy comparison
  const legacyPolar = legacyPolars[state.polarKey]
  let legacyCoeffs: { cl: number, cd: number, cp: number } | undefined
  if (state.showLegacy && legacyPolar) {
    legacyCoeffs = getLegacyCoefficients(state.alpha_deg, legacyPolar)
  }

  // Update readout panel
  updateReadout(coeffs, polar, state.airspeed, state.rho, legacyCoeffs)
  updateInertiaReadout(currentInertia, coeffs, polar, state.airspeed, state.rho)

  // Mass overlay — parented to model group so it rotates in body frame
  if (currentModel) {
    // Re-parent if needed (e.g. after model switch)
    if (massOverlay.group.parent !== currentModel.group) {
      currentModel.group.add(massOverlay.group)
    }
    massOverlay.setVisible(state.showMassOverlay)
    if (state.showMassOverlay && polar.massSegments) {
      massOverlay.update(polar.massSegments, 1.875, polar.m, currentModel.pilotScale)
    }
  }

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

  // Create mass overlay (parented to model group later, so it rotates with the body)
  massOverlay = createMassOverlay()

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
    const basePolar = continuousPolars[state.polarKey] || continuousPolars.aurafive
    const pilotType = state.modelType === 'canopy' ? state.canopyPilotType : undefined
    switchModel(state.modelType, basePolar.cgOffsetFraction ?? 0, pilotType).then(() => updateVisualization(state))
  })

  // Sync debug panel to initial polar
  prevPolarKey = flightState.polarKey
  const initialPolar = continuousPolars[flightState.polarKey] || continuousPolars.aurafive
  syncDebugPanel(initialPolar)

  // Load initial model
  const initialCgOffset = initialPolar.cgOffsetFraction ?? 0
  const initialPilotType = flightState.modelType === 'canopy' ? flightState.canopyPilotType : undefined
  await switchModel(flightState.modelType, initialCgOffset, initialPilotType)

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
