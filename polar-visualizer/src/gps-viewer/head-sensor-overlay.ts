/**
 * Head Sensor Vector Overlay
 *
 * Renders sensor data vectors attached to the head model:
 *   - Accelerometer (body frame) — shaded arrow, yellow
 *   - Magnetometer (body frame) — shaded arrow, purple
 *   - Gyro rates — curved arrows (p=red, q=green, r=blue) around body axes
 *
 * Both straight vectors have configurable rotation offsets to align
 * sensor body frame with the head model's local coordinate system.
 * Mag has its own offset because its local axes differ from the accel/gyro
 * (X and Z negated on the LIS2MDL vs LSM6DSO).
 */

import * as THREE from 'three'
import { ShadedArrow } from '../viewer/shaded-arrow'
import { CurvedArrow } from '../viewer/curved-arrow'
import type { HeadSensorPoint } from './head-sensor'

// Sensor position relative to headGroup origin (top of head, FlySight mount)
const SENSOR_OFFSET = new THREE.Vector3(0, -0.12, -0.33)

// Vector scales
const ACCEL_SCALE = 0.12     // 1g → 0.12m arrow length
const MAG_SCALE = 0.003      // µT → scene meters (Earth field ~30-60 µT)
const GYRO_SCALE = 0.002
const GYRO_ARC_RADIUS = 0.04

// Colors
const ACCEL_COLOR = 0xffcc00   // yellow
const MAG_COLOR = 0xbb44ff     // purple
const GYRO_P_COLOR = 0xff4444  // red (roll / x)
const GYRO_Q_COLOR = 0x44ff66  // green (pitch / y)
const GYRO_R_COLOR = 0x4488ff  // blue (yaw / z)

// Rotation offsets: sensor body frame → head model local frame
// These are Euler angles (XYZ order) applied to the raw sensor vector
// before rendering. Tune these to align vectors with reality.
//
// Accel/gyro share the LSM6DSO frame.
// Mag uses LIS2MDL frame which has X and Z negated relative to LSM6DSO.
const ACCEL_ROTATION = new THREE.Euler(0, 0, 0, 'XYZ')
const MAG_ROTATION = new THREE.Euler(0, 0, 0, 'XYZ')

// Pre-computed quaternions from Euler offsets
const accelRotQuat = new THREE.Quaternion().setFromEuler(ACCEL_ROTATION)
const magRotQuat = new THREE.Quaternion().setFromEuler(MAG_ROTATION)

export class HeadSensorOverlay {
  private group: THREE.Group
  private accelArrow: ShadedArrow
  private magArrow: ShadedArrow
  private gyroPArrow: CurvedArrow
  private gyroQArrow: CurvedArrow
  private gyroRArrow: CurvedArrow
  private visible = true

  constructor(private parentGroup: THREE.Group) {
    this.group = new THREE.Group()
    this.group.name = 'sensorOverlay'
    this.group.position.copy(SENSOR_OFFSET)
    this.parentGroup.add(this.group)

    // Straight arrows
    this.accelArrow = new ShadedArrow(ACCEL_COLOR, 'accel', {
      shaftRadius: 0.006,
      headRadius: 0.014,
      headLength: 0.025,
    })
    this.group.add(this.accelArrow)

    this.magArrow = new ShadedArrow(MAG_COLOR, 'mag', {
      shaftRadius: 0.006,
      headRadius: 0.014,
      headLength: 0.025,
    })
    this.group.add(this.magArrow)

    // Curved arrows for gyro
    this.gyroPArrow = new CurvedArrow('x', GYRO_P_COLOR, 'gyro-p', {
      radius: GYRO_ARC_RADIUS,
      tubeRadius: 0.004,
      headLength: 0.015,
      headRadius: 0.01,
    })
    this.group.add(this.gyroPArrow)

    this.gyroQArrow = new CurvedArrow('y', GYRO_Q_COLOR, 'gyro-q', {
      radius: GYRO_ARC_RADIUS,
      tubeRadius: 0.004,
      headLength: 0.015,
      headRadius: 0.01,
    })
    this.group.add(this.gyroQArrow)

    this.gyroRArrow = new CurvedArrow('z', GYRO_R_COLOR, 'gyro-r', {
      radius: GYRO_ARC_RADIUS,
      tubeRadius: 0.004,
      headLength: 0.015,
      headRadius: 0.01,
    })
    this.group.add(this.gyroRArrow)
  }

  setVisible(v: boolean) {
    this.visible = v
    this.group.visible = v
  }

  /** Update rotation offset for accelerometer vector */
  setAccelRotation(euler: THREE.Euler) {
    accelRotQuat.setFromEuler(euler)
  }

  /** Update rotation offset for magnetometer vector */
  setMagRotation(euler: THREE.Euler) {
    magRotQuat.setFromEuler(euler)
  }

  update(pt: HeadSensorPoint) {
    if (!this.visible) return

    // ── Accelerometer (body frame, in g) ──
    const accelLen = Math.sqrt(
      pt.accelBodyX ** 2 + pt.accelBodyY ** 2 + pt.accelBodyZ ** 2
    )
    if (accelLen > 0.01) {
      const accelDir = new THREE.Vector3(
        pt.accelBodyX / accelLen,
        pt.accelBodyY / accelLen,
        pt.accelBodyZ / accelLen
      ).applyQuaternion(accelRotQuat)
      this.accelArrow.setDirection(accelDir)
      this.accelArrow.setLength(accelLen * ACCEL_SCALE)
      this.accelArrow.visible = true
    } else {
      this.accelArrow.visible = false
    }

    // ── Magnetometer (body frame) ──
    const magLen = Math.sqrt(pt.magX ** 2 + pt.magY ** 2 + pt.magZ ** 2)
    if (!isNaN(magLen) && magLen > 0.01) {
      const magDir = new THREE.Vector3(
        pt.magX / magLen,
        pt.magY / magLen,
        pt.magZ / magLen
      ).applyQuaternion(magRotQuat)
      this.magArrow.setDirection(magDir)
      this.magArrow.setLength(magLen * MAG_SCALE)
      this.magArrow.visible = true
    } else {
      this.magArrow.visible = false
    }

    // ── Gyro curved arrows (deg/s → arc angle) ──
    const d2r = Math.PI / 180
    this.gyroPArrow.setAngle(pt.gyroX * d2r * GYRO_SCALE)
    this.gyroQArrow.setAngle(pt.gyroY * d2r * GYRO_SCALE)
    this.gyroRArrow.setAngle(pt.gyroZ * d2r * GYRO_SCALE)
  }

  dispose() {
    this.parentGroup.remove(this.group)
  }
}
