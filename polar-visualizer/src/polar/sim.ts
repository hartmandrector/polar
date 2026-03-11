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
  pilotPendulumEOM,
  pilotLateralEOM,
  pilotTwistEOM,
  pilotSwingDampingTorque,
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
    // Pilot coupling derivatives (zero when not active)
    ...computePilotCouplingDerivatives(state, config, rotAccel.qDot),
  }
}

// ─── Pilot Coupling Derivative Helper ───────────────────────────────────────

import type { SimStateExtended } from './sim-state.ts'

/**
 * Compute pilot coupling derivatives for all 3 relative DOFs.
 * Returns empty object when pilotCoupling is not configured.
 */
function computePilotCouplingDerivatives(
  state: SimState,
  config: SimConfig,
  qDotCanopy: number,
): Partial<SimDerivatives> {
  const pc = config.pilotCoupling
  if (!pc) return {}

  // Cast to extended state (fields default to 0 if absent)
  const ext = state as Partial<SimStateExtended>
  const thetaPilot = ext.thetaPilot ?? 0
  const thetaPilotDot = ext.thetaPilotDot ?? 0
  const pilotRoll = ext.pilotRoll ?? 0
  const pilotRollDot = ext.pilotRollDot ?? 0
  const pilotYaw = ext.pilotYaw ?? 0
  const pilotYawDot = ext.pilotYawDot ?? 0

  // Aerodynamic damping torque on pilot body due to pitch swing
  // Drag opposes swing — natural stabilization at speed
  let aeroDampTorque = 0
  if (pc.pilotSegments && pc.pivotNED && Math.abs(thetaPilotDot) > 1e-6) {
    aeroDampTorque = pilotSwingDampingTorque(
      pc.pilotSegments,
      pc.pivotNED.x,
      pc.pivotNED.z,
      thetaPilotDot,
      config.rho,
      config.height,
      pc.pilotMass,
    )
  }

  // Pitch pendulum — gravity restoring + aero damping + canopy coupling.
  // Use tracked body-frame gravity vector instead of state.theta to avoid
  // Euler angle singularity corruption.
  const gx = ext.gravBodyX ?? -Math.sin(state.theta)
  const gz = ext.gravBodyZ ?? Math.cos(state.theta)
  // Log comparison: tracked gravity vector vs Euler-derived
  const now = performance.now()
  if (!(computePilotCouplingDerivatives as any)._lastLog || now - (computePilotCouplingDerivatives as any)._lastLog > 1000) {
    (computePilotCouplingDerivatives as any)._lastLog = now
    const eulerGx = -Math.sin(state.theta)
    const eulerGz = Math.cos(state.theta)
    const thetaFromGrav = Math.atan2(-gx, gz) * 180 / Math.PI
    console.log(
      `[GravCompare] θ_euler=${(state.theta * 180 / Math.PI).toFixed(1)}°` +
      ` θ_grav=${thetaFromGrav.toFixed(1)}°` +
      ` euler(gx=${eulerGx.toFixed(3)},gz=${eulerGz.toFixed(3)})` +
      ` tracked(gx=${gx.toFixed(3)},gz=${gz.toFixed(3)})`,
    )
  }
  const pitchDDot = pilotPendulumEOM(
    {
      pilotMass: pc.pilotMass,
      Iy_riser: pc.pitchInertia,
      riserToCG: pc.riserLength,
      cgOffset: { x: 0, z: -pc.riserLength },
    },
    thetaPilot,
    gx, gz,
    -pc.pitchSpring * thetaPilot - pc.pitchDamp * thetaPilotDot + aeroDampTorque,
    0,  // coupling disabled — pilot pendulum is cosmetic, no canopy qDot feedback
  )

  // Lateral weight shift — stiff spring + gamepad input
  const lateralDDot = pilotLateralEOM(
    pilotRoll, pilotRollDot,
    pc.lateralSpring, pc.lateralDamp, pc.lateralInertia,
    pc.lateralInputTorque ?? 0,
  )

  // Line twist — sinusoidal restoring torque + gamepad input
  const twistDDot = pilotTwistEOM(
    pilotYaw, pilotYawDot,
    pc.twistStiffness, pc.twistDamp, pc.twistInertia,
    pc.twistInputTorque ?? 0,
  )

  // Body-frame gravity vector derivatives: ġ = -ω × g
  // Only tracking x and z components (pitch plane, φ≈0 → gy≈0)
  // ġx = -q*gz + r*gy ≈ -q*gz  (since gy≈0)
  // ġz = -p*gy + q*gx ≈ q*gx   (wait, full: ġz = p*gy - q*gx)
  // Full 3D: ġ = -ω × g = -(p,q,r) × (gx,gy,gz)
  //   ġx = -(q*gz - r*gy) = r*gy - q*gz
  //   ġy = -(r*gx - p*gz) = p*gz - r*gx  
  //   ġz = -(p*gy - q*gx) = q*gx - p*gy
  const gy = ext.gravBodyY ?? Math.cos(state.theta) * Math.sin(state.phi)
  const gravBodyXDot = state.r * gy - state.q * gz
  const gravBodyYDot = state.p * gz - state.r * gx
  const gravBodyZDot = state.q * gx - state.p * gy

  return {
    thetaPilotDot: thetaPilotDot,
    thetaPilotDDot: pitchDDot,
    pilotRollDot: pilotRollDot,
    pilotRollDDot: lateralDDot,
    pilotYawDot: pilotYawDot,
    pilotYawDDot: twistDDot,
    gravBodyXDot,
    gravBodyYDot,
    gravBodyZDot,
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
  const base: SimState = {
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

  // Integrate pilot coupling states when present
  if (deriv.thetaPilotDDot !== undefined) {
    const ext = state as Partial<SimStateExtended>
    ;(base as SimStateExtended).thetaPilot =
      (ext.thetaPilot ?? 0) + (deriv.thetaPilotDot ?? 0) * dt
    ;(base as SimStateExtended).thetaPilotDot =
      (ext.thetaPilotDot ?? 0) + deriv.thetaPilotDDot * dt

    // Unconstrained pendulum — wrap to [-π, π] instead of bouncing.
    // No artificial limits; if the pilot swings over the top it wraps naturally.
    // Gravity always restores toward hanging straight down.
    let tp = (base as SimStateExtended).thetaPilot
    if (tp > Math.PI) tp -= 2 * Math.PI
    else if (tp < -Math.PI) tp += 2 * Math.PI
    ;(base as SimStateExtended).thetaPilot = tp

    ;(base as SimStateExtended).pilotRoll =
      (ext.pilotRoll ?? 0) + (deriv.pilotRollDot ?? 0) * dt
    ;(base as SimStateExtended).pilotRollDot =
      (ext.pilotRollDot ?? 0) + (deriv.pilotRollDDot ?? 0) * dt
    ;(base as SimStateExtended).pilotYaw =
      (ext.pilotYaw ?? 0) + (deriv.pilotYawDot ?? 0) * dt
    ;(base as SimStateExtended).pilotYawDot =
      (ext.pilotYawDot ?? 0) + (deriv.pilotYawDDot ?? 0) * dt

    // Integrate body-frame gravity vector (singularity-free attitude tracking)
    if (deriv.gravBodyXDot !== undefined) {
      let newGx = (ext.gravBodyX ?? -Math.sin(state.theta)) + deriv.gravBodyXDot * dt
      let newGy = (ext.gravBodyY ?? Math.cos(state.theta) * Math.sin(state.phi)) + deriv.gravBodyYDot! * dt
      let newGz = (ext.gravBodyZ ?? Math.cos(state.theta) * Math.cos(state.phi)) + deriv.gravBodyZDot! * dt
      // Renormalize to unit vector (prevent drift)
      const len = Math.sqrt(newGx * newGx + newGy * newGy + newGz * newGz)
      if (len > 1e-6) { newGx /= len; newGy /= len; newGz /= len }
      ;(base as SimStateExtended).gravBodyX = newGx
      ;(base as SimStateExtended).gravBodyY = newGy
      ;(base as SimStateExtended).gravBodyZ = newGz
    }
  }

  return base
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
    // Pilot coupling (when present)
    ...rk4AvgPilot(k1, k2, k3, k4),
  }

  return forwardEuler(state, avg, dt)
}

/** RK4 weighted average for pilot coupling derivatives. */
function rk4AvgPilot(
  k1: SimDerivatives, k2: SimDerivatives, k3: SimDerivatives, k4: SimDerivatives,
): Partial<SimDerivatives> {
  if (k1.thetaPilotDDot === undefined) return {}
  const avg = (a?: number, b?: number, c?: number, d?: number) =>
    ((a ?? 0) + 2 * (b ?? 0) + 2 * (c ?? 0) + (d ?? 0)) / 6
  return {
    thetaPilotDot:  avg(k1.thetaPilotDot, k2.thetaPilotDot, k3.thetaPilotDot, k4.thetaPilotDot),
    thetaPilotDDot: avg(k1.thetaPilotDDot, k2.thetaPilotDDot, k3.thetaPilotDDot, k4.thetaPilotDDot),
    pilotRollDot:   avg(k1.pilotRollDot, k2.pilotRollDot, k3.pilotRollDot, k4.pilotRollDot),
    pilotRollDDot:  avg(k1.pilotRollDDot, k2.pilotRollDDot, k3.pilotRollDDot, k4.pilotRollDDot),
    pilotYawDot:    avg(k1.pilotYawDot, k2.pilotYawDot, k3.pilotYawDot, k4.pilotYawDot),
    pilotYawDDot:   avg(k1.pilotYawDDot, k2.pilotYawDDot, k3.pilotYawDDot, k4.pilotYawDDot),
    gravBodyXDot:   avg(k1.gravBodyXDot, k2.gravBodyXDot, k3.gravBodyXDot, k4.gravBodyXDot),
    gravBodyYDot:   avg(k1.gravBodyYDot, k2.gravBodyYDot, k3.gravBodyYDot, k4.gravBodyYDot),
    gravBodyZDot:   avg(k1.gravBodyZDot, k2.gravBodyZDot, k3.gravBodyZDot, k4.gravBodyZDot),
  }
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
