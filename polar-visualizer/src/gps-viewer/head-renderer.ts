/**
 * Head Model Renderer — Loads the head GLB and orients it from sensor fusion data
 *
 * Architecture:
 *   headGroup lives as a sibling in the scene (not a child of the wingsuit model).
 *   Each frame we compute:
 *     - Head world position = wingsuit world position + neck offset rotated by wingsuit quat
 *     - headGroup world quaternion = sensor orientation (directly from sensor data)
 *
 * Fused CSV quaternions are NWU body-to-earth (scalar-first: qw, qx, qy, qz) and
 * act on the remapped sensor vector A = [s_z, s_x, s_y]:
 *   v_earth = R(q) · [s_z, s_x, s_y]
 * The GPS scenes map NWU → Three.js world as (x=West, y=Up, z=North), so the
 * Three.js quaternion is (qy, qz, qx, qw). With that remap, headGroup's local
 * axes are exactly the raw sensor axes (x, y, z).
 *
 * The head GLB contains the FlySight device with its sensor axis arrows along
 * GLB (-X, +Y, -Z) — i.e. the sensor is mounted on the back of the helmet with
 * x=right, y=up, z=back. A 180° turn about Y aligns those arrows with headGroup's
 * sensor axes; the mount pitch then accounts for the sloped helmet back.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { HeadSensorPoint } from './head-sensor'
import { findHeadIndex, lerpSensorPoints } from './head-sensor'
import { HeadSensorOverlay } from './head-sensor-overlay'
import type { CameraSensorPoint, CameraMountOffset } from './camera-sensor'
import { findCameraIndex, DEFAULT_MOUNT_OFFSET } from './camera-sensor'

const HEAD_MODEL_PATH = '/models/headfs.glb'

// Neck attachment point in model-local coordinates
// wingsuit GLB: Z-forward, Y-up (Y = dorsal/back side) in Three.js model space.
// y = 0.06 is the centre of the WSV9nohead neck stub opening (cut at z ≈ 0.63).
const NECK_OFFSET = new THREE.Vector3(0, 0.06, 0.62)  // (right, up, forward) in model space
const HEAD_SCALE = 0.1

// Sensor mount pitch: the FlySight sits on the sloped back of the helmet, so
// its forward axis (-z) points below the head's forward direction. The head
// mesh is pitched nose-up by this angle relative to the sensor frame
// (body-frame correction).
// Calibrated 2026-11-05 from a static "eyes on the horizon" recording: the
// device is physically tilted 34° (gravity in sensor axes ≈ [-0.05, 0.84, 0.56]),
// but the headfs.glb head mesh is modelled ~14° nose-up relative to its device,
// so 20° renders that recording with a level head.
const MOUNT_PITCH_DEG = 20

const _Y = new THREE.Vector3(0, 1, 0)
const _X = new THREE.Vector3(1, 0, 0)
// Head mesh orientation within headGroup (sensor frame): align GLB device
// arrows with the sensor axes, then apply the mount pitch about the head's
// lateral (GLB X) axis. Negative X rotation lifts GLB +Z (face) toward +Y (up).
const HEAD_MODEL_QUAT = new THREE.Quaternion().setFromAxisAngle(_Y, Math.PI)
  .multiply(new THREE.Quaternion().setFromAxisAngle(_X, -MOUNT_PITCH_DEG * Math.PI / 180))

// Camera-driven head orientation was tuned against the old model rotation
// Euler(π/5, 0, π). Right-multiplying by old·new⁻¹ keeps that path's on-screen
// result unchanged until camera data is revisited.
const LEGACY_HEAD_MODEL_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 5, 0, Math.PI))
const CAMERA_LEGACY_CORRECTION = LEGACY_HEAD_MODEL_QUAT.clone().multiply(HEAD_MODEL_QUAT.clone().invert())

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

  // Camera head position data (alternative orientation source)
  private cameraData: CameraSensorPoint[] = []
  private cameraMountOffset: CameraMountOffset = { ...DEFAULT_MOUNT_OFFSET }

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
      this.headModel.quaternion.copy(HEAD_MODEL_QUAT)
      this.headGroup.add(this.headModel)
      // Create sensor vector overlay in headGroup (moves with head)
      this.sensorOverlay = new HeadSensorOverlay(this.headGroup)
      const deviceOrigin = this.findDeviceOrigin()
      if (deviceOrigin) this.sensorOverlay.setOrigin(deviceOrigin)
      this.loaded = true
      // Show head if sensor data already loaded, otherwise hide
      this.headGroup.visible = this.hasAnyData
      console.log(`Head model loaded (${this.hasAnyData ? 'visible — data present' : 'hidden until data loaded'})`)
    } catch (e) {
      console.error('Failed to load head model:', e)
    }
  }

  /** FlySight device centre in headGroup local coords, so sensor arrows originate at the device. */
  private findDeviceOrigin(): THREE.Vector3 | null {
    const device = this.headModel?.getObjectByName('FlySight_Device')
    if (!device) return null
    this.headGroup.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(device)
    if (box.isEmpty()) return null
    return this.headGroup.worldToLocal(box.getCenter(new THREE.Vector3()))
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

  /** Returns true if camera head position data has been loaded */
  get hasCameraData(): boolean {
    return this.cameraData.length > 0
  }

  /** Returns true if any orientation source is available */
  get hasAnyData(): boolean {
    return this.hasSensorData || this.hasCameraData
  }

  setCameraData(data: CameraSensorPoint[]) {
    this.cameraData = data
    // Show head model if we have data from either source
    this.headGroup.visible = this.hasAnyData
    console.log(`Camera head data: ${data.length} points, ${data[0]?.pipelineTimeS.toFixed(1)}s → ${data[data.length - 1]?.pipelineTimeS.toFixed(1)}s`)
  }

  setCameraMountOffset(offset: CameraMountOffset) {
    this.cameraMountOffset = { ...offset }
  }

  /**
   * Convert camera quaternion from Gyroflow to Three.js world quaternion.
   *
   * Gyroflow org_quat convention: best-guess is gravity-aligned earth frame.
   * We apply the same NWU→Three.js remap as the fused sensor initially,
   * then apply the camera mount offset (heading/pitch/roll) to compensate
   * for selfie stick mounting angle.
   *
   * The mount offset is applied as a post-multiplication in camera body frame:
   *   head_quat = camera_quat × inverse(mount_rotation)
   */
  private getCameraHeadThreeQuat(gpsTime: number): THREE.Quaternion | null {
    if (this.cameraData.length === 0) return null

    const { index, fraction } = findCameraIndex(this.cameraData, gpsTime)
    const pt = this.cameraData[index]

    let qw: number, qx: number, qy: number, qz: number

    if (fraction > 0 && index < this.cameraData.length - 1) {
      const pt2 = this.cameraData[index + 1]
      const q1 = new THREE.Quaternion(pt.qx, pt.qy, pt.qz, pt.qw)
      const q2 = new THREE.Quaternion(pt2.qx, pt2.qy, pt2.qz, pt2.qw)
      if (q1.dot(q2) < 0) q2.set(-q2.x, -q2.y, -q2.z, -q2.w)
      q1.slerp(q2, fraction)
      qx = q1.x; qy = q1.y; qz = q1.z; qw = q1.w
    } else {
      qx = pt.qx; qy = pt.qy; qz = pt.qz; qw = pt.qw
    }

    // Apply camera mount offset as body-frame post-rotation
    // mount_quat = Euler(heading, pitch, roll) in ZYX order
    // head_quat = camera_quat × inverse(mount_quat)
    const d2r = Math.PI / 180
    const mountQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        this.cameraMountOffset.pitchDeg * d2r,
        this.cameraMountOffset.headingDeg * d2r,
        this.cameraMountOffset.rollDeg * d2r,
        'ZYX',
      ),
    )
    // Hamilton product: camera_quat × inverse(mount_quat)
    const invMount = mountQuat.invert()
    const corrected = new THREE.Quaternion(qx, qy, qz, qw).multiply(invMount)

    // Remap to Three.js — using same NWU→Three.js as the legacy fused-sensor path,
    // plus CAMERA_LEGACY_CORRECTION so the result matches the pre-fix appearance.
    // This may need adjustment once we verify the Gyroflow convention empirically
    return new THREE.Quaternion(-corrected.y, corrected.z, -corrected.x, corrected.w)
      .multiply(CAMERA_LEGACY_CORRECTION)
  }

  /**
   * Facing direction (heading) of the head in NED radians at a given GPS time,
   * i.e. the horizontal direction the face points when the head is level.
   * Derived from the ear-to-ear axis (forward = left × up), which stays
   * horizontal while nodding, so it is well defined when looking straight
   * down — unlike the CSV Euler yaw, which flips 180° once the sensor's
   * reference axis passes vertical. Returns null if there is no sensor data or
   * the head is rolled nearly 90°.
   */
  getHeadingAtTime(gpsTime: number): number | null {
    const q = this.getHeadThreeQuat(gpsTime)
    if (!q) return null
    q.multiply(HEAD_MODEL_QUAT)
    // Head GLB: +Y up, +Z face, so +X is the head's left
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(q)
    const fwd = left.cross(_Y)
    if (fwd.lengthSq() < 0.04) return null
    // Three.js world: x = West, z = North → NED heading = atan2(East, North)
    return Math.atan2(-fwd.x, fwd.z)
  }

  setVisible(v: boolean) {
    this.visible = v
    this.headGroup.visible = v
  }

  /**
   * Convert the NWU body-to-earth quaternion from the fused CSV to the sensor's
   * Three.js world quaternion. NWU (x=N, y=W, z=U) → world (x=W, y=U, z=N) is a
   * cyclic axis permutation, so the quaternion becomes (qy, qz, qx, qw).
   * The mount correction lives on the head mesh (HEAD_MODEL_QUAT), not here.
   */
  private getHeadThreeQuat(gpsTime: number): THREE.Quaternion | null {
    if (this.sensorData.length === 0) return null

    const sensorTime = gpsTime + this.timeOffset
    const { index, fraction } = findHeadIndex(this.sensorData, sensorTime)
    const pt = this.sensorData[index]

    const q = new THREE.Quaternion(pt.qx, pt.qy, pt.qz, pt.qw)
    if (fraction > 0 && index < this.sensorData.length - 1) {
      const pt2 = this.sensorData[index + 1]
      // Slerp in NWU space before remapping
      const q2 = new THREE.Quaternion(pt2.qx, pt2.qy, pt2.qz, pt2.qw)
      if (q.dot(q2) < 0) q2.set(-q2.x, -q2.y, -q2.z, -q2.w)
      q.slerp(q2, fraction)
    }

    return new THREE.Quaternion(q.y, q.z, q.x, q.w)
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
    if (!this.loaded || !this.visible || !this.hasAnyData) return

    // Camera data takes priority for head model orientation
    let headQuat = this.cameraData.length > 0
      ? this.getCameraHeadThreeQuat(gpsTime)
      : this.getHeadThreeQuat(gpsTime)
    if (!headQuat) return
    const headWorldQuat = headQuat.clone()

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
    if (this.sensorOverlay && pt) {
      if (fraction > 0 && index < this.sensorData.length - 1) {
        const pt2 = this.sensorData[index + 1]
        this.sensorOverlay.update(lerpSensorPoints(pt, pt2, fraction), headWorldQuat)
      } else {
        this.sensorOverlay.update(pt, headWorldQuat)
      }
    }
  }

  dispose() {
    this.sceneRoot.remove(this.headGroup)
  }
}
