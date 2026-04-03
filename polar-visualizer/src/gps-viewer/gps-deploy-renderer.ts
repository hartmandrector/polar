/**
 * gps-deploy-renderer.ts — Deployment visualization for GPS replay.
 *
 * Synthesizes WingsuitDeployRenderState from DeployReplayTimeline
 * and drives the existing DeployRenderer + canopy model scale.
 *
 * Pre-line-stretch: PC + bridle extending along the flight-path-relative tension axis.
 * Post-line-stretch: bridle chain + canopy inflating (deploy fraction → scale).
 */

import * as THREE from 'three'
import { DeployRenderer } from '../viewer/deploy-render'
import type { WingsuitDeployRenderState, BridleSegmentState, Vec3 } from '../sim/deploy-types'
import type { DeployReplayTimeline, DeployReplayPoint } from './deploy-replay'
import type { GPSPipelinePoint } from '../gps/types'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Total bridle chain length [m] (must match deploy-wingsuit.ts) */
const TOTAL_CHAIN_LENGTH = 7.4

/** Number of bridle segments */
const SEGMENT_COUNT = 10

/** Segment length [m] */
const SEGMENT_LENGTH = TOTAL_CHAIN_LENGTH / SEGMENT_COUNT

/** PC diameter for drag visual */
const PC_CD_NOMINAL = 0.6

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute the body-relative tension axis from flight path angles.
 * During deployment, the PC/bridle trails behind and above.
 * In body frame: roughly aft (+X in NED body = behind) and slightly up (-Z in NED).
 */
function tensionAxisFromAero(pt: GPSPipelinePoint): Vec3 {
  // Approximate: PC trails directly behind in body frame
  // During wingsuit flight: aft = -X body, but the PC is actually
  // behind in the wind frame. We'll use a simple aft + slight up direction.
  // This gets refined with actual canopy state later.
  return { x: -1, y: 0, z: -0.2 }  // aft and slightly above CG
}

/**
 * Normalize a Vec3 in-place and return it.
 */
function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  if (len > 1e-6) {
    v.x /= len; v.y /= len; v.z /= len
  }
  return v
}

// ─── GPS Deploy Renderer ────────────────────────────────────────────────────

export class GPSDeployRenderer {
  private renderer: DeployRenderer
  private timeline: DeployReplayTimeline | null = null

  constructor(scene: THREE.Scene, bodyLength: number) {
    this.renderer = new DeployRenderer(scene, bodyLength)
  }

  setTimeline(timeline: DeployReplayTimeline) {
    this.timeline = timeline
  }

  /**
   * Update deployment visuals for current replay index.
   *
   * @param index       Current pipeline point index
   * @param pt          Current GPS pipeline point
   * @param bodyQuat    Current body attitude quaternion (for body-relative rendering)
   * @param canopyModel Canopy GLB group — scale is modulated by deploy fraction
   */
  update(
    index: number,
    pt: GPSPipelinePoint,
    bodyQuat: THREE.Quaternion,
    canopyModel: THREE.Group | null,
  ): void {
    if (!this.timeline) {
      this.renderer.hide()
      return
    }

    const drp = this.timeline.points[index]
    if (!drp || drp.subPhase === 'pre_deploy' || drp.subPhase === 'full_flight') {
      this.renderer.hide()
      // Full flight: canopy at full scale
      if (canopyModel && drp?.subPhase === 'full_flight') {
        canopyModel.visible = true
      }
      return
    }

    // Synthesize a WingsuitDeployRenderState from the replay point
    const state = this.synthesizeRenderState(drp, pt)
    this.renderer.update(state, bodyQuat)

    // Scale canopy model by deploy fraction
    if (canopyModel) {
      const df = drp.deployFraction
      if (df > 0.05) {
        canopyModel.visible = true
        // Scale from 0.3 (initial burst) to 1.0 (full inflation)
        const visualScale = 0.3 + df * 0.7
        // Apply relative to the base canopy scale
        canopyModel.scale.setScalar(1.39 * 0.62 * visualScale)
      } else {
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

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Build a synthetic WingsuitDeployRenderState from a deploy replay point.
   *
   * The positions are body-CG-relative in NED meters.
   * Pre-line-stretch: PC + segments extending along tension axis.
   * Post-line-stretch: chain fully extended, positions along tension axis.
   */
  private synthesizeRenderState(
    drp: DeployReplayPoint,
    pt: GPSPipelinePoint,
  ): WingsuitDeployRenderState {
    const axis = normalizeVec3(tensionAxisFromAero(pt))
    const tls = drp.timeSinceLineStretch ?? 0

    // Determine how much of the chain is visible
    let chainFraction: number  // 0–1, how much of chain is deployed
    let phase: WingsuitDeployRenderState['phase']

    if (tls < 0) {
      // Pre-line-stretch: chain extending
      // Assume 1 second from PC toss to line stretch
      const preDuration = 1.0
      chainFraction = Math.max(0, Math.min(1, (tls + preDuration) / preDuration))
      phase = chainFraction < 0.3 ? 'pc_toss'
        : chainFraction < 0.8 ? 'bridle_paying_out'
        : 'canopy_extracting'
    } else {
      // Post-line-stretch: chain fully extended
      chainFraction = 1
      phase = 'line_stretch'
    }

    // Place segments along the tension axis
    const visibleLength = chainFraction * TOTAL_CHAIN_LENGTH
    const segments: BridleSegmentState[] = []

    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const segDist = (i + 1) * SEGMENT_LENGTH
      const freed = segDist <= visibleLength
      const dist = freed ? segDist : 0
      segments.push({
        position: {
          x: axis.x * dist,
          y: axis.y * dist,
          z: axis.z * dist,
        },
        velocity: { x: 0, y: 0, z: 0 },
        visible: freed,
        freed,
      })
    }

    // PC at end of deployed chain
    const pcDist = Math.min(visibleLength, TOTAL_CHAIN_LENGTH)
    const pcPosition: Vec3 = {
      x: axis.x * pcDist,
      y: axis.y * pcDist,
      z: axis.z * pcDist,
    }

    // Canopy bag: only visible post-pin-release (roughly last 30% of pre-LS chain)
    let canopyBag = null
    if (chainFraction > 0.7 || tls >= 0) {
      const bagDist = Math.min(visibleLength * 0.95, TOTAL_CHAIN_LENGTH * 0.3)
      canopyBag = {
        position: {
          x: axis.x * bagDist,
          y: axis.y * bagDist,
          z: axis.z * bagDist,
        },
        velocity: { x: 0, y: 0, z: 0 },
        pitch: (tls > 0 ? 0 : (Math.random() - 0.5) * 0.5),
        pitchRate: 0,
        roll: 0,
        rollRate: 0,
        yaw: 0,
        yawRate: 0,
      }
    }

    return {
      phase,
      pcPosition,
      pcCD: PC_CD_NOMINAL,
      segments,
      canopyBag,
      bridleTension: tls >= 0 ? 500 : chainFraction * 200,
      pinTension: tls >= 0 ? 300 : 0,
      bagTension: tls >= 0 ? 200 : 0,
      chainDistance: pcDist,
      bagDistance: canopyBag ? Math.sqrt(
        canopyBag.position.x ** 2 + canopyBag.position.y ** 2 + canopyBag.position.z ** 2
      ) : 0,
    }
  }
}
