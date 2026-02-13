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
import type { FullCoefficients, ContinuousPolar } from '../polar/continuous-polar.ts'
import { coeffToForces } from '../polar/coefficients.ts'
import { ShadedArrow } from './shaded-arrow.ts'
import { CurvedArrow } from './curved-arrow.ts'
import { windDirectionBody } from './frames.ts'

const DEG2RAD = Math.PI / 180

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
import type { InertiaComponents } from './inertia.ts'

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
  gravityDir?: THREE.Vector3
): void {
  const alpha_rad = alpha_deg * DEG2RAD
  const beta_rad = beta_deg * DEG2RAD

  // ── Origin points (body frame) ──
  const cpBody = chordFractionToBody(coeffs.cp, bodyLength)
  const cgBody = chordFractionToBody(polar.cg, bodyLength)
  const cpLatBody = chordFractionToBody(polar.cp_lateral, bodyLength)

  // Wind direction in body frame (where the air comes FROM)
  const windDir = windDirectionBody(alpha_deg, beta_deg)

  // Compute forces (lift/side can be negative when CL/CY < 0)
  const forces = coeffToForces(coeffs.cl, coeffs.cd, coeffs.cy, polar.s, polar.m, rho, airspeed)

  // Drag direction: opposes the body's velocity (opposite to windDir)
  const dragDir = windDir.clone().negate()

  // Lift direction: perpendicular to wind, in the vertical plane containing wind
  const up = new THREE.Vector3(0, 1, 0)
  const liftDir = new THREE.Vector3()
  liftDir.crossVectors(windDir, up)
  liftDir.crossVectors(liftDir, windDir)
  if (liftDir.lengthSq() > 1e-10) {
    liftDir.normalize()
  } else {
    liftDir.set(0, 0, -1)
  }

  // Side force direction: perpendicular to wind and lift
  const sideDir = new THREE.Vector3()
  sideDir.crossVectors(windDir, liftDir).normalize()

  // Frame rotation — pre-computed upstream (null = body frame, no rotation)

  function applyFrame(dir: THREE.Vector3): THREE.Vector3 {
    if (rotationMatrix) return dir.clone().applyMatrix4(rotationMatrix)
    return dir.clone()
  }

  function applyFramePos(pos: THREE.Vector3): THREE.Vector3 {
    if (rotationMatrix) return pos.clone().applyMatrix4(rotationMatrix)
    return pos.clone()
  }

  // Transformed origins for current frame mode
  const cpOrigin = applyFramePos(cpBody)
  const cgOrigin = applyFramePos(cgBody)
  const cpLatOrigin = applyFramePos(cpLatBody)
  const modelCenter = new THREE.Vector3(0, 0, 0)

  // ── Wind (from model center, always positive length) ──
  setShadedArrow(vectors.windArrow, modelCenter, applyFrame(windDir), airspeed * 0.03)

  // ── Lift (at CP) ── flip direction when force is negative
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
  // In body frame, gravity is rotated by the body attitude (gravity comes
  // from "above" in inertial space, which is not necessarily +Y in body frame).
  // In inertial frame, gravity is always -Y (straight down in Three.js world).
  // gravityDir is a unit vector in the current display frame's Three.js coords.
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
  // Can display either torque (N·m) or angular acceleration (rad/s²).
  const q = 0.5 * rho * airspeed * airspeed
  const pitchTorque = q * polar.s * polar.chord * coeffs.cm  // N·m
  const yawTorque = q * polar.s * polar.chord * coeffs.cn    // N·m
  const rollTorque = q * polar.s * polar.chord * coeffs.cl_roll  // N·m

  let pitchArc: number, yawArc: number, rollArc: number
  if (inertia) {
    // Angular acceleration mode: α̈ = τ / I
    const ACCEL_SCALE = 0.005  // rad/s² → visual radians
    const pitchAccel = inertia.Iyy > 0.001 ? pitchTorque / inertia.Iyy : 0
    const yawAccel = inertia.Izz > 0.001 ? yawTorque / inertia.Izz : 0
    const rollAccel = inertia.Ixx > 0.001 ? rollTorque / inertia.Ixx : 0
    pitchArc = -pitchAccel * ACCEL_SCALE
    yawArc = -yawAccel * ACCEL_SCALE
    rollArc = rollAccel * ACCEL_SCALE
  } else {
    // Torque mode (default)
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
