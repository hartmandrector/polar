/**
 * deploy-replay.ts — Deployment replay state for GPS viewer.
 *
 * Wraps CanopyState with deployment-specific timing and sub-phase info.
 * Produced by analyzing the full pipeline run (post-hoc), consumed by:
 *   - GPS scene (GLB model deploy slider, bridle/PC rendering)
 *   - Side panel (timing display, sub-mode indicator)
 *   - Charts (canopy AoA overlay, phase markers)
 *
 * Separate from CanopyState because:
 *   - Deployment phases need access to future points (back-calculation)
 *   - EKF will need a different (causal) version later
 *   - More complex than steady-state canopy estimation
 *
 * Reference: docs/DEPLOYMENT-ESTIMATION.md
 */

import type { CanopyState } from './canopy-estimator.ts'
import type { DeployEstimate } from './deploy-detector.ts'
import type { GPSPipelinePoint } from '../gps/types.ts'

// ─── Deploy Sub-Phases ──────────────────────────────────────────────────────

export type DeploySubPhase =
  | 'pre_deploy'        // before any deployment activity
  | 'pc_toss'           // reaching + throwing pilot chute
  | 'bridle_stretch'    // PC inflating, bridle extending
  | 'line_stretch'      // opening shock moment
  | 'max_aoa'           // canopy forces dominant, peak AoA
  | 'snivel'            // slider stretching, cells pressurizing
  | 'surge'             // AoA dropping toward trim
  | 'full_flight'       // AoA at trim, canopy flying normally

// ─── Per-Point Deploy State ─────────────────────────────────────────────────

export interface DeployReplayPoint {
  /** Deployment sub-phase at this point */
  subPhase: DeploySubPhase

  /** Canopy state from canopy estimator (null if pre-deploy) */
  canopyState: CanopyState | null

  /** Deploy fraction [0–1] — 0 = packed, 1 = fully inflated */
  deployFraction: number

  /** Time relative to line stretch [s] — negative = before, positive = after */
  timeSinceLineStretch: number | null

  /** Canopy AoA [deg] — from canopy estimator, NaN if unavailable */
  canopyAoaDeg: number

  /** Is the canopy estimator trustworthy at this point? */
  canopyTrust: boolean
}

// ─── Full Replay Timeline ───────────────────────────────────────────────────

export interface DeployReplayTimeline {
  /** Per-point deploy state, aligned 1:1 with pipeline points */
  points: DeployReplayPoint[]

  /** Detection results from deploy-detector */
  detection: DeployEstimate | null

  /** Key timing indices */
  timing: {
    pcTossIndex: number | null
    lineStretchIndex: number | null
    maxAoaIndex: number | null
    snivelEndIndex: number | null
    surgeEndIndex: number | null
    fullFlightIndex: number | null
  }

  /** Key timing values [s] (absolute times from pipeline) */
  timingSeconds: {
    pcTossTime: number | null
    lineStretchTime: number | null
    maxAoaTime: number | null
    fullFlightTime: number | null
    totalDeployDuration: number | null  // PC toss → full flight
    inflationDuration: number | null    // line stretch → full flight
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Estimated time from PC toss to line stretch [s] */
const PC_TO_LINE_STRETCH = 2.0

/** Estimated time for reach + grab before PC toss [s] */
const REACH_GRAB_TIME = 1.0

/** AoA threshold for "at trim" [deg] — below this absolute value = full flight */
const FULL_FLIGHT_AOA_DEG = 15

/** Default canopy trim AoA [deg] */
const TRIM_AOA_DEG = 8

/** Minimum canopy AoA [deg] to consider as "max AoA detected" */
const MIN_MAX_AOA_DEG = 30

/** Deploy fraction ramp rate [1/s] — used to estimate visual deploy fraction */
const DEPLOY_RAMP_RATE = 0.7

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Build the full deployment replay timeline from pipeline points + canopy states.
 *
 * This is post-hoc analysis — has access to all points.
 */
export function buildDeployReplayTimeline(
  points: GPSPipelinePoint[],
  canopyStates: CanopyState[],
  detection: DeployEstimate | null,
): DeployReplayTimeline {
  const n = points.length

  // Initialize with defaults
  const replayPoints: DeployReplayPoint[] = new Array(n)
  for (let i = 0; i < n; i++) {
    replayPoints[i] = {
      subPhase: 'pre_deploy',
      canopyState: null,
      deployFraction: 0,
      timeSinceLineStretch: null,
      canopyAoaDeg: NaN,
      canopyTrust: false,
    }
  }

  const timing = {
    pcTossIndex: null as number | null,
    lineStretchIndex: null as number | null,
    maxAoaIndex: null as number | null,
    snivelEndIndex: null as number | null,
    surgeEndIndex: null as number | null,
    fullFlightIndex: null as number | null,
  }

  if (!detection || detection.confidence < 0.1) {
    return {
      points: replayPoints,
      detection,
      timing,
      timingSeconds: {
        pcTossTime: null,
        lineStretchTime: null,
        maxAoaTime: null,
        fullFlightTime: null,
        totalDeployDuration: null,
        inflationDuration: null,
      },
    }
  }

  const lsIdx = detection.lineStretchIndex
  const lsTime = points[lsIdx].processed.t
  timing.lineStretchIndex = lsIdx

  // ── Back-calculate PC toss time ────────────────────────────────────
  // Estimate based on typical PC-to-line-stretch duration
  const pcTossTime = lsTime - PC_TO_LINE_STRETCH
  const reachTime = pcTossTime - REACH_GRAB_TIME

  // Find closest indices
  for (let i = 0; i < n; i++) {
    if (points[i].processed.t >= pcTossTime && timing.pcTossIndex == null) {
      timing.pcTossIndex = i
    }
  }

  // ── Find max canopy AoA post–line stretch ──────────────────────────
  let maxAoa = 0
  let maxAoaIdx = lsIdx
  const searchEnd = Math.min(n, lsIdx + 200) // ~10s at 20Hz
  for (let i = lsIdx; i < searchEnd; i++) {
    const cs = canopyStates[i]
    if (cs && cs.valid) {
      const aoaDeg = Math.abs(cs.aoa) * (180 / Math.PI)
      if (aoaDeg > maxAoa) {
        maxAoa = aoaDeg
        maxAoaIdx = i
      }
    }
  }
  if (maxAoa > MIN_MAX_AOA_DEG) {
    timing.maxAoaIndex = maxAoaIdx
  }

  // ── Find full flight (AoA reaches trim) ────────────────────────────
  // Search from max AoA forward for AoA settling within threshold of trim
  const trimSearchStart = timing.maxAoaIndex ?? lsIdx
  let stableCount = 0
  const STABLE_NEEDED = 10 // 0.5s at 20Hz
  for (let i = trimSearchStart; i < searchEnd; i++) {
    const cs = canopyStates[i]
    if (cs && cs.valid) {
      const aoaDeg = Math.abs(cs.aoa) * (180 / Math.PI)
      if (aoaDeg < FULL_FLIGHT_AOA_DEG) {
        stableCount++
        if (stableCount >= STABLE_NEEDED) {
          timing.fullFlightIndex = i - STABLE_NEEDED + 1
          break
        }
      } else {
        stableCount = 0
      }
    }
  }

  // ── Estimate snivel/surge boundary ─────────────────────────────────
  // Snivel ends when AoA starts dropping rapidly (midpoint between max and trim)
  if (timing.maxAoaIndex != null && timing.fullFlightIndex != null) {
    const midAoa = (maxAoa + TRIM_AOA_DEG) / 2
    for (let i = timing.maxAoaIndex; i < timing.fullFlightIndex; i++) {
      const cs = canopyStates[i]
      if (cs && cs.valid) {
        const aoaDeg = Math.abs(cs.aoa) * (180 / Math.PI)
        if (aoaDeg < midAoa) {
          timing.snivelEndIndex = i
          break
        }
      }
    }
    // Surge ends at full flight
    timing.surgeEndIndex = timing.fullFlightIndex
  }

  // ── Assign sub-phases to each point ────────────────────────────────
  for (let i = 0; i < n; i++) {
    const t = points[i].processed.t
    const rp = replayPoints[i]
    rp.timeSinceLineStretch = t - lsTime

    // Canopy state
    const cs = canopyStates[i]
    if (cs && cs.valid) {
      rp.canopyState = cs
      rp.canopyAoaDeg = cs.aoa * (180 / Math.PI)
    }

    // Sub-phase assignment
    if (i < (timing.pcTossIndex ?? lsIdx)) {
      rp.subPhase = 'pre_deploy'
    } else if (i < lsIdx) {
      // Between PC toss and line stretch
      const bridleStart = timing.pcTossIndex ?? lsIdx
      const midpoint = Math.round((bridleStart + lsIdx) / 2)
      rp.subPhase = i < midpoint ? 'pc_toss' : 'bridle_stretch'
    } else if (i === lsIdx) {
      rp.subPhase = 'line_stretch'
    } else if (timing.maxAoaIndex != null && i <= timing.maxAoaIndex) {
      rp.subPhase = 'max_aoa'
    } else if (timing.snivelEndIndex != null && i <= timing.snivelEndIndex) {
      rp.subPhase = 'snivel'
    } else if (timing.fullFlightIndex != null && i < timing.fullFlightIndex) {
      rp.subPhase = 'surge'
    } else if (timing.fullFlightIndex != null && i >= timing.fullFlightIndex) {
      rp.subPhase = 'full_flight'
    } else {
      // Between line stretch and whatever we detected
      rp.subPhase = i > lsIdx ? 'snivel' : 'pre_deploy'
    }

    // Deploy fraction estimate
    if (i <= lsIdx) {
      rp.deployFraction = 0
    } else if (timing.fullFlightIndex != null && i >= timing.fullFlightIndex) {
      rp.deployFraction = 1
    } else {
      // Ramp from 0 at line stretch to 1 at full flight
      const elapsed = t - lsTime
      rp.deployFraction = Math.min(1, elapsed * DEPLOY_RAMP_RATE)
    }

    // Canopy trust — estimator is trustworthy after max AoA
    rp.canopyTrust = timing.maxAoaIndex != null && i >= timing.maxAoaIndex && cs != null && cs.valid
  }

  // ── Timing summary ─────────────────────────────────────────────────
  const pcTossT = timing.pcTossIndex != null ? points[timing.pcTossIndex].processed.t : null
  const maxAoaT = timing.maxAoaIndex != null ? points[timing.maxAoaIndex].processed.t : null
  const fullFlightT = timing.fullFlightIndex != null ? points[timing.fullFlightIndex].processed.t : null

  return {
    points: replayPoints,
    detection,
    timing,
    timingSeconds: {
      pcTossTime: pcTossT,
      lineStretchTime: lsTime,
      maxAoaTime: maxAoaT,
      fullFlightTime: fullFlightT,
      totalDeployDuration: pcTossT != null && fullFlightT != null ? fullFlightT - pcTossT : null,
      inflationDuration: fullFlightT != null ? fullFlightT - lsTime : null,
    },
  }
}
