/**
 * Wingsuit deployment sub-simulation — thin wrapper around BridleChainSim.
 *
 * Responsibilities:
 * - PC throw logic (body-frame release offset + throw velocity)
 * - Compute anchor position each tick (wingsuit container → canopy bag at pin release)
 * - Freeze line-stretch snapshot with wingsuit body state
 * - Produce WingsuitDeployRenderState for the renderer
 *
 * All chain physics live in bridle-sim.ts.
 * See docs/sim/DEPLOY-WINGSUIT.md for architecture.
 */

import type { SimState } from '../polar/sim-state.ts'
import type {
  Vec3,
  WingsuitDeployPhase,
  WingsuitDeployRenderState,
  LineStretchSnapshot,
} from './deploy-types.ts'
import { BridleChainSim } from './bridle-sim.ts'
import { v3add, v3scale, bodyToInertial } from './vec3-util.ts'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Throw velocity [m/s] — body-right lateral component at toss */
const THROW_VELOCITY = 5.0

/** PC release offset from CG in body frame [m] — out at right wingtip */
const PC_RELEASE_OFFSET: Vec3 = { x: 0, y: 0.9, z: 0 }  // body Y+ = right

// ─── Deploy Sub-Sim ─────────────────────────────────────────────────────────

export class WingsuitDeploySim {
  /** The underlying bridle chain — public so sim-runner can take ownership */
  readonly bridle: BridleChainSim

  get phase(): WingsuitDeployPhase {
    return this.bridle.phase
  }

  get canopyBag() { return this.bridle.canopyBag }
  get snapshot(): LineStretchSnapshot | null { return this.bridle.snapshot }
  get segments() { return this.bridle.segments }
  get bridleTension() { return this.bridle.bridleTension }
  get pinTension() { return this.bridle.pinTension }
  get bagTension() { return this.bridle.bagTension }

  constructor(bodyState: SimState) {
    const { x, y, z, u, v, w, phi, theta, psi } = bodyState

    // Body velocity → inertial
    const bodyVel: Vec3 = { x: u, y: v, z: w }
    const inertialVel = bodyToInertial(bodyVel, phi, theta, psi)

    // Throw direction: body-right (NED body Y+) → inertial
    const throwDir = bodyToInertial({ x: 0, y: 1, z: 0 }, phi, theta, psi)

    // PC release position: out at right wingtip
    const releaseOffset = bodyToInertial(PC_RELEASE_OFFSET, phi, theta, psi)
    const pcPos = v3add({ x, y, z }, releaseOffset)
    const pcVel = v3add(inertialVel, v3scale(throwDir, THROW_VELOCITY))

    const anchorPos: Vec3 = { x, y, z }
    this.bridle = new BridleChainSim(pcPos, pcVel, anchorPos, inertialVel)
  }

  /**
   * Step the deployment sub-sim.
   * @returns true if line stretch just occurred
   */
  step(dt: number, bodyState: SimState, rho: number): boolean {
    if (this.bridle.phase === 'line_stretch') return false

    const bodyPos: Vec3 = { x: bodyState.x, y: bodyState.y, z: bodyState.z }
    const bodyVel: Vec3 = { x: bodyState.u, y: bodyState.v, z: bodyState.w }
    const inertialVel = bodyToInertial(bodyVel, bodyState.phi, bodyState.theta, bodyState.psi)

    // Body CG is always the anchor — bridle segments constrain to it,
    // suspension lines constrain the bag relative to it, line stretch
    // is detected relative to it.
    const hitLineStretch = this.bridle.step(bodyPos, inertialVel, rho, dt)

    if (hitLineStretch) {
      // Freeze snapshot with wingsuit body state
      this.bridle.freezeSnapshot(
        { ...bodyState },
        bodyPos,
      )
    }

    return hitLineStretch
  }

  /** Get render state (all positions converted to body-relative) */
  getRenderState(bodyState: SimState): WingsuitDeployRenderState {
    const bodyPos: Vec3 = { x: bodyState.x, y: bodyState.y, z: bodyState.z }
    const br = this.bridle.getRenderState(bodyPos)
    return {
      phase: this.phase,
      pcPosition: br.pcPosition,
      pcCD: br.pcCD,
      segments: br.segments,
      canopyBag: br.canopyBag,
      bridleTension: br.bridleTension,
      pinTension: br.pinTension,
      bagTension: br.bagTension,
      chainDistance: br.chainDistance,
      bagDistance: br.bagDistance,
    }
  }

  /** PC-to-body distance [m] */
  distanceToBody(bodyPos: Vec3): number {
    return this.bridle.distanceToAnchor(bodyPos)
  }
}
