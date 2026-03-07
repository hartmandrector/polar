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
  const { bodyState, canopyBag, tensionAxis } = snapshot

  // ── Position & velocity: inherit from wingsuit body ────────────────
  // The canopy system (pilot + canopy) is at the same CG as the wingsuit
  // was at line stretch. Velocity transfers directly.

  // ── Attitude: derive from tension axis ─────────────────────────────
  // The tension axis points from pilot hips to canopy bag (body frame).
  // At line stretch, the canopy is roughly aligned with this axis.
  // Use the wingsuit's heading (psi) as canopy heading.
  // Pitch: tension axis gives the pitch-up angle from horizontal.
  //   In NED body frame, tensionAxis.x = forward, .z = down.
  //   If tension points up-and-forward, canopy pitches nose-down.
  const tensionPitch = Math.atan2(-tensionAxis.z, tensionAxis.x)

  // Canopy pitch: start near level flight (small nose-down)
  // The tension axis tells us the riser angle, not the canopy trim.
  // A canopy at line stretch is nearly level, trimmed slightly nose-down.
  const theta = Math.max(-0.5, Math.min(0.3, tensionPitch * 0.3))

  // Roll: from tension axis lateral component
  const phi = Math.atan2(tensionAxis.y, tensionAxis.x) * 0.3

  // Heading: inherit from wingsuit
  const psi = bodyState.psi

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

  return {
    // Position — inherit
    x: bodyState.x,
    y: bodyState.y,
    z: bodyState.z,
    // Velocity — inherit (body frame)
    u: bodyState.u,
    v: bodyState.v,
    w: bodyState.w,
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
