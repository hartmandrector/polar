/**
 * canopy-estimator.ts — Estimate canopy position and orientation from GPS pipeline data.
 *
 * Uses the acceleration-decomposition method from BASEline XR / CloudBASE:
 *   1. Project measured acceleration onto velocity → drag acceleration
 *   2. Rejection from velocity → lift acceleration
 *   3. Subtract pilot body drag → residual = canopy normal force direction
 *   4. Normalize × line length → canopy position relative to pilot (NED)
 *   5. AOA from CN-velocity geometry + trim offset
 *   6. Roll from aero extraction bank angle
 *   7. Compose orientation: airspeed heading + AOA pitch + roll
 *
 * Reference: docs/reference/canopyblxr.kt (Kotlin original)
 */

import type { GPSPipelinePoint } from '../gps/types.ts'

// ─── Config ─────────────────────────────────────────────────────────────────

export type RollMethod = 'aero' | 'coordinated' | 'full' | 'blended'

export interface CanopyEstimatorConfig {
  lineLength: number       // meters, pilot CG to canopy AC (default 3.0)
  pilotCd: number          // pilot drag coefficient (default 0.35)
  pilotS: number           // pilot reference area m² (default 0.5 for slick, ~2.0 wingsuit)
  pilotMass: number        // kg (default 77.5)
  canopyMass: number       // kg (default 5.0)
  trimOffset_deg: number   // canopy trim AOA offset (default 6.0)
  minAirspeed: number      // m/s below which estimation is unreliable (default 5.0)
  rollMethod: RollMethod   // roll estimation method (default 'blended')
  minTurnRate_degS: number // deg/s below which coordinated turn roll is unreliable (default 3.0)
}

export const DEFAULT_CANOPY_CONFIG: CanopyEstimatorConfig = {
  lineLength: 3.0,
  pilotCd: 0.35,
  pilotS: 0.5,             // slick suit under canopy
  pilotMass: 77.5,
  canopyMass: 5.0,
  trimOffset_deg: 6.0,
  minAirspeed: 5.0,
  rollMethod: 'blended',
  minTurnRate_degS: 3.0,
}

// ─── Output ─────────────────────────────────────────────────────────────────

export interface CanopyState {
  /** Canopy position relative to pilot, NED [m] */
  cpN: number
  cpE: number
  cpD: number

  /** Canopy airspeed components, NED [m/s] (= pilot airspeed for now) */
  vcpN: number
  vcpE: number
  vcpD: number

  /** Canopy angle of attack [rad] */
  aoa: number

  /** Canopy roll angle [rad] — from aero extraction bank */
  roll: number

  /** Canopy orientation as Euler angles [rad] */
  phi: number     // roll
  theta: number   // pitch
  psi: number     // heading

  /** CN force magnitude [m/s²] — quality metric (should be ~g for steady flight) */
  cnMag: number

  /** Which roll method was used */
  rollMethod: RollMethod

  /** Valid estimate flag */
  valid: boolean
}

const GRAVITY = 9.80665
const D2R = Math.PI / 180
const R2D = 180 / Math.PI

// ─── Roll Estimation Methods ────────────────────────────────────────────────
// Reference: docs/PARAGLIDER-ROLL.md, A. Nagy & J. Roha (831paraglider roll.pdf)

/**
 * Coordinated turn roll angle from GPS heading rate and airspeed.
 * γ = atan(v² / (g·R)) = atan(v·ω / g)
 *
 * Sign: positive ω (turning right) → positive γ (right bank)
 */
export function coordinatedTurnRoll(airspeed_ms: number, headingRate_radS: number): number {
  // R = v / ω  →  v²/R = v·ω
  return Math.atan2(airspeed_ms * headingRate_radS, GRAVITY)
}

/**
 * Full transversal model roll (equation 7 from Nagy & Roha).
 * Accounts for canopy and pilot CG being at different distances from system CG.
 *
 * Solves: (G_p·k₃ − G_k·k₂)·sin(γ) = (G_p·k₃ − G_k·k₂)/g · (v²/R)·cos(γ)
 *         + ΔF_b·k₁  (brake asymmetry, set to 0 when unknown)
 *
 * With ΔF_b = 0 the geometry correction is small (~1-2°) vs coordinated turn,
 * but the framework supports adding brake estimation later.
 */
export function fullTransversalRoll(
  airspeed_ms: number,
  headingRate_radS: number,
  pilotMass_kg: number,
  canopyMass_kg: number,
  lineLength_m: number,
  deltaFb_N: number = 0,   // asymmetric brake force (0 = unknown)
): number {
  const totalMass = pilotMass_kg + canopyMass_kg
  if (totalMass <= 0) return 0

  // System CG position along the line (from pilot end)
  // k₃ = distance from pilot CG to system CG
  // k₂ = distance from canopy CG to system CG
  const k3 = canopyMass_kg / totalMass * lineLength_m   // pilot side
  const k2 = pilotMass_kg / totalMass * lineLength_m    // canopy side
  const k1 = lineLength_m                                // lift force arm ≈ full line length

  const Gp = pilotMass_kg * GRAVITY
  const Gk = canopyMass_kg * GRAVITY

  // v²/R = v·ω
  const centripetal = airspeed_ms * headingRate_radS

  // Moment coefficients: A·sin(γ) = B·cos(γ) + C
  // From eq 7: −ΔF_b·k₁ − (Gp/g)·(v²/R)·k₃·cos(γ) + (Gk/g)·(v²/R)·k₂·cos(γ)
  //            + Gp·sin(γ)·k₃ − Gk·sin(γ)·k₂ = 0
  const A = Gp * k3 - Gk * k2                              // gravity restoring
  const B = (Gp * k3 - Gk * k2) / GRAVITY * centripetal    // centrifugal (note sign flip)
  const C = -deltaFb_N * k1                                 // brake input

  // A·sin(γ) − B·cos(γ) = C
  // → γ = atan2(B, A) + asin(C / sqrt(A² + B²))
  const mag = Math.sqrt(A * A + B * B)
  if (mag < 1e-10) return 0

  const clampedC = Math.max(-mag, Math.min(mag, C))
  return Math.atan2(B, A) + Math.asin(clampedC / mag)
}

// ─── Core Estimation ────────────────────────────────────────────────────────

/**
 * Estimate canopy state for a single GPS pipeline point.
 */
export function estimateCanopyState(
  pt: GPSPipelinePoint,
  config: CanopyEstimatorConfig = DEFAULT_CANOPY_CONFIG,
): CanopyState {
  const p = pt.processed

  const invalid: CanopyState = {
    cpN: 0, cpE: 0, cpD: -config.lineLength,
    vcpN: 0, vcpE: 0, vcpD: 0,
    aoa: 0, roll: 0, phi: 0, theta: 0, psi: 0,
    cnMag: 0, rollMethod: 'aero', valid: false,
  }

  if (p.airspeed < config.minAirspeed) return invalid

  const vN = p.velN
  const vE = p.velE
  const vD = p.velD
  const vel = p.airspeed

  // Measured acceleration (NED) — from LS estimator
  const aN = p.accelN
  const aE = p.accelE
  const aD = p.accelD

  // Subtract gravity (NED: gravity is +D)
  const aD_noG = aD - GRAVITY

  // ── Step 1: Drag acceleration (projection of accel onto velocity) ──
  const proj = (aN * vN + aE * vE + aD_noG * vD) / vel
  const dragN = proj * vN / vel
  const dragE = proj * vE / vel
  const dragD = proj * vD / vel

  // ── Step 2: Lift acceleration (rejection from velocity) ──
  const liftN = aN - dragN
  const liftE = aE - dragE
  const liftD = aD_noG - dragD

  // ── Step 3: Subtract pilot body drag → canopy normal force ──
  const qPilot = 0.5 * p.rho * vel * vel
  const pilotDragAccel = config.pilotCd * qPilot * config.pilotS / config.pilotMass

  // Pilot drag acts opposite to velocity
  const pdN = vel > 0 ? -vN / vel * pilotDragAccel : 0
  const pdE = vel > 0 ? -vE / vel * pilotDragAccel : 0
  const pdD = vel > 0 ? -vD / vel * pilotDragAccel : 0

  // Canopy normal = total aero force minus pilot drag
  // (lift + drag = total aero force from acceleration)
  const cnN = liftN + dragN - pdN
  const cnE = liftE + dragE - pdE
  const cnD = liftD + dragD - pdD

  const cnMag = Math.sqrt(cnN * cnN + cnE * cnE + cnD * cnD)
  if (cnMag < 0.1) return invalid

  // ── Step 4: Canopy position = normalized CN × line length ──
  const cpN = config.lineLength * cnN / cnMag
  const cpE = config.lineLength * cnE / cnMag
  const cpD = config.lineLength * cnD / cnMag

  // ── Step 5: AOA from CN-velocity geometry ──
  // Angle between canopy position vector and velocity
  const dot = cpN * vN + cpE * vE + cpD * vD
  const cpMagV = Math.sqrt(cpN * cpN + cpE * cpE + cpD * cpD)
  const vMag = Math.sqrt(vN * vN + vE * vE + vD * vD)

  let aoa = 0
  if (cpMagV > 0 && vMag > 0) {
    const cosAngle = Math.max(-1, Math.min(1, dot / (cpMagV * vMag)))
    const angleBetween = Math.PI - Math.acos(cosAngle)
    const trimAngle = Math.PI / 2 + config.trimOffset_deg * D2R
    aoa = Math.PI - trimAngle - angleBetween
  }

  // ── Step 6: Roll estimation (method-dependent) ──
  // See docs/PARAGLIDER-ROLL.md for derivation
  const aeroRoll = pt.aero.roll
  const psiDot_radS = pt.bodyRates?.psiDot != null
    ? pt.bodyRates.psiDot * D2R  // bodyRates.psiDot is deg/s
    : 0

  let roll: number
  let usedMethod: RollMethod

  if (config.rollMethod === 'aero') {
    roll = aeroRoll
    usedMethod = 'aero'
  } else if (config.rollMethod === 'coordinated') {
    roll = coordinatedTurnRoll(vel, psiDot_radS)
    usedMethod = 'coordinated'
  } else if (config.rollMethod === 'full') {
    roll = fullTransversalRoll(vel, psiDot_radS, config.pilotMass, config.canopyMass, config.lineLength)
    usedMethod = 'full'
  } else {
    // 'blended': use coordinated turn roll when turning, aero roll in straight flight.
    // Blend based on heading rate magnitude.
    const absPsiDot = Math.abs(pt.bodyRates?.psiDot ?? 0) // deg/s
    if (absPsiDot > config.minTurnRate_degS * 2) {
      // Strong turn — coordinated turn roll is reliable
      roll = coordinatedTurnRoll(vel, psiDot_radS)
      usedMethod = 'coordinated'
    } else if (absPsiDot < config.minTurnRate_degS) {
      // Straight flight — aero extraction is better
      roll = aeroRoll
      usedMethod = 'aero'
    } else {
      // Transition — linear blend
      const t = (absPsiDot - config.minTurnRate_degS) / config.minTurnRate_degS
      const coordRoll = coordinatedTurnRoll(vel, psiDot_radS)
      roll = aeroRoll * (1 - t) + coordRoll * t
      usedMethod = 'blended'
    }
  }

  // ── Step 7: Compose canopy orientation from airspeed + AOA ──
  // The canopy is a weather vane — it faces into the relative wind.
  // Heading = airspeed heading, pitch = flight path pitch + AOA offset,
  // roll = aerodynamic bank angle (same as wingsuit extraction).

  // Heading from airspeed direction
  const psi = Math.atan2(vE, vN) + aoa * Math.sin(roll)

  // Flight path angle (positive = climbing, negative = descending)
  const gamma = -Math.atan2(vD, Math.sqrt(vN * vN + vE * vE))

  // Canopy pitch = flight path + AOA (AOA pitches nose up relative to flight path)
  const theta = gamma + aoa * Math.cos(roll)

  const phi = roll

  return {
    cpN, cpE, cpD,
    vcpN: vN, vcpE: vE, vcpD: vD,
    aoa, roll,
    phi, theta, psi,
    cnMag,
    rollMethod: usedMethod,
    valid: true,
  }
}

// ─── Batch Processing ───────────────────────────────────────────────────────

/**
 * Run canopy estimation over all pipeline points.
 * Returns array aligned 1:1 with input points.
 */
export function estimateCanopyBatch(
  points: GPSPipelinePoint[],
  config: Partial<CanopyEstimatorConfig> = {},
): CanopyState[] {
  const cfg = { ...DEFAULT_CANOPY_CONFIG, ...config }
  return points.map(pt => estimateCanopyState(pt, cfg))
}
