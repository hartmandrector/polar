/**
 * Head Sensor Vector Overlay
 *
 * Renders sensor data vectors attached to the head model:
 *   - Acceleration (body frame) — shaded arrow, yellow
 *   - Gravity estimate (body frame) — shaded arrow, green
 *   - Gyro rates — curved arrows (p=red, q=green, r=blue) around body axes
 *
 * All vectors are in sensor body frame. Since the head model is already
 * oriented by the fusion quaternion, we just need to place vectors in
 * the headGroup's local space. The sensor body frame maps to the head
 * model's local frame.
 *
 * Sensor body frame convention (FlySight mounted on top of head):
 *   Depends on mounting — may need rotation. Start with identity and tune.
 */

import * as THREE from 'three'
import { ShadedArrow } from '../viewer/shaded-arrow'
import { CurvedArrow } from '../viewer/curved-arrow'
import type { HeadSensorPoint } from './head-sensor'

// Vector scale: sensor units → scene meters
const ACCEL_SCALE = 0.15     // 1g → 0.15m arrow length
const GRAVITY_SCALE = 0.15   // same scale as accel for comparison
const GYRO_SCALE = 0.003     // deg/s → radians for arc angle (scaled)
const GYRO_ARC_RADIUS = 0.12 // radius of gyro curved arrows

// Colors
const ACCEL_COLOR = 0xffcc00   // yellow
const GRAVITY_COLOR = 0x44ff66 // green
const GYRO_P_COLOR = 0xff4444  // red (roll)
const GYRO_Q_COLOR = 0x44ff66  // green (pitch)
const GYRO_R_COLOR = 0x4488ff  // blue (yaw)

export class HeadSensorOverlay {
  private group: THREE.Group
  private accelArrow: ShadedArrow
  private gravityArrow: ShadedArrow
  private gyroPArrow: CurvedArrow
  private gyroQArrow: CurvedArrow
  private gyroRArrow: CurvedArrow
  private visible = true

  constructor(private parentGroup: THREE.Group) {
    this.group = new THREE.Group()
    this.group.name = 'sensorOverlay'
    this.parentGroup.add(this.group)

    // Straight arrows for accel and gravity
    this.accelArrow = new ShadedArrow(ACCEL_COLOR, 'accel', {
      shaftRadius: 0.008,
      headRadius: 0.018,
      headLength: 0.03,
    })
    this.group.add(this.accelArrow)

    this.gravityArrow = new ShadedArrow(GRAVITY_COLOR, 'gravity', {
      shaftRadius: 0.008,
      headRadius: 0.018,
      headLength: 0.03,
    })
    this.group.add(this.gravityArrow)

    // Curved arrows for gyro rates
    this.gyroPArrow = new CurvedArrow('x', GYRO_P_COLOR, 'gyro-p', {
      radius: GYRO_ARC_RADIUS,
      tubeRadius: 0.006,
    })
    this.group.add(this.gyroPArrow)

    this.gyroQArrow = new CurvedArrow('y', GYRO_Q_COLOR, 'gyro-q', {
      radius: GYRO_ARC_RADIUS,
      tubeRadius: 0.006,
    })
    this.group.add(this.gyroQArrow)

    this.gyroRArrow = new CurvedArrow('z', GYRO_R_COLOR, 'gyro-r', {
      radius: GYRO_ARC_RADIUS,
      tubeRadius: 0.006,
    })
    this.group.add(this.gyroRArrow)
  }

  setVisible(v: boolean) {
    this.visible = v
    this.group.visible = v
  }

  /**
   * Update sensor vectors from a head sensor data point.
   * All vectors are in sensor body frame → head model local space.
   *
   * Sensor body frame to head model local frame mapping:
   *   May need a rotation depending on how FlySight is mounted.
   *   Start with identity mapping and tune.
   */
  update(pt: HeadSensorPoint) {
    if (!this.visible) return

    // ── Acceleration vector (body frame, in g) ──
    const accelLen = Math.sqrt(
      pt.accelBodyX ** 2 + pt.accelBodyY ** 2 + pt.accelBodyZ ** 2
    )
    if (accelLen > 0.01) {
      // Sensor body → Three.js local: need to map sensor axes to model axes
      // FlySight sensor body frame → head model local frame
      // Start with direct mapping, tune rotation later
      const accelDir = new THREE.Vector3(
        pt.accelBodyX / accelLen,
        pt.accelBodyY / accelLen,
        pt.accelBodyZ / accelLen
      )
      this.accelArrow.setDirection(accelDir)
      this.accelArrow.setLength(accelLen * ACCEL_SCALE)
      this.accelArrow.visible = true
    } else {
      this.accelArrow.visible = false
    }

    // ── Gravity vector (body frame, in g) ──
    const gx = pt.gravBodyX
    const gy = pt.gravBodyY
    const gz = pt.gravBodyZ
    const gravLen = Math.sqrt(gx ** 2 + gy ** 2 + gz ** 2)
    if (gravLen > 0.01) {
      const gravDir = new THREE.Vector3(gx / gravLen, gy / gravLen, gz / gravLen)
      this.gravityArrow.setDirection(gravDir)
      this.gravityArrow.setLength(gravLen * GRAVITY_SCALE)
      this.gravityArrow.visible = true
    } else {
      this.gravityArrow.visible = false
    }

    // ── Gyro curved arrows (deg/s) ──
    const d2r = Math.PI / 180
    this.gyroPArrow.setAngle(pt.gyroX * d2r * GYRO_SCALE)
    this.gyroQArrow.setAngle(pt.gyroY * d2r * GYRO_SCALE)
    this.gyroRArrow.setAngle(pt.gyroZ * d2r * GYRO_SCALE)
  }

  dispose() {
    this.parentGroup.remove(this.group)
  }
}
