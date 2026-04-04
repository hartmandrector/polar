/**
 * redecompose-canopy.ts — Canopy-phase re-decomposition pass.
 *
 * After the initial GPS pipeline (wingsuit aero model), canopy estimator,
 * and deploy timeline have all run, this pass overwrites the aero extraction
 * and body rates for canopy-phase points (DEPLOY / CANOPY / LANDING) with
 * values derived from the canopy estimator's orientation.
 *
 * What changes:
 *   - aero.cl / aero.cd — rescaled from kl/kd using canopy reference area
 *   - aero.aoa — from canopy estimator
 *   - aero.roll / theta / psi — from canopy estimator (smoothed)
 *   - aero.aoaResidual — cleared (no polar match under canopy)
 *   - bodyRates — re-derived via inverse DKE from canopy angles
 *   - solvedControls — cleared (wingsuit solver has no meaning)
 *
 * What stays:
 *   - aero.kl / aero.kd — area-independent, valid for all phases
 *   - aero.gamma — flight path angle from velocity (independent of vehicle)
 *   - aero.sustainedX/Y/Mag — derived from kl/kd, area-independent
 *   - processed.* — all GPS-derived quantities unchanged
 */

import type { GPSPipelinePoint, BodyRates } from '../gps/types'
import type { CanopyState } from './canopy-estimator'
import type { DeployReplayTimeline } from './deploy-replay'
import { applyInverseDKE } from '../gps/wse'
import { calculateDerivative } from '../gps/math-utils'

const GRAVITY = 9.80665
const R2D = 180 / Math.PI

export interface CanopyRedecomposeConfig {
  /** Canopy reference area [m²] (e.g. 20.44 for Ibex UL 220) */
  canopySRef: number
  /** Total system mass [kg] (pilot + gear + canopy) */
  totalMass: number
  /** LS derivative window size (should match pipeline config) */
  accelWindowSize: number
}

/**
 * In-place re-decomposition of canopy-phase points.
 *
 * Overwrites aero extraction and body rates for all points where
 * the canopy estimator produced a valid state AND the flight mode
 * is DEPLOY (5), CANOPY (6), or LANDING (7).
 *
 * @param points         Pipeline output points (mutated in place)
 * @param canopyStates   Canopy estimator output (1:1 with points)
 * @param deployTimeline Deploy replay timeline (for transition context)
 * @param config         Canopy reference area and mass
 * @returns Number of points re-decomposed
 */
export function redecomposeCanopyPhases(
  points: GPSPipelinePoint[],
  canopyStates: CanopyState[],
  deployTimeline: DeployReplayTimeline | null,
  config: CanopyRedecomposeConfig,
): number {
  const { canopySRef, totalMass, accelWindowSize } = config
  const n = points.length

  // k factor for canopy CL/CD: CL = kl * g / k, where k = ½ρS/m
  // ρ varies per point, so compute per-point

  // ── Step 1: Identify canopy-phase points and overwrite angles ──
  const isCanopyPhase = new Uint8Array(n)  // 1 = redecompose this point

  for (let i = 0; i < n; i++) {
    const mode = points[i].flightMode?.mode ?? 0
    const cs = canopyStates[i]

    // DEPLOY=5, CANOPY=6, LANDING=7, with valid canopy state
    if (mode >= 5 && mode <= 7 && cs?.valid) {
      isCanopyPhase[i] = 1

      const pt = points[i]
      const rho = pt.processed.rho
      const k = 0.5 * rho * canopySRef / totalMass

      // Overwrite CL/CD using canopy reference area (kl/kd unchanged)
      pt.aero.cl = k > 1e-12 ? pt.aero.kl * GRAVITY / k : 0
      pt.aero.cd = k > 1e-12 ? pt.aero.kd * GRAVITY / k : 0

      // Overwrite angles from canopy estimator
      pt.aero.roll = cs.phi
      pt.aero.theta = cs.theta
      pt.aero.psi = cs.psi
      pt.aero.aoa = cs.aoa

      // Clear wingsuit-specific fields
      pt.aero.aoaResidual = 0
      pt.solvedControls = undefined
    }
  }

  // ── Step 2: Re-derive body rates for canopy-phase points ──
  // Find contiguous runs of canopy-phase points, compute derivatives
  // and inverse DKE for each run independently.
  let runStart = -1
  for (let i = 0; i <= n; i++) {
    const inRun = i < n && isCanopyPhase[i] === 1
    if (inRun && runStart < 0) {
      runStart = i
    } else if (!inRun && runStart >= 0) {
      // Process run [runStart, i)
      recomputeBodyRatesForRun(points, runStart, i, accelWindowSize)
      runStart = -1
    }
  }

  let count = 0
  for (let i = 0; i < n; i++) {
    if (isCanopyPhase[i]) count++
  }
  return count
}

/**
 * Recompute body rates for a contiguous run of canopy-phase points.
 * Uses LS derivative on the (already overwritten) canopy Euler angles,
 * then inverse DKE to get p, q, r.
 */
function recomputeBodyRatesForRun(
  points: GPSPipelinePoint[],
  start: number,
  end: number,
  windowSize: number,
): void {
  const len = end - start
  if (len < 3) return  // need at least 3 points for derivative

  // Build timed angle arrays
  const timedAngles = new Array(len)
  for (let j = 0; j < len; j++) {
    const pt = points[start + j]
    timedAngles[j] = {
      t: pt.processed.t,
      phi: pt.aero.roll,
      theta: pt.aero.theta,
      psi: pt.aero.psi,
    }
  }

  // LS derivatives of canopy Euler angles
  const phiDots = calculateDerivative(timedAngles, windowSize, d => d.t, d => d.phi)
  const thetaDots = calculateDerivative(timedAngles, windowSize, d => d.t, d => d.theta)
  const psiDots = calculateDerivative(timedAngles, windowSize, d => d.t, d => d.psi)

  // Inverse DKE: Euler rates → body rates
  const phi = timedAngles.map((d: { phi: number }) => d.phi)
  const theta = timedAngles.map((d: { theta: number }) => d.theta)
  const bodyRates = applyInverseDKE(phi, theta, phiDots, thetaDots, psiDots)

  // LS angular acceleration from body rates
  const timedRates = bodyRates.map((br, j) => ({
    t: timedAngles[j].t,
    p: br.p * Math.PI / 180,  // back to rad/s for derivative
    q: br.q * Math.PI / 180,
    r: br.r * Math.PI / 180,
  }))
  const pDots = calculateDerivative(timedRates, windowSize, d => d.t, d => d.p)
  const qDots = calculateDerivative(timedRates, windowSize, d => d.t, d => d.q)
  const rDots = calculateDerivative(timedRates, windowSize, d => d.t, d => d.r)

  // Write back
  for (let j = 0; j < len; j++) {
    const pt = points[start + j]
    pt.bodyRates = {
      p: bodyRates[j].p,
      q: bodyRates[j].q,
      r: bodyRates[j].r,
      pDot: pDots[j] * R2D,
      qDot: qDots[j] * R2D,
      rDot: rDots[j] * R2D,
      phiDot: phiDots[j] * R2D,
      thetaDot: thetaDots[j] * R2D,
      psiDot: psiDots[j] * R2D,
    }
  }
}
