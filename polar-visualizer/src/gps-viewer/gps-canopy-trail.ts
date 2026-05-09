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

const CANOPY_TRAIL_COLOR   = 0x55ccff   // distinct cyan vs pilot white
const CANOPY_TRAIL_OPACITY = 0.5

export class GPSCanopyTrail {
  private line: THREE.Line | null = null

  constructor(private readonly worldGroup: THREE.Group) {}

  /**
   * Rebuild the canopy trail from the current dataset + canopy states.
   * Call this whenever either the GPS data or the canopy estimator output
   * changes (trim slider, roll method, etc.).
   *
   * @param data          GPS pipeline points (defines pilot NED positions)
   * @param states        Canopy estimates aligned 1:1 with `data`
   * @param nedToScene    Convert a pipeline point's pilot NED pos to scene coords
   */
  rebuild(
    data: GPSPipelinePoint[],
    states: CanopyState[],
    nedToScene: (p: GPSPipelinePoint) => THREE.Vector3,
  ): void {
    this._dispose()

    const positions: THREE.Vector3[] = []
    const n = Math.min(data.length, states.length)

    for (let i = 0; i < n; i++) {
      const cs = states[i]
      if (!cs?.valid) continue

      // Pilot scene position
      const pilotScene = nedToScene(data[i])

      // Offset by canopy-relative NED, converted to Three.js coords (+E→-x, +D→-y, +N→+z)
      const canopyScene = pilotScene.clone().add(
        new THREE.Vector3(-cs.cpE, -cs.cpD, cs.cpN),
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
