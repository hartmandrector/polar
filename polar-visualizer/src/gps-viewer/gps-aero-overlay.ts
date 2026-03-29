/**
 * GPS Aero Overlay — Force vectors + moment arcs from segment model
 *
 * Evaluates the segment aero model at GPS-derived flight conditions,
 * renders per-segment lift/drag/sideforce arrows, velocity arrows,
 * and moment arcs (curved arrows for p-dot, q-dot, r-dot).
 *
 * Pass 1: neutral controls → shows what aero predicts at measured state.
 * Pass 2 (future): back-solve controls from measured vs predicted acceleration.
 */

import * as THREE from 'three'
import {
  evaluateAeroForcesDetailed,
  defaultControls,
  type SegmentAeroResult,
  type SystemForces,
  type Vec3NED,
} from '../polar/aero-segment'
import type { AeroSegment, SegmentControls } from '../polar/continuous-polar'
import type { GPSPipelinePoint } from '../gps/types'
import { bodyToInertialQuat, nedToThreeJS } from '../viewer/frames'
import { CurvedArrow } from '../viewer/curved-arrow'
import type { AxisMoments } from './moment-inset'
import { solveControlInputs, type ControlInversionConfig, type ControlInversionResult } from './control-solver'
import type { InertiaComponents } from '../polar/inertia'

// ─── Configuration ──────────────────────────────────────────────────────────

/** Force arrow scale: Newtons → scene meters */
const FORCE_SCALE = 0.003
/** Velocity arrow scale: m/s → scene meters */
const VEL_SCALE = 0.08
/** Moment arc scale: N·m → radians of arc sweep (matches main viewer) */
const TORQUE_SCALE = 0.002
/** Body rate arc scale: rad/s → arc sweep radians (matches main viewer) */
const RATE_SCALE = 0.6
/** Minimum arrow length to render (avoids clutter) */
const MIN_ARROW = 0.02

// Arrow colors
const COL_LIFT  = 0x00ff88
const COL_DRAG  = 0xff4444
const COL_SIDE  = 0xffff44
const COL_VEL   = 0x44aaff
const COL_MX    = 0xff6644  // roll moment
const COL_MY    = 0x44ff66  // pitch moment
const COL_MZ    = 0x6644ff  // yaw moment
// Rate arc colors — paler versions of moment colors (matches main viewer)
const COL_RATE_P = 0xffbb88  // pitch rate (pale orange)
const COL_RATE_Y = 0x88ffbb  // yaw rate (pale green)
const COL_RATE_R = 0xbb88ff  // roll rate (pale purple)

// ─── Types ──────────────────────────────────────────────────────────────────

interface SegmentArrows {
  lift: THREE.ArrowHelper
  drag: THREE.ArrowHelper
  side: THREE.ArrowHelper
  vel: THREE.ArrowHelper
}

export interface AeroOverlayConfig {
  segments: AeroSegment[]
  cgMeters: Vec3NED
  height: number       // reference height for denormalization
  mass: number
  rho?: number
  inertia?: InertiaComponents
}

// ─── Aero Overlay ───────────────────────────────────────────────────────────

export class GPSAeroOverlay {
  private group: THREE.Group
  private segArrows: SegmentArrows[] = []
  private momentGroup: THREE.Group  // sub-group for body-frame rotation
  private rollArc: CurvedArrow
  private pitchArc: CurvedArrow
  private yawArc: CurvedArrow
  // Body rate arcs (angular velocity — what the wingsuit is actually doing)
  private pitchRateArc: CurvedArrow
  private yawRateArc: CurvedArrow
  private rollRateArc: CurvedArrow
  private netForceArrow: THREE.ArrowHelper
  private accelBall: THREE.Mesh
  private config: AeroOverlayConfig | null = null
  private controls: SegmentControls = defaultControls()

  /** Last computed moment breakdown (for external consumers like MomentInset) */
  lastMoments: AxisMoments = {
    pitch: { aero: 0, pilot: 0, gyro: 0, net: 0 },
    roll:  { aero: 0, pilot: 0, gyro: 0, net: 0 },
    yaw:   { aero: 0, pilot: 0, gyro: 0, net: 0 },
  }

  /** Last solved control inputs (Pass 2) */
  lastControls: { pitch: number; roll: number; yaw: number } = { pitch: 0, roll: 0, yaw: 0 }
  lastConverged = false

  /** Enable Pass 2 control inversion (requires inertia in config) */
  enableControlSolver = true

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group()
    this.group.name = 'aero-overlay'
    scene.add(this.group)

    // Net force arrow (white, from CG) — hidden, replaced by accel ball
    this.netForceArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0xffffff, 0.08, 0.04,
    )
    this.netForceArrow.visible = false
    this.group.add(this.netForceArrow)

    // Acceleration ball — white sphere scaled by total 3D acceleration magnitude
    const accelGeo = new THREE.SphereGeometry(1, 16, 12)
    const accelMat = new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
    this.accelBall = new THREE.Mesh(accelGeo, accelMat)
    this.accelBall.visible = false
    this.group.add(this.accelBall)

    // Moment arcs — CurvedArrow with TubeGeometry + arrowheads
    // Axes match main viewer convention: pitch='x', yaw='y', roll='z' (Three.js body frame)
    this.momentGroup = new THREE.Group()
    this.momentGroup.name = 'moment-arcs'
    this.group.add(this.momentGroup)

    this.pitchArc = new CurvedArrow('x', COL_MY, 'gps-pitch-moment', { radius: 1.2 })
    this.yawArc   = new CurvedArrow('y', COL_MZ, 'gps-yaw-moment',   { radius: 1.2 })
    this.rollArc  = new CurvedArrow('z', COL_MX, 'gps-roll-moment',  { radius: 1.2 })

    // Rate arcs — pale colours, slightly larger radius so they don't overlap moment arcs
    this.pitchRateArc = new CurvedArrow('x', COL_RATE_P, 'gps-pitch-rate', { radius: 1.4 })
    this.yawRateArc   = new CurvedArrow('y', COL_RATE_Y, 'gps-yaw-rate',   { radius: 1.4 })
    this.rollRateArc  = new CurvedArrow('z', COL_RATE_R, 'gps-roll-rate',  { radius: 1.4 })

    this.momentGroup.add(
      this.pitchArc, this.yawArc, this.rollArc,
      this.pitchRateArc, this.yawRateArc, this.rollRateArc,
    )
  }

  /** Set the aero model configuration (segments, CG, etc.) */
  setConfig(config: AeroOverlayConfig) {
    this.config = config
    this.rebuildSegmentArrows()
  }

  /** Set control inputs (for future Pass 2 — default is neutral) */
  setControls(controls: SegmentControls) {
    this.controls = controls
  }

  private rebuildSegmentArrows() {
    // Remove old arrows
    for (const sa of this.segArrows) {
      this.group.remove(sa.lift, sa.drag, sa.side, sa.vel)
      sa.lift.dispose(); sa.drag.dispose(); sa.side.dispose(); sa.vel.dispose()
    }
    this.segArrows = []

    if (!this.config) return

    for (let i = 0; i < this.config.segments.length; i++) {
      const lift = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, COL_LIFT, 0.06, 0.03)
      const drag = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, COL_DRAG, 0.06, 0.03)
      const side = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, COL_SIDE, 0.06, 0.03)
      const vel  = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, COL_VEL,  0.04, 0.02)
      lift.visible = drag.visible = side.visible = vel.visible = false
      this.group.add(lift, drag, side, vel)
      this.segArrows.push({ lift, drag, side, vel })
    }
  }

  /** Optional aero angle overrides (e.g. canopy estimator provides its own AOA/orientation) */
  aeroOverrides?: { aoa: number; roll: number; theta: number; psi: number }

  /**
   * Update the overlay for a GPS data point.
   * Evaluates segment model at the measured flight condition.
   */
  update(pt: GPSPipelinePoint, modelPos: THREE.Vector3) {
    if (!this.config) {
      this.hideAll()
      return
    }

    const cfg = this.config
    const rho = cfg.rho ?? 1.225

    // Build body velocity from GPS airspeed + orientation
    // u = V·cos(α)·cos(β), v = V·sin(β), w = V·sin(α)·cos(β)
    const V = pt.processed.airspeed
    const ov = this.aeroOverrides
    const alpha = ov?.aoa ?? pt.aero.aoa       // radians
    const beta = 0                   // TODO: sideslip from pipeline when available
    const cosA = Math.cos(alpha), sinA = Math.sin(alpha)
    const cosB = Math.cos(beta),  sinB = Math.sin(beta)
    const bodyVel: Vec3NED = {
      x: V * cosA * cosB,
      y: V * sinB,
      z: V * sinA * cosB,
    }

    // Body rates from pipeline
    const D2R = Math.PI / 180
    const omega = {
      p: (pt.bodyRates?.p ?? 0) * D2R,
      q: (pt.bodyRates?.q ?? 0) * D2R,
      r: (pt.bodyRates?.r ?? 0) * D2R,
    }

    // Evaluate segment model with neutral controls (arrows show baseline aero)
    this.controls = defaultControls()
    const result = evaluateAeroForcesDetailed(
      cfg.segments, cfg.cgMeters, cfg.height,
      bodyVel, omega, this.controls, rho,
    )

    // ── Control solver (for readout/moments only, does not affect arrows) ──
    // The solver calls evaluateAeroForcesDetailed many times with the SAME
    // segment objects.  getCoeffs() mutates seg.position.y and seg.orientation
    // based on control inputs.  With CONTROL_CLAMP up to 2000, yaw shifts can
    // push position.y tens of meters off, and those mutations persist on the
    // segment objects.  evaluateAeroForcesDetailed reads seg.position BEFORE
    // calling getCoeffs, so the NEXT frame's neutral eval would pick up the
    // solver's stale mutations → arrows fly away.
    // Fix: snapshot segment state before the solver and restore it after.
    let solverActive = false
    if (this.enableControlSolver && cfg.inertia && pt.bodyRates?.pDot !== undefined) {
      // Save mutable segment state
      const savedState = cfg.segments.map(s => ({
        posY: s.position.y,
        orientation: s.orientation ? { ...s.orientation } : undefined,
      }))

      const solverCfg: ControlInversionConfig = {
        segments: cfg.segments,
        cgMeters: cfg.cgMeters,
        height: cfg.height,
        mass: cfg.mass,
        inertia: cfg.inertia,
        rho,
      }
      const sol = solveControlInputs(pt, solverCfg)
      this.lastMoments = sol.moments
      this.lastControls = { pitch: sol.pitchThrottle, roll: sol.rollThrottle, yaw: sol.yawThrottle }
      this.lastConverged = sol.converged
      solverActive = true

      // Restore segment state so next frame's neutral eval reads clean positions
      cfg.segments.forEach((s, i) => {
        s.position.y = savedState[i].posY
        if (savedState[i].orientation) s.orientation = savedState[i].orientation
      })
    }

    // Body-to-world quaternion for rotating vectors into scene frame
    const bodyQuat = bodyToInertialQuat(
      ov?.roll ?? pt.aero.roll,
      ov?.theta ?? pt.aero.theta,
      ov?.psi ?? pt.aero.psi,
    )

    // Wind frame directions in body NED
    // Body airflow: V_hat = (cos(α), 0, sin(α)) in xz plane
    // Drag opposes airflow: (-cos(α), 0, -sin(α))
    // Lift perpendicular to airflow toward "up" (-z): (sin(α), 0, -cos(α))
    const liftDirNED = new THREE.Vector3(sinA, 0, -cosA)
    const dragDirNED = new THREE.Vector3(-cosA, 0, -sinA)
    const sideDirNED = new THREE.Vector3(0, 1, 0)

    // Convert to scene frame
    const liftDirWorld = nedToThreeJS(vToObj(liftDirNED)).applyQuaternion(bodyQuat).normalize()
    const dragDirWorld = nedToThreeJS(vToObj(dragDirNED)).applyQuaternion(bodyQuat).normalize()
    const sideDirWorld = nedToThreeJS(vToObj(sideDirNED)).applyQuaternion(bodyQuat).normalize()

    // Per-segment arrows
    for (let i = 0; i < cfg.segments.length && i < this.segArrows.length; i++) {
      const seg = cfg.segments[i]
      const sa = this.segArrows[i]
      const ps = result.perSegment[i]

      // Segment position in world space (body NED → Three.js → world)
      const segPosNED = {
        x: ps.positionMeters.x,
        y: ps.positionMeters.y,
        z: ps.positionMeters.z,
      }
      const segPosWorld = nedToThreeJS(segPosNED).applyQuaternion(bodyQuat).add(modelPos)

      // Lift
      const liftLen = Math.abs(ps.forces.lift) * FORCE_SCALE
      if (liftLen > MIN_ARROW) {
        const dir = ps.forces.lift >= 0 ? liftDirWorld.clone() : liftDirWorld.clone().negate()
        sa.lift.setDirection(dir)
        sa.lift.setLength(liftLen, 0.06, 0.03)
        sa.lift.position.copy(segPosWorld)
        sa.lift.visible = true
      } else {
        sa.lift.visible = false
      }

      // Drag
      const dragLen = ps.forces.drag * FORCE_SCALE
      if (dragLen > MIN_ARROW) {
        sa.drag.setDirection(dragDirWorld)
        sa.drag.setLength(dragLen, 0.06, 0.03)
        sa.drag.position.copy(segPosWorld)
        sa.drag.visible = true
      } else {
        sa.drag.visible = false
      }

      // Side force
      const sideLen = Math.abs(ps.forces.side) * FORCE_SCALE
      if (sideLen > MIN_ARROW) {
        const dir = ps.forces.side >= 0 ? sideDirWorld.clone() : sideDirWorld.clone().negate()
        sa.side.setDirection(dir)
        sa.side.setLength(sideLen, 0.06, 0.03)
        sa.side.position.copy(segPosWorld)
        sa.side.visible = true
      } else {
        sa.side.visible = false
      }

      // Velocity arrow at segment
      const velNED = ps.localVelocity
      const velThree = nedToThreeJS(velNED).applyQuaternion(bodyQuat)
      const velLen = velThree.length() * VEL_SCALE
      if (velLen > MIN_ARROW) {
        sa.vel.setDirection(velThree.normalize())
        sa.vel.setLength(velLen, 0.04, 0.02)
        sa.vel.position.copy(segPosWorld)
        sa.vel.visible = true
      } else {
        sa.vel.visible = false
      }
    }

    // CG position in world space
    const cgWorld = nedToThreeJS(cfg.cgMeters).applyQuaternion(bodyQuat).add(modelPos)

    // Net force arrow — hidden (replaced by accel ball)
    this.netForceArrow.visible = false

    // Acceleration ball — fixed radius, position offset from CG by acceleration vector
    const ACCEL_BALL_RADIUS = 0.1    // fixed scene-meters radius
    const ACCEL_POS_SCALE  = 0.08   // m/s² → scene meters offset
    const accelNED: Vec3NED = {
      x: pt.processed.accelN,
      y: pt.processed.accelE,
      z: pt.processed.accelD,
    }
    const accelThree = nedToThreeJS(accelNED)
    const offsetLen = accelThree.length() * ACCEL_POS_SCALE
    if (offsetLen > 0.005) {
      this.accelBall.scale.setScalar(ACCEL_BALL_RADIUS)
      this.accelBall.position.copy(cgWorld).add(accelThree.normalize().multiplyScalar(offsetLen))
      this.accelBall.visible = true
    } else {
      this.accelBall.visible = false
    }

    // Moment arcs (roll, pitch, yaw) — CurvedArrow at CG, rotated into body frame
    // Sign conventions match main viewer (vectors.ts): pitch/yaw negated, roll positive
    const sysMoment = result.system.moment
    const pitchArcVal = -sysMoment.y * TORQUE_SCALE
    const yawArcVal   = -sysMoment.z * TORQUE_SCALE
    const rollArcVal  =  sysMoment.x * TORQUE_SCALE

    this.pitchArc.setAngle(pitchArcVal)
    this.pitchArc.visible = Math.abs(pitchArcVal) > 0.005

    this.yawArc.setAngle(yawArcVal)
    this.yawArc.visible = Math.abs(yawArcVal) > 0.005

    this.rollArc.setAngle(rollArcVal)
    this.rollArc.visible = Math.abs(rollArcVal) > 0.005

    // Body rate arcs (angular velocity — what the wingsuit is actually doing)
    // Sign conventions match main viewer (vectors.ts): pitch/yaw negated, roll positive
    const pArc =  omega.p * RATE_SCALE
    const qArc = -omega.q * RATE_SCALE
    const rArc = -omega.r * RATE_SCALE

    this.pitchRateArc.setAngle(qArc)
    this.pitchRateArc.visible = Math.abs(qArc) > 0.01

    this.yawRateArc.setAngle(rArc)
    this.yawRateArc.visible = Math.abs(rArc) > 0.01

    this.rollRateArc.setAngle(pArc)
    this.rollRateArc.visible = Math.abs(pArc) > 0.01

    // Position moment group at CG and rotate to body orientation
    this.momentGroup.position.copy(cgWorld)
    this.momentGroup.quaternion.copy(bodyQuat)

    // Populate moment breakdown for non-solver path
    if (!solverActive) {
      const mx = result.system.moment.x
      const my = result.system.moment.y
      const mz = result.system.moment.z
      this.lastMoments = {
        roll:  { aero: mx, pilot: 0, gyro: 0, net: mx },
        pitch: { aero: my, pilot: 0, gyro: 0, net: my },
        yaw:   { aero: mz, pilot: 0, gyro: 0, net: mz },
      }
      this.lastControls = { pitch: 0, roll: 0, yaw: 0 }
      this.lastConverged = true
    }
  }

  hide() {
    this.hideAll()
  }

  private hideAll() {
    this.netForceArrow.visible = false
    this.accelBall.visible = false
    for (const sa of this.segArrows) {
      sa.lift.visible = sa.drag.visible = sa.side.visible = sa.vel.visible = false
    }
    this.pitchArc.visible = false
    this.yawArc.visible = false
    this.rollArc.visible = false
    this.pitchRateArc.visible = false
    this.yawRateArc.visible = false
    this.rollRateArc.visible = false
  }

  /** Show/hide entire overlay */
  set visible(v: boolean) { this.group.visible = v }
  get visible() { return this.group.visible }
}

// Utility: THREE.Vector3 → {x,y,z} for nedToThreeJS
function vToObj(v: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z }
}
