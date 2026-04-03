/**
 * deploy-detector.ts — Detect deployment events from GPS pipeline data.
 *
 * Phase 1: Line stretch detection from acceleration signature.
 * Works on the full GPSPipelinePoint[] array (post-hoc, not streaming).
 *
 * Strategy:
 *   1. Find the deployment region (flight mode transitions to DEPLOY or CANOPY)
 *   2. Scan deceleration magnitude for opening shock spike
 *   3. Walk backward from peak to find onset (line stretch moment)
 *   4. Walk forward to find full inflation (airspeed stabilization)
 *
 * Reference: docs/DEPLOYMENT-ESTIMATION.md
 */

import type { GPSPipelinePoint, GPSProcessedPoint } from '../gps/types.ts'

// ─── Config ─────────────────────────────────────────────────────────────────

export interface DeployDetectorConfig {
  /** Minimum deceleration magnitude to qualify as opening shock [m/s²] */
  minShockAccel: number
  /** Window [s] around flight mode deploy transition to search */
  searchWindow: number
  /** Airspeed stabilization threshold [m/s per second] — below this = stable */
  airspeedStableRate: number
  /** Minimum samples of stable airspeed to confirm full inflation */
  stableSampleCount: number
}

export const DEFAULT_DEPLOY_DETECTOR_CONFIG: DeployDetectorConfig = {
  minShockAccel: 15,         // ~1.5g deceleration above gravity
  searchWindow: 10,          // ±10s around deploy transition
  airspeedStableRate: 1.0,   // <1 m/s² airspeed change rate = stable
  stableSampleCount: 10,     // ~0.5s at 20Hz
}

// ─── Output ─────────────────────────────────────────────────────────────────

export interface DeployEstimate {
  /** Index into pipeline array where line stretch occurs */
  lineStretchIndex: number
  /** Time of line stretch [s] (from pipeline point timestamp) */
  lineStretchTime: number
  /** Peak deceleration magnitude at opening shock [m/s²] */
  peakDecel: number
  /** Index of peak deceleration */
  peakDecelIndex: number
  /** Index where full inflation is estimated */
  fullInflationIndex: number | null
  /** Time of full inflation [s] */
  fullInflationTime: number | null
  /** Inflation duration [s] (line stretch → full inflation) */
  inflationDuration: number | null
  /** Confidence [0–1] */
  confidence: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Total acceleration magnitude (gravity-subtracted, NED) */
function decelMagnitude(p: GPSProcessedPoint): number {
  // Acceleration from LS estimator, gravity already in the measurement frame
  // We want the magnitude of non-gravitational acceleration
  // In NED: gravity is (0, 0, +g). Subtract it to get aero acceleration.
  const ax = p.accelN
  const ay = p.accelE
  const az = p.accelD - 9.81  // subtract gravity (NED: +D = down)
  return Math.sqrt(ax * ax + ay * ay + az * az)
}

/** Rate of airspeed change [m/s²] via finite difference */
function airspeedRate(pts: GPSPipelinePoint[], i: number): number {
  if (i <= 0 || i >= pts.length - 1) return 0
  const dt = pts[i + 1].processed.t - pts[i - 1].processed.t
  if (dt < 0.01) return 0
  return (pts[i + 1].processed.airspeed - pts[i - 1].processed.airspeed) / dt
}

// ─── Detector ───────────────────────────────────────────────────────────────

/**
 * Detect deployment events from a full GPS pipeline run.
 *
 * Returns null if no deployment detected.
 */
export function detectDeployment(
  points: GPSPipelinePoint[],
  config: DeployDetectorConfig = DEFAULT_DEPLOY_DETECTOR_CONFIG,
): DeployEstimate | null {
  if (points.length < 20) return null

  // ── Step 1: Find deployment search region ──────────────────────────
  // Look for flight mode transition: WINGSUIT(3) or FREEFALL(4) → DEPLOY(5) or CANOPY(6)
  let deployTransitionIdx = -1
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].flightMode?.mode ?? 0
    const curr = points[i].flightMode?.mode ?? 0
    if ((prev === 3 || prev === 4) && (curr === 5 || curr === 6)) {
      deployTransitionIdx = i
      break
    }
  }

  // Also check deployConfidence ramp as a fallback
  if (deployTransitionIdx < 0) {
    for (let i = 1; i < points.length; i++) {
      const conf = points[i].flightMode?.deployConfidence ?? 0
      if (conf > 0.5) {
        deployTransitionIdx = i
        break
      }
    }
  }

  if (deployTransitionIdx < 0) return null

  // Search window around the transition
  const dt0 = points[1]?.processed.t - points[0]?.processed.t
  const sampleRate = dt0 > 0 ? 1 / dt0 : 20
  const windowSamples = Math.round(config.searchWindow * sampleRate)
  const searchStart = Math.max(0, deployTransitionIdx - windowSamples)
  const searchEnd = Math.min(points.length - 1, deployTransitionIdx + windowSamples)

  // ── Step 2: Find peak deceleration (opening shock) ─────────────────
  let peakDecel = 0
  let peakIdx = deployTransitionIdx
  for (let i = searchStart; i <= searchEnd; i++) {
    const d = decelMagnitude(points[i].processed)
    if (d > peakDecel) {
      peakDecel = d
      peakIdx = i
    }
  }

  if (peakDecel < config.minShockAccel) {
    // No clear opening shock — low confidence estimate
    return {
      lineStretchIndex: deployTransitionIdx,
      lineStretchTime: points[deployTransitionIdx].processed.t,
      peakDecel,
      peakDecelIndex: peakIdx,
      fullInflationIndex: null,
      fullInflationTime: null,
      inflationDuration: null,
      confidence: 0.2,
    }
  }

  // ── Step 3: Walk backward from peak to find onset (line stretch) ───
  // Line stretch = where deceleration first exceeds a baseline threshold.
  // The baseline is the average decel in the pre-deployment region.
  const preStart = Math.max(0, searchStart)
  const preEnd = Math.max(0, peakIdx - Math.round(sampleRate * 2)) // 2s before peak
  let baselineDecel = 0
  let baselineCount = 0
  for (let i = preStart; i < preEnd; i++) {
    baselineDecel += decelMagnitude(points[i].processed)
    baselineCount++
  }
  baselineDecel = baselineCount > 0 ? baselineDecel / baselineCount : 5

  // Onset threshold: 2× baseline or 10 m/s², whichever is larger
  const onsetThreshold = Math.max(baselineDecel * 2, 10)

  let lineStretchIdx = peakIdx
  for (let i = peakIdx - 1; i >= searchStart; i--) {
    if (decelMagnitude(points[i].processed) < onsetThreshold) {
      lineStretchIdx = i + 1
      break
    }
  }

  // ── Step 4: Walk forward from peak to find full inflation ──────────
  // Full inflation = airspeed rate stabilizes (stops decelerating rapidly)
  let fullInflationIdx: number | null = null
  let stableCount = 0
  for (let i = peakIdx + 1; i <= searchEnd; i++) {
    const rate = Math.abs(airspeedRate(points, i))
    if (rate < config.airspeedStableRate) {
      stableCount++
      if (stableCount >= config.stableSampleCount) {
        fullInflationIdx = i - config.stableSampleCount + 1
        break
      }
    } else {
      stableCount = 0
    }
  }

  const lineStretchTime = points[lineStretchIdx].processed.t
  const fullInflationTime = fullInflationIdx != null ? points[fullInflationIdx].processed.t : null
  const inflationDuration = fullInflationTime != null ? fullInflationTime - lineStretchTime : null

  // Confidence based on peak magnitude and detection quality
  const conf = Math.min(1, peakDecel / 30) * (fullInflationIdx != null ? 1.0 : 0.6)

  return {
    lineStretchIndex: lineStretchIdx,
    lineStretchTime,
    peakDecel,
    peakDecelIndex: peakIdx,
    fullInflationIndex: fullInflationIdx,
    fullInflationTime,
    inflationDuration,
    confidence: conf,
  }
}
