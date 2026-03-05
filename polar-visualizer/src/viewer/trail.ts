/**
 * Flight trail renderer — ring buffer of past positions rendered as a fading line.
 *
 * The 3D model stays at the scene origin. Trail points are stored in NED Earth
 * meters. Instead of recomputing every vertex each frame, we translate the
 * entire line object to keep the newest point at the origin.
 *
 * Call `reset()` when starting a new sim or switching vehicles.
 * Call `update()` each frame with current NED position.
 */

import * as THREE from 'three'
import { nedToThreeJS } from './frames.ts'

// ─── Configuration ───────────────────────────────────────────────────────────

const MAX_POINTS = 400           // ring buffer capacity
const MIN_DISTANCE_SQ = 0.25    // minimum squared meters between trail points
const TRAIL_COLOR = new THREE.Color(0.3, 0.7, 1.0)  // light blue
const SCENE_SCALE = 0.5         // meters → scene units

// ─── Trail Renderer ──────────────────────────────────────────────────────────

export class TrailRenderer {
  private positions: Float32Array
  private colors: Float32Array
  private geometry: THREE.BufferGeometry
  private line: THREE.Line
  private count = 0
  private lastNED = { x: NaN, y: NaN, z: NaN }
  private originNED = { x: 0, y: 0, z: 0 }  // first point becomes world origin
  private originSet = false

  constructor(private scene: THREE.Scene) {
    this.positions = new Float32Array(MAX_POINTS * 3)
    this.colors = new Float32Array(MAX_POINTS * 4)

    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4))
    this.geometry.setDrawRange(0, 0)

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    })

    this.line = new THREE.Line(this.geometry, material)
    this.line.frustumCulled = false
    this.scene.add(this.line)
  }

  /** Add a new position (NED Earth frame, meters). */
  update(ned: { x: number; y: number; z: number }): void {
    // Set origin on first point
    if (!this.originSet) {
      this.originNED = { x: ned.x, y: ned.y, z: ned.z }
      this.originSet = true
    }

    // Skip if too close to last point
    if (!isNaN(this.lastNED.x)) {
      const dx = ned.x - this.lastNED.x
      const dy = ned.y - this.lastNED.y
      const dz = ned.z - this.lastNED.z
      if (dx * dx + dy * dy + dz * dz < MIN_DISTANCE_SQ) return
    }
    this.lastNED = { x: ned.x, y: ned.y, z: ned.z }

    // Shift buffer if full
    if (this.count >= MAX_POINTS) {
      this.positions.copyWithin(0, 3)
      this.colors.copyWithin(0, 4)
      this.count = MAX_POINTS - 1
    }

    // Write new point relative to origin (fixed, not moving)
    const rel = {
      x: ned.x - this.originNED.x,
      y: ned.y - this.originNED.y,
      z: ned.z - this.originNED.z,
    }
    const p = nedToThreeJS(rel)
    const i = this.count * 3
    this.positions[i] = p.x * SCENE_SCALE
    this.positions[i + 1] = p.y * SCENE_SCALE
    this.positions[i + 2] = p.z * SCENE_SCALE
    this.count++

    // Update colors only for new point + refresh fade
    this.updateColors()

    // Translate entire line so newest point sits at scene origin
    const newest = new THREE.Vector3(
      this.positions[(this.count - 1) * 3],
      this.positions[(this.count - 1) * 3 + 1],
      this.positions[(this.count - 1) * 3 + 2],
    )
    this.line.position.set(-newest.x, -newest.y, -newest.z)

    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute
    posAttr.needsUpdate = true
    this.geometry.setDrawRange(0, this.count)
  }

  /** Refresh vertex colors — only recomputes alpha fade. */
  private updateColors(): void {
    const n = this.count
    for (let j = 0; j < n; j++) {
      const t = n > 1 ? j / (n - 1) : 1
      const ci = j * 4
      this.colors[ci] = TRAIL_COLOR.r
      this.colors[ci + 1] = TRAIL_COLOR.g
      this.colors[ci + 2] = TRAIL_COLOR.b
      this.colors[ci + 3] = t * t  // quadratic fade
    }
    const colAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute
    colAttr.needsUpdate = true
  }

  reset(): void {
    this.count = 0
    this.lastNED = { x: NaN, y: NaN, z: NaN }
    this.originSet = false
    this.line.position.set(0, 0, 0)
    this.geometry.setDrawRange(0, 0)
  }

  dispose(): void {
    this.scene.remove(this.line)
    this.geometry.dispose()
    ;(this.line.material as THREE.Material).dispose()
  }

  get length(): number { return this.count }

  set visible(v: boolean) { this.line.visible = v }
  get visible(): boolean { return this.line.visible }
}
