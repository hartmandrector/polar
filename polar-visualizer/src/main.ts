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
import { loadVehicleModel, applyAttitude, applyCgOffset, applyCgFromMassSegments, LoadedModel, ModelType, PilotType, updateBridleOrientation, updateWingsuitDeploy, CANOPY_SCALE } from './viewer/model-loader.ts'
import { createForceVectors, updateForceVectors, ForceVectors } from './viewer/vectors.ts'
import { setupControls, FlightState } from './ui/controls.ts'
import { updateReadout } from './ui/readout.ts'
import { initCharts, updateChartSweep, updateChartCursor } from './ui/polar-charts.ts'
import { getAllCoefficients, continuousPolars, legacyPolars, getLegacyCoefficients, makeIbexAeroSegments, makeA5SegmentsAeroSegments, rotatePilotMass, eulerRatesToBodyRates } from './polar/index.ts'
import type { ContinuousPolar, SegmentControls, FullCoefficients, SegmentAeroResult } from './polar/index.ts'
import { defaultControls, computeSegmentForce, sumAllSegments, computeWindFrameNED, evaluateAeroForcesDetailed } from './polar/aero-segment.ts'
import { coeffToSS } from './polar/coefficients.ts'
import { setupDebugPanel, syncDebugPanel, getOverriddenPolar, getSegmentPolarOverrides, debugSweepKey, updateSystemView, setCanopyScaleHandler, setCanopyComponentScale, getPilotHeightCm } from './ui/debug-panel.ts'
import type { SystemViewData } from './ui/debug-panel.ts'
import { bodyToInertialQuat, bodyQuatFromWindAttitude } from './viewer/frames.ts'
import { updateInertiaReadout, updateRatesReadout, updatePositionsReadout } from './ui/readout.ts'
import { computeInertia, ZERO_INERTIA, computeCenterOfMass } from './polar/inertia.ts'
import type { InertiaComponents } from './polar/inertia.ts'
import { createMassOverlay, MassOverlay } from './viewer/mass-overlay.ts'
import { createCellWireframes, CellWireframes } from './viewer/cell-wireframes.ts'
import { CANOPY_GEOMETRY } from './viewer/model-registry.ts'
import { getVehicleDefinition, getVehicleAeroPolar, getVehicleMassReference, type VehicleDefinition } from './viewer/vehicle-registry.ts'
import * as THREE from 'three'

// ─── App State ───────────────────────────────────────────────────────────────

let sceneCtx: SceneContext
let currentModel: LoadedModel | null = null
let forceVectors: ForceVectors
let flightState: FlightState
let loadingModel = false
let massOverlay: MassOverlay
let cellWireframes: CellWireframes | null = null
let currentInertia: InertiaComponents = ZERO_INERTIA
let prevPolarKeyForInertia = ''

// ─── Model Management ────────────────────────────────────────────────────────

async function switchModel(vehicle: VehicleDefinition, cgOffsetFraction: number = 0, pilotType?: PilotType, polar?: ContinuousPolar, massReference_m?: number): Promise<void> {
  if (loadingModel) return
  const modelType = vehicle.modelType ?? 'wingsuit'
  if (currentModel && currentModel.type === modelType && currentModel.pilotType === pilotType) return

  loadingModel = true

  // Remove old model
  if (currentModel) {
    sceneCtx.scene.remove(currentModel.group)
  }

  try {
    currentModel = await loadVehicleModel(vehicle, pilotType)
    // CG centering — three things are shifted by the same cgOffsetThree:
    //   1. Model mesh + bridle  (applyCgFromMassSegments, model-loader.ts)
    //   2. Force vectors         (shiftPos in vectors.ts via cgOffsetThree)
    //   3. Mass overlay spheres  (massOverlay.group.position below)
    if (modelType === 'canopy' && polar?.massSegments && polar.massSegments.length > 0) {
      const massReference = massReference_m ?? polar.referenceLength
      const cgNED = computeCenterOfMass(polar.massSegments, massReference, polar.m)
      applyCgFromMassSegments(currentModel, cgNED)
    } else if (cgOffsetFraction) {
      applyCgOffset(currentModel, cgOffsetFraction)
    }
    sceneCtx.scene.add(currentModel.group)

    // Update debug panel with canopy visual component scale
    setCanopyComponentScale(currentModel.canopyComponentScale)

    // Cell wireframes — attach to canopy mesh so they move with it
    if (modelType === 'canopy' && currentModel.canopyModel) {
      if (cellWireframes) cellWireframes.dispose()
      cellWireframes = createCellWireframes(CANOPY_GEOMETRY)
      currentModel.canopyModel.add(cellWireframes.group)
    } else {
      if (cellWireframes) { cellWireframes.dispose(); cellWireframes = null }
    }
  } catch (err) {
    console.error(`Failed to load model ${modelType}:`, err)
    currentModel = null
  }

  loadingModel = false
}

// ─── Update Loop ─────────────────────────────────────────────────────────────

/** Track sweep-affecting params to detect when only α changes (cursor-only). */
let prevSweepKey = ''
let prevPilotPitch = 0
let prevDeploy = 1
let prevPilotHeightCm = 187.5

function sweepKey(s: FlightState): string {
  let key = `${s.polarKey}|${s.beta_deg}|${s.delta}|${s.dirty}|${s.airspeed}|${s.rho}|${debugSweepKey()}`
  // Include canopy controls when segments exist (they affect the segment sweep)
  if (s.modelType === 'canopy') {
    key += `|cc:${s.canopyControlMode}|lh:${s.canopyLeftHand}|rh:${s.canopyRightHand}|ws:${s.canopyWeightShift}|pp:${s.pilotPitch}|dep:${s.deploy}`
  }
  if (s.modelType === 'wingsuit') {
    key += `|pt:${s.pitchThrottle}|yt:${s.yawThrottle}|rt:${s.rollThrottle}|dh:${s.wsDihedral}|wsd:${s.wsDeploy}`
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
    // In canopy mode, δ slider drives unzip (wingsuit pilot only)
    if (state.canopyPilotType === 'wingsuit') {
      ctrl.unzip = state.delta  // δ repurposed as unzip: 0 = zipped, 1 = unzipped
      ctrl.delta = 0            // no generic δ for canopy segments
    }
    ctrl.dirty = 0  // dirty not used in canopy mode

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
    ctrl.pilotPitch = state.pilotPitch
    ctrl.deploy = state.deploy
  }

  if (state.modelType === 'wingsuit') {
    ctrl.pitchThrottle = state.pitchThrottle
    ctrl.yawThrottle = state.yawThrottle
    ctrl.rollThrottle = state.rollThrottle
    ctrl.dihedral = state.wsDihedral
    ctrl.wingsuitDeploy = state.wsDeploy
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
  massReference_m: number,
  controls: SegmentControls,
  alpha_deg: number,
  beta_deg: number,
  rho: number,
  airspeed: number,
  cachedForces?: import('./polar/aero-segment.ts').SegmentForceResult[],
): FullCoefficients {
  const q = 0.5 * rho * airspeed * airspeed
  const qS = q * polar.s
  const qSc = qS * polar.chord

  // Per-segment forces (use cache if available)
  const segForces = cachedForces ?? segments.map(seg =>
    computeSegmentForce(seg, alpha_deg, beta_deg, controls, rho, airspeed)
  )

  // NED wind frame
  const { windDir, liftDir, sideDir } = computeWindFrameNED(alpha_deg, beta_deg)

  // System CG
  const cgMeters = polar.massSegments && polar.massSegments.length > 0
    ? computeCenterOfMass(polar.massSegments, massReference_m, polar.m)
    : { x: 0, y: 0, z: 0 }

  // Sum forces and moments (aero reference length — correct)
  // Pass controls + mass reference for canopy dynamic position calculation
  const system = sumAllSegments(segments, segForces, cgMeters, polar.referenceLength, windDir, liftDir, sideDir, controls, massReference_m)

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

  // System center of pressure from moment–normal-force relationship.
  // CN = CL·cos(α) + CD·sin(α) — stays positive at all α, correctly
  // capturing drag-based CP shift in post-stall / high-α flight.
  const alpha_rad = alpha_deg * Math.PI / 180
  const cn_force = cl * Math.cos(alpha_rad) + cd * Math.sin(alpha_rad)
  const cp = Math.abs(cn_force) > 0.02
    ? Math.max(0, Math.min(1, polar.cg - cm / cn_force))
    : polar.cg

  // 3D system CP from cross-product: r_cp = (M × F) / |F|²
  // M is moment about CG [N·m], F is total force [N].
  // Result is in meters, convert to height-normalised NED.
  const Fx = system.force.x, Fy = system.force.y, Fz = system.force.z
  const Mx = system.moment.x, My = system.moment.y, Mz = system.moment.z
  const F2 = Fx * Fx + Fy * Fy + Fz * Fz
  let cpNED: { x: number; y: number; z: number } | undefined
  if (F2 > 1e-6) {
    // M × F cross product
    const cx = My * Fz - Mz * Fy
    const cy_cross = Mz * Fx - Mx * Fz
    const cz = Mx * Fy - My * Fx
    // Phase C: cgMeters uses massReference while positions use polar.referenceLength.
    // For wingsuits this is a ~2.9% lever-arm difference (1.875 vs 1.93).
    // Acceptable until per-component reference frames (Phase C).
    cpNED = {
      x: cgMeters.x / polar.referenceLength + cx / (F2 * polar.referenceLength),
      y: cgMeters.y / polar.referenceLength + cy_cross / (F2 * polar.referenceLength),
      z: cgMeters.z / polar.referenceLength + cz / (F2 * polar.referenceLength),
    }
  }

  return { cl, cd, cy, cm, cn, cl_roll, cp, f: 0, cpNED }
}

/**
 * Build and push system summary data to the debug panel's system view.
 */
function updateSystemViewData(
  segments: import('./polar/continuous-polar.ts').AeroSegment[],
  polar: ContinuousPolar,
  controls: SegmentControls,
  readout: FullCoefficients,
  state: FlightState,
  cachedForces?: import('./polar/aero-segment.ts').SegmentForceResult[],
): void {
  const q = 0.5 * state.rho * state.airspeed * state.airspeed

  // Per-segment forces (use cache if available)
  const segForces = cachedForces ?? segments.map(seg =>
    computeSegmentForce(seg, state.alpha_deg, state.beta_deg, controls, state.rho, state.airspeed)
  )

  // Force totals
  let totalLift = 0, totalDrag = 0, totalSide = 0
  const segmentForces = segments.map((seg, i) => {
    totalLift += segForces[i].lift
    totalDrag += segForces[i].drag
    totalSide += segForces[i].side
    return { name: seg.name, lift: segForces[i].lift, drag: segForces[i].drag, side: segForces[i].side }
  })

  // Mass breakdown — group by category
  const weightSegs = polar.massSegments ?? []
  const inertiaSegs = polar.inertiaMassSegments ?? weightSegs
  const weightNames = new Set(weightSegs.map(s => s.name))
  const inertiaNames = new Set(inertiaSegs.map(s => s.name))

  // Aggregate by category
  const categories: { name: string; mass_kg: number; isWeight: boolean; isInertia: boolean }[] = []
  const catMap = new Map<string, { mass: number; isWeight: boolean; isInertia: boolean }>()

  for (const seg of inertiaSegs) {
    // Determine category from name prefix
    let cat: string
    if (seg.name.startsWith('canopy_air')) cat = 'Canopy air (buoyant)'
    else if (seg.name.startsWith('canopy_structure')) cat = 'Canopy structure'
    else cat = 'Pilot body'

    const existing = catMap.get(cat) ?? { mass: 0, isWeight: false, isInertia: false }
    existing.mass += seg.massRatio * polar.m
    existing.isInertia = true
    if (weightNames.has(seg.name)) existing.isWeight = true
    catMap.set(cat, existing)
  }

  let totalWeight = 0, totalInertia = 0
  for (const [name, data] of catMap) {
    categories.push({ name, mass_kg: data.mass, isWeight: data.isWeight, isInertia: data.isInertia })
    if (data.isWeight) totalWeight += data.mass
    totalInertia += data.mass
  }

  // Aero summary
  const ss = coeffToSS(readout.cl, readout.cd, polar.s, polar.m, state.rho)
  const ld = readout.cd > 0.001 ? readout.cl / readout.cd : 0

  const viewData: SystemViewData = {
    massBreakdown: categories,
    totalWeight_kg: totalWeight,
    totalInertia_kg: totalInertia,
    cl: readout.cl, cd: readout.cd, cy: readout.cy, cm: readout.cm,
    ld,
    vxs: ss.vxs, vys: ss.vys,
    segmentForces,
    totalLift, totalDrag, totalSide,
  }

  updateSystemView(viewData)
}

function updateVisualization(state: FlightState): void {
  flightState = state

  // Get the continuous polar (with debug overrides if panel is open)
  const vehicle = getVehicleDefinition(state.polarKey)
  const basePolar: ContinuousPolar = getVehicleAeroPolar(vehicle)
    ?? continuousPolars[state.polarKey]
    ?? continuousPolars.aurafive
  const polar: ContinuousPolar = getOverriddenPolar(basePolar)
  // Mass reference is fixed per vehicle; pilot height slider only affects visual scale
  const massReference = getVehicleMassReference(vehicle, basePolar)

  // Rebuild segments when canopy pilot type changes (ibex only)
  if (state.modelType === 'canopy' && polar.aeroSegments) {
    const pilotHeightRatio = getPilotHeightCm() / 187.5
    polar.aeroSegments = makeIbexAeroSegments(state.canopyPilotType as 'wingsuit' | 'slick', pilotHeightRatio)
  }

  // For wingsuit segment polars, clone segments from the base polar so
  // debug overrides don't mutate the canonical segment objects
  if (state.modelType === 'wingsuit' && basePolar.aeroSegments) {
    polar.aeroSegments = makeA5SegmentsAeroSegments()
  }

  // Apply per-segment debug overrides to individual segment polars
  if (polar.aeroSegments && polar.aeroSegments.length > 0) {
    const segOvMap = getSegmentPolarOverrides()
    if (segOvMap.size > 0) {
      for (const seg of polar.aeroSegments) {
        const ov = segOvMap.get(seg.name)
        if (!ov || ov.size === 0) continue

        if (seg.polar) {
          // Cell, lifting body, flap, or wingsuit segment — override the segment's ContinuousPolar params
          const p: any = { ...seg.polar }
          for (const [key, val] of ov) {
            p[key] = val
          }
          seg.polar = p as ContinuousPolar
          // Also update S and chord on the segment itself (they mirror the polar)
          // Skip for flap segments — their S/chord are computed dynamically from brake input
          if (!seg.name.startsWith('flap_')) {
            if (ov.has('s')) seg.S = ov.get('s')!
            if (ov.has('chord')) seg.chord = ov.get('chord')!
          }
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
      ? computeInertia(polar.inertiaMassSegments ?? polar.massSegments, massReference, polar.m)
      : ZERO_INERTIA
  }

  // Rotate pilot mass segments when pilot pitch or deploy changes (canopy only)
  // Only update mass distribution and inertia — don't recenter the model.
  // The mass overlay's CG marker (red ball) will show the true CG position.
  //
  // TODO: Future work — Dynamically recenter model on computed CG as pilot pitch/deploy change.
  // This requires better understanding of:
  //   1. Reference length parameterization (aero vs mass) — chord length (1.93m) vs pilot height (1.875m)
  //   2. GLB model placement — are mesh origins at geometric center or CG?
  //   3. Frame handling — body frame vs inertial frame CG dynamics
  // When these are resolved, uncomment applyCgFromMassSegments() here to move model to true CG.
  // Note: Currently things rotate correctly about computed CG, but translation to origin is off.
  if (state.modelType === 'canopy' && polar.massSegments) {
    const pitchChanged = Math.abs(state.pilotPitch - prevPilotPitch) > 0.01
    const deployChanged = Math.abs(state.deploy - prevDeploy) > 0.001
    const heightCm = getPilotHeightCm()
    const heightChanged = Math.abs(heightCm - prevPilotHeightCm) > 0.1
    if (pitchChanged || deployChanged || heightChanged) {
      prevPilotPitch = state.pilotPitch
      prevDeploy = state.deploy
      prevPilotHeightCm = heightCm
      const pilotHeightRatio = heightCm / 187.5
      const rotated = rotatePilotMass(state.pilotPitch, currentModel?.massPivotNED ?? undefined, state.deploy, state.canopyPilotType as 'wingsuit' | 'slick', pilotHeightRatio)
      polar.massSegments = rotated.weight
      polar.inertiaMassSegments = rotated.inertia
      // Recompute inertia with new mass distribution
      currentInertia = computeInertia(polar.inertiaMassSegments ?? polar.massSegments, massReference, polar.m)
      // TODO: const newCgNED = computeCenterOfMass(polar.massSegments, massReference, polar.m)
      // TODO: applyCgFromMassSegments(currentModel, newCgNED)
    }
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

  // ── Persistent frame reference labels (§15.6) ──
  // Both compass (N, E, D) and body axis (x, y, z) labels are always visible.
  // The non-active frame's labels rotate to show their orientation relative
  // to the active frame.
  sceneCtx.compassLabels.visible = true
  sceneCtx.bodyAxisLabels.visible = true

  if (state.frameMode === 'inertial') {
    bodyMatrix = new THREE.Matrix4().makeRotationFromQuaternion(bodyQuat)
    // Compass labels fixed (identity) — they're the inertial reference
    sceneCtx.compassLabels.quaternion.identity()
    // Body axis labels rotate with body attitude
    sceneCtx.bodyAxisLabels.quaternion.copy(bodyQuat)
  } else {
    // Body mode — compass labels rotate by inverse body quat
    const invQuat = bodyQuat.clone().invert()
    sceneCtx.compassLabels.quaternion.copy(invQuat)
    // Body axis labels fixed (identity) — they're the body reference
    sceneCtx.bodyAxisLabels.quaternion.identity()
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

  // ── Euler rates → body rates (§15.3 math pipeline) ──
  const phiDot_rad = state.phiDot_degps * DEG2RAD
  const thetaDot_rad = state.thetaDot_degps * DEG2RAD
  const psiDot_rad = state.psiDot_degps * DEG2RAD
  const phi_rad = state.roll_deg * DEG2RAD
  const theta_rad = state.pitch_deg * DEG2RAD
  const bodyRates = eulerRatesToBodyRates(phiDot_rad, thetaDot_rad, psiDot_rad, phi_rad, theta_rad)
  const hasRates = Math.abs(bodyRates.p) > 1e-6 || Math.abs(bodyRates.q) > 1e-6 || Math.abs(bodyRates.r) > 1e-6

  // Legacy comparison
  const legacyPolar = legacyPolars[state.polarKey]
  let legacyCoeffs: { cl: number, cd: number, cp: number } | undefined
  if (state.showLegacy && legacyPolar) {
    legacyCoeffs = getLegacyCoefficients(state.alpha_deg, legacyPolar)
  }

  // Update readout panel — use segment-summed data when segments exist
  const segments = polar.aeroSegments
  const hasSegments = segments && segments.length > 0

  // Compute segment forces ONCE and share across readout, system view, and vectors
  let cachedSegForces: import('./polar/aero-segment.ts').SegmentForceResult[] | undefined
  let cachedPerSegment: SegmentAeroResult[] | undefined
  let segReadout: import('./polar/continuous-polar.ts').FullCoefficients | undefined
  if (hasSegments) {
    // Compute CG for evaluateAeroForcesDetailed
    const cgNED = polar.massSegments && polar.massSegments.length > 0
      ? computeCenterOfMass(polar.massSegments, massReference, polar.m)
      : { x: 0, y: 0, z: 0 }

    if (hasRates) {
      // Use evaluateAeroForcesDetailed with ω×r velocity correction
      const bodyVel = {
        x: state.airspeed * Math.cos(state.alpha_deg * DEG2RAD) * Math.cos(state.beta_deg * DEG2RAD),
        y: state.airspeed * Math.sin(state.beta_deg * DEG2RAD),
        z: state.airspeed * Math.sin(state.alpha_deg * DEG2RAD) * Math.cos(state.beta_deg * DEG2RAD),
      }
      const omega = { p: bodyRates.p, q: bodyRates.q, r: bodyRates.r }
      const detailed = evaluateAeroForcesDetailed(segments!, cgNED, polar.referenceLength, bodyVel, omega, segControls, state.rho)
      cachedPerSegment = detailed.perSegment
      cachedSegForces = detailed.perSegment.map(ps => ps.forces)
    } else {
      // Static: no rotation, use standard per-segment computation
      cachedSegForces = segments!.map(seg =>
        computeSegmentForce(seg, state.alpha_deg, state.beta_deg, segControls, state.rho, state.airspeed)
      )
    }

    // Compute segment-summed coefficients for readout at current flight state
    segReadout = computeSegmentReadout(segments!, polar, massReference, segControls, state.alpha_deg, state.beta_deg, state.rho, state.airspeed, cachedSegForces)
    updateReadout(segReadout, polar, state.airspeed, state.rho, legacyCoeffs)
    updateInertiaReadout(currentInertia, segReadout, polar, state.airspeed, state.rho)

    // Update system summary view in debug panel
    updateSystemViewData(segments!, polar, segControls, segReadout, state, cachedSegForces)

    // ── Rates readout (§15.4.1) ──
    // Compute angular acceleration from rotational EOM if we have inertia
    let bodyAccel: { pDot: number; qDot: number; rDot: number } | null = null
    if (currentInertia.Ixx > 0.001 || currentInertia.Iyy > 0.001 || currentInertia.Izz > 0.001) {
      const { windDir, liftDir, sideDir } = computeWindFrameNED(state.alpha_deg, state.beta_deg)
      const system = sumAllSegments(segments!, cachedSegForces!, cgNED, polar.referenceLength, windDir, liftDir, sideDir, segControls, massReference)
      // Simplified angular acceleration (diagonal inertia)
      bodyAccel = {
        pDot: currentInertia.Ixx > 0.001 ? system.moment.x / currentInertia.Ixx : 0,
        qDot: currentInertia.Iyy > 0.001 ? system.moment.y / currentInertia.Iyy : 0,
        rDot: currentInertia.Izz > 0.001 ? system.moment.z / currentInertia.Izz : 0,
      }
    }
    updateRatesReadout(
      { phiDot: phiDot_rad, thetaDot: thetaDot_rad, psiDot: psiDot_rad },
      bodyRates,
      bodyAccel,
    )

    // ── Positions readout (§15.4.2) ──
    updatePositionsReadout(cgNED, null)
  } else {
    updateReadout(coeffs, polar, state.airspeed, state.rho, legacyCoeffs)
    updateInertiaReadout(currentInertia, coeffs, polar, state.airspeed, state.rho)
    updateRatesReadout(
      { phiDot: phiDot_rad, thetaDot: thetaDot_rad, psiDot: psiDot_rad },
      bodyRates,
      null,
    )
    updatePositionsReadout({ x: 0, y: 0, z: 0 }, null)
  }

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
    massReference,
    segControls,
    currentModel?.cgOffsetThree,
    cachedSegForces,
    bodyRates,
    bodyQuat,
    cachedPerSegment,
    currentModel?.type === 'canopy' ? state.deploy : 1.0,
    currentModel?.canopyScaleRatio ?? 1.0,
    currentModel?.pilotSizeCompensation ?? 1.0,
  )

  // Update model rotation (only in inertial frame — body frame keeps model fixed)
  if (currentModel) {
    applyAttitude(currentModel.group, state.frameMode === 'inertial' ? bodyQuat : null)
    // Orient bridle + pilot chute along relative wind
    updateBridleOrientation(currentModel, state.alpha_deg, state.beta_deg)
    // Pilot pitch — rotate pilot body about riser attachment point
    if (currentModel.pilotPivot) {
      currentModel.pilotPivot.rotation.x = state.pilotPitch * DEG2RAD
    }
    // Pilot height — rescale pilot body, keeping shoulder at riser junction
    if (currentModel.setPilotHeight) {
      currentModel.setPilotHeight(getPilotHeightCm())
      // Reset massPivotNED so it recomputes from the new geometry
      currentModel.massPivotNED = undefined
    }
    // Deployment — scale canopy mesh horizontally (X = lateral, Z = fore-aft)
    // Span and chord use different minimums so the canopy doesn't get
    // too thin chord-wise at low deployment.
    if (currentModel.canopyModel) {
      const spanScale  = 0.1 + 0.9 * state.deploy  // min 10% span
      const chordScale = 0.3 + 0.7 * state.deploy  // min 30% chord
      const canopyBaseScale = currentModel.canopyBaseScale ?? CANOPY_SCALE
      currentModel.canopyModel.scale.set(
        -canopyBaseScale * spanScale,  // X (lateral/span) — negative preserves X-flip
        canopyBaseScale,               // Y (vertical) — always full height
        canopyBaseScale * chordScale,  // Z (fore-aft/chord)
      )

      // Scale bridle attachment point to follow the canopy surface deformation.
      // The base position (at full deployment) is scaled by the same factors.
      // CG offset is re-applied afterward, so we scale the base then subtract offset.
      if (currentModel.bridleGroup && currentModel.baseBridlePos) {
        const cgOffset = currentModel.cgOffsetThree ?? new THREE.Vector3()
        currentModel.bridleGroup.position.set(
          currentModel.baseBridlePos.x * spanScale  - cgOffset.x,
          currentModel.baseBridlePos.y              - cgOffset.y,  // no vertical scaling
          currentModel.baseBridlePos.z * chordScale - cgOffset.z,
        )
      }
    }
    // Wingsuit deployment visualization — PC, bridle, snivel, lines
    if (currentModel.deployGroup) {
      updateWingsuitDeploy(currentModel, state.wsDeploy, state.alpha_deg, state.beta_deg)
    }
  }

  // Mass overlay — parented to model group so it rotates in body frame
  if (currentModel) {
    // Re-parent if needed (e.g. after model switch)
    if (massOverlay.group.parent !== currentModel.group) {
      currentModel.group.add(massOverlay.group)
    }
    // Step 3 of CG centering: position mass overlay relative to mesh CG.
    // - Canopy models: CG offset computed from mass segments (applyCgFromMassSegments).
    // - Standalone models: mass segments are CG-centered (weighted mean ≈ 0),
    //   so the overlay stays at the scene origin. The mesh is shifted independently
    //   by applyCgOffset so its CG aligns with origin.
    if (currentModel.cgOffsetThree) {
      massOverlay.group.position.set(
        -currentModel.cgOffsetThree.x,
        -currentModel.cgOffsetThree.y,
        -currentModel.cgOffsetThree.z,
      )
    } else {
      massOverlay.group.position.set(0, 0, 0)
    }
    // Compute mass pivot once: find where the 3D pilotPivot sits in
    // mass-overlay local space, then convert to NED normalised coords.
    if (currentModel.pilotPivot && !currentModel.massPivotNED) {
      currentModel.group.updateWorldMatrix(true, true)
      const pvtWorld = new THREE.Vector3()
      currentModel.pilotPivot.getWorldPosition(pvtWorld)
      const pvtLocal = massOverlay.group.worldToLocal(pvtWorld.clone())
      // Three.js → NED normalised: ned.x = three.z, ned.z = -three.y
      // Divide by (height × pilotScale) to go from model-units to normalised
      const hs = massReference * currentModel.pilotScale  // massReference = pilotHeight_m
      currentModel.massPivotNED = {
        x: pvtLocal.z / hs,
        z: -pvtLocal.y / hs,
      }
    }
    massOverlay.setVisible(state.showMassOverlay)
    if (state.showMassOverlay) {
      const segs = polar.inertiaMassSegments ?? polar.massSegments ?? []
      const weightSegs = polar.massSegments ?? segs
      massOverlay.update(segs, massReference, polar.m, currentModel.pilotScale, currentModel.canopyScaleRatio, weightSegs, currentModel.pilotSizeCompensation)
      // CP diamond marker — use segmented readout CP when available, else lumped coeffs
      const cpFraction = segReadout ? segReadout.cp : coeffs.cp
      // Phase C: updateCP receives polar.referenceLength for CP positioning.
      // For canopies both references are 1.875 so no practical discrepancy.
      massOverlay.updateCP(cpFraction, polar.cg, polar.chord, polar.referenceLength, currentModel.pilotScale, polar.massSegments, segReadout?.cpNED, currentModel.canopyScaleRatio)
    }

    // Cell wireframes visibility
    if (cellWireframes) {
      cellWireframes.setVisible(state.showCellWireframes)
    }

    // Hide canopy GLB meshes (keep wireframes/overlays visible)
    if (currentModel.canopyModel) {
      for (const child of currentModel.canopyModel.children) {
        if (child.name !== 'cell-wireframes') {
          child.visible = !state.hideCanopyGlb
        }
      }
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
      massReference,
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

  // Inject canopy scale handler: called when the debug panel canopy area slider changes
  setCanopyScaleHandler((scale: number) => {
    if (currentModel?.setCanopyScale) {
      currentModel.setCanopyScale(scale)
    }
  })

  // Track polar selection to only sync debug panel when it actually changes
  let prevPolarKey = ''

  // Setup UI controls — this returns the initial state
  flightState = setupControls((state) => {
    // When polar selection changes, sync debug panel to new baseline
    if (state.polarKey !== prevPolarKey) {
      prevPolarKey = state.polarKey
      const vehicle = getVehicleDefinition(state.polarKey)
      const basePolar = getVehicleAeroPolar(vehicle)
        ?? continuousPolars[state.polarKey]
        ?? continuousPolars.aurafive
      syncDebugPanel(basePolar, vehicle.modelType === 'canopy')
    }

    // When controls change, switch model if needed, then update
    const vehicle = getVehicleDefinition(state.polarKey)
    const basePolar = getVehicleAeroPolar(vehicle)
      ?? continuousPolars[state.polarKey]
      ?? continuousPolars.aurafive
    // Mass reference is fixed per vehicle; pilot height slider only affects visual scale
    const massReference = getVehicleMassReference(vehicle, basePolar)
    const pilotType = state.modelType === 'canopy' ? state.canopyPilotType : undefined
    switchModel(vehicle, basePolar.cgOffsetFraction ?? 0, pilotType, basePolar, massReference)
      .then(() => updateVisualization(state))
  })

  // Sync debug panel to initial polar
  prevPolarKey = flightState.polarKey
  const initialVehicle = getVehicleDefinition(flightState.polarKey)
  const initialPolar = getVehicleAeroPolar(initialVehicle)
    ?? continuousPolars[flightState.polarKey]
    ?? continuousPolars.aurafive
  syncDebugPanel(initialPolar, initialVehicle.modelType === 'canopy')

  // Load initial model
  const initialCgOffset = initialPolar.cgOffsetFraction ?? 0
  const initialPilotType = flightState.modelType === 'canopy' ? flightState.canopyPilotType : undefined
  const initialMassReference = getVehicleMassReference(initialVehicle, initialPolar)
  await switchModel(initialVehicle, initialCgOffset, initialPilotType, initialPolar, initialMassReference)

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
