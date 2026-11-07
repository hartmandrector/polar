/**
 * deploy-pose.ts — Single source of truth for pilot / canopy orientation from
 * PC toss through canopy flight. Used by fix-orientations.ts and both replay
 * scenes, which only read the precomputed series (scrub-safe, no live sim).
 *
 * Timeline (anchors from deploy-replay.ts):
 *   pcToss → lineStretch   Wingsuit pose frozen at PC toss (aero angles are
 *                          contaminated by PC/bridle drag from here on).
 *   lineStretch →          Pilot hangs under the canopy as a damped pendulum
 *                          with pitch as the only DOF. Roll / yaw follow the
 *                          canopy; the leftover wingsuit→canopy rotation
 *                          decays over RESIDUAL_BLEND_S.
 *
 * Pendulum (absolute head pitch θp, in the canopy pitch plane):
 *     θp'' = −ω² sin(θp − θline) − 2ζω θp'
 *   θline = canopy-estimator line direction (canopy θ + HANG_PITCH), i.e. the
 *           GPS-derived direction the pilot hangs along.
 *   ω²    = g_eff / L, g_eff = |canopy normal accel| — stiffens in the opening
 *           shock, 1 g in steady flight. L is the pilot body's riser-hinge →
 *           CG length (the long canopy-pilot swing is already in θline).
 *   ζ     = ZETA_DEPLOY through full flight (legs / body damp the swing), then
 *           eases to ZETA_FLIGHT.
 * Canopy attitude is the estimator's attitude unchanged; the swing is the
 * pilot's lag/overshoot relative to it.
 *
 * All angles in radians.
 */

import * as THREE from 'three'
import { bodyToInertialQuat } from '../viewer/frames'
import type { GPSPipelinePoint } from '../gps/types'
import type { CanopyState } from './canopy-estimator'
import type { DeployReplayTimeline } from './deploy-replay'
import { angleLerp, sourceAngles } from './exit-pose'

export const DEPLOY_POSE_PARAMS = {
  /** Pilot pitch-up relative to the canopy frame in steady hang [deg] */
  HANG_PITCH_DEG: 80,
  /** Pendulum length, riser hinge → pilot CG [m]. The pilot body pitching about
   *  the risers is a short pendulum (~2 s period at 1 g); the long canopy-pilot
   *  swing is already in the estimator's line direction. */
  PENDULUM_LENGTH_M: 1.0,
  /** Clamp for the effective gravity [m/s²] */
  MIN_G_EFF: 3,
  MAX_G_EFF: 40,
  /** Damping ratio during deployment / in steady flight, and the ease between */
  ZETA_DEPLOY: 0.4,
  ZETA_FLIGHT: 0.15,
  ZETA_RELAX_S: 3.0,
  /** Wingsuit→canopy roll/yaw residual decay after line stretch [s] */
  RESIDUAL_BLEND_S: 0.4,
  /** Body-frame view: pilot frame → canopy frame blend after line stretch [s] */
  FRAME_BLEND_S: 0.5,
  /** Fixed-angle series: wingsuit → canopy blend after line stretch [s] */
  FIXED_BLEND_S: 0.5,
  /** Deploy window length after line stretch when full flight was not found [s] */
  NO_FULL_FLIGHT_WINDOW_S: 5,
  /** Integration substep [s] */
  MAX_SUBSTEP_S: 0.01,
} as const

export interface DeployEulerPose {
  roll: number
  theta: number
  psi: number
}

export interface DeployPoseSeries {
  /** True where `pilot` / `canopy` / `frame` are defined (from PC toss on) */
  valid: boolean[]
  /** Pilot orientation in the inertial frame */
  pilot: THREE.Quaternion[]
  /** Canopy orientation in the inertial frame (identity before line stretch) */
  canopy: THREE.Quaternion[]
  /** Reference frame of the body-frame view: pilot pre-LS → canopy post-LS */
  frame: THREE.Quaternion[]
  /** Pilot pitch relative to the steady hang [rad]; + = more nose-up (swing) */
  swing: number[]
  /** Phase-corrected Euler angles for the fixed-orientation series (null outside the window) */
  fixed: (DeployEulerPose | null)[]
}

const AXIS_X = new THREE.Vector3(1, 0, 0)

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}

/** Rotation about model X of −pitch: pitch-up of the pilot relative to the canopy */
function pitchUp(pitch: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(AXIS_X, -pitch)
}

function emptySeries(n: number): DeployPoseSeries {
  return {
    valid: new Array(n).fill(false),
    pilot: new Array(n),
    canopy: new Array(n),
    frame: new Array(n),
    swing: new Array(n).fill(0),
    fixed: new Array(n).fill(null),
  }
}

/**
 * Build the pose series for the whole track. Returns an all-invalid series when
 * the timeline has no line stretch anchor.
 */
export function buildDeployPoseSeries(
  points: GPSPipelinePoint[],
  canopyStates: CanopyState[],
  timeline: Pick<DeployReplayTimeline, 'anchors'>,
): DeployPoseSeries {
  const P = DEPLOY_POSE_PARAMS
  const n = points.length
  const series = emptySeries(n)
  const { pcToss, lineStretch, fullFlight } = timeline.anchors
  if (!pcToss || !lineStretch) return series

  const tossIdx = pcToss.index
  const lsIdx = lineStretch.index
  const lsTime = lineStretch.time

  // ── Pre-line-stretch: wingsuit pose frozen at PC toss ──
  const frozenSrc = sourceAngles(points[tossIdx])
  const frozenQuat = bodyToInertialQuat(frozenSrc.roll, frozenSrc.theta, frozenSrc.psi)
  const frozenEuler: DeployEulerPose = { roll: frozenSrc.roll, theta: frozenSrc.theta, psi: frozenSrc.psi }
  const fixedEndTime = fullFlight?.time ?? lsTime + P.NO_FULL_FLIGHT_WINDOW_S

  for (let i = tossIdx; i < Math.min(lsIdx, n); i++) {
    series.valid[i] = true
    series.pilot[i] = frozenQuat.clone()
    series.canopy[i] = new THREE.Quaternion()
    series.frame[i] = frozenQuat.clone()
    series.fixed[i] = { ...frozenEuler }
  }

  // ── Canopy angles from line stretch on: last valid state, back-filled ──
  const cs: (CanopyState | null)[] = new Array(n).fill(null)
  let firstValid = -1
  for (let i = lsIdx; i < n; i++) {
    if (canopyStates[i]?.valid) { firstValid = i; break }
  }
  if (firstValid < 0) return series
  let held: CanopyState = canopyStates[firstValid]
  for (let i = lsIdx; i < n; i++) {
    if (canopyStates[i]?.valid) held = canopyStates[i]
    cs[i] = held
  }

  const g = 9.81
  const hang = P.HANG_PITCH_DEG * Math.PI / 180

  // Continuity at line stretch: split the wingsuit→canopy rotation into a
  // pitch about the canopy X axis (seeds the pendulum) and a residual that decays.
  const canopy0 = bodyToInertialQuat(cs[lsIdx]!.phi, cs[lsIdx]!.theta, cs[lsIdx]!.psi)
  const rel0 = canopy0.clone().invert().multiply(frozenQuat)
  const a0 = 2 * Math.atan2(rel0.x, rel0.w)
  const rho0 = -a0
  const residual0 = pitchUp(rho0).invert().multiply(rel0)

  let thetaP = cs[lsIdx]!.theta + rho0
  let omega = 0

  const identity = new THREE.Quaternion()

  for (let i = lsIdx; i < n; i++) {
    const c = cs[i]!
    const t = points[i].processed.t
    const elapsed = t - lsTime

    const canopyQuat = bodyToInertialQuat(c.phi, c.theta, c.psi)
    const rho = thetaP - c.theta
    const res = residual0.clone().slerp(identity, smoothstep(elapsed / P.RESIDUAL_BLEND_S))
    const pilotQuat = canopyQuat.clone().multiply(pitchUp(rho)).multiply(res)

    series.valid[i] = true
    series.pilot[i] = pilotQuat
    series.canopy[i] = canopyQuat
    series.frame[i] = pilotQuat.clone().slerp(canopyQuat, smoothstep(elapsed / P.FRAME_BLEND_S))
    series.swing[i] = rho - hang

    if (t <= fixedEndTime) {
      const s = smoothstep(elapsed / P.FIXED_BLEND_S)
      series.fixed[i] = {
        roll: angleLerp(frozenEuler.roll, c.phi, s),
        theta: angleLerp(frozenEuler.theta, c.theta, s),
        psi: angleLerp(frozenEuler.psi, c.psi, s),
      }
    }

    // Advance the pendulum to the next sample
    if (i === n - 1) break
    const dt = points[i + 1].processed.t - t
    if (!(dt > 0)) continue
    const gEff = Math.max(P.MIN_G_EFF, Math.min(P.MAX_G_EFF, c.cnMag > 0 ? c.cnMag : g))
    const w = Math.sqrt(gEff / P.PENDULUM_LENGTH_M)
    const relax = smoothstep((t - fixedEndTime) / P.ZETA_RELAX_S)
    const zeta = P.ZETA_DEPLOY + (P.ZETA_FLIGHT - P.ZETA_DEPLOY) * relax
    const thetaLine = c.theta + hang
    const steps = Math.max(1, Math.ceil(dt / P.MAX_SUBSTEP_S))
    const h = dt / steps
    for (let s = 0; s < steps; s++) {
      omega += (-w * w * Math.sin(thetaP - thetaLine) - 2 * zeta * w * omega) * h
      thetaP += omega * h
    }
  }

  return series
}
