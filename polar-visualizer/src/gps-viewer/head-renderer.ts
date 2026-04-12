/**
 * Head Model Renderer — Loads fullhead.gltf and orients it from sensor fusion data
 *
 * Architecture (refactored):
 *   headGroup lives as a sibling in the scene (not a child of the wingsuit model).
 *   Each frame we compute:
 *     - Head world position = wingsuit world position + neck offset rotated by wingsuit quat
 *     - Head world quaternion = head inertial quat (directly from sensor data)
 *
 *   No parent-child inversion needed. Clean, direct transform.
 *
 * Fused CSV quaternions are NWU body-to-earth (scalar-first: qw, qx, qy, qz).
 *
 * NWU→Three.js quaternion component remap (from fusion_viewer/src/viewer.ts):
 *   Three.js quat = (-qy, qz, -qx, qw)
 *
 * Sensor is mounted on the BACK of the helmet → 180° yaw offset vs fusion viewer
 * which renders the sensor box itself. We pre-multiply a 180° rotation about Z(Up/Y).
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { HeadSensorPoint } from './head-sensor'
import { findHeadIndex, lerpSensorPoints } from './head-sensor'
import { HeadSensorOverlay } from './head-sensor-overlay'

const HEAD_MODEL_PATH = '/models/headfs.glb'

// Neck attachment point in model-local coordinates
// wingsuit GLB: Z-forward, Y-up in Three.js model space
const NECK_OFFSET = new THREE.Vector3(0, 0.16, 0.62)  // (right, up, forward) in model space
const HEAD_SCALE = 0.1
// Rotation to align head model's forward with wingsuit's forward
// π around Z = 180° yaw flip (sensor on back of helmet)
// π/5 around X ≈ 36° pitch — original model alignment
const HEAD_MODEL_ROTATION = new THREE.Euler(Math.PI / 5, 0, Math.PI)

// Sensor mount pitch offset: sensor is near top of helmet, tilted ~10° skyward
// when pilot is level. Applied as a pre-rotation on the NWU quat before remap.
// 10° about NWU Y (West/pitch axis), positive = nose up in NWU right-hand rule
const MOUNT_PITCH_DEG = 10

export class HeadModelRenderer {
  private headGroup: THREE.Group
  private headModel: THREE.Group | null = null
  private loaded = false
  private sensorData: HeadSensorPoint[] = []
  private visible = true
  private sensorOverlay: HeadSensorOverlay | null = null
  private lastHeadQuat: THREE.Quaternion | null = null

  // Time offset: sensor t=0 vs GPS t=0 (seconds to add to GPS time to get sensor time)
  private timeOffset = 0

  // Scene reference for adding/removing headGroup
  private sceneRoot: THREE.Object3D

  constructor(sceneRoot: THREE.Object3D) {
    this.sceneRoot = sceneRoot

    // Create head group as a sibling in the scene (not a child of wingsuit)
    this.headGroup = new THREE.Group()
    this.sceneRoot.add(this.headGroup)

    this.loadModel()
  }

  private async loadModel() {
    const loader = new GLTFLoader()
    try {
      const gltf = await loader.loadAsync(HEAD_MODEL_PATH)
      this.headModel = gltf.scene as THREE.Group
      this.headModel.scale.setScalar(HEAD_SCALE)
      this.headModel.rotation.copy(HEAD_MODEL_ROTATION)
      this.headGroup.add(this.headModel)
      // Create sensor vector overlay in headGroup (moves with head)
      this.sensorOverlay = new HeadSensorOverlay(this.headGroup)
      this.loaded = true
      // Show head if sensor data already loaded, otherwise hide
      this.headGroup.visible = this.sensorData.length > 0
      console.log(`Head model loaded (${this.sensorData.length > 0 ? 'visible — sensor data present' : 'hidden until sensor data loaded'})`)
    } catch (e) {
      console.error('Failed to load head model:', e)
    }
  }

  setSensorData(data: HeadSensorPoint[]) {
    this.sensorData = data
    // Show head model now that we have data
    this.headGroup.visible = data.length > 0
    console.log(`Head sensor data: ${data.length} points, ${data[0]?.t.toFixed(1)}s → ${data[data.length - 1]?.t.toFixed(1)}s`)
  }

  /**
   * Set time offset to align sensor timestamps with GPS timestamps.
   * offset = GPS_t - sensor_t (add to GPS time to get sensor time)
   */
  setTimeOffset(offset: number) {
    this.timeOffset = offset
  }

  /** Returns true if fused sensor CSV data has been loaded */
  get hasSensorData(): boolean {
    return this.sensorData.length > 0
  }

  /**
   * Get the head sensor yaw (heading) in NED radians at a given GPS time.
   * Returns null if no sensor data or time is out of range.
   */
  getHeadingAtTime(gpsTime: number): number | null {
    if (this.sensorData.length === 0) return null
    const sensorTime = gpsTime + this.timeOffset
    const { index, fraction } = findHeadIndex(this.sensorData, sensorTime)
    const pt = this.sensorData[index]
    const d2r = Math.PI / 180

    let yawNwu = pt.yaw
    if (fraction > 0 && index < this.sensorData.length - 1) {
      const pt2 = this.sensorData[index + 1]
      yawNwu = yawNwu + (pt2.yaw - yawNwu) * fraction
    }
    // NWU→NED yaw: negate
    return -yawNwu * d2r
  }

  setVisible(v: boolean) {
    this.visible = v
    this.headGroup.visible = v
  }

  /**
   * Convert NWU body-to-earth quaternion from fused CSV to Three.js world quaternion.
   *
   * Proven remap from fusion_viewer/src/viewer.ts setOrientation():
   *   NWU (qx, qy, qz, qw) → Three.js quaternion.set(-qy, qz, -qx, qw)
   *
   * The 180° heading flip for back-of-helmet mount is handled by
   * HEAD_MODEL_ROTATION (Euler π around Z), so no quaternion pre-rotation needed.
   */
  private getHeadThreeQuat(gpsTime: number): THREE.Quaternion | null {
    if (this.sensorData.length === 0) return null

    const sensorTime = gpsTime + this.timeOffset
    const { index, fraction } = findHeadIndex(this.sensorData, sensorTime)
    const pt = this.sensorData[index]

    let qw: number, qx: number, qy: number, qz: number

    if (fraction > 0 && index < this.sensorData.length - 1) {
      const pt2 = this.sensorData[index + 1]
      // Slerp in NWU space before remapping
      const q1 = new THREE.Quaternion(pt.qx, pt.qy, pt.qz, pt.qw)
      const q2 = new THREE.Quaternion(pt2.qx, pt2.qy, pt2.qz, pt2.qw)
      if (q1.dot(q2) < 0) q2.set(-q2.x, -q2.y, -q2.z, -q2.w)
      q1.slerp(q2, fraction)
      qx = q1.x; qy = q1.y; qz = q1.z; qw = q1.w
    } else {
      qx = pt.qx; qy = pt.qy; qz = pt.qz; qw = pt.qw
    }

    // Apply sensor mount pitch offset: sensor tilted ~10° skyward on helmet
    // Post-multiply body-frame correction: q_corrected = q_nwu × q_mountOffset
    // Mount offset is rotation about NWU Y-axis (pitch)
    const mountRad = MOUNT_PITCH_DEG * Math.PI / 180
    const halfMount = mountRad / 2
    // q_mount = (0, sin(half), 0, cos(half)) — rotation about Y in NWU
    const msin = Math.sin(halfMount), mcos = Math.cos(halfMount)
    // Hamilton product: q × q_mount
    const cw = qw * mcos - qy * msin
    const cx = qx * mcos + qz * msin
    const cy = qy * mcos + qw * msin
    const cz = qz * mcos - qx * msin

    // NWU→Three.js remap (direct from fusion viewer): set(-qy, qz, -qx, qw)
    return new THREE.Quaternion(-cy, cz, -cx, cw)
  }

  /**
   * Update head position and orientation for current GPS time.
   *
   * Direct transform approach:
   *   - Position: wingsuit world pos + neck offset rotated by wingsuit world quat
   *   - Rotation: head inertial quat directly (no parent inversion)
   *
   * @param gpsTime - current time in GPS pipeline (seconds from GPS start)
   * @param wingsuitWorldPos - wingsuit model's world position
   * @param wingsuitWorldQuat - wingsuit model's world quaternion
   * @param modelScale - wingsuit model scale (for neck offset)
   * @param bodyToInertial - if provided, head quat is made relative: bodyToInertial⁻¹ × headInertial
   *   Use this in body-frame scenes where the model is at identity orientation.
   */
  update(gpsTime: number, wingsuitWorldPos: THREE.Vector3, wingsuitWorldQuat: THREE.Quaternion, modelScale: number, bodyToInertial?: THREE.Quaternion) {
    if (!this.loaded || !this.visible || this.sensorData.length === 0) return

    let headQuat = this.getHeadThreeQuat(gpsTime)
    if (!headQuat) return

    // If body-to-inertial provided, compute relative rotation for body-frame view
    if (bodyToInertial) {
      const inv = bodyToInertial.clone().invert()
      headQuat = inv.multiply(headQuat)
    }

    // Ensure quaternion hemisphere consistency frame-to-frame
    if (this.lastHeadQuat && this.lastHeadQuat.dot(headQuat) < 0) {
      headQuat.set(-headQuat.x, -headQuat.y, -headQuat.z, -headQuat.w)
    }
    this.lastHeadQuat = headQuat.clone()

    // Position: wingsuit world pos + neck offset rotated by wingsuit world quat
    const scaledNeckOffset = NECK_OFFSET.clone().multiplyScalar(modelScale)
    const rotatedOffset = scaledNeckOffset.applyQuaternion(wingsuitWorldQuat)
    this.headGroup.position.copy(wingsuitWorldPos).add(rotatedOffset)

    // Rotation: direct (inertial) or relative (body frame)
    this.headGroup.quaternion.copy(headQuat)

    // Scale to match wingsuit model
    this.headGroup.scale.setScalar(modelScale)

    // Update sensor vectors
    const sensorTime = gpsTime + this.timeOffset
    const { index, fraction } = findHeadIndex(this.sensorData, sensorTime)
    const pt = this.sensorData[index]
    if (this.sensorOverlay) {
      if (fraction > 0 && index < this.sensorData.length - 1) {
        const pt2 = this.sensorData[index + 1]
        this.sensorOverlay.update(lerpSensorPoints(pt, pt2, fraction))
      } else {
        this.sensorOverlay.update(pt)
      }
    }
  }

  dispose() {
    this.sceneRoot.remove(this.headGroup)
  }
}
