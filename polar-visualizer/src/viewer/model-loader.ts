/**
 * 3D model loading — wingsuit, canopy (with pilot sub-model), slick skydiver, airplane.
 *
 * Models are loaded from the public/models/ directory.
 * When loading a canopy model with a pilot type, both are composed into a single
 * normalized group so the pilot hangs below the canopy at the riser attachment point.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { windDirectionBody } from './frames.ts'

export type ModelType = 'wingsuit' | 'canopy' | 'skydiver' | 'airplane'
export type PilotType = 'wingsuit' | 'slick'

const MODEL_PATHS: Record<ModelType, string> = {
  wingsuit: '/models/tsimwingsuit.glb',
  canopy: '/models/cp2.gltf',
  skydiver: '/models/tslick.glb',
  airplane: '/models/airplane.glb'
}

/** Pilot sub-model GLB paths (reuses same assets as standalone models) */
const PILOT_PATHS: Record<PilotType, string> = {
  wingsuit: '/models/tsimwingsuit.glb',
  slick: '/models/tslick.glb',
}

/**
 * Pilot positioning relative to canopy in raw GLB coordinates.
 * From Three.js editor: position (0, −0.540, 0), rotation (−90°, 0°, 0°).
 * The −90° X rotation turns the pilot from prone (flying) to hanging (feet down).
 * The −0.540 Y offset places the pilot's shoulders at the riser attachment point.
 */
const PILOT_OFFSET = {
  position: new THREE.Vector3(0, -0.540, 0),
  rotation: new THREE.Euler(-Math.PI / 2, 0, 0),
}

/**
 * Scale factor for the canopy mesh.
 * The raw GLB is undersized — A-lines are ~3.5 m from riser to canopy,
 * so a 1.5× scale brings the canopy to realistic proportions relative to
 * the pilot body.
 */
const CANOPY_SCALE = 1.5

export interface LoadedModel {
  type: ModelType
  group: THREE.Group  // The container group we rotate for attitude
  model: THREE.Group  // The loaded/composed scene inside (normalized)
  /** Bounding box length along the Z-axis (flight direction) in normalized units */
  bodyLength: number
  /** Scale factor to convert pilot body meters to model units (for mass overlay) */
  pilotScale: number
  /** Which pilot sub-model is loaded (only for canopy) */
  pilotType?: PilotType
  /** Pivot group for bridle + pilot chute (only for canopy), rotatable per wind direction */
  bridleGroup?: THREE.Group
}

const loader = new GLTFLoader()
const rawCache = new Map<string, THREE.Group>()

/** Load a raw GLTF/GLB and cache by path. Returns a clone. */
async function loadRawGltf(path: string): Promise<THREE.Group> {
  if (rawCache.has(path)) {
    return rawCache.get(path)!.clone()
  }
  const gltf = await loader.loadAsync(path)
  const model = gltf.scene as THREE.Group
  rawCache.set(path, model.clone())
  return model
}

/**
 * Reference size for normalization.
 * All models with a pilot body are scaled so the pilot's max raw dimension
 * maps to TARGET_SIZE. This keeps the wingsuit the same screen size whether
 * viewed standalone or as a sub-model under a canopy.
 */
const TARGET_SIZE = 2.0

/**
 * Cached raw max dimension of the wingsuit GLB.
 * Measured once on first load, then reused for canopy composites so scaling
 * is consistent between standalone wingsuit and canopy+wingsuit views.
 */
let wingsuitRawMaxDim = 0

/**
 * Load a model, returning a group that wraps the loaded GLTF scene.
 * The outer group is what we rotate for attitude.
 *
 * For canopy models with a pilotType, both the canopy and pilot are loaded
 * and composed in raw GLB coordinates, then normalized together.
 */
export async function loadModel(type: ModelType, pilotType?: PilotType): Promise<LoadedModel> {
  const group = new THREE.Group()
  group.name = `model-${type}`

  // Load main model
  const mainModel = await loadRawGltf(MODEL_PATHS[type])

  // For canopy + pilot, compose both before normalization
  let compositeRoot: THREE.Group
  let pilotRawHeight = 0  // raw pilot max extent in GLB units (before normalization)
  let referenceDim = 0    // the dimension used for normalization (pilot body size)
  if (type === 'canopy' && pilotType) {
    compositeRoot = new THREE.Group()

    // Scale canopy mesh to realistic size (pilot stays 1:1)
    mainModel.scale.setScalar(CANOPY_SCALE)
    compositeRoot.add(mainModel)

    const pilotModel = await loadRawGltf(PILOT_PATHS[pilotType])
    // Measure pilot's raw bounding box max extent (body length in GLB coords)
    const pilotBox = new THREE.Box3().setFromObject(pilotModel)
    const pilotSize = pilotBox.getSize(new THREE.Vector3())
    pilotRawHeight = Math.max(pilotSize.x, pilotSize.y, pilotSize.z)  // longest axis = body length
    pilotModel.position.copy(PILOT_OFFSET.position)
    pilotModel.rotation.copy(PILOT_OFFSET.rotation)
    compositeRoot.add(pilotModel)

    // Use the standalone wingsuit/skydiver raw dimension as reference
    // so the pilot appears the same size as when viewed standalone.
    // If we haven't cached it yet, measure it now from the pilot GLB.
    if (wingsuitRawMaxDim === 0) {
      // Measure from a fresh clone (unpositioned, unrotated)
      const refModel = await loadRawGltf(PILOT_PATHS[pilotType])
      const refBox = new THREE.Box3().setFromObject(refModel)
      const refSize = refBox.getSize(new THREE.Vector3())
      wingsuitRawMaxDim = Math.max(refSize.x, refSize.y, refSize.z)
    }
    referenceDim = wingsuitRawMaxDim

    // Measure canopy top Y for bridle attachment (before bridle is added)
    const canopyBox = new THREE.Box3().setFromObject(mainModel)
    const canopyTopY = canopyBox.max.y

    // Store info for post-normalization bridle loading
    ;(compositeRoot as any)._canopyTopY = canopyTopY
    ;(compositeRoot as any)._needsBridle = true
  } else {
    compositeRoot = mainModel
    // For standalone models, use their own max dimension
    const box = new THREE.Box3().setFromObject(compositeRoot)
    const size = box.getSize(new THREE.Vector3())
    referenceDim = Math.max(size.x, size.y, size.z)

    // Cache wingsuit raw dimension for later canopy composites
    if (type === 'wingsuit' && wingsuitRawMaxDim === 0) {
      wingsuitRawMaxDim = referenceDim
    }
  }

  // Center and normalize: scale so referenceDim maps to TARGET_SIZE
  const box = new THREE.Box3().setFromObject(compositeRoot)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  let bodyLength = 2.0
  let pilotScale = 1.0
  if (referenceDim > 0) {
    const s = TARGET_SIZE / referenceDim
    compositeRoot.scale.multiplyScalar(s)
    compositeRoot.position.sub(center.multiplyScalar(s))
    // Body length along Z (flight direction) in normalized units
    bodyLength = size.z * s

    if (type === 'canopy' && pilotRawHeight > 0) {
      // Pilot's real height in model units = raw GLB height × normalization scale
      // pilotScale = model-units-per-meter = (pilotRawHeight × s) / pilotHeightMeters
      // The 1.15 factor compensates for the wingsuit GLB being slightly larger than
      // the actual body envelope (fabric extends beyond limb tips)
      pilotScale = (pilotRawHeight * s * 1.15) / 1.875
    } else {
      // Standalone model: bodyLength maps to pilot height
      pilotScale = bodyLength / 1.875
    }
  }

  group.add(compositeRoot)

  // Load bridle+PC after normalization so it doesn't affect bounding box / scale.
  // The bridleGroup is added to the outer `group` (not compositeRoot) so it
  // inherits the attitude rotation but is positioned in normalized coordinates.
  let bridleGroup: THREE.Group | undefined
  if ((compositeRoot as any)._needsBridle) {
    const canopyTopY: number = (compositeRoot as any)._canopyTopY
    const bridlePCModel = await loadRawGltf('/models/bridalandpc.gltf')
    const s = compositeRoot.scale.x  // normalization scale
    bridlePCModel.scale.setScalar(1.5 * s)

    bridleGroup = new THREE.Group()
    bridleGroup.name = 'bridle-pc-pivot'
    bridleGroup.add(bridlePCModel)

    // Place pivot at the canopy top in normalized coordinates.
    // canopyTopY is in raw GLB coords; multiply by compositeRoot's scale
    // then add compositeRoot's position offset from normalization centering.
    // Shift Z negative to move toward trailing edge of canopy.
    const attachY = canopyTopY * s + compositeRoot.position.y
    const trailingEdgeShift = -0.30  // shift toward trailing edge
    bridleGroup.position.set(0, attachY, compositeRoot.position.z + trailingEdgeShift)

    group.add(bridleGroup)
  }

  return { type, group, model: compositeRoot, bodyLength, pilotScale, pilotType, bridleGroup }
}

/**
 * Shift the model mesh so CG (not bbox center) sits at the scene origin.
 *
 * @param loadedModel   The loaded model to adjust
 * @param cgOffsetFraction  How far forward the CG is from the bbox center,
 *                          as a fraction of body length (from polar.cgOffsetFraction).
 *                          Positive = CG is forward of geometric center.
 */
export function applyCgOffset(loadedModel: LoadedModel, cgOffsetFraction: number): void {
  // Three.js Z = NED X (forward); shift model backward so CG sits at origin
  loadedModel.model.position.z -= cgOffsetFraction * loadedModel.bodyLength
}

/**
 * Apply a pre-computed attitude quaternion to the model group.
 *
 * Pass `null` for body frame (identity rotation).
 * Pass the body-to-inertial quaternion for inertial frame.
 *
 * The quaternion is computed upstream (main.ts) from either body Euler
 * angles or wind Euler angles + α/β, so this function doesn't need
 * to know which mode is active.
 */
/**
 * Rotate the bridle+PC pivot so it aligns with the relative wind direction.
 *
 * The combined bridalandpc.gltf model has the bridle extending along +Z
 * from the attachment point at origin. We rotate the pivot so the bridle
 * aligns with the wind direction in body frame.
 *
 * @param model  The loaded canopy model (must have bridleGroup)
 * @param alpha_deg  Angle of attack in degrees
 * @param beta_deg   Sideslip angle in degrees
 */
const _defaultBridleDir = new THREE.Vector3(0, 0, 1)
const _bridleQuat = new THREE.Quaternion()

export function updateBridleOrientation(model: LoadedModel, alpha_deg: number, beta_deg: number): void {
  if (!model.bridleGroup) return
  const windDir = windDirectionBody(alpha_deg, beta_deg)
  _bridleQuat.setFromUnitVectors(_defaultBridleDir, windDir)
  model.bridleGroup.quaternion.copy(_bridleQuat)
}

export function applyAttitude(
  group: THREE.Group,
  rotation: THREE.Quaternion | null
): void {
  if (!rotation) {
    group.quaternion.identity()
  } else {
    group.quaternion.copy(rotation)
  }
}
