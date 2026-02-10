/**
 * Curved arrow for visualizing angular velocity / rotational moments.
 * 
 * Creates an arc around an axis (X, Y, or Z) with a cone arrowhead
 * indicating rotation direction. Uses TubeGeometry + MeshPhongMaterial
 * for consistent shading with the rest of the scene.
 * 
 * Usage:
 *   const arrow = new CurvedArrow('x', 0xff4444)
 *   scene.add(arrow)
 *   arrow.setAngle(1.2)  // 1.2 radians of arc
 */

import * as THREE from 'three'

export interface CurvedArrowOptions {
  /** Radius of the arc from the axis */
  radius?: number
  /** Number of segments in the arc (smoothness) */
  segments?: number
  /** Size of the arrowhead cone */
  headLength?: number
  /** Radius of the arrowhead cone base */
  headRadius?: number
  /** Thickness of the arc tube */
  tubeRadius?: number
  /** Specular highlight color */
  specular?: number
  /** Shininess (0–100) */
  shininess?: number
}

const DEFAULTS: Required<CurvedArrowOptions> = {
  radius: 0.8,
  segments: 32,
  headLength: 0.15,
  headRadius: 0.06,
  tubeRadius: 0.02,
  specular: 0x444444,
  shininess: 30
}

/** Custom THREE.Curve that traces an arc in the plane perpendicular to an axis. */
class ArcCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private axis: 'x' | 'y' | 'z',
    private arcRadius: number,
    private startAngle: number,
    private endAngle: number
  ) {
    super()
  }

  getPoint(t: number): THREE.Vector3 {
    const theta = this.startAngle + t * (this.endAngle - this.startAngle)
    switch (this.axis) {
      case 'x': return new THREE.Vector3(0, this.arcRadius * Math.cos(theta), this.arcRadius * Math.sin(theta))
      case 'y': return new THREE.Vector3(this.arcRadius * Math.sin(theta), 0, this.arcRadius * Math.cos(theta))
      case 'z': return new THREE.Vector3(this.arcRadius * Math.cos(theta), this.arcRadius * Math.sin(theta), 0)
    }
  }
}

/**
 * Reusable curved arrow group.
 * 
 * Call `setAngle()` each frame to update the arc sweep.
 * The arrow is rebuilt only when the angle actually changes
 * (rotational moments don't change as frequently as force vectors).
 */
export class CurvedArrow extends THREE.Group {
  private material: THREE.MeshPhongMaterial
  private opts: Required<CurvedArrowOptions>
  private axis: 'x' | 'y' | 'z'
  private currentAngle = 0

  constructor(axis: 'x' | 'y' | 'z', color: number, name: string, options: CurvedArrowOptions = {}) {
    super()
    this.name = name
    this.axis = axis
    this.opts = { ...DEFAULTS, ...options }
    this.material = new THREE.MeshPhongMaterial({
      color,
      specular: this.opts.specular,
      shininess: this.opts.shininess
    })
  }

  /**
   * Set the arc sweep angle in radians.
   * Positive = CCW when looking down the axis toward the origin.
   * Rebuilds geometry only when angle changes by > 0.01 rad.
   */
  setAngle(angle: number): void {
    // Skip tiny updates
    if (Math.abs(angle - this.currentAngle) < 0.01) return
    this.currentAngle = angle

    // Clear previous geometry
    this.disposeChildren()

    if (Math.abs(angle) < 0.01) {
      this.visible = false
      return
    }
    this.visible = true

    // Clamp
    const maxAngle = Math.PI * 1.5
    const clamped = Math.sign(angle) * Math.min(Math.abs(angle), maxAngle)

    // Arc tube
    const curve = new ArcCurve(this.axis, this.opts.radius, 0, clamped)
    const tubeGeo = new THREE.TubeGeometry(curve, this.opts.segments, this.opts.tubeRadius, 8, false)
    const tube = new THREE.Mesh(tubeGeo, this.material)
    this.add(tube)

    // Arrowhead cone at the end of the arc
    const coneGeo = new THREE.ConeGeometry(this.opts.headRadius, this.opts.headLength, 8)
    const cone = new THREE.Mesh(coneGeo, this.material)
    const endPoint = curve.getPoint(1)
    cone.position.copy(endPoint)

    // Orient cone tangent to the arc
    const tangent = this.getTangent(clamped)
    const up = new THREE.Vector3(0, 1, 0)
    const q = new THREE.Quaternion().setFromUnitVectors(up, tangent)
    cone.setRotationFromQuaternion(q)
    this.add(cone)
  }

  /** Change color at runtime */
  setColor(color: THREE.ColorRepresentation): void {
    this.material.color.set(color)
  }

  /** Dispose all GPU resources */
  dispose(): void {
    this.disposeChildren()
    this.material.dispose()
  }

  // ── internals ──

  private disposeChildren(): void {
    while (this.children.length > 0) {
      const child = this.children[0]
      this.remove(child)
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
      }
    }
  }

  private getTangent(angle: number): THREE.Vector3 {
    const theta = angle
    let t: THREE.Vector3
    switch (this.axis) {
      case 'x': t = new THREE.Vector3(0, -Math.sin(theta), Math.cos(theta)); break
      case 'y': t = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta)); break
      case 'z': t = new THREE.Vector3(-Math.sin(theta), Math.cos(theta), 0); break
    }
    return t.normalize().multiplyScalar(Math.sign(angle))
  }
}
