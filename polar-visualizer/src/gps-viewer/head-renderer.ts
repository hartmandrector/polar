/**
 * Head Model Renderer — Loads fullhead.gltf and orients it from sensor fusion data
 *
 * Scene graph architecture:
 *   wingsuit model (parent, at origin)
 *     └─ headGroup (child, positioned at neck)
 *         └─ fullhead.gltf
 *
 * Transform chain:
 *   q_head_relative = q_wingsuit_inertial⁻¹ × q_head_inertial
 *
 * Since Three.js composes parent transforms automatically,
 * we only set the RELATIVE rotation on headGroup each frame.
 *
 * Fused CSV quaternions are NWU body-to-earth.
 * GPS pipeline uses NED. We convert NWU→NED on the quaternion.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bodyToInertialQuat } from '../viewer/frames'
import type { HeadSensorPoint } from './head-sensor'
import { findHeadIndex } from './head-sensor'

const HEAD_MODEL_PATH = '/models/fullhead.gltf'

// Neck attachment point in model space (tuned to wingsuit model)
// wingsuit GLB is ~3.55 units tall, scaled by MODEL_SCALE ≈ 0.528
// Head sits at top of model — Y-up in Three.js
const NECK_OFFSET_Y = 0.85   // meters above model origin (approx shoulder level)
const HEAD_SCALE = 0.01      // fullhead.gltf is likely large — scale to meters

export class HeadModelRenderer {
  private headGroup: THREE.Group
  private headModel: THREE.Group | null = null
  private loaded = false
  private sensorData: HeadSensorPoint[] = []
  private visible = true

  // Time offset: sensor t=0 vs GPS t=0 (seconds to add to GPS time to get sensor time)
  private timeOffset = 0

  constructor(private parentModel: THREE.Group) {
    // Create head group as child of wingsuit model
    this.headGroup = new THREE.Group()
    this.headGroup.position.set(0, NECK_OFFSET_Y, 0)
    this.parentModel.add(this.headGroup)

    this.loadModel()
  }

  private async loadModel() {
    const loader = new GLTFLoader()
    try {
      const gltf = await loader.loadAsync(HEAD_MODEL_PATH)
      this.headModel = gltf.scene as THREE.Group
      this.headModel.scale.setScalar(HEAD_SCALE)
      this.headGroup.add(this.headModel)
      this.loaded = true
      console.log('Head model loaded')
    } catch (e) {
      console.error('Failed to load head model:', e)
    }
  }

  setSensorData(data: HeadSensorPoint[]) {
    this.sensorData = data
    console.log(`Head sensor data: ${data.length} points, ${data[0]?.t.toFixed(1)}s → ${data[data.length - 1]?.t.toFixed(1)}s`)
  }

  /**
   * Set time offset to align sensor timestamps with GPS timestamps.
   * offset = GPS_t - sensor_t (add to GPS time to get sensor time)
   */
  setTimeOffset(offset: number) {
    this.timeOffset = offset
  }

  setVisible(v: boolean) {
    this.visible = v
    this.headGroup.visible = v
  }

  /**
   * Update head orientation for current GPS time and wingsuit quaternion.
   *
   * @param gpsTime  - current time in GPS pipeline (seconds from GPS start)
   * @param wingsuitQuat - wingsuit body-to-inertial quaternion (Three.js frame)
   */
  update(gpsTime: number, wingsuitQuat: THREE.Quaternion) {
    if (!this.loaded || !this.visible || this.sensorData.length === 0) return

    // Map GPS time → sensor time
    const sensorTime = gpsTime + this.timeOffset
    const { index, fraction } = findHeadIndex(this.sensorData, sensorTime)

    const pt = this.sensorData[index]
    const d2r = Math.PI / 180

    // Fused CSV Euler angles are in NWU.
    // NWU→NED conversion for Euler angles:
    //   roll_ned = roll_nwu  (rotation about North axis — same)
    //   pitch_ned = -pitch_nwu  (NWU pitch up = NED pitch down... actually same sign)
    //   yaw_ned = -yaw_nwu  (NWU yaw positive CCW from North, NED CW from North)
    //
    // Actually: NWU and NED share the X (North) axis.
    //   roll (about X): same sign (right wing down = positive in both)
    //   pitch (about Y): NWU Y=West, NED Y=East — pitch sign flips
    //   yaw (about Z): NWU Z=Up, NED Z=Down — yaw sign flips
    const roll_ned = pt.roll * d2r
    const pitch_ned = -pt.pitch * d2r
    const yaw_ned = -pt.yaw * d2r

    let headInertialQuat: THREE.Quaternion

    if (fraction > 0 && index < this.sensorData.length - 1) {
      const pt2 = this.sensorData[index + 1]
      const q1 = bodyToInertialQuat(roll_ned, pitch_ned, yaw_ned)
      const q2 = bodyToInertialQuat(pt2.roll * d2r, -pt2.pitch * d2r, -pt2.yaw * d2r)
      headInertialQuat = q1.slerp(q2, fraction)
    } else {
      headInertialQuat = bodyToInertialQuat(roll_ned, pitch_ned, yaw_ned)
    }

    // Relative rotation: q_head_relative = q_wingsuit⁻¹ × q_head
    const wingsuitInv = wingsuitQuat.clone().invert()
    const relativeQuat = wingsuitInv.multiply(headInertialQuat)

    this.headGroup.quaternion.copy(relativeQuat)
  }

  dispose() {
    this.parentModel.remove(this.headGroup)
  }
}
