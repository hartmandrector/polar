/**
 * Chart data generation — sweeps α to produce full polar curves.
 *
 * Generates point arrays for all 6 chart views, colored by AOA.
 * Recalculated when β, δ, dirty, polar, airspeed, or ρ change.
 */

import { getAllCoefficients, coeffToSS } from '../polar/coefficients.ts'
import type { ContinuousPolar, FullCoefficients, AeroSegment, SegmentControls } from '../polar/continuous-polar.ts'
import { computeSegmentForce, sumAllSegments, computeWindFrameNED, defaultControls } from '../polar/aero-segment.ts'
import { computeCenterOfMass } from '../polar/inertia.ts'
import { getLegacyCoefficients } from '../polar/polar-data.ts'
import type { WSEQPolar } from '../polar/polar-data.ts'

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

// ─── Segment-Summed Sweep ────────────────────────────────────────────────────

/**
 * Sweep α using per-segment force summation instead of the lumped single-airfoil model.
 *
 * At each α step:
 * 1. Compute per-segment forces via computeSegmentForce()
 * 2. Compute NED wind/lift/side directions from α,β
 * 3. Sum forces and moments via sumAllSegments()
 * 4. Decompose total force back into pseudo CL/CD/CY by dotting with direction vectors
 * 5. Normalize by q·S_ref to get pseudo coefficients comparable to single-airfoil data
 * 6. Compute sustained speeds from pseudo CL/CD
 *
 * The result uses the same PolarPoint interface so charts render unchanged.
 */
export function sweepSegments(
  segments: AeroSegment[],
  polar: ContinuousPolar,
  massReference_m: number,
  controls: SegmentControls,
  config: Partial<SweepConfig> = {}
): PolarPoint[] {
  const cfg = { ...DEFAULT_SWEEP, ...config }
  const points: PolarPoint[] = []

  // System CG from mass segments (or fallback to origin)
  const cgMeters = polar.massSegments && polar.massSegments.length > 0
    ? computeCenterOfMass(polar.massSegments, massReference_m, polar.m)
    : { x: 0, y: 0, z: 0 }

  // Reference values for coefficient normalization
  const sRef = polar.s
  const mRef = polar.m
  const chordRef = polar.chord

  for (let alpha = cfg.minAlpha; alpha <= cfg.maxAlpha; alpha += cfg.step) {
    const q = 0.5 * cfg.rho * cfg.airspeed * cfg.airspeed
    const qS = q * sRef

    // 1. Per-segment forces
    const segForces = segments.map(seg =>
      computeSegmentForce(seg, alpha, cfg.beta_deg, controls, cfg.rho, cfg.airspeed)
    )

    // 2. Wind frame in NED body coordinates
    const { windDir, liftDir, sideDir } = computeWindFrameNED(alpha, cfg.beta_deg)

    // 3. Sum all segment forces and moments
    // TODO(ref-audit): aero reference -> referenceLength_m
    const system = sumAllSegments(segments, segForces, cgMeters, polar.referenceLength, windDir, liftDir, sideDir)

    // 4. Decompose total force into lift/drag/side magnitudes
    // by projecting onto the wind-frame direction vectors
    const totalLift = liftDir.x * system.force.x + liftDir.y * system.force.y + liftDir.z * system.force.z
    const totalDrag = -(windDir.x * system.force.x + windDir.y * system.force.y + windDir.z * system.force.z)
    const totalSide = sideDir.x * system.force.x + sideDir.y * system.force.y + sideDir.z * system.force.z

    // 5. Pseudo coefficients (normalized by system reference area)
    const cl = qS > 1e-10 ? totalLift / qS : 0
    const cd = qS > 1e-10 ? totalDrag / qS : 0
    const cy = qS > 1e-10 ? totalSide / qS : 0

    // Moment coefficients from segment summation
    const qSc = qS * chordRef
    const cm = qSc > 1e-10 ? system.moment.y / qSc : 0       // pitch (NED y)
    const cn = qSc > 1e-10 ? system.moment.z / qSc : 0       // yaw   (NED z)
    const cl_roll = qSc > 1e-10 ? system.moment.x / qSc : 0  // roll  (NED x)

    // 6. Derived quantities
    const ld = cd > 0.001 ? cl / cd : 0
    const ss = coeffToSS(cl, cd, sRef, mRef, cfg.rho)

    // System center of pressure from moment–normal-force relationship.
    // The pitch moment about CG equals the normal force times the moment arm:
    //   M_y = −F_z × r_cp_x,  where F_z = −qS·CN and CN = CL·cos(α) + CD·sin(α)
    // Solving: cp = cg − cm / CN.
    // Using CN instead of CL is essential: at high α, CL→0 but CD·sin(α)
    // keeps CN positive, correctly moving CP aft with increasing α.
    const alpha_rad = alpha * Math.PI / 180
    const cn_force = cl * Math.cos(alpha_rad) + cd * Math.sin(alpha_rad)
    const cp = Math.abs(cn_force) > 0.02
      ? Math.max(0, Math.min(1, polar.cg - cm / cn_force))
      : polar.cg

    points.push({
      alpha,
      cl, cd, cy, cm,
      cp,
      f: 0,        // not applicable to multi-segment
      cn, cl_roll,
      ld,
      vxs: ss.vxs,
      vys: ss.vys,
      color: aoaToColor(alpha, cfg.minAlpha, cfg.maxAlpha),
    })
  }

  return points
}

// ─── Legacy Polar Sweep ──────────────────────────────────────────────────────

/** Simplified point for legacy polars (only CL, CD, CP available). */
export interface LegacyPoint {
  alpha: number
  cl: number
  cd: number
  cp: number
  ld: number
  vxs: number
  vys: number
  color: string
}

/**
 * Sweep a legacy WSEQPolar over the chart's α range.
 * Only produces points within the legacy polar's actual AOA range.
 * Points outside have no data, so we skip them.
 */
export function sweepLegacyPolar(
  polar: WSEQPolar,
  config: Partial<SweepConfig> = {}
): LegacyPoint[] {
  const cfg = { ...DEFAULT_SWEEP, ...config }
  if (!polar.aoas || !polar.stallpoint) return []

  // Legacy aoas are sorted descending (high → low)
  const legacyMin = polar.aoas[polar.aoas.length - 1]
  const legacyMax = polar.aoas[0]

  const points: LegacyPoint[] = []
  for (let alpha = cfg.minAlpha; alpha <= cfg.maxAlpha; alpha += cfg.step) {
    // Skip α values outside the legacy polar's range
    if (alpha < legacyMin || alpha > legacyMax) continue

    const c = getLegacyCoefficients(alpha, polar)
    const ld = c.cd > 0.001 ? c.cl / c.cd : 0
    const ss = coeffToSS(c.cl, c.cd, polar.s, polar.m, cfg.rho)

    points.push({
      alpha,
      cl: c.cl,
      cd: c.cd,
      cp: c.cp,
      ld,
      vxs: ss.vxs,
      vys: ss.vys,
      color: aoaToColor(alpha, cfg.minAlpha, cfg.maxAlpha),
    })
  }

  return points
}
