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

export interface CanopyEstimatorConfig {
  lineLength: number       // meters, pilot CG to canopy AC (default 3.0)
  pilotCd: number          // pilot drag coefficient (default 0.35)
  pilotS: number           // pilot reference area m² (default 0.5 for slick, ~2.0 wingsuit)
  pilotMass: number        // kg (default 77.5)
  trimOffset_deg: number   // canopy trim AOA offset (default 6.0)
  minAirspeed: number      // m/s below which estimation is unreliable (default 5.0)
}

export const DEFAULT_CANOPY_CONFIG: CanopyEstimatorConfig = {
  lineLength: 3.0,
  pilotCd: 0.35,
  pilotS: 0.5,             // slick suit under canopy
  pilotMass: 77.5,
  trimOffset_deg: 6.0,
  minAirspeed: 5.0,
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

  /** Valid estimate flag */
  valid: boolean
}

const GRAVITY = 9.80665
const D2R = Math.PI / 180
const R2D = 180 / Math.PI

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
    cnMag: 0, valid: false,
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

  // ── Step 6: Roll from aero extraction ──
  const roll = pt.aero.roll

  // ── Step 7: Compose canopy orientation from airspeed + AOA ──
  // The canopy is a weather vane — it faces into the relative wind.
  // Heading = airspeed heading, pitch = flight path pitch + AOA offset,
  // roll = aerodynamic bank angle (same as wingsuit extraction).

  // Heading from airspeed direction
  const psi = Math.atan2(vE, vN)

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
