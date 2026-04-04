/**
 * Deployment chain renderer.
 *
 * Takes WingsuitDeployRenderState (body-relative NED meters) and
 * updates Three.js objects in the scene. Manages GLB models for the
 * pilot chute, bridle segments, and canopy bag, plus chain/suspension lines.
 *
 * GLB models are loaded asynchronously — primitive fallbacks show immediately.
 */

import * as THREE from 'three'
import type { WingsuitDeployRenderState, Vec3 } from '../sim/deploy-types.ts'
import { loadRawGltf } from './model-loader.ts'
import { PC_GEOMETRY, BRIDLE_SEGMENT_GEOMETRY, SNIVEL_GEOMETRY } from './model-registry.ts'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Bridle chain line color */
const BRIDLE_COLOR = 0xff6600

/** Segment sphere color (freed) — fallback while GLBs load */
const SEGMENT_COLOR = 0xffaa00

/** Segment sphere radius in scene units */
const SEGMENT_RADIUS = 0.015

/** Canopy bag color — fallback while GLBs load */
const BAG_COLOR = 0x4488cc

/** Canopy bag box size in scene units */
const BAG_SIZE = 0.08

/** Number of bridle segments */
const SEGMENT_COUNT = 10

/**
 * Visual scale factor for suspension line length during deployment.
 *
 * The physics suspension line distance (~1.93m) is correct, but the canopy
 * assembly uses parentScale/childScale that make the visual pilot-to-canopy
 * distance larger than raw meters → scene conversion gives.
 * This factor stretches ONLY the bag and suspension line positions so they
 * match the assembled canopy geometry. Bridle segments and PC are unaffected.
 *
 * Set to 1.0 = raw physics meters. Tune visually to match the canopy assembly.
 */
export const DEPLOY_LINE_SCALE = 1.0

/**
 * Vertical offset (Three.js Y-up) for the entire bridle chain during canopy flight.
 * Shifts all segment + PC positions up to match the canopy assembly height.
 * Tune visually. 0 = no shift.
 */
export const CANOPY_CHAIN_Y_OFFSET = 2.8

// ─── NED → Three.js Conversion ─────────────────────────────────────────────

/**
 * Convert NED body-relative meters to Three.js scene units.
 * Three.js: X = -ned.Y (west), Y = -ned.Z (up), Z = ned.X (north/forward)
 *
 * @param ned Position in NED meters (body-relative)
 * @param scale pilotScale — NED meters to scene units
 */
function nedToThree(ned: Vec3, scale: number, offset?: THREE.Vector3): THREE.Vector3 {
  const v = new THREE.Vector3(
    -ned.y * scale,
    -ned.z * scale,
     ned.x * scale,
  )
  if (offset) v.add(offset)
  return v
}

/** Reusable temp vectors for lookAt orientation calculations */
const _tmpDir = new THREE.Vector3()
const _tmpUp = new THREE.Vector3(0, 1, 0)
const _tmpMat = new THREE.Matrix4()

/**
 * Orient a model so its local -Z axis points from `from` toward `to`.
 * GLB models have their "forward" along -Z in Three.js convention.
 * Falls back to identity if the two points are coincident.
 */
function orientAlongChain(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  _tmpDir.subVectors(to, from)
  if (_tmpDir.lengthSq() < 1e-8) return
  _tmpDir.normalize()
  // lookAt makes -Z face the target direction
  const target = new THREE.Vector3().addVectors(from, _tmpDir)
  _tmpMat.lookAt(from, target, _tmpUp)
  obj.quaternion.setFromRotationMatrix(_tmpMat)
}

// ─── Deploy Renderer ────────────────────────────────────────────────────────

export class DeployRenderer {
  private scene: THREE.Scene
  private group: THREE.Group

  // ── Primitive fallbacks (shown until GLBs load) ──
  /** Segment joint spheres (fallback) */
  private segmentMeshes: THREE.Mesh[] = []
  /** Canopy bag mesh (fallback) */
  private bagMesh: THREE.Mesh
  /** PC highlight ring (fallback + tension indicator) */
  private pcRing: THREE.Mesh

  /** Optional rotation offset applied after chain orientation (for GPS replay frame correction) */
  pcRotationOffset: THREE.Quaternion | null = null

  // ── GLB models (loaded asynchronously) ──
  /** Pilot chute GLB clone */
  private pcModel: THREE.Group | null = null
  /** Bridle segment GLB clones (one per segment) */
  private segmentModels: THREE.Group[] = []
  /** Snivel (canopy bag) GLB clone */
  private snivelModel: THREE.Group | null = null
  /** Whether GLBs have been loaded */
  private glbsLoaded = false

  // ── Lines ──
  /** Chain line connecting all visible points */
  private chainLine: THREE.Line
  /** Suspension line: body → canopy bag */
  private suspLine: THREE.Line

  /**
   * NED-meters to scene-units scale factor.
   * = bodyLength / 1.875.  Used for both GLB model sizing and
   * chain position conversion (nedToThree).
   */
  private metersToScene: number

  /** Default anchor for wingsuit mode (mid-back container attachment) */
  private defaultAnchor: THREE.Vector3

  /**
   * @param scene          Three.js scene
   * @param bodyLength     Model body length in scene units (LoadedModel.bodyLength).
   */
  constructor(scene: THREE.Scene, bodyLength: number) {
    this.scene = scene
    this.metersToScene = bodyLength / 1.875
    // Default anchor: wingsuit mid-back container attachment
    this.defaultAnchor = new THREE.Vector3(0, 0, 0.15 * bodyLength)

    this.group = new THREE.Group()
    this.group.name = 'deploy-chain'
    this.group.visible = false
    scene.add(this.group)

    // ── Primitive fallbacks ──

    // Segment spheres (10 segments)
    const segGeo = new THREE.SphereGeometry(SEGMENT_RADIUS, 6, 4)
    const segMat = new THREE.MeshBasicMaterial({ color: SEGMENT_COLOR })
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const mesh = new THREE.Mesh(segGeo, segMat)
      mesh.visible = false
      this.group.add(mesh)
      this.segmentMeshes.push(mesh)
    }

    // Canopy bag box (fallback)
    const bagGeo = new THREE.BoxGeometry(BAG_SIZE, BAG_SIZE * 1.5, BAG_SIZE * 0.8)
    const bagMat = new THREE.MeshBasicMaterial({ color: BAG_COLOR, transparent: true, opacity: 0.8 })
    this.bagMesh = new THREE.Mesh(bagGeo, bagMat)
    this.bagMesh.visible = false
    this.group.add(this.bagMesh)

    // PC tension ring (fallback + tension indicator)
    const ringGeo = new THREE.RingGeometry(SEGMENT_RADIUS * 2, SEGMENT_RADIUS * 3, 16)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
    this.pcRing = new THREE.Mesh(ringGeo, ringMat)
    this.pcRing.visible = false
    this.group.add(this.pcRing)

    // ── Lines ──

    // Chain line: up to 13 points (container + 10 segments + canopy bag + PC)
    const chainGeo = new THREE.BufferGeometry()
    const chainPositions = new Float32Array(13 * 3)
    chainGeo.setAttribute('position', new THREE.BufferAttribute(chainPositions, 3))
    chainGeo.setDrawRange(0, 0)
    const chainMat = new THREE.LineBasicMaterial({ color: BRIDLE_COLOR, linewidth: 1 })
    this.chainLine = new THREE.Line(chainGeo, chainMat)
    this.group.add(this.chainLine)

    // Suspension line: body (riser attach) → canopy bag
    const suspGeo = new THREE.BufferGeometry()
    const suspPositions = new Float32Array(2 * 3)
    suspGeo.setAttribute('position', new THREE.BufferAttribute(suspPositions, 3))
    const suspMat = new THREE.LineBasicMaterial({ color: 0xcccccc, linewidth: 1 })
    this.suspLine = new THREE.Line(suspGeo, suspMat)
    this.suspLine.visible = false
    this.group.add(this.suspLine)

    // Kick off async GLB loading
    this.loadGLBs()
  }

  /**
   * Load GLB models for pilot chute, bridle segments, and canopy bag.
   * Once loaded, primitives are hidden and GLBs take over.
   */
  private async loadGLBs(): Promise<void> {
    try {
      const s = this.metersToScene

      // Load all three GLBs in parallel
      const [pcRaw, segRaw, snivelRaw] = await Promise.all([
        loadRawGltf(PC_GEOMETRY.path),
        loadRawGltf(BRIDLE_SEGMENT_GEOMETRY.path),
        loadRawGltf(SNIVEL_GEOMETRY.path),
      ])

      // ── Pilot chute ──
      // pc.glb: physical diameter 0.46m, GLB extent 0.48
      // Scale: glbToMeters × metersToScene to get scene units
      this.pcModel = pcRaw
      this.pcModel.scale.setScalar(PC_GEOMETRY.glbToMeters * s)
      this.pcModel.visible = false
      this.group.add(this.pcModel)

      // ── Bridle segments ──
      // bridalsegment.glb: physical length 0.33m, GLB extent 0.33, glbToMeters = 1.0
      for (let i = 0; i < SEGMENT_COUNT; i++) {
        const seg = i === 0 ? segRaw : segRaw.clone()
        seg.scale.setScalar(BRIDLE_SEGMENT_GEOMETRY.glbToMeters * s)
        seg.visible = false
        this.group.add(seg)
        this.segmentModels.push(seg)
      }

      // ── Snivel (canopy bag) ──
      // snivel.glb: physical width 0.40m, GLB extent 1.6, glbToMeters = 0.25
      this.snivelModel = snivelRaw
      this.snivelModel.scale.setScalar(SNIVEL_GEOMETRY.glbToMeters * s)
      this.snivelModel.visible = false
      this.group.add(this.snivelModel)

      this.glbsLoaded = true
      console.log('[DeployRenderer] GLB models loaded (pc, bridalsegment×10, snivel)')
    } catch (err) {
      console.warn('[DeployRenderer] GLB load failed, using primitive fallbacks:', err)
    }
  }

  /**
   * Update all deployment visuals from render state.
   *
   * Positions in state are body-CG-relative INERTIAL NED meters.
   * The anchor point is provided in final scene coords each frame so it
   * automatically tracks canopy area slider changes (same calculation as
   * the old bridleGroup positioning in main.ts).
   *
   * @param state      Render state with body-CG-relative inertial NED positions
   * @param bodyQuat   Body attitude quaternion (from applyAttitude)
   * @param anchorPos  Bridle anchor in final scene coords (baseBridlePos * deployScale - cgOffset).
   *                   For canopy: computed in main.ts same as old bridleGroup.position.
   *                   Omit for wingsuit — uses default mid-back attachment.
   * @param chainOffset  Optional Three.js offset added to ALL chain positions (segments, PC, bag).
   *                     Used during canopy flight to shift the chain up to match the assembly.
   */
  update(state: WingsuitDeployRenderState, bodyQuat?: THREE.Quaternion, anchorPos?: THREE.Vector3, chainOffset?: THREE.Vector3): void {
    this.group.visible = true
    const s = this.metersToScene
    const useGLB = this.glbsLoaded

    // Position converter: NED body-frame → Three.js scene coordinates.
    // When bodyQuat is provided (canopy mode), positions are in body frame
    // and need rotation into scene space.
    const toScene = (ned: Vec3): THREE.Vector3 => {
      const v = nedToThree(ned, s, chainOffset)
      if (bodyQuat) v.applyQuaternion(bodyQuat)
      return v
    }

    // Build chain of visible points: anchor → freed segments (inboard→outboard) → bag? → PC
    const chainPoints: THREE.Vector3[] = []

    // Anchor: use provided position (canopy, updates with area slider)
    // or default mid-back (wingsuit, rotated by body attitude)
    let anchorScene: THREE.Vector3
    if (anchorPos) {
      anchorScene = anchorPos.clone()
    } else {
      anchorScene = this.defaultAnchor.clone()
      if (bodyQuat) anchorScene.applyQuaternion(bodyQuat)
    }
    chainPoints.push(anchorScene)

    // Segments: iterate from inboard (0) to outboard (9)
    // Track which chainPoints index each visible segment maps to
    const segChainIdx: number[] = []
    for (let i = 0; i < state.segments.length; i++) {
      const seg = state.segments[i]
      if (seg.visible) {
        const pos = toScene(seg.position)
        segChainIdx[i] = chainPoints.length
        chainPoints.push(pos)

        // Primitive fallback sphere
        const mesh = this.segmentMeshes[i]
        mesh.position.copy(pos)
        mesh.visible = !useGLB

        // GLB segment model
        if (useGLB && this.segmentModels[i]) {
          const glb = this.segmentModels[i]
          glb.position.copy(pos)
          glb.visible = true
        }
      } else {
        segChainIdx[i] = -1
        this.segmentMeshes[i].visible = false
        if (useGLB && this.segmentModels[i]) this.segmentModels[i].visible = false
      }
    }

    // Orient segment GLBs along the chain direction
    if (useGLB) {
      for (let i = 0; i < state.segments.length; i++) {
        if (segChainIdx[i] < 0 || !this.segmentModels[i]) continue
        const glb = this.segmentModels[i]
        const cpIdx = segChainIdx[i]
        // For the innermost segment (cpIdx <= 1), orient toward the next segment
        // rather than toward the body anchor — prevents locking to body rotation
        const prev = cpIdx > 1 ? chainPoints[cpIdx - 1] : chainPoints[cpIdx]
        const next = cpIdx < chainPoints.length - 1 ? chainPoints[cpIdx + 1] : chainPoints[cpIdx]
        orientAlongChain(glb, prev, next)
      }
    }

    // Canopy bag (if spawned) — scaled by DEPLOY_LINE_SCALE to match assembly geometry
    if (state.canopyBag) {
      const bagPosScaled = {
        x: state.canopyBag.position.x * DEPLOY_LINE_SCALE,
        y: state.canopyBag.position.y * DEPLOY_LINE_SCALE,
        z: state.canopyBag.position.z * DEPLOY_LINE_SCALE,
      }
      const bagPos = toScene(bagPosScaled)
      chainPoints.push(bagPos)

      // Primitive fallback
      this.bagMesh.position.copy(bagPos)
      this.bagMesh.rotation.set(
        state.canopyBag.pitch,
        state.canopyBag.yaw,
        state.canopyBag.roll,
      )
      this.bagMesh.visible = !useGLB

      // GLB snivel model
      if (useGLB && this.snivelModel) {
        this.snivelModel.position.copy(bagPos)
        this.snivelModel.rotation.set(
          state.canopyBag.pitch,
          state.canopyBag.yaw,
          state.canopyBag.roll,
        )
        this.snivelModel.visible = true
      }
    } else {
      this.bagMesh.visible = false
      if (useGLB && this.snivelModel) this.snivelModel.visible = false
    }

    // PC at end of chain
    const pcPos = toScene(state.pcPosition)
    chainPoints.push(pcPos)

    // PC tension ring — scales with CD (visual tension feedback)
    const tensionScale = (state.pcCD - 0.3) / 0.6  // 0 at CD_MIN, 1 at CD_MAX
    this.pcRing.position.copy(pcPos)
    this.pcRing.scale.setScalar(1 + tensionScale * 2)
    ;(this.pcRing.material as THREE.MeshBasicMaterial).opacity = 0.2 + tensionScale * 0.6
    this.pcRing.visible = !useGLB
    if (!useGLB) this.pcRing.lookAt(this.scene.position)

    // GLB pilot chute model
    if (useGLB && this.pcModel) {
      this.pcModel.position.copy(pcPos)
      this.pcModel.visible = true
      // Orient PC: opening faces away from body (toward incoming air)
      if (chainPoints.length >= 2) {
        const prev = chainPoints[chainPoints.length - 2]
        orientAlongChain(this.pcModel, prev, pcPos)
      }
      // Apply optional rotation offset (e.g. GPS replay frame correction)
      if (this.pcRotationOffset) {
        this.pcModel.quaternion.multiply(this.pcRotationOffset)
      }
    }

    // Update chain line geometry
    const chainGeo = this.chainLine.geometry as THREE.BufferGeometry
    const posAttr = chainGeo.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < chainPoints.length && i < 13; i++) {
      posAttr.setXYZ(i, chainPoints[i].x, chainPoints[i].y, chainPoints[i].z)
    }
    posAttr.needsUpdate = true
    chainGeo.setDrawRange(0, chainPoints.length)
    this.chainLine.visible = state.canopyBag !== null  // hide chain line during canopy flight

    // Suspension line: body → canopy bag (white line = actual parachute lines)
    if (state.canopyBag) {
      const bagPosScaled = {
        x: state.canopyBag.position.x * DEPLOY_LINE_SCALE,
        y: state.canopyBag.position.y * DEPLOY_LINE_SCALE,
        z: state.canopyBag.position.z * DEPLOY_LINE_SCALE,
      }
      const bagPos = toScene(bagPosScaled)
      // Riser attachment point = anchor (already in final scene coords)
      const riserAttach = anchorScene.clone()

      const suspGeo = this.suspLine.geometry as THREE.BufferGeometry
      const suspAttr = suspGeo.getAttribute('position') as THREE.BufferAttribute
      suspAttr.setXYZ(0, riserAttach.x, riserAttach.y, riserAttach.z)
      suspAttr.setXYZ(1, bagPos.x, bagPos.y, bagPos.z)
      suspAttr.needsUpdate = true
      this.suspLine.visible = true
    } else {
      this.suspLine.visible = false
    }
  }

  /** Hide all deployment visuals */
  hide(): void {
    this.group.visible = false
  }

  /** Dispose all Three.js resources */
  dispose(): void {
    this.scene.remove(this.group)
    // Primitives
    this.segmentMeshes.forEach(m => { m.geometry.dispose(); (m.material as THREE.Material).dispose() })
    this.chainLine.geometry.dispose();
    (this.chainLine.material as THREE.Material).dispose()
    this.suspLine.geometry.dispose();
    (this.suspLine.material as THREE.Material).dispose()
    this.bagMesh.geometry.dispose();
    (this.bagMesh.material as THREE.Material).dispose()
    this.pcRing.geometry.dispose();
    (this.pcRing.material as THREE.Material).dispose()
    // GLB models are in the group and removed with it; no extra disposal needed
    // since they're clones from a shared cache
    this.pcModel = null
    this.segmentModels = []
    this.snivelModel = null
    this.glbsLoaded = false
  }
}
