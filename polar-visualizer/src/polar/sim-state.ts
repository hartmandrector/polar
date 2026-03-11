/**
 * Simulation state types — canonical 6DOF state vector.
 *
 * Pure types with no logic.  Portable to CloudBASE.
 * See SIMULATION.md §13 for architecture discussion.
 */

// ─── 12-State Vector ─────────────────────────────────────────────────────────

/**
 * Full 6DOF rigid-body state.
 *
 * NED body frame: x-forward, y-right, z-down.
 * Euler sequence: 3-2-1 (ψ → θ → φ).
 */
export interface SimState {
  // Inertial position [m] — NED Earth frame
  x: number;  y: number;  z: number
  // Body velocity [m/s] — NED body frame
  u: number;  v: number;  w: number
  // Euler angles [rad] — 3-2-1 (ψ → θ → φ)
  phi: number;  theta: number;  psi: number
  // Body angular rates [rad/s]
  p: number;  q: number;  r: number
}

// ─── Extended State (Pilot–Canopy Coupling) ─────────────────────────────────

/**
 * 12-state + 6 pilot coupling degrees of freedom.
 *
 * Three relative rotation axes at the riser confluence point
 * (see docs/sim/PILOT-COUPLING.md):
 *   - Pitch (fore/aft swing) — gravity-restoring pendulum
 *   - Roll (lateral weight shift) — stiff spring, geometric deformation
 *   - Yaw (line twist) — sinusoidal restoring torque from line geometry
 */
export interface SimStateExtended extends SimState {
  /** Pilot pitch angle relative to risers [rad] — pendulum swing */
  thetaPilot: number
  /** Pilot pitch rate [rad/s] */
  thetaPilotDot: number
  /** Pilot roll angle relative to canopy [rad] — lateral weight shift */
  pilotRoll: number
  /** Pilot roll rate [rad/s] */
  pilotRollDot: number
  /** Pilot yaw angle relative to canopy [rad] — line twist */
  pilotYaw: number
  /** Pilot yaw rate [rad/s] */
  pilotYawDot: number
  /** Body-frame gravity unit vector — tracks "down" without Euler singularity.
   *  Updated each step via ġ = -ω × g. Used by pendulum gravity computation. */
  gravBodyX: number
  gravBodyY: number
  gravBodyZ: number
}

// ─── Derivative Vectors ──────────────────────────────────────────────────────

/**
 * Time derivatives of the 12-state vector.
 * Returned by the derivative function, consumed by the integrator.
 */
export interface SimDerivatives {
  // Inertial velocity [m/s] — from translational kinematics (DCM · V_body)
  xDot: number;  yDot: number;  zDot: number
  // Body acceleration [m/s²] — from translational dynamics
  uDot: number;  vDot: number;  wDot: number
  // Euler angle rates [rad/s] — from DKE (body rates → Euler rates)
  phiDot: number;  thetaDot: number;  psiDot: number
  // Body angular acceleration [rad/s²] — from rotational dynamics
  pDot: number;  qDot: number;  rDot: number
  // Pilot coupling derivatives (optional — zero when not active)
  thetaPilotDot?: number;  thetaPilotDDot?: number
  pilotRollDot?: number;   pilotRollDDot?: number
  pilotYawDot?: number;    pilotYawDDot?: number
  // Body-frame gravity vector derivatives (from ġ = -ω × g)
  gravBodyXDot?: number
  gravBodyYDot?: number
  gravBodyZDot?: number
}

// ─── Simulation Configuration ────────────────────────────────────────────────

import type { AeroSegment, SegmentControls, MassSegment } from './continuous-polar.ts'
import type { Vec3NED } from './aero-segment.ts'
import type { InertiaComponents } from './inertia.ts'

/**
 * Configuration snapshot for a single derivative evaluation.
 *
 * Recompute only when mass distribution changes (deploy, pilot pitch,
 * component swap).  Cached between integration steps.
 */
export interface SimConfig {
  /** Aero segments (canopy cells + parasitic bodies) */
  segments: AeroSegment[]
  /** Control inputs */
  controls: SegmentControls
  /** System CG in meters [NED body frame] — from computeCenterOfMass() */
  cgMeters: Vec3NED
  /** Inertia tensor about CG — from computeInertia() */
  inertia: InertiaComponents
  /** Total system mass [kg] (isotropic — used when massPerAxis not set) */
  mass: number
  /**
   * Per-axis effective mass [kg] — physical + apparent mass.
   *
   * When set, `computeDerivatives` uses `translationalEOMAnisotropic()`
   * with the Lamb/Kirchhoff Coriolis coupling.  When undefined,
   * falls back to isotropic `translationalEOM(mass)`.
   */
  massPerAxis?: { x: number; y: number; z: number }
  /** Reference height [m] for denormalization (default 1.875) */
  height: number
  /** Air density [kg/m³] */
  rho: number
  /** Pilot–canopy coupling parameters (optional — disabled when absent) */
  pilotCoupling?: PilotCouplingConfig
}

// ─── Pilot–Canopy Coupling Configuration ─────────────────────────────────────

/**
 * Parameters for 3-DOF pilot–canopy relative rotation.
 * See docs/sim/PILOT-COUPLING.md §8.
 */
export interface PilotCouplingConfig {
  /** Distance from pilot CG to riser confluence [m] */
  riserLength: number
  /** Pilot mass [kg] */
  pilotMass: number

  // Pitch (fore/aft swing) — gravity-restoring pendulum
  pitchSpring: number    // k_θ [N·m/rad] — additional spring beyond gravity
  pitchDamp: number      // c_θ [N·m·s/rad]
  pitchInertia: number   // I_θ [kg·m²] about confluence

  // Lateral (weight shift) — stiff spring, geometric deformation
  lateralSpring: number  // k_φ [N·m/rad] — stiff
  lateralDamp: number    // c_φ [N·m·s/rad] — critical damping
  lateralInertia: number // I_φ [kg·m²] about confluence

  // Twist (line twist) — sinusoidal restoring torque
  twistStiffness: number // k_ψ [N·m] — line set torsional stiffness
  twistDamp: number      // c_ψ [N·m·s/rad]
  twistInertia: number   // I_ψ [kg·m²] about confluence
  twistYawCoupling: number // k_yaw [N·m·s/rad] — canopy yaw rate → twist torque

  // Pilot mass segments (for aero damping torque computation)
  pilotSegments?: MassSegment[]
  /** Pivot point in NED normalised coords (riser confluence) */
  pivotNED?: { x: number; z: number }

  // Gamepad input torques (set per frame, not persistent)
  lateralInputTorque?: number  // τ_input for weight shift [N·m]
  twistInputTorque?: number    // τ_input for twist recovery [N·m]

  /** Deploy fraction [0–1]. Scales canopy coupling during inflation. */
  deployFraction?: number
}
