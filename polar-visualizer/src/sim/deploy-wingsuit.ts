/**
 * Wingsuit deployment simulation — self-contained.
 *
 * Simulates the full deployment sequence:
 *   PC throw → bridle paying out → pin release → canopy extracting → line stretch
 *
 * Owns ALL deployment physics:
 *   - PC with tension-dependent drag
 *   - 10 bridle segments with sequential unstow
 *   - Pin release at tension threshold
 *   - Canopy bag rigid body (tumble dynamics)
 *   - Bag-to-body distance tracking (line stretch detection)
 *
 * This is a SEPARATE simulation from bridle-sim.ts. The bridle code is
 * intentionally duplicated because the deployment has different mechanics
 * (unstow, bag, suspension lines) that don't exist during canopy flight.
 * At line stretch, PC + segment state is handed off to a new BridleChainSim.
 *
 * See docs/sim/BRIDLE-REFACTOR.md and docs/sim/DEPLOY-WINGSUIT.md
 */

import type { SimState } from '../polar/sim-state.ts'
import type {
  Vec3,
  WingsuitDeployPhase,
  BridleSegmentState,
  CanopyBagState,
  WingsuitDeployRenderState,
  LineStretchSnapshot,
} from './deploy-types.ts'
import { v3add, v3sub, v3scale, v3len, v3dist, bodyToInertial } from './vec3-util.ts'

// ─── Constants ──────────────────────────────────────────────────────────────

const SEGMENT_COUNT = 10
const SEGMENT_LENGTH = 0.33       // [m] per segment
const BRIDLE_LENGTH = SEGMENT_COUNT * SEGMENT_LENGTH  // 3.3m
const TOTAL_LINE_LENGTH = 5.23    // pilot attachment to PC [m]
const SUSPENSION_LINE_LENGTH = TOTAL_LINE_LENGTH - BRIDLE_LENGTH  // ~1.93m

const PIN_SEGMENT = 1             // 0 = closest to container, 9 = closest to PC
const SEGMENT_MASS = 0.01         // [kg]
const SEG_CDA = 0.01              // CD×A for bridle segment [m²]

const PC_MASS = 0.057             // [kg]
const PC_AREA = 0.732             // [m²]
const PC_CD_MAX = 0.9
const PC_CD_MIN = 0.3
const TENSION_FULL_INFLATION = 20 // [N]

const UNSTOW_THRESHOLD = 8        // [N]
const PIN_RELEASE_THRESHOLD = 20  // [N]

const CANOPY_BAG_MASS = 3.7       // [kg]
const CANOPY_BAG_CD = 1.0
const CANOPY_BAG_AREA = 0.5       // [m²]

const THROW_VELOCITY = 5.0        // [m/s] body-right
const PC_RELEASE_OFFSET: Vec3 = { x: 0, y: 0.9, z: 0 }  // body Y+ = right wingtip

const G = 9.81

// ─── WingsuitDeploySim ──────────────────────────────────────────────────────

export class WingsuitDeploySim {
  phase: WingsuitDeployPhase = 'pc_toss'

  // PC state (inertial NED)
  private pcPos: Vec3
  private pcVel: Vec3

  // Bridle segments (inertial NED)
  private segments: BridleSegmentState[]
  private freedCount = 0
  private pinReleased = false

  // Canopy bag (spawns at pin release)
  private canopyBag: CanopyBagState | null = null

  // Tension readouts
  bridleTension = 0
  pinTension = 0
  bagTension = 0

  // Line stretch snapshot
  snapshot: LineStretchSnapshot | null = null

  constructor(bodyState: SimState) {
    const { x, y, z, u, v, w, phi, theta, psi } = bodyState
    const bodyVel: Vec3 = { x: u, y: v, z: w }
    const inertialVel = bodyToInertial(bodyVel, phi, theta, psi)

    // PC throw: release at right wingtip, throw body-right
    const throwDir = bodyToInertial({ x: 0, y: 1, z: 0 }, phi, theta, psi)
    const releaseOffset = bodyToInertial(PC_RELEASE_OFFSET, phi, theta, psi)
    this.pcPos = v3add({ x, y, z }, releaseOffset)
    this.pcVel = v3add(inertialVel, v3scale(throwDir, THROW_VELOCITY))

    // All segments start stowed at body position
    this.segments = []
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      this.segments.push({
        position: { x, y, z },
        velocity: { ...inertialVel },
        visible: false,
        freed: false,
      })
    }
  }

  /**
   * Step deployment physics.
   * @returns true if line stretch just occurred this tick
   */
  step(dt: number, bodyState: SimState, rho: number): boolean {
    if (this.phase === 'line_stretch') return false

    const bodyPos: Vec3 = { x: bodyState.x, y: bodyState.y, z: bodyState.z }
    const bodyVel: Vec3 = { x: bodyState.u, y: bodyState.v, z: bodyState.w }
    const inertialVel = bodyToInertial(bodyVel, bodyState.phi, bodyState.theta, bodyState.psi)

    // ── PC drag (tension-dependent CD) ──────────────────────────────
    const tensionFactor = Math.min(1, Math.max(0, this.bridleTension / TENSION_FULL_INFLATION))
    const pcCD = PC_CD_MIN + (PC_CD_MAX - PC_CD_MIN) * tensionFactor
    const pcSpeed = v3len(this.pcVel)
    if (pcSpeed > 0.01) {
      const dragAccel = 0.5 * rho * pcCD * PC_AREA * pcSpeed * pcSpeed / PC_MASS
      const dragDv = Math.min(dragAccel * dt, pcSpeed * 0.5)
      this.pcVel = v3sub(this.pcVel, v3scale(this.pcVel, dragDv / pcSpeed))
    }
    this.pcVel.z += G * dt
    this.pcPos = v3add(this.pcPos, v3scale(this.pcVel, dt))

    // ── Canopy bag dynamics ─────────────────────────────────────────
    if (this.canopyBag) {
      this.stepCanopyBag(rho, dt)
    }

    // ── Freed segment dynamics ──────────────────────────────────────
    for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
      const seg = this.segments[i]
      if (!seg.freed) continue
      seg.velocity.z += G * dt
      const segSpeed = v3len(seg.velocity)
      if (segSpeed > 0.1) {
        const dragAccel = 0.5 * rho * SEG_CDA * segSpeed * segSpeed / SEGMENT_MASS
        const dv = Math.min(dragAccel * dt, segSpeed * 0.5)
        seg.velocity = v3sub(seg.velocity, v3scale(seg.velocity, dv / segSpeed))
      }
      seg.position = v3add(seg.position, v3scale(seg.velocity, dt))
    }

    // ── Tension propagation (from PC inward) ────────────────────────
    let prevTension = 0
    {
      const anchor = this.freedCount > 0
        ? this.segments[SEGMENT_COUNT - 1].position
        : bodyPos
      const maxDist = this.freedCount > 0 ? SEGMENT_LENGTH : BRIDLE_LENGTH
      prevTension = this.applyConstraint(this.pcPos, this.pcVel, anchor, maxDist, PC_MASS, dt)
    }
    this.bridleTension = prevTension

    for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
      const seg = this.segments[i]
      if (!seg.freed) continue

      const outboard = (i === SEGMENT_COUNT - 1) ? this.pcPos
        : this.segments[i + 1].freed ? this.segments[i + 1].position
        : this.pcPos
      // After pin release, innermost bridle segment anchors to bag (top),
      // not body. Before pin release, stowed segments at bodyPos act as anchor.
      const inboard = (i > 0 && this.segments[i - 1].freed)
        ? this.segments[i - 1].position
        : (this.pinReleased && this.canopyBag) ? this.canopyBag.position : bodyPos

      const t = this.applyConstraint(seg.position, seg.velocity, outboard, SEGMENT_LENGTH, SEGMENT_MASS, dt)
      this.applyConstraint(seg.position, seg.velocity, inboard, SEGMENT_LENGTH, SEGMENT_MASS, dt)
      prevTension = t
    }

    // ── Bag constraint (bag to body via suspension lines) ───────────
    if (this.canopyBag) {
      this.bagTension = this.applyConstraint(
        this.canopyBag.position, this.canopyBag.velocity,
        bodyPos, SUSPENSION_LINE_LENGTH, CANOPY_BAG_MASS, dt,
      )
    }

    // ── Unstow / pin release ────────────────────────────────────────
    const innermostFreedTension = prevTension
    this.pinTension = innermostFreedTension

    if (this.freedCount < SEGMENT_COUNT && !this.pinReleased) {
      const nextIdx = SEGMENT_COUNT - 1 - this.freedCount
      if (nextIdx >= 0 && prevTension > UNSTOW_THRESHOLD) {
        if (nextIdx <= PIN_SEGMENT) {
          if (innermostFreedTension > PIN_RELEASE_THRESHOLD) {
            this.releasePin(bodyPos, inertialVel)
          }
        } else {
          this.freeSegment(nextIdx, bodyPos, inertialVel)
        }
      }
    } else if (this.pinReleased && this.freedCount < SEGMENT_COUNT) {
      // All remaining segments dump at once — spawn at bag (top of canopy)
      const spawnPos = this.canopyBag ? this.canopyBag.position : bodyPos
      const spawnVel = this.canopyBag ? this.canopyBag.velocity : inertialVel
      for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
        if (!this.segments[i].freed) {
          this.freeSegment(i, spawnPos, spawnVel)
        }
      }
    }

    // ── Phase transitions ───────────────────────────────────────────
    if (this.phase === 'pc_toss' && this.freedCount > 0) {
      this.phase = 'bridle_paying_out'
    }
    if (this.phase === 'bridle_paying_out' && this.pinReleased) {
      this.phase = 'canopy_extracting'
    }

    // ── Line stretch detection ──────────────────────────────────────
    if (this.canopyBag) {
      const bagDist = v3dist(this.canopyBag.position, bodyPos)
      if (bagDist >= SUSPENSION_LINE_LENGTH * 0.98) {
        this.bagTension = this.applyConstraint(
          this.canopyBag.position, this.canopyBag.velocity,
          bodyPos, SUSPENSION_LINE_LENGTH, CANOPY_BAG_MASS, dt,
        )
        this.phase = 'line_stretch'
        this.freezeSnapshot(bodyState, bodyPos)
        console.log(`[WSDeploy] LINE STRETCH — bag dist=${bagDist.toFixed(2)}m`)
        return true
      }
    }

    return false
  }

  // ── Canopy Bag ──────────────────────────────────────────────────────────

  private stepCanopyBag(rho: number, dt: number): void {
    const bag = this.canopyBag!
    const bagSpeed = v3len(bag.velocity)
    if (bagSpeed > 0.01) {
      const dragAccel = 0.5 * rho * CANOPY_BAG_CD * CANOPY_BAG_AREA * bagSpeed * bagSpeed / CANOPY_BAG_MASS
      const dv = Math.min(dragAccel * dt, bagSpeed * 0.5)
      bag.velocity = v3sub(bag.velocity, v3scale(bag.velocity, dv / bagSpeed))
    }
    bag.velocity.z += G * dt
    bag.position = v3add(bag.position, v3scale(bag.velocity, dt))

    // Rotation: aero damping + random tumble torques
    const AERO_DAMP = 0.5
    const dampScale = bagSpeed > 1 ? bagSpeed / 20 : 0.05
    bag.pitchRate -= AERO_DAMP * dampScale * bag.pitchRate * dt
    bag.rollRate  -= AERO_DAMP * dampScale * bag.rollRate * dt
    bag.yawRate   -= AERO_DAMP * dampScale * bag.yawRate * dt * 0.1

    bag.pitchRate += (Math.random() - 0.5) * 2.0 * dt
    bag.rollRate  += (Math.random() - 0.5) * 2.0 * dt
    bag.yawRate   += (Math.random() - 0.5) * 0.5 * dt

    bag.pitch += bag.pitchRate * dt
    bag.roll  += bag.rollRate * dt
    bag.yaw   += bag.yawRate * dt

    // Clamp pitch/roll ±90° with bounce
    const CLAMP = Math.PI / 2
    if (bag.pitch > CLAMP) { bag.pitch = CLAMP; bag.pitchRate = -Math.abs(bag.pitchRate) * 0.3 }
    if (bag.pitch < -CLAMP) { bag.pitch = -CLAMP; bag.pitchRate = Math.abs(bag.pitchRate) * 0.3 }
    if (bag.roll > CLAMP) { bag.roll = CLAMP; bag.rollRate = -Math.abs(bag.rollRate) * 0.3 }
    if (bag.roll < -CLAMP) { bag.roll = -CLAMP; bag.rollRate = Math.abs(bag.rollRate) * 0.3 }
  }

  // ── Constraint Solver ───────────────────────────────────────────────────

  private applyConstraint(
    pos: Vec3, vel: Vec3,
    anchor: Vec3, maxDist: number,
    mass: number, dt: number,
  ): number {
    const delta = v3sub(pos, anchor)
    const dist = v3len(delta)
    if (dist <= maxDist || dist < 0.001) return 0

    const correction = (dist - maxDist) / dist
    pos.x -= delta.x * correction
    pos.y -= delta.y * correction
    pos.z -= delta.z * correction

    const nx = delta.x / dist, ny = delta.y / dist, nz = delta.z / dist
    const vRad = vel.x * nx + vel.y * ny + vel.z * nz
    if (vRad > 0) {
      vel.x -= vRad * nx
      vel.y -= vRad * ny
      vel.z -= vRad * nz
    }
    return mass * Math.abs(vRad) / Math.max(dt, 1e-6)
  }

  // ── Segment Management ──────────────────────────────────────────────────

  private freeSegment(idx: number, anchorPos: Vec3, anchorVel: Vec3): void {
    const seg = this.segments[idx]
    if (seg.freed) return
    seg.freed = true
    seg.visible = true
    this.freedCount++
    seg.position = { ...anchorPos }
    seg.velocity = { ...anchorVel }
    if (this.freedCount % 3 === 0 || idx === 0) {
      console.log(`[WSDeploy] Segment ${idx} freed (${this.freedCount}/${SEGMENT_COUNT})`)
    }
  }

  private releasePin(anchorPos: Vec3, anchorVel: Vec3): void {
    this.pinReleased = true
    this.phase = 'pin_release'
    console.log(`[WSDeploy] PIN RELEASE at tension=${this.pinTension.toFixed(1)}N`)

    this.canopyBag = {
      position: { ...anchorPos },
      velocity: { ...anchorVel },
      pitch: 0,
      pitchRate: (Math.random() - 0.5) * 1.0,
      roll: 0,
      rollRate: (Math.random() - 0.5) * 1.0,
      yaw: 0,
      yawRate: (Math.random() - 0.5) * 0.5,
    }
  }

  // ── Snapshot ────────────────────────────────────────────────────────────

  private freezeSnapshot(bodyState: SimState, bodyPos: Vec3): void {
    const bag = this.canopyBag!
    const delta = v3sub(bag.position, bodyPos)
    const dist = v3len(delta)
    const tensionAxis = dist > 0.01 ? v3scale(delta, 1 / dist) : { x: 1, y: 0, z: 0 }

    // Tension axis in body frame
    const { phi, theta, psi } = bodyState
    const cp = Math.cos(phi), sp = Math.sin(phi)
    const ct = Math.cos(theta), st = Math.sin(theta)
    const cy = Math.cos(psi), sy = Math.sin(psi)
    const tx = tensionAxis.x, ty = tensionAxis.y, tz = tensionAxis.z
    const tensionAxisBody: Vec3 = {
      x: (ct * cy) * tx + (ct * sy) * ty + (-st) * tz,
      y: (sp * st * cy - cp * sy) * tx + (sp * st * sy + cp * cy) * ty + (sp * ct) * tz,
      z: (cp * st * cy + sp * sy) * tx + (cp * st * sy - sp * cy) * ty + (cp * ct) * tz,
    }

    this.snapshot = {
      bodyState: { ...bodyState },
      pcPosition: { ...this.pcPos },
      pcVelocity: { ...this.pcVel },
      canopyBag: { ...bag },
      tensionAxis: tensionAxisBody,
      tensionAxisInertial: tensionAxis,
      chainDistance: v3dist(this.pcPos, bodyPos),
      time: 0,
    }
  }

  // ── Handoff ─────────────────────────────────────────────────────────────

  /**
   * Get PC + freed segment state for constructing a BridleChainSim at handoff.
   * Only valid after line stretch.
   */
  getChainState(): { pcPos: Vec3; pcVel: Vec3; segments: Array<{ position: Vec3; velocity: Vec3 }> } {
    return {
      pcPos: { ...this.pcPos },
      pcVel: { ...this.pcVel },
      segments: this.segments
        .filter(s => s.freed)
        .map(s => ({ position: { ...s.position }, velocity: { ...s.velocity } })),
    }
  }

  // ── Render State ────────────────────────────────────────────────────────

  getRenderState(bodyState: SimState): WingsuitDeployRenderState {
    const bodyPos: Vec3 = { x: bodyState.x, y: bodyState.y, z: bodyState.z }
    const tensionFactor = Math.min(1, Math.max(0, this.bridleTension / TENSION_FULL_INFLATION))
    const pcCD = PC_CD_MIN + (PC_CD_MAX - PC_CD_MIN) * tensionFactor

    return {
      phase: this.phase,
      pcPosition: v3sub(this.pcPos, bodyPos),
      pcCD,
      segments: this.segments.map(s => ({
        ...s,
        position: v3sub(s.position, bodyPos),
      })),
      canopyBag: this.canopyBag ? {
        ...this.canopyBag,
        position: v3sub(this.canopyBag.position, bodyPos),
      } : null,
      bridleTension: this.bridleTension,
      pinTension: this.pinTension,
      bagTension: this.bagTension,
      chainDistance: v3dist(this.pcPos, bodyPos),
      bagDistance: this.canopyBag ? v3dist(this.canopyBag.position, bodyPos) : 0,
    }
  }
}
