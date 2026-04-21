/**
 * ekf-runner.ts — Runs the orientation EKF over GPS pipeline output.
 *
 * Takes GPSPipelinePoint[] (from SG pipeline) and feeds each point
 * as a measurement into the EKF. Returns an array of OrientationEstimate
 * at each GPS timestep, plus the configured EKF instance for predictAt()
 * queries during replay.
 *
 * This is the glue between `src/gps/` and `src/kalman/`.
 */

import { OrientationEKF } from './orientation-ekf.js'
import { createAeroAdapter, type AeroAdapterConfig } from './aero-adapter.js'
import type { OrientationMeasurement, OrientationEstimate, OrientationKalmanConfig } from './types.js'
import { DEFAULT_CONFIG } from './types.js'
import type { GPSPipelinePoint } from '../gps/types.js'

// ============================================================================
// Runner Configuration
// ============================================================================

export interface EKFRunnerConfig {
  /** Aero adapter config (segments, CG, height, inertia) */
  aero: AeroAdapterConfig
  /** Kalman filter tuning (optional — uses defaults) */
  kalman?: Partial<OrientationKalmanConfig>
  /** Enable step smoothing (default true) */
  stepSmoothing?: boolean
}

// ============================================================================
// Runner Result
// ============================================================================

export interface EKFRunnerResult {
  /** Per-GPS-sample estimates (after each update) */
  estimates: OrientationEstimate[]
  /** The live EKF instance — call predictAt(t) for interpolated output */
  ekf: OrientationEKF
}

// ============================================================================
// Pipeline → Measurement conversion
// ============================================================================

/**
 * Convert a GPSPipelinePoint to an OrientationMeasurement.
 * Uses SG-smoothed Euler angles + LS-derived body rates from the pipeline.
 */
function toMeasurement(pt: GPSPipelinePoint): OrientationMeasurement | null {
  const { aero, processed, bodyRates } = pt

  // Need body rates to form a complete measurement
  if (!bodyRates) return null

  // Pipeline body rates are in deg/s — convert to rad/s
  const DEG2RAD = Math.PI / 180

  return {
    t: processed.t,
    phi: aero.roll,           // radians (from extractAero)
    theta: aero.theta,        // radians (composed: γ + α·cos(φ))
    psi: aero.psi,            // radians (heading with β correction)
    p: bodyRates.p * DEG2RAD, // deg/s → rad/s
    q: bodyRates.q * DEG2RAD,
    r: bodyRates.r * DEG2RAD,
    alpha: aero.aoa,          // radians (from extractAero segment model match)
  }
}

// ============================================================================
// Main Runner
// ============================================================================

/**
 * Run the orientation EKF over a full GPS pipeline result.
 *
 * Usage:
 *   const pipelinePoints = processGNSSData(gnss, pipelineConfig)
 *   const { estimates, ekf } = runOrientationEKF(pipelinePoints, {
 *     aero: {
 *       segments: a5segmentsContinuous.aeroSegments!,
 *       cgMeters: { x: 0, y: 0, z: 0 },
 *       height: 1.875,
 *       inertia: vehicleDef.mass.inertia,
 *     },
 *   })
 *
 *   // Query between samples for smooth replay:
 *   const smooth = ekf.predictAt(t)
 */
export function runOrientationEKF(
  points: GPSPipelinePoint[],
  config: EKFRunnerConfig,
): EKFRunnerResult {
  // Build filter
  const kalmanConfig = { ...DEFAULT_CONFIG, ...config.kalman }
  const ekf = new OrientationEKF(kalmanConfig)
  ekf.stepSmoothing = config.stepSmoothing ?? true

  // Wire aero model
  const adapter = createAeroAdapter(config.aero)
  ekf.setAeroModel(adapter)

  const estimates: OrientationEstimate[] = []

  for (const pt of points) {
    const meas = toMeasurement(pt)
    if (!meas) {
      // No body rates yet — skip (early pipeline points)
      estimates.push(placeholderEstimate(pt.processed.t))
      continue
    }

    // Set airspeed and rho for this timestep (used by aero model in prediction)
    ekf.setAirspeed(pt.processed.airspeed)
    ekf.setRho(pt.processed.rho)

    // Feed measurement
    ekf.update(meas)

    // Query at measurement time to get post-update estimate
    const est = ekf.predictAt(meas.t)
    estimates.push(est ?? placeholderEstimate(meas.t))
  }

  return { estimates, ekf }
}

/**
 * Placeholder for points where the filter hasn't initialized yet.
 */
function placeholderEstimate(t: number): OrientationEstimate {
  return {
    t,
    phi: 0, theta: 0, psi: 0,
    p: 0, q: 0, r: 0,
    pDot: 0, qDot: 0, rDot: 0,
    alpha: 0,
    deltaPitch: 0, deltaRoll: 0, deltaYaw: 0,
  }
}
