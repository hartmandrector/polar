/**
 * GPS Canopy Trail
 *
 * Renders a world-space position trail for the canopy (separate from the
 * vehicle/pilot trail).  The trail is a static THREE.Line built once per
 * dataset and lives in the scene's worldGroup — so the existing
 * vehicle-at-origin translation already handles centering it correctly,
 * just like the pilot trail.
 *
 * Canopy position at each frame:
 *   absoluteNED = pilotNED + (cs.cpN, cs.cpE, cs.cpD)
 *
 * Frames where cs.valid === false are silently skipped; this produces natural
 * gaps during freefall and low-airspeed landing without any special handling.
 */

import * as THREE from 'three'
import type { GPSPipelinePoint } from '../gps/types'
import type { CanopyState } from './canopy-estimator'
import type { DeployReplayTimeline } from './deploy-replay'

const CANOPY_TRAIL_COLOR   = 0x55ccff   // distinct cyan vs pilot white
const CANOPY_TRAIL_OPACITY = 0.5

/**
 * Scale the cp offset vector (length ≈ lineLength = 3.0 m) along the canopy
 * normal direction.  1.0 = estimator line-attachment point (bottom of canopy
 * fabric).  Increase to push the trail up into / above the canopy mesh.
 * Tune visually — try 1.3–1.8.
 */
const CANOPY_TRAIL_POSITION_SCALE = 1.4

export class GPSCanopyTrail {
  private line: THREE.Line | null = null

  constructor(private readonly worldGroup: THREE.Group) {}

  /**
   * Rebuild the canopy trail from the current dataset + canopy states.
   * Call this whenever GPS data, canopy estimates, or the deploy timeline
   * changes (trim slider, roll method, deploy sequence update, etc.).
   *
   * Frames are included only when the canopy is actually shown:
   *   - Flight mode must be canopy phase (mode 5–7)
   *   - If a deploy timeline is present, the frame must be past line-stretch
   *     with deployFraction > 0.05 (mirrors the canopy GLB visibility condition)
   *
   * @param data            GPS pipeline points (defines pilot NED positions)
   * @param states          Canopy estimates aligned 1:1 with `data`
   * @param nedToScene      Convert a pipeline point's pilot NED pos to scene coords
   * @param deployTimeline  Optional deploy sequence; gates trail start at line-stretch
   */
  rebuild(
    data: GPSPipelinePoint[],
    states: CanopyState[],
    nedToScene: (p: GPSPipelinePoint) => THREE.Vector3,
    deployTimeline: DeployReplayTimeline | null = null,
  ): void {
    this._dispose()

    const positions: THREE.Vector3[] = []
    const n = Math.min(data.length, states.length)

    for (let i = 0; i < n; i++) {
      const cs = states[i]
      const mode = (data[i].flightMode?.mode ?? 0)
      const isCanopyPhase = mode >= 5 && mode <= 7

      // Skip frames where the canopy model would not be visible
      if (!cs?.valid || !isCanopyPhase) continue

      // With a deploy timeline, further gate on line-stretch + deploy fraction
      // (mirrors the canopy GLB visibility condition in gps-scene.ts)
      if (deployTimeline) {
        const drp = deployTimeline.points[i]
        if (!drp) continue
        const isPreLineStretch = drp.subPhase === 'pc_toss' || drp.subPhase === 'bridle_stretch'
        const isPostLineStretch = drp.subPhase !== 'pre_deploy' && !isPreLineStretch
        if (!isPostLineStretch || drp.deployFraction <= 0.05) continue
      }

      // Pilot scene position
      const pilotScene = nedToScene(data[i])

      // Offset by canopy-relative NED scaled toward the canopy fabric.
      // CANOPY_TRAIL_POSITION_SCALE > 1 moves the point further along the
      // canopy normal (up into/above the mesh). Tune the constant above.
      const canopyScene = pilotScene.clone().add(
        new THREE.Vector3(-cs.cpE, -cs.cpD, cs.cpN).multiplyScalar(CANOPY_TRAIL_POSITION_SCALE),
      )
      positions.push(canopyScene)
    }

    if (positions.length < 2) return

    const geometry = new THREE.BufferGeometry().setFromPoints(positions)
    const material = new THREE.LineBasicMaterial({
      color: CANOPY_TRAIL_COLOR,
      opacity: CANOPY_TRAIL_OPACITY,
      transparent: true,
    })
    this.line = new THREE.Line(geometry, material)
    this.worldGroup.add(this.line)
  }

  /** Show or hide the trail line without rebuilding geometry. */
  setVisible(visible: boolean): void {
    if (this.line) this.line.visible = visible
  }

  /** Remove and dispose the trail geometry/material. */
  dispose(): void {
    this._dispose()
  }

  private _dispose(): void {
    if (this.line) {
      this.worldGroup.remove(this.line)
      this.line.geometry.dispose()
      ;(this.line.material as THREE.Material).dispose()
      this.line = null
    }
  }
}
