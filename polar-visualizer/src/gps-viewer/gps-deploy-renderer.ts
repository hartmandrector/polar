/**
 * gps-deploy-renderer.ts — Deployment visualization for GPS replay.
 *
 * Synthesizes WingsuitDeployRenderState from DeployReplayTimeline
 * and drives the existing DeployRenderer + canopy model scale.
 *
 * Pre-line-stretch: PC + bridle extending along the flight-path-relative tension axis.
 * Post-line-stretch: bridle chain attached to canopy bridleTop, trailing aft.
 */

import * as THREE from 'three'
import { DeployRenderer, CANOPY_CHAIN_Y_OFFSET } from '../viewer/deploy-render'
import type { WingsuitDeployRenderState, BridleSegmentState, Vec3 } from '../sim/deploy-types'
import type { DeployReplayTimeline, DeployReplayPoint } from './deploy-replay'
import type { GPSPipelinePoint } from '../gps/types'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Total chain length [m] pre-line-stretch: CG → shoulder → risers → lines → bag → bridle → PC */
const TOTAL_CHAIN_LENGTH = 7.4

/** Bridle-only length [m] post-line-stretch: bridleTop attachment → PC */
const BRIDLE_LENGTH = 3.3

/** Number of bridle segments */
const SEGMENT_COUNT = 10

/** Segment length [m] for pre-LS (full chain) */
const PRE_LS_SEGMENT_LENGTH = TOTAL_CHAIN_LENGTH / SEGMENT_COUNT

/** Segment length [m] for post-LS (bridle only) */
const POST_LS_SEGMENT_LENGTH = BRIDLE_LENGTH / SEGMENT_COUNT

/** PC diameter for drag visual */
const PC_CD_NOMINAL = 0.6

/**
 * BridleTop attachment point from Ibex canopy GLB coordinates.
 * From model-registry.ts CANOPY_GEOMETRY.attachments bridleTop:
 *   glb: { x: 0, y: 4.672, z: -0.848 }
 * Converted to Three.js with canopy X-flip: (-x, y, z) → (0, 4.672, -0.848)
 */
const BRIDLE_TOP_THREE = new THREE.Vector3(0, 4.672, -0.848)

// ─── Helpers ────────────────────────────────────────────────────────────────

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
   * @param bodyQuat    Body attitude quaternion — pilot quat pre-LS, canopy quat post-LS
   * @param canopyModel Canopy GLB group — scale is modulated by deploy fraction
   * @param canopyScale Current canopy GLB scale factor (e.g. 1.39 * 0.66)
   */
  update(
    index: number,
    pt: GPSPipelinePoint,
    bodyQuat: THREE.Quaternion,
    canopyModel: THREE.Group | null,
    canopyScale: number = 1.39 * 0.66,
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

    const tls = drp.timeSinceLineStretch ?? 0
    const isPostLS = tls >= 0

    // Synthesize render state
    const state = this.synthesizeRenderState(drp, pt, isPostLS)

    if (isPostLS) {
      // ── Post-line-stretch: mirror main.ts canopy deploy rendering ──
      // Anchor = bridleTop attachment point, scaled by canopy scale, rotated by canopy quat
      const anchor = BRIDLE_TOP_THREE.clone().multiplyScalar(canopyScale * 0.66)
      anchor.applyQuaternion(bodyQuat)

      // Chain offset (same as main.ts CANOPY_CHAIN_Y_OFFSET)
      const chainOffset = new THREE.Vector3(0, CANOPY_CHAIN_Y_OFFSET, 0)

      // PC orientation: use last segment's quaternion (flag for deploy-render.ts)
      this.renderer.pcRotationOffset = new THREE.Quaternion()  // non-null = copy-from-segment mode

      this.renderer.update(state, bodyQuat, anchor, chainOffset)
    } else {
      // ── Pre-line-stretch: pilot-relative, no anchor override ──
      this.renderer.pcRotationOffset = null
      this.renderer.update(state, bodyQuat)
    }

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

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Build a synthetic WingsuitDeployRenderState from a deploy replay point.
   *
   * Pre-line-stretch: positions are pilot-CG-relative NED, chain along wind axis.
   * Post-line-stretch: positions are NED relative to canopy, chain trails aft (-X).
   */
  private synthesizeRenderState(
    drp: DeployReplayPoint,
    pt: GPSPipelinePoint,
    isPostLS: boolean,
  ): WingsuitDeployRenderState {
    const tls = drp.timeSinceLineStretch ?? 0

    let chainFraction: number
    let phase: WingsuitDeployRenderState['phase']
    let segments: BridleSegmentState[]
    let pcPosition: Vec3
    let canopyBag: WingsuitDeployRenderState['canopyBag'] = null

    if (!isPostLS) {
      // ── Pre-line-stretch: chain extending from pilot along wind axis ──
      // Wind axis from velocity in body frame (DCM with pilot aero angles)
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
        windAxis = normalizeVec3({ x: -vBx, y: -vBy, z: -vBz })
      } else {
        windAxis = normalizeVec3({ x: -1, y: 0, z: -0.3 })
      }

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
        const segDist = (i + 1) * PRE_LS_SEGMENT_LENGTH
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
      // ── Post-line-stretch: chain trails aft from canopy bridleTop ──
      // The anchor is at bridleTop in scene coords. Segments go through
      // toScene(ned) = nedToThree(ned, 1.0, chainOffset) then bodyQuat.
      // We need segments to start near the anchor and trail aft.
      //
      // nedToThree({x,y,z}, 1) = (-y, -z, x) + chainOffset(0, 2.8, 0)
      // Anchor (before bodyQuat) ≈ (0, 4.28, -0.78) with canopyScale=0.917.
      // Solving: -y=0 → y=0; -z+2.8=4.28 → z=-1.48; x=-0.78
      // So bridleTop in NED ≈ (-0.78, 0, -1.48).
      // Chain trails aft: -X in canopy NED = further negative X.
      const anchorNED: Vec3 = { x: -0.78, y: 0, z: -1.48 }

      chainFraction = 1
      phase = 'line_stretch'

      segments = []
      for (let i = 0; i < SEGMENT_COUNT; i++) {
        const segDist = (i + 1) * POST_LS_SEGMENT_LENGTH
        segments.push({
          position: {
            x: anchorNED.x - segDist,
            y: anchorNED.y,
            z: anchorNED.z,
          },
          velocity: { x: 0, y: 0, z: 0 },
          visible: true,
          freed: true,
        })
      }

      pcPosition = {
        x: anchorNED.x - BRIDLE_LENGTH,
        y: anchorNED.y,
        z: anchorNED.z,
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
