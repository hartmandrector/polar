/**
 * analysis-types.ts — Shared result interfaces for eigenvalue analysis.
 *
 * These types are serialized to JSON for baseline comparison
 * and consumed by the HTML report generator.
 */

import type { NaturalMode } from './linearize.ts'

/** Result for a single airspeed point */
export interface SpeedPoint {
  airspeed_ms: number
  airspeed_kmh: number
  airspeed_mph: number
  converged: boolean
  residual: number

  // Trim conditions
  alpha_deg: number
  theta_deg: number
  gamma_deg: number
  qDot: number

  // Natural modes (conjugate duplicates removed)
  modes: NaturalMode[]

  // Full A matrix (only saved for single-speed runs)
  A?: number[][]
}

/** Complete analysis run */
export interface AnalysisRun {
  polar: string
  mass_kg: number
  referenceLength_m: number
  isWingsuit: boolean
  timestamp: string
  commitHash?: string
  speeds: SpeedPoint[]
}

/** Comparison between two runs */
export interface RunComparison {
  baseline: AnalysisRun
  current: AnalysisRun
  /** Matched speed points (only speeds present in both runs) */
  matched: Array<{
    airspeed_ms: number
    baseline: SpeedPoint
    current: SpeedPoint
  }>
}
