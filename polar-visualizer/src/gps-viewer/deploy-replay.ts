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
import { buildDeployPoseSeries, type DeployPoseSeries } from './deploy-pose.ts'
import { DEPLOY_CHAIN, buildDeployChainSeries, type DeployChainFrame } from './deploy-chain.ts'

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

/** Where an anchor's time came from */
export type AnchorSource = 'detected' | 'estimated' | 'manual'

export interface DeployAnchor {
  index: number
  /** Absolute pipeline time [s] */
  time: number
  source: AnchorSource
}

/**
 * Named timing anchors for the whole deployment, in order:
 * pcToss → bridleTaut → bagOut → lineStretch → maxAoa → snivelEnd → fullFlight.
 * Line stretch is the detected anchor; everything before it is back-calculated,
 * everything after it comes from the canopy estimator AoA.
 */
export interface DeployAnchors {
  /** PC leaves the hand, starts to catch air */
  pcToss: DeployAnchor | null
  /** Bridle fully paid out and taut — pulls the container open */
  bridleTaut: DeployAnchor | null
  /** Container open, canopy bag leaving the container; lines paying out */
  bagOut: DeployAnchor | null
  /** Lines taut — canopy starts to dominate the aerodynamics */
  lineStretch: DeployAnchor | null
  maxAoa: DeployAnchor | null
  snivelEnd: DeployAnchor | null
  fullFlight: DeployAnchor | null
}

export interface DeployTimelineOptions {
  /** Manual shift of the detected line stretch time [s] */
  lineStretchOffset_s?: number
  /** Manual PC-toss → line-stretch duration [s]; null/undefined = airspeed model */
  pcTossLead_s?: number | null
}

export interface DeployReplayTimeline {
  /** Per-point deploy state, aligned 1:1 with pipeline points */
  points: DeployReplayPoint[]

  /** Detection results from deploy-detector */
  detection: DeployEstimate | null

  /** Named anchors (source of truth for timing) */
  anchors: DeployAnchors

  /** Pilot / canopy orientation series (PC toss → canopy flight), see deploy-pose.ts */
  pose: DeployPoseSeries

  /** PC / bridle / bag chain frames, aligned 1:1 with pipeline points, see deploy-chain.ts */
  chain: (DeployChainFrame | null)[]

  /** Key timing indices */
  timing: {
    pcTossIndex: number | null
    bridleTautIndex: number | null
    bagOutIndex: number | null
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

/**
 * PC-toss → line-stretch back-calculation. The PC drags the chain out at a
 * fraction of the airspeed, so higher airspeed = shorter deploy.
 */
export const PC_LEAD_MODEL = {
  /** Hand release until the PC catches air [s] */
  THROW_TIME: 0.3,
  /** Pin/container opening once the bridle is taut [s] */
  CONTAINER_TIME: 0.3,
  /** Chain payout speed as a fraction of airspeed (pilot's wake slows the PC) */
  PAYOUT_SPEED_FRACTION: 0.4,
  /** Floor for airspeed in the model [m/s] */
  MIN_AIRSPEED: 5,
  /** Clamp for the total lead [s] */
  MIN_LEAD: 0.8,
  MAX_LEAD: 3.0,
  /** Airspeed averaging window before line stretch [s] */
  AIRSPEED_WINDOW: 0.5,
}

/** AoA threshold for "at trim" [deg] — below this absolute value = full flight */
const FULL_FLIGHT_AOA_DEG = 15

/** Default canopy trim AoA [deg] */
const TRIM_AOA_DEG = 8

/** Minimum canopy AoA [deg] to consider as "max AoA detected" */
const MIN_MAX_AOA_DEG = 30

/** Fallback deploy fraction ramp rate [1/s] when no AoA anchors are available */
const DEPLOY_RAMP_RATE = 0.7

// ─── Helpers ────────────────────────────────────────────────────────────────

/** First index with t >= time (clamped to the array) */
function indexAtTime(points: GPSPipelinePoint[], time: number): number {
  let lo = 0, hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].processed.t >= time) hi = mid
    else lo = mid + 1
  }
  return lo
}

export interface PcLeadBreakdown {
  /** PC toss → bridle taut [s] */
  bridle: number
  /** Bridle taut → bag out [s] */
  container: number
  /** Bag out → line stretch [s] */
  lines: number
  total: number
  /** True if a manual lead was applied */
  manual: boolean
}

/**
 * Back-calculate the PC-toss → line-stretch span and split it into
 * bridle payout, container opening and lines payout.
 */
export function estimatePcLead(airspeed: number, manualLead_s?: number | null): PcLeadBreakdown {
  const M = PC_LEAD_MODEL
  const payoutSpeed = Math.max(M.MIN_AIRSPEED, airspeed) * M.PAYOUT_SPEED_FRACTION
  let bridle = M.THROW_TIME + DEPLOY_CHAIN.BRIDLE_LENGTH / payoutSpeed
  let container = M.CONTAINER_TIME
  let lines = (DEPLOY_CHAIN.TOTAL_LENGTH - DEPLOY_CHAIN.BRIDLE_LENGTH) / payoutSpeed
  const modelTotal = bridle + container + lines

  const manual = manualLead_s != null && manualLead_s > 0
  const target = manual
    ? manualLead_s!
    : Math.max(M.MIN_LEAD, Math.min(M.MAX_LEAD, modelTotal))
  const k = target / modelTotal
  bridle *= k; container *= k; lines *= k
  return { bridle, container, lines, total: target, manual }
}

/** Mean airspeed over the short window before line stretch */
function airspeedBeforeLineStretch(points: GPSPipelinePoint[], lsIdx: number): number {
  const tEnd = points[lsIdx].processed.t
  const tStart = tEnd - PC_LEAD_MODEL.AIRSPEED_WINDOW
  let sum = 0, n = 0
  for (let i = lsIdx; i >= 0 && points[i].processed.t >= tStart; i--) {
    sum += points[i].processed.airspeed
    n++
  }
  return n > 0 ? sum / n : points[lsIdx].processed.airspeed
}

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
  options: DeployTimelineOptions = {},
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
    bridleTautIndex: null as number | null,
    bagOutIndex: null as number | null,
    lineStretchIndex: null as number | null,
    maxAoaIndex: null as number | null,
    snivelEndIndex: null as number | null,
    surgeEndIndex: null as number | null,
    fullFlightIndex: null as number | null,
  }

  const anchors: DeployAnchors = {
    pcToss: null, bridleTaut: null, bagOut: null, lineStretch: null,
    maxAoa: null, snivelEnd: null, fullFlight: null,
  }

  if (!detection || detection.confidence < 0.1) {
    return {
      points: replayPoints,
      detection,
      anchors,
      pose: buildDeployPoseSeries(points, canopyStates, { anchors }),
      chain: new Array(n).fill(null),
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

  // ── Line stretch: detected anchor, optionally shifted by the user ──
  const lsOffset = options.lineStretchOffset_s ?? 0
  const lsManual = lsOffset !== 0
  const lsIdx = lsManual
    ? indexAtTime(points, detection.lineStretchTime + lsOffset)
    : detection.lineStretchIndex
  const lsTime = points[lsIdx].processed.t
  timing.lineStretchIndex = lsIdx
  const mark = (index: number, source: AnchorSource): DeployAnchor =>
    ({ index, time: points[index].processed.t, source })
  anchors.lineStretch = mark(lsIdx, lsManual ? 'manual' : 'detected')

  // ── Back-calculate PC toss / bridle taut / bag out ─────────────────
  // Span is a function of airspeed at line stretch and the chain length
  // (see PC_LEAD_MODEL); a manual lead overrides the total.
  const lead = estimatePcLead(airspeedBeforeLineStretch(points, lsIdx), options.pcTossLead_s)
  const preSource: AnchorSource = lead.manual ? 'manual' : 'estimated'
  const tossIdx = Math.min(lsIdx, indexAtTime(points, lsTime - lead.total))
  const tautIdx = Math.min(lsIdx, Math.max(tossIdx, indexAtTime(points, lsTime - lead.total + lead.bridle)))
  const bagIdx = Math.min(lsIdx, Math.max(tautIdx, indexAtTime(points, lsTime - lead.lines)))
  timing.pcTossIndex = tossIdx
  timing.bridleTautIndex = tautIdx
  timing.bagOutIndex = bagIdx
  anchors.pcToss = mark(tossIdx, preSource)
  anchors.bridleTaut = mark(tautIdx, preSource)
  anchors.bagOut = mark(bagIdx, preSource)

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
    anchors.maxAoa = mark(maxAoaIdx, 'detected')
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
          anchors.fullFlight = mark(timing.fullFlightIndex, 'detected')
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
          anchors.snivelEnd = mark(i, 'detected')
          break
        }
      }
    }
    // Surge ends at full flight
    timing.surgeEndIndex = timing.fullFlightIndex
  }

  // Visual inflation: 0 at line stretch → 1 when snivel ends (or max AoA + 0.5 s,
  // or a fixed ramp when no AoA anchors were found)
  const inflationEndTime = anchors.snivelEnd?.time
    ?? (anchors.maxAoa ? anchors.maxAoa.time + 0.5 : lsTime + 1 / DEPLOY_RAMP_RATE)
  const inflationDur = Math.max(0.8, Math.min(3.0, inflationEndTime - lsTime))

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
    if (i < tossIdx) {
      rp.subPhase = 'pre_deploy'
    } else if (i < lsIdx) {
      // PC toss → bridle taut is 'pc_toss'; bridle taut → line stretch is 'bridle_stretch'
      rp.subPhase = i < tautIdx ? 'pc_toss' : 'bridle_stretch'
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

    // Deploy fraction: eased ramp over the anchor-derived inflation span
    if (i <= lsIdx) {
      rp.deployFraction = 0
    } else if (timing.fullFlightIndex != null && i >= timing.fullFlightIndex) {
      rp.deployFraction = 1
    } else {
      const x = Math.min(1, (t - lsTime) / inflationDur)
      rp.deployFraction = x * x * (3 - 2 * x)
    }

    // Canopy trust — estimator is trustworthy after max AoA
    rp.canopyTrust = timing.maxAoaIndex != null && i >= timing.maxAoaIndex && cs != null && cs.valid
  }

  // ── Timing summary ─────────────────────────────────────────────────
  const pcTossT = anchors.pcToss.time
  const maxAoaT = anchors.maxAoa?.time ?? null
  const fullFlightT = anchors.fullFlight?.time ?? null
  const pose = buildDeployPoseSeries(points, canopyStates, { anchors })

  return {
    points: replayPoints,
    detection,
    anchors,
    pose,
    chain: buildDeployChainSeries(points, { anchors, pose }, replayPoints.map(p => p.deployFraction)),
    timing,
    timingSeconds: {
      pcTossTime: pcTossT,
      lineStretchTime: lsTime,
      maxAoaTime: maxAoaT,
      fullFlightTime: fullFlightT,
      totalDeployDuration: fullFlightT != null ? fullFlightT - pcTossT : null,
      inflationDuration: fullFlightT != null ? fullFlightT - lsTime : null,
    },
  }
}
