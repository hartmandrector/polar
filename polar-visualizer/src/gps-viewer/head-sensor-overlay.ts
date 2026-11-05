/**
 * Head Sensor Vector Overlay
 *
 * Renders sensor data vectors attached to the head sensor:
 *   - Specific force (accel_earth_*, gravity included) — shaded arrow, yellow
 *   - Kinematic acceleration (earth_accel_*, gravity removed) — shaded arrow, orange
 *   - Magnetometer (body frame) — shaded arrow, purple
 *   - Gyro rates — curved arrows (x=red, y=green, z=blue) around sensor axes
 *
 * The parent group (HeadModelRenderer.headGroup) is oriented by the sensor
 * quaternion, so its local axes ARE the raw sensor axes (x, y, z). Body-frame
 * data (gyro) is drawn directly; earth-frame accelerations are rotated into
 * local coordinates with the group's world quaternion so they render along
 * their true earth direction in both the inertial and body-frame scenes.
 */

import * as THREE from 'three'
import { ShadedArrow } from '../viewer/shaded-arrow'
import { CurvedArrow } from '../viewer/curved-arrow'
import type { HeadSensorPoint } from './head-sensor'

// Default sensor position in headGroup local coords (overridden by setOrigin
// with the FlySight device position from the head GLB).
const DEFAULT_SENSOR_OFFSET = new THREE.Vector3(0, -0.12, 0.33)

// Vector scales
const ACCEL_SCALE = 0.12     // 1g → 0.12m arrow length
const MAG_SCALE = 0.008      // µT → scene meters (tune to match accel arrow size)
// Gyro: sensor fusion viewer uses gyroScale=0.5 with rad/s input and radius=0.9
// Our input is deg/s, head model is ~10× smaller. Scale to match visual proportions.
const GYRO_SCALE = 0.5       // matches sensor fusion viewer (applied after deg→rad)
const GYRO_ARC_RADIUS = 0.08

// Colors
const SPECIFIC_FORCE_COLOR = 0xffcc00  // yellow
const KINEMATIC_ACCEL_COLOR = 0xff7a00 // orange
const MAG_COLOR = 0xbb44ff     // purple
const GYRO_P_COLOR = 0xff4444  // red (roll / x)
const GYRO_Q_COLOR = 0x44ff66  // green (pitch / y)
const GYRO_R_COLOR = 0x4488ff  // blue (yaw / z)

// Magnetometer axes are unverified; this 180° about Y preserves the
// previous on-screen behavior after the sensor-frame fix.
const MAG_ROTATION = new THREE.Euler(0, Math.PI, 0, 'XYZ')
const magRotQuat = new THREE.Quaternion().setFromEuler(MAG_ROTATION)

const _v = new THREE.Vector3()
const _qInv = new THREE.Quaternion()

/** Point a shaded arrow along a local-frame vector (g units); hides it on NaN/zero. */
function setArrow(arrow: ShadedArrow, v: THREE.Vector3, scale: number) {
  const len = v.length()
  if (!isFinite(len) || len < 0.01) {
    arrow.visible = false
    return
  }
  arrow.setDirection(v.clone().divideScalar(len))
  arrow.setLength(len * scale)
  arrow.visible = true
}

export class HeadSensorOverlay {
  private group: THREE.Group
  private specificForceArrow: ShadedArrow
  private kinematicAccelArrow: ShadedArrow
  private magArrow: ShadedArrow
  private gyroPArrow: CurvedArrow
  private gyroQArrow: CurvedArrow
  private gyroRArrow: CurvedArrow
  private visible = true

  constructor(private parentGroup: THREE.Group) {
    this.group = new THREE.Group()
    this.group.name = 'sensorOverlay'
    this.group.position.copy(DEFAULT_SENSOR_OFFSET)
    this.parentGroup.add(this.group)

    const straight = { shaftRadius: 0.006, headRadius: 0.014, headLength: 0.025 }
    this.specificForceArrow = new ShadedArrow(SPECIFIC_FORCE_COLOR, 'accel-specific-force', straight)
    this.group.add(this.specificForceArrow)

    this.kinematicAccelArrow = new ShadedArrow(KINEMATIC_ACCEL_COLOR, 'accel-kinematic', straight)
    this.group.add(this.kinematicAccelArrow)

    this.magArrow = new ShadedArrow(MAG_COLOR, 'mag', straight)
    this.group.add(this.magArrow)

    const curved = { radius: GYRO_ARC_RADIUS, tubeRadius: 0.004, headLength: 0.015, headRadius: 0.01 }
    this.gyroPArrow = new CurvedArrow('x', GYRO_P_COLOR, 'gyro-p', curved)
    this.group.add(this.gyroPArrow)
    this.gyroQArrow = new CurvedArrow('y', GYRO_Q_COLOR, 'gyro-q', curved)
    this.group.add(this.gyroQArrow)
    this.gyroRArrow = new CurvedArrow('z', GYRO_R_COLOR, 'gyro-r', curved)
    this.group.add(this.gyroRArrow)
  }

  /** Place the arrow origin (headGroup local coords), e.g. at the FlySight device. */
  setOrigin(pos: THREE.Vector3) {
    this.group.position.copy(pos)
  }

  setVisible(v: boolean) {
    this.visible = v
    this.group.visible = v
  }

  /**
   * @param pt - sensor sample
   * @param headWorldQuat - parent group's orientation in the inertial Three.js
   *   world (before any body-frame-scene adjustment), used to bring
   *   earth-frame vectors into local coordinates.
   */
  update(pt: HeadSensorPoint, headWorldQuat: THREE.Quaternion) {
    if (!this.visible) return

    _qInv.copy(headWorldQuat).invert()
    // NWU (north, west, up) → Three.js world (x=west, y=up, z=north)
    const earthToLocal = (n: number, w: number, u: number) =>
      _v.set(w, u, n).applyQuaternion(_qInv)

    // ── Specific force (gravity included) — fall back to raw body accel ──
    if (isFinite(pt.accelEarthX) && isFinite(pt.accelEarthY) && isFinite(pt.accelEarthZ)) {
      setArrow(this.specificForceArrow, earthToLocal(pt.accelEarthX, pt.accelEarthY, pt.accelEarthZ), ACCEL_SCALE)
    } else {
      setArrow(this.specificForceArrow, _v.set(pt.accelBodyX, pt.accelBodyY, pt.accelBodyZ), ACCEL_SCALE)
    }

    // ── Kinematic acceleration (gravity removed, ESKF calibrated) ──
    setArrow(this.kinematicAccelArrow, earthToLocal(pt.earthAccelX, pt.earthAccelY, pt.earthAccelZ), ACCEL_SCALE)

    // ── Magnetometer (body frame) ──
    setArrow(this.magArrow, _v.set(pt.magX, pt.magY, pt.magZ).applyQuaternion(magRotQuat), MAG_SCALE)

    // ── Gyro curved arrows (deg/s → arc angle), sensor axes = local axes ──
    const d2r = Math.PI / 180
    this.gyroPArrow.setAngle(pt.gyroX * d2r * GYRO_SCALE)
    this.gyroQArrow.setAngle(pt.gyroY * d2r * GYRO_SCALE)
    this.gyroRArrow.setAngle(pt.gyroZ * d2r * GYRO_SCALE)
  }

  dispose() {
    this.parentGroup.remove(this.group)
  }
}
