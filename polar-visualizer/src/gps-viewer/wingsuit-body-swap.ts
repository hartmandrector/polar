/**
 * Wingsuit Body Swap — shows a headless wingsuit body while the separate
 * head model (HeadModelRenderer) is displayed, so the pilot never has two heads.
 *
 * WSV9nohead.glb shares WSV9.glb's local frame, so it is parented to the
 * full model at identity and inherits its scale, position and orientation.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const NO_HEAD_MODEL_PATH = '/models/WSV9nohead.glb'

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh)
  })
  return meshes
}

export class WingsuitBodySwap {
  private fullMeshes: THREE.Mesh[]
  private noHeadMeshes: THREE.Mesh[] = []
  private glbHidden = false
  private headShown = false

  /** Call before anything else is parented to `fullModel`. */
  constructor(fullModel: THREE.Group) {
    this.fullMeshes = collectMeshes(fullModel)
  }

  /** Load the headless body and attach it to `fullModel`. Falls back to the full body on failure. */
  async load(loader: GLTFLoader, fullModel: THREE.Group) {
    try {
      const gltf = await loader.loadAsync(NO_HEAD_MODEL_PATH)
      fullModel.add(gltf.scene)
      this.noHeadMeshes = collectMeshes(gltf.scene)
    } catch (e) {
      console.error('Failed to load headless wingsuit model:', e)
    }
    this.apply()
  }

  setGlbHidden(hidden: boolean) {
    this.glbHidden = hidden
    this.apply()
  }

  setHeadShown(shown: boolean) {
    this.headShown = shown
    this.apply()
  }

  private apply() {
    const useNoHead = this.headShown && this.noHeadMeshes.length > 0
    for (const m of this.fullMeshes) m.visible = !this.glbHidden && !useNoHead
    for (const m of this.noHeadMeshes) m.visible = !this.glbHidden && useNoHead
  }
}
