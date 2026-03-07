/**
 * Deployment chain renderer.
 *
 * Takes WingsuitDeployRenderState (body-relative NED meters) and
 * updates Three.js objects in the scene. Manages segment meshes,
 * bridle chain lines, canopy bag, and PC visualization.
 *
 * No physics imports — purely visual.
 */

import * as THREE from 'three'
import type { WingsuitDeployRenderState, Vec3 } from '../sim/deploy-types.ts'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Bridle chain line color */
const BRIDLE_COLOR = 0xff6600

/** Segment sphere color (freed) */
const SEGMENT_COLOR = 0xffaa00

/** Segment sphere radius in scene units */
const SEGMENT_RADIUS = 0.015

/** Canopy bag color (blue tint for packed fabric) */
const BAG_COLOR = 0x4488cc

/** Canopy bag size in scene units */
const BAG_SIZE = 0.08

// ─── NED → Three.js Conversion ─────────────────────────────────────────────

/**
 * Convert NED body-relative meters to Three.js scene units.
 * Three.js: X = -ned.Y (west), Y = -ned.Z (up), Z = ned.X (north/forward)
 *
 * @param ned Position in NED meters (body-relative)
 * @param scale Meters-to-scene conversion factor (bodyLength / 1.875)
 */
function nedToThree(ned: Vec3, scale: number): THREE.Vector3 {
  return new THREE.Vector3(
    -ned.y * scale,
    -ned.z * scale,
     ned.x * scale,
  )
}

// ─── Deploy Renderer ────────────────────────────────────────────────────────

export class DeployRenderer {
  private scene: THREE.Scene
  private group: THREE.Group

  /** Segment joint spheres */
  private segmentMeshes: THREE.Mesh[] = []
  /** Chain line connecting all visible points */
  private chainLine: THREE.Line
  /** Canopy bag mesh */
  private bagMesh: THREE.Mesh
  /** PC highlight ring (tension indicator) */
  private pcRing: THREE.Mesh

  /** Meters-to-scene scale factor */
  private metersToScene: number

  /** Container attachment point in scene coords (mid-back) */
  private containerOffset: THREE.Vector3

  constructor(scene: THREE.Scene, bodyLength: number) {
    this.scene = scene
    this.metersToScene = bodyLength / 1.875
    this.containerOffset = new THREE.Vector3(0, 0.05 * bodyLength, -0.15 * bodyLength)

    this.group = new THREE.Group()
    this.group.name = 'deploy-chain'
    this.group.visible = false
    scene.add(this.group)

    // Segment spheres (10 segments)
    const segGeo = new THREE.SphereGeometry(SEGMENT_RADIUS, 6, 4)
    const segMat = new THREE.MeshBasicMaterial({ color: SEGMENT_COLOR })
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(segGeo, segMat)
      mesh.visible = false
      this.group.add(mesh)
      this.segmentMeshes.push(mesh)
    }

    // Chain line: up to 13 points (container + 10 segments + canopy bag + PC)
    const chainGeo = new THREE.BufferGeometry()
    const chainPositions = new Float32Array(13 * 3)
    chainGeo.setAttribute('position', new THREE.BufferAttribute(chainPositions, 3))
    chainGeo.setDrawRange(0, 0)
    const chainMat = new THREE.LineBasicMaterial({ color: BRIDLE_COLOR, linewidth: 1 })
    this.chainLine = new THREE.Line(chainGeo, chainMat)
    this.group.add(this.chainLine)

    // Canopy bag
    const bagGeo = new THREE.BoxGeometry(BAG_SIZE, BAG_SIZE * 1.5, BAG_SIZE * 0.8)
    const bagMat = new THREE.MeshBasicMaterial({ color: BAG_COLOR, transparent: true, opacity: 0.8 })
    this.bagMesh = new THREE.Mesh(bagGeo, bagMat)
    this.bagMesh.visible = false
    this.group.add(this.bagMesh)

    // PC tension ring (visual feedback for tension-dependent CD)
    const ringGeo = new THREE.RingGeometry(SEGMENT_RADIUS * 2, SEGMENT_RADIUS * 3, 16)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
    this.pcRing = new THREE.Mesh(ringGeo, ringMat)
    this.pcRing.visible = false
    this.group.add(this.pcRing)
  }

  /**
   * Update all deployment visuals from render state.
   * Called each frame from main.ts when deploy is active.
   */
  update(state: WingsuitDeployRenderState): void {
    this.group.visible = true
    const s = this.metersToScene

    // Build chain of visible points: container → freed segments (inboard→outboard) → bag? → PC
    const chainPoints: THREE.Vector3[] = []

    // Start at container attachment
    chainPoints.push(this.containerOffset.clone())

    // Segments: iterate from inboard (0) to outboard (9)
    for (let i = 0; i < state.segments.length; i++) {
      const seg = state.segments[i]
      const mesh = this.segmentMeshes[i]
      if (seg.visible) {
        const pos = nedToThree(seg.position, s)
        mesh.position.copy(pos)
        mesh.visible = true
        chainPoints.push(pos)
      } else {
        mesh.visible = false
      }
    }

    // Canopy bag (if spawned)
    if (state.canopyBag) {
      const bagPos = nedToThree(state.canopyBag.position, s)
      this.bagMesh.position.copy(bagPos)
      this.bagMesh.rotation.y = state.canopyBag.yaw
      this.bagMesh.visible = true
      chainPoints.push(bagPos)
    } else {
      this.bagMesh.visible = false
    }

    // PC at end of chain
    const pcPos = nedToThree(state.pcPosition, s)
    chainPoints.push(pcPos)

    // PC tension ring — scales with CD (visual tension feedback)
    const tensionScale = (state.pcCD - 0.3) / 0.6  // 0 at CD_MIN, 1 at CD_MAX
    this.pcRing.position.copy(pcPos)
    this.pcRing.scale.setScalar(1 + tensionScale * 2)
    ;(this.pcRing.material as THREE.MeshBasicMaterial).opacity = 0.2 + tensionScale * 0.6
    this.pcRing.visible = true
    // Face the ring toward camera (billboard)
    this.pcRing.lookAt(this.scene.position)

    // Update chain line geometry
    const chainGeo = this.chainLine.geometry as THREE.BufferGeometry
    const posAttr = chainGeo.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < chainPoints.length && i < 13; i++) {
      posAttr.setXYZ(i, chainPoints[i].x, chainPoints[i].y, chainPoints[i].z)
    }
    posAttr.needsUpdate = true
    chainGeo.setDrawRange(0, chainPoints.length)
    this.chainLine.visible = true
  }

  /** Hide all deployment visuals */
  hide(): void {
    this.group.visible = false
  }

  /** Dispose all Three.js resources */
  dispose(): void {
    this.scene.remove(this.group)
    this.segmentMeshes.forEach(m => { m.geometry.dispose(); (m.material as THREE.Material).dispose() })
    this.chainLine.geometry.dispose();
    (this.chainLine.material as THREE.Material).dispose()
    this.bagMesh.geometry.dispose();
    (this.bagMesh.material as THREE.Material).dispose()
    this.pcRing.geometry.dispose();
    (this.pcRing.material as THREE.Material).dispose()
  }
}
