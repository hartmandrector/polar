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

  // ── Position & velocity: inherit from wingsuit body ────────────────
  // Velocity needs to be re-expressed in the NEW body frame (canopy attitude).
  // For now, keep the inertial velocity and let the integrator sort it out
  // by converting body vel → inertial vel → new body vel.

  // ── Attitude: derive from inertial tension axis ────────────────────
  // The tension axis points from pilot to canopy in inertial NED.
  // The canopy faces INTO the relative wind, opposite to the tension direction.
  // Canopy x-body (forward) ≈ -tension_horizontal (canopy faces away from lines)
  const tx = tensionAxisInertial.x  // North component
  const ty = tensionAxisInertial.y  // East component
  const tz = tensionAxisInertial.z  // Down component

  // Heading: the canopy faces opposite to the tension axis horizontal projection
  // (lines trail behind, canopy faces forward into wind)
  const psi = Math.atan2(-ty, -tx)

  // Pitch: canopy hangs with lines going up-and-back
  // The angle of the tension axis from horizontal gives the line angle.
  // Canopy trim is roughly level — small nose-down from the line angle.
  const horizLen = Math.sqrt(tx * tx + ty * ty)
  const lineAngle = Math.atan2(-tz, horizLen)  // positive = lines go up
  // Canopy pitch: slightly nose-down, influenced by line angle
  const theta = -0.1 + lineAngle * 0.2  // ~-6° default, modulated by line angle

  // Roll: from bag roll, attenuated
  const phi = canopyBag.roll * 0.3

  // ── Angular rates: inherit with damping (snatch force dampens rotation) ──
  const SNATCH_DAMP = 0.3  // line stretch absorbs ~70% of angular energy
  const p = bodyState.p * SNATCH_DAMP
  const q = bodyState.q * SNATCH_DAMP
  const r = bodyState.r * SNATCH_DAMP

  // ── Pilot coupling ICs from canopy bag tumble ──────────────────────
  // Bag pitch → pilot pitch pendulum offset
  const thetaPilot = canopyBag.pitch * 0.5   // attenuated — not 1:1
  const thetaPilotDot = canopyBag.pitchRate * 0.3

  // Bag roll → pilot lateral offset
  const pilotRoll = canopyBag.roll * 0.3
  const pilotRollDot = canopyBag.rollRate * 0.2

  // Bag yaw → initial line twist! This is the payoff.
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

  // Inertial → canopy body (transpose DCM with canopy Euler)
  const cPhi = Math.cos(phi), sPhi = Math.sin(phi)
  const cTheta = Math.cos(theta), sTheta = Math.sin(theta)
  const cPsi = Math.cos(psi), sPsi = Math.sin(psi)
  const u = (cTheta * cPsi) * vN + (cTheta * sPsi) * vE + (-sTheta) * vD
  const v = (sPhi * sTheta * cPsi - cPhi * sPsi) * vN +
    (sPhi * sTheta * sPsi + cPhi * cPsi) * vE + (sPhi * cTheta) * vD
  const w = (cPhi * sTheta * cPsi + sPhi * sPsi) * vN +
    (cPhi * sTheta * sPsi - sPhi * cPsi) * vE + (cPhi * cTheta) * vD

  return {
    // Position — inherit
    x: bodyState.x,
    y: bodyState.y,
    z: bodyState.z,
    // Velocity — transformed to canopy body frame
    u, v, w,
    // Attitude — computed from tension axis
    phi,
    theta,
    psi,
    // Angular rates — damped
    p, q, r,
    // Pilot coupling — from bag tumble
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
