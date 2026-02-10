/**
 * Full-range blended coefficient functions.
 * 
 * Blends between attached-flow and flat-plate models using the
 * Kirchhoff separation function f(α).
 * 
 * This module is UI-independent.
 */

import { ContinuousPolar, FullCoefficients, SymmetricControl } from './continuous-polar.ts'
import {
  separation,
  cl_attached, cd_attached,
  cl_plate, cd_plate,
  cm_plate, cp_plate
} from './kirchhoff.ts'

const DEG2RAD = Math.PI / 180

// ─── Individual Coefficient Functions ────────────────────────────────────────

/**
 * Full-range lift coefficient with sideslip.
 * CL(α, β) = [f·CL_attached + (1-f)·CL_plate] · cos²(β)
 */
export function getCL(alpha_deg: number, beta_deg: number, _delta: number, polar: ContinuousPolar): number {
  const f = separation(alpha_deg, polar)
  const cl_att = cl_attached(alpha_deg, polar)
  const cl_fp = cl_plate(alpha_deg, polar.cd_n)
  const cl = f * cl_att + (1 - f) * cl_fp

  const beta_rad = beta_deg * DEG2RAD
  return cl * Math.cos(beta_rad) * Math.cos(beta_rad)
}

/**
 * Full-range drag coefficient with sideslip.
 * CD(α, β) = [f·CD_attached + (1-f)·CD_plate]·cos²(β) + CD_n_lateral·sin²(β)
 */
export function getCD(alpha_deg: number, beta_deg: number, _delta: number, polar: ContinuousPolar): number {
  const f = separation(alpha_deg, polar)
  const cd_att = cd_attached(alpha_deg, polar)
  const cd_fp = cd_plate(alpha_deg, polar.cd_n, polar.cd_0)
  const cd = f * cd_att + (1 - f) * cd_fp

  const beta_rad = beta_deg * DEG2RAD
  const cosB = Math.cos(beta_rad)
  const sinB = Math.sin(beta_rad)
  return cd * cosB * cosB + polar.cd_n_lateral * sinB * sinB
}

/**
 * Side force coefficient.
 * CY(β) = CY_β · sin(β) · cos(β)
 */
export function getCY(_alpha_deg: number, beta_deg: number, _delta: number, polar: ContinuousPolar): number {
  const beta_rad = beta_deg * DEG2RAD
  return polar.cy_beta * Math.sin(beta_rad) * Math.cos(beta_rad)
}

/**
 * Pitching moment coefficient.
 * Blends attached CM with flat-plate CM using separation function.
 */
export function getCM(alpha_deg: number, _delta: number, polar: ContinuousPolar): number {
  const f = separation(alpha_deg, polar)
  const alpha_rad = (alpha_deg - polar.alpha_0) * DEG2RAD
  const cm_att = polar.cm_0 + polar.cm_alpha * alpha_rad
  const cm_fp = cm_plate(alpha_deg)
  return f * cm_att + (1 - f) * cm_fp
}

/**
 * Center of pressure (fraction of chord from leading edge).
 * Blends attached CP with flat-plate CP using separation function.
 */
export function getCP(alpha_deg: number, _delta: number, polar: ContinuousPolar): number {
  const f = separation(alpha_deg, polar)
  const alpha_rad = (alpha_deg - polar.alpha_0) * DEG2RAD
  const cp_att = polar.cp_0 + polar.cp_alpha * alpha_rad
  // Clamp attached CP to [0, 1]
  const cp_att_clamped = Math.max(0, Math.min(1, cp_att))
  const cp_fp = cp_plate(alpha_deg)
  return f * cp_att_clamped + (1 - f) * cp_fp
}

// ─── Delta Morphing ──────────────────────────────────────────────────────────

/**
 * Apply a single SymmetricControl at a given magnitude to a polar.
 * P_out = P_in + amount · d_P
 */
function applyControl(polar: ContinuousPolar, ctrl: SymmetricControl, amount: number): ContinuousPolar {
  if (amount === 0) return polar
  return {
    ...polar,
    alpha_0:          polar.alpha_0          + (ctrl.d_alpha_0 ?? 0) * amount,
    cd_0:             polar.cd_0             + (ctrl.d_cd_0 ?? 0) * amount,
    cl_alpha:         polar.cl_alpha         + (ctrl.d_cl_alpha ?? 0) * amount,
    k:                polar.k                + (ctrl.d_k ?? 0) * amount,
    alpha_stall_fwd:  polar.alpha_stall_fwd  + (ctrl.d_alpha_stall_fwd ?? 0) * amount,
    alpha_stall_back: polar.alpha_stall_back + (ctrl.d_alpha_stall_back ?? 0) * amount,
    cd_n:             polar.cd_n             + (ctrl.d_cd_n ?? 0) * amount,
    cp_0:             polar.cp_0             + (ctrl.d_cp_0 ?? 0) * amount,
    cp_alpha:         polar.cp_alpha         + (ctrl.d_cp_alpha ?? 0) * amount,
    cm_0:             polar.cm_0             + (ctrl.cm_delta ?? 0) * amount,
  }
}

/**
 * Apply all active controls to the base polar.
 * δ (delta) drives the primary control (brake/arch/elevator).
 * dirty drives the dirty-flying degradation (wingsuit only for now).
 */
function applyAllControls(polar: ContinuousPolar, delta: number, dirty: number): ContinuousPolar {
  let p = polar

  // Primary control: brake > rear_riser > front_riser
  const primaryCtrl = polar.controls?.brake ?? polar.controls?.rear_riser ?? polar.controls?.front_riser
  if (primaryCtrl && delta !== 0) {
    p = applyControl(p, primaryCtrl, delta)
  }

  // Dirty flying
  const dirtyCtrl = polar.controls?.dirty
  if (dirtyCtrl && dirty !== 0) {
    p = applyControl(p, dirtyCtrl, dirty)
  }

  return p
}

// ─── Bundle: All Coefficients at Once ────────────────────────────────────────

/**
 * Evaluate all coefficients at once (efficient — single f(α) evaluation).
 * δ morphs polar parameters via primary SymmetricControl derivatives.
 * dirty morphs via dirty-flying SymmetricControl derivatives (additive).
 */
export function getAllCoefficients(
  alpha_deg: number,
  beta_deg: number,
  delta: number,
  polar: ContinuousPolar,
  dirty: number = 0
): FullCoefficients {
  // Apply all control morphing
  const p = applyAllControls(polar, delta, dirty)

  const f = separation(alpha_deg, p)

  // Lift
  const cl_att = cl_attached(alpha_deg, p)
  const cl_fp = cl_plate(alpha_deg, p.cd_n)
  let cl = f * cl_att + (1 - f) * cl_fp

  // Drag
  const cd_att = cd_attached(alpha_deg, p)
  const cd_fp = cd_plate(alpha_deg, p.cd_n, p.cd_0)
  let cd = f * cd_att + (1 - f) * cd_fp

  // Sideslip
  const beta_rad = beta_deg * DEG2RAD
  const cosB = Math.cos(beta_rad)
  const sinB = Math.sin(beta_rad)
  cl = cl * cosB * cosB
  cd = cd * cosB * cosB + p.cd_n_lateral * sinB * sinB

  // Side force
  const cy = p.cy_beta * Math.sin(beta_rad) * Math.cos(beta_rad)

  // Pitching moment
  const alpha_rad = (alpha_deg - p.alpha_0) * DEG2RAD
  const cm_att = p.cm_0 + p.cm_alpha * alpha_rad
  const cm_fp_val = cm_plate(alpha_deg)
  const cm = f * cm_att + (1 - f) * cm_fp_val

  // Center of pressure
  const cp_att = Math.max(0, Math.min(1, p.cp_0 + p.cp_alpha * alpha_rad))
  const cp_fp_val = cp_plate(alpha_deg)
  const cp = f * cp_att + (1 - f) * cp_fp_val

  // Yaw moment: independent Cn_β derivative with crossflow scaling
  const cn = p.cn_beta * sinB * cosB

  // Roll moment: independent Cl_β derivative with crossflow scaling
  const cl_roll = p.cl_beta * sinB * cosB

  return { cl, cd, cy, cm, cn, cl_roll, cp, f }
}

// ─── Force Conversions ───────────────────────────────────────────────────────

/**
 * Convert coefficients + flight conditions → forces in Newtons.
 * q = 0.5 · ρ · V²
 * Force = q · S · C
 */
export function coeffToForces(
  cl: number, cd: number, cy: number,
  s: number, m: number, rho: number, v: number
): { lift: number, drag: number, side: number, weight: number } {
  const q = 0.5 * rho * v * v
  return {
    lift: q * s * cl,
    drag: q * s * cd,
    side: q * s * cy,
    weight: m * 9.80665
  }
}

/**
 * Convert CL, CD → sustained equilibrium speeds.
 * At equilibrium: L = W·cos(γ), D = W·sin(γ)
 * V = sqrt(2·m·g / (ρ·S·sqrt(CL² + CD²)))
 */
export function coeffToSS(cl: number, cd: number, s: number, m: number, rho: number): { vxs: number, vys: number } {
  const g = 9.80665
  const ctot = Math.sqrt(cl * cl + cd * cd)
  if (ctot < 1e-10) return { vxs: 0, vys: 0 }
  const v = Math.sqrt((2 * m * g) / (rho * s * ctot))
  const vxs = v * cl / ctot
  const vys = v * cd / ctot
  return { vxs, vys }
}
