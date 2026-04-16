/**
 * Control Inversion Solver (Pass 2)
 *
 * Given GPS-measured angular accelerations and the segment aero model,
 * solves for the pilot control inputs that explain the difference between
 * predicted (neutral) and measured (actual) rotational dynamics.
 *
 * For wingsuit: 3 unknowns (pitchThrottle, rollThrottle, yawThrottle)
 *               3 equations (Mx, My, Mz moment balance)
 *
 * Method: Newton-Raphson on the 3×3 Jacobian ∂M/∂u.
 * The Jacobian is computed numerically by perturbing each control.
 */

import {
  evaluateAeroForcesDetailed,
  defaultControls,
  type Vec3NED,
} from '../polar/aero-segment'
import type { AeroSegment, SegmentControls } from '../polar/continuous-polar'
import type { InertiaComponents } from '../polar/inertia'
import type { GPSPipelinePoint } from '../gps/types'
import type { MomentBreakdown, AxisMoments, CanopyControlMap, ControlMomentContrib } from './moment-types'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ControlInversionConfig {
  segments: AeroSegment[]
  cgMeters: Vec3NED
  height: number
  mass: number
  inertia: InertiaComponents
  rho?: number
  /** Roll throttle gain for GPS inversion (default 1.0) — scales roll authority beyond gamepad model */
  rollGain?: number
  /** Canopy control gain for GPS inversion (default 1.0) — scales all canopy control authority */
  canopyControlGain?: number
  /** Canopy body-frame orientation for gravity torque computation */
  phi?: number    // roll [rad]
  theta?: number  // pitch [rad]
  /** Riser length: pilot CG to canopy attachment [m] (default 6.0) */
  riserLength?: number
}

export interface ControlInversionResult {
  /** Solved control inputs [-1, 1] */
  pitchThrottle: number
  rollThrottle: number
  yawThrottle: number
  /** Moment breakdown per axis */
  moments: AxisMoments
  /** Did the solver converge? */
  converged: boolean
  /** Number of iterations */
  iterations: number
  /** Final residual norm (N·m) */
  residual: number
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_ITER = 8
const CONVERGE_THRESHOLD = 0.5  // N·m residual norm
const PERTURBATION = 0.01       // control perturbation for Jacobian
const CONTROL_CLAMP = 1.0        // match segment model clamp (getCoeffs clamps to ±1)
const D2R = Math.PI / 180

// ─── Solver ─────────────────────────────────────────────────────────────────

/**
 * Solve for pilot control inputs at a single GPS timestep.
 *
 * Compares predicted angular acceleration (from aero model at given controls)
 * against measured angular acceleration (from GPS pipeline).
 * Adjusts controls to minimize the residual.
 */
export function solveControlInputs(
  pt: GPSPipelinePoint,
  config: ControlInversionConfig,
  prevControls?: [number, number, number],
): ControlInversionResult {
  const rho = config.rho ?? 1.225

  // Measured angular acceleration [rad/s²]
  const pDotMeas = (pt.bodyRates?.pDot ?? 0) * D2R
  const qDotMeas = (pt.bodyRates?.qDot ?? 0) * D2R
  const rDotMeas = (pt.bodyRates?.rDot ?? 0) * D2R

  // Body velocity from airspeed + AOA
  const V = pt.processed.airspeed
  const alpha = pt.aero.aoa
  const cosA = Math.cos(alpha), sinA = Math.sin(alpha)
  const bodyVel: Vec3NED = { x: V * cosA, y: 0, z: V * sinA }

  // Body rates [rad/s]
  const omega = {
    p: (pt.bodyRates?.p ?? 0) * D2R,
    q: (pt.bodyRates?.q ?? 0) * D2R,
    r: (pt.bodyRates?.r ?? 0) * D2R,
  }

  // Required total moment from measured angular acceleration
  // M_required = I · α_meas + ω × (I · ω)  [Euler's rotation equation]
  const { Ixx, Iyy, Izz, Ixz } = config.inertia
  const Lreq = Ixx * pDotMeas - Ixz * rDotMeas
    + (Izz - Iyy) * omega.q * omega.r + Ixz * omega.p * omega.q
  const Mreq = Iyy * qDotMeas
    + (Ixx - Izz) * omega.p * omega.r + Ixz * (omega.p * omega.p - omega.r * omega.r)
  const Nreq = Izz * rDotMeas - Ixz * pDotMeas
    + (Iyy - Ixx) * omega.p * omega.q + Ixz * omega.q * omega.r

  const rollGain = config.rollGain ?? 1.0

  // Helper: evaluate aero moments for given control vector
  function evalMoments(pitch: number, roll: number, yaw: number): Vec3NED {
    const ctrl = defaultControls()
    ctrl.pitchThrottle = pitch
    ctrl.rollThrottle = roll * rollGain
    ctrl.yawThrottle = yaw
    const result = evaluateAeroForcesDetailed(
      config.segments, config.cgMeters, config.height,
      bodyVel, omega, ctrl, rho,
    )
    return result.system.moment
  }

  // Newton-Raphson iteration — seed from previous timestep if available
  let u = prevControls ? [...prevControls] : [0, 0, 0]
  let converged = false
  let iter = 0

  // Get neutral moments for breakdown
  const M0 = evalMoments(0, 0, 0)

  for (iter = 0; iter < MAX_ITER; iter++) {
    // Current predicted moments
    const M = evalMoments(u[0], u[1], u[2])

    // Residual: predicted - required
    const res = [M.x - Lreq, M.y - Mreq, M.z - Nreq]
    const norm = Math.sqrt(res[0] * res[0] + res[1] * res[1] + res[2] * res[2])

    if (norm < CONVERGE_THRESHOLD) {
      converged = true
      break
    }

    // Numerical Jacobian (3×3): ∂M/∂u
    const J: number[][] = [[], [], []]
    for (let j = 0; j < 3; j++) {
      const uP = [...u]
      uP[j] += PERTURBATION
      const Mp = evalMoments(uP[0], uP[1], uP[2])
      J[0][j] = (Mp.x - M.x) / PERTURBATION
      J[1][j] = (Mp.y - M.y) / PERTURBATION
      J[2][j] = (Mp.z - M.z) / PERTURBATION
    }

    // Solve J · du = -res via Cramer's rule (3×3)
    const du = solve3x3(J, [-res[0], -res[1], -res[2]])
    if (!du) break  // singular Jacobian

    // Update with damping
    const damping = 0.7
    u[0] = clamp(u[0] + du[0] * damping, -CONTROL_CLAMP, CONTROL_CLAMP)
    u[1] = clamp(u[1] + du[1] * damping, -CONTROL_CLAMP, CONTROL_CLAMP)
    u[2] = clamp(u[2] + du[2] * damping, -CONTROL_CLAMP, CONTROL_CLAMP)
  }

  // Final evaluation with solved controls
  const Mfinal = evalMoments(u[0], u[1], u[2])
  const finalRes = [Mfinal.x - Lreq, Mfinal.y - Mreq, Mfinal.z - Nreq]
  const finalNorm = Math.sqrt(finalRes[0] * finalRes[0] + finalRes[1] * finalRes[1] + finalRes[2] * finalRes[2])

  // Gyroscopic terms (ω × Iω)
  const gyroL = (Izz - Iyy) * omega.q * omega.r + Ixz * omega.p * omega.q
  const gyroM = (Ixx - Izz) * omega.p * omega.r + Ixz * (omega.p * omega.p - omega.r * omega.r)
  const gyroN = (Iyy - Ixx) * omega.p * omega.q + Ixz * omega.q * omega.r

  // I·α — pure rotational acceleration demand (measured)
  const IalphaL = Ixx * pDotMeas - Ixz * rDotMeas
  const IalphaM = Iyy * qDotMeas
  const IalphaN = Izz * rDotMeas - Ixz * pDotMeas

  // Pilot moment = solved total - neutral aero
  const pilotL = Mfinal.x - M0.x
  const pilotM = Mfinal.y - M0.y
  const pilotN = Mfinal.z - M0.z

  return {
    pitchThrottle: u[0],
    rollThrottle: u[1],
    yawThrottle: u[2],
    moments: {
      roll:  { aero: M0.x, pilot: pilotL, gyro: gyroL, net: IalphaL },
      pitch: { aero: M0.y, pilot: pilotM, gyro: gyroM, net: IalphaM },
      yaw:   { aero: M0.z, pilot: pilotN, gyro: gyroN, net: IalphaN },
    },
    converged,
    iterations: iter,
    residual: finalNorm,
  }
}

// ─── Linear Algebra Helpers ─────────────────────────────────────────────────

function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  )
}

/** Solve Ax = b for 3×3 system via Cramer's rule. Returns null if singular. */
function solve3x3(A: number[][], b: number[]): number[] | null {
  const d = det3(A)
  if (Math.abs(d) < 1e-12) return null

  const result: number[] = []
  for (let i = 0; i < 3; i++) {
    const Ai = A.map(row => [...row])
    Ai[0][i] = b[0]
    Ai[1][i] = b[1]
    Ai[2][i] = b[2]
    result.push(det3(Ai) / d)
  }
  return result
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

// ─── Canopy Control Solver ──────────────────────────────────────────────────

export interface CanopyControlResult {
  brakeLeft: number
  brakeRight: number
  frontRiserLeft: number
  frontRiserRight: number
  moments: AxisMoments
  /** Per-control moment contributions (how each control maps to each axis) */
  controlMap: CanopyControlMap
  converged: boolean
  iterations: number
  residual: number
}

/**
 * Solve for canopy control inputs at a single GPS timestep.
 *
 * 4 unknowns (brakeLeft, brakeRight, frontRiserLeft, frontRiserRight),
 * 3 moment equations (roll, pitch, yaw).
 *
 * Uses damped least-squares (pseudo-inverse) with L2 regularization
 * to prefer minimum total input. This naturally separates: brakes for
 * pitch-up / yaw, front risers for pitch-down / roll.
 *
 * Brakes clamped [0, 1], front risers clamped [0, 1].
 */
/** Which canopy controls the solver is allowed to use */
export type CanopyControlConstraint = 'all' | 'brakes-only' | 'risers-only' | 'auto'

export function solveCanopyControls(
  pt: GPSPipelinePoint,
  config: ControlInversionConfig,
  prevControls?: [number, number, number, number],
  constraint: CanopyControlConstraint = 'auto',
): CanopyControlResult {
  if (constraint === 'auto') {
    // Try both constraints, pick the one with lower residual
    const brakeSol = solveCanopyControls(pt, config, prevControls, 'brakes-only')
    const riserSol = solveCanopyControls(pt, config, prevControls, 'risers-only')
    // Prefer converged solution; if both converge (or neither), pick lower residual
    let winner: CanopyControlResult
    let reason: string
    if (brakeSol.converged && !riserSol.converged) {
      winner = brakeSol; reason = 'brakes converged'
    } else if (riserSol.converged && !brakeSol.converged) {
      winner = riserSol; reason = 'risers converged'
    } else if (brakeSol.residual <= riserSol.residual) {
      winner = brakeSol; reason = `brakes res=${brakeSol.residual.toFixed(1)} < risers=${riserSol.residual.toFixed(1)}`
    } else {
      winner = riserSol; reason = `risers res=${riserSol.residual.toFixed(1)} < brakes=${brakeSol.residual.toFixed(1)}`
    }
    // Log the auto-select decision (remove once stable)
    if ((solveCanopyControls as any)._logCount === undefined) (solveCanopyControls as any)._logCount = 0
    if ((solveCanopyControls as any)._logCount++ < 5) {
      console.log(`[CanopySolver auto] ${reason} | brakes=[${brakeSol.brakeLeft.toFixed(2)},${brakeSol.brakeRight.toFixed(2)}] risers=[${riserSol.frontRiserLeft.toFixed(2)},${riserSol.frontRiserRight.toFixed(2)}]`)
      console.log(`  bodyRates: p=${pt.bodyRates?.p?.toFixed(1)} q=${pt.bodyRates?.q?.toFixed(1)} r=${pt.bodyRates?.r?.toFixed(1)} pDot=${pt.bodyRates?.pDot?.toFixed(1)} qDot=${pt.bodyRates?.qDot?.toFixed(1)} rDot=${pt.bodyRates?.rDot?.toFixed(1)}`)
    }
    return winner
  }
  const rho = config.rho ?? 1.225

  const pDotMeas = (pt.bodyRates?.pDot ?? 0) * D2R
  const qDotMeas = (pt.bodyRates?.qDot ?? 0) * D2R
  const rDotMeas = (pt.bodyRates?.rDot ?? 0) * D2R

  const V = pt.processed.airspeed
  const alpha = pt.aero.aoa
  const cosA = Math.cos(alpha), sinA = Math.sin(alpha)
  const bodyVel: Vec3NED = { x: V * cosA, y: 0, z: V * sinA }

  const omega = {
    p: (pt.bodyRates?.p ?? 0) * D2R,
    q: (pt.bodyRates?.q ?? 0) * D2R,
    r: (pt.bodyRates?.r ?? 0) * D2R,
  }

  const { Ixx, Iyy, Izz, Ixz } = config.inertia
  let Lreq = Ixx * pDotMeas - Ixz * rDotMeas
    + (Izz - Iyy) * omega.q * omega.r + Ixz * omega.p * omega.q
  let Mreq = Iyy * qDotMeas
    + (Ixx - Izz) * omega.p * omega.r + Ixz * (omega.p * omega.p - omega.r * omega.r)
  let Nreq = Izz * rDotMeas - Ixz * pDotMeas
    + (Iyy - Ixx) * omega.p * omega.q + Ixz * omega.q * omega.r

  // ── Gravity torque correction ──
  // The pilot hangs below the canopy on risers. Gravity acting on the pilot
  // mass through the riser offset creates restoring moments in roll and pitch
  // that the aero model doesn't produce. Subtract these from the required
  // moments so the solver only needs to explain the aero-control portion.
  //
  // τ_roll  = -m * g * L * sin(φ)   (restoring: rolls back toward wings-level)
  // τ_pitch = -m * g * L * sin(θ)   (restoring: pitches back toward level)
  // Yaw: no gravity torque (gravity acts through vertical, no yaw arm)
  if (config.phi !== undefined && config.theta !== undefined) {
    const g = 9.80665
    const L = config.riserLength ?? 6.0
    const gravRoll  = -config.mass * g * L * Math.sin(config.phi)
    const gravPitch = -config.mass * g * L * Math.sin(config.theta)
    Lreq -= gravRoll   // subtract gravity contribution from what aero must explain
    Mreq -= gravPitch
  }

  const canopyGain = config.canopyControlGain ?? 1.0

  // u = [brakeLeft, brakeRight, frontRiserLeft, frontRiserRight]
  function evalMoments(bL: number, bR: number, frL: number, frR: number): Vec3NED {
    const ctrl = defaultControls()
    ctrl.brakeLeft = bL * canopyGain
    ctrl.brakeRight = bR * canopyGain
    ctrl.frontRiserLeft = frL * canopyGain
    ctrl.frontRiserRight = frR * canopyGain
    const result = evaluateAeroForcesDetailed(
      config.segments, config.cgMeters, config.height,
      bodyVel, omega, ctrl, rho,
    )
    return result.system.moment
  }

  // One-time diagnostic: log moment produced by each control at 100%
  // Only fires when significant rotation exists (likely in a turn)
  {
    const rateNorm = Math.sqrt(omega.p * omega.p + omega.q * omega.q + omega.r * omega.r) * 180 / Math.PI
    if ((solveCanopyControls as any)._diagDone === undefined) (solveCanopyControls as any)._diagDone = false
    if (!((solveCanopyControls as any)._diagDone) && rateNorm > 15) {
      (solveCanopyControls as any)._diagDone = true
      const M0d = evalMoments(0, 0, 0, 0)
      const MbL = evalMoments(1, 0, 0, 0)
      const MbR = evalMoments(0, 1, 0, 0)
      const MfL = evalMoments(0, 0, 1, 0)
      const MfR = evalMoments(0, 0, 0, 1)
      console.log(`[CanopySolver DIAG] constraint=${constraint} Neutral: L=${M0d.x.toFixed(1)} M=${M0d.y.toFixed(1)} N=${M0d.z.toFixed(1)}`)
      console.log(`  BrakeL@100%: dL=${(MbL.x-M0d.x).toFixed(1)} dM=${(MbL.y-M0d.y).toFixed(1)} dN=${(MbL.z-M0d.z).toFixed(1)}`)
      console.log(`  BrakeR@100%: dL=${(MbR.x-M0d.x).toFixed(1)} dM=${(MbR.y-M0d.y).toFixed(1)} dN=${(MbR.z-M0d.z).toFixed(1)}`)
      console.log(`  FrRisL@100%: dL=${(MfL.x-M0d.x).toFixed(1)} dM=${(MfL.y-M0d.y).toFixed(1)} dN=${(MfL.z-M0d.z).toFixed(1)}`)
      console.log(`  FrRisR@100%: dL=${(MfR.x-M0d.x).toFixed(1)} dM=${(MfR.y-M0d.y).toFixed(1)} dN=${(MfR.z-M0d.z).toFixed(1)}`)
      console.log(`  Required:    L=${Lreq.toFixed(1)} M=${Mreq.toFixed(1)} N=${Nreq.toFixed(1)}`)
    }
  }

  let u = prevControls ? [...prevControls] : [0, 0, 0, 0]
  let converged = false
  let iter = 0
  const lambda = 0.1  // L2 regularization weight (prefer small inputs)

  // Canopy moments are much larger than wingsuit — use relative threshold
  const reqNorm = Math.sqrt(Lreq * Lreq + Mreq * Mreq + Nreq * Nreq)
  const convergeThreshold = Math.max(CONVERGE_THRESHOLD, reqNorm * 0.05)  // 5% of demand or 0.5 N·m

  // Control mask: which of [bL, bR, frL, frR] are free to vary
  const free = [
    constraint !== 'risers-only',  // brakeLeft
    constraint !== 'risers-only',  // brakeRight
    constraint !== 'brakes-only',  // frontRiserLeft
    constraint !== 'brakes-only',  // frontRiserRight
  ]
  // Zero out locked controls
  for (let j = 0; j < 4; j++) if (!free[j]) u[j] = 0

  const M0 = evalMoments(0, 0, 0, 0)

  for (iter = 0; iter < MAX_ITER; iter++) {
    const M = evalMoments(u[0], u[1], u[2], u[3])

    const res = [M.x - Lreq, M.y - Mreq, M.z - Nreq]
    const norm = Math.sqrt(res[0] * res[0] + res[1] * res[1] + res[2] * res[2])

    if (norm < convergeThreshold) {
      converged = true
      break
    }

    // Numerical Jacobian (3×4): ∂(L,M,N)/∂(bL,bR,frL,frR)
    const J: number[][] = [[], [], []]
    for (let j = 0; j < 4; j++) {
      if (!free[j]) {
        // Locked control — zero Jacobian column
        J[0][j] = 0; J[1][j] = 0; J[2][j] = 0
        continue
      }
      const uP = [...u]
      uP[j] += PERTURBATION
      const Mp = evalMoments(uP[0], uP[1], uP[2], uP[3])
      J[0][j] = (Mp.x - M.x) / PERTURBATION
      J[1][j] = (Mp.y - M.y) / PERTURBATION
      J[2][j] = (Mp.z - M.z) / PERTURBATION
    }

    // Damped least-squares: du = Jᵀ(JJᵀ + λI)⁻¹ · (-res)
    // JJᵀ is 3×3, invert with Cramer's rule
    const JJT: number[][] = [[0,0,0],[0,0,0],[0,0,0]]
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let s = 0
        for (let k = 0; k < 4; k++) s += J[i][k] * J[j][k]
        JJT[i][j] = s + (i === j ? lambda : 0)
      }

    const rhs = [-res[0], -res[1], -res[2]]
    const v = solve3x3(JJT, rhs)
    if (!v) break  // singular

    // du = Jᵀ · v  (4×1 = 4×3 · 3×1)
    const du = [0, 0, 0, 0]
    for (let j = 0; j < 4; j++)
      for (let i = 0; i < 3; i++)
        du[j] += J[i][j] * v[i]

    const damping = 0.7
    u[0] = free[0] ? clamp(u[0] + du[0] * damping, 0, CONTROL_CLAMP) : 0  // brakeLeft
    u[1] = free[1] ? clamp(u[1] + du[1] * damping, 0, CONTROL_CLAMP) : 0  // brakeRight
    u[2] = free[2] ? clamp(u[2] + du[2] * damping, 0, CONTROL_CLAMP) : 0  // frontRiserLeft
    u[3] = free[3] ? clamp(u[3] + du[3] * damping, 0, CONTROL_CLAMP) : 0  // frontRiserRight
  }

  const Mfinal = evalMoments(u[0], u[1], u[2], u[3])
  const finalRes = [Mfinal.x - Lreq, Mfinal.y - Mreq, Mfinal.z - Nreq]
  const finalNorm = Math.sqrt(finalRes[0] * finalRes[0] + finalRes[1] * finalRes[1] + finalRes[2] * finalRes[2])

  const gyroL = (Izz - Iyy) * omega.q * omega.r + Ixz * omega.p * omega.q
  const gyroM = (Ixx - Izz) * omega.p * omega.r + Ixz * (omega.p * omega.p - omega.r * omega.r)
  const gyroN = (Iyy - Ixx) * omega.p * omega.q + Ixz * omega.q * omega.r

  // I·α — pure rotational acceleration demand (measured)
  const cIalphaL = Ixx * pDotMeas - Ixz * rDotMeas
  const cIalphaM = Iyy * qDotMeas
  const cIalphaN = Izz * rDotMeas - Ixz * pDotMeas

  const pilotL = Mfinal.x - M0.x
  const pilotM = Mfinal.y - M0.y
  const pilotN = Mfinal.z - M0.z

  // Per-control moment contributions: evaluate each control solo at solved value
  // Contribution = M(control_i at solved, others at 0) - M0
  // Note: sum of contributions may not exactly equal total pilot moment due to
  // cross-coupling, but it shows the primary effect of each control.
  function contrib(bL: number, bR: number, frL: number, frR: number): ControlMomentContrib {
    const m = evalMoments(bL, bR, frL, frR)
    return { roll: m.x - M0.x, pitch: m.y - M0.y, yaw: m.z - M0.z }
  }
  const controlMap: CanopyControlMap = {
    brakeLeft:       contrib(u[0], 0,    0,    0),
    brakeRight:      contrib(0,    u[1], 0,    0),
    frontRiserLeft:  contrib(0,    0,    u[2], 0),
    frontRiserRight: contrib(0,    0,    0,    u[3]),
  }

  return {
    brakeLeft: u[0],
    brakeRight: u[1],
    frontRiserLeft: u[2],
    frontRiserRight: u[3],
    moments: {
      roll:  { aero: M0.x, pilot: pilotL, gyro: gyroL, net: cIalphaL },
      pitch: { aero: M0.y, pilot: pilotM, gyro: gyroM, net: cIalphaM },
      yaw:   { aero: M0.z, pilot: pilotN, gyro: gyroN, net: cIalphaN },
    },
    controlMap,
    converged,
    iterations: iter,
    residual: finalNorm,
  }
}
