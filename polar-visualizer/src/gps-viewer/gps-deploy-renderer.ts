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

    // After bridle stretch, anchor chain to canopy top (not pilot's back).
    // Before that, default mid-back anchor is used (anchorPos = undefined).
    const isPostBridle = drp.subPhase === 'line_stretch' || drp.subPhase === 'max_aoa'
      || drp.subPhase === 'snivel' || drp.subPhase === 'surge'
    let anchorPos: THREE.Vector3 | undefined
    if (isPostBridle && canopyModel) {
      // Canopy top in scene coords — use the canopy model's world position
      anchorPos = new THREE.Vector3()
      canopyModel.getWorldPosition(anchorPos)
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
   * Pre-line-stretch: PC + segments extending along tension axis.
   * Post-line-stretch: chain fully extended, positions along tension axis.
   */
  private synthesizeRenderState(
    drp: DeployReplayPoint,
    pt: GPSPipelinePoint,
  ): WingsuitDeployRenderState {
    const tls = drp.timeSinceLineStretch ?? 0

    // Determine how much of the chain is visible
    let chainFraction: number  // 0–1, how much of chain is deployed
    let phase: WingsuitDeployRenderState['phase']

    if (tls < 0) {
      // Pre-line-stretch: chain extending over ~1.5 seconds (PC toss to line stretch)
      const preDuration = 1.5
      chainFraction = Math.max(0, Math.min(1, (tls + preDuration) / preDuration))
      phase = chainFraction < 0.3 ? 'pc_toss'
        : chainFraction < 0.8 ? 'bridle_paying_out'
        : 'canopy_extracting'
    } else {
      // Post-line-stretch: chain fully extended
      chainFraction = 1
      phase = 'line_stretch'
    }

    // Tension axis from velocity vector (relative wind in body frame).
    // The PC trails into the wind — opposite to velocity in body frame.
    const g = pt.processed
    const speed = g.airspeed
    let axis: Vec3

    if (speed > 2) {
      // Velocity in NED inertial frame
      const vN = g.velN, vE = g.velE, vD = g.velD
      // Rotate into body frame using Euler angles (DCM: inertial → body)
      const phi = pt.aero.roll, theta = pt.aero.theta, psi = pt.aero.psi
      const cp = Math.cos(phi), sp = Math.sin(phi)
      const ct = Math.cos(theta), st = Math.sin(theta)
      const cy = Math.cos(psi), sy = Math.sin(psi)
      const vBx = (ct*cy)*vN + (ct*sy)*vE + (-st)*vD
      const vBy = (sp*st*cy - cp*sy)*vN + (sp*st*sy + cp*cy)*vE + (sp*ct)*vD
      const vBz = (cp*st*cy + sp*sy)*vN + (cp*st*sy - sp*cy)*vE + (cp*ct)*vD
      // PC trails opposite to velocity in body frame (into the wind)
      axis = normalizeVec3({ x: -vBx, y: -vBy, z: -vBz })
    } else {
      // Low speed fallback: straight aft + up
      axis = normalizeVec3({ x: -1, y: 0, z: -0.3 })
    }

    if (chainFraction < 0.3) {
      // PC toss: add lateral component (thrown to the side)
      const throwProgress = chainFraction / 0.3
      const lateral = (1.0 - throwProgress) * 0.5
      axis = normalizeVec3({ x: axis.x, y: axis.y + lateral, z: axis.z })
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

    // PC position: at the tip of the deployed chain
    const pcDist = Math.max(0.5, Math.min(visibleLength, TOTAL_CHAIN_LENGTH))
    const pcPosition: Vec3 = {
      x: axis.x * pcDist,
      y: axis.y * pcDist,
      z: axis.z * pcDist,
    }

    // Canopy bag (snivel model): only during canopy_extracting phase
    // After line stretch, the canopy is out of the bag — hide snivel
    let canopyBag = null
    if (phase === 'canopy_extracting') {
      const extractProgress = Math.max(0, (chainFraction - 0.7) / 0.3)
      const bagDist = extractProgress * TOTAL_CHAIN_LENGTH * 0.25
      canopyBag = {
        position: {
          x: axis.x * bagDist,
          y: axis.y * bagDist,
          z: axis.z * bagDist,
        },
        velocity: { x: 0, y: 0, z: 0 },
        pitch: 0,
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
