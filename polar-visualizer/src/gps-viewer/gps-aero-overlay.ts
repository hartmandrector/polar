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
import type { AxisMoments } from './moment-inset'

// ─── Configuration ──────────────────────────────────────────────────────────

/** Force arrow scale: Newtons → scene meters */
const FORCE_SCALE = 0.003
/** Velocity arrow scale: m/s → scene meters */
const VEL_SCALE = 0.08
/** Moment arc scale: N·m → arc radius */
const MOMENT_SCALE = 0.005
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

// ─── Types ──────────────────────────────────────────────────────────────────

interface SegmentArrows {
  lift: THREE.ArrowHelper
  drag: THREE.ArrowHelper
  side: THREE.ArrowHelper
  vel: THREE.ArrowHelper
}

interface MomentArc {
  line: THREE.Line
  color: number
}

export interface AeroOverlayConfig {
  segments: AeroSegment[]
  cgMeters: Vec3NED
  height: number       // reference height for denormalization
  mass: number
  rho?: number
}

// ─── Aero Overlay ───────────────────────────────────────────────────────────

export class GPSAeroOverlay {
  private group: THREE.Group
  private segArrows: SegmentArrows[] = []
  private momentArcs: MomentArc[] = []
  private netForceArrow: THREE.ArrowHelper
  private config: AeroOverlayConfig | null = null
  private controls: SegmentControls = defaultControls()

  /** Last computed moment breakdown (for external consumers like MomentInset) */
  lastMoments: AxisMoments = {
    pitch: { aero: 0, pilot: 0, gyro: 0, net: 0 },
    roll:  { aero: 0, pilot: 0, gyro: 0, net: 0 },
    yaw:   { aero: 0, pilot: 0, gyro: 0, net: 0 },
  }

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group()
    this.group.name = 'aero-overlay'
    scene.add(this.group)

    // Net force arrow (white, from CG)
    this.netForceArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0xffffff, 0.08, 0.04,
    )
    this.netForceArrow.visible = false
    this.group.add(this.netForceArrow)

    // Create moment arc geometry placeholders (3 axes)
    for (const color of [COL_MX, COL_MY, COL_MZ]) {
      const geo = new THREE.BufferGeometry()
      const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 })
      const line = new THREE.Line(geo, mat)
      line.visible = false
      this.group.add(line)
      this.momentArcs.push({ line, color })
    }
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
    const alpha = pt.aero.aoa       // radians
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

    // Evaluate segment model
    const result = evaluateAeroForcesDetailed(
      cfg.segments, cfg.cgMeters, cfg.height,
      bodyVel, omega, this.controls, rho,
    )

    // Body-to-world quaternion for rotating vectors into scene frame
    const bodyQuat = bodyToInertialQuat(pt.aero.roll, pt.aero.theta, pt.aero.psi)

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

    // Net force arrow from CG
    const cgWorld = nedToThreeJS(cfg.cgMeters).applyQuaternion(bodyQuat).add(modelPos)
    const netForceNED = result.system.force
    const netForceThree = nedToThreeJS(netForceNED).applyQuaternion(bodyQuat)
    const netLen = netForceThree.length() * FORCE_SCALE
    if (netLen > MIN_ARROW) {
      this.netForceArrow.setDirection(netForceThree.normalize())
      this.netForceArrow.setLength(netLen, 0.08, 0.04)
      this.netForceArrow.position.copy(cgWorld)
      this.netForceArrow.visible = true
    } else {
      this.netForceArrow.visible = false
    }

    // Moment arcs (roll, pitch, yaw) rendered as curved lines at CG
    const moments = [result.system.moment.x, result.system.moment.y, result.system.moment.z]
    const axes = [
      new THREE.Vector3(0, 0, 1),   // roll → body x → Three.js z
      new THREE.Vector3(-1, 0, 0),  // pitch → body y → Three.js -x
      new THREE.Vector3(0, -1, 0),  // yaw → body z → Three.js -y
    ]
    for (let i = 0; i < 3; i++) {
      const mag = moments[i]
      const arcRadius = Math.min(3, Math.abs(mag) * MOMENT_SCALE + 0.3)
      const arcAngle = Math.min(Math.PI, Math.abs(mag) * MOMENT_SCALE * 2)

      if (arcAngle < 0.05) {
        this.momentArcs[i].line.visible = false
        continue
      }

      // Build arc points in local plane perpendicular to the axis
      const axis = axes[i].clone().applyQuaternion(bodyQuat).normalize()
      const perp = new THREE.Vector3()
      if (Math.abs(axis.y) < 0.9) perp.crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize()
      else perp.crossVectors(axis, new THREE.Vector3(1, 0, 0)).normalize()

      const nPts = 16
      const pts: THREE.Vector3[] = []
      const sign = mag >= 0 ? 1 : -1
      for (let j = 0; j <= nPts; j++) {
        const a = (j / nPts) * arcAngle * sign
        const p = perp.clone()
          .multiplyScalar(Math.cos(a))
          .add(new THREE.Vector3().crossVectors(axis, perp).multiplyScalar(Math.sin(a)))
          .multiplyScalar(arcRadius)
          .add(cgWorld)
        pts.push(p)
      }

      this.momentArcs[i].line.geometry.dispose()
      this.momentArcs[i].line.geometry = new THREE.BufferGeometry().setFromPoints(pts)
      this.momentArcs[i].line.visible = true
    }

    // Populate moment breakdown for MomentInset
    // Gyroscopic coupling: ω × (I·ω) — cross product of body rates with angular momentum
    // Simplified: use Ixx≈Iyy≈Izz ≈ mass * height² / 12 as rough estimate
    const Iapprox = cfg.mass * cfg.height * cfg.height / 12
    const gyroX = omega.q * omega.r * 0  // negligible for wingsuit (Iyy ≈ Izz)
    const gyroY = omega.p * omega.r * Iapprox * 0.1  // small coupling
    const gyroZ = omega.p * omega.q * Iapprox * 0.1
    const mx = result.system.moment.x
    const my = result.system.moment.y
    const mz = result.system.moment.z
    this.lastMoments = {
      roll:  { aero: mx, pilot: 0, gyro: gyroX, net: mx + gyroX },
      pitch: { aero: my, pilot: 0, gyro: gyroY, net: my + gyroY },
      yaw:   { aero: mz, pilot: 0, gyro: gyroZ, net: mz + gyroZ },
    }
  }

  private hideAll() {
    this.netForceArrow.visible = false
    for (const sa of this.segArrows) {
      sa.lift.visible = sa.drag.visible = sa.side.visible = sa.vel.visible = false
    }
    for (const ma of this.momentArcs) {
      ma.line.visible = false
    }
  }

  /** Show/hide entire overlay */
  set visible(v: boolean) { this.group.visible = v }
  get visible() { return this.group.visible }
}

// Utility: THREE.Vector3 → {x,y,z} for nedToThreeJS
function vToObj(v: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z }
}
