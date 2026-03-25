/**
 * types.ts — Shared types for the orientation Kalman filter.
 *
 * State vector (13):
 *   [φ, θ, ψ, p, q, r, ṗ, q̇, ṙ, α, δ_pitch, δ_roll, δ_yaw]
 *
 * Indices:
 *   0  φ        roll angle          (rad)
 *   1  θ        pitch angle         (rad)
 *   2  ψ        yaw/heading angle   (rad)
 *   3  p        body roll rate      (rad/s)
 *   4  q        body pitch rate     (rad/s)
 *   5  r        body yaw rate       (rad/s)
 *   6  pDot     roll accel          (rad/s²)
 *   7  qDot     pitch accel         (rad/s²)
 *   8  rDot     yaw accel           (rad/s²)
 *   9  α        angle of attack     (rad)
 *   10 δ_pitch  pitch throttle      [-1, 1]
 *   11 δ_roll   roll throttle       [-1, 1]
 *   12 δ_yaw    yaw throttle        [-1, 1]
 */

export const STATE_SIZE = 13

/** Named indices into the state vector */
export const enum StateIdx {
  PHI = 0,
  THETA = 1,
  PSI = 2,
  P = 3,
  Q = 4,
  R = 5,
  P_DOT = 6,
  Q_DOT = 7,
  R_DOT = 8,
  ALPHA = 9,
  DELTA_PITCH = 10,
  DELTA_ROLL = 11,
  DELTA_YAW = 12,
}

/**
 * Measurement vector (7):
 *   [φ_meas, θ_meas, ψ_meas, p_meas, q_meas, r_meas, α_meas]
 *
 * φ, θ, ψ from GPS-derived orientation (SG pipeline).
 * p, q, r from LS derivative of SG-smoothed Euler angles → inverse DKE.
 * α from AOA segment model matching in extractAero().
 */
export const MEAS_SIZE = 7

export const enum MeasIdx {
  PHI = 0,
  THETA = 1,
  PSI = 2,
  P = 3,
  Q = 4,
  R = 5,
  ALPHA = 6,
}

/** Single GPS-derived orientation measurement */
export interface OrientationMeasurement {
  /** Timestamp in seconds (absolute or relative) */
  t: number
  /** Roll angle (rad) */
  phi: number
  /** Pitch angle (rad) */
  theta: number
  /** Heading angle (rad) */
  psi: number
  /** Body roll rate (rad/s) */
  p: number
  /** Body pitch rate (rad/s) */
  q: number
  /** Body yaw rate (rad/s) */
  r: number
  /** Angle of attack (rad) */
  alpha: number
}

/** Full filter output at a queried time */
export interface OrientationEstimate {
  /** Timestamp (s) */
  t: number
  /** Roll (rad) */
  phi: number
  /** Pitch (rad) */
  theta: number
  /** Heading (rad) */
  psi: number
  /** Body rates (rad/s) */
  p: number
  q: number
  r: number
  /** Angular accelerations (rad/s²) */
  pDot: number
  qDot: number
  rDot: number
  /** Angle of attack (rad) */
  alpha: number
  /** Estimated control inputs [-1,1] or [0,1] */
  deltaPitch: number
  deltaRoll: number
  deltaYaw: number
}

/**
 * Aero model interface — the Kalman filter calls this to get moments
 * from current state + control inputs.  Keeps the filter decoupled
 * from the specific segment model.
 */
export interface AeroMomentModel {
  /**
   * Evaluate aerodynamic moments given current flight state.
   * Returns [L, M, N] in body-frame (N·m).
   */
  evaluateMoments(
    alpha: number,
    V: number,
    p: number, q: number, r: number,
    deltaPitch: number, deltaRoll: number, deltaYaw: number,
  ): [number, number, number]

  /**
   * Inertia tensor diagonal [Ixx, Iyy, Izz] (kg·m²).
   * Off-diagonal assumed zero for now.
   */
  getInertia(): [number, number, number]
}

/**
 * Filter configuration — process noise, measurement noise, initial covariance.
 */
export interface OrientationKalmanConfig {
  /** Process noise standard deviations (per state) */
  qAngles: number       // φ, θ, ψ
  qRates: number        // p, q, r
  qAccel: number        // ṗ, q̇, ṙ
  qAlpha: number        // α
  qControls: number     // δ_pitch, δ_roll, δ_yaw

  /** Measurement noise standard deviations */
  rAngles: number       // φ, θ, ψ
  rRates: number        // p, q, r
  rAlpha: number        // α

  /** Initial covariance standard deviations */
  p0Angles: number
  p0Rates: number
  p0Accel: number
  p0Alpha: number
  p0Controls: number
}

export const DEFAULT_CONFIG: OrientationKalmanConfig = {
  // Process noise — how much each state can change per second
  qAngles: 0.01,      // ~0.6°/step at 5 Hz
  qRates: 0.1,        // rad/s
  qAccel: 1.0,        // rad/s² — angular accel can change quickly
  qAlpha: 0.01,       // α changes slowly in steady flight
  qControls: 0.5,     // control inputs can change ~0.5/s

  // Measurement noise
  rAngles: 0.03,      // ~1.7° — GPS-derived angles aren't perfect
  rRates: 0.05,       // rad/s — LS-derived rates have some noise
  rAlpha: 0.05,       // ~3° — AOA from segment model matching

  // Initial covariance
  p0Angles: 0.5,      // ~30° — very uncertain at start
  p0Rates: 1.0,
  p0Accel: 5.0,
  p0Alpha: 0.2,       // ~12°
  p0Controls: 1.0,    // full range uncertain
}
