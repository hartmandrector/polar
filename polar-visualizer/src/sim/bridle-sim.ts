/**
 * Standalone bridle chain — PC + N segments trailing from an anchor.
 *
 * Used during canopy flight for PC persistence. No deployment logic,
 * no canopy bag, no suspension lines, no unstow, no phases.
 * All segments are always active.
 *
 * Receives an anchor position each tick — doesn't know what it's attached to.
 * See docs/sim/BRIDLE-REFACTOR.md for architecture.
 */

import type { Vec3, BridleRenderState } from './deploy-types.ts'
import { v3sub, v3add, v3scale, v3len, v3dist } from './vec3-util.ts'

// ─── Constants ──────────────────────────────────────────────────────────────

const G = 9.81
const SEGMENT_LENGTH = 0.33
const SEGMENT_MASS = 0.01
const SEG_CDA = 0.01

const PC_MASS = 0.057
const PC_AREA = 0.732
const PC_CD_MAX = 0.9
const PC_CD_MIN = 0.3
const TENSION_FULL_INFLATION = 20

// ─── BridleChainSim ─────────────────────────────────────────────────────────

export class BridleChainSim {
  pcPos: Vec3
  pcVel: Vec3
  private segments: Array<{ position: Vec3; velocity: Vec3 }>
  bridleTension = 0

  /**
   * Create from handoff data (PC state + freed segment positions).
   * All segments are immediately active — no unstow logic.
   */
  constructor(
    pcPos: Vec3, pcVel: Vec3,
    segments: Array<{ position: Vec3; velocity: Vec3 }>,
  ) {
    this.pcPos = { ...pcPos }
    this.pcVel = { ...pcVel }
    this.segments = segments.map(s => ({
      position: { ...s.position },
      velocity: { ...s.velocity },
    }))
  }

  /** Step the chain. Anchor is provided by the caller (canopy bridleTop). */
  step(anchorPos: Vec3, anchorVel: Vec3, rho: number, dt: number): void {
    // ── PC drag (tension-dependent CD) ──
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

    // ── Segment dynamics ──
    const N = this.segments.length
    for (let i = N - 1; i >= 0; i--) {
      const seg = this.segments[i]
      seg.velocity.z += G * dt
      const segSpeed = v3len(seg.velocity)
      if (segSpeed > 0.1) {
        const dragAccel = 0.5 * rho * SEG_CDA * segSpeed * segSpeed / SEGMENT_MASS
        const dv = Math.min(dragAccel * dt, segSpeed * 0.5)
        seg.velocity = v3sub(seg.velocity, v3scale(seg.velocity, dv / segSpeed))
      }
      seg.position = v3add(seg.position, v3scale(seg.velocity, dt))
    }

    // ── Constraints ──
    // PC to outermost segment
    const pcAnchor = N > 0 ? this.segments[N - 1].position : anchorPos
    this.bridleTension = this.applyConstraint(this.pcPos, this.pcVel, pcAnchor, SEGMENT_LENGTH, PC_MASS, dt)

    // Segments: outboard + inboard constraints
    for (let i = N - 1; i >= 0; i--) {
      const seg = this.segments[i]
      const outboard = (i === N - 1) ? this.pcPos : this.segments[i + 1].position
      const inboard = (i > 0) ? this.segments[i - 1].position : anchorPos
      this.applyConstraint(seg.position, seg.velocity, outboard, SEGMENT_LENGTH, SEGMENT_MASS, dt)
      this.applyConstraint(seg.position, seg.velocity, inboard, SEGMENT_LENGTH, SEGMENT_MASS, dt)
    }
  }

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

  /** Render state with body-relative positions (no bag, no suspension line). */
  getRenderState(bodyPos: Vec3): BridleRenderState {
    const tensionFactor = Math.min(1, Math.max(0, this.bridleTension / TENSION_FULL_INFLATION))
    const pcCD = PC_CD_MIN + (PC_CD_MAX - PC_CD_MIN) * tensionFactor
    return {
      phase: 'line_stretch',
      pcPosition: v3sub(this.pcPos, bodyPos),
      pcCD,
      segments: this.segments.map(s => ({
        position: v3sub(s.position, bodyPos),
        velocity: s.velocity,
        visible: true,
        freed: true,
      })),
      canopyBag: null,
      bridleTension: this.bridleTension,
      pinTension: 0,
      bagTension: 0,
      chainDistance: v3dist(this.pcPos, bodyPos),
      bagDistance: 0,
    }
  }
}
