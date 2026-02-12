/**
 * 3D model loading — wingsuit, canopy, slick skydiver.
 * 
 * Models are loaded from the public/models/ directory.
 * Each model is a GLTF/GLB file from CloudBASE.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bodyToInertialQuat } from './frames.ts'

export type ModelType = 'wingsuit' | 'canopy' | 'skydiver' | 'airplane'

const MODEL_PATHS: Record<ModelType, string> = {
  wingsuit: '/models/tsimwingsuit.glb',
  canopy: '/models/cp2.gltf',
  skydiver: '/models/tslick.glb',
  airplane: '/models/airplane.glb'
}

// Approximate scale/offset adjustments per model so they appear centered & reasonably sized
const MODEL_CONFIG: Record<ModelType, { scale: number, offset: THREE.Vector3, rotation: THREE.Euler }> = {
  wingsuit: {
    scale: 1.0,
    offset: new THREE.Vector3(0, 0, 0),
    rotation: new THREE.Euler(0, 0, 0)
  },
  canopy: {
    scale: 1.0,
    offset: new THREE.Vector3(0, 0, 0),
    rotation: new THREE.Euler(0, 0, 0)
  },
  skydiver: {
    scale: 1.0,
    offset: new THREE.Vector3(0, 0, 0),
    rotation: new THREE.Euler(0, 0, 0)
  },
  airplane: {
    scale: 1.0,
    offset: new THREE.Vector3(0, 0, 0),
    rotation: new THREE.Euler(0, 0, 0)
  }
}

export interface LoadedModel {
  type: ModelType
  group: THREE.Group  // The container group we rotate for α/β
  model: THREE.Group  // The loaded GLTF scene inside
  /** Bounding box length along the Z-axis (flight direction) in normalized units */
  bodyLength: number
}

const loader = new GLTFLoader()
const modelCache = new Map<ModelType, THREE.Group>()

/**
 * Load a model, returning a group that wraps the loaded GLTF scene.
 * The outer group is what we rotate for α/β.
 */
export async function loadModel(type: ModelType): Promise<LoadedModel> {
  const group = new THREE.Group()
  group.name = `model-${type}`

  // Check cache
  let model: THREE.Group
  if (modelCache.has(type)) {
    model = modelCache.get(type)!.clone()
  } else {
    const gltf = await loader.loadAsync(MODEL_PATHS[type])
    model = gltf.scene as THREE.Group
    modelCache.set(type, model.clone())
  }

  // Apply per-model config
  const config = MODEL_CONFIG[type]
  model.scale.setScalar(config.scale)
  model.position.copy(config.offset)
  model.rotation.copy(config.rotation)

  // Center the model based on its bounding box
  const box = new THREE.Box3().setFromObject(model)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)

  // Normalize to roughly 2 units across
  let bodyLength = 2.0
  if (maxDim > 0) {
    const targetSize = 2.0
    const s = targetSize / maxDim
    model.scale.multiplyScalar(s)
    model.position.sub(center.multiplyScalar(s))
    // Body length along Z (flight direction) in normalized units
    bodyLength = size.z * s
  }

  group.add(model)
  return { type, group, model, bodyLength }
}

/**
 * Apply attitude rotation to the model group using 3-2-1 Euler angles.
 *
 * In body frame: model stays fixed (identity rotation).
 * In inertial frame: model is rotated by (φ, θ, ψ) using a proper
 * NED-to-Three.js quaternion — no Euler order ambiguity.
 *
 * When attitude sliders are at defaults (φ=0, θ=α, ψ=-β), this reproduces
 * the legacy behaviour of the old applyAlphaBeta().
 */
export function applyAttitude(
  group: THREE.Group,
  phi_deg: number,
  theta_deg: number,
  psi_deg: number,
  frameMode: 'body' | 'inertial'
): void {
  const DEG2RAD = Math.PI / 180

  if (frameMode === 'body') {
    group.quaternion.identity()
  } else {
    const q = bodyToInertialQuat(
      phi_deg * DEG2RAD,
      theta_deg * DEG2RAD,
      psi_deg * DEG2RAD
    )
    group.quaternion.copy(q)
  }
}
