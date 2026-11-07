/**
 * deploy-slider.ts — Canopy slider for the GPS replay.
 *
 * Child of the canopy GLB group, so it follows the canopy's pose and
 * position in both scenes. Position is in canopy-model units and slides along
 * the lines from just under the canopy (deploy fraction 0) to just above the
 * pilot's head (1), like the main viewer's slider. The canopy group is scaled
 * non-uniformly while inflating (horizontal scale h), so the slider counter-scales
 * to stay undistorted.
 */

import * as THREE from 'three'
import { loadRawGltf } from '../viewer/model-loader'
import { SLIDER_GEOMETRY, CANOPY_GEOMETRY } from '../viewer/model-registry'

export const DEPLOY_SLIDER_PARAMS = {
  /** Slider position at deploy 0, canopy-model units: just under the canopy skin */
  TOP: new THREE.Vector3(0, 4.0, -0.74),
  /** Slider position at deploy 1: above the pilot's head, at the riser convergence */
  BOTTOM: new THREE.Vector3(0, 0.6, -0.05),
} as const

/** Slider GLB units are meters; the canopy model's units are CANOPY_GEOMETRY.glbToMeters meters */
const SLIDER_SCALE = SLIDER_GEOMETRY.glbToMeters / CANOPY_GEOMETRY.glbToMeters

export class DeploySlider {
  private group = new THREE.Group()
  private parent: THREE.Group

  constructor(parent: THREE.Group) {
    this.parent = parent
    this.group.name = 'deploy-slider'
    this.group.visible = false
    parent.add(this.group)
    void this.load()
  }

  private async load() {
    try {
      const raw = await loadRawGltf(SLIDER_GEOMETRY.path)
      // The GLB carries an embedded light; the plate is vertical and offset from its origin
      raw.traverse(o => { if ((o as THREE.Light).isLight) o.visible = false })
      const lm = SLIDER_GEOMETRY.landmarks.find(l => l.name === 'center')!.glb
      raw.rotation.x = -Math.PI / 2          // plate horizontal
      // After the rotation the plate centre is (cx, cz, −cy): move it to the origin
      raw.position.set(-lm.x, -lm.z, lm.y)
      const inner = new THREE.Group()
      inner.add(raw)
      this.group.add(inner)
    } catch (e) {
      console.warn('[DeploySlider] slider.glb load failed:', e)
    }
  }

  /** @param deployFraction slider position, 0 = top of the lines, 1 = above the head */
  update(deployFraction: number) {
    const d = Math.max(0, Math.min(1, deployFraction))
    const { TOP, BOTTOM } = DEPLOY_SLIDER_PARAMS
    this.group.position.lerpVectors(TOP, BOTTOM, d)
    // Counter the parent's horizontal inflation scale so the plate isn't squashed
    const h = this.parent.scale.y !== 0 ? this.parent.scale.x / this.parent.scale.y : 1
    const hInv = h > 1e-3 ? 1 / h : 1
    this.group.scale.set(SLIDER_SCALE * hInv, SLIDER_SCALE, SLIDER_SCALE * hInv)
    this.group.visible = true
  }

  hide() {
    this.group.visible = false
  }
}
