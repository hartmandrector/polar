/**
 * GPS Flight Viewer — Main Entry Point
 *
 * Drag-and-drop a FlySight TRACK.CSV → pipeline → charts + replay.
 */

import { processGPSFile, type PipelineResult } from '../gps/gps-pipeline'
import { buildSystemPolarTable, buildPolarEvaluator } from './gps-polar-table'
import { GPSCharts } from './gps-charts'
import { GPSReplay } from './gps-replay'
import { GPSScene } from './gps-scene'
import { BodyFrameScene } from './body-frame-scene'
import { MomentInset } from './moment-inset'
import { InertialLegend, BodyFrameLegend } from './scene-legend'
import { CaptureHandler } from './capture-handler'
import { parseHeadSensorCSV } from './head-sensor'
import { a5segmentsContinuous, ibexulContinuous } from '../polar/polar-data'
import { computeCenterOfMass, computeInertia } from '../polar/inertia'
import { solveControlInputs, type ControlInversionConfig } from './control-solver'
import { runOrientationEKF, type EKFRunnerResult } from '../kalman/index'
import { estimateCanopyBatch } from './canopy-estimator'
import { detectDeployment } from './deploy-detector'
import { buildDeployReplayTimeline, type DeployReplayTimeline } from './deploy-replay'

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

  // Build polar evaluator for binary search AOA matching
  const polarEvaluator = buildPolarEvaluator()

  // Run pipeline
  const t0 = performance.now()
  result = processGPSFile(text, {
    polarEvaluator,
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
    rho: 1.225,
    inertia,
  })
  bodyScene.setAeroConfig({
    segments: polar.aeroSegments ?? [],
    cgMeters,
    height: aeroRef,
    mass: polar.m,
    rho: 1.225,
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
    rho: 1.225,
    inertia: canopyInertia,
  })
  bodyScene.setCanopyAeroConfig({
    segments: canopyPolar.aeroSegments ?? [],
    cgMeters: canopyCg,
    height: canopyMassRef,
    mass: canopyPolar.m,
    rho: 1.225,
    inertia: canopyInertia,
  })

  // Batch-solve control inputs for all points (Pass 2)
  const solverCfg: ControlInversionConfig = {
    segments: polar.aeroSegments ?? [],
    cgMeters,
    height: aeroRef,
    mass: polar.m,
    inertia,
    rho: 1.225,
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
      rho: 1.225,
    },
  })
  const ekfElapsed = ((performance.now() - ekfT0) / 1000).toFixed(3)
  console.log(`Orientation EKF: ${ekfResult.estimates.length} points in ${ekfElapsed}s`)

  // Wire EKF into 3D scenes for physics-interpolated orientation
  scene.setEKF(ekfResult.ekf)
  bodyScene.setEKF(ekfResult.ekf)

  // ── Canopy estimation ──
  const canopyStates = estimateCanopyBatch(result.points)
  const validCount = canopyStates.filter(s => s.valid).length
  console.log(`Canopy estimator: ${validCount}/${canopyStates.length} valid states`)
  scene.setCanopyStates(canopyStates)
  bodyScene.setCanopyStates(canopyStates)

  // ── Deployment detection + replay timeline ──
  const deployDetection = detectDeployment(result.points)
  const deployTimeline = buildDeployReplayTimeline(result.points, canopyStates, deployDetection)
  if (deployDetection) {
    console.log(`Deploy detected: lineStretch t=${deployDetection.lineStretchTime.toFixed(2)}s peak=${deployDetection.peakDecel.toFixed(1)}m/s² conf=${deployDetection.confidence.toFixed(2)}`)
    if (deployTimeline.timingSeconds.fullFlightTime != null) {
      console.log(`  Full flight at t=${deployTimeline.timingSeconds.fullFlightTime.toFixed(2)}s, inflation=${deployTimeline.timingSeconds.inflationDuration?.toFixed(2)}s`)
    }
  }
  scene.setDeployTimeline(deployTimeline)
  bodyScene.setDeployTimeline(deployTimeline)
  currentDeployTimeline = deployTimeline

  // Initialize replay
  if (!replay) {
    replay = new GPSReplay(result.points, (index, t, fraction) => {
      charts?.setCursor(index)
      scene?.setIndex(index, fraction)
      bodyScene?.setIndex(index, fraction)
      updateReadout(index)
      updateMomentInset()
      updateLegends(index)
      updateTransport(t, dur)
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
        updateReadout(index)
        updateMomentInset()
        updateLegends(index)
      },
      getFlightBounds: () => {
        if (!result) return { startTime: 0, endTime: 0 }
        const pts = result.points
        // Find first freefall/wingsuit frame and last landing frame
        let startTime = pts[0]?.processed.t ?? 0
        let endTime = pts[pts.length - 1]?.processed.t ?? 0
        for (const p of pts) {
          if (p.flightMode && p.flightMode.mode >= 3) { // WINGSUIT or later
            startTime = p.processed.t
            break
          }
        }
        for (let i = pts.length - 1; i >= 0; i--) {
          if (pts[i].flightMode && pts[i].flightMode!.mode <= 7) {
            endTime = pts[i].processed.t
            break
          }
        }
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
  charts?.setCursor(idx)
  scene?.setIndex(idx)
  bodyScene?.setIndex(idx)
  updateReadout(idx)
  updateMomentInset()
  updateLegends(idx)
  updateReadout(idx)
  const t = result.points[idx]?.processed.t ?? 0
  updateTransport(t, result.duration)
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
  if (!momentInset || !scene) return
  const s = scene.lastOverlayState
  // Use wingsuit overlay by default; canopy when wingsuit moments are empty
  if (s.moments) {
    momentInset.update(s.moments, s.controls, s.converged)
  } else if (s.canopyMoments) {
    momentInset.update(s.canopyMoments, s.canopyControls, s.canopyConverged)
  }
}

function updateLegends(index: number) {
  if (!result) return
  const pt = result.points[index]
  if (!pt) return

  inertialLegend?.update(pt)

  if (bodyLegend && scene) {
    const s = scene.lastOverlayState
    bodyLegend.update({
      pt,
      converged: s.converged,
      controlPitch: s.controls.pitch,
      controlRoll: s.controls.roll,
      controlYaw: s.controls.yaw,
    })
  }
}

// ─── Readout ────────────────────────────────────────────────────────────────

const readoutEl = document.getElementById('readout')!

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
    <div class="section">Control Solver</div>
    <div class="row"><span class="label">Converged</span><span class="value" style="color:${p.solvedControls?.converged ? '#44ff66' : '#ff4444'}">${p.solvedControls?.converged ? 'Yes' : 'No'}</span></div>
    <div class="row"><span class="label">Pitch</span><span class="value">${(p.solvedControls?.pitchThrottle ?? 0).toFixed(3)}</span></div>
    <div class="row"><span class="label">Roll</span><span class="value">${(p.solvedControls?.rollThrottle ?? 0).toFixed(3)}</span></div>
    <div class="row"><span class="label">Yaw</span><span class="value">${(p.solvedControls?.yawThrottle ?? 0).toFixed(3)}</span></div>
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
  const points = parseHeadSensorCSV(text)

  if (points.length === 0) {
    headSensorStatus.textContent = 'No valid data found'
    return
  }

  const offset = parseFloat(headTimeOffset.value) || 0
  scene?.setHeadSensorData(points, offset)
  bodyScene?.setHeadSensorData(points, offset)
  headSensorStatus.textContent = `${points.length} pts (${points[0].t.toFixed(1)}s → ${points[points.length - 1].t.toFixed(1)}s)`
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
