/**
 * Shaded arrow — MeshPhongMaterial for proper lighting/shadows.
 * 
 * Unlike THREE.ArrowHelper (which uses LineBasicMaterial for the shaft),
 * this uses CylinderGeometry + ConeGeometry with MeshPhongMaterial
 * so the vectors respond to scene lighting.
 * 
 * The arrow is built once along +Y and then rotated/scaled via
 * setDirection() and setLength() each frame without rebuilding geometry.
 */

import * as THREE from 'three'

export interface ShadedArrowOptions {
  shaftRadius?: number
  headLength?: number
  headRadius?: number
  segments?: number
  specular?: number
  shininess?: number
}

const DEFAULTS: Required<ShadedArrowOptions> = {
  shaftRadius: 0.02,
  headLength: 0.15,
  headRadius: 0.06,
  segments: 12,
  specular: 0x444444,
  shininess: 30
}

/**
 * A reusable shaded arrow that can update direction & length per-frame
 * without rebuilding geometry.
 * 
 * Internal layout (along local +Y):
 *   shaft: unit cylinder scaled in Y for length
 *   head:  cone translated to tip of shaft
 */
export class ShadedArrow extends THREE.Group {
  private shaft: THREE.Mesh
  private head: THREE.Mesh
  private material: THREE.MeshPhongMaterial
  private opts: Required<ShadedArrowOptions>

  constructor(color: number, name: string, options: ShadedArrowOptions = {}) {
    super()
    this.name = name
    this.opts = { ...DEFAULTS, ...options }

    this.material = new THREE.MeshPhongMaterial({
      color,
      specular: this.opts.specular,
      shininess: this.opts.shininess
    })

    // Shaft: unit height cylinder (0→1 along +Y by translating after creation)
    const shaftGeo = new THREE.CylinderGeometry(
      this.opts.shaftRadius,
      this.opts.shaftRadius,
      1, // unit height — scaled at runtime
      this.opts.segments
    )
    this.shaft = new THREE.Mesh(shaftGeo, this.material)
    this.add(this.shaft)

    // Head: cone
    const headGeo = new THREE.ConeGeometry(
      this.opts.headRadius,
      this.opts.headLength,
      this.opts.segments
    )
    this.head = new THREE.Mesh(headGeo, this.material)
    this.add(this.head)
  }

  /** Set origin position */
  setOrigin(origin: THREE.Vector3): void {
    this.position.copy(origin)
  }

  /** Point the arrow along `dir` (will be normalized). */
  setDirection(dir: THREE.Vector3): void {
    if (dir.lengthSq() < 1e-10) return
    const d = dir.clone().normalize()
    const up = new THREE.Vector3(0, 1, 0)
    const q = new THREE.Quaternion().setFromUnitVectors(up, d)
    this.quaternion.copy(q)
  }

  /**
   * Set total length of the arrow (shaft + head).
   * Head length is clamped to at most 30% of total length.
   */
  setLength(totalLength: number): void {
    const len = Math.max(0.001, totalLength)
    const headLen = Math.min(this.opts.headLength, len * 0.3)
    const shaftLen = len - headLen

    // Scale shaft to desired length, center it along +Y
    this.shaft.scale.set(1, shaftLen, 1)
    this.shaft.position.set(0, shaftLen / 2, 0)

    // Position head at tip of shaft
    this.head.scale.set(1, headLen / this.opts.headLength, 1)
    this.head.position.set(0, shaftLen + headLen / 2, 0)
  }

  /** Change color at runtime */
  setColor(color: THREE.ColorRepresentation): void {
    this.material.color.set(color)
  }

  /** Clean up GPU resources */
  dispose(): void {
    this.shaft.geometry.dispose()
    this.head.geometry.dispose()
    this.material.dispose()
  }
}
