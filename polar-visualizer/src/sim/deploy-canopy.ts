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

// ─── Constants ───────────────────────────────────────────────────────────────

/** Initial brake setting [0–1] — 30% keeps canopy from diving */
const INITIAL_BRAKE = 0.30

/** Inflation time [s] — deploy ramps from 0 → 1 over this period */
const INFLATION_TIME = 3.0

/** Initial deploy fraction at line stretch */
const INITIAL_DEPLOY = 0.05

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

  // ── Attitude: derive from inertial tension axis ────────────────────
  // The tension axis points from pilot to canopy in inertial NED.
  // The canopy body x-axis aligns along the tension axis (forward = toward canopy).
  // At line stretch the uninflated canopy is above-and-behind; the body frame
  // has x pointing along the riser line (up-and-back), giving a steep nose-up θ.
  const tx = tensionAxisInertial.x  // North component
  const ty = tensionAxisInertial.y  // East component
  const tz = tensionAxisInertial.z  // Down component

  // Heading (ψ): canopy x-axis horizontal projection → flight direction.
  // Tension axis points from pilot toward canopy (trailing behind and above),
  // so the canopy faces OPPOSITE to the tension axis horizontal projection
  // (canopy forward = into the wind = direction of flight).
  const psi = Math.atan2(-ty, -tx)

  // Pitch (θ): elevation angle of tension axis above horizontal.
  // Positive = nose up. At typical deployment: ~60–70° (canopy well above pilot).
  const horizLen = Math.sqrt(tx * tx + ty * ty)
  const theta = Math.atan2(-tz, horizLen)  // -tz because NED z+ is down; up = negative z

  // Roll (φ): from bag roll, attenuated by snatch force
  const phi = canopyBag.roll * 0.3

  // ── Angular rates: near zero at line stretch ───────────────────────
  // The canopy is a new body just beginning to fly. The snatch force
  // at line stretch absorbs most angular energy. Rather than inheriting
  // wingsuit body rates (which are in a completely different frame),
  // start with small perturbations from the bag's residual tumble.
  const BAG_RATE_DAMP = 0.1  // bag angular rates heavily damped by snatch
  const p = canopyBag.rollRate * BAG_RATE_DAMP
  const q = canopyBag.pitchRate * BAG_RATE_DAMP
  const r = canopyBag.yawRate * BAG_RATE_DAMP

  // ── Pilot coupling ICs from canopy→pilot geometry ──────────────────
  // thetaPilot = pendulum angle of pilot CG in the canopy body xz-plane.
  // Compute by projecting the canopy→pilot direction into the canopy body frame.
  // The tension axis points pilot→canopy in inertial NED, so canopy→pilot = negated.
  const pilotDir_N = -tx  // inertial NED: canopy → pilot
  const pilotDir_E = -ty
  const pilotDir_D = -tz

  // Rotate inertial canopy→pilot vector into canopy body frame (DCM transpose)
  const cPhi = Math.cos(phi), sPhi = Math.sin(phi)
  const cTheta = Math.cos(theta), sTheta = Math.sin(theta)
  const cPsi = Math.cos(psi), sPsi = Math.sin(psi)
  const pdx = (cTheta * cPsi) * pilotDir_N + (cTheta * sPsi) * pilotDir_E + (-sTheta) * pilotDir_D
  const pdy = (sPhi * sTheta * cPsi - cPhi * sPsi) * pilotDir_N +
    (sPhi * sTheta * sPsi + cPhi * cPsi) * pilotDir_E + (sPhi * cTheta) * pilotDir_D
  const pdz = (cPhi * sTheta * cPsi + sPhi * sPsi) * pilotDir_N +
    (cPhi * sTheta * sPsi - sPhi * cPsi) * pilotDir_E + (cPhi * cTheta) * pilotDir_D

  // Pendulum angle: atan2(z_body, x_body) in the canopy body xz-plane.
  // At deployment this is ~120–150° — pilot hangs well past the canopy z-axis.
  const thetaPilot = Math.atan2(pdz, pdx)

  // Pilot pitch rate: relative angular motion between wingsuit and canopy,
  // heavily damped by snatch. Use bag pitch rate as a proxy (it captures
  // the tumble state), heavily attenuated.
  const thetaPilotDot = canopyBag.pitchRate * 0.15

  // Lateral: from bag roll, attenuated
  const pilotRoll = canopyBag.roll * 0.3
  const pilotRollDot = canopyBag.rollRate * 0.15

  // Yaw → line twist: 1:1 from bag yaw accumulation. This is the payoff.
  const pilotYaw = canopyBag.yaw
  const pilotYawDot = canopyBag.yawRate

  // ── Velocity: transform from wingsuit body → inertial → canopy body ──
  const cosPhi0 = Math.cos(bodyState.phi), sinPhi0 = Math.sin(bodyState.phi)
  const cosTheta0 = Math.cos(bodyState.theta), sinTheta0 = Math.sin(bodyState.theta)
  const cosPsi0 = Math.cos(bodyState.psi), sinPsi0 = Math.sin(bodyState.psi)
  // DCM body→inertial (3-2-1)
  const vN = (cosTheta0 * cosPsi0) * bodyState.u +
    (sinPhi0 * sinTheta0 * cosPsi0 - cosPhi0 * sinPsi0) * bodyState.v +
    (cosPhi0 * sinTheta0 * cosPsi0 + sinPhi0 * sinPsi0) * bodyState.w
  const vE = (cosTheta0 * sinPsi0) * bodyState.u +
    (sinPhi0 * sinTheta0 * sinPsi0 + cosPhi0 * cosPsi0) * bodyState.v +
    (cosPhi0 * sinTheta0 * sinPsi0 - sinPhi0 * cosPsi0) * bodyState.w
  const vD = (-sinTheta0) * bodyState.u +
    (sinPhi0 * cosTheta0) * bodyState.v +
    (cosPhi0 * cosTheta0) * bodyState.w

  // Inertial → canopy body (transpose DCM with canopy Euler angles)
  const u = (cTheta * cPsi) * vN + (cTheta * sPsi) * vE + (-sTheta) * vD
  const v = (sPhi * sTheta * cPsi - cPhi * sPsi) * vN +
    (sPhi * sTheta * sPsi + cPhi * cPsi) * vE + (sPhi * cTheta) * vD
  const w = (cPhi * sTheta * cPsi + sPhi * sPsi) * vN +
    (cPhi * sTheta * sPsi - sPhi * cPsi) * vE + (cPhi * cTheta) * vD

  // ── Diagnostic: verify computed alpha matches expected ~70–85° ─────
  const V = Math.sqrt(u * u + v * v + w * w)
  const alpha_deg = V > 0.1 ? Math.atan2(w, u) * RAD_TO_DEG : 0
  const beta_deg = V > 0.1 ? Math.asin(Math.max(-1, Math.min(1, v / V))) * RAD_TO_DEG : 0
  console.log(
    `[CanopyIC] θ=${(theta * RAD_TO_DEG).toFixed(1)}° ψ=${(psi * RAD_TO_DEG).toFixed(1)}°` +
    ` α=${alpha_deg.toFixed(1)}° β=${beta_deg.toFixed(1)}°` +
    ` V=${V.toFixed(1)}m/s` +
    ` thetaPilot=${(thetaPilot * RAD_TO_DEG).toFixed(1)}°` +
    ` twist=${(pilotYaw * RAD_TO_DEG).toFixed(0)}°`,
  )

  return {
    // Position — inherit from wingsuit CG
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
   * Step the inflation.
   * @param dt Time step [s]
   * @returns deploy fraction [0–1]
   */
  step(dt: number): number {
    this.state.elapsed += dt

    if (!this.state.fullyInflated) {
      // Smooth ramp: ease-out curve (fast initial inflation, slower finish)
      const t = Math.min(1, this.state.elapsed / INFLATION_TIME)
      this.state.deploy = INITIAL_DEPLOY + (1 - INITIAL_DEPLOY) * (1 - (1 - t) * (1 - t))

      if (this.state.deploy >= 0.99) {
        this.state.deploy = 1.0
        this.state.fullyInflated = true
        console.log(`[CanopyDeploy] Fully inflated at t+${this.state.elapsed.toFixed(1)}s`)
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
