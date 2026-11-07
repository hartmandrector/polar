/**
 * gps-deploy-renderer.ts — Deployment visualization for GPS replay.
 *
 * Drives the shared DeployRenderer (10 bridle-segment GLBs, PC, snivel bag)
 * from the precomputed chain frames in timeline.chain (see deploy-chain.ts)
 * and modulates the canopy GLB scale by deploy fraction.
 *
 * Frames are pilot-relative inertial NED meters, so the renderer applies no
 * body rotation: the chain start (container pre-line-stretch, canopy bridle-top
 * after) comes with each frame.
 */

import * as THREE from 'three'
import { DeployRenderer } from '../viewer/deploy-render'
import { nedToThreeJS } from '../viewer/frames'
import type { DeployReplayTimeline } from './deploy-replay'
import { GPS_METERS_TO_SCENE } from './deploy-chain'

export class GPSDeployRenderer {
  private renderer: DeployRenderer
  private timeline: DeployReplayTimeline | null = null

  /** @param bodyLength Pilot model length in scene units (sets the meters→scene scale) */
  constructor(scene: THREE.Scene, bodyLength: number) {
    this.renderer = new DeployRenderer(scene, bodyLength)
  }

  setTimeline(timeline: DeployReplayTimeline) {
    this.timeline = timeline
  }

  /**
   * Update deployment visuals for the current replay index.
   *
   * @param index       Current pipeline point index
   * @param canopyModel Canopy GLB group — visibility/scale follow the deploy fraction
   */
  update(index: number, canopyModel: THREE.Group | null): void {
    if (!this.timeline) {
      this.renderer.hide()
      return
    }

    const drp = this.timeline.points[index]
    const frame = this.timeline.chain[index]
    if (!drp || drp.subPhase === 'pre_deploy' || !frame) {
      this.renderer.hide()
      return
    }

    // Full flight: keep PC/bridle visible, canopy at full scale
    if (drp.subPhase === 'full_flight') {
      if (canopyModel) canopyModel.visible = true
    }

    const isPostLS = (drp.timeSinceLineStretch ?? 0) >= 0
    const anchor = nedToThreeJS(frame.anchor).multiplyScalar(GPS_METERS_TO_SCENE)

    // Post-LS: PC copies the last segment's orientation (consistent roll)
    this.renderer.pcRotationOffset = isPostLS ? new THREE.Quaternion() : null
    this.renderer.update(frame.state, undefined, anchor)

    // Canopy GLB visibility: only show from line_stretch onward, scale horizontally
    if (canopyModel) {
      const showCanopy = drp.subPhase === 'line_stretch' || drp.subPhase === 'max_aoa'
        || drp.subPhase === 'snivel' || drp.subPhase === 'surge'
      if (showCanopy && drp.deployFraction > 0.05) {
        canopyModel.visible = true
        const BASE = 1.39 * 0.62
        const h = 0.3 + drp.deployFraction * 0.7
        canopyModel.scale.set(BASE * h, BASE, BASE * h)
      } else if (!isPostLS) {
        canopyModel.visible = false
      }
    }
  }

  hide(): void {
    this.renderer.hide()
  }

  dispose(): void {
    this.renderer.dispose()
  }
}
