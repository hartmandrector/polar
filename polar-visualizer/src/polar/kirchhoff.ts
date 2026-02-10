/**
 * Kirchhoff separation function and flat-plate aerodynamics.
 * 
 * The core blending model: attached-flow ←→ flat-plate, controlled by f(α).
 * This module is UI-independent.
 */

import { ContinuousPolar } from './continuous-polar.ts'

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

// ─── Separation Function ─────────────────────────────────────────────────────

/**
 * Sigmoid function: 1 / (1 + exp(x))
 */
function sigmoid(x: number): number {
  // Clamp to prevent overflow
  if (x > 500) return 0
  if (x < -500) return 1
  return 1 / (1 + Math.exp(x))
}

/**
 * Forward stall sigmoid: drops from 1 → 0 as α exceeds α_stall_fwd
 */
export function f_fwd(alpha_deg: number, polar: ContinuousPolar): number {
  return sigmoid((alpha_deg - polar.alpha_stall_fwd) / polar.s1_fwd)
}

/**
 * Back stall sigmoid: drops from 1 → 0 as α goes below α_stall_back
 */
export function f_back(alpha_deg: number, polar: ContinuousPolar): number {
  return sigmoid((polar.alpha_stall_back - alpha_deg) / polar.s1_back)
}

/**
 * Combined separation function: f(α) ∈ [0, 1]
 * f = 1 means fully attached flow
 * f = 0 means fully separated (flat-plate regime)
 */
export function separation(alpha_deg: number, polar: ContinuousPolar): number {
  return f_fwd(alpha_deg, polar) * f_back(alpha_deg, polar)
}

// ─── Attached-Flow Model ─────────────────────────────────────────────────────

/**
 * Attached-flow lift coefficient.
 * CL_attached = CL_α · sin(α - α_0)
 * Using sin() instead of linear for better behavior at large α in the transition zone.
 */
export function cl_attached(alpha_deg: number, polar: ContinuousPolar): number {
  const alpha_rad = (alpha_deg - polar.alpha_0) * DEG2RAD
  return polar.cl_alpha * Math.sin(alpha_rad)
}

/**
 * Attached-flow drag coefficient.
 * CD_attached = CD_0 + K · CL²
 */
export function cd_attached(alpha_deg: number, polar: ContinuousPolar): number {
  const cl = cl_attached(alpha_deg, polar)
  return polar.cd_0 + polar.k * cl * cl
}

// ─── Flat-Plate Model ────────────────────────────────────────────────────────

/**
 * Flat-plate lift coefficient. Valid for any α.
 * CL_plate = CD_n · sin(α) · cos(α) = CD_n/2 · sin(2α)
 */
export function cl_plate(alpha_deg: number, cd_n: number): number {
  const alpha_rad = alpha_deg * DEG2RAD
  return cd_n * Math.sin(alpha_rad) * Math.cos(alpha_rad)
}

/**
 * Flat-plate drag coefficient. Valid for any α.
 * CD_plate = CD_n · sin²(α) + CD_0 · cos²(α)
 */
export function cd_plate(alpha_deg: number, cd_n: number, cd_0: number): number {
  const alpha_rad = alpha_deg * DEG2RAD
  const sinA = Math.sin(alpha_rad)
  const cosA = Math.cos(alpha_rad)
  return cd_n * sinA * sinA + cd_0 * cosA * cosA
}

// ─── Flat-Plate Pitching Moment ──────────────────────────────────────────────

/**
 * Flat-plate pitching moment. Approximation: CM ∝ sin(2α)
 * Negative = nose-down (restoring for positive α)
 */
export function cm_plate(alpha_deg: number): number {
  const alpha_rad = alpha_deg * DEG2RAD
  // Flat plate CM is roughly proportional to sin(2α), with a negative sign
  // for nose-down restoring moment
  return -0.1 * Math.sin(2 * alpha_rad)
}

/**
 * Flat-plate center of pressure.
 * For a flat plate, CP is at ~0.25 chord at small α, moves toward 0.5 at 90°.
 */
export function cp_plate(alpha_deg: number): number {
  const alpha_rad = Math.abs(alpha_deg) * DEG2RAD
  // Blend from 0.25 (thin airfoil) to 0.5 (broadside flat plate)
  const t = Math.sin(alpha_rad)
  return 0.25 + 0.25 * t
}
