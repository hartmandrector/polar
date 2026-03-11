/**
 * deploy-canopy.ts — Canopy deployment state after line stretch.
 *
 * Takes LineStretchSnapshot from wingsuit deploy, computes canopy
 * initial conditions, and manages the deployment-to-flying transition.
 *
 * Physics: the canopy is essentially flying from the start, just with
 * reduced area (deploy percentage). The deploy slider ramps from 0→1
 * over the inflation time. Brakes start at 30%.
 *
 * The bridle + PC remain attached and continue their tension-drag
 * interplay behind the canopy.
 */

import type { SimState, SimStateExtended } from '../polar/sim-state.ts'
import type { LineStretchSnapshot, CanopyBagState } from './deploy-types.ts'
import { bodyToInertial, inertialToBody } from './vec3-util.ts'

// ─── Constants ───────────────────────────────────────────────────────────────

/** Initial brake setting [0–1] — 30% keeps canopy from diving */
const INITIAL_BRAKE = 0.30

/** Initial deploy fraction at line stretch */
const INITIAL_DEPLOY = 0.05

// ─── Airspeed-Driven Inflation Model ─────────────────────────────────────────
// Inflation rate ∝ dynamic pressure (V²). This couples with the sim's natural
// deceleration (more canopy area → more drag → V drops → inflation slows) to
// produce a realistic double-exponential opening profile without engineered curves.

/** Base inflation rate [1/s] at reference airspeed */
const K_INFLATE = 0.65

/** Reference airspeed [m/s] — normalizer for dynamic pressure ratio */
const V_REF = 25

/** Snivel duration [s] — slow start while slider stretches square and fabric orients */
const SNIVEL_TIME = 0.6

/** Deploy fraction at end of snivel — how far canopy opens before slider starts moving */
const SNIVEL_DEPLOY = 0.15

/** Soft speed cap — above this ratio, inflation rate grows sublinearly (sqrt) */
const V_RATIO_CAP = 1.5

// ─── Canopy Deploy State ─────────────────────────────────────────────────────

export interface CanopyDeployState {
  /** Current deploy fraction [0–1] */
  deploy: number
  /** Time since line stretch [s] */
  elapsed: number
  /** Left brake [0–1] */
  brakeLeft: number
  /** Right brake [0–1] */
  brakeRight: number
  /** Whether inflation is complete */
  fullyInflated: boolean
}

// ─── IC Computation ──────────────────────────────────────────────────────────

/**
 * Compute canopy initial conditions from line stretch snapshot.
 *
 * The canopy attitude comes from the tension axis (riser line direction):
 * the canopy "faces" along the tension axis with some initial oscillation
 * from the bag's tumble state.
 *
 * Returns a SimStateExtended with pilot coupling ICs from the bag rotation.
 */
export function computeCanopyIC(snapshot: LineStretchSnapshot): SimStateExtended {
  const { bodyState, canopyBag, tensionAxisInertial } = snapshot
  const RAD_TO_DEG = 180 / Math.PI
  const DEG_TO_RAD = Math.PI / 180

  // ── Attitude: construct body frame from tension axis + airflow ─────
  // At line stretch, opening shock aligns the canopy system to the tension axis.
  // The tension axis (pilot→bag) defines the riser/hanging direction.
  // The airflow resolves the remaining DOF (chord orientation around tension axis).
  //
  // Body frame construction:
  //   z_body = tension axis direction (toward canopy / away from pilot)
  //   y_body = z_body × velocity (spanwise, perpendicular to airflow plane)
  //   x_body = y_body × z_body (chord direction, in airflow plane)
  //
  // Line twist (bag yaw) is applied as a rotation about z_body afterward.

  const tx = tensionAxisInertial.x  // North component
  const ty = tensionAxisInertial.y  // East component
  const tz = tensionAxisInertial.z  // Down component

  // ── Direct Euler angles from tension axis geometry ─────────────────
  // The canopy orientation at line stretch is fully determined by the
  // tension axis (pilot → bag direction):
  //
  //   ψ = opposite of tension horizontal projection (canopy faces into wind)
  //   θ = tension elevation + (90° - trim) (chord ⊥ riser line)
  //   φ = attenuated bag roll (small)
  //
  // This avoids DCM/Gram-Schmidt sign ambiguities entirely.

  const TRIM_ANGLE_DEG = 6

  // Inertial velocity (needed for body-frame velocity transform below)
  const wsBodyVel = { x: bodyState.u, y: bodyState.v, z: bodyState.w }
  const vInertial = bodyToInertial(wsBodyVel, bodyState.phi, bodyState.theta, bodyState.psi)

  // ψ: canopy faces opposite to bag direction (into the wind)
  // tension points pilot→bag; canopy nose = opposite = -tension horizontal
  const psi = Math.atan2(-ty, -tx)

  // θ: tension elevation + chord-perpendicular angle
  // tensionElevation: angle of tension below/above horizontal
  // In NED: +tz = down = bag below pilot (positive elevation)
  const horizLen = Math.sqrt(tx * tx + ty * ty)
  const tensionElevation = Math.atan2(tz, horizLen)
  const theta = tensionElevation + (90 - TRIM_ANGLE_DEG) * DEG_TO_RAD

  // φ: from bag roll, attenuated by snatch force
  const phi = canopyBag.roll * 0.3

  // ── Angular rates: near zero at line stretch ───────────────────────
  // Opening shock absorbs most angular energy. Start with small
  // perturbations from bag's residual tumble.
  const BAG_RATE_DAMP = 0.1
  const p = canopyBag.rollRate * BAG_RATE_DAMP
  const q = canopyBag.pitchRate * BAG_RATE_DAMP
  const r = canopyBag.yawRate * BAG_RATE_DAMP

  // ── Pilot coupling ICs from canopy→pilot geometry ──────────────────
  // thetaPilot: pilot pitch at line stretch = wingsuit pitch (absolute).
  // With θ_canopy capped at 90°, this always lands on the stable side
  // of the body-frame gravity equilibrium.
  const thetaPilot = bodyState.theta

  // Pilot pitch rate: zero at line stretch (snatch absorbs angular energy)
  const thetaPilotDot = bodyState.q

  // Lateral roll: pilot's roll at line stretch = wingsuit roll
  const pilotRoll = bodyState.phi
  const pilotRollDot = bodyState.p  // wingsuit roll rate

  // Yaw (line twist): difference between wingsuit heading and canopy heading
  // plus any accumulated bag twist
  const pilotYaw = bodyState.psi - psi + canopyBag.yaw
  const pilotYawDot = bodyState.r  // wingsuit yaw rate

  // ── Velocity: transform inertial → canopy body (already computed above) ──
  const canopyBodyVel = inertialToBody(vInertial, phi, theta, psi)
  const u = canopyBodyVel.x
  const v = canopyBodyVel.y
  const w = canopyBodyVel.z

  // ── Diagnostic: verify computed alpha matches expected ~70–85° ─────
  const V = Math.sqrt(u * u + v * v + w * w)
  const alpha_deg = V > 0.1 ? Math.atan2(w, u) * RAD_TO_DEG : 0
  const beta_deg = V > 0.1 ? Math.asin(Math.max(-1, Math.min(1, v / V))) * RAD_TO_DEG : 0

  // Bag position relative to pilot
  const bagRel = {
    x: canopyBag.position.x - bodyState.x,
    y: canopyBag.position.y - bodyState.y,
    z: canopyBag.position.z - bodyState.z,
  }
  const bagDist = Math.sqrt(bagRel.x * bagRel.x + bagRel.y * bagRel.y + bagRel.z * bagRel.z)

  console.log(
    `[CanopyIC] θ=${(theta * RAD_TO_DEG).toFixed(1)}° φ=${(phi * RAD_TO_DEG).toFixed(1)}° ψ=${(psi * RAD_TO_DEG).toFixed(1)}°` +
    ` α=${alpha_deg.toFixed(1)}° β=${beta_deg.toFixed(1)}°` +
    ` V=${V.toFixed(1)}m/s` +
    ` thetaPilot=${(thetaPilot * RAD_TO_DEG).toFixed(1)}°` +
    ` twist=${(pilotYaw * RAD_TO_DEG).toFixed(0)}°`,
  )
  console.log(
    `[CanopyIC] tensionAxis inertial: N=${tx.toFixed(3)} E=${ty.toFixed(3)} D=${tz.toFixed(3)}` +
    ` | bagRelNED: N=${bagRel.x.toFixed(1)} E=${bagRel.y.toFixed(1)} D=${bagRel.z.toFixed(1)}` +
    ` dist=${bagDist.toFixed(1)}m`,
  )
  console.log(
    `[CanopyIC] wsAttitude: φ=${(bodyState.phi * RAD_TO_DEG).toFixed(1)}°` +
    ` θ=${(bodyState.theta * RAD_TO_DEG).toFixed(1)}°` +
    ` ψ=${(bodyState.psi * RAD_TO_DEG).toFixed(1)}°` +
    ` wsVel: u=${bodyState.u.toFixed(1)} v=${bodyState.v.toFixed(1)} w=${bodyState.w.toFixed(1)}`,
  )

  return {
    // Position — inherit from wingsuit CG (model renders at origin; position is for integrator)
    x: bodyState.x,
    y: bodyState.y,
    z: bodyState.z,
    // Velocity — transformed to canopy body frame
    u, v, w,
    // Attitude — from tension axis geometry
    phi,
    theta,
    psi,
    // Angular rates — near zero at line stretch
    p, q, r,
    // Pilot coupling — from canopy→pilot geometry + bag tumble
    thetaPilot,
    thetaPilotDot,
    pilotRoll,
    pilotRollDot,
    pilotYaw,
    pilotYawDot,
    // Body-frame gravity vector — initialized from deployment Euler angles.
    // Tracked via ġ = -ω × g to bypass Euler singularity corruption.
    gravBodyX: -Math.sin(theta),
    gravBodyY: Math.cos(theta) * Math.sin(phi),
    gravBodyZ: Math.cos(theta) * Math.cos(phi),
  }
}

// ─── Canopy Deploy Manager ───────────────────────────────────────────────────

/**
 * Manages the canopy deployment phase after line stretch.
 *
 * Responsibilities:
 * - Ramp deploy fraction 0 → 1 over inflation time
 * - Hold initial brake setting
 * - Track inflation state
 * - Provide deploy state for sim config (area scaling, slider morph)
 */
export class CanopyDeployManager {
  state: CanopyDeployState

  constructor() {
    this.state = {
      deploy: INITIAL_DEPLOY,
      elapsed: 0,
      brakeLeft: INITIAL_BRAKE,
      brakeRight: INITIAL_BRAKE,
      fullyInflated: false,
    }
  }

  /**
   * Step the inflation using airspeed-driven model.
   *
   * Inflation rate ∝ (V/V_ref)² — dynamic pressure drives the slider down.
   * Initial snivel phase provides slow start (slider stretching, fabric orienting).
   * The sim's own drag model closes the feedback loop: more area → more drag → V drops → inflation slows.
   *
   * @param dt Time step [s]
   * @param airspeed Current airspeed [m/s] — sqrt(u²+v²+w²) from sim state
   * @returns deploy fraction [0–1]
   */
  step(dt: number, airspeed: number): number {
    this.state.elapsed += dt

    if (!this.state.fullyInflated) {
      if (this.state.elapsed < SNIVEL_TIME) {
        // ── Snivel phase: linear ramp to SNIVEL_DEPLOY ──
        // Slider stretching square, fabric catching air, not yet pressurized.
        const t = this.state.elapsed / SNIVEL_TIME
        this.state.deploy = INITIAL_DEPLOY + (SNIVEL_DEPLOY - INITIAL_DEPLOY) * t
      } else {
        // ── Main inflation: rate ∝ dynamic pressure with soft cap ──
        // dDeploy/dt = K * qRatio, where qRatio = vRatio² up to the cap,
        // then transitions to sqrt growth (fabric/slider structural limit).
        const vRatio = airspeed / V_REF
        let qRatio: number
        if (vRatio <= V_RATIO_CAP) {
          qRatio = vRatio * vRatio
        } else {
          // Smooth transition: match value and slope at cap, then sqrt growth
          const capQ = V_RATIO_CAP * V_RATIO_CAP
          qRatio = capQ * Math.sqrt(vRatio / V_RATIO_CAP)
        }
        const dDeploy = K_INFLATE * qRatio * dt
        this.state.deploy = Math.min(1, this.state.deploy + dDeploy)
      }

      if (this.state.deploy >= 0.99) {
        this.state.deploy = 1.0
        this.state.fullyInflated = true
        console.log(`[CanopyDeploy] Fully inflated at t+${this.state.elapsed.toFixed(1)}s V=${airspeed.toFixed(1)}m/s`)
      }
    }

    return this.state.deploy
  }

  /** Get brake inputs (gamepad can override later) */
  getBrakes(): { left: number; right: number } {
    return { left: this.state.brakeLeft, right: this.state.brakeRight }
  }

  /** Set brake inputs from gamepad */
  setBrakes(left: number, right: number): void {
    this.state.brakeLeft = left
    this.state.brakeRight = right
  }
}
