/**
 * trim-finder.ts — Find equilibrium (trim) state for a given airspeed.
 *
 * For parafoil systems: trims on translational equilibrium (uDot ≈ 0, wDot ≈ 0).
 * The pitching moment (qDot) is typically nonzero — stabilized by the pilot
 * pendulum in the real system. Reported separately.
 *
 * Uses Newton-Raphson with numerical Jacobian.
 */

import type { SimState, SimConfig, SimDerivatives } from '../../src/polar/sim-state.ts'
import { computeDerivatives } from '../../src/polar/sim.ts'

export interface TrimResult {
  state: SimState
  residual: number        // RSS of translational accelerations
  qDot: number            // remaining pitching moment [rad/s²]
  converged: boolean
  iterations: number
  airspeed_ms: number
  alpha_deg: number
  theta_deg: number
  gamma_deg: number       // flight path angle (θ - α)
}

/**
 * Find translational trim for a target airspeed.
 *
 * Solves for (α, θ) such that uDot ≈ 0 and wDot ≈ 0.
 */
export function findTrim(
  targetV: number,
  config: SimConfig,
  options?: {
    maxIter?: number
    tolerance?: number
    thetaGuess_deg?: number
    alphaGuess_deg?: number
  },
): TrimResult {
  const maxIter = options?.maxIter ?? 200
  const tol = options?.tolerance ?? 1e-6
  const RAD = 180 / Math.PI

  let alpha = (options?.alphaGuess_deg ?? 10) * Math.PI / 180
  let theta = (options?.thetaGuess_deg ?? -30) * Math.PI / 180

  for (let iter = 0; iter < maxIter; iter++) {
    const u = targetV * Math.cos(alpha)
    const w = targetV * Math.sin(alpha)

    const state: SimState = {
      x: 0, y: 0, z: 0,
      u, v: 0, w,
      phi: 0, theta, psi: 0,
      p: 0, q: 0, r: 0,
    }

    const d = computeDerivatives(state, config)
    const res = [d.uDot, d.wDot]
    const rss = Math.sqrt(res[0] ** 2 + res[1] ** 2)

    if (rss < tol) {
      return {
        state,
        residual: rss,
        qDot: d.qDot,
        converged: true,
        iterations: iter,
        airspeed_ms: targetV,
        alpha_deg: alpha * RAD,
        theta_deg: theta * RAD,
        gamma_deg: (theta - alpha) * RAD,
      }
    }

    // 2×2 Jacobian: ∂[uDot, wDot] / ∂[α, θ]
    const da = 0.0001
    const dt = 0.0001

    const dAlphaP = computeDerivatives({
      ...state, u: targetV * Math.cos(alpha + da), w: targetV * Math.sin(alpha + da),
    }, config)
    const dAlphaM = computeDerivatives({
      ...state, u: targetV * Math.cos(alpha - da), w: targetV * Math.sin(alpha - da),
    }, config)
    const dThetaP = computeDerivatives({ ...state, theta: theta + dt }, config)
    const dThetaM = computeDerivatives({ ...state, theta: theta - dt }, config)

    const J = [
      [(dAlphaP.uDot - dAlphaM.uDot) / (2 * da), (dThetaP.uDot - dThetaM.uDot) / (2 * dt)],
      [(dAlphaP.wDot - dAlphaM.wDot) / (2 * da), (dThetaP.wDot - dThetaM.wDot) / (2 * dt)],
    ]

    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0]
    if (Math.abs(det) < 1e-20) break

    const dAlpha = -(J[1][1] * res[0] - J[0][1] * res[1]) / det
    const dTheta = -(-J[1][0] * res[0] + J[0][0] * res[1]) / det

    // Damped update
    const maxStep = 0.05  // ~3° max step
    alpha += Math.max(-maxStep, Math.min(maxStep, dAlpha))
    theta += Math.max(-maxStep, Math.min(maxStep, dTheta))
  }

  // Return best guess
  const u = targetV * Math.cos(alpha)
  const w = targetV * Math.sin(alpha)
  const state: SimState = {
    x: 0, y: 0, z: 0,
    u, v: 0, w,
    phi: 0, theta, psi: 0,
    p: 0, q: 0, r: 0,
  }
  const d = computeDerivatives(state, config)

  return {
    state,
    residual: Math.sqrt(d.uDot ** 2 + d.wDot ** 2),
    qDot: d.qDot,
    converged: false,
    iterations: maxIter,
    airspeed_ms: targetV,
    alpha_deg: alpha * RAD,
    theta_deg: theta * RAD,
    gamma_deg: (theta - alpha) * RAD,
  }
}
