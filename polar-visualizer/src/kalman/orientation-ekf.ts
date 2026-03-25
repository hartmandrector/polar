/**
 * orientation-ekf.ts — 13-state Extended Kalman Filter for wingsuit orientation.
 *
 * Architecture mirrors /mnt/c/dev/kalman/src/kalman.ts (KalmanFilter3D):
 *   - update(measurement) mutates internal state (called at GPS rate)
 *   - predictAt(t) returns interpolated estimate WITHOUT mutating state
 *   - Step smoothing blends out measurement jumps over one GPS interval
 *
 * State: [φ, θ, ψ, p, q, r, ṗ, q̇, ṙ, α, δ_pitch, δ_roll, δ_yaw]
 * Meas:  [φ, θ, ψ, p, q, r]
 */

import {
  createIdentityMatrix,
  createZeroMatrix,
  matrixMultiply,
  matrixVectorMultiply,
  matrixAdd,
  matrixScale,
  transpose,
  matrixInverse,
} from './matrix.js'

import {
  STATE_SIZE,
  MEAS_SIZE,
  StateIdx,
  DEFAULT_CONFIG,
  type OrientationMeasurement,
  type OrientationEstimate,
  type AeroMomentModel,
  type OrientationKalmanConfig,
} from './types.js'

const DEG = Math.PI / 180
const MAX_STEP = 0.02 // 20 ms max integration sub-step

export class OrientationEKF {
  /** 13-element state vector */
  private x: number[]
  /** 13×13 covariance */
  private P: number[][]
  /** 13×13 process noise covariance (per-second, scaled by dt at predict) */
  private Q: number[][]
  /** 6×6 measurement noise covariance */
  private R: number[][]

  /** Last measurement timestamp (seconds) */
  private lastT: number | undefined
  /** GPS sample interval (seconds), estimated from data */
  private gpsInterval = 0.2 // default 5 Hz
  /** Kalman step (state correction from last update) for step smoothing */
  private kalmanStep: number[]
  /** Step smoothing enabled */
  public stepSmoothing = true

  /** Airspeed magnitude (m/s) — set externally from GPS pipeline */
  private airspeed = 40

  /** Aero model for moment evaluation */
  private aeroModel: AeroMomentModel | undefined

  constructor(config: OrientationKalmanConfig = DEFAULT_CONFIG) {
    // Initial state: zeros (will be overwritten by first measurement)
    this.x = new Array(STATE_SIZE).fill(0)
    this.kalmanStep = new Array(STATE_SIZE).fill(0)

    // Initial covariance
    this.P = createIdentityMatrix(STATE_SIZE)
    const p0 = config
    for (let i = 0; i < 3; i++) this.P[i][i] = p0.p0Angles ** 2
    for (let i = 3; i < 6; i++) this.P[i][i] = p0.p0Rates ** 2
    for (let i = 6; i < 9; i++) this.P[i][i] = p0.p0Accel ** 2
    this.P[9][9] = p0.p0Alpha ** 2
    for (let i = 10; i < 13; i++) this.P[i][i] = p0.p0Controls ** 2

    // Process noise (variances per second)
    this.Q = createZeroMatrix(STATE_SIZE, STATE_SIZE)
    for (let i = 0; i < 3; i++) this.Q[i][i] = config.qAngles ** 2
    for (let i = 3; i < 6; i++) this.Q[i][i] = config.qRates ** 2
    for (let i = 6; i < 9; i++) this.Q[i][i] = config.qAccel ** 2
    this.Q[9][9] = config.qAlpha ** 2
    for (let i = 10; i < 13; i++) this.Q[i][i] = config.qControls ** 2

    // Measurement noise
    this.R = createZeroMatrix(MEAS_SIZE, MEAS_SIZE)
    for (let i = 0; i < 3; i++) this.R[i][i] = config.rAngles ** 2
    for (let i = 3; i < 6; i++) this.R[i][i] = config.rRates ** 2
    this.R[6][6] = config.rAlpha ** 2
  }

  // ─── Public API ────────────────────────────────────────────────

  /** Set the aero model used for moment prediction */
  setAeroModel(model: AeroMomentModel): void {
    this.aeroModel = model
  }

  /** Set current airspeed (m/s) — called externally from GPS pipeline */
  setAirspeed(V: number): void {
    this.airspeed = V
  }

  /** Process a new GPS-derived orientation measurement */
  update(meas: OrientationMeasurement): void {
    if (this.lastT === undefined) {
      // First measurement — initialize state directly
      this.x[StateIdx.PHI] = meas.phi
      this.x[StateIdx.THETA] = meas.theta
      this.x[StateIdx.PSI] = meas.psi
      this.x[StateIdx.P] = meas.p
      this.x[StateIdx.Q] = meas.q
      this.x[StateIdx.R] = meas.r
      // Initialize α from measurement
      this.x[StateIdx.ALPHA] = meas.alpha
      this.lastT = meas.t
      return
    }

    const dt = meas.t - this.lastT
    if (dt <= 0) return

    // Update GPS interval estimate (EMA)
    this.gpsInterval = this.gpsInterval * 0.8 + dt * 0.2

    // ── Predict step (advance state to measurement time) ──
    this.predict(dt)

    // ── Measurement update ──
    // H matrix: first 6 states measured directly, α measured at state index 9
    const H = createZeroMatrix(MEAS_SIZE, STATE_SIZE)
    for (let i = 0; i < 6; i++) H[i][i] = 1
    H[6][StateIdx.ALPHA] = 1  // α measurement

    // Innovation: z - H*x
    const z = [meas.phi, meas.theta, meas.psi, meas.p, meas.q, meas.r, meas.alpha]
    const hx = [
      this.x[0], this.x[1], this.x[2],
      this.x[3], this.x[4], this.x[5],
      this.x[StateIdx.ALPHA],
    ]

    // Handle heading wraparound in innovation
    const y = z.map((zi, i) => zi - hx[i])
    // Wrap ψ innovation to [-π, π]
    while (y[2] > Math.PI) y[2] -= 2 * Math.PI
    while (y[2] < -Math.PI) y[2] += 2 * Math.PI

    // S = H P Hᵀ + R
    const HP = matrixMultiply(H, this.P)
    const HPHT = matrixMultiply(HP, transpose(H))
    const S = matrixAdd(HPHT, this.R)

    // K = P Hᵀ S⁻¹
    const PHT = matrixMultiply(this.P, transpose(H))
    const Sinv = matrixInverse(S)
    const K = matrixMultiply(PHT, Sinv)

    // State correction: x += K y
    const Ky = matrixVectorMultiply(K, y)
    for (let i = 0; i < STATE_SIZE; i++) this.x[i] += Ky[i]

    // Clamp controls to valid range
    this.x[StateIdx.DELTA_PITCH] = clamp(this.x[StateIdx.DELTA_PITCH], -1, 1)
    this.x[StateIdx.DELTA_ROLL] = clamp(this.x[StateIdx.DELTA_ROLL], -1, 1)
    this.x[StateIdx.DELTA_YAW] = clamp(this.x[StateIdx.DELTA_YAW], -1, 1)

    // Covariance update: P = (I - K H) P
    const KH = matrixMultiply(K, H)
    const IminKH = matrixAdd(
      createIdentityMatrix(STATE_SIZE),
      matrixScale(KH, -1),
    )
    this.P = matrixMultiply(IminKH, this.P)

    // Store step for smoothing
    this.kalmanStep = Ky

    this.lastT = meas.t
  }

  /**
   * Query the filter at an arbitrary time WITHOUT mutating internal state.
   * Runs physics forward from last update, applies step smoothing.
   */
  predictAt(t: number): OrientationEstimate | undefined {
    if (this.lastT === undefined) return undefined

    const dt = t - this.lastT
    const predicted = this.integrateState([...this.x], dt)

    // Step smoothing: linearly blend out measurement correction
    // α = 1 - dt/gpsInterval, clamped [0,1]
    if (this.stepSmoothing && this.kalmanStep.length === STATE_SIZE) {
      let alpha = 1 - dt / this.gpsInterval
      alpha = clamp(alpha, 0, 1)
      for (let i = 0; i < STATE_SIZE; i++) {
        predicted[i] -= this.kalmanStep[i] * alpha
      }
    }

    return stateToEstimate(predicted, t)
  }

  /** Get current internal state (for debugging) */
  getState(): number[] {
    return [...this.x]
  }

  /** Get current covariance diagonal (for uncertainty display) */
  getCovarianceDiag(): number[] {
    return this.P.map((row, i) => row[i])
  }

  /** Reset filter to uninitialized state */
  reset(): void {
    this.x = new Array(STATE_SIZE).fill(0)
    this.kalmanStep = new Array(STATE_SIZE).fill(0)
    this.P = createIdentityMatrix(STATE_SIZE)
    this.lastT = undefined
  }

  // ─── Prediction (physics-based) ────────────────────────────────

  /**
   * Advance internal state by dt using the aero model.
   * Mutates this.x and this.P.
   */
  private predict(dt: number): void {
    if (dt <= 0) return

    // Integrate state
    let remaining = dt
    while (remaining > 0) {
      const step = Math.min(remaining, MAX_STEP)
      this.x = this.integrateState(this.x, step)
      remaining -= step
    }

    // Propagate covariance: P = F P Fᵀ + Q·dt
    const F = this.buildJacobian(dt)
    const FP = matrixMultiply(F, this.P)
    const FPFT = matrixMultiply(FP, transpose(F))
    this.P = matrixAdd(FPFT, matrixScale(this.Q, dt))
  }

  /**
   * Integrate state forward by dt. Pure function — does not mutate.
   * Uses sub-stepping for large dt.
   */
  private integrateState(s: number[], dt: number): number[] {
    if (dt <= 0) return s

    let state = [...s]
    let remaining = dt
    while (remaining > 0) {
      const h = Math.min(remaining, MAX_STEP)
      state = this.rk4Step(state, h)
      remaining -= h
    }
    return state
  }

  /**
   * Single RK4 integration step.
   */
  private rk4Step(s: number[], h: number): number[] {
    const k1 = this.stateDerivative(s)
    const k2 = this.stateDerivative(addScaled(s, k1, h / 2))
    const k3 = this.stateDerivative(addScaled(s, k2, h / 2))
    const k4 = this.stateDerivative(addScaled(s, k3, h))

    const result = new Array(STATE_SIZE)
    for (let i = 0; i < STATE_SIZE; i++) {
      result[i] = s[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
    }

    // Clamp controls after integration
    result[StateIdx.DELTA_PITCH] = clamp(result[StateIdx.DELTA_PITCH], -1, 1)
    result[StateIdx.DELTA_ROLL] = clamp(result[StateIdx.DELTA_ROLL], -1, 1)
    result[StateIdx.DELTA_YAW] = clamp(result[StateIdx.DELTA_YAW], -1, 1)

    return result
  }

  /**
   * State derivative: ẋ = f(x).
   * This is where the physics lives.
   */
  private stateDerivative(s: number[]): number[] {
    const phi = s[StateIdx.PHI]
    const theta = s[StateIdx.THETA]
    const p = s[StateIdx.P]
    const q = s[StateIdx.Q]
    const r = s[StateIdx.R]
    const pDot = s[StateIdx.P_DOT]
    const qDot = s[StateIdx.Q_DOT]
    const rDot = s[StateIdx.R_DOT]
    const alpha = s[StateIdx.ALPHA]
    const dPitch = s[StateIdx.DELTA_PITCH]
    const dRoll = s[StateIdx.DELTA_ROLL]
    const dYaw = s[StateIdx.DELTA_YAW]

    const dx = new Array(STATE_SIZE).fill(0)

    // ── Euler angle rates from body rates (kinematic equations / DKE) ──
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)
    const cosTheta = Math.cos(theta)
    const tanTheta = cosTheta !== 0 ? Math.tan(theta) : 0

    dx[StateIdx.PHI] = p + (q * sinPhi + r * cosPhi) * tanTheta
    dx[StateIdx.THETA] = q * cosPhi - r * sinPhi
    dx[StateIdx.PSI] = cosTheta !== 0
      ? (q * sinPhi + r * cosPhi) / cosTheta
      : 0

    // ── Body rate derivatives ──
    if (this.aeroModel) {
      // Physics-based: evaluate aero moments → angular acceleration
      const [L, M, N] = this.aeroModel.evaluateMoments(
        alpha, this.airspeed, p, q, r, dPitch, dRoll, dYaw,
      )
      const [Ixx, Iyy, Izz] = this.aeroModel.getInertia()

      // Euler's rotational equations (simplified — diagonal inertia)
      // Ixx ṗ = L - (Izz - Iyy) q r
      // Iyy q̇ = M - (Ixx - Izz) p r
      // Izz ṙ = N - (Iyy - Ixx) p q
      dx[StateIdx.P] = Ixx > 0 ? (L - (Izz - Iyy) * q * r) / Ixx : pDot
      dx[StateIdx.Q] = Iyy > 0 ? (M - (Ixx - Izz) * p * r) / Iyy : qDot
      dx[StateIdx.R] = Izz > 0 ? (N - (Iyy - Ixx) * p * q) / Izz : rDot
    } else {
      // No aero model — use stored angular acceleration (constant accel model)
      dx[StateIdx.P] = pDot
      dx[StateIdx.Q] = qDot
      dx[StateIdx.R] = rDot
    }

    // ── Angular acceleration rate of change — zero (random walk via Q) ──
    dx[StateIdx.P_DOT] = 0
    dx[StateIdx.Q_DOT] = 0
    dx[StateIdx.R_DOT] = 0

    // ── α rate of change — zero (slowly varying, driven by Q) ──
    dx[StateIdx.ALPHA] = 0

    // ── Control rate of change — zero (random walk via Q) ──
    dx[StateIdx.DELTA_PITCH] = 0
    dx[StateIdx.DELTA_ROLL] = 0
    dx[StateIdx.DELTA_YAW] = 0

    return dx
  }

  /**
   * Build linearized Jacobian F = ∂f/∂x for covariance propagation.
   * Uses numerical differentiation for the aero model terms,
   * analytic for the kinematic equations.
   */
  private buildJacobian(dt: number): number[][] {
    const F = createIdentityMatrix(STATE_SIZE)
    const eps = 1e-6

    // Numerical Jacobian via central differences on f(x)
    const f0 = this.stateDerivative(this.x)
    for (let j = 0; j < STATE_SIZE; j++) {
      const xp = [...this.x]
      xp[j] += eps
      const fp = this.stateDerivative(xp)

      for (let i = 0; i < STATE_SIZE; i++) {
        F[i][j] += ((fp[i] - f0[i]) / eps) * dt
      }
    }

    return F
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function addScaled(a: number[], b: number[], s: number): number[] {
  return a.map((ai, i) => ai + b[i] * s)
}

function stateToEstimate(s: number[], t: number): OrientationEstimate {
  return {
    t,
    phi: s[StateIdx.PHI],
    theta: s[StateIdx.THETA],
    psi: s[StateIdx.PSI],
    p: s[StateIdx.P],
    q: s[StateIdx.Q],
    r: s[StateIdx.R],
    pDot: s[StateIdx.P_DOT],
    qDot: s[StateIdx.Q_DOT],
    rDot: s[StateIdx.R_DOT],
    alpha: s[StateIdx.ALPHA],
    deltaPitch: s[StateIdx.DELTA_PITCH],
    deltaRoll: s[StateIdx.DELTA_ROLL],
    deltaYaw: s[StateIdx.DELTA_YAW],
  }
}
