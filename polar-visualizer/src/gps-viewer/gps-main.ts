/**
 * GPS Flight Viewer — Main Entry Point
 *
 * Drag-and-drop a FlySight TRACK.CSV → pipeline → charts + replay.
 */

import { processGPSFile, type PipelineResult } from '../gps/gps-pipeline'
import { buildSystemPolarTable, buildPolarEvaluatorFactory } from './gps-polar-table'
import { GPSCharts } from './gps-charts'
import { GPSReplay } from './gps-replay'
import { GPSScene } from './gps-scene'
import { BodyFrameScene } from './body-frame-scene'
import { MomentInset } from './moment-inset'
import { InertialLegend, BodyFrameLegend } from './scene-legend'
import { CaptureHandler } from './capture-handler'
import { parseHeadSensorCSV } from './head-sensor'
import { parseCameraSensorCSV, parseSyncResult, type CameraMountOffset, type CameraSyncResult, DEFAULT_MOUNT_OFFSET } from './camera-sensor'
import { a5segmentsContinuous, ibexulContinuous } from '../polar/polar-data'
import { computeCenterOfMass, computeInertia } from '../polar/inertia'
import { solveControlInputs, solveCanopyControls, type ControlInversionConfig } from './control-solver'
import * as THREE from 'three'
import { runOrientationEKF, type EKFRunnerResult } from '../kalman/index'
import { estimateCanopyBatch, type RollMethod } from './canopy-estimator'
import { detectDeployment } from './deploy-detector'
import { buildDeployReplayTimeline, type DeployReplayTimeline } from './deploy-replay'
import { detectExit, type ExitEstimate } from './exit-detector'
import { fixOrientations } from './fix-orientations'
import { defaultControls } from '../polar/aero-segment'
import type { GPSPipelinePoint } from '../gps/types'

/** Write fixed orientation rates back into bodyRates (preserving raw in rawBodyRates) */
function writebackFixedRates(points: GPSPipelinePoint[]) {
  for (const pt of points) {
    if (!pt.fixed || !pt.bodyRates) continue
    // Preserve original
    pt.rawBodyRates = { ...pt.bodyRates }
    // Write fixed rates into bodyRates so all downstream consumers use them
    pt.bodyRates.p = pt.fixed.p
    pt.bodyRates.q = pt.fixed.q
    pt.bodyRates.r = pt.fixed.r
    if (pt.fixed.pDot !== undefined) pt.bodyRates.pDot = pt.fixed.pDot
    if (pt.fixed.qDot !== undefined) pt.bodyRates.qDot = pt.fixed.qDot
    if (pt.fixed.rDot !== undefined) pt.bodyRates.rDot = pt.fixed.rDot
    // Write phase-corrected angles back to aero
    pt.aero.roll = pt.fixed.roll
    pt.aero.theta = pt.fixed.theta
    pt.aero.psi = pt.fixed.psi
  }
}
import { KeyframeEditor } from './keyframe-editor'
import type { CaptureSessionState } from './capture-session'

// ─── DOM Elements ───────────────────────────────────────────────────────────

const dropZone = document.getElementById('drop-zone')!
const fileInput = document.getElementById('file-input') as HTMLInputElement
const viewerLayout = document.getElementById('viewer-layout')!
const flightInfo = document.getElementById('flight-info')!
const btnPlay = document.getElementById('btn-play')!
const scrubber = document.getElementById('scrubber') as HTMLInputElement
const timeDisplay = document.getElementById('time-display')!
const speedSelect = document.getElementById('speed-select') as HTMLSelectElement
const btnLoadNew = document.getElementById('btn-load-new')!
const followSlider = document.getElementById('follow-slider') as HTMLInputElement | null

// ─── State ──────────────────────────────────────────────────────────────────

let charts: GPSCharts | null = null
let replay: GPSReplay | null = null
let scene: GPSScene | null = null
let bodyScene: BodyFrameScene | null = null
let momentInset: MomentInset | null = null
let inertialLegend: InertialLegend | null = null
let bodyLegend: BodyFrameLegend | null = null
let captureHandler: CaptureHandler | null = null
let result: PipelineResult | null = null
let ekfResult: EKFRunnerResult | null = null
let currentDeployTimeline: DeployReplayTimeline | null = null
let cachedDeployDetection: ReturnType<typeof detectDeployment> = null
let loadedTrackPath: string | null = null
let loadedSensorPath: string | null = null

// ─── Canopy Estimator UI Controls ───────────────────────────────────────────

const trimSlider = document.getElementById('trim-offset-slider') as HTMLInputElement
const trimValue = document.getElementById('trim-offset-value')!
const rollSelect = document.getElementById('roll-method-select') as HTMLSelectElement

function recalcCanopy() {
  if (!result || !scene || !bodyScene) return
  const trimOffset = parseFloat(trimSlider.value)
  const rollMethod = rollSelect.value as RollMethod

  console.log(`Recalc canopy: trim=${trimOffset}° roll=${rollMethod}`)
  const canopyStates = estimateCanopyBatch(result.points, {
    trimOffset_deg: trimOffset,
    rollMethod,
    deployEndIndex: cachedDeployDetection?.fullInflationIndex ?? null,
    deployEndTime: cachedDeployDetection?.fullInflationTime ?? null,
  })
  const validCount = canopyStates.filter(s => s.valid).length
  console.log(`  ${validCount}/${canopyStates.length} valid states`)

  scene.setCanopyStates(canopyStates)
  bodyScene.setCanopyStates(canopyStates)

  const deployTimeline = buildDeployReplayTimeline(result.points, canopyStates, cachedDeployDetection)
  scene.setDeployTimeline(deployTimeline)
  bodyScene.setDeployTimeline(deployTimeline)
  currentDeployTimeline = deployTimeline

  // Re-fix orientations with updated canopy states
  const exitEstimate = detectExit(result.points)
  fixOrientations(result.points, {
    exitEstimate,
    deployTimeline,
    canopyStates,
    accelWindowSize: 21,
  })
  writebackFixedRates(result.points)
}

trimSlider.addEventListener('input', () => {
  trimValue.textContent = parseFloat(trimSlider.value).toFixed(1)
})
trimSlider.addEventListener('change', recalcCanopy)
rollSelect.addEventListener('change', recalcCanopy)

// ─── Drop Zone ──────────────────────────────────────────────────────────────

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  dropZone.classList.add('drag-over')
})

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over')
})

dropZone.addEventListener('drop', (e) => {
  e.preventDefault()
  dropZone.classList.remove('drag-over')
  const file = e.dataTransfer?.files[0]
  if (file) loadFile(file)
})

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) loadFile(file)
})

dropZone.addEventListener('click', () => {
  fileInput.click()
})

btnLoadNew.addEventListener('click', () => {
  viewerLayout.classList.add('hidden')
  dropZone.classList.remove('hidden')
  if (replay) replay.stop()
})

// ─── File Loading ───────────────────────────────────────────────────────────

async function loadFile(file: File) {
  flightInfo.textContent = `Loading ${file.name}...`
  if (!loadedTrackPath) loadedTrackPath = file.name  // best guess from drag-and-drop
  dropZone.classList.add('hidden')
  viewerLayout.classList.remove('hidden')

  const text = await file.text()

  // Extract flight date from CSV (first ISO timestamp in data)
  let flightDateStr = ''
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/m)
  if (isoMatch) {
    flightDateStr = isoMatch[1].replace(/[:.]/g, '-')
  } else {
    // Fallback: use file name or folder hints
    flightDateStr = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-]/g, '_')
  }

  // Build polar evaluator factory for per-point binary search AOA matching
  const polarEvaluatorFactory = buildPolarEvaluatorFactory()

  // Run pipeline
  const t0 = performance.now()
  result = processGPSFile(text, {
    polarEvaluatorFactory,
    pilotMass: 77.5,
    sRef: 2.0,
  })
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2)

  const dur = result.duration
  const minutes = Math.floor(dur / 60)
  const seconds = (dur % 60).toFixed(1)

  flightInfo.innerHTML = [
    `<strong>${file.name}</strong>`,
    `Format: ${result.format}`,
    `Points: ${result.pointCount}`,
    `Duration: ${minutes}:${seconds.padStart(4, '0')}`,
    `Processed in ${elapsed}s`,
  ].join(' &nbsp;│&nbsp; ')

  // Initialize charts
  if (!charts) {
    charts = new GPSCharts()
  }
  charts.setData(result.points)

  // Set vehicle polar for swept curve on charts
  const polarForCharts = a5segmentsContinuous
  charts.setPolar(polarForCharts.aeroSegments ?? [], polarForCharts, 1.875)

  // Initialize 3D scene
  if (!scene) {
    const inertialCanvas = document.getElementById('inertial-canvas') as HTMLCanvasElement
    scene = new GPSScene(inertialCanvas)
  }
  if (!bodyScene) {
    const bodyCanvas = document.getElementById('body-canvas') as HTMLCanvasElement
    bodyScene = new BodyFrameScene(bodyCanvas)
  }
  scene.setData(result.points)
  bodyScene.setData(result.points)

  // Apply control solver state from checkbox (handles default-checked on first load)
  scene.setControlSolverEnabled(controlSolverToggle.checked)
  bodyScene.setControlSolverEnabled(controlSolverToggle.checked)

  // Moment inset in sidebar
  if (!momentInset) {
    const momentContainer = document.getElementById('moment-container')!
    momentInset = new MomentInset(momentContainer, true)
  }

  // Scene legends
  if (!inertialLegend) {
    inertialLegend = new InertialLegend(document.getElementById('inertial-box')!)
  }
  if (!bodyLegend) {
    bodyLegend = new BodyFrameLegend(document.getElementById('body-box')!)
  }

  // Set aero overlay config from A5 segments model
  const polar = a5segmentsContinuous
  const massRef = 1.875  // pilot height (for CG/inertia)
  const aeroRef = polar.referenceLength ?? massRef  // aero reference length (1.93 for A5)
  const cgMeters = computeCenterOfMass(polar.massSegments ?? [], massRef, polar.m)
  const inertia = computeInertia(polar.massSegments ?? [], massRef, polar.m)
  scene.setAeroConfig({
    segments: polar.aeroSegments ?? [],
    cgMeters,
    height: aeroRef,
    mass: polar.m,
    inertia,
  })
  bodyScene.setAeroConfig({
    segments: polar.aeroSegments ?? [],
    cgMeters,
    height: aeroRef,
    mass: polar.m,
    inertia,
  })

  // Canopy aero config (ibexul)
  const canopyPolar = ibexulContinuous
  const canopyMassRef = canopyPolar.referenceLength ?? 1.875
  const canopyCg = canopyPolar.massSegments?.length
    ? computeCenterOfMass(canopyPolar.massSegments, canopyMassRef, canopyPolar.m)
    : { x: 0, y: 0, z: 0 }
  const canopyInertia = canopyPolar.massSegments
    ? computeInertia(canopyPolar.inertiaMassSegments ?? canopyPolar.massSegments, canopyMassRef, canopyPolar.m)
    : { Ixx: 1, Iyy: 1, Izz: 1, Ixz: 0, Ixy: 0, Iyz: 0 }
  scene.setCanopyAeroConfig({
    segments: canopyPolar.aeroSegments ?? [],
    cgMeters: canopyCg,
    height: canopyMassRef,
    mass: canopyPolar.m,
    inertia: canopyInertia,
  })
  bodyScene.setCanopyAeroConfig({
    segments: canopyPolar.aeroSegments ?? [],
    cgMeters: canopyCg,
    height: canopyMassRef,
    mass: canopyPolar.m,
    inertia: canopyInertia,
  })

  // Set canopy polar for chart swept curve
  charts.setCanopyPolar(canopyPolar.aeroSegments ?? [], canopyPolar, canopyMassRef)

  // Batch-solve control inputs for all points (Pass 2)
  const solverCfg: ControlInversionConfig = {
    segments: polar.aeroSegments ?? [],
    cgMeters,
    height: aeroRef,
    mass: polar.m,
    inertia,
  }
  let convergeCount = 0
  let wingsuitCount = 0
  let wingsuitConverged = 0
  let prevU: [number, number, number] | undefined
  let sampleLogged = false
  let pointIdx = 0
  const totalPoints = result.points.length
  for (const pt of result.points) {
    if (pt.bodyRates?.pDot !== undefined) {
      const sol = solveControlInputs(pt, solverCfg, prevU)
      // Only warm-start from converged solutions; reset to neutral otherwise
      prevU = sol.converged ? [sol.pitchThrottle, sol.rollThrottle, sol.yawThrottle] : undefined
      pt.solvedControls = {
        pitchThrottle: sol.pitchThrottle,
        rollThrottle: sol.rollThrottle,
        yawThrottle: sol.yawThrottle,
        converged: sol.converged,
        mode: 'wingsuit',
      }
      if (sol.converged) convergeCount++

      // Track wingsuit-mode stats and log one stable wingsuit sample
      const isWingsuit = pt.flightMode?.mode === 3  // FlightMode.WINGSUIT
      if (isWingsuit) {
        wingsuitCount++
        if (sol.converged) wingsuitConverged++
      }
      if (!sampleLogged && isWingsuit && pt.processed.airspeed > 10 && sol.converged) {
        sampleLogged = true
        const br = pt.bodyRates!
        console.log(`Control solver [CONVERGED] pt ${pointIdx}/${totalPoints}:`, {
          converged: sol.converged,
          iterations: sol.iterations,
          residual_Nm: sol.residual.toFixed(2),
          controls: [sol.pitchThrottle.toFixed(3), sol.rollThrottle.toFixed(3), sol.yawThrottle.toFixed(3)],
          airspeed_ms: pt.processed.airspeed.toFixed(1),
          qbar_Pa: pt.processed.qbar.toFixed(0),
          flightMode: pt.flightMode?.modeString,
          bodyRates_dps: { p: br.p.toFixed(1), q: br.q.toFixed(1), r: br.r.toFixed(1) },
          angAccel_dps2: { pDot: br.pDot?.toFixed(1), qDot: br.qDot?.toFixed(1), rDot: br.rDot?.toFixed(1) },
          Mreq: `L=${(inertia.Ixx * (br.pDot ?? 0) * Math.PI / 180).toFixed(1)} M=${(inertia.Iyy * (br.qDot ?? 0) * Math.PI / 180).toFixed(1)} N=${(inertia.Izz * (br.rDot ?? 0) * Math.PI / 180).toFixed(1)}`,
          Maero_neutral: sol.moments,
        })
      }
    }
    pointIdx++
  }
  console.log(`Control inversion: ${convergeCount}/${totalPoints} total, ${wingsuitConverged}/${wingsuitCount} wingsuit converged`)

  // Run orientation EKF over pipeline output
  const ekfT0 = performance.now()
  ekfResult = runOrientationEKF(result.points, {
    aero: {
      segments: polar.aeroSegments ?? [],
      cgMeters,
      height: massRef,
      inertia,
    },
  })
  const ekfElapsed = ((performance.now() - ekfT0) / 1000).toFixed(3)
  console.log(`Orientation EKF: ${ekfResult.estimates.length} points in ${ekfElapsed}s`)

  // Wire EKF into 3D scenes for physics-interpolated orientation
  scene.setEKF(ekfResult.ekf)
  bodyScene.setEKF(ekfResult.ekf)

  // ── Deployment detection (run first so canopy estimator can use phase info) ──
  const deployDetection = detectDeployment(result.points)
  cachedDeployDetection = deployDetection
  if (deployDetection) {
    console.log(`Deploy detected: lineStretch t=${deployDetection.lineStretchTime.toFixed(2)}s peak=${deployDetection.peakDecel.toFixed(1)}m/s² conf=${deployDetection.confidence.toFixed(2)}`)
  }

  // ── Canopy estimation (use current UI control values) ──
  const canopyStates = estimateCanopyBatch(result.points, {
    trimOffset_deg: parseFloat(trimSlider.value),
    rollMethod: rollSelect.value as RollMethod,
    deployEndIndex: deployDetection?.fullInflationIndex ?? null,
    deployEndTime: deployDetection?.fullInflationTime ?? null,
  })
  const validCount = canopyStates.filter(s => s.valid).length
  console.log(`Canopy estimator: ${validCount}/${canopyStates.length} valid states`)
  scene.setCanopyStates(canopyStates)
  bodyScene.setCanopyStates(canopyStates)

  // ── Deployment replay timeline ──
  const deployTimeline = buildDeployReplayTimeline(result.points, canopyStates, deployDetection)
  if (deployDetection) {
    if (deployTimeline.timingSeconds.fullFlightTime != null) {
      console.log(`  Full flight at t=${deployTimeline.timingSeconds.fullFlightTime.toFixed(2)}s, inflation=${deployTimeline.timingSeconds.inflationDuration?.toFixed(2)}s`)
    }
  }
  scene.setDeployTimeline(deployTimeline)
  bodyScene.setDeployTimeline(deployTimeline)
  currentDeployTimeline = deployTimeline

  // ── Exit detection (ground → flight transition) ──
  const exitEstimate = detectExit(result.points)
  if (exitEstimate) {
    console.log(`Exit detected: pushOff t=${exitEstimate.pushOffTime.toFixed(2)}s, flying t=${exitEstimate.flyingTime.toFixed(2)}s (${(exitEstimate.flyingTime - exitEstimate.pushOffTime).toFixed(2)}s transition)`)
  }
  scene.setExitEstimate(exitEstimate)
  bodyScene.setExitEstimate(exitEstimate)

  // ── Fix orientations (phase-corrected angles → re-derived rates & accelerations) ──
  fixOrientations(result.points, {
    exitEstimate,
    deployTimeline,
    canopyStates,
    accelWindowSize: 21,  // matches pipeline DEFAULT_CONFIG.accelWindowSize
  })
  writebackFixedRates(result.points)
  console.log(`Fixed orientations: ${result.points.filter(p => p.fixed).length}/${result.points.length} points`)

  // Batch-solve canopy control inputs (after fixOrientations so rates are corrected)
  const canopySolverCfg: ControlInversionConfig = {
    segments: canopyPolar.aeroSegments ?? [],
    cgMeters: canopyCg,
    height: canopyMassRef,
    mass: canopyPolar.m,
    inertia: canopyInertia,
    canopyControlGain: 3.0,
    riserLength: 6.0,
  }
  let canopyConvergeCount = 0
  let canopyTotal = 0
  for (let i = 0; i < result.points.length; i++) {
    const pt = result.points[i]
    const fm = pt.flightMode?.mode ?? 0
    const isCanopyPhase = fm === 5 || fm === 6 || fm === 7
    if (!isCanopyPhase || pt.bodyRates?.pDot === undefined) continue
    canopyTotal++
    const cs = canopyStates[i]
    if (cs?.valid) {
      canopySolverCfg.phi = cs.phi
      canopySolverCfg.theta = cs.theta
    }
    const sol = solveCanopyControls(pt, canopySolverCfg)
    pt.solvedControls = {
      pitchThrottle: 0,
      rollThrottle: 0,
      yawThrottle: 0,
      converged: sol.converged,
      brakeLeft: sol.brakeLeft,
      brakeRight: sol.brakeRight,
      frontRiserLeft: sol.frontRiserLeft,
      frontRiserRight: sol.frontRiserRight,
      mode: 'canopy',
    }
    if (sol.converged) canopyConvergeCount++
  }
  console.log(`Canopy solver: ${canopyConvergeCount}/${canopyTotal} converged`)

  // Initialize replay
  if (!replay) {
    replay = new GPSReplay(result.points, (index, t, fraction) => {
      scene?.setIndex(index, fraction)
      bodyScene?.setIndex(index, fraction)
      charts?.setCursor(index)
      updateReadout(index)
      updateMomentInset()
      updateChartPolar()
      updateLegends(index)
      updateTransport(t, dur)
      applyKeyframeCameras(t)
    })
  } else {
    replay.setData(result.points)
  }

  // Scrubber
  scrubber.max = String(result.points.length - 1)
  scrubber.value = '0'

  // Go to first frame
  charts.setCursor(0)
  scene.setIndex(0)
  bodyScene.setIndex(0)
  updateReadout(0)
  updateTransport(0, dur)

  // ── Capture Handler ──
  if (!captureHandler) {
    captureHandler = new CaptureHandler({
      renderFrame: (index, fraction) => {
        scene?.setIndex(index, fraction)
        bodyScene?.setIndex(index, fraction)
        scrubber.value = String(index)          // sync scrubber so updateChartPolar reads correct index
        charts?.setCursor(index)                // move chart cursors to current frame
        updateReadout(index)
        updateMomentInset()
        updateChartPolar()
        updateLegends(index)
        // Apply keyframe cameras for capture
        if (result) {
          const t = result.points[Math.min(index, result.points.length - 1)].processed.t
          applyKeyframeCameras(t)
        }
      },
      getFlightBounds: () => {
        if (!result) return { startTime: 0, endTime: 0 }
        const pts = result.points

        // Start: use exit detector push-off (a few seconds before for context)
        let startTime = pts[0]?.processed.t ?? 0
        if (exitEstimate) {
          // 2 seconds before push-off for pre-exit context
          const preRoll = 2.0
          startTime = Math.max(pts[0].processed.t, pts[exitEstimate.pushOffIndex].processed.t - preRoll)
        } else {
          // Fallback: first wingsuit/freefall frame
          for (const p of pts) {
            if (p.flightMode && p.flightMode.mode >= 3) {
              startTime = p.processed.t
              break
            }
          }
        }

        // End: last frame before returning to ground mode (mode 1)
        let endTime = pts[pts.length - 1]?.processed.t ?? 0
        for (let i = pts.length - 1; i >= 0; i--) {
          const mode = pts[i].flightMode?.mode ?? 0
          if (mode > 1) {
            // Include a couple seconds of ground mode after landing
            const postRoll = 2.0
            endTime = Math.min(pts[pts.length - 1].processed.t, pts[i].processed.t + postRoll)
            break
          }
        }

        // Override with keyframe capture range if set
        if (kfEditor.captureStart != null) startTime = kfEditor.captureStart
        if (kfEditor.captureEnd != null) endTime = kfEditor.captureEnd

        return { startTime, endTime }
      },
    })
    captureHandler.bindUI(
      document.getElementById('capture-status')!,
      document.getElementById('capture-frame')!,
    )
    document.getElementById('capture-btn')!.addEventListener('click', () => {
      captureHandler?.startCapture()
    })
  }
  captureHandler.setData(result.points, flightDateStr)
}

// ─── Transport Controls ─────────────────────────────────────────────────────

btnPlay.addEventListener('click', () => {
  if (!replay) return
  if (replay.playing) {
    replay.pause()
    btnPlay.textContent = '▶'
  } else {
    replay.play()
    btnPlay.textContent = '⏸'
  }
})

scrubber.addEventListener('input', () => {
  if (!replay || !result) return
  const idx = parseInt(scrubber.value)
  replay.seekIndex(idx)
  scene?.setIndex(idx)
  bodyScene?.setIndex(idx)
  charts?.setCursor(idx)
  updateReadout(idx)
  updateMomentInset()
  updateChartPolar()
  updateLegends(idx)
  const t = result.points[idx]?.processed.t ?? 0
  updateTransport(t, result.duration)
  applyKeyframeCameras(t)
})

speedSelect.addEventListener('change', () => {
  if (replay) replay.speed = parseFloat(speedSelect.value)
})

if (followSlider) {
  followSlider.addEventListener('input', () => {
    // Legacy — follow cam removed in vehicle-at-origin refactor
  })
}

function updateTransport(t: number, duration: number) {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = (s % 60).toFixed(1)
    return `${m}:${sec.padStart(4, '0')}`
  }
  timeDisplay.textContent = `${fmt(t)} / ${fmt(duration)}`
  if (result) {
    // Update scrubber position without triggering input event
    const idx = findTimeIndex(t)
    scrubber.value = String(idx)
  }
}

function findTimeIndex(t: number): number {
  if (!result) return 0
  const pts = result.points
  // Binary search for nearest time
  let lo = 0, hi = pts.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid].processed.t < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

// ─── Readout ────────────────────────────────────────────────────────────────

// ─── Moment Inset Update ────────────────────────────────────────────────────

function updateMomentInset() {
  if (!momentInset || !scene || !controlSolverToggle.checked) {
    if (momentInset) momentInset.visible = false
    return
  }
  momentInset.visible = true
  const s = scene.lastOverlayState

  // Auto-detect mode from current point's flight phase
  const idx = parseInt(scrubber.value) || 0
  const pt = result?.points[idx]
  const fm = pt?.flightMode?.mode ?? 0
  const isCanopyPhase = fm === 5 || fm === 6 || fm === 7  // DEPLOY, CANOPY, LANDING

  if (isCanopyPhase) {
    momentInset.setMode('canopy')
    momentInset.setControlMap(s.canopyControlMap ?? null)
    // Use batch-solved convergence when available (more reliable than per-frame overlay)
    const batchConverged = pt?.solvedControls?.mode === 'canopy' ? pt.solvedControls.converged : s.canopyConverged
    momentInset.update(s.canopyMoments, s.canopyCanopyControls, batchConverged)
  } else {
    momentInset.setMode('wingsuit')
    momentInset.setControlMap(null)
    const batchConverged = pt?.solvedControls?.mode === 'wingsuit' ? pt.solvedControls.converged : s.converged
    momentInset.update(s.moments, s.controls, batchConverged)
  }
}

/** Push solved controls to chart swept polar (updates every frame) */
function updateChartPolar() {
  if (!charts) return
  const idx = parseInt(scrubber.value) || 0
  if (scene && controlSolverToggle.checked) {
    const s = scene.lastOverlayState
    // Pick controls matching current flight phase
    const pt = result?.points[idx]
    const fm = pt?.flightMode?.mode ?? 0
    const isCanopyPhase = fm === 5 || fm === 6 || fm === 7
    const controls = isCanopyPhase
      ? s.canopySolvedSegmentControls
      : s.solvedSegmentControls
    if (controls) {
      charts.setSolvedControls(controls, idx)
      return
    }
  }
  // Solver off or no controls — still need to sweep with correct polar for flight phase
  charts.setSolvedControls(defaultControls(), idx)
}

function updateLegends(index: number) {
  if (!result) return
  const pt = result.points[index]
  if (!pt) return

  inertialLegend?.update(pt)

  if (bodyLegend && scene) {
    const s = scene.lastOverlayState
    const fm = pt.flightMode?.mode ?? 0
    const isCanopyPhase = fm === 5 || fm === 6 || fm === 7
    if (isCanopyPhase) {
      const batchConverged = pt.solvedControls?.mode === 'canopy' ? pt.solvedControls.converged : s.canopyConverged
      bodyLegend.update({
        pt,
        converged: batchConverged,
        controlPitch: 0,
        controlRoll: 0,
        controlYaw: 0,
        mode: 'canopy',
        brakeLeft: s.canopyCanopyControls?.brakeLeft ?? pt.solvedControls?.brakeLeft ?? 0,
        brakeRight: s.canopyCanopyControls?.brakeRight ?? pt.solvedControls?.brakeRight ?? 0,
        frontRiserLeft: s.canopyCanopyControls?.frontRiserLeft ?? pt.solvedControls?.frontRiserLeft ?? 0,
        frontRiserRight: s.canopyCanopyControls?.frontRiserRight ?? pt.solvedControls?.frontRiserRight ?? 0,
      })
    } else {
      bodyLegend.update({
        pt,
        converged: s.converged,
        controlPitch: s.controls.pitch,
        controlRoll: s.controls.roll,
        controlYaw: s.controls.yaw,
        mode: 'wingsuit',
      })
    }
  }
}

// ─── Readout ────────────────────────────────────────────────────────────────

const readoutEl = document.getElementById('readout')!

// ─── Overlay toggle ─────────────────────────────────────────────────────────
const overlayToggle = document.getElementById('overlay-toggle') as HTMLInputElement
overlayToggle.addEventListener('change', () => {
  const show = overlayToggle.checked
  document.querySelectorAll('.scene-legend').forEach(el => {
    ;(el as HTMLElement).style.display = show ? '' : 'none'
  })
  readoutEl.style.display = show ? '' : 'none'
})

// ─── Control Solver toggle ──────────────────────────────────────────────────
const controlSolverToggle = document.getElementById('control-solver-toggle') as HTMLInputElement
controlSolverToggle.addEventListener('change', () => {
  const enabled = controlSolverToggle.checked
  scene?.setControlSolverEnabled(enabled)
  bodyScene?.setControlSolverEnabled(enabled)
})

// ─── Axis helper mode ───────────────────────────────────────────────────────
const axisHelperSelect = document.getElementById('axis-helper-mode') as HTMLSelectElement
axisHelperSelect.addEventListener('change', () => {
  const mode = axisHelperSelect.value as 'none' | 'frame' | 'all'
  if (scene) scene.setAxisMode(mode)
  if (bodyScene) bodyScene.setAxisMode(mode)
})

function updateReadout(index: number) {
  if (!result || index >= result.points.length) return
  const p = result.points[index]
  const g = p.processed
  const a = p.aero
  const fm = p.flightMode
  const br = p.bodyRates

  const ms2mph = 2.237
  const ms2kmh = 3.6
  const r2d = 180 / Math.PI

  const ld = a.cd > 0.001 ? a.cl / a.cd : 0
  const psiDeg = ((a.psi * r2d) % 360 + 360) % 360

  // Deploy replay state for this point
  const drp = currentDeployTimeline?.points[index]
  const isCanopyPhase = fm?.mode === 6 || fm?.mode === 5 || fm?.mode === 7 // CANOPY, DEPLOY, or LANDING
  const displayAoaDeg = isCanopyPhase && drp?.canopyState?.valid
    ? drp.canopyAoaDeg
    : a.aoa * r2d
  const aoaLabel = isCanopyPhase && drp?.canopyState?.valid ? 'α (Canopy)' : 'α (AOA)'

  // Deploy section HTML
  let deployHtml = ''
  if (drp && drp.subPhase !== 'pre_deploy') {
    const subPhaseLabel: Record<string, string> = {
      pc_toss: '🪂 PC Toss',
      bridle_stretch: '📏 Bridle Stretch',
      line_stretch: '⚡ Line Stretch',
      max_aoa: '📐 Max AoA',
      snivel: '🌀 Snivel',
      surge: '🏄 Surge',
      full_flight: '✈️ Full Flight',
      pre_deploy: '—',
    }
    const tls = drp.timeSinceLineStretch
    const tlsStr = tls != null ? `${tls >= 0 ? '+' : ''}${tls.toFixed(2)}s` : '—'
    deployHtml = `
    <div class="section">Deployment Replay</div>
    <div class="row"><span class="label">Sub-Phase</span><span class="value">${subPhaseLabel[drp.subPhase] ?? drp.subPhase}</span></div>
    <div class="row"><span class="label">t from LS</span><span class="value">${tlsStr}</span></div>
    <div class="row"><span class="label">Deploy</span><span class="value">${(drp.deployFraction * 100).toFixed(0)}%</span></div>
    <div class="row"><span class="label">Canopy α</span><span class="value">${isNaN(drp.canopyAoaDeg) ? '—' : drp.canopyAoaDeg.toFixed(1) + '°'}</span></div>
    <div class="row"><span class="label">Trust</span><span class="value" style="color:${drp.canopyTrust ? '#44ff66' : '#ff8844'}">${drp.canopyTrust ? 'Yes' : 'Low'}</span></div>`
  }

  // Override flight mode label during deployment sub-phases
  const deployModeLabel = (drp && drp.subPhase !== 'pre_deploy' && drp.subPhase !== 'full_flight')
    ? 'Deploy' : (fm?.modeString ?? 'N/A')

  readoutEl.innerHTML = `
    <div class="section">Flight Mode</div>
    <div class="row"><span class="label">Mode</span><span class="value">${deployModeLabel}</span></div>
    ${deployHtml}
    <div class="section">Position</div>
    <div class="row"><span class="label">Altitude</span><span class="value">${g.hMSL.toFixed(0)} m (${(g.hMSL * 3.281).toFixed(0)} ft)</span></div>
    <div class="row"><span class="label">N / E</span><span class="value">${g.posN.toFixed(0)} / ${g.posE.toFixed(0)} m</span></div>
    <div class="section">Velocity</div>
    <div class="row"><span class="label">Airspeed</span><span class="value">${g.airspeed.toFixed(1)} m/s (${(g.airspeed * ms2mph).toFixed(0)} mph)</span></div>
    <div class="row"><span class="label">Ground</span><span class="value">${g.groundSpeed.toFixed(1)} m/s (${(g.groundSpeed * ms2mph).toFixed(0)} mph)</span></div>
    <div class="row"><span class="label">Vert</span><span class="value">${(-g.velD).toFixed(1)} m/s (${(-g.velD * ms2mph).toFixed(0)} mph)</span></div>
    <div class="section">Orientation (Euler)</div>
    <div class="row"><span class="label">φ (Bank)</span><span class="value">${(a.roll * r2d).toFixed(1)}°</span></div>
    <div class="row"><span class="label">θ (Pitch)</span><span class="value">${(a.theta * r2d).toFixed(1)}°</span></div>
    <div class="row"><span class="label">ψ (Heading)</span><span class="value">${psiDeg.toFixed(1)}°</span></div>
    <div class="row"><span class="label">γ (FPA)</span><span class="value">${(a.gamma * r2d).toFixed(1)}°</span></div>
    <div class="section">Body Rates</div>
    <div class="row"><span class="label">p (roll)</span><span class="value">${(br?.p ?? 0).toFixed(1)} °/s</span></div>
    <div class="row"><span class="label">q (pitch)</span><span class="value">${(br?.q ?? 0).toFixed(1)} °/s</span></div>
    <div class="row"><span class="label">r (yaw)</span><span class="value">${(br?.r ?? 0).toFixed(1)} °/s</span></div>
    <div class="section">Aerodynamics</div>
    <div class="row"><span class="label">${aoaLabel}</span><span class="value">${displayAoaDeg.toFixed(1)}°</span></div>
    <div class="row"><span class="label">CL</span><span class="value">${a.cl.toFixed(3)}</span></div>
    <div class="row"><span class="label">CD</span><span class="value">${a.cd.toFixed(3)}</span></div>
    <div class="row"><span class="label">L/D</span><span class="value">${ld.toFixed(2)}</span></div>
    <div class="row"><span class="label">kL / kD</span><span class="value">${a.kl.toFixed(3)} / ${a.kd.toFixed(3)}</span></div>
    <div class="row"><span class="label">q̄</span><span class="value">${g.qbar.toFixed(0)} Pa</span></div>
    <div class="row"><span class="label">ρ</span><span class="value">${g.rho.toFixed(4)} kg/m³</span></div>
    <div class="row"><span class="label">AOA residual</span><span class="value">${a.aoaResidual.toFixed(4)}</span></div>
    ${controlSolverToggle.checked ? `
    <div class="section">Control Solver</div>
    <div class="row"><span class="label">Converged</span><span class="value" style="color:${p.solvedControls?.converged ? '#44ff66' : '#ff4444'}">${p.solvedControls?.converged ? 'Yes' : 'No'}</span></div>
    ${p.solvedControls?.mode === 'canopy' ? `
    <div class="row"><span class="label">Brake L</span><span class="value">${((p.solvedControls?.brakeLeft ?? 0) * 100).toFixed(0)}%</span></div>
    <div class="row"><span class="label">Brake R</span><span class="value">${((p.solvedControls?.brakeRight ?? 0) * 100).toFixed(0)}%</span></div>
    <div class="row"><span class="label">F.Riser L</span><span class="value">${((p.solvedControls?.frontRiserLeft ?? 0) * 100).toFixed(0)}%</span></div>
    <div class="row"><span class="label">F.Riser R</span><span class="value">${((p.solvedControls?.frontRiserRight ?? 0) * 100).toFixed(0)}%</span></div>
    ` : `
    <div class="row"><span class="label">Pitch</span><span class="value">${(p.solvedControls?.pitchThrottle ?? 0).toFixed(3)}</span></div>
    <div class="row"><span class="label">Roll</span><span class="value">${(p.solvedControls?.rollThrottle ?? 0).toFixed(3)}</span></div>
    <div class="row"><span class="label">Yaw</span><span class="value">${(p.solvedControls?.yawThrottle ?? 0).toFixed(3)}</span></div>
    `}
    ` : ''}
  `
}

// ─── Head Sensor Loading ────────────────────────────────────────────────────

const headSensorBtn = document.getElementById('head-sensor-btn')!
const headSensorInput = document.getElementById('head-sensor-input') as HTMLInputElement
const headSensorStatus = document.getElementById('head-sensor-status')!
const headTimeOffset = document.getElementById('head-time-offset') as HTMLInputElement

headSensorBtn.addEventListener('click', () => headSensorInput.click())

headSensorInput.addEventListener('change', async () => {
  const file = headSensorInput.files?.[0]
  if (!file) return
  headSensorStatus.textContent = `Loading ${file.name}...`

  const text = await file.text()
  const { points, gpsStartIndex } = parseHeadSensorCSV(text)

  if (points.length === 0) {
    headSensorStatus.textContent = 'No valid data found'
    return
  }

  // Auto-compute time offset using gps_time column (absolute UTC)
  // sensorGpsTimeMs = absolute UTC at first sensor GPS point
  // GPS pipeline t=0 = GNSSData[0].timestamp (ms since epoch)
  // offset = gps_pipeline_t_at_sensor_gps_start - sensor_t_at_gps_start
  let offset = parseFloat(headTimeOffset.value) || 0
  const userSetOffset = headTimeOffset.value !== '' && headTimeOffset.value !== '0'
  if (gpsStartIndex >= 0 && !userSetOffset && result) {
    const sensorGpsTimeMs = points[gpsStartIndex].gpsTimeMs
    const pipelineEpochMs = result?.startEpochMs ?? NaN
    if (!isNaN(sensorGpsTimeMs) && !isNaN(pipelineEpochMs)) {
      // GPS pipeline t corresponding to sensor's first GPS moment
      const pipelineT = (sensorGpsTimeMs - pipelineEpochMs) / 1000
      // Sensor normalized t at that same moment
      const sensorT = points[gpsStartIndex].t
      // sensorTime = gpsTime + offset → offset = sensorT - pipelineT
      offset = sensorT - pipelineT
      headTimeOffset.value = offset.toFixed(2)
      console.log(`Head sensor auto-align via gps_time: sensorT=${sensorT.toFixed(2)}s → pipelineT=${pipelineT.toFixed(2)}s → offset=${offset.toFixed(2)}s`)
    } else if (gpsStartIndex >= 0) {
      // Fallback: no gps_time column, assume GPS starts at pipeline t=0
      offset = points[gpsStartIndex].t
      headTimeOffset.value = offset.toFixed(2)
      console.log(`Head sensor auto-align (fallback): GPS at sensorT=${points[gpsStartIndex].t.toFixed(2)}s → offset=${offset.toFixed(2)}s`)
    }
  }

  scene?.setHeadSensorData(points, offset)
  bodyScene?.setHeadSensorData(points, offset)
  headSensorStatus.textContent = `${points.length} pts (${points[0].t.toFixed(1)}s → ${points[points.length - 1].t.toFixed(1)}s) offset=${offset.toFixed(1)}s`
})

headTimeOffset.addEventListener('change', () => {
  // Re-apply time offset if data is already loaded
  const offset = parseFloat(headTimeOffset.value) || 0
  // Will take effect on next frame render
  if (scene) {
    // Access through the scene's setHeadSensorData re-applies offset
    // For now just log — a proper API would store the data and re-call
    console.log(`Head time offset changed to ${offset}s`)
  }
})

// ─── Camera Head Position Loading ───────────────────────────────────────────

const cameraHeadBtn = document.getElementById('camera-head-btn')!
const cameraHeadInput = document.getElementById('camera-head-input') as HTMLInputElement
const cameraHeadStatus = document.getElementById('camera-head-status')!
const cameraMountControls = document.getElementById('camera-mount-controls')!
const camOffsetHeading = document.getElementById('cam-offset-heading') as HTMLInputElement
const camOffsetPitch = document.getElementById('cam-offset-pitch') as HTMLInputElement
const camOffsetRoll = document.getElementById('cam-offset-roll') as HTMLInputElement
const camSyncOffset = document.getElementById('cam-sync-offset') as HTMLInputElement
const camGyroflowPath = document.getElementById('cam-gyroflow-path') as HTMLInputElement
const cameraConfigSave = document.getElementById('camera-config-save')!
const cameraConfigLoad = document.getElementById('camera-config-load')!

/** Stored raw CSV text for re-parse on sync offset change */
let cameraCSVText: string | null = null
/** Current camera sync offset in ms */
let cameraSyncOffsetMs = 0

/** Convert absolute filesystem path to Vite /@fs/ URL */
function fsPathToURL(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/')
  return '/@fs/' + encodeURI(normalized)
}

/** Get track folder from loadedTrackPath or URL params */
function getTrackFolder(): string | null {
  const track = loadedTrackPath || new URLSearchParams(window.location.search).get('track')
  if (!track) return null
  const lastSlash = track.lastIndexOf('/')
  return lastSlash >= 0 ? track.substring(0, lastSlash) : null
}

/** Read current mount offset from UI inputs */
function readMountOffset(): CameraMountOffset {
  return {
    headingDeg: parseFloat(camOffsetHeading.value) || 0,
    pitchDeg: parseFloat(camOffsetPitch.value) || 0,
    rollDeg: parseFloat(camOffsetRoll.value) || 0,
  }
}

/** Apply mount offset to both scenes */
function applyMountOffset() {
  const offset = readMountOffset()
  scene?.setCameraMountOffset(offset)
  bodyScene?.setCameraMountOffset(offset)
}

/** Fetch sync-result.json from a track folder in public/ */
async function fetchSyncResult(trackFolder: string): Promise<CameraSyncResult | null> {
  try {
    const resp = await fetch(`/${trackFolder}/sync-result.json`)
    if (!resp.ok) return null
    const ct = resp.headers.get('content-type') || ''
    if (ct.includes('html')) return null  // SPA fallback, not real JSON
    return parseSyncResult(await resp.text())
  } catch {
    return null
  }
}

/** Save sync-result.json to public/<trackFolder>/ via dev server API */
async function saveSyncConfig(trackFolder: string, config: Record<string, unknown>): Promise<boolean> {
  try {
    const resp = await fetch('/api/sync-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackFolder, config }),
    })
    return resp.ok
  } catch {
    return false
  }
}

/** Fetch gyroflow CSV from absolute path via Vite /@fs/ */
async function fetchGyroflowCSV(absolutePath: string): Promise<string | null> {
  const url = fsPathToURL(absolutePath)
  try {
    const resp = await fetch(url)
    if (!resp.ok) {
      console.error(`Failed to fetch gyroflow CSV from ${url}: ${resp.status}`)
      return null
    }
    return await resp.text()
  } catch (e) {
    console.error('Failed to fetch gyroflow CSV:', e)
    return null
  }
}

/** Load camera CSV data with a given sync offset */
function loadCameraCSVData(text: string, syncOffsetMs: number) {
  cameraCSVText = text
  cameraSyncOffsetMs = syncOffsetMs
  camSyncOffset.value = String(syncOffsetMs)
  const points = parseCameraSensorCSV(text, syncOffsetMs)
  if (points.length === 0) {
    cameraHeadStatus.textContent = 'No valid camera data found'
    return
  }
  scene?.setCameraData(points)
  bodyScene?.setCameraData(points)
  applyMountOffset()
  cameraMountControls.style.display = ''
  const tStart = points[0].pipelineTimeS.toFixed(1)
  const tEnd = points[points.length - 1].pipelineTimeS.toFixed(1)
  cameraHeadStatus.textContent = `${points.length} pts (${tStart}s → ${tEnd}s) sync=${syncOffsetMs}ms`
}

/** Load camera data from sync-result.json (for URL auto-load or Load Config) */
async function loadCameraFromSyncResult(trackFolder: string): Promise<boolean> {
  const syncResult = await fetchSyncResult(trackFolder)
  if (!syncResult || !syncResult.gyroflow) return false

  camGyroflowPath.value = syncResult.gyroflow

  cameraHeadStatus.textContent = `Loading gyroflow CSV...`
  const text = await fetchGyroflowCSV(syncResult.gyroflow)
  if (!text) {
    cameraHeadStatus.textContent = `Failed to load: ${syncResult.gyroflow}`
    return false
  }

  // Apply mount offset from sync result if present
  if (syncResult.mountOffset) {
    camOffsetHeading.value = String(syncResult.mountOffset.headingDeg ?? 0)
    camOffsetPitch.value = String(syncResult.mountOffset.pitchDeg ?? -20)
    camOffsetRoll.value = String(syncResult.mountOffset.rollDeg ?? 0)
  }

  loadCameraCSVData(text, syncResult.offsetMs)
  console.log(`Camera loaded from sync-result.json: ${syncResult.gyroflow} (${syncResult.confidence})`)
  return true
}

// Button click → standard file picker for gyroflow CSV
cameraHeadBtn.addEventListener('click', () => cameraHeadInput.click())

cameraHeadInput.addEventListener('change', async () => {
  const file = cameraHeadInput.files?.[0]
  if (!file) return
  cameraHeadStatus.textContent = `Loading ${file.name}...`

  const text = await file.text()

  // Auto-detect sync offset from sync-result.json in track folder
  const trackFolder = getTrackFolder()
  let syncMs = 0
  if (trackFolder) {
    const existing = await fetchSyncResult(trackFolder)
    if (existing) {
      syncMs = existing.offsetMs
      console.log(`Auto-detected sync offset: ${syncMs}ms from sync-result.json`)
      // Also restore gyroflow path if present
      if (existing.gyroflow) camGyroflowPath.value = existing.gyroflow
    }
  }

  loadCameraCSVData(text, syncMs)
})

// Mount offset live updates
for (const input of [camOffsetHeading, camOffsetPitch, camOffsetRoll]) {
  input.addEventListener('change', applyMountOffset)
  input.addEventListener('input', applyMountOffset)
}

// Sync offset change → re-parse camera data with new offset
camSyncOffset.addEventListener('change', () => {
  const newOffsetMs = parseFloat(camSyncOffset.value) || 0
  if (cameraCSVText) {
    loadCameraCSVData(cameraCSVText, newOffsetMs)
  }
  cameraSyncOffsetMs = newOffsetMs
})

// Save config → write sync-result.json to public/<trackFolder>/
// Prompts for gyroflow path if not already known (needed for auto-load)
cameraConfigSave.addEventListener('click', async () => {
  const trackFolder = getTrackFolder()
  if (!trackFolder) {
    cameraHeadStatus.textContent = 'No track loaded — cannot save'
    return
  }

  // Get gyroflow path — needed so auto-load can fetch the CSV via /@fs/
  let gyroflowPath = camGyroflowPath.value.trim()
  if (!gyroflowPath) {
    const prompted = window.prompt(
      'Absolute path to Gyroflow CSV (for future auto-load):\n' +
      'e.g. C:\\Users\\...\\gyroflowcameradatafull.csv',
    )
    if (!prompted) return
    gyroflowPath = prompted
    camGyroflowPath.value = gyroflowPath
  }

  // Merge with existing sync-result.json (preserves fields we don't manage)
  const existing = await fetchSyncResult(trackFolder)
  const config = {
    ...(existing || {}),
    flysight: loadedTrackPath || existing?.flysight || '',
    gyroflow: gyroflowPath,
    offsetMs: cameraSyncOffsetMs,
    mountOffset: readMountOffset(),
  }

  const ok = await saveSyncConfig(trackFolder, config)
  if (ok) {
    cameraHeadStatus.textContent += ' (saved to sync-result.json)'
    console.log('Sync config saved to', `public/${trackFolder}/sync-result.json`)
  } else {
    cameraHeadStatus.textContent += ' (save failed — is dev server running?)'
  }
})

// Load config → read sync-result.json and auto-load gyroflow CSV via /@fs/
cameraConfigLoad.addEventListener('click', async () => {
  const trackFolder = getTrackFolder()
  if (!trackFolder) {
    cameraHeadStatus.textContent = 'No track loaded — cannot load'
    return
  }
  const loaded = await loadCameraFromSyncResult(trackFolder)
  if (!loaded) {
    cameraHeadStatus.textContent = 'No sync-result.json found (or no gyroflow field)'
  }
})

// ─── Keyframe Editor ────────────────────────────────────────────────────────

const kfEditor = new KeyframeEditor()

const kfEnabled = document.getElementById('kf-enabled') as HTMLInputElement
const kfAddInertial = document.getElementById('kf-add-inertial')!
const kfAddBody = document.getElementById('kf-add-body')!
const kfDelete = document.getElementById('kf-delete')!
const kfClear = document.getElementById('kf-clear')!
const kfSave = document.getElementById('kf-save')!
const kfLoadBtn = document.getElementById('kf-load-btn')!
const kfLoadInput = document.getElementById('kf-load-input') as HTMLInputElement
const kfStatus = document.getElementById('kf-status')!
const kfTimeline = document.getElementById('kf-timeline')!

/** Get current GPS pipeline time from the scrubber/replay */
function getCurrentGPSTime(): number {
  if (!result || result.points.length === 0) return 0
  const idx = parseInt(scrubber.value) || 0
  return result.points[Math.min(idx, result.points.length - 1)].processed.t
}

kfEnabled.addEventListener('change', () => {
  kfEditor.setEnabled(kfEnabled.checked)
  kfTimeline.style.display = kfEnabled.checked ? 'block' : 'none'
  updateKfStatus()
})

kfAddInertial.addEventListener('click', () => {
  if (!scene) return
  const t = getCurrentGPSTime()
  kfEditor.addInertialKeyframe(t, scene.getCameraPosition(), scene.getCameraZoom())
  console.log(`Added inertial keyframe at t=${t.toFixed(2)}s`)
})

kfAddBody.addEventListener('click', () => {
  if (!bodyScene) return
  const t = getCurrentGPSTime()
  kfEditor.addBodyKeyframe(t, bodyScene.getCameraPosition(), bodyScene.getCameraZoom())
  console.log(`Added body keyframe at t=${t.toFixed(2)}s`)
})

kfDelete.addEventListener('click', () => {
  const t = getCurrentGPSTime()
  // Delete nearest keyframe within 2 seconds
  const ni = kfEditor.findNearest(kfEditor.inertialKeyframes, t)
  const nb = kfEditor.findNearest(kfEditor.bodyKeyframes, t)
  if (ni && ni.distance < 2) {
    kfEditor.deleteInertialKeyframe(ni.index)
    console.log(`Deleted inertial keyframe at index ${ni.index}`)
  }
  if (nb && nb.distance < 2) {
    kfEditor.deleteBodyKeyframe(nb.index)
    console.log(`Deleted body keyframe at index ${nb.index}`)
  }
})

kfClear.addEventListener('click', () => {
  if (confirm('Clear all keyframes?')) {
    kfEditor.clear()
  }
})

kfSave.addEventListener('click', () => kfEditor.save())
kfLoadBtn.addEventListener('click', () => kfLoadInput.click())
kfLoadInput.addEventListener('change', async () => {
  const file = kfLoadInput.files?.[0]
  if (!file) return
  const text = await file.text()
  if (kfEditor.fromJSON(text)) {
    console.log('Keyframes loaded from', file.name)
  }
})

function updateKfStatus() {
  const ni = kfEditor.inertialKeyframes.length
  const nb = kfEditor.bodyKeyframes.length
  const parts: string[] = []
  if (ni > 0 || nb > 0) parts.push(`Inertial: ${ni}, Body: ${nb}`)
  if (kfEditor.captureStart != null) parts.push(`Start: ${kfEditor.captureStart.toFixed(1)}s`)
  if (kfEditor.captureEnd != null) parts.push(`End: ${kfEditor.captureEnd.toFixed(1)}s`)
  kfStatus.textContent = parts.length > 0 ? parts.join(' | ') : (kfEditor.isEnabled ? 'Enabled — no keyframes' : 'No keyframes')
}

function renderKfTimeline() {
  if (!result || result.points.length === 0) return
  const dur = result.duration

  // Clear old markers
  const markers = kfTimeline.querySelectorAll('.kf-marker')
  markers.forEach(m => m.remove())

  const addMarkers = (keyframes: readonly { t: number }[], color: string, type: 'inertial' | 'body') => {
    keyframes.forEach((kf, idx) => {
      const pct = dur > 0 ? (kf.t / dur) * 100 : 0
      const marker = document.createElement('div')
      marker.className = 'kf-marker'
      marker.style.cssText = `position:absolute;left:${pct}%;top:50%;width:12px;height:12px;background:${color};transform:translate(-6px,-50%) rotate(45deg);cursor:pointer;z-index:1;box-shadow:0 0 0 2px #000,0 0 4px rgba(0,0,0,0.6);`
      marker.title = `${type} t=${kf.t.toFixed(2)}s — click to edit`
      marker.addEventListener('click', (e) => {
        e.stopPropagation()
        openKfEditPopup(type, idx, marker)
      })
      kfTimeline.appendChild(marker)
    })
  }

  addMarkers(kfEditor.inertialKeyframes, '#4488ff', 'inertial')
  addMarkers(kfEditor.bodyKeyframes, '#ff8844', 'body')

  // Capture range markers (vertical bars)
  const addRangeMarker = (t: number | null, color: string, label: string) => {
    if (t == null || dur <= 0) return
    const pct = (t / dur) * 100
    const marker = document.createElement('div')
    marker.className = 'kf-marker'
    marker.style.cssText = `position:absolute;left:${pct}%;top:0;bottom:0;width:4px;background:${color};transform:translateX(-2px);cursor:default;z-index:2;box-shadow:1px 0 0 1px rgba(0,0,0,0.7),-1px 0 0 1px rgba(0,0,0,0.7);`
    marker.title = `${label}: ${t.toFixed(1)}s`
    kfTimeline.appendChild(marker)
  }
  addRangeMarker(kfEditor.captureStart, '#44ffaa', 'Capture start')
  addRangeMarker(kfEditor.captureEnd, '#ff4466', 'Capture end')
}

// ─── Keyframe Edit Popup ────────────────────────────────────────────────────

interface KfEditState {
  type: 'inertial' | 'body'
  index: number
  originalPosition: [number, number, number]
  originalZoom: number
  unsubscribe: () => void
}
let kfEditState: KfEditState | null = null

const kfEditPopup = document.getElementById('kf-edit-popup') as HTMLDivElement
const kfEditTitle = document.getElementById('kf-edit-title')!
const kfEditTime = document.getElementById('kf-edit-time')!
const kfEditPos = document.getElementById('kf-edit-pos')!
const kfEditZoom = document.getElementById('kf-edit-zoom')!
const kfEditSave = document.getElementById('kf-edit-save')!
const kfEditCancel = document.getElementById('kf-edit-cancel')!

/** Convert GPS time (seconds) to nearest scrubber index */
function tToIndex(t: number): number {
  if (!result) return 0
  let best = 0
  let bestDelta = Infinity
  result.points.forEach((pt, i) => {
    const d = Math.abs(pt.processed.t - t)
    if (d < bestDelta) { bestDelta = d; best = i }
  })
  return best
}

function updatePopupReadout() {
  if (!kfEditState) return
  const activeScene = kfEditState.type === 'inertial' ? scene : bodyScene
  if (!activeScene) return
  const pos = activeScene.getCameraPosition()
  const zoom = activeScene.getCameraZoom()
  kfEditPos.textContent = `${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`
  kfEditZoom.textContent = zoom.toFixed(2)
}

function openKfEditPopup(type: 'inertial' | 'body', index: number, markerEl: HTMLElement) {
  // Close any existing popup first (cancel without saving)
  closeKfEditPopup(false)

  const keyframes = type === 'inertial' ? kfEditor.inertialKeyframes : kfEditor.bodyKeyframes
  const kf = keyframes[index]
  if (!kf) return

  const activeScene = type === 'inertial' ? scene : bodyScene
  if (!activeScene) return

  // Seek to keyframe time
  const idx = tToIndex(kf.t)
  scrubber.value = String(idx)
  replay?.seekIndex(idx)
  scene?.setIndex(idx)
  bodyScene?.setIndex(idx)
  charts?.setCursor(idx)
  updateReadout(idx)
  updateTransport(kf.t, result?.duration ?? 0)

  // Subscribe to live camera changes
  const unsubscribe = activeScene.onCameraChange(updatePopupReadout)

  kfEditState = {
    type,
    index,
    originalPosition: [...kf.position] as [number, number, number],
    originalZoom: kf.zoom,
    unsubscribe,
  }

  // Populate popup
  const color = type === 'inertial' ? '#4488ff' : '#ff8844'
  kfEditTitle.textContent = `${type === 'inertial' ? 'Inertial' : 'Body'} Keyframe`
  kfEditTitle.style.color = color
  kfEditTime.textContent = `${kf.t.toFixed(2)}s`
  updatePopupReadout()

  // Position popup near the marker element — anchor to #scene-panel
  const scenePanel = document.getElementById('scene-panel')!
  const panelRect = scenePanel.getBoundingClientRect()
  const markerRect = markerEl.getBoundingClientRect()
  const popupW = 230
  const popupH = 110 // approximate
  let left = markerRect.left - panelRect.left - popupW / 2
  let top = markerRect.top - panelRect.top - popupH - 8
  // Clamp to panel bounds
  left = Math.max(4, Math.min(left, panelRect.width - popupW - 4))
  top = Math.max(4, Math.min(top, panelRect.height - popupH - 4))
  kfEditPopup.style.left = `${left}px`
  kfEditPopup.style.top = `${top}px`
  kfEditPopup.style.display = 'block'
}

function closeKfEditPopup(save: boolean) {
  if (!kfEditState) return
  const { type, index, originalPosition, originalZoom, unsubscribe } = kfEditState

  unsubscribe()

  if (save) {
    const activeScene = type === 'inertial' ? scene : bodyScene
    if (activeScene) {
      const pos = activeScene.getCameraPosition()
      const zoom = activeScene.getCameraZoom()
      if (type === 'inertial') {
        kfEditor.updateInertialKeyframe(index, pos, zoom)
      } else {
        kfEditor.updateBodyKeyframe(index, pos, zoom)
      }
    }
  } else {
    // Restore original camera position (cancel)
    const activeScene = type === 'inertial' ? scene : bodyScene
    activeScene?.setCameraState(
      new THREE.Vector3(...originalPosition),
      originalZoom,
    )
  }

  kfEditState = null
  kfEditPopup.style.display = 'none'
}

kfEditSave.addEventListener('click', () => closeKfEditPopup(true))
kfEditCancel.addEventListener('click', () => closeKfEditPopup(false))

kfEditor.onChange(() => {
  updateKfStatus()
  renderKfTimeline()
})

/**
 * Apply keyframe camera states at current time.
 * Called from the replay frame callback.
 */
function applyKeyframeCameras(t: number) {
  if (!kfEditor.isEnabled) {
    scene?.releaseKeyframeOverride()
    bodyScene?.releaseKeyframeOverride()
    return
  }

  const inertialState = kfEditor.getInertialCamera(t)
  if (inertialState && scene) {
    scene.setCameraState(inertialState.position, inertialState.zoom)
  } else {
    scene?.releaseKeyframeOverride()
  }

  const bodyState = kfEditor.getBodyCamera(t)
  if (bodyState && bodyScene) {
    bodyScene.setCameraState(bodyState.position, bodyState.zoom)
  } else {
    bodyScene?.releaseKeyframeOverride()
  }
}

// (keyframe cameras applied in replay callback and scrubber handler above)

// ─── Capture Range Buttons ──────────────────────────────────────────────────

const kfSetStart = document.getElementById('kf-set-start')!
const kfSetEnd = document.getElementById('kf-set-end')!
const kfClearRange = document.getElementById('kf-clear-range')!

kfSetStart.addEventListener('click', () => {
  const t = getCurrentGPSTime()
  kfEditor.setCaptureStart(t)
  console.log(`Capture start set to t=${t.toFixed(2)}s`)
})

kfSetEnd.addEventListener('click', () => {
  const t = getCurrentGPSTime()
  kfEditor.setCaptureEnd(t)
  console.log(`Capture end set to t=${t.toFixed(2)}s`)
})

kfClearRange.addEventListener('click', () => {
  kfEditor.setCaptureStart(null)
  kfEditor.setCaptureEnd(null)
  console.log('Capture range cleared')
})

// ─── Insta360 Sync Import ───────────────────────────────────────────────────

interface Insta360Keyframe {
  id: string
  pipeline_time_s: number
  pan: number
  tilt: number
  roll: number
  fov: number
  distance: number
}

interface Insta360SyncData {
  scheme?: string
  pipeline_start_s?: number
  pipeline_end_s?: number
  keyframes?: Insta360Keyframe[]
}

let cachedInsta360Sync: Insta360SyncData | null = null

const kfImportFolder = document.getElementById('kf-import-folder') as HTMLInputElement
const kfImportGenerate = document.getElementById('kf-import-generate')!
const kfImportLoad = document.getElementById('kf-import-load')!
const kfImportInput = document.getElementById('kf-import-input') as HTMLInputElement
const kfImportRange = document.getElementById('kf-import-range') as HTMLButtonElement
const kfImportKfs = document.getElementById('kf-import-kfs') as HTMLButtonElement
const kfImportStatus = document.getElementById('kf-import-status')!

/** Apply parsed Insta360 sync data to cached state and update UI */
function applyInsta360Sync(data: Insta360SyncData) {
  if (!data.pipeline_start_s && !data.keyframes?.length) {
    kfImportStatus.textContent = 'No Insta360 data in result'
    return
  }
  cachedInsta360Sync = data
  const parts: string[] = []
  if (data.scheme) parts.push(data.scheme)
  if (data.pipeline_start_s != null && data.pipeline_end_s != null) {
    parts.push(`range: ${data.pipeline_start_s.toFixed(1)}–${data.pipeline_end_s.toFixed(1)}s`)
  }
  if (data.keyframes?.length) parts.push(`${data.keyframes.length} keyframes`)
  kfImportStatus.textContent = `Loaded: ${parts.join(', ')}`
  kfImportRange.disabled = (data.pipeline_start_s == null || data.pipeline_end_s == null)
  kfImportKfs.disabled = !data.keyframes?.length
  kfImportRange.style.color = kfImportRange.disabled ? '#68a' : '#8cf'
  kfImportKfs.style.color = kfImportKfs.disabled ? '#68a' : '#8cf'
  console.log('Insta360 sync loaded:', data.scheme, data.keyframes?.length, 'keyframes')
}

// Generate Sync — runs calc-timing.js on the server via /api/calc-timing
kfImportGenerate.addEventListener('click', async () => {
  const folder = kfImportFolder.value.trim().replace(/^["']+|["']+$/g, '')
  kfImportFolder.value = folder  // reflect cleaned path back to input
  if (!folder) {
    kfImportStatus.textContent = 'Enter an edit folder path'
    return
  }
  kfImportStatus.textContent = 'Generating...'
  kfImportGenerate.setAttribute('disabled', '')
  try {
    const resp = await fetch('/api/calc-timing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editFolder: folder }),
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }))
      kfImportStatus.textContent = `Error: ${err.error || resp.statusText}`
      console.error('calc-timing error:', err)
      return
    }
    const data: Insta360SyncData = await resp.json()
    applyInsta360Sync(data)
  } catch (e) {
    kfImportStatus.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`
    console.error('calc-timing fetch error:', e)
  } finally {
    kfImportGenerate.removeAttribute('disabled')
  }
})

// Load JSON — file picker fallback
kfImportLoad.addEventListener('click', () => kfImportInput.click())

kfImportInput.addEventListener('change', async () => {
  const file = kfImportInput.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const data: Insta360SyncData = JSON.parse(text)
    applyInsta360Sync(data)
  } catch (e) {
    kfImportStatus.textContent = 'Failed to parse JSON'
    console.error('Insta360 sync parse error:', e)
  }
})

kfImportRange.addEventListener('click', () => {
  if (!cachedInsta360Sync?.pipeline_start_s || !cachedInsta360Sync?.pipeline_end_s) return
  kfEditor.setCaptureStart(cachedInsta360Sync.pipeline_start_s)
  kfEditor.setCaptureEnd(cachedInsta360Sync.pipeline_end_s)
  // Enable keyframe mode so timeline is visible
  if (!kfEnabled.checked) {
    kfEnabled.checked = true
    kfEditor.setEnabled(true)
    kfTimeline.style.display = 'block'
  }
  kfImportStatus.textContent = `Range set: ${cachedInsta360Sync.pipeline_start_s.toFixed(1)}–${cachedInsta360Sync.pipeline_end_s.toFixed(1)}s`
  console.log(`Insta360 capture range: ${cachedInsta360Sync.pipeline_start_s.toFixed(2)}–${cachedInsta360Sync.pipeline_end_s.toFixed(2)}s`)
})

kfImportKfs.addEventListener('click', () => {
  const kfs = cachedInsta360Sync?.keyframes
  if (!kfs?.length) return
  if (!scene) { kfImportStatus.textContent = 'Scene not ready'; return }
  // Phase 1: import timing only — use current inertial camera position.
  // Phase 2 (future): map Insta360 pan/tilt/fov/distance to Three.js orbit:
  //   pan → spherical theta (with reference-frame offset)
  //   tilt → spherical phi (elevation)
  //   fov → PerspectiveCamera.zoom (inverse relationship)
  //   distance → orbit radius
  // See docs/INSTA360-DATA-SYNC.md "Coordinate System Mapping" for details.
  const pos = scene.getCameraPosition()
  const zoom = scene.getCameraZoom()
  let count = 0
  for (const kf of kfs) {
    if (typeof kf.pipeline_time_s === 'number') {
      kfEditor.addInertialKeyframe(kf.pipeline_time_s, pos, zoom)
      count++
    }
  }
  // Enable keyframe mode so timeline is visible
  if (!kfEnabled.checked) {
    kfEnabled.checked = true
    kfEditor.setEnabled(true)
    kfTimeline.style.display = 'block'
  }
  kfImportStatus.textContent = `Imported ${count} inertial keyframes (timing only)`
  console.log(`Imported ${count} Insta360 keyframes as inertial (timing only)`)
})

// ─── Session State for Playwright Capture ───────────────────────────────────

const axisHelperMode = document.getElementById('axis-helper-mode') as HTMLSelectElement

/** Build complete session state for Playwright automation */
function buildCaptureSession(): CaptureSessionState | null {
  if (!result) return null
  const bounds = captureHandler
    ? (() => { 
        // Trigger getFlightBounds through capture handler's logic
        const pts = result!.points
        let startTime = pts[0]?.processed.t ?? 0
        let endTime = pts[pts.length - 1]?.processed.t ?? 0
        if (kfEditor.captureStart != null) startTime = kfEditor.captureStart
        if (kfEditor.captureEnd != null) endTime = kfEditor.captureEnd
        return { startTime, endTime }
      })()
    : { startTime: 0, endTime: result.duration }

  const frameRate = 60
  const totalFrames = Math.ceil((bounds.endTime - bounds.startTime) * frameRate)

  return {
    version: 1,
    trackPath: loadedTrackPath ?? '',
    sensorPath: loadedSensorPath,
    headTimeOffset: parseFloat(headTimeOffset.value) || 0,
    trimOffset: parseFloat(trimSlider.value) || 10,
    rollMethod: rollSelect.value,
    displayOverlays: overlayToggle.checked,
    controlSolver: controlSolverToggle.checked,
    axisHelpers: axisHelperMode.value,
    keyframeEnabled: kfEnabled.checked,
    keyframes: JSON.parse(kfEditor.toJSON()),
    capture: {
      frameRate,
      startTime: bounds.startTime,
      endTime: bounds.endTime,
      totalFrames,
      flightDate: '',
    },
  }
}

// Expose session state on window for Playwright to read
;(window as any).__getCaptureSession = buildCaptureSession

// ─── URL-based Auto-Load (for Playwright automation) ────────────────────────

async function loadFromURL(trackPath: string) {
  const resp = await fetch(`/${trackPath}`)
  if (!resp.ok) { console.error(`Failed to fetch ${trackPath}: ${resp.status}`); return }
  const text = await resp.text()
  const file = new File([text], trackPath.split('/').pop() || 'TRACK.CSV', { type: 'text/csv' })
  loadedTrackPath = trackPath
  await loadFile(file)
}

async function loadSensorFromURL(sensorPath: string) {
  console.log(`loadSensorFromURL: fetching /${sensorPath}`)
  const resp = await fetch(`/${sensorPath}`)
  if (!resp.ok) { console.error(`Failed to fetch ${sensorPath}: ${resp.status}`); return }
  const text = await resp.text()
  console.log(`loadSensorFromURL: got ${text.length} bytes, parsing...`)
  const { points, gpsStartIndex } = parseHeadSensorCSV(text)
  console.log(`loadSensorFromURL: ${points.length} points, gpsStartIndex=${gpsStartIndex}, scene=${!!scene}, result=${!!result}`)
  if (points.length === 0) { headSensorStatus.textContent = 'Loaded but 0 points parsed'; return }

  loadedSensorPath = sensorPath
  let offset = 0
  if (gpsStartIndex >= 0 && result) {
    const sensorGpsTimeMs = points[gpsStartIndex].gpsTimeMs
    const pipelineEpochMs = result.startEpochMs ?? NaN
    if (!isNaN(sensorGpsTimeMs) && !isNaN(pipelineEpochMs)) {
      offset = points[gpsStartIndex].t - (sensorGpsTimeMs - pipelineEpochMs) / 1000
    } else {
      offset = points[gpsStartIndex].t
    }
  }
  headTimeOffset.value = offset.toFixed(2)
  scene?.setHeadSensorData(points, offset)
  bodyScene?.setHeadSensorData(points, offset)
  headSensorStatus.textContent = `${points.length} pts (${points[0].t.toFixed(1)}s → ${points[points.length - 1].t.toFixed(1)}s) offset=${offset.toFixed(1)}s`
  console.log(`Sensor loaded from URL: ${sensorPath}, ${points.length} pts, offset=${offset.toFixed(2)}s`)
}

/** Apply a capture session state (from Playwright CAPTURE_INIT or URL param) */
async function applyCaptureSession(state: CaptureSessionState) {
  // Load track (awaits full pipeline)
  if (state.trackPath) {
    await loadFromURL(state.trackPath)
  }

  // Apply UI settings
  trimSlider.value = String(state.trimOffset)
  trimSlider.dispatchEvent(new Event('input'))
  rollSelect.value = state.rollMethod
  rollSelect.dispatchEvent(new Event('change'))
  overlayToggle.checked = state.displayOverlays
  overlayToggle.dispatchEvent(new Event('change'))
  controlSolverToggle.checked = state.controlSolver ?? false
  controlSolverToggle.dispatchEvent(new Event('change'))
  axisHelperMode.value = state.axisHelpers
  axisHelperMode.dispatchEvent(new Event('change'))

  // Load keyframes
  kfEditor.fromJSON(JSON.stringify(state.keyframes))
  kfEnabled.checked = state.keyframeEnabled
  kfEnabled.dispatchEvent(new Event('change'))

  // Load sensor data
  if (state.sensorPath) {
    await loadSensorFromURL(state.sensorPath)
    headTimeOffset.value = String(state.headTimeOffset)
  }

  console.log('Capture session applied', state)
  ;(window as any).__sessionReady = true
}

// Expose for Playwright
;(window as any).__applyCaptureSession = applyCaptureSession

// ─── URL Param Auto-Configuration ───────────────────────────────────────────
// Example: /gps?track=07-29-25/TRACK.CSV&sensor=07-29-25/fused.csv&trim=10&roll=blended&overlays=0&axis=none&kf=1
// Or full session: /gps?session=<base64 JSON>

;(async () => {
  const urlParams = new URLSearchParams(window.location.search)
  const autoSession = urlParams.get('session')

  if (autoSession) {
    try {
      const state = JSON.parse(atob(autoSession)) as CaptureSessionState
      await applyCaptureSession(state)
    } catch (e) {
      console.error('Failed to parse session param:', e)
    }
    return
  }

  // Individual URL params
  const autoTrack = urlParams.get('track')
  if (!autoTrack) return

  // 1. Load track (awaits pipeline completion)
  await loadFromURL(autoTrack)

  // 2. Apply UI settings from URL params
  const trim = urlParams.get('trim')
  if (trim != null) {
    trimSlider.value = trim
    trimSlider.dispatchEvent(new Event('input'))
  }

  const roll = urlParams.get('roll')
  if (roll) {
    rollSelect.value = roll
    rollSelect.dispatchEvent(new Event('change'))
  }

  const overlays = urlParams.get('overlays')
  if (overlays != null) {
    overlayToggle.checked = overlays !== '0' && overlays !== 'false'
    overlayToggle.dispatchEvent(new Event('change'))
  }

  const solver = urlParams.get('solver')
  if (solver != null) {
    controlSolverToggle.checked = solver !== '0' && solver !== 'false'
    controlSolverToggle.dispatchEvent(new Event('change'))
  }

  const axis = urlParams.get('axis')
  if (axis) {
    axisHelperMode.value = axis
    axisHelperMode.dispatchEvent(new Event('change'))
  }

  const kfMode = urlParams.get('kf')
  if (kfMode != null) {
    kfEnabled.checked = kfMode !== '0' && kfMode !== 'false'
    kfEnabled.dispatchEvent(new Event('change'))
  }

  // 3. Load fused CSV sensor — looks in same folder as track by default
  const sensorParam = urlParams.get('sensor')
  if (sensorParam) {
    await loadSensorFromURL(sensorParam)
  } else {
    // Auto-detect: look for fused CSV in same folder as track
    const trackFolder = autoTrack.substring(0, autoTrack.lastIndexOf('/'))
    if (trackFolder) {
      const candidates = ['SENSOR_fused_fusion.csv', 'fused.csv', 'sensor_fused.csv']
      let found = false
      for (const name of candidates) {
        try {
          console.log(`Auto-detect sensor: trying /${trackFolder}/${name}`)
          const testResp = await fetch(`/${trackFolder}/${name}`, { method: 'HEAD' })
          console.log(`Auto-detect sensor: ${name} → ${testResp.status} (content-type: ${testResp.headers.get('content-type')})`)
          if (testResp.ok) {
            // Verify it's not a fallback HTML page
            const ct = testResp.headers.get('content-type') || ''
            if (ct.includes('html')) {
              console.log(`Auto-detect sensor: ${name} returned HTML (SPA fallback), skipping`)
              continue
            }
            console.log(`Auto-detected ${name} in ${trackFolder}/`)
            await loadSensorFromURL(`${trackFolder}/${name}`)
            found = true
            break
          }
        } catch (e) { console.log(`Auto-detect sensor: ${name} failed`, e) }
      }
      if (!found) console.log('Auto-detect sensor: no fused CSV found in', trackFolder)
    }
  }

  // 4. Auto-detect camera head data from sync-result.json
  {
    const trackFolder = autoTrack.substring(0, autoTrack.lastIndexOf('/'))
    if (trackFolder) {
      const loaded = await loadCameraFromSyncResult(trackFolder)
      if (loaded) console.log('Camera head data auto-loaded from sync-result.json')
      else console.log('No camera head data in sync-result.json (or no sync-result.json)')
    }
  }

  // 5. Load keyframes from URL param (base64 JSON) or file
  const kfData = urlParams.get('keyframes')
  if (kfData) {
    try {
      kfEditor.fromJSON(atob(kfData))
    } catch (e) {
      console.error('Failed to parse keyframes param:', e)
    }
  }

  // Apply keyframes at initial position (t=0)
  if (kfEditor.isEnabled && kfEditor.inertialKeyframes.length > 0) {
    // Use first keyframe time as initial application point
    applyKeyframeCameras(kfEditor.inertialKeyframes[0].t)
  }

  ;(window as any).__sessionReady = true
  console.log('URL auto-configuration complete')
})()
