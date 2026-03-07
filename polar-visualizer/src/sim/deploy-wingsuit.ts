/**
 * Wingsuit deployment sub-simulation.
 *
 * Tension-driven deployment chain: PC → 10 bridle segments → pin → canopy bag.
 * All positions in NED body frame relative to wingsuit CG.
 * Produces WingsuitDeployRenderState each tick for the renderer.
 *
 * See docs/sim/DEPLOY-WINGSUIT.md for architecture.
 */

import type { SimState } from '../polar/sim-state.ts'
import type {
  Vec3,
  WingsuitDeployPhase,
  WingsuitDeployRenderState,
  BridleSegmentState,
  CanopyBagState,
  LineStretchSnapshot,
} from './deploy-types.ts'

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
const PIN_SEGMENT = 1  // ~0.5m from container end (segments 0–1)

/** Mass per segment [kg] */
const SEGMENT_MASS = 0.01

/** PC mass [kg] */
const PC_MASS = 0.057

/** PC frontal area [m²] — full canopy */
const PC_AREA = 0.732  // π × 0.483²

/** PC CD at full inflation (high tension) */
const PC_CD_MAX = 0.9

/** PC CD when collapsed (low tension) */
const PC_CD_MIN = 0.3

/** Tension [N] at which PC is fully inflated */
const TENSION_FULL_INFLATION = 20

/** Tension threshold to unstow next segment [N] — higher = more pause between segments */
const UNSTOW_THRESHOLD = 15

/** Tension threshold to release closing pin [N] */
const PIN_RELEASE_THRESHOLD = 50

/** Canopy bag mass [kg] */
const CANOPY_BAG_MASS = 3.7

/** Canopy bag drag coefficient (bluff body) */
const CANOPY_BAG_CD = 1.0

/** Canopy bag frontal area [m²] — rough from snivel-slider bbox */
const CANOPY_BAG_AREA = 0.5

/** Throw velocity [m/s] — body-right lateral component at toss */
const THROW_VELOCITY = 5.0

/** Gravity [m/s²] */
const G = 9.81

/** PC release offset from CG in body frame [m] — out at right wingtip */
const PC_RELEASE_OFFSET: Vec3 = { x: 0, y: 0.9, z: 0 }  // body Y+ = right

// ─── Helpers ────────────────────────────────────────────────────────────────

function v3zero(): Vec3 { return { x: 0, y: 0, z: 0 } }

function v3dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function v3sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function v3add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function v3scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s }
}

function v3dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function v3len(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

/** Body-to-inertial DCM application (3-2-1 Euler) */
function bodyToInertial(v: Vec3, phi: number, theta: number, psi: number): Vec3 {
  const cp = Math.cos(phi),   sp = Math.sin(phi)
  const ct = Math.cos(theta), st = Math.sin(theta)
  const cy = Math.cos(psi),   sy = Math.sin(psi)
  return {
    x: (ct*cy)*v.x + (sp*st*cy - cp*sy)*v.y + (cp*st*cy + sp*sy)*v.z,
    y: (ct*sy)*v.x + (sp*st*sy + cp*cy)*v.y + (cp*st*sy - sp*cy)*v.z,
    z: (-st)*v.x   + (sp*ct)*v.y             + (cp*ct)*v.z,
  }
}

/** Inertial-to-body DCM application (transpose of bodyToInertial) */
function inertialToBody(v: Vec3, phi: number, theta: number, psi: number): Vec3 {
  const cp = Math.cos(phi),   sp = Math.sin(phi)
  const ct = Math.cos(theta), st = Math.sin(theta)
  const cy = Math.cos(psi),   sy = Math.sin(psi)
  return {
    x: (ct*cy)*v.x           + (ct*sy)*v.y           + (-st)*v.z,
    y: (sp*st*cy - cp*sy)*v.x + (sp*st*sy + cp*cy)*v.y + (sp*ct)*v.z,
    z: (cp*st*cy + sp*sy)*v.x + (cp*st*sy - sp*cy)*v.y + (cp*ct)*v.z,
  }
}

// ─── Deploy Sub-Sim ─────────────────────────────────────────────────────────

export class WingsuitDeploySim {
  phase: WingsuitDeployPhase = 'pc_toss'

  /** PC state — inertial NED */
  private pcPos: Vec3
  private pcVel: Vec3

  /** Bridle segments — inertial NED */
  segments: BridleSegmentState[]
  /** How many segments have been freed (from PC end inward) */
  private freedCount = 0

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

  constructor(bodyState: SimState) {
    const { x, y, z, u, v, w, phi, theta, psi } = bodyState

    // Body velocity → inertial
    const bodyVel: Vec3 = { x: u, y: v, z: w }
    const inertialVel = bodyToInertial(bodyVel, phi, theta, psi)

    // Throw direction: body-right (NED body Y+) → inertial
    const throwDir = bodyToInertial({ x: 0, y: 1, z: 0 }, phi, theta, psi)

    // PC release position: out at right wingtip, not at container
    const releaseOffset = bodyToInertial(PC_RELEASE_OFFSET, phi, theta, psi)
    this.pcPos = v3add({ x, y, z }, releaseOffset)
    this.pcVel = v3add(inertialVel, v3scale(throwDir, THROW_VELOCITY))

    // Initialize all segments at body position (stowed in container)
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
   * Step the deployment sub-sim.
   * @returns true if line stretch just occurred
   */
  step(dt: number, bodyState: SimState, rho: number): boolean {
    if (this.phase === 'line_stretch') return false

    const bodyPos: Vec3 = { x: bodyState.x, y: bodyState.y, z: bodyState.z }

    // ── PC drag (tension-dependent CD) ──────────────────────────────
    const tensionFactor = Math.min(1, Math.max(0, this.bridleTension / TENSION_FULL_INFLATION))
    const pcCD = PC_CD_MIN + (PC_CD_MAX - PC_CD_MIN) * tensionFactor

    const pcSpeed = v3len(this.pcVel)
    if (pcSpeed > 0.01) {
      const dragAccel = 0.5 * rho * pcCD * PC_AREA * pcSpeed * pcSpeed / PC_MASS
      const dragDv = Math.min(dragAccel * dt, pcSpeed * 0.5)  // cap for stability
      this.pcVel = v3sub(this.pcVel, v3scale(this.pcVel, dragDv / pcSpeed))
    }

    // Gravity
    this.pcVel.z += G * dt

    // Integrate PC position
    this.pcPos = v3add(this.pcPos, v3scale(this.pcVel, dt))

    // ── Canopy bag drag + gravity + rotation (if spawned) ──────────
    if (this.canopyBag) {
      const bag = this.canopyBag
      const bagSpeed = v3len(bag.velocity)
      if (bagSpeed > 0.01) {
        const bagDragAccel = 0.5 * rho * CANOPY_BAG_CD * CANOPY_BAG_AREA * bagSpeed * bagSpeed / CANOPY_BAG_MASS
        const bagDragDv = Math.min(bagDragAccel * dt, bagSpeed * 0.5)
        bag.velocity = v3sub(
          bag.velocity,
          v3scale(bag.velocity, bagDragDv / bagSpeed),
        )
      }
      bag.velocity.z += G * dt
      bag.position = v3add(bag.position, v3scale(bag.velocity, dt))

      // ── Rotation dynamics ──────────────────────────────────────
      // Aerodynamic damping torque (proportional to angular rate × airspeed)
      const AERO_DAMP = 0.5  // [N·m·s/rad] — tunable
      const dampScale = bagSpeed > 1 ? bagSpeed / 20 : 0.05  // scales with airspeed
      bag.pitchRate -= AERO_DAMP * dampScale * bag.pitchRate * dt
      bag.rollRate  -= AERO_DAMP * dampScale * bag.rollRate * dt
      bag.yawRate   -= AERO_DAMP * dampScale * bag.yawRate * dt * 0.1  // yaw barely damped

      // Random tumble torques from asymmetric drag (small, persistent)
      // This gives the bag realistic wobble as it trails
      bag.pitchRate += (Math.random() - 0.5) * 2.0 * dt
      bag.rollRate  += (Math.random() - 0.5) * 2.0 * dt
      bag.yawRate   += (Math.random() - 0.5) * 0.5 * dt

      // Integrate rotation
      bag.pitch += bag.pitchRate * dt
      bag.roll  += bag.rollRate * dt
      bag.yaw   += bag.yawRate * dt

      // Clamp pitch and roll to ±90° with bounce
      const CLAMP = Math.PI / 2
      if (bag.pitch > CLAMP) { bag.pitch = CLAMP; bag.pitchRate = -Math.abs(bag.pitchRate) * 0.3 }
      if (bag.pitch < -CLAMP) { bag.pitch = -CLAMP; bag.pitchRate = Math.abs(bag.pitchRate) * 0.3 }
      if (bag.roll > CLAMP) { bag.roll = CLAMP; bag.rollRate = -Math.abs(bag.rollRate) * 0.3 }
      if (bag.roll < -CLAMP) { bag.roll = -CLAMP; bag.rollRate = Math.abs(bag.rollRate) * 0.3 }
      // Yaw: free, no clamp — accumulates line twist
    }

    // ── Freed segment dynamics ──────────────────────────────────────
    for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
      const seg = this.segments[i]
      if (!seg.freed) continue

      // Gravity
      seg.velocity.z += G * dt
      // Drag on segment (small, but helps stability)
      const segSpeed = v3len(seg.velocity)
      if (segSpeed > 0.1) {
        const SEG_CDA = 0.01  // CD×A for bridle segment with fabric [m²]
        const segDragAccel = 0.5 * rho * SEG_CDA * segSpeed * segSpeed / SEGMENT_MASS
        const segDv = Math.min(segDragAccel * dt, segSpeed * 0.5)  // cap at 50% of speed for stability
        seg.velocity = v3sub(seg.velocity, v3scale(seg.velocity, segDv / segSpeed))
      }
      // Integrate
      seg.position = v3add(seg.position, v3scale(seg.velocity, dt))
    }

    // ── Tension propagation (from PC inward) ────────────────────────
    // Constrain PC to outermost freed segment (or body if none freed)
    let prevTension = 0
    {
      const anchor = this.freedCount > 0
        ? this.segments[SEGMENT_COUNT - 1].position  // outermost freed segment
        : bodyPos
      const maxDist = this.freedCount > 0 ? SEGMENT_LENGTH : BRIDLE_LENGTH
      prevTension = this.applyConstraint(this.pcPos, this.pcVel, anchor, maxDist, PC_MASS, dt)
    }
    this.bridleTension = prevTension

    // Constrain each freed segment to its outboard neighbor
    for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
      const seg = this.segments[i]
      if (!seg.freed) continue

      // Anchor: next outboard freed segment, or PC if this is outermost
      const outboard = (i === SEGMENT_COUNT - 1) ? this.pcPos
        : this.segments[i + 1].freed ? this.segments[i + 1].position
        : this.pcPos

      // Inboard anchor: next inboard freed segment, or body
      const inboard = (i > 0 && this.segments[i - 1].freed)
        ? this.segments[i - 1].position
        : bodyPos

      // Constrain to outboard
      const t = this.applyConstraint(seg.position, seg.velocity, outboard, SEGMENT_LENGTH, SEGMENT_MASS, dt)
      // Constrain to inboard (bidirectional — can't stretch either way)
      this.applyConstraint(seg.position, seg.velocity, inboard, SEGMENT_LENGTH, SEGMENT_MASS, dt)

      prevTension = t
    }

    // Constrain canopy bag to body via suspension lines
    if (this.canopyBag) {
      const bagAnchor = bodyPos
      this.bagTension = this.applyConstraint(
        this.canopyBag.position, this.canopyBag.velocity,
        bagAnchor, SUSPENSION_LINE_LENGTH, CANOPY_BAG_MASS, dt,
      )
    }

    // ── Unstow next segment ─────────────────────────────────────────
    // Pin tension = tension at the innermost freed segment (pulling against container/pin)
    // This is the last prevTension value from the constraint loop above
    const innermostFreedTension = prevTension
    this.pinTension = innermostFreedTension

    if (this.freedCount < SEGMENT_COUNT && !this.pinReleased) {
      // Next segment to free: counting from PC end inward
      const nextIdx = SEGMENT_COUNT - 1 - this.freedCount
      if (nextIdx >= 0 && prevTension > UNSTOW_THRESHOLD) {
        // Check if this segment is inboard of the pin
        if (nextIdx <= PIN_SEGMENT) {
          // Need pin release first — use innermost freed segment tension
          if (innermostFreedTension > PIN_RELEASE_THRESHOLD) {
            this.releasePin(bodyState)
          }
        } else {
          this.freeSegment(nextIdx, bodyState)
        }
      }
    } else if (this.pinReleased && this.freedCount < SEGMENT_COUNT) {
      // After pin release, free all remaining stowed segments
      for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
        if (!this.segments[i].freed) {
          this.freeSegment(i, bodyState)
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
    // Line stretch = suspension lines fully taut (bag at max distance from body)
    if (this.canopyBag) {
      const bagDist = v3dist(this.canopyBag.position, bodyPos)
      if (bagDist >= SUSPENSION_LINE_LENGTH * 0.98) {
        this.phase = 'line_stretch'
        this.freezeSnapshot(bodyState)
        console.log(`[WSDeploy] LINE STRETCH — bag dist=${bagDist.toFixed(2)}m (line=${SUSPENSION_LINE_LENGTH.toFixed(2)}m)`)
        return true
      }
    }

    return false
  }

  /** Apply distance constraint. Returns tension estimate [N]. */
  private applyConstraint(
    pos: Vec3, vel: Vec3,
    anchor: Vec3, maxDist: number,
    mass: number, dt: number,
  ): number {
    const delta = v3sub(pos, anchor)
    const dist = v3len(delta)
    if (dist <= maxDist || dist < 0.001) return 0

    // Position correction
    const correction = (dist - maxDist) / dist
    pos.x -= delta.x * correction
    pos.y -= delta.y * correction
    pos.z -= delta.z * correction

    // Remove outward radial velocity (inelastic)
    const nx = delta.x / dist, ny = delta.y / dist, nz = delta.z / dist
    const vRad = vel.x * nx + vel.y * ny + vel.z * nz
    if (vRad > 0) {
      vel.x -= vRad * nx
      vel.y -= vRad * ny
      vel.z -= vRad * nz
    }

    // Tension estimate: constraint force ≈ mass × velocity_correction / dt
    return mass * Math.abs(vRad) / Math.max(dt, 1e-6)
  }

  /** Free a segment (unstow) */
  private freeSegment(idx: number, bodyState: SimState): void {
    const seg = this.segments[idx]
    if (seg.freed) return
    seg.freed = true
    seg.visible = true
    this.freedCount++

    // Initialize at current body position with body velocity
    seg.position = { x: bodyState.x, y: bodyState.y, z: bodyState.z }
    const bodyVel: Vec3 = { x: bodyState.u, y: bodyState.v, z: bodyState.w }
    seg.velocity = bodyToInertial(bodyVel, bodyState.phi, bodyState.theta, bodyState.psi)

    if (this.freedCount % 3 === 0 || idx === 0) {
      console.log(`[WSDeploy] Segment ${idx} freed (${this.freedCount}/${SEGMENT_COUNT})`)
    }
  }

  /** Release closing pin — free all remaining segments + spawn canopy bag */
  private releasePin(bodyState: SimState): void {
    this.pinReleased = true
    this.phase = 'pin_release'
    console.log(`[WSDeploy] PIN RELEASE at tension=${this.pinTension.toFixed(1)}N`)

    // Spawn canopy bag at body position with body velocity
    const bodyVel: Vec3 = { x: bodyState.u, y: bodyState.v, z: bodyState.w }
    const inertialVel = bodyToInertial(bodyVel, bodyState.phi, bodyState.theta, bodyState.psi)
    this.canopyBag = {
      position: { x: bodyState.x, y: bodyState.y, z: bodyState.z },
      velocity: { ...inertialVel },
      pitch: 0,
      pitchRate: (Math.random() - 0.5) * 1.0,  // small random initial tumble
      roll: 0,
      rollRate: (Math.random() - 0.5) * 1.0,
      yaw: 0,
      yawRate: (Math.random() - 0.5) * 0.5,  // small random yaw — line twist seed
    }
  }

  /** Freeze snapshot at line stretch */
  private freezeSnapshot(bodyState: SimState): void {
    const bodyPos: Vec3 = { x: bodyState.x, y: bodyState.y, z: bodyState.z }
    const delta = v3sub(this.canopyBag!.position, bodyPos)
    const dist = v3len(delta)
    const tensionAxis = dist > 0.01 ? v3scale(delta, 1 / dist) : { x: 1, y: 0, z: 0 }

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
      tensionAxis: inertialToBody(tensionAxis, bodyState.phi, bodyState.theta, bodyState.psi),
      chainDistance: v3dist(this.pcPos, bodyPos),
      time: 0,  // set by SimRunner
    }
  }

  /** PC-to-body distance [m] */
  distanceToBody(bodyPos: Vec3): number {
    return v3dist(this.pcPos, bodyPos)
  }

  /** Get render state (all positions converted to body-relative) */
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
