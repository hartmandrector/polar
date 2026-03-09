/**
 * Standalone bridle chain simulation.
 *
 * Extracted from deploy-wingsuit.ts so it can be driven by any anchor body
 * (wingsuit, canopy, skydiver). No knowledge of the anchor's attitude or
 * body frame — it receives an inertial NED position+velocity each tick.
 *
 * Chain: PC → N bridle segments → pin → canopy bag → suspension lines.
 * All internal state is inertial NED.
 *
 * See docs/sim/BRIDLE-REFACTOR.md for architecture.
 */

import type {
  Vec3,
  BridlePhase,
  BridleSegmentState,
  CanopyBagState,
  BridleRenderState,
  LineStretchSnapshot,
} from './deploy-types.ts'
import {
  v3zero, v3add, v3sub, v3scale, v3dot, v3len, v3dist,
} from './vec3-util.ts'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Number of bridle segments */
const SEGMENT_COUNT = 10

/** Rest length of each segment [m] */
const SEGMENT_LENGTH = 0.33

/** Total bridle length [m] */
const BRIDLE_LENGTH = SEGMENT_COUNT * SEGMENT_LENGTH  // 3.3m

/** Total chain: pilot attachment to PC [m] */
const TOTAL_LINE_LENGTH = 5.23

/** Suspension line length: risers to canopy [m] */
const SUSPENSION_LINE_LENGTH = TOTAL_LINE_LENGTH - BRIDLE_LENGTH  // ~1.93m

/** Pin position: segment index (0 = closest to container, 9 = closest to PC) */
const PIN_SEGMENT = 1

/** Mass per segment [kg] */
const SEGMENT_MASS = 0.01

/** PC mass [kg] */
const PC_MASS = 0.057

/** PC frontal area [m²] — full canopy */
const PC_AREA = 0.732

/** PC CD at full inflation (high tension) */
const PC_CD_MAX = 0.9

/** PC CD when collapsed (low tension) */
const PC_CD_MIN = 0.3

/** Tension [N] at which PC is fully inflated */
const TENSION_FULL_INFLATION = 20

/** Tension threshold to unstow next segment [N] */
const UNSTOW_THRESHOLD = 8

/** Tension threshold to release closing pin [N] */
const PIN_RELEASE_THRESHOLD = 20

/** Canopy bag mass [kg] */
const CANOPY_BAG_MASS = 3.7

/** Canopy bag drag coefficient (bluff body) */
const CANOPY_BAG_CD = 1.0

/** Canopy bag frontal area [m²] */
const CANOPY_BAG_AREA = 0.5

/** Segment drag area [m²] */
const SEG_CDA = 0.01

/** Gravity [m/s²] */
const G = 9.81

// ─── BridleChainSim ─────────────────────────────────────────────────────────

export class BridleChainSim {
  phase: BridlePhase = 'pc_toss'

  /** PC state — inertial NED */
  pcPos: Vec3
  pcVel: Vec3

  /** Bridle segments — inertial NED */
  segments: BridleSegmentState[]

  /** How many segments have been freed (from PC end inward) */
  freedCount = 0

  /** Pin released? */
  private pinReleased = false

  /** Canopy bag (spawns at pin release) — inertial NED */
  canopyBag: CanopyBagState | null = null

  /** Current bridle tension at PC end [N] */
  bridleTension = 0
  /** Current tension at pin segment [N] */
  pinTension = 0
  /** Current tension on suspension lines (bag to body) [N] */
  bagTension = 0

  /** Snapshot frozen at line stretch */
  snapshot: LineStretchSnapshot | null = null

  /**
   * @param pcPos    Initial PC position (inertial NED)
   * @param pcVel    Initial PC velocity (inertial NED)
   * @param anchorPos Initial anchor position (inertial NED — body CG at toss)
   * @param anchorVel Initial anchor velocity (inertial NED)
   */
  constructor(pcPos: Vec3, pcVel: Vec3, anchorPos: Vec3, anchorVel: Vec3) {
    this.pcPos = { ...pcPos }
    this.pcVel = { ...pcVel }

    // Initialize all segments at anchor position (stowed in container)
    this.segments = []
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      this.segments.push({
        position: { ...anchorPos },
        velocity: { ...anchorVel },
        visible: false,
        freed: false,
      })
    }
  }

  /**
   * Step the bridle chain.
   *
   * @param bodyPos    Body (pilot CG) position in inertial NED — suspension line anchor + line stretch reference
   * @param bodyVel    Body velocity in inertial NED
   * @param rho        Air density [kg/m³]
   * @param dt         Time step [s]
   * @returns true if line stretch just occurred this tick
   */
  step(bodyPos: Vec3, bodyVel: Vec3, rho: number, dt: number): boolean {
    // Post-line-stretch: keep the chain tracking the anchor
    if (this.phase === 'line_stretch') {
      this.stepPostLineStretch(bodyPos, bodyVel, rho, dt)
      return false
    }

    // ── PC drag (tension-dependent CD) ──────────────────────────────
    const tensionFactor = Math.min(1, Math.max(0, this.bridleTension / TENSION_FULL_INFLATION))
    const pcCD = PC_CD_MIN + (PC_CD_MAX - PC_CD_MIN) * tensionFactor

    const pcSpeed = v3len(this.pcVel)
    if (pcSpeed > 0.01) {
      const dragAccel = 0.5 * rho * pcCD * PC_AREA * pcSpeed * pcSpeed / PC_MASS
      const dragDv = Math.min(dragAccel * dt, pcSpeed * 0.5)
      this.pcVel = v3sub(this.pcVel, v3scale(this.pcVel, dragDv / pcSpeed))
    }

    // Gravity
    this.pcVel.z += G * dt

    // Integrate PC position
    this.pcPos = v3add(this.pcPos, v3scale(this.pcVel, dt))

    // ── Canopy bag drag + gravity + rotation ────────────────────────
    if (this.canopyBag) {
      this.stepCanopyBag(rho, dt)
    }

    // ── Freed segment dynamics ──────────────────────────────────────
    for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
      const seg = this.segments[i]
      if (!seg.freed) continue

      // Gravity
      seg.velocity.z += G * dt
      // Drag
      const segSpeed = v3len(seg.velocity)
      if (segSpeed > 0.1) {
        const segDragAccel = 0.5 * rho * SEG_CDA * segSpeed * segSpeed / SEGMENT_MASS
        const segDv = Math.min(segDragAccel * dt, segSpeed * 0.5)
        seg.velocity = v3sub(seg.velocity, v3scale(seg.velocity, segDv / segSpeed))
      }
      // Integrate
      seg.position = v3add(seg.position, v3scale(seg.velocity, dt))
    }

    // ── Tension propagation (from PC inward) ────────────────────────
    // Bridle segments anchor to the body CG (container) — always bodyPos.
    // After pin release all segments are freed and constrained to each other.
    let prevTension = 0
    {
      const anchor = this.freedCount > 0
        ? this.segments[SEGMENT_COUNT - 1].position
        : bodyPos
      const maxDist = this.freedCount > 0 ? SEGMENT_LENGTH : BRIDLE_LENGTH
      prevTension = this.applyConstraint(this.pcPos, this.pcVel, anchor, maxDist, PC_MASS, dt)
    }
    this.bridleTension = prevTension

    // Constrain each freed segment
    for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
      const seg = this.segments[i]
      if (!seg.freed) continue

      const outboard = (i === SEGMENT_COUNT - 1) ? this.pcPos
        : this.segments[i + 1].freed ? this.segments[i + 1].position
        : this.pcPos

      const inboard = (i > 0 && this.segments[i - 1].freed)
        ? this.segments[i - 1].position
        : bodyPos

      const t = this.applyConstraint(seg.position, seg.velocity, outboard, SEGMENT_LENGTH, SEGMENT_MASS, dt)
      this.applyConstraint(seg.position, seg.velocity, inboard, SEGMENT_LENGTH, SEGMENT_MASS, dt)

      prevTension = t
    }

    // Constrain canopy bag to BODY via suspension lines.
    // The suspension lines always connect bag → harness (body CG), not to the
    // bridle attachment point. This is where line stretch is detected.
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
            this.releasePin(bodyPos, bodyVel)
          }
        } else {
          this.freeSegment(nextIdx, bodyPos, bodyVel)
        }
      }
    } else if (this.pinReleased && this.freedCount < SEGMENT_COUNT) {
      for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
        if (!this.segments[i].freed) {
          this.freeSegment(i, bodyPos, bodyVel)
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

    // ── Line stretch check ──────────────────────────────────────────
    // Check bag distance from BODY (not bridle attach) — suspension lines
    // connect the canopy bag to the harness/pilot.
    if (this.canopyBag) {
      const bagDist = v3dist(this.canopyBag.position, bodyPos)
      if (bagDist >= SUSPENSION_LINE_LENGTH * 0.98) {
        // Clamp bag to exact suspension line length and kill outward velocity.
        // This is what physically happens at line stretch — the lines go taut
        // and the canopy snaps to the constraint distance.
        this.bagTension = this.applyConstraint(
          this.canopyBag.position, this.canopyBag.velocity,
          bodyPos, SUSPENSION_LINE_LENGTH, CANOPY_BAG_MASS, dt,
        )
        this.phase = 'line_stretch'
        console.log(`[BridleSim] LINE STRETCH — bag dist=${bagDist.toFixed(2)}m → clamped to ${SUSPENSION_LINE_LENGTH.toFixed(2)}m`)
        return true
      }
    }

    return false
  }

  // ── Post-line-stretch tracking ──────────────────────────────────────────

  /**
   * After line stretch, the canopy bag is gone — the bridle attaches directly
   * to the canopy top (bodyPos = bridleTop attachment). Only the PC and 10
   * bridle segments remain, constrained in a chain from the anchor.
   */
  private stepPostLineStretch(bodyPos: Vec3, bodyVel: Vec3, rho: number, dt: number): void {
    // Clear canopy bag — it no longer exists after line stretch
    this.canopyBag = null
    this.bagTension = 0

    // PC drag
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

    // Freed segment dynamics (drag + gravity + integrate)
    for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
      const seg = this.segments[i]
      if (!seg.freed) continue
      seg.velocity.z += G * dt
      const segSpeed = v3len(seg.velocity)
      if (segSpeed > 0.1) {
        const segDragAccel = 0.5 * rho * SEG_CDA * segSpeed * segSpeed / SEGMENT_MASS
        const segDv = Math.min(segDragAccel * dt, segSpeed * 0.5)
        seg.velocity = v3sub(seg.velocity, v3scale(seg.velocity, segDv / segSpeed))
      }
      seg.position = v3add(seg.position, v3scale(seg.velocity, dt))
    }

    // Constrain PC to outermost freed segment (or directly to anchor)
    const pcAnchor = this.freedCount > 0
      ? this.segments[SEGMENT_COUNT - 1].position
      : bodyPos
    const pcMaxDist = this.freedCount > 0 ? SEGMENT_LENGTH : BRIDLE_LENGTH
    this.bridleTension = this.applyConstraint(this.pcPos, this.pcVel, pcAnchor, pcMaxDist, PC_MASS, dt)

    // Constrain freed segments: each to its outboard neighbor + inboard neighbor/anchor
    for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
      const seg = this.segments[i]
      if (!seg.freed) continue
      const outboard = (i === SEGMENT_COUNT - 1) ? this.pcPos
        : this.segments[i + 1].freed ? this.segments[i + 1].position
        : this.pcPos
      const inboard = (i > 0 && this.segments[i - 1].freed)
        ? this.segments[i - 1].position
        : bodyPos
      this.applyConstraint(seg.position, seg.velocity, outboard, SEGMENT_LENGTH, SEGMENT_MASS, dt)
      this.applyConstraint(seg.position, seg.velocity, inboard, SEGMENT_LENGTH, SEGMENT_MASS, dt)
    }
  }

  // ── Canopy Bag Sub-step ─────────────────────────────────────────────────

  private stepCanopyBag(rho: number, dt: number): void {
    const bag = this.canopyBag!
    const bagSpeed = v3len(bag.velocity)
    if (bagSpeed > 0.01) {
      const bagDragAccel = 0.5 * rho * CANOPY_BAG_CD * CANOPY_BAG_AREA * bagSpeed * bagSpeed / CANOPY_BAG_MASS
      const bagDragDv = Math.min(bagDragAccel * dt, bagSpeed * 0.5)
      bag.velocity = v3sub(bag.velocity, v3scale(bag.velocity, bagDragDv / bagSpeed))
    }
    bag.velocity.z += G * dt
    bag.position = v3add(bag.position, v3scale(bag.velocity, dt))

    // Rotation dynamics — aero damping + random tumble
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

    // Clamp pitch and roll to ±90° with bounce
    const CLAMP = Math.PI / 2
    if (bag.pitch > CLAMP) { bag.pitch = CLAMP; bag.pitchRate = -Math.abs(bag.pitchRate) * 0.3 }
    if (bag.pitch < -CLAMP) { bag.pitch = -CLAMP; bag.pitchRate = Math.abs(bag.pitchRate) * 0.3 }
    if (bag.roll > CLAMP) { bag.roll = CLAMP; bag.rollRate = -Math.abs(bag.rollRate) * 0.3 }
    if (bag.roll < -CLAMP) { bag.roll = -CLAMP; bag.rollRate = Math.abs(bag.rollRate) * 0.3 }
  }

  // ── Constraint Solver ───────────────────────────────────────────────────

  /** Apply distance constraint. Returns tension estimate [N]. */
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

  /** Free a segment (unstow) */
  private freeSegment(idx: number, anchorPos: Vec3, anchorVel: Vec3): void {
    const seg = this.segments[idx]
    if (seg.freed) return
    seg.freed = true
    seg.visible = true
    this.freedCount++

    seg.position = { ...anchorPos }
    seg.velocity = { ...anchorVel }

    if (this.freedCount % 3 === 0 || idx === 0) {
      console.log(`[BridleSim] Segment ${idx} freed (${this.freedCount}/${SEGMENT_COUNT})`)
    }
  }

  /** Release closing pin — spawn canopy bag */
  private releasePin(anchorPos: Vec3, anchorVel: Vec3): void {
    this.pinReleased = true
    this.phase = 'pin_release'
    console.log(`[BridleSim] PIN RELEASE at tension=${this.pinTension.toFixed(1)}N`)

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

  /**
   * Freeze line-stretch snapshot. Called by the owning sim (deploy-wingsuit
   * or sim-runner) which fills in `bodyState`.
   */
  freezeSnapshot(bodyState: LineStretchSnapshot['bodyState'], anchorPos: Vec3): void {
    const delta = v3sub(this.canopyBag!.position, anchorPos)
    const dist = v3len(delta)
    const tensionAxis = dist > 0.01 ? v3scale(delta, 1 / dist) : { x: 1, y: 0, z: 0 }

    // Tension axis in body frame (for legacy compatibility)
    const { phi, theta, psi } = bodyState
    const cp = Math.cos(phi), sp = Math.sin(phi)
    const ct = Math.cos(theta), st = Math.sin(theta)
    const cy = Math.cos(psi), sy = Math.sin(psi)
    const tx = tensionAxis.x, ty = tensionAxis.y, tz = tensionAxis.z
    const tensionAxisBody: Vec3 = {
      x: (ct*cy)*tx + (ct*sy)*ty + (-st)*tz,
      y: (sp*st*cy - cp*sy)*tx + (sp*st*sy + cp*cy)*ty + (sp*ct)*tz,
      z: (cp*st*cy + sp*sy)*tx + (cp*st*sy - sp*cy)*ty + (cp*ct)*tz,
    }

    this.snapshot = {
      bodyState: { ...bodyState },
      pcPosition: { ...this.pcPos },
      pcVelocity: { ...this.pcVel },
      canopyBag: {
        position: { ...this.canopyBag!.position },
        velocity: { ...this.canopyBag!.velocity },
        pitch: this.canopyBag!.pitch,
        pitchRate: this.canopyBag!.pitchRate,
        roll: this.canopyBag!.roll,
        rollRate: this.canopyBag!.rollRate,
        yaw: this.canopyBag!.yaw,
        yawRate: this.canopyBag!.yawRate,
      },
      tensionAxis: tensionAxisBody,
      tensionAxisInertial: tensionAxis,
      chainDistance: v3dist(this.pcPos, anchorPos),
      time: 0,
    }
  }

  // ── Render State ────────────────────────────────────────────────────────

  /** Get render state with all positions converted to body-relative */
  getRenderState(bodyPos: Vec3): BridleRenderState {
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

  /** PC-to-anchor distance [m] */
  distanceToAnchor(anchorPos: Vec3): number {
    return v3dist(this.pcPos, anchorPos)
  }
}
