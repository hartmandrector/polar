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

// ─── Extended State (Pilot Pendulum) ─────────────────────────────────────────

/**
 * 12-state + 2 pilot pendulum degrees of freedom.
 */
export interface SimStateExtended extends SimState {
  /** Pilot pitch angle relative to risers [rad] */
  thetaPilot: number
  /** Pilot pitch rate [rad/s] */
  thetaPilotDot: number
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
}

// ─── Simulation Configuration ────────────────────────────────────────────────

import type { AeroSegment, SegmentControls } from './continuous-polar.ts'
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
}
