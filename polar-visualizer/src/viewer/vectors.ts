/**
 * Force vector arrows — lift, drag, side, weight, net, and wind.
 * 
 * Uses ShadedArrow (MeshPhongMaterial) instead of THREE.ArrowHelper
 * for proper lighting / shadow response.
 * 
 * Force origin placement:
 * - Aerodynamic forces (lift, drag, totalAero) originate from the center of pressure (CP)
 * - Side force originates from the lateral CP (cp_lateral)
 * - Weight originates from the center of gravity (CG)
 * - Net force originates from the CG
 * - Wind arrow originates from the model origin (0,0,0)
 * 
 * Torque visualization:
 * - Pitch moment arc (CurvedArrow around X-axis) centered at the CG
 * - Arc sweep angle proportional to pitching moment M = q·S·c·CM
 * 
 * CP and CG are expressed as fractions of chord (0 = leading edge / nose,
 * 1 = trailing edge / tail). In the 3D view, nose is at -Z, tail at +Z,
 * so fraction 0.5 maps to Z=0 (model center).
 */

import * as THREE from 'three'
import type { FullCoefficients, ContinuousPolar, AeroSegment, SegmentControls } from '../polar/continuous-polar.ts'
import { coeffToForces } from '../polar/coefficients.ts'
import { computeSegmentForce, sumAllSegments, defaultControls } from '../polar/aero-segment.ts'
import type { SegmentForceResult } from '../polar/aero-segment.ts'
import { computeCenterOfMass } from '../polar/inertia.ts'
import { ShadedArrow } from './shaded-arrow.ts'
import { CurvedArrow } from './curved-arrow.ts'
import { windDirectionBody, nedToThreeJS } from './frames.ts'

const DEG2RAD = Math.PI / 180

// ── Wind frame ───────────────────────────────────────────────────────────────

/** Wind, lift, drag, side directions in body-frame Three.js space. */
export interface WindFrame {
  windDir: THREE.Vector3   // where air comes FROM
  dragDir: THREE.Vector3   // opposes velocity (= -windDir)
  liftDir: THREE.Vector3   // perpendicular to wind, in vertical plane
  sideDir: THREE.Vector3   // perpendicular to wind and lift
}

/**
 * Compute aerodynamic direction vectors from angle of attack and sideslip.
 * Reusable for both single-origin and per-segment rendering.
 */
export function computeWindFrame(alpha_deg: number, beta_deg: number): WindFrame {
  const windDir = windDirectionBody(alpha_deg, beta_deg)
  const dragDir = windDir.clone().negate()

  const up = new THREE.Vector3(0, 1, 0)
  const liftDir = new THREE.Vector3()
  liftDir.crossVectors(windDir, up)
  liftDir.crossVectors(liftDir, windDir)
  if (liftDir.lengthSq() > 1e-10) {
    liftDir.normalize()
  } else {
    liftDir.set(0, 0, -1)
  }

  const sideDir = new THREE.Vector3()
  sideDir.crossVectors(windDir, liftDir).normalize()

  return { windDir, dragDir, liftDir, sideDir }
}

// ── Per-segment arrows ───────────────────────────────────────────────────────

/** Per-segment arrows — lightweight ArrowHelper lines for detail rendering. */
export interface SegmentArrows {
  name: string
  lift: THREE.ArrowHelper
  drag: THREE.ArrowHelper
  side: THREE.ArrowHelper
  group: THREE.Group
}

// ── Segment arrow colors ─────────────────────────────────────────────────────

/**
 * Per-segment arrow colors by segment name.
 * Center cell = full saturation, inner/outer cells = lighter tints.
 * Parasitic bodies = warm/muted tones.
 */
interface SegmentColors { lift: number; drag: number; side: number }

const SEGMENT_COLORS: Record<string, SegmentColors> = {
  // Canopy cells — green/red/blue with tints for outer cells
  cell_c:  { lift: 0x00ff00, drag: 0xff0000, side: 0x4488ff },  // center: full
  cell_r1: { lift: 0x66ff66, drag: 0xff4444, side: 0x6699ff },  // inner: lighter
  cell_l1: { lift: 0x66ff66, drag: 0xff4444, side: 0x6699ff },
  cell_r2: { lift: 0x66ff66, drag: 0xff4444, side: 0x6699ff },  // mid: lighter
  cell_l2: { lift: 0x66ff66, drag: 0xff4444, side: 0x6699ff },
  cell_r3: { lift: 0x66ff66, drag: 0xff4444, side: 0x6699ff },  // outer: lighter
  cell_l3: { lift: 0x66ff66, drag: 0xff4444, side: 0x6699ff },
  // Parasitic bodies
  lines:   { lift: 0x666666, drag: 0xff8800, side: 0x666666 },  // orange drag
  pilot:   { lift: 0x448844, drag: 0xffaa44, side: 0x666666 },  // yellow-orange drag
  bridle:  { lift: 0x666666, drag: 0xff88cc, side: 0x666666 },  // pink drag
}

const DEFAULT_COLORS: SegmentColors = { lift: 0x44cc44, drag: 0xcc4444, side: 0x4488cc }

const SEGMENT_ARROW_LENGTH = 0.001  // minimum length for ArrowHelper init

/**
 * Create or update the per-segment ArrowHelper groups to match the
 * current polar's aeroSegments. Reuses existing groups when names match;
 * removes stale ones and adds new ones.
 */
function ensureSegmentArrows(
  vectors: ForceVectors,
  segments: AeroSegment[],
): void {
  const existing = new Map(vectors.segmentArrows.map(sa => [sa.name, sa]))
  const needed = new Set(segments.map(s => s.name))

  // Remove stale
  for (const [name, sa] of existing) {
    if (!needed.has(name)) {
      vectors.group.remove(sa.group)
      sa.lift.dispose()
      sa.drag.dispose()
      sa.side.dispose()
      existing.delete(name)
    }
  }

  // Create new or keep existing
  const result: SegmentArrows[] = []
  for (const seg of segments) {
    let sa = existing.get(seg.name)
    if (!sa) {
      const colors = SEGMENT_COLORS[seg.name] ?? DEFAULT_COLORS
      const origin = new THREE.Vector3()
      const dir = new THREE.Vector3(0, 1, 0)
      const lift = new THREE.ArrowHelper(dir, origin, SEGMENT_ARROW_LENGTH, colors.lift, 0.06, 0.03)
      const drag = new THREE.ArrowHelper(dir, origin, SEGMENT_ARROW_LENGTH, colors.drag, 0.06, 0.03)
      const side = new THREE.ArrowHelper(dir, origin, SEGMENT_ARROW_LENGTH, colors.side, 0.06, 0.03)
      const group = new THREE.Group()
      group.name = `seg-${seg.name}`
      group.add(lift, drag, side)
      vectors.group.add(group)
      sa = { name: seg.name, lift, drag, side, group }
    }
    result.push(sa)
  }

  vectors.segmentArrows = result
}

// ── Force vectors container ──────────────────────────────────────────────────

export interface ForceVectors {
  windArrow: ShadedArrow
  liftArrow: ShadedArrow
  dragArrow: ShadedArrow
  sideArrow: ShadedArrow
  totalAeroArrow: ShadedArrow
  weightArrow: ShadedArrow
  netArrow: ShadedArrow
  pitchArc: CurvedArrow
  yawArc: CurvedArrow
  rollArc: CurvedArrow
  /** Per-segment ArrowHelper groups (empty when polar has no aeroSegments). */
  segmentArrows: SegmentArrows[]
  group: THREE.Group
}

const FORCE_SCALE = 0.003   // N → visual units
const TORQUE_SCALE = 0.002  // N·m → radians of arc sweep

export function createForceVectors(): ForceVectors {
  const group = new THREE.Group()
  group.name = 'force-vectors'

  const windArrow = new ShadedArrow(0x2244aa, 'wind')
  const liftArrow = new ShadedArrow(0x00ff00, 'lift')
  const dragArrow = new ShadedArrow(0xff0000, 'drag')
  const sideArrow = new ShadedArrow(0x4488ff, 'side')
  const totalAeroArrow = new ShadedArrow(0xffff00, 'total-aero')
  const weightArrow = new ShadedArrow(0xaaaaaa, 'weight')
  const netArrow = new ShadedArrow(0xff00ff, 'net')

  // Curved arrows for pitch (X-axis), yaw (Y-axis), roll (Z-axis)
  const pitchArc = new CurvedArrow('x', 0xff8844, 'pitch-moment', { radius: 1.2 })
  const yawArc = new CurvedArrow('y', 0x44ff88, 'yaw-moment', { radius: 1.2 })
  const rollArc = new CurvedArrow('z', 0x8844ff, 'roll-moment', { radius: 1.2 })
  // Yaw and roll hidden until we have those moment coefficients
  yawArc.visible = false
  rollArc.visible = false

  group.add(
    windArrow, liftArrow, dragArrow, sideArrow,
    totalAeroArrow, weightArrow, netArrow,
    pitchArc, yawArc, rollArc
  )

  return {
    windArrow, liftArrow, dragArrow, sideArrow,
    totalAeroArrow, weightArrow, netArrow,
    pitchArc, yawArc, rollArc,
    segmentArrows: [],
    group
  }
}

// ── Coordinate mapping ───────────────────────────────────────────────────────

/**
 * Convert a chord fraction (0=nose/LE, 1=tail/TE) to a body-frame position.
 * 
 * In our Three.js body frame:
 * - Leading edge (head/nose, fraction 0) faces the wind at +Z
 * - Trailing edge (tail/feet, fraction 1) is at -Z
 * - Model is auto-centered so 0.5 → Z=0
 * 
 * @param fraction  0–1 fraction of chord from leading edge
 * @param bodyLength  Model's Z-extent in normalized Three.js units
 * @returns Body-frame position vector (only Z component is non-zero)
 */
function chordFractionToBody(fraction: number, bodyLength: number): THREE.Vector3 {
  // fraction 0 (LE/head) → +Z, fraction 1 (TE/feet) → -Z
  const z = (0.5 - fraction) * bodyLength
  return new THREE.Vector3(0, 0, z)
}

// ── Main update ──────────────────────────────────────────────────────────────

/**
 * Update all force vectors based on current flight state.
 * 
 * Coordinate system (Three.js default):
 * - X = right
 * - Y = up
 * - Z = toward camera (out of screen)
 * 
 * Wind direction in body frame:
 * - At α=0, β=0: wind comes from +Z
 * - α rotates wind in the Y-Z plane (positive α → wind has downward component)
 * - β rotates wind in the X-Z plane (positive β → wind from right)
 *
 * Force directions in body frame:
 * - Lift perpendicular to wind, in the plane of wind and body-up (Y)
 *   Positive lift → liftDir, negative lift → -liftDir
 * - Drag opposes velocity (opposite to windDir)
 * - Side force perpendicular to both
 * - Weight always -Y world
 */
import type { InertiaComponents } from '../polar/inertia.ts'

export function updateForceVectors(
  vectors: ForceVectors,
  coeffs: FullCoefficients,
  polar: ContinuousPolar,
  alpha_deg: number,
  beta_deg: number,
  airspeed: number,
  rho: number,
  bodyLength: number,
  rotationMatrix: THREE.Matrix4 | null,
  inertia: InertiaComponents | null = null,
  gravityDir?: THREE.Vector3,
  pilotScale: number = 1.0,
  controls?: SegmentControls,
): void {
  // ── Wind frame & forces ──
  const { windDir, dragDir, liftDir, sideDir } = computeWindFrame(alpha_deg, beta_deg)

  const hasSegments = polar.aeroSegments && polar.aeroSegments.length > 0
  const ctrl = controls ?? defaultControls()

  // Forces from lumped polar (used for single-segment fallback and system weight)
  const forces = coeffToForces(coeffs.cl, coeffs.cd, coeffs.cy, polar.s, polar.m, rho, airspeed)

  // Frame rotation — pre-computed upstream (null = body frame, no rotation)

  function applyFrame(dir: THREE.Vector3): THREE.Vector3 {
    if (rotationMatrix) return dir.clone().applyMatrix4(rotationMatrix)
    return dir.clone()
  }

  function applyFramePos(pos: THREE.Vector3): THREE.Vector3 {
    if (rotationMatrix) return pos.clone().applyMatrix4(rotationMatrix)
    return pos.clone()
  }

  // ── Determine CG origin ──
  // When mass segments exist, use computeCenterOfMass for proper 3D CG.
  // Otherwise fall back to chord-fraction CG.
  let cgOrigin: THREE.Vector3
  if (polar.massSegments && polar.massSegments.length > 0) {
    const cgNED = computeCenterOfMass(polar.massSegments, 1.875, polar.m)
    cgOrigin = applyFramePos(nedToThreeJS(cgNED).multiplyScalar(pilotScale))
  } else {
    cgOrigin = applyFramePos(chordFractionToBody(polar.cg, bodyLength))
  }

  // ── Wind (at CG, same origin as total aero / net force) ──
  setShadedArrow(vectors.windArrow, cgOrigin, applyFrame(windDir), airspeed * 0.03)

  // ── Per-segment rendering ──
  if (hasSegments) {
    const segments = polar.aeroSegments!
    ensureSegmentArrows(vectors, segments)

    // Compute per-segment forces
    const segForces: SegmentForceResult[] = segments.map(seg =>
      computeSegmentForce(seg, alpha_deg, beta_deg, ctrl, rho, airspeed)
    )

    // Render per-segment ArrowHelper arrows
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const sf = segForces[i]
      const sa = vectors.segmentArrows[i]

      // Segment position: NED normalized → meters → Three.js → pilotScale
      const posThree = nedToThreeJS(seg.position).multiplyScalar(pilotScale * 1.875)
      const posWorld = applyFramePos(posThree)

      // Lift arrow — flip direction for negative lift
      const liftLen = Math.abs(sf.lift) * FORCE_SCALE
      if (liftLen > 0.001) {
        const lDir = sf.lift >= 0 ? liftDir.clone() : liftDir.clone().negate()
        sa.lift.setDirection(applyFrame(lDir).normalize())
        sa.lift.setLength(liftLen, 0.06, 0.03)
        sa.lift.position.copy(posWorld)
        sa.lift.visible = true
      } else {
        sa.lift.visible = false
      }

      // Drag arrow
      const dragLen = sf.drag * FORCE_SCALE
      if (dragLen > 0.001) {
        sa.drag.setDirection(applyFrame(dragDir).normalize())
        sa.drag.setLength(dragLen, 0.06, 0.03)
        sa.drag.position.copy(posWorld)
        sa.drag.visible = true
      } else {
        sa.drag.visible = false
      }

      // Side arrow — flip direction for negative side force
      const sideLen = Math.abs(sf.side) * FORCE_SCALE
      if (sideLen > 0.001) {
        const sDir = sf.side >= 0 ? sideDir.clone() : sideDir.clone().negate()
        sa.side.setDirection(applyFrame(sDir).normalize())
        sa.side.setLength(sideLen, 0.06, 0.03)
        sa.side.position.copy(posWorld)
        sa.side.visible = true
      } else {
        sa.side.visible = false
      }
    }

    // Sum segment forces for system-level vectors (NED body frame)
    const cgNED = polar.massSegments
      ? computeCenterOfMass(polar.massSegments, 1.875, polar.m)
      : { x: 0, y: 0, z: 0 }
    const windNED = { x: windDir.z, y: -windDir.x, z: -windDir.y }
    const liftNED = { x: liftDir.z, y: -liftDir.x, z: -liftDir.y }
    const sideNED = { x: sideDir.z, y: -sideDir.x, z: -sideDir.y }
    const system = sumAllSegments(segments, segForces, cgNED, 1.875, windNED, liftNED, sideNED)

    // Total aero force (at CG, from summed segments)
    const totalAeroThree = nedToThreeJS(system.force)
    const totalAeroMag = totalAeroThree.length()
    if (totalAeroMag > 0.01) {
      totalAeroThree.normalize()
      setShadedArrow(vectors.totalAeroArrow, cgOrigin, applyFrame(totalAeroThree), totalAeroMag * FORCE_SCALE)
      vectors.totalAeroArrow.visible = true
    } else {
      vectors.totalAeroArrow.visible = false
    }

    // Hide single-segment aero arrows (replaced by per-segment ArrowHelpers)
    vectors.liftArrow.visible = false
    vectors.dragArrow.visible = false
    vectors.sideArrow.visible = false

    // ── Moment arcs from segment summation ──
    const sysMoment = system.moment
    let pitchArcVal: number, yawArcVal: number, rollArcVal: number
    if (inertia) {
      const ACCEL_SCALE = 0.005
      pitchArcVal = inertia.Iyy > 0.001 ? -(sysMoment.y / inertia.Iyy) * ACCEL_SCALE : 0
      yawArcVal   = inertia.Izz > 0.001 ? -(sysMoment.z / inertia.Izz) * ACCEL_SCALE : 0
      rollArcVal  = inertia.Ixx > 0.001 ?  (sysMoment.x / inertia.Ixx) * ACCEL_SCALE : 0
    } else {
      pitchArcVal = -sysMoment.y * TORQUE_SCALE
      yawArcVal   = -sysMoment.z * TORQUE_SCALE
      rollArcVal  =  sysMoment.x * TORQUE_SCALE
    }

    vectors.pitchArc.setAngle(pitchArcVal)
    vectors.pitchArc.position.copy(cgOrigin)
    vectors.pitchArc.visible = Math.abs(pitchArcVal) > 0.02

    vectors.yawArc.setAngle(yawArcVal)
    vectors.yawArc.position.copy(cgOrigin)
    vectors.yawArc.visible = Math.abs(yawArcVal) > 0.02

    vectors.rollArc.setAngle(rollArcVal)
    vectors.rollArc.position.copy(cgOrigin)
    vectors.rollArc.visible = Math.abs(rollArcVal) > 0.02

    // ── Weight (at CG) ──
    const gDir = gravityDir ?? new THREE.Vector3(0, -1, 0)
    setShadedArrow(vectors.weightArrow, cgOrigin, gDir, forces.weight * FORCE_SCALE)

    // ── Net force (at CG) ──
    const totalAeroWorld = applyFrame(nedToThreeJS(system.force))
    const netForce = totalAeroWorld.clone().addScaledVector(gDir, forces.weight)
    const netMag = netForce.length()
    if (netMag > 0.01) {
      netForce.normalize()
      setShadedArrow(vectors.netArrow, cgOrigin, netForce, netMag * FORCE_SCALE)
      vectors.netArrow.visible = true
    } else {
      vectors.netArrow.visible = false
    }

  } else {
    // ── Single-segment fallback (polars without aeroSegments) ──

    // Remove any stale segment arrows
    if (vectors.segmentArrows.length > 0) {
      ensureSegmentArrows(vectors, [])
    }

    const cpOrigin = applyFramePos(chordFractionToBody(coeffs.cp, bodyLength))
    const cpLatOrigin = applyFramePos(chordFractionToBody(polar.cp_lateral, bodyLength))

    // ── Lift (at CP) ──
    const liftSigned = forces.lift
    const liftDrawDir = liftSigned >= 0 ? liftDir.clone() : liftDir.clone().negate()
    setShadedArrow(vectors.liftArrow, cpOrigin, applyFrame(liftDrawDir), Math.abs(liftSigned) * FORCE_SCALE)

    // ── Drag (at CP, CD always ≥ 0) ──
    setShadedArrow(vectors.dragArrow, cpOrigin, applyFrame(dragDir), forces.drag * FORCE_SCALE)

    // ── Side (at lateral CP) ──
    const sideSigned = forces.side
    const sideDrawDir = sideSigned >= 0 ? sideDir.clone() : sideDir.clone().negate()
    setShadedArrow(vectors.sideArrow, cpLatOrigin, applyFrame(sideDrawDir), Math.abs(sideSigned) * FORCE_SCALE)
    vectors.sideArrow.visible = Math.abs(forces.side) > 0.5

    // ── Total aero force (at CP) ──
    const totalAero = new THREE.Vector3()
      .addScaledVector(liftDir, forces.lift)
      .addScaledVector(dragDir, forces.drag)
      .addScaledVector(sideDir, forces.side)
    const totalAeroMag = totalAero.length()
    if (totalAeroMag > 0.01) {
      totalAero.normalize()
      setShadedArrow(vectors.totalAeroArrow, cpOrigin, applyFrame(totalAero), totalAeroMag * FORCE_SCALE)
      vectors.totalAeroArrow.visible = true
    } else {
      vectors.totalAeroArrow.visible = false
    }

    // ── Weight (at CG) ──
    const gDir = gravityDir ?? new THREE.Vector3(0, -1, 0)
    setShadedArrow(vectors.weightArrow, cgOrigin, gDir, forces.weight * FORCE_SCALE)

    // ── Net force (at CG) ──
    const totalAeroWorld = applyFrame(new THREE.Vector3()
      .addScaledVector(liftDir, forces.lift)
      .addScaledVector(dragDir, forces.drag)
      .addScaledVector(sideDir, forces.side))
    const netForce = totalAeroWorld.clone().addScaledVector(gDir, forces.weight)
    const netMag = netForce.length()
    if (netMag > 0.01) {
      netForce.normalize()
      setShadedArrow(vectors.netArrow, cgOrigin, netForce, netMag * FORCE_SCALE)
      vectors.netArrow.visible = true
    } else {
      vectors.netArrow.visible = false
    }

    // ── Moment arcs (at CG) ──
    const q = 0.5 * rho * airspeed * airspeed
    const pitchTorque = q * polar.s * polar.chord * coeffs.cm
    const yawTorque = q * polar.s * polar.chord * coeffs.cn
    const rollTorque = q * polar.s * polar.chord * coeffs.cl_roll

    let pitchArc: number, yawArc: number, rollArc: number
    if (inertia) {
      const ACCEL_SCALE = 0.005
      const pitchAccel = inertia.Iyy > 0.001 ? pitchTorque / inertia.Iyy : 0
      const yawAccel = inertia.Izz > 0.001 ? yawTorque / inertia.Izz : 0
      const rollAccel = inertia.Ixx > 0.001 ? rollTorque / inertia.Ixx : 0
      pitchArc = -pitchAccel * ACCEL_SCALE
      yawArc = -yawAccel * ACCEL_SCALE
      rollArc = rollAccel * ACCEL_SCALE
    } else {
      pitchArc = -pitchTorque * TORQUE_SCALE
      yawArc = -yawTorque * TORQUE_SCALE
      rollArc = rollTorque * TORQUE_SCALE
    }

    vectors.pitchArc.setAngle(pitchArc)
    vectors.pitchArc.position.copy(cgOrigin)
    vectors.pitchArc.visible = Math.abs(pitchArc) > 0.02

    vectors.yawArc.setAngle(yawArc)
    vectors.yawArc.position.copy(cgOrigin)
    vectors.yawArc.visible = Math.abs(yawArc) > 0.02

    vectors.rollArc.setAngle(rollArc)
    vectors.rollArc.position.copy(cgOrigin)
    vectors.rollArc.visible = Math.abs(rollArc) > 0.02
  }

  // ── Rotate moment arcs into inertial frame ──
  // In body mode the arcs' own axis definitions are already correct.
  // In inertial mode we apply the same attitude rotation as the model.
  if (rotationMatrix) {
    const rotQ = new THREE.Quaternion()
    rotQ.setFromRotationMatrix(rotationMatrix)
    vectors.pitchArc.quaternion.copy(rotQ)
    vectors.yawArc.quaternion.copy(rotQ)
    vectors.rollArc.quaternion.copy(rotQ)
  } else {
    vectors.pitchArc.quaternion.identity()
    vectors.yawArc.quaternion.identity()
    vectors.rollArc.quaternion.identity()
  }
}

// ── Helper ───────────────────────────────────────────────────────────────────

function setShadedArrow(arrow: ShadedArrow, origin: THREE.Vector3, dir: THREE.Vector3, length: number): void {
  const safeLen = Math.max(0.001, length)
  arrow.setOrigin(origin)
  if (dir.lengthSq() > 1e-10) {
    arrow.setDirection(dir.clone().normalize())
  }
  arrow.setLength(safeLen)
}
