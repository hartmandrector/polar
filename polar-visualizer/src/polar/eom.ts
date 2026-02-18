/**
 * Equations of Motion — rigid-body 6DOF dynamics.
 *
 * Pure math functions for evaluating the twelve state derivatives
 * of a flying body in the NED body frame:
 *
 *   x-forward, y-right, z-down
 *
 * No Three.js, DOM, or rendering dependencies.
 * Portable to CloudBASE.
 *
 * Reference: https://academicflight.com/articles/equations-of-motion/
 * See also:  SIMULATION.md in repo root.
 */

import type { InertiaComponents } from './inertia.ts'
import type { Vec3NED }           from './aero-segment.ts'
import type { MassSegment }       from './continuous-polar.ts'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Body-frame angular velocity (p, q, r) in rad/s */
export interface AngularVelocity {
  p: number  // roll rate  (about x-body)
  q: number  // pitch rate (about y-body)
  r: number  // yaw rate   (about z-body)
}

/** Time derivatives of angular velocity */
export interface AngularAcceleration {
  pDot: number  // roll acceleration  [rad/s²]
  qDot: number  // pitch acceleration [rad/s²]
  rDot: number  // yaw acceleration   [rad/s²]
}

/** Time derivatives of body-frame velocity */
export interface TranslationalAcceleration {
  uDot: number  // forward acceleration [m/s²]
  vDot: number  // rightward acceleration [m/s²]
  wDot: number  // downward acceleration [m/s²]
}

/** Time derivatives of Euler angles */
export interface EulerRates {
  phiDot:   number  // roll rate   [rad/s]
  thetaDot: number  // pitch rate  [rad/s]
  psiDot:   number  // yaw rate    [rad/s]
}

// ─── Gravity ─────────────────────────────────────────────────────────────────

/**
 * Gravity acceleration vector projected into the body frame.
 *
 *   gx = −g sinθ
 *   gy =  g sinφ cosθ
 *   gz =  g cosφ cosθ
 *
 * Returns acceleration [m/s²] — multiply by mass to get force,
 * or add directly to F/m in the translational EOM.
 *
 * @param phi   Roll angle φ [rad]
 * @param theta Pitch angle θ [rad]
 * @param g     Gravitational acceleration [m/s²] (default 9.80665)
 */
export function gravityBody(
  phi: number,
  theta: number,
  g: number = 9.80665,
): Vec3NED {
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const sinTheta = Math.sin(theta)
  const cosTheta = Math.cos(theta)
  return {
    x: -g * sinTheta,
    y:  g * sinPhi * cosTheta,
    z:  g * cosPhi * cosTheta,
  }
}

// ─── Translational Dynamics ──────────────────────────────────────────────────

/**
 * Translational equations of motion (Newton's 2nd law in a rotating frame).
 *
 *   u̇ = Fx/m + rv − qw
 *   v̇ = Fy/m + pw − ru
 *   ẇ = Fz/m + qu − pv
 *
 * @param force   Total body-frame force [N] (aero + weight)
 * @param mass    Total system mass [kg]
 * @param vel     Body-frame velocity {x: u, y: v, z: w} [m/s]
 * @param omega   Body angular rates {p, q, r} [rad/s]
 */
export function translationalEOM(
  force: Vec3NED,
  mass: number,
  vel: Vec3NED,
  omega: AngularVelocity,
): TranslationalAcceleration {
  const { x: u, y: v, z: w } = vel
  const { p, q, r } = omega
  return {
    uDot: force.x / mass + r * v - q * w,
    vDot: force.y / mass + p * w - r * u,
    wDot: force.z / mass + q * u - p * v,
  }
}

/**
 * Translational EOM with anisotropic (per-axis) effective mass.
 *
 * When apparent mass is included, each axis has a different effective mass:
 *   m_eff_x = m + m_a_x,  m_eff_y = m + m_a_y,  m_eff_z = m + m_a_z
 *
 * The momentum in a rotating frame with anisotropic mass gives
 * (Lamb/Kirchhoff form):
 *
 *   m_eff_x · u̇ = F_x + m_eff_y · r · v − m_eff_z · q · w
 *   m_eff_y · v̇ = F_y + m_eff_z · p · w − m_eff_x · r · u
 *   m_eff_z · ẇ = F_z + m_eff_x · q · u − m_eff_y · p · v
 *
 * Note: the Coriolis cross-terms use the OTHER axis's mass, not
 * the acceleration axis.  This is the source of the "Munk moment"
 * in airship dynamics and is significant for ram-air canopies.
 *
 * Falls back to standard isotropic EOM when all masses are equal.
 *
 * @param force     Total body-frame force [N]
 * @param massAxis  Effective mass per axis {x, y, z} [kg]
 * @param vel       Body-frame velocity [m/s]
 * @param omega     Body angular rates [rad/s]
 */
export function translationalEOMAnisotropic(
  force: Vec3NED,
  massAxis: { x: number; y: number; z: number },
  vel: Vec3NED,
  omega: AngularVelocity,
): TranslationalAcceleration {
  const { x: u, y: v, z: w } = vel
  const { p, q, r } = omega
  const { x: mx, y: my, z: mz } = massAxis
  return {
    uDot: (force.x + my * r * v - mz * q * w) / mx,
    vDot: (force.y + mz * p * w - mx * r * u) / my,
    wDot: (force.z + mx * q * u - my * p * v) / mz,
  }
}

// ─── Rotational Dynamics ─────────────────────────────────────────────────────

/**
 * Rotational equations of motion (Euler's equation with Ixz coupling).
 *
 * Assumes left-right symmetry: Ixy = Iyz = 0.
 * Full Ixz cross-coupling is retained.
 *
 * Scalar form (see SIMULATION.md §3.3):
 *
 *   Γ = Ixx·Izz − Ixz²
 *
 *   ṗ = (1/Γ)[ Izz·L + Ixz·N
 *              − Ixz(Ixx−Iyy+Izz)·pq
 *              + (Ixz²+Izz(Izz−Iyy))·qr ]
 *
 *   q̇ = (1/Iyy)[ M − (Ixx−Izz)·pr − Ixz(p²−r²) ]
 *
 *   ṙ = (1/Γ)[ Ixz·L + Ixx·N
 *              + Ixz(Izz−Iyy+Ixx)·qr
 *              − (Ixz²+Ixx(Ixx−Iyy))·pq ]
 *
 * @param moment  Total body-frame moment about CG {x: L, y: M, z: N} [N·m]
 * @param I       Inertia tensor components (from computeInertia())
 * @param omega   Body angular rates {p, q, r} [rad/s]
 */
export function rotationalEOM(
  moment: Vec3NED,
  I: InertiaComponents,
  omega: AngularVelocity,
): AngularAcceleration {
  const { Ixx, Iyy, Izz, Ixz } = I
  const { p, q, r } = omega
  const L = moment.x
  const M = moment.y
  const N = moment.z

  const gamma = Ixx * Izz - Ixz * Ixz

  const pDot = (1 / gamma) * (
    Izz * L + Ixz * N
    - Ixz * (Ixx - Iyy + Izz) * p * q
    + (Ixz * Ixz + Izz * (Izz - Iyy)) * q * r
  )

  const qDot = (1 / Iyy) * (
    M - (Ixx - Izz) * p * r - Ixz * (p * p - r * r)
  )

  const rDot = (1 / gamma) * (
    Ixz * L + Ixx * N
    + Ixz * (Izz - Iyy + Ixx) * q * r
    - (Ixz * Ixz + Ixx * (Ixx - Iyy)) * p * q
  )

  return { pDot, qDot, rDot }
}

// ─── Rotational Kinematics ──────────────────────────────────────────────────

/**
 * Convert body angular rates (p, q, r) to Euler angle rates (φ̇, θ̇, ψ̇).
 *
 *   φ̇ = p + (sinφ tanθ) q + (cosφ tanθ) r
 *   θ̇ =     (cosφ)       q − (sinφ)      r
 *   ψ̇ =     (sinφ secθ)  q + (cosφ secθ)  r
 *
 * Singular at θ = ±90° (gimbal lock).
 *
 * @param p     Roll rate [rad/s]
 * @param q     Pitch rate [rad/s]
 * @param r     Yaw rate [rad/s]
 * @param phi   Roll angle φ [rad]
 * @param theta Pitch angle θ [rad]
 */
export function eulerRates(
  p: number,
  q: number,
  r: number,
  phi: number,
  theta: number,
): EulerRates {
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const tanTheta = Math.tan(theta)
  const secTheta = 1 / Math.cos(theta)

  return {
    phiDot:   p + sinPhi * tanTheta * q + cosPhi * tanTheta * r,
    thetaDot:     cosPhi * q             - sinPhi * r,
    psiDot:       sinPhi * secTheta * q  + cosPhi * secTheta * r,
  }
}

// ─── Inverse Rotational Kinematics ──────────────────────────────────────────

/**
 * Convert Euler angle rates (φ̇, θ̇, ψ̇) to body angular rates (p, q, r).
 *
 * This is the inverse of eulerRates() — the [B]⁻¹ matrix from the
 * Differential Kinematic Equation (DKE).
 *
 *   p =  φ̇              − ψ̇ sinθ
 *   q =  θ̇ cosφ         + ψ̇ sinφ cosθ
 *   r = −θ̇ sinφ         + ψ̇ cosφ cosθ
 *
 * Use when the UI or flight condition specifies Euler rates
 * (e.g. steady turn ψ̇ = const) and you need body rates for the
 * aero model and EOM.
 *
 * @param phiDot   Roll  Euler rate  [rad/s]
 * @param thetaDot Pitch Euler rate  [rad/s]
 * @param psiDot   Yaw   Euler rate  [rad/s]
 * @param phi      Roll  angle φ     [rad]
 * @param theta    Pitch angle θ     [rad]
 */
export function eulerRatesToBodyRates(
  phiDot: number,
  thetaDot: number,
  psiDot: number,
  phi: number,
  theta: number,
): AngularVelocity {
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const sinTheta = Math.sin(theta)
  const cosTheta = Math.cos(theta)

  return {
    p:  phiDot                          - psiDot * sinTheta,
    q:           thetaDot * cosPhi      + psiDot * sinPhi * cosTheta,
    r:          -thetaDot * sinPhi      + psiDot * cosPhi * cosTheta,
  }
}

// ─── Translational Kinematics ────────────────────────────────────────────────

/**
 * Rotate body-frame velocity into the inertial (NED Earth) frame.
 *
 * Uses the DCM [EB]ᵀ (body → inertial) from the 3-2-1 Euler sequence.
 * Pure math — no Three.js dependency (equivalent to frames.ts dcmBodyToInertial
 * but returns a Vec3NED directly).
 *
 *   ẋ = (cθcψ)u + (sφsθcψ − cφsψ)v + (cφsθcψ + sφsψ)w
 *   ẏ = (cθsψ)u + (sφsθsψ + cφcψ)v + (cφsθsψ − sφcψ)w
 *   ż = (−sθ)u  + (sφcθ)v            + (cφcθ)w
 *
 * @param u     Forward velocity [m/s]
 * @param v     Rightward velocity [m/s]
 * @param w     Downward velocity [m/s]
 * @param phi   Roll angle φ [rad]
 * @param theta Pitch angle θ [rad]
 * @param psi   Yaw/heading angle ψ [rad]
 */
export function bodyToInertialVelocity(
  u: number, v: number, w: number,
  phi: number, theta: number, psi: number,
): Vec3NED {
  const cp = Math.cos(phi),  sp = Math.sin(phi)
  const ct = Math.cos(theta), st = Math.sin(theta)
  const cy = Math.cos(psi),  sy = Math.sin(psi)

  return {
    x: ct * cy * u + (sp * st * cy - cp * sy) * v + (cp * st * cy + sp * sy) * w,
    y: ct * sy * u + (sp * st * sy + cp * cy) * v + (cp * st * sy - sp * cy) * w,
    z: -st * u     + sp * ct * v                   + cp * ct * w,
  }
}

// ─── Pilot Pitch Pendulum ───────────────────────────────────────────────────

/** Result of pilot pendulum inertia computation. */
export interface PilotPendulumParams {
  /** Pilot mass [kg] — sum of pilot-only segment masses */
  pilotMass: number
  /** Moment of inertia about the riser pivot [kg·m²] (pitch axis, y-body) */
  Iy_riser: number
  /** Distance from riser pivot to pilot CG [m] */
  riserToCG: number
  /** Pilot CG position in meters {x, z} relative to riser pivot */
  cgOffset: { x: number; z: number }
}

/**
 * Compute pilot-body inertia about the riser attachment point.
 *
 * Uses the parallel-axis theorem: for each pilot mass segment,
 * I_pivot = m_i · d_i² where d_i is the distance from the riser
 * pivot to the segment position (in the x-z pitch plane).
 *
 * Only the pitch-axis (y-body, Iyy) component is computed since
 * the pendulum swings in the x-z plane.
 *
 * @param pilotSegments  Pilot-only mass segments (CANOPY_PILOT_SEGMENTS or rotated equivalent)
 * @param pivotX         Riser pivot x-position [height-normalised NED]
 * @param pivotZ         Riser pivot z-position [height-normalised NED]
 * @param height         Pilot height [m] for denormalisation (default 1.875)
 * @param totalWeight    Total system mass [kg] for mass ratio scaling (default 77.5)
 */
export function computePilotPendulumParams(
  pilotSegments: MassSegment[],
  pivotX: number,
  pivotZ: number,
  height: number = 1.875,
  totalWeight: number = 77.5,
): PilotPendulumParams {
  let pilotMass = 0
  let Iy_riser = 0
  let cgX = 0, cgZ = 0

  for (const seg of pilotSegments) {
    const m = seg.massRatio * totalWeight
    // Distance in meters from pivot to segment
    const dx = (seg.normalizedPosition.x - pivotX) * height
    const dz = (seg.normalizedPosition.z - pivotZ) * height
    const d2 = dx * dx + dz * dz

    Iy_riser += m * d2
    pilotMass += m
    cgX += m * dx
    cgZ += m * dz
  }

  const cgOffset = pilotMass > 0
    ? { x: cgX / pilotMass, z: cgZ / pilotMass }
    : { x: 0, z: 0 }

  const riserToCG = Math.sqrt(cgOffset.x * cgOffset.x + cgOffset.z * cgOffset.z)

  return { pilotMass, Iy_riser, riserToCG, cgOffset }
}

/**
 * Pilot pitch pendulum equation of motion.
 *
 * Computes θ̈_p — the angular acceleration of the pilot body about
 * the riser attachment point.
 *
 *   I_p · θ̈_p = τ_gravity + τ_aero + τ_canopy
 *
 * where:
 *   τ_gravity = −m_p · g · l · sin(θ_p − θ_canopy)
 *   τ_aero    = supplied externally (from pilot segment forces)
 *   τ_canopy  = −I_p · q̇  (canopy pitch acceleration coupling)
 *
 * @param params        Pendulum inertia parameters (from computePilotPendulumParams)
 * @param thetaPilot    Pilot pitch angle [rad] (relative to equilibrium / risers)
 * @param thetaCanopy   Canopy pitch angle θ [rad] (Euler pitch of the system)
 * @param aeroTorque    Net aerodynamic torque about riser pivot [N·m] (positive = pitch aft)
 * @param qDotCanopy    Canopy pitch acceleration q̇ [rad/s²] (from rotationalEOM)
 * @param g             Gravitational acceleration [m/s²] (default 9.80665)
 */
export function pilotPendulumEOM(
  params: PilotPendulumParams,
  thetaPilot: number,
  thetaCanopy: number,
  aeroTorque: number,
  qDotCanopy: number = 0,
  g: number = 9.80665,
): number {
  const { pilotMass, Iy_riser, riserToCG } = params

  if (Iy_riser < 1e-10) return 0  // degenerate — no inertia

  // Gravity restoring torque: acts at pilot CG, distance riserToCG from pivot
  const tau_gravity = -pilotMass * g * riserToCG * Math.sin(thetaPilot - thetaCanopy)

  // Canopy coupling: canopy pitch acceleration transfers through risers
  const tau_canopy = -Iy_riser * qDotCanopy

  // Total angular acceleration
  return (tau_gravity + aeroTorque + tau_canopy) / Iy_riser
}

/**
 * Compute aerodynamic damping torque on the pilot body due to pitch swing.
 *
 * When the pilot swings at rate θ̇_p, each pilot segment's velocity
 * is modified by the tangential component of the swing.  This produces
 * a drag force that opposes the swing — natural aerodynamic damping.
 *
 * For each pilot segment at distance r_i from the riser pivot:
 *   v_tangential = θ̇_p · r_i
 *   ΔF_drag = ½ρ · Cd_pilot · A_i · v_tangential · |v_tangential|
 *   Δτ = −ΔF_drag · r_i  (opposes swing)
 *
 * This uses a simplified flat-plate drag model (Cd ≈ 1.0) with
 * the pilot segment's frontal area estimated from its mass fraction.
 *
 * @param pilotSegments  Pilot-only mass segments
 * @param pivotX         Riser pivot x [normalised NED]
 * @param pivotZ         Riser pivot z [normalised NED]
 * @param thetaDotPilot  Pilot pitch rate [rad/s]
 * @param rho            Air density [kg/m³] (default 1.225)
 * @param height         Pilot height [m] (default 1.875)
 * @param totalWeight    Total system mass [kg] (default 77.5)
 * @param pilotArea      Total pilot frontal area [m²] (default 0.55)
 * @param cd             Drag coefficient for pilot body (default 1.0)
 */
export function pilotSwingDampingTorque(
  pilotSegments: MassSegment[],
  pivotX: number,
  pivotZ: number,
  thetaDotPilot: number,
  rho: number = 1.225,
  height: number = 1.875,
  totalWeight: number = 77.5,
  pilotArea: number = 0.55,
  cd: number = 1.0,
): number {
  if (Math.abs(thetaDotPilot) < 1e-10) return 0

  // Total pilot mass ratio for distributing area
  let totalPilotRatio = 0
  for (const seg of pilotSegments) totalPilotRatio += seg.massRatio

  let torque = 0
  for (const seg of pilotSegments) {
    // Distance from pivot in meters
    const dx = (seg.normalizedPosition.x - pivotX) * height
    const dz = (seg.normalizedPosition.z - pivotZ) * height
    const r = Math.sqrt(dx * dx + dz * dz)

    // Tangential velocity due to swing
    const vTan = thetaDotPilot * r

    // Segment frontal area proportional to mass fraction
    const areaFrac = seg.massRatio / totalPilotRatio
    const segArea = pilotArea * areaFrac

    // Drag force (opposes motion, so negative sign)
    const fDrag = -0.5 * rho * cd * segArea * vTan * Math.abs(vTan)

    // Torque about pivot
    torque += fDrag * r
  }

  return torque
}
