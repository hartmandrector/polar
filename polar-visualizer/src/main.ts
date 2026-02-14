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
import { loadModel, applyAttitude, applyCgOffset, applyCgFromMassSegments, LoadedModel, ModelType, PilotType, updateBridleOrientation } from './viewer/model-loader.ts'
import { createForceVectors, updateForceVectors, ForceVectors } from './viewer/vectors.ts'
import { setupControls, FlightState } from './ui/controls.ts'
import { updateReadout } from './ui/readout.ts'
import { initCharts, updateChartSweep, updateChartCursor } from './ui/polar-charts.ts'
import { getAllCoefficients, continuousPolars, legacyPolars, getLegacyCoefficients, makeIbexAeroSegments } from './polar/index.ts'
import type { ContinuousPolar, SegmentControls, FullCoefficients } from './polar/index.ts'
import { defaultControls, computeSegmentForce, sumAllSegments, computeWindFrameNED } from './polar/aero-segment.ts'
import { coeffToSS } from './polar/coefficients.ts'
import { setupDebugPanel, syncDebugPanel, getOverriddenPolar, getSegmentPolarOverrides, debugSweepKey } from './ui/debug-panel.ts'
import { bodyToInertialQuat, bodyQuatFromWindAttitude } from './viewer/frames.ts'
import { updateInertiaReadout } from './ui/readout.ts'
import { computeInertia, ZERO_INERTIA, computeCenterOfMass } from './polar/inertia.ts'
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

async function switchModel(modelType: ModelType, cgOffsetFraction: number = 0, pilotType?: PilotType, polar?: ContinuousPolar): Promise<void> {
  if (loadingModel) return
  if (currentModel && currentModel.type === modelType && currentModel.pilotType === pilotType) return

  loadingModel = true

  // Remove old model
  if (currentModel) {
    sceneCtx.scene.remove(currentModel.group)
  }

  try {
    currentModel = await loadModel(modelType, pilotType)
    // CG centering — three things are shifted by the same cgOffsetThree:
    //   1. Model mesh + bridle  (applyCgFromMassSegments, model-loader.ts)
    //   2. Force vectors         (shiftPos in vectors.ts via cgOffsetThree)
    //   3. Mass overlay spheres  (massOverlay.group.position below)
    if (modelType === 'canopy' && polar?.massSegments && polar.massSegments.length > 0) {
      const cgNED = computeCenterOfMass(polar.massSegments, 1.875, polar.m)
      applyCgFromMassSegments(currentModel, cgNED)
    } else if (cgOffsetFraction) {
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
  let key = `${s.polarKey}|${s.beta_deg}|${s.delta}|${s.dirty}|${s.airspeed}|${s.rho}|${debugSweepKey()}`
  // Include canopy controls when segments exist (they affect the segment sweep)
  if (s.modelType === 'canopy') {
    key += `|cc:${s.canopyControlMode}|lh:${s.canopyLeftHand}|rh:${s.canopyRightHand}|ws:${s.canopyWeightShift}`
  }
  return key
}

/**
 * Build SegmentControls from the canopy UI state.
 * The context switch determines which SegmentControls fields the hand sliders map to:
 *   - Brakes mode:  left/right hand → brakeLeft/brakeRight
 *   - Fronts mode:  left/right hand → frontRiserLeft/frontRiserRight
 *   - Rears mode:   left/right hand → rearRiserLeft/rearRiserRight
 * Non-canopy polars get defaultControls() with the generic δ and dirty values.
 */
function buildSegmentControls(state: FlightState): SegmentControls {
  const ctrl = defaultControls()
  ctrl.delta = state.delta
  ctrl.dirty = state.dirty

  if (state.modelType === 'canopy') {
    switch (state.canopyControlMode) {
      case 'brakes':
        ctrl.brakeLeft = state.canopyLeftHand
        ctrl.brakeRight = state.canopyRightHand
        break
      case 'fronts':
        ctrl.frontRiserLeft = state.canopyLeftHand
        ctrl.frontRiserRight = state.canopyRightHand
        break
      case 'rears':
        ctrl.rearRiserLeft = state.canopyLeftHand
        ctrl.rearRiserRight = state.canopyRightHand
        break
    }
    ctrl.weightShiftLR = state.canopyWeightShift
  }

  return ctrl
}

/**
 * Compute segment-summed pseudo-coefficients for the readout panel.
 * Same decomposition as sweepSegments but for a single flight state.
 */
function computeSegmentReadout(
  segments: import('./polar/continuous-polar.ts').AeroSegment[],
  polar: ContinuousPolar,
  controls: SegmentControls,
  alpha_deg: number,
  beta_deg: number,
  rho: number,
  airspeed: number,
): FullCoefficients {
  const q = 0.5 * rho * airspeed * airspeed
  const qS = q * polar.s
  const qSc = qS * polar.chord

  // Per-segment forces
  const segForces = segments.map(seg =>
    computeSegmentForce(seg, alpha_deg, beta_deg, controls, rho, airspeed)
  )

  // NED wind frame
  const { windDir, liftDir, sideDir } = computeWindFrameNED(alpha_deg, beta_deg)

  // System CG
  const cgMeters = polar.massSegments && polar.massSegments.length > 0
    ? computeCenterOfMass(polar.massSegments, 1.875, polar.m)
    : { x: 0, y: 0, z: 0 }

  // Sum forces and moments
  const system = sumAllSegments(segments, segForces, cgMeters, 1.875, windDir, liftDir, sideDir)

  // Decompose into pseudo coefficients
  const totalLift = liftDir.x * system.force.x + liftDir.y * system.force.y + liftDir.z * system.force.z
  const totalDrag = -(windDir.x * system.force.x + windDir.y * system.force.y + windDir.z * system.force.z)
  const totalSide = sideDir.x * system.force.x + sideDir.y * system.force.y + sideDir.z * system.force.z

  const cl = qS > 1e-10 ? totalLift / qS : 0
  const cd = qS > 1e-10 ? totalDrag / qS : 0
  const cy = qS > 1e-10 ? totalSide / qS : 0
  const cm = qSc > 1e-10 ? system.moment.y / qSc : 0
  const cn = qSc > 1e-10 ? system.moment.z / qSc : 0
  const cl_roll = qSc > 1e-10 ? system.moment.x / qSc : 0

  return { cl, cd, cy, cm, cn, cl_roll, cp: 0.25, f: 0 }
}

function updateVisualization(state: FlightState): void {
  flightState = state

  // Get the continuous polar (with debug overrides if panel is open)
  const basePolar: ContinuousPolar = continuousPolars[state.polarKey] || continuousPolars.aurafive
  const polar: ContinuousPolar = getOverriddenPolar(basePolar)

  // Swap pilot segment when canopy pilot type changes
  if (state.modelType === 'canopy' && polar.aeroSegments) {
    polar.aeroSegments = makeIbexAeroSegments(state.canopyPilotType as 'wingsuit' | 'slick')

    // Apply per-segment debug overrides to individual segment polars
    const segOvMap = getSegmentPolarOverrides()
    if (segOvMap.size > 0) {
      for (const seg of polar.aeroSegments) {
        const ov = segOvMap.get(seg.name)
        if (!ov || ov.size === 0) continue

        if (seg.polar) {
          // Cell or lifting body — override the segment's ContinuousPolar params
          const p: any = { ...seg.polar }
          for (const [key, val] of ov) {
            p[key] = val
          }
          seg.polar = p as ContinuousPolar
          // Also update S and chord on the segment itself (they mirror the polar)
          if (ov.has('s')) seg.S = ov.get('s')!
          if (ov.has('chord')) seg.chord = ov.get('chord')!
        } else {
          // Parasitic — override S, chord, and CD directly
          if (ov.has('s')) seg.S = ov.get('s')!
          if (ov.has('chord')) seg.chord = ov.get('chord')!
          if (ov.has('cd_0')) {
            const cd = ov.get('cd_0')!
            // Rebuild getCoeffs with the new CD
            seg.getCoeffs = () => ({ cl: 0, cd, cy: 0, cm: 0, cp: 0.25 })
          }
        }
      }
    }
  }

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
  const segControls = buildSegmentControls(state)
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
    gravityDir,
    currentModel?.pilotScale ?? 1.0,
    segControls,
    currentModel?.cgOffsetThree,
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

  // Update readout panel — use segment-summed data when segments exist
  const segments = polar.aeroSegments
  const hasSegments = segments && segments.length > 0
  if (hasSegments) {
    // Compute segment-summed coefficients for readout at current flight state
    const segReadout = computeSegmentReadout(segments!, polar, segControls, state.alpha_deg, state.beta_deg, state.rho, state.airspeed)
    updateReadout(segReadout, polar, state.airspeed, state.rho, legacyCoeffs)
    updateInertiaReadout(currentInertia, segReadout, polar, state.airspeed, state.rho)
  } else {
    updateReadout(coeffs, polar, state.airspeed, state.rho, legacyCoeffs)
    updateInertiaReadout(currentInertia, coeffs, polar, state.airspeed, state.rho)
  }

  // Mass overlay — parented to model group so it rotates in body frame
  if (currentModel) {
    // Re-parent if needed (e.g. after model switch)
    if (massOverlay.group.parent !== currentModel.group) {
      currentModel.group.add(massOverlay.group)
    }
    // Step 3 of CG centering: shift mass overlay by same offset as model/vectors
    if (currentModel.cgOffsetThree) {
      massOverlay.group.position.set(
        -currentModel.cgOffsetThree.x,
        -currentModel.cgOffsetThree.y,
        -currentModel.cgOffsetThree.z,
      )
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
    }, state.alpha_deg, legacyPolar,
      hasSegments ? segments : undefined,
      hasSegments ? segControls : undefined,
    )
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
    switchModel(state.modelType, basePolar.cgOffsetFraction ?? 0, pilotType, basePolar).then(() => updateVisualization(state))
  })

  // Sync debug panel to initial polar
  prevPolarKey = flightState.polarKey
  const initialPolar = continuousPolars[flightState.polarKey] || continuousPolars.aurafive
  syncDebugPanel(initialPolar)

  // Load initial model
  const initialCgOffset = initialPolar.cgOffsetFraction ?? 0
  const initialPilotType = flightState.modelType === 'canopy' ? flightState.canopyPilotType : undefined
  await switchModel(flightState.modelType, initialCgOffset, initialPilotType, initialPolar)

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
