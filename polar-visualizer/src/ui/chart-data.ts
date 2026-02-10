/**
 * Chart data generation — sweeps α to produce full polar curves.
 *
 * Generates point arrays for all 6 chart views, colored by AOA.
 * Recalculated when β, δ, dirty, polar, airspeed, or ρ change.
 */

import { getAllCoefficients, coeffToSS } from '../polar/coefficients.ts'
import type { ContinuousPolar, FullCoefficients } from '../polar/continuous-polar.ts'

// ─── AOA Color Map ───────────────────────────────────────────────────────────

/**
 * Map AOA to a rainbow-ish color matching BASEline's scheme.
 * Deep blue (low α) → cyan → green → yellow → orange → red → magenta (high α)
 */
export function aoaToColor(alpha_deg: number, minAlpha: number, maxAlpha: number): string {
  const t = Math.max(0, Math.min(1, (alpha_deg - minAlpha) / (maxAlpha - minAlpha)))
  // HSL: hue 240 (blue) → 0 (red) → 300 (magenta)
  // Use 270 → 0 for blue→cyan→green→yellow→red
  const hue = 270 * (1 - t)
  return `hsl(${hue}, 90%, 55%)`
}

/**
 * Generate a discrete color legend mapping.
 */
export function aoaColorLegend(minAlpha: number, maxAlpha: number, steps: number = 7): { alpha: number, color: string }[] {
  const legend: { alpha: number, color: string }[] = []
  for (let i = 0; i < steps; i++) {
    const alpha = minAlpha + (maxAlpha - minAlpha) * i / (steps - 1)
    legend.push({ alpha: Math.round(alpha), color: aoaToColor(alpha, minAlpha, maxAlpha) })
  }
  return legend
}

// ─── Data Point ──────────────────────────────────────────────────────────────

export interface PolarPoint {
  alpha: number
  cl: number
  cd: number
  cy: number
  cm: number
  cp: number
  f: number
  cn: number
  cl_roll: number
  ld: number       // CL/CD (glide ratio)
  vxs: number      // sustained horizontal speed [m/s]
  vys: number      // sustained vertical speed [m/s]
  color: string
}

// ─── Sweep Configuration ─────────────────────────────────────────────────────

export interface SweepConfig {
  minAlpha: number    // degrees
  maxAlpha: number    // degrees
  step: number        // degrees
  beta_deg: number
  delta: number
  dirty: number
  rho: number
  airspeed: number    // only used for force-based views (not coefficients)
}

const DEFAULT_SWEEP: SweepConfig = {
  minAlpha: -10,
  maxAlpha: 90,
  step: 0.5,
  beta_deg: 0,
  delta: 0,
  dirty: 0,
  rho: 1.095,
  airspeed: 45,
}

// ─── Sweep Generator ─────────────────────────────────────────────────────────

/**
 * Sweep α from minAlpha to maxAlpha, evaluating the full polar at each step.
 * Returns an array of PolarPoints with all coefficients + derived quantities.
 */
export function sweepPolar(
  polar: ContinuousPolar,
  config: Partial<SweepConfig> = {}
): PolarPoint[] {
  const cfg = { ...DEFAULT_SWEEP, ...config }
  const points: PolarPoint[] = []

  for (let alpha = cfg.minAlpha; alpha <= cfg.maxAlpha; alpha += cfg.step) {
    const coeffs: FullCoefficients = getAllCoefficients(alpha, cfg.beta_deg, cfg.delta, polar, cfg.dirty)
    const ss = coeffToSS(coeffs.cl, coeffs.cd, polar.s, polar.m, cfg.rho)
    const ld = coeffs.cd > 0.001 ? coeffs.cl / coeffs.cd : 0

    points.push({
      alpha,
      cl: coeffs.cl,
      cd: coeffs.cd,
      cy: coeffs.cy,
      cm: coeffs.cm,
      cp: coeffs.cp,
      f: coeffs.f,
      cn: coeffs.cn,
      cl_roll: coeffs.cl_roll,
      ld,
      vxs: ss.vxs,
      vys: ss.vys,
      color: aoaToColor(alpha, cfg.minAlpha, cfg.maxAlpha),
    })
  }

  return points
}
