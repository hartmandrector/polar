/**
 * deploy-chain.ts — PC / bridle / bag chain states for GPS replay.
 *
 * Precomputed once from the deploy anchors (see deploy-replay.ts), in
 * pilot-relative INERTIAL NED meters, so the renderer only reads frames.
 *
 *   pcToss → bridleTaut   PC leaves the hand (thrown right), catches air and
 *                         pays the bridle out along the relative wind; segments
 *                         unstow as the payout passes them.
 *   bridleTaut → bagOut   Bridle taut, container opening.
 *   bagOut → lineStretch  Bag extracts and pulls the suspension lines out until
 *                         the whole 7.4 m chain is straight (line stretch).
 *   lineStretch →         The real BridleChainSim (sim/bridle-sim.ts) takes over:
 *                         anchored to the canopy top, driven by the GPS motion,
 *                         with PC drag and gravity. The anchor eases from the
 *                         bag position to the canopy attachment point.
 *
 * Pre-line-stretch motion is kinematic (timed by the anchors), not simulated.
 */

import * as THREE from 'three'
import type { GPSPipelinePoint } from '../gps/types'
import type { BridleSegmentState, Vec3, WingsuitDeployRenderState } from '../sim/deploy-types'
import { BridleChainSim } from '../sim/bridle-sim'
import { bodyToInertial } from '../sim/vec3-util'
import { nedToThreeJS, threeJSToNed } from '../viewer/frames'
import type { DeployReplayTimeline } from './deploy-replay'

/** Physical chain geometry [m] — shared with the deploy renderer and timing model */
export const DEPLOY_CHAIN = {
  /** CG → shoulder → risers → lines → bag → bridle → PC */
  TOTAL_LENGTH: 7.4,
  /** Bridle only: container → PC */
  BRIDLE_LENGTH: 3.3,
}

export const DEPLOY_CHAIN_PARAMS = {
  SEGMENT_COUNT: 10,
  /** Pilot CG → canopy bag attachment at line stretch [m] (sim: PILOT_TO_BAG) */
  PILOT_TO_BAG: DEPLOY_CHAIN.TOTAL_LENGTH - DEPLOY_CHAIN.BRIDLE_LENGTH,
  /** PC release point: body-right offset from the CG [m] (sim: PC_RELEASE_OFFSET) */
  THROW_OFFSET: 0.9,
  /** Fraction of the bridle payout spent accelerating from rest */
  PAYOUT_RAMP: 0.2,
  /** Lateral whip of the paying-out bridle [m], decays to 0 at bridle taut */
  WHIP_AMPLITUDE: 0.15,
  WHIP_HZ: 2.5,
  /** Post-line-stretch canopy lerp: canopy top at the bag position → canopy flying position [s] */
  CANOPY_LERP_S: 0.5,
  /** BridleChainSim constraint passes per step (keeps the chain from stretching) */
  CONSTRAINT_ITERATIONS: 8,
  /** Sim substep [s] */
  MAX_SUBSTEP_S: 0.01,
  PC_CD_MIN: 0.3,
  PC_CD_MAX: 0.9,
} as const

/** Scene units per meter of the GPS pilot model (gps-scene: MODEL_SCALE * 3.55 / 1.875) */
export const GPS_METERS_TO_SCENE = 2.06 / 1.875
/** Container attachment (mid-back) in scene units along the body axis (0.15 × body length) */
const CONTAINER_OFFSET_SCENE = 0.15 * 2.06
/** Canopy bridle-top attachment in canopy GLB (model-local) units: CANOPY_GEOMETRY 'bridleTop' */
const BRIDLE_TOP_LOCAL = new THREE.Vector3(0, 4.672, -0.848)
/** Canopy GLB group scale in gps-scene (the bridle-top scales with it, nothing else) */
export const CANOPY_MODEL_SCALE = 1.39 * 0.66

/**
 * Canopy GLB scale while inflating, as a function of deploy fraction — span (X) and
 * chord (Z), identical to the aero segment model (segment-factories) and the main viewer.
 */
export function canopyDeployScale(deployFraction: number): { span: number; chord: number } {
  const d = Math.max(0, Math.min(1, deployFraction))
  return { span: 0.1 + 0.9 * d, chord: 0.3 + 0.7 * d }
}

export interface DeployChainFrame {
  /** Pilot-relative inertial NED meters */
  state: WingsuitDeployRenderState
  /** Chain start (container pre-LS, canopy bridle-top post-LS), pilot-relative inertial NED meters */
  anchor: Vec3
  /**
   * Canopy GLB origin relative to the pilot, inertial NED meters. Zero in flight;
   * just after line stretch the canopy hangs from the bag and lerps to the pilot.
   */
  canopyOffset: Vec3
  /**
   * Canopy orientation (inertial, Three.js) to render and use for the canopy aero
   * overlay: at line stretch the canopy hangs along the chain, then lerps to the
   * estimator attitude. Undefined before line stretch / without a canopy state.
   */
  canopyQuat?: THREE.Quaternion
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const mul = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
const norm = (a: Vec3): Vec3 => { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : { x: 0, y: 0, z: 0 } }
const lerp3 = (a: Vec3, b: Vec3, s: number): Vec3 => add(mul(a, 1 - s), mul(b, s))
const finite = (v: Vec3): boolean => Number.isFinite(v.x + v.y + v.z)

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}

/** Position (NED, pilot-relative) of a scene-unit Three vector */
function sceneToNed(v: THREE.Vector3): Vec3 {
  const ned = threeJSToNed(v)
  return mul(ned, 1 / GPS_METERS_TO_SCENE)
}

function pilotPos(pt: GPSPipelinePoint): Vec3 {
  return { x: pt.processed.posN, y: pt.processed.posE, z: pt.processed.posD }
}

function pilotVel(pt: GPSPipelinePoint): Vec3 {
  return { x: pt.processed.velN, y: pt.processed.velE, z: pt.processed.velD }
}

/** Bridle payout [m] vs normalized time: accelerates from rest, then constant rate */
function payout(u: number): number {
  const r = DEPLOY_CHAIN_PARAMS.PAYOUT_RAMP
  const s = u < r ? 0.5 * u * u / r : 0.5 * r + (u - r)
  return DEPLOY_CHAIN.BRIDLE_LENGTH * s / (1 - 0.5 * r)
}

function makeState(
  phase: WingsuitDeployRenderState['phase'],
  segments: BridleSegmentState[],
  pc: Vec3,
  pcCD: number,
  bag: WingsuitDeployRenderState['canopyBag'],
  bagDistance: number,
): WingsuitDeployRenderState {
  return {
    phase,
    pcPosition: pc,
    pcCD,
    segments,
    canopyBag: bag,
    bridleTension: 0,
    pinTension: 0,
    bagTension: 0,
    chainDistance: len(pc),
    bagDistance,
  }
}

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Build the chain frames for the whole track (null outside PC toss → end).
 * Requires the timeline's anchors and pose series.
 */
export function buildDeployChainSeries(
  points: GPSPipelinePoint[],
  timeline: Pick<DeployReplayTimeline, 'anchors' | 'pose'>,
  /** Deploy fraction per point (canopy horizontal scale while inflating) */
  deployFractions: number[] = [],
): (DeployChainFrame | null)[] {
  const P = DEPLOY_CHAIN_PARAMS
  const n = points.length
  const frames: (DeployChainFrame | null)[] = new Array(n).fill(null)
  const { pcToss, bridleTaut, bagOut, lineStretch } = timeline.anchors
  const pose = timeline.pose
  if (!pcToss || !bridleTaut || !bagOut || !lineStretch) return frames

  const tT = pcToss.time, tB = bridleTaut.time, tG = bagOut.time, tL = lineStretch.time
  const lsIdx = lineStretch.index
  const SEG = DEPLOY_CHAIN.BRIDLE_LENGTH / P.SEGMENT_COUNT

  // Body-right axis in inertial NED (the throw side), from the frozen wingsuit pose
  const frozen = pose.fixed[pcToss.index]
  const right: Vec3 = frozen
    ? bodyToInertial({ x: 0, y: 1, z: 0 }, frozen.roll, frozen.theta, frozen.psi)
    : { x: 0, y: 1, z: 0 }
  // Direction the chain trails: opposite the velocity
  let lastAxis: Vec3 = { x: -1, y: 0, z: 0 }
  const trailAxis = (pt: GPSPipelinePoint): Vec3 => {
    const v = pilotVel(pt)
    if (len(v) > 2) lastAxis = mul(norm(v), -1)
    return lastAxis
  }
  const containerAnchor = (i: number): Vec3 => {
    const q = pose.pilot[i]
    return q ? sceneToNed(new THREE.Vector3(0, 0, CONTAINER_OFFSET_SCENE).applyQuaternion(q)) : { x: 0, y: 0, z: 0 }
  }

  // ── Pre-line-stretch: timed kinematics ──
  let axisAtLs: Vec3 = lastAxis
  for (let i = pcToss.index; i < Math.min(lsIdx, n); i++) {
    const pt = points[i]
    const t = pt.processed.t
    const axis = trailAxis(pt)
    axisAtLs = axis
    const segments: BridleSegmentState[] = []
    let pc: Vec3
    let bag: WingsuitDeployRenderState['canopyBag'] = null
    let bagDist = 0
    let phase: WingsuitDeployRenderState['phase']
    let pcCD: number = P.PC_CD_MIN

    if (t < tB) {
      // PC thrown to the right, pays the bridle out
      phase = (t - tT) < 0.2 * (tB - tT) ? 'pc_toss' : 'bridle_paying_out'
      const u = Math.max(0, Math.min(1, (t - tT) / Math.max(1e-3, tB - tT)))
      const b = Math.max(0.05, payout(u))
      const lateralPc = mul(right, P.THROW_OFFSET * (1 - smoothstep(u / 0.6)))
      pc = add(mul(axis, b), lateralPc)
      pcCD = P.PC_CD_MIN + (P.PC_CD_MAX - P.PC_CD_MIN) * smoothstep(u)
      const whip = P.WHIP_AMPLITUDE * (1 - u) * Math.sin(2 * Math.PI * P.WHIP_HZ * (t - tT))
      for (let k = 0; k < P.SEGMENT_COUNT; k++) {
        const dist = (k + 1) * SEG
        const freed = dist <= b
        const f = Math.min(1, dist / b)
        const pos = freed
          ? add(add(mul(axis, dist), mul(lateralPc, f)), mul(right, whip * Math.sin(Math.PI * f)))
          : { x: 0, y: 0, z: 0 }
        segments.push({ position: pos, velocity: { x: 0, y: 0, z: 0 }, visible: freed, freed })
      }
    } else {
      // Bridle taut; after bag-out the bag drags the suspension lines out
      const uBag = t < tG ? 0 : smoothstep((t - tG) / Math.max(1e-3, tL - tG))
      bagDist = P.PILOT_TO_BAG * uBag
      phase = t < tG ? 'pin_release' : 'canopy_extracting'
      pcCD = P.PC_CD_MAX
      pc = mul(axis, bagDist + DEPLOY_CHAIN.BRIDLE_LENGTH)
      for (let k = 0; k < P.SEGMENT_COUNT; k++) {
        segments.push({
          position: mul(axis, bagDist + (k + 1) * SEG),
          velocity: { x: 0, y: 0, z: 0 }, visible: true, freed: true,
        })
      }
      if (t >= tG) {
        const wobble = 0.25 * (1 - uBag) * Math.sin(6 * (t - tG))
        bag = {
          position: mul(axis, bagDist), velocity: { x: 0, y: 0, z: 0 },
          pitch: wobble, pitchRate: 0, roll: 0.5 * wobble, rollRate: 0, yaw: 0, yawRate: 0,
        }
      }
    }
    frames[i] = {
      state: makeState(phase, segments, pc, pcCD, bag, bagDist),
      anchor: containerAnchor(i),
      canopyOffset: { x: 0, y: 0, z: 0 },
    }
  }

  // ── Line stretch → end: BridleChainSim anchored to the canopy top ──
  // The canopy top position p(t) starts at the bag (end of the chain) and lerps to the
  // flying bridle-top position. The canopy sits on the ray from the pilot's shoulders
  // through p: its attitude is the estimator's, rotated about the shoulders so the
  // origin→bridle-top axis points at p. When p reaches the flying position this rotation
  // is zero. The chain anchor is p.
  const lerpS = (i: number) => smoothstep((points[i].processed.t - tL) / P.CANOPY_LERP_S)
  /** Pilot-relative bridle-top (NED m) for the estimator attitude and current deploy scale */
  const topEstRel = (i: number): Vec3 | null => {
    const q = pose.canopy[i]
    if (!q) return null
    const sc = canopyDeployScale(deployFractions[i] ?? 1)
    const local = BRIDLE_TOP_LOCAL.clone().multiply(new THREE.Vector3(sc.span, 1, sc.chord)).multiplyScalar(CANOPY_MODEL_SCALE)
    return sceneToNed(local.applyQuaternion(q))
  }
  const bagAtLs = mul(axisAtLs, P.PILOT_TO_BAG)
  /** Canopy top position p(t), pilot-relative NED m */
  const canopyTopRel = (i: number): Vec3 => {
    const top = topEstRel(i)
    return top ? lerp3(bagAtLs, top, lerpS(i)) : bagAtLs
  }
  const canopyQuatAt = (i: number): THREE.Quaternion | null => {
    const est = pose.canopy[i]
    const top = topEstRel(i)
    if (!est || !top) return null
    if (lerpS(i) >= 1) return est
    // Rotate about the shoulders: estimator bridle-top direction → direction to p
    const swing = new THREE.Quaternion().setFromUnitVectors(
      nedToThreeJS(top).normalize(), nedToThreeJS(canopyTopRel(i)).normalize(),
    )
    return swing.multiply(est)
  }
  /** Canopy origin (riser convergence) offset: the top sits on the ray through p at its flying distance */
  const canopyOffsetAt = (i: number): Vec3 => {
    const top = topEstRel(i)
    const p = canopyTopRel(i)
    return top ? sub(p, mul(norm(p), len(top))) : { x: 0, y: 0, z: 0 }
  }
  const p0 = pilotPos(points[lsIdx])
  const v0 = pilotVel(points[lsIdx])
  const anchorAbs = (i: number): Vec3 => add(pilotPos(points[i]), canopyTopRel(i))
  const initSegments = Array.from({ length: P.SEGMENT_COUNT }, (_, k) => ({
    position: add(p0, mul(axisAtLs, P.PILOT_TO_BAG + (k + 1) * SEG)),
    velocity: { ...v0 },
  }))
  const sim = new BridleChainSim(
    add(p0, mul(axisAtLs, P.PILOT_TO_BAG + DEPLOY_CHAIN.BRIDLE_LENGTH)), { ...v0 }, initSegments,
  )
  sim.constraintIterations = P.CONSTRAINT_ITERATIONS

  let aPrev = anchorAbs(lsIdx)
  for (let i = lsIdx; i < n; i++) {
    const pt = points[i]
    const bodyPos = pilotPos(pt)
    const rs = sim.getRenderState(bodyPos)
    if (!finite(rs.pcPosition)) break  // sim diverged — leave the rest empty
    const anchor = sub(aPrev, bodyPos)
    frames[i] = {
      state: { ...rs, phase: 'line_stretch' },
      anchor,
      canopyOffset: canopyOffsetAt(i),
      canopyQuat: canopyQuatAt(i) ?? undefined,
    }
    if (i === n - 1) break

    const dt = points[i + 1].processed.t - pt.processed.t
    if (!(dt > 0)) continue
    const aNext = anchorAbs(i + 1)
    const aVel = mul(sub(aNext, aPrev), 1 / dt)
    const steps = Math.max(1, Math.ceil(dt / P.MAX_SUBSTEP_S))
    const h = dt / steps
    for (let s = 0; s < steps; s++) {
      const a = lerp3(aPrev, aNext, (s + 1) / steps)
      sim.step(a, aVel, pt.processed.rho, h)
      sim.projectChain(a)
    }
    aPrev = aNext
  }

  return frames
}
