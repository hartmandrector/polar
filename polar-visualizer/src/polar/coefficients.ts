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

// ─── Pseudo-Coefficients (Net Force Decomposition) ───────────────────────────

/**
 * Pseudo-coefficients from net force decomposition.
 * Follows WSE.java calculateWingsuitParameters() convention.
 */
export interface PseudoCoefficients {
  kl: number        // pseudo lift coefficient
  kd: number        // pseudo drag coefficient
  roll: number      // roll angle [rad]
  vxs: number       // sustained horizontal speed [m/s]
  vys: number       // sustained vertical speed [m/s]
  glideRatio: number // kl / kd
}

/**
 * Decompose net force (aero + weight) into pseudo kl, kd, roll.
 *
 * Both inputs must be in **inertial NED** (not body frame).
 * In inertial NED, gravity = (0, 0, +g) so only the D-component
 * needs correction — N and E are already aerodynamic-only.
 *
 * This matches WSE.java calculateWingsuitParameters(), adapted from ENU to NED.
 *
 * @param netForce  Total force (aero + weight) in inertial NED [N]
 * @param velocity  Velocity vector in inertial NED [m/s]
 * @param mass      System mass [kg]
 */
export function netForceToPseudo(
  netForce: { x: number; y: number; z: number },
  velocity: { x: number; y: number; z: number },
  mass: number,
): PseudoCoefficients {
  const g = 9.80665

  // Total acceleration
  const aN = netForce.x / mass
  const aE = netForce.y / mass
  const aD = netForce.z / mass

  // Subtract gravity from down-component (isolate aerodynamic acceleration)
  const aDaero = aD - g

  // Speed
  const vN = velocity.x
  const vE = velocity.y
  const vD = velocity.z
  const v = Math.sqrt(vN * vN + vE * vE + vD * vD)
  const vGround = Math.sqrt(vN * vN + vE * vE)

  if (v < 0.01) {
    return { kl: 0, kd: 0, roll: 0, vxs: 0, vys: 0, glideRatio: 0 }
  }

  // Drag acceleration: projection of aero acceleration onto velocity
  const aProj = (aN * vN + aE * vE + aDaero * vD) / v
  const dragN = aProj * vN / v
  const dragE = aProj * vE / v
  const dragD = aProj * vD / v

  // Drag scalar (sign-corrected: drag opposes velocity)
  const dragDotV = dragN * vN + dragE * vE + dragD * vD
  const dragMag = Math.sqrt(dragN * dragN + dragE * dragE + dragD * dragD)
  const aDscalar = dragDotV > 0 ? -dragMag : dragMag

  // Lift acceleration: rejection (perpendicular to velocity)
  const liftN = aN - dragN
  const liftE = aE - dragE
  const liftD = aDaero - dragD
  const aL = Math.sqrt(liftN * liftN + liftE * liftE + liftD * liftD)

  // Pseudo-coefficients: normalize by g·v²
  const kl = aL / (g * v * v)
  const kd = aDscalar / (g * v * v)

  // Roll angle — uses raw aD (with gravity, NOT aDaero)
  let roll = 0
  if (kl * vGround * v > 1e-10) {
    const cosRoll = (1 - aD / g - kd * v * vD) / (kl * vGround * v)
    const clampedCos = Math.max(-1, Math.min(1, cosRoll))
    roll = Math.acos(clampedCos)
    // Sign from cross product of lift and velocity tangent
    const sign = liftN * (-vE) + liftE * vN
    if (sign < 0) roll = -roll
  }

  // Pseudo sustained speeds
  const klkd = kl * kl + kd * kd
  const denom = klkd > 1e-20 ? Math.pow(klkd, 0.75) : 1e-10
  const vxs = kl / denom
  const vys = kd / denom

  const glideRatio = Math.abs(kd) > 1e-10 ? kl / kd : 0

  return { kl, kd, roll, vxs, vys, glideRatio }
}

// ─── Polar Interpolation ─────────────────────────────────────────────────────

/**
 * Linearly interpolate every scalar field between two ContinuousPolar objects.
 *
 * t = 0 → returns polarA (all values from A)
 * t = 1 → returns polarB (all values from B)
 * 0 < t < 1 → blended polar
 *
 * Non-scalar fields (name, type, controls, massSegments, aeroSegments, etc.)
 * are taken from polarA. Only aerodynamic scalars are interpolated.
 */
export function lerpPolar(t: number, polarA: ContinuousPolar, polarB: ContinuousPolar): ContinuousPolar {
  const lerp = (a: number, b: number) => a + t * (b - a)
  return {
    ...polarA,
    // Attached-flow lift
    cl_alpha:        lerp(polarA.cl_alpha,        polarB.cl_alpha),
    alpha_0:         lerp(polarA.alpha_0,         polarB.alpha_0),
    // Drag
    cd_0:            lerp(polarA.cd_0,            polarB.cd_0),
    k:               lerp(polarA.k,               polarB.k),
    // Separated flow
    cd_n:            lerp(polarA.cd_n,            polarB.cd_n),
    cd_n_lateral:    lerp(polarA.cd_n_lateral,    polarB.cd_n_lateral),
    // Stall
    alpha_stall_fwd: lerp(polarA.alpha_stall_fwd, polarB.alpha_stall_fwd),
    s1_fwd:          lerp(polarA.s1_fwd,          polarB.s1_fwd),
    alpha_stall_back:lerp(polarA.alpha_stall_back,polarB.alpha_stall_back),
    s1_back:         lerp(polarA.s1_back,         polarB.s1_back),
    // Side force & moments
    cy_beta:         lerp(polarA.cy_beta,         polarB.cy_beta),
    cn_beta:         lerp(polarA.cn_beta,         polarB.cn_beta),
    cl_beta:         lerp(polarA.cl_beta,         polarB.cl_beta),
    // Pitching moment
    cm_0:            lerp(polarA.cm_0,            polarB.cm_0),
    cm_alpha:        lerp(polarA.cm_alpha,        polarB.cm_alpha),
    // Center of pressure
    cp_0:            lerp(polarA.cp_0,            polarB.cp_0),
    cp_alpha:        lerp(polarA.cp_alpha,        polarB.cp_alpha),
    // CG
    cg:              lerp(polarA.cg,              polarB.cg),
    cp_lateral:      lerp(polarA.cp_lateral,      polarB.cp_lateral),
    // Physical
    s:               lerp(polarA.s,               polarB.s),
    m:               lerp(polarA.m,               polarB.m),
    chord:           lerp(polarA.chord,           polarB.chord),
  }
}
