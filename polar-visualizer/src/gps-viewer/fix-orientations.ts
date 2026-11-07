/**
 * fix-orientations.ts — Phase-corrected orientation pass.
 *
 * After the main pipeline + exit/deploy detection, this pass produces
 * corrected Euler angles for each point based on the flight phase,
 * then re-derives body rates and angular accelerations from the
 * corrected angle series.
 *
 * Phases:
 *   Ground (before lean): roll=0, pitch=π/2, heading=flyingIndex heading
 *   Exit (lean→settled): lean to horizontal, dive, airspeed-driven trim (exit-pose.ts)
 *   Freefall/wingsuit: pass-through from aero extraction
 *   Deployment (pcToss→fullInflation+2s): slerp from frozen wingsuit angles
 *     to canopy hang angles (mirrors gps-scene.ts deployment rendering)
 *   Canopy flight: canopy estimator angles (if available), else aero
 *
 * The fixed angles are stored in pt.fixed and do NOT overwrite the
 * original pt.aero values.
 */

import type { GPSPipelinePoint, FixedOrientation } from '../gps/types'
import type { ExitEstimate } from './exit-detector'
import { computeExitPose, sourceAngles, angleLerp } from './exit-pose'
import type { DeployReplayTimeline } from './deploy-replay'
import type { CanopyState } from './canopy-estimator'
import { calculateDerivative, unwrapAngles } from '../gps/math-utils'
import { applySGFilterMultiPass } from '../gps/sg-filter'
import type { SGWindowSize } from '../gps/sg-coefficients'
import { applyInverseDKE } from '../gps/wse'

export interface FixOrientationsConfig {
  exitEstimate: ExitEstimate | null
  deployTimeline: DeployReplayTimeline | null
  canopyStates: (CanopyState | null)[]
  /** LS derivative window size (samples) — matches pipeline accelWindowSize */
  accelWindowSize: number
  /** SG smoothing windows — matches pipeline smoothingWindows */
  smoothingWindows?: SGWindowSize[]
}

/**
 * Populate pt.fixed for every point in the array.
 * Must be called after exit detection, deploy detection, and canopy estimation.
 */
export function fixOrientations(
  points: GPSPipelinePoint[],
  config: FixOrientationsConfig,
): void {
  if (points.length === 0) return

  const { exitEstimate, deployTimeline, canopyStates } = config

  // Preserve the original aero angles (writeback overwrites pt.aero, and this
  // pass can run more than once on the same points).
  for (const pt of points) {
    if (!pt.rawAngles) pt.rawAngles = { roll: pt.aero.roll, theta: pt.aero.theta, psi: pt.aero.psi }
  }

  // ── Phase 1: Assign corrected Euler angles per-point ──

  // Pre-compute stable references
  const flyingIdx = exitEstimate
    ? Math.min(exitEstimate.flyingIndex, points.length - 1)
    : 0
  const flyingHeading = sourceAngles(points[flyingIdx]).psi

  // Deploy timing
  const pcTossIdx = deployTimeline?.timing.pcTossIndex ?? null
  const lsIdx = deployTimeline?.timing.lineStretchIndex ?? null
  const fullFlightIdx = deployTimeline?.timing.fullFlightIndex ?? null
  const TRANSITION_TAIL = 2.0 // seconds after line stretch

  // Frozen wingsuit pose at PC toss
  let frozenRoll = 0, frozenTheta = 0, frozenPsi = 0
  if (pcTossIdx !== null && pcTossIdx < points.length) {
    const pcSrc = sourceAngles(points[pcTossIdx])
    frozenRoll = pcSrc.roll
    frozenTheta = pcSrc.theta
    frozenPsi = pcSrc.psi
  }

  for (let i = 0; i < points.length; i++) {
    const pt = points[i]
    const src = sourceAngles(pt)
    const mode = pt.flightMode?.mode ?? 0

    let roll: number, theta: number, psi: number

    // Check which phase we're in
    const isGround = mode === 1
    const exitPose = exitEstimate ? computeExitPose(points, exitEstimate, i) : null
    const inDeployTransition = pcTossIdx !== null && lsIdx !== null
      && i >= pcTossIdx
      && (fullFlightIdx !== null ? i <= fullFlightIdx : true)

    if (exitPose) {
      // Exit: lean → push-off → airspeed-driven trim (see exit-pose.ts)
      roll = exitPose.roll
      theta = exitPose.theta
      psi = exitPose.psi
    } else if (isGround) {
      // Ground: standing upright, stable heading
      roll = 0
      theta = Math.PI / 2
      psi = flyingHeading
    } else if (inDeployTransition && pcTossIdx !== null && lsIdx !== null) {
      // Deployment: lerp from frozen wingsuit pose toward canopy hang
      const pcTime = points[pcTossIdx].processed.t
      const lsTime = points[Math.min(lsIdx, points.length - 1)].processed.t
      const endTime = lsTime + TRANSITION_TAIL
      const elapsed = pt.processed.t - pcTime
      const totalDuration = endTime - pcTime
      const t = totalDuration > 0 ? Math.max(0, Math.min(1, elapsed / totalDuration)) : 1
      const s = t * t * (3 - 2 * t) // smoothstep

      // Target: canopy state if available, else frozen heading with standing pitch
      const cs = canopyStates[i]
      if (cs && cs.valid) {
        roll = angleLerp(frozenRoll, cs.phi, s)
        theta = angleLerp(frozenTheta, cs.theta, s)
        psi = angleLerp(frozenPsi, cs.psi, s)
      } else {
        roll = angleLerp(frozenRoll, 0, s)
        theta = angleLerp(frozenTheta, Math.PI / 2, s)
        psi = frozenPsi
      }
    } else if (mode >= 5 && mode <= 7) {
      // Canopy flight / landing: use canopy estimator if valid
      const cs = canopyStates[i]
      if (cs && cs.valid) {
        roll = cs.phi
        theta = cs.theta
        psi = cs.psi
      } else {
        roll = src.roll
        theta = src.theta
        psi = src.psi
      }
    } else {
      // Freefall / wingsuit: pass through aero extraction
      roll = src.roll
      theta = src.theta
      psi = src.psi
    }

    // Store angles (rates filled in Phase 2)
    pt.fixed = {
      roll, theta, psi,
      p: 0, q: 0, r: 0,
      pDot: 0, qDot: 0, rDot: 0,
    }
  }

  // ── Phase 2: Populate rates and accelerations ──
  // Re-derive body rates from the full fixed angle series via
  // SG-smooth + LS derivative + inverse DKE (same process as original pipeline).

  const fixedPhi = points.map(p => p.fixed!.roll)
  const fixedTheta = points.map(p => p.fixed!.theta)
  const fixedPsi = points.map(p => p.fixed!.psi)

  const unwrappedPsi = unwrapAngles(fixedPsi)
  const unwrappedPhi = unwrapAngles(fixedPhi)

  const sgWindows = config.smoothingWindows ?? [21, 11, 7] as SGWindowSize[]
  const smoothPhi   = applySGFilterMultiPass(unwrappedPhi, sgWindows, v => v)
  const smoothTheta = applySGFilterMultiPass(fixedTheta, sgWindows, v => v)
  const smoothPsi   = applySGFilterMultiPass(unwrappedPsi, sgWindows, v => v)

  const timedAngles = points.map((p, i) => ({
    t: p.processed.t,
    phi: smoothPhi[i],
    theta: smoothTheta[i],
    psi: smoothPsi[i],
  }))
  const phiDots = calculateDerivative(timedAngles, config.accelWindowSize, d => d.t, d => d.phi)
  const thetaDots = calculateDerivative(timedAngles, config.accelWindowSize, d => d.t, d => d.theta)
  const psiDots = calculateDerivative(timedAngles, config.accelWindowSize, d => d.t, d => d.psi)
  const derivedRates = applyInverseDKE(smoothPhi, smoothTheta, phiDots, thetaDots, psiDots)

  // Also derive accelerations from the re-derived rates
  const timedRates = points.map((p, i) => ({
    t: p.processed.t,
    p: derivedRates[i].p,
    q: derivedRates[i].q,
    r: derivedRates[i].r,
  }))
  const pDots = calculateDerivative(timedRates, config.accelWindowSize, d => d.t, d => d.p)
  const qDots = calculateDerivative(timedRates, config.accelWindowSize, d => d.t, d => d.q)
  const rDots = calculateDerivative(timedRates, config.accelWindowSize, d => d.t, d => d.r)

  for (let i = 0; i < points.length; i++) {
    // applyInverseDKE already returns deg/s; derivative of deg/s → deg/s²
    points[i].fixed!.p = derivedRates[i].p
    points[i].fixed!.q = derivedRates[i].q
    points[i].fixed!.r = derivedRates[i].r
    points[i].fixed!.pDot = pDots[i]
    points[i].fixed!.qDot = qDots[i]
    points[i].fixed!.rDot = rDots[i]
  }
}
