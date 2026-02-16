/**
 * 6DOF simulation core — derivative evaluation and integration.
 *
 * Pure math.  No Three.js, DOM, or rendering dependencies.
 * Portable to CloudBASE.
 *
 * This module implements the sim loop from SIMULATION.md §6:
 *   1. Derivative evaluation — single function of state
 *   2. Forward Euler integrator (baseline)
 *   3. RK4 integrator (optional, 4× derivative cost)
 *
 * See SIMULATION.md for full derivation and conventions.
 */

import type { SimState, SimDerivatives, SimConfig } from './sim-state.ts'
import type { Vec3NED } from './aero-segment.ts'
import { evaluateAeroForces } from './aero-segment.ts'
import {
  gravityBody,
  translationalEOM,
  translationalEOMAnisotropic,
  rotationalEOM,
  eulerRates,
  bodyToInertialVelocity,
} from './eom.ts'

// ─── Derivative Evaluation ──────────────────────────────────────────────────

/**
 * Compute all 12 state derivatives from the current state and configuration.
 *
 * This is f(state) from SIMULATION.md §6.1:
 *
 *   1. Aero model  → evaluateAeroForces() with ω×r corrections
 *   2. Gravity     → gravityBody(φ, θ)
 *   3. Total force → F_aero + m·g_B
 *   4. Translational dynamics → (u̇, v̇, ẇ)
 *   5. Rotational dynamics   → (ṗ, q̇, ṙ)
 *   6. Rotational kinematics → (φ̇, θ̇, ψ̇)
 *   7. Translational kinematics → (ẋ, ẏ, ż)
 *
 * @param state   Current 12-state vector
 * @param config  Configuration snapshot (segments, inertia, mass, etc.)
 */
export function computeDerivatives(
  state: SimState,
  config: SimConfig,
): SimDerivatives {
  const { u, v, w, phi, theta, psi, p, q, r } = state
  const { segments, controls, cgMeters, inertia, mass, massPerAxis, height, rho } = config

  // 1. Aero forces and moments (with ω×r per-segment velocity correction)
  const aero = evaluateAeroForces(
    segments, cgMeters, height,
    { x: u, y: v, z: w },
    { p, q, r },
    controls, rho,
  )

  // 2. Gravity in body frame
  const gB = gravityBody(phi, theta)

  // 3. Total force = aero + weight
  const totalForce: Vec3NED = {
    x: aero.force.x + mass * gB.x,
    y: aero.force.y + mass * gB.y,
    z: aero.force.z + mass * gB.z,
  }

  // 4. Translational dynamics: (u̇, v̇, ẇ)
  //    Use anisotropic EOM when per-axis mass is available (apparent mass),
  //    otherwise fall back to isotropic.
  const transAccel = massPerAxis
    ? translationalEOMAnisotropic(
        totalForce, massPerAxis,
        { x: u, y: v, z: w },
        { p, q, r },
      )
    : translationalEOM(
        totalForce, mass,
        { x: u, y: v, z: w },
        { p, q, r },
      )

  // 5. Rotational dynamics: (ṗ, q̇, ṙ)
  const rotAccel = rotationalEOM(aero.moment, inertia, { p, q, r })

  // 6. Rotational kinematics: body rates → Euler rates
  const eulerRate = eulerRates(p, q, r, phi, theta)

  // 7. Translational kinematics: body velocity → inertial velocity
  const inertialVel = bodyToInertialVelocity(u, v, w, phi, theta, psi)

  return {
    xDot: inertialVel.x,
    yDot: inertialVel.y,
    zDot: inertialVel.z,
    uDot: transAccel.uDot,
    vDot: transAccel.vDot,
    wDot: transAccel.wDot,
    phiDot: eulerRate.phiDot,
    thetaDot: eulerRate.thetaDot,
    psiDot: eulerRate.psiDot,
    pDot: rotAccel.pDot,
    qDot: rotAccel.qDot,
    rDot: rotAccel.rDot,
  }
}

// ─── Forward Euler Integrator ───────────────────────────────────────────────

/**
 * Advance the state by one Forward Euler step.
 *
 *   state(t + dt) = state(t) + dt · f(state(t))
 *
 * @param state  Current state
 * @param deriv  Derivatives at current state (from computeDerivatives)
 * @param dt     Time step [s]
 */
export function forwardEuler(
  state: SimState,
  deriv: SimDerivatives,
  dt: number,
): SimState {
  return {
    x:     state.x     + deriv.xDot     * dt,
    y:     state.y     + deriv.yDot     * dt,
    z:     state.z     + deriv.zDot     * dt,
    u:     state.u     + deriv.uDot     * dt,
    v:     state.v     + deriv.vDot     * dt,
    w:     state.w     + deriv.wDot     * dt,
    phi:   state.phi   + deriv.phiDot   * dt,
    theta: state.theta + deriv.thetaDot * dt,
    psi:   state.psi   + deriv.psiDot   * dt,
    p:     state.p     + deriv.pDot     * dt,
    q:     state.q     + deriv.qDot     * dt,
    r:     state.r     + deriv.rDot     * dt,
  }
}

// ─── RK4 Integrator ─────────────────────────────────────────────────────────

/**
 * Advance the state by one 4th-order Runge-Kutta step.
 *
 *   k1 = f(state)
 *   k2 = f(state + dt/2 · k1)
 *   k3 = f(state + dt/2 · k2)
 *   k4 = f(state + dt   · k3)
 *   state(t + dt) = state(t) + dt/6 · (k1 + 2k2 + 2k3 + k4)
 *
 * 4× the cost of Forward Euler per step.  Use only when needed.
 *
 * @param state   Current state
 * @param config  Configuration snapshot
 * @param dt      Time step [s]
 */
export function rk4Step(
  state: SimState,
  config: SimConfig,
  dt: number,
): SimState {
  const k1 = computeDerivatives(state, config)
  const k2 = computeDerivatives(forwardEuler(state, k1, dt / 2), config)
  const k3 = computeDerivatives(forwardEuler(state, k2, dt / 2), config)
  const k4 = computeDerivatives(forwardEuler(state, k3, dt), config)

  // Weighted average: (k1 + 2k2 + 2k3 + k4) / 6
  const avg: SimDerivatives = {
    xDot:     (k1.xDot     + 2 * k2.xDot     + 2 * k3.xDot     + k4.xDot)     / 6,
    yDot:     (k1.yDot     + 2 * k2.yDot     + 2 * k3.yDot     + k4.yDot)     / 6,
    zDot:     (k1.zDot     + 2 * k2.zDot     + 2 * k3.zDot     + k4.zDot)     / 6,
    uDot:     (k1.uDot     + 2 * k2.uDot     + 2 * k3.uDot     + k4.uDot)     / 6,
    vDot:     (k1.vDot     + 2 * k2.vDot     + 2 * k3.vDot     + k4.vDot)     / 6,
    wDot:     (k1.wDot     + 2 * k2.wDot     + 2 * k3.wDot     + k4.wDot)     / 6,
    phiDot:   (k1.phiDot   + 2 * k2.phiDot   + 2 * k3.phiDot   + k4.phiDot)   / 6,
    thetaDot: (k1.thetaDot + 2 * k2.thetaDot + 2 * k3.thetaDot + k4.thetaDot) / 6,
    psiDot:   (k1.psiDot   + 2 * k2.psiDot   + 2 * k3.psiDot   + k4.psiDot)   / 6,
    pDot:     (k1.pDot     + 2 * k2.pDot     + 2 * k3.pDot     + k4.pDot)     / 6,
    qDot:     (k1.qDot     + 2 * k2.qDot     + 2 * k3.qDot     + k4.qDot)     / 6,
    rDot:     (k1.rDot     + 2 * k2.rDot     + 2 * k3.rDot     + k4.rDot)     / 6,
  }

  return forwardEuler(state, avg, dt)
}

// ─── Multi-Step Runner ──────────────────────────────────────────────────────

/**
 * Run the simulation for N steps using Forward Euler.
 *
 * Returns the final state.  For recording trajectories, call
 * forwardEuler() in a loop and capture intermediate states.
 *
 * @param state   Initial state
 * @param config  Configuration snapshot
 * @param dt      Time step [s]
 * @param steps   Number of integration steps
 */
export function simulate(
  state: SimState,
  config: SimConfig,
  dt: number,
  steps: number,
): SimState {
  let current = state
  for (let i = 0; i < steps; i++) {
    const deriv = computeDerivatives(current, config)
    current = forwardEuler(current, deriv, dt)
  }
  return current
}
