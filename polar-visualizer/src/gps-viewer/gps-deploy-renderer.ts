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
  private bodyLength: number

  constructor(scene: THREE.Scene, bodyLength: number) {
    this.renderer = new DeployRenderer(scene, bodyLength)
    this.bodyLength = bodyLength
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
    if (!drp || drp.subPhase === 'pre_deploy') {
      this.renderer.hide()
      return
    }

    // Full flight: keep PC/bridle visible, canopy at full scale
    if (drp.subPhase === 'full_flight') {
      if (canopyModel) canopyModel.visible = true
    }

    // Synthesize a WingsuitDeployRenderState from the replay point
    const state = this.synthesizeRenderState(drp, pt)

    // Post-line-stretch: pass canopy-top anchor so chain originates from canopy
    const tls = drp.timeSinceLineStretch ?? 0
    let anchorPos: THREE.Vector3 | undefined
    if (tls >= 0) {
      const s = this.bodyLength / 1.875  // meters-to-scene scale
      const RISER_LENGTH = 8.0
      // NED (0,0,-8) → Three.js (0, 8*s, 0), then rotate by body attitude
      anchorPos = new THREE.Vector3(0, RISER_LENGTH * s, 0)
      anchorPos.applyQuaternion(bodyQuat)
    }
    this.renderer.update(state, bodyQuat, anchorPos)

    // Canopy GLB visibility: only show from line_stretch onward, scale horizontally
    if (canopyModel) {
      const showCanopy = drp.subPhase === 'line_stretch' || drp.subPhase === 'max_aoa'
        || drp.subPhase === 'snivel' || drp.subPhase === 'surge'
      if (showCanopy && drp.deployFraction > 0.05) {
        canopyModel.visible = true
        // Scale horizontally only (span-wise inflation), keep vertical at base
        const BASE = 1.39 * 0.62
        const h = 0.3 + drp.deployFraction * 0.7
        canopyModel.scale.set(BASE * h, BASE, BASE * h)
      } else {
        // Pre-line-stretch: no canopy visible (PC + bridle + snivel only)
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
   * Pre-line-stretch: PC + segments extending along tension axis from pilot.
   * Post-line-stretch: chain hangs from canopy top, PC trails behind canopy.
   */
  private synthesizeRenderState(
    drp: DeployReplayPoint,
    pt: GPSPipelinePoint,
  ): WingsuitDeployRenderState {
    const tls = drp.timeSinceLineStretch ?? 0

    // ── Tension axis from velocity (relative wind in body frame) ──
    const g = pt.processed
    const speed = g.airspeed
    let windAxis: Vec3

    if (speed > 2) {
      const vN = g.velN, vE = g.velE, vD = g.velD
      const phi = pt.aero.roll, theta = pt.aero.theta, psi = pt.aero.psi
      const cp = Math.cos(phi), sp = Math.sin(phi)
      const ct = Math.cos(theta), st = Math.sin(theta)
      const cy = Math.cos(psi), sy = Math.sin(psi)
      const vBx = (ct*cy)*vN + (ct*sy)*vE + (-st)*vD
      const vBy = (sp*st*cy - cp*sy)*vN + (sp*st*sy + cp*cy)*vE + (sp*ct)*vD
      const vBz = (cp*st*cy + sp*sy)*vN + (cp*st*sy - sp*cy)*vE + (cp*ct)*vD
      // Opposite to velocity = into the wind
      windAxis = normalizeVec3({ x: -vBx, y: -vBy, z: -vBz })
    } else {
      windAxis = normalizeVec3({ x: -1, y: 0, z: -0.3 })
    }

    let chainFraction: number
    let phase: WingsuitDeployRenderState['phase']
    let segments: BridleSegmentState[]
    let pcPosition: Vec3
    let canopyBag: WingsuitDeployRenderState['canopyBag'] = null

    if (tls < 0) {
      // ── Pre-line-stretch: chain extending from pilot along wind axis ──
      const preDuration = 1.5
      chainFraction = Math.max(0, Math.min(1, (tls + preDuration) / preDuration))
      phase = chainFraction < 0.3 ? 'pc_toss'
        : chainFraction < 0.8 ? 'bridle_paying_out'
        : 'canopy_extracting'

      let axis = windAxis
      if (chainFraction < 0.3) {
        const throwProgress = chainFraction / 0.3
        const lateral = (1.0 - throwProgress) * 0.5
        axis = normalizeVec3({ x: axis.x, y: axis.y + lateral, z: axis.z })
      }

      const visibleLength = chainFraction * TOTAL_CHAIN_LENGTH
      segments = []
      for (let i = 0; i < SEGMENT_COUNT; i++) {
        const segDist = (i + 1) * SEGMENT_LENGTH
        const freed = segDist <= visibleLength
        const dist = freed ? segDist : 0
        segments.push({
          position: { x: axis.x * dist, y: axis.y * dist, z: axis.z * dist },
          velocity: { x: 0, y: 0, z: 0 },
          visible: freed,
          freed,
        })
      }

      const pcDist = Math.max(0.5, Math.min(visibleLength, TOTAL_CHAIN_LENGTH))
      pcPosition = { x: axis.x * pcDist, y: axis.y * pcDist, z: axis.z * pcDist }

      if (phase === 'canopy_extracting') {
        const extractProgress = Math.max(0, (chainFraction - 0.7) / 0.3)
        const bagDist = extractProgress * TOTAL_CHAIN_LENGTH * 0.25
        canopyBag = {
          position: { x: axis.x * bagDist, y: axis.y * bagDist, z: axis.z * bagDist },
          velocity: { x: 0, y: 0, z: 0 },
          pitch: 0, pitchRate: 0, roll: 0, rollRate: 0, yaw: 0, yawRate: 0,
        }
      }
    } else {
      // ── Post-line-stretch: chain from canopy top, PC trails aft ──
      chainFraction = 1
      phase = 'line_stretch'

      // Under canopy the body frame is the canopy/pilot system.
      // Canopy is above pilot: NED Z = -RISER (up in body frame).
      // PC/bridle trail aft of canopy: -X direction in body NED.
      const RISER_LENGTH = 8.0  // approximate line + riser length [m]
      const canopyOrigin: Vec3 = { x: 0, y: 0, z: -RISER_LENGTH }

      // Trail direction: aft (-X) in canopy body frame
      const trailAxis: Vec3 = { x: -1, y: 0, z: 0 }

      pcPosition = {
        x: canopyOrigin.x + trailAxis.x * TOTAL_CHAIN_LENGTH,
        y: canopyOrigin.y + trailAxis.y * TOTAL_CHAIN_LENGTH,
        z: canopyOrigin.z + trailAxis.z * TOTAL_CHAIN_LENGTH,
      }

      segments = []
      for (let i = 0; i < SEGMENT_COUNT; i++) {
        const segDist = (i + 1) * SEGMENT_LENGTH
        segments.push({
          position: {
            x: canopyOrigin.x + trailAxis.x * segDist,
            y: canopyOrigin.y + trailAxis.y * segDist,
            z: canopyOrigin.z + trailAxis.z * segDist,
          },
          velocity: { x: 0, y: 0, z: 0 },
          visible: true,
          freed: true,
        })
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
      chainDistance: Math.sqrt(pcPosition.x ** 2 + pcPosition.y ** 2 + pcPosition.z ** 2),
      bagDistance: canopyBag ? Math.sqrt(
        canopyBag.position.x ** 2 + canopyBag.position.y ** 2 + canopyBag.position.z ** 2
      ) : 0,
    }
  }
}
