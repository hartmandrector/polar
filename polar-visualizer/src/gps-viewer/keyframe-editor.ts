/**
 * Keyframe Editor — Camera position/zoom keyframes for inertial & body frame scenes
 * 
 * Keyframe types:
 *   - inertial: camera position (x,y,z) + zoom for inertial frame scene
 *   - body: camera position (x,y,z) + zoom for body frame scene
 *   - wind: direction, inclination, speed (future)
 * 
 * Interpolation: spherical for camera position (orbit), linear for zoom.
 * Angle-aware: handles wraparound for azimuth/polar angles.
 * 
 * Storage: JSON file with GPS-aligned timestamps.
 * Playback: 60fps interpolation between keyframes.
 */

import * as THREE from 'three'

// ============================================================================
// Types
// ============================================================================

export interface CameraKeyframe {
  /** GPS pipeline time (seconds from start) */
  t: number
  /** Camera position in scene coordinates */
  position: [number, number, number]
  /** Camera zoom (PerspectiveCamera.zoom) */
  zoom: number
}

export interface KeyframeSet {
  /** Version for future-proofing */
  version: 1
  /** Keyframes for inertial frame camera */
  inertial: CameraKeyframe[]
  /** Keyframes for body frame camera */
  body: CameraKeyframe[]
  /** Capture range markers (GPS pipeline time in seconds) */
  captureStart: number | null
  captureEnd: number | null
}

// ============================================================================
// Interpolation
// ============================================================================

/**
 * Interpolate camera state between keyframes at time t.
 * Uses spherical interpolation for position (preserves orbit radius smoothly)
 * and linear interpolation for zoom.
 * Returns null if no keyframes or t is outside range.
 */
export function interpolateCamera(
  keyframes: CameraKeyframe[],
  t: number
): { position: THREE.Vector3; zoom: number } | null {
  if (keyframes.length === 0) return null
  if (keyframes.length === 1) {
    const kf = keyframes[0]
    return { position: new THREE.Vector3(...kf.position), zoom: kf.zoom }
  }

  // Clamp to keyframe range
  if (t <= keyframes[0].t) {
    const kf = keyframes[0]
    return { position: new THREE.Vector3(...kf.position), zoom: kf.zoom }
  }
  if (t >= keyframes[keyframes.length - 1].t) {
    const kf = keyframes[keyframes.length - 1]
    return { position: new THREE.Vector3(...kf.position), zoom: kf.zoom }
  }

  // Find bracketing keyframes
  let lo = 0
  for (let i = 1; i < keyframes.length; i++) {
    if (keyframes[i].t >= t) { lo = i - 1; break }
  }
  const a = keyframes[lo]
  const b = keyframes[lo + 1]
  const dt = b.t - a.t
  const frac = dt > 0 ? (t - a.t) / dt : 0

  // Smoothstep for nicer transitions
  const s = frac * frac * (3 - 2 * frac)

  // Spherical interpolation for position (orbit-aware)
  const posA = new THREE.Vector3(...a.position)
  const posB = new THREE.Vector3(...b.position)

  // Convert to spherical, interpolate, convert back
  const sphA = new THREE.Spherical().setFromVector3(posA)
  const sphB = new THREE.Spherical().setFromVector3(posB)

  // Handle azimuth wraparound (theta in Three.js Spherical)
  let dTheta = sphB.theta - sphA.theta
  if (dTheta > Math.PI) dTheta -= 2 * Math.PI
  if (dTheta < -Math.PI) dTheta += 2 * Math.PI

  const radius = sphA.radius + (sphB.radius - sphA.radius) * s
  const phi = sphA.phi + (sphB.phi - sphA.phi) * s
  const theta = sphA.theta + dTheta * s

  const pos = new THREE.Vector3().setFromSpherical(
    new THREE.Spherical(radius, phi, theta)
  )

  // Linear zoom interpolation
  const zoom = a.zoom + (b.zoom - a.zoom) * s

  return { position: pos, zoom }
}

// ============================================================================
// KeyframeEditor class
// ============================================================================

export class KeyframeEditor {
  private data: KeyframeSet = { version: 1, inertial: [], body: [], captureStart: null, captureEnd: null }
  private enabled = false

  // Callbacks for UI updates
  private onChangeCallbacks: (() => void)[] = []

  get isEnabled() { return this.enabled }
  setEnabled(v: boolean) { this.enabled = v }

  get inertialKeyframes(): readonly CameraKeyframe[] { return this.data.inertial }
  get bodyKeyframes(): readonly CameraKeyframe[] { return this.data.body }

  onChange(cb: () => void) { this.onChangeCallbacks.push(cb) }
  private notify() { this.onChangeCallbacks.forEach(cb => cb()) }

  // ── Add / Update ──

  addInertialKeyframe(t: number, position: THREE.Vector3, zoom: number) {
    this.upsertKeyframe(this.data.inertial, t, position, zoom)
    this.notify()
  }

  addBodyKeyframe(t: number, position: THREE.Vector3, zoom: number) {
    this.upsertKeyframe(this.data.body, t, position, zoom)
    this.notify()
  }

  /** Update an existing keyframe by index (for popup editor). Does not re-sort. */
  updateInertialKeyframe(index: number, position: THREE.Vector3, zoom: number) {
    if (index >= 0 && index < this.data.inertial.length) {
      const kf = this.data.inertial[index]
      this.data.inertial[index] = { t: kf.t, position: [position.x, position.y, position.z], zoom }
      this.notify()
    }
  }

  updateBodyKeyframe(index: number, position: THREE.Vector3, zoom: number) {
    if (index >= 0 && index < this.data.body.length) {
      const kf = this.data.body[index]
      this.data.body[index] = { t: kf.t, position: [position.x, position.y, position.z], zoom }
      this.notify()
    }
  }

  private upsertKeyframe(arr: CameraKeyframe[], t: number, position: THREE.Vector3, zoom: number) {
    const SNAP_THRESHOLD = 0.05 // snap to existing keyframe within 50ms
    const existing = arr.findIndex(kf => Math.abs(kf.t - t) < SNAP_THRESHOLD)
    const kf: CameraKeyframe = {
      t: existing >= 0 ? arr[existing].t : t,
      position: [position.x, position.y, position.z],
      zoom,
    }
    if (existing >= 0) {
      arr[existing] = kf
    } else {
      arr.push(kf)
      arr.sort((a, b) => a.t - b.t)
    }
  }

  // ── Delete ──

  deleteInertialKeyframe(index: number) {
    if (index >= 0 && index < this.data.inertial.length) {
      this.data.inertial.splice(index, 1)
      this.notify()
    }
  }

  deleteBodyKeyframe(index: number) {
    if (index >= 0 && index < this.data.body.length) {
      this.data.body.splice(index, 1)
      this.notify()
    }
  }

  // ── Find nearest keyframe to a time ──

  findNearest(arr: readonly CameraKeyframe[], t: number): { index: number; distance: number } | null {
    if (arr.length === 0) return null
    let best = 0
    let bestDist = Math.abs(arr[0].t - t)
    for (let i = 1; i < arr.length; i++) {
      const d = Math.abs(arr[i].t - t)
      if (d < bestDist) { best = i; bestDist = d }
    }
    return { index: best, distance: bestDist }
  }

  // ── Interpolate at time ──

  getInertialCamera(t: number) { return interpolateCamera(this.data.inertial, t) }
  getBodyCamera(t: number) { return interpolateCamera(this.data.body, t) }

  // ── Capture range ──

  get captureStart(): number | null { return this.data.captureStart }
  get captureEnd(): number | null { return this.data.captureEnd }

  setCaptureStart(t: number | null) {
    this.data.captureStart = t
    this.notify()
  }

  setCaptureEnd(t: number | null) {
    this.data.captureEnd = t
    this.notify()
  }

  // ── Save / Load ──

  toJSON(): string {
    return JSON.stringify(this.data, null, 2)
  }

  fromJSON(json: string): boolean {
    try {
      const parsed = JSON.parse(json)
      if (parsed.version !== 1) {
        console.warn('Unknown keyframe version:', parsed.version)
        return false
      }
      this.data = {
        version: 1,
        inertial: Array.isArray(parsed.inertial) ? parsed.inertial : [],
        body: Array.isArray(parsed.body) ? parsed.body : [],
        captureStart: parsed.captureStart ?? null,
        captureEnd: parsed.captureEnd ?? null,
      }
      this.notify()
      return true
    } catch (e) {
      console.error('Failed to parse keyframe JSON:', e)
      return false
    }
  }

  clear() {
    this.data = { version: 1, inertial: [], body: [], captureStart: null, captureEnd: null }
    this.notify()
  }

  /** Download keyframes as JSON file */
  save(filename = 'keyframes.json') {
    const blob = new Blob([this.toJSON()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
}
