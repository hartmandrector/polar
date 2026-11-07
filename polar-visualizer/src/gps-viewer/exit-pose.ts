/**
 * exit-pose.ts — Single source of truth for the ground → flight exit pose.
 *
 * Used by fix-orientations.ts (rates / pt.fixed) and both replay scenes
 * (gps-scene.ts, body-frame-scene.ts), so all three agree.
 *
 * Pitch timeline, relative to push-off (tRel = t - pushOffTime):
 *
 *   tRel ≤ -LEAN_LEAD_S      standing, θ = 90°
 *   → -LEAN_LEAD_S … 0.3 s   crouch + lean: 90° → 45° (at -0.5 s) → 0° (horizontal),
 *                            monotone cubic, zero rate at both ends
 *   → DIVE_START … +DIVE_DUR dive: horizontal → flight-path angle (-γ, α = 0)
 *                            — body falls along the velocity vector, no aero moment yet
 *   → AIRSPEED_START … FULL  aero pitch moment builds with airspeed: θ blends from
 *                            -γ to the solved aero θ (γ + α), pitching into trim
 *
 * Roll follows the aero roll with the same airspeed weight (0 before).
 * Heading is blended from the ground heading (head sensor) to the held flying
 * heading early, during the lean, then eased into the aero heading with the
 * airspeed weight.
 *
 * All angles in radians.
 */

import type { GPSPipelinePoint } from '../gps/types'
import type { ExitEstimate } from './exit-detector'

export const EXIT_PARAMS = {
  /** Lean/crouch begins this long before push-off [s] */
  LEAN_LEAD_S: 1.5,
  /** Time (relative to push-off) and pitch of the lean knots [s, deg] */
  LEAN_KNOT_MID: { t: -0.5, pitchDeg: 45 },
  /** Time (relative to push-off) at which the body is horizontal [s] */
  HORIZONTAL_T: 0.3,
  /** Horizontal → flight-path dive blend window (relative to push-off) [s] */
  DIVE_START_S: 0.2,
  DIVE_DUR_S: 1.0,
  /** Ground → flying heading blend, starting at lean start [s] */
  HEADING_BLEND_S: 1.0,
  /** Airspeed [m/s] where the aero pitch moment starts / fully takes over */
  AIRSPEED_START: 15,
  AIRSPEED_FULL: 30,
} as const

export interface ExitPose {
  roll: number
  theta: number
  psi: number
}

/** Pre-writeback angles (pt.aero is overwritten by the fixed series). */
export function sourceAngles(pt: GPSPipelinePoint) {
  return pt.rawAngles ?? pt.aero
}

export function airspeed(pt: GPSPipelinePoint): number {
  const { velN, velE, velD } = pt.processed
  return Math.sqrt(velN * velN + velE * velE + velD * velD)
}

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}

/** Shortest-path angular interpolation */
export function angleLerp(from: number, to: number, s: number): number {
  let diff = to - from
  while (diff > Math.PI) diff -= 2 * Math.PI
  while (diff < -Math.PI) diff += 2 * Math.PI
  return from + diff * s
}

/**
 * Monotone cubic Hermite through knots with zero end slopes
 * (Fritsch–Carlson interior slopes) — no overshoot, no pause at interior knots.
 */
function monotoneCubic(xs: number[], ys: number[], x: number): number {
  const n = xs.length
  if (x <= xs[0]) return ys[0]
  if (x >= xs[n - 1]) return ys[n - 1]
  const delta: number[] = []
  for (let k = 0; k < n - 1; k++) delta.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]))
  const m: number[] = new Array(n).fill(0)
  for (let k = 1; k < n - 1; k++) {
    m[k] = delta[k - 1] * delta[k] <= 0
      ? 0
      : (2 * delta[k - 1] * delta[k]) / (delta[k - 1] + delta[k])
  }
  let k = 0
  while (x > xs[k + 1]) k++
  const h = xs[k + 1] - xs[k]
  const s = (x - xs[k]) / h
  const s2 = s * s, s3 = s2 * s
  return (2 * s3 - 3 * s2 + 1) * ys[k]
    + (s3 - 2 * s2 + s) * h * m[k]
    + (-2 * s3 + 3 * s2) * ys[k + 1]
    + (s3 - s2) * h * m[k + 1]
}

/** Kinematic pitch (no aero) at tRel seconds from push-off, given the flight-path pitch. */
function kinematicPitch(tRel: number, pathPitch: number): number {
  const P = EXIT_PARAMS
  const xs = [-P.LEAN_LEAD_S, P.LEAN_KNOT_MID.t, P.HORIZONTAL_T]
  const ys = [Math.PI / 2, P.LEAN_KNOT_MID.pitchDeg * Math.PI / 180, 0]
  const lean = monotoneCubic(xs, ys, tRel)
  const dive = smoothstep((tRel - P.DIVE_START_S) / P.DIVE_DUR_S)
  return lean + (pathPitch - lean) * dive
}

/**
 * Exit pose for point `i`, or null when `i` is outside the exit window
 * [leanStartIndex, settledIndex].
 *
 * @param groundHeading heading while standing (head sensor); null → the held
 *   flying heading (no blend).
 */
export function computeExitPose(
  points: GPSPipelinePoint[],
  ex: ExitEstimate,
  i: number,
  groundHeading: number | null = null,
): ExitPose | null {
  if (i < ex.leanStartIndex || i > ex.settledIndex || i >= points.length) return null

  const P = EXIT_PARAMS
  const pt = points[i]
  const src = sourceAngles(pt)
  const heldHeading = sourceAngles(points[Math.min(ex.flyingIndex, points.length - 1)]).psi

  const tRel = pt.processed.t - ex.pushOffTime
  const gs = Math.hypot(pt.processed.velN, pt.processed.velE)
  const pathPitch = -Math.atan2(pt.processed.velD, gs)

  const w = smoothstep((airspeed(pt) - P.AIRSPEED_START) / (P.AIRSPEED_FULL - P.AIRSPEED_START))

  const kin = kinematicPitch(tRel, pathPitch)
  const theta = kin + (src.theta - kin) * w
  const roll = src.roll * w

  const hs = smoothstep((tRel + P.LEAN_LEAD_S) / P.HEADING_BLEND_S)
  const blendedHeading = angleLerp(groundHeading ?? heldHeading, heldHeading, hs)
  const psi = angleLerp(blendedHeading, src.psi, w)

  return { roll, theta, psi }
}
