/**
 * exit-detector.ts — Post-hoc exit detection for GPS replay.
 *
 * Finds the push-off point and flying-established point from the full
 * data array. Used to lerp pilot orientation from standing → flying
 * during the ground-to-flight transition.
 *
 * Strategy:
 *   1. Find first frame where flight mode leaves GROUND (mode > 1)
 *   2. Walk backward from that point to find the push-off moment
 *      (vertical speed first exceeds a threshold, sustained)
 *   3. The "flying established" point is where wingsuit/freefall mode starts
 *   4. Between push-off and flying-established, scenes lerp orientation
 *   5. Pose over the whole window (lean → push-off → airspeed-driven trim) is
 *      defined in exit-pose.ts
 */

import type { GPSPipelinePoint } from '../gps/types.ts'
import { EXIT_PARAMS, airspeed } from './exit-pose'

export interface ExitEstimate {
  /** Index where the lean/crouch begins (start of the exit pose window) */
  leanStartIndex: number
  /** Index where pushing off (vertical speed onset) */
  pushOffIndex: number
  /** Index where flying mode is established (wingsuit or freefall) */
  flyingIndex: number
  /** Index where airspeed is high enough that the pose is fully aero-driven (end of window) */
  settledIndex: number
  /** Time of push-off [s] */
  pushOffTime: number
  /** Time of flying established [s] */
  flyingTime: number
}

/**
 * Detect the exit transition from full pipeline data.
 * Returns null if no clear exit found.
 */
export function detectExit(points: GPSPipelinePoint[]): ExitEstimate | null {
  if (points.length < 10) return null

  // Step 1: Find where vertical speed reaches 11 m/s downward (NED: velD > 11)
  // This ensures they're truly in freefall, regardless of push style.
  let freefallIdx = -1
  for (let i = 0; i < points.length; i++) {
    if (points[i].processed.velD > 11) {
      freefallIdx = i
      break
    }
  }

  if (freefallIdx < 0) return null

  // Step 2: Push-off = 1.3 seconds before the 11 m/s point
  const dt = points.length > 1 ? points[1].processed.t - points[0].processed.t : 0.05
  const sampleRate = dt > 0 ? 1 / dt : 20
  const pushIdx = Math.max(0, freefallIdx - Math.round(1.3 * sampleRate))

  // Step 3: Find first wingsuit (3) or freefall (4) frame for flying-established
  let flyingIdx = -1
  for (let i = pushIdx; i < points.length; i++) {
    const mode = points[i].flightMode?.mode ?? 0
    if (mode === 3 || mode === 4) {
      flyingIdx = i
      break
    }
  }

  // If no wingsuit/freefall found, use the freefall velocity point
  if (flyingIdx < 0) flyingIdx = freefallIdx

  // Step 4: Lean start = LEAN_LEAD_S before push-off (by time, not samples)
  const leanT = points[pushIdx].processed.t - EXIT_PARAMS.LEAN_LEAD_S
  let leanIdx = pushIdx
  while (leanIdx > 0 && points[leanIdx - 1].processed.t >= leanT) leanIdx--

  // Step 5: Settled = first point after flying-established with airspeed >= AIRSPEED_FULL
  let settledIdx = flyingIdx
  for (let i = flyingIdx; i < points.length; i++) {
    if (airspeed(points[i]) >= EXIT_PARAMS.AIRSPEED_FULL) {
      settledIdx = i
      break
    }
  }

  return {
    leanStartIndex: leanIdx,
    pushOffIndex: pushIdx,
    flyingIndex: flyingIdx,
    settledIndex: settledIdx,
    pushOffTime: points[pushIdx].processed.t,
    flyingTime: points[flyingIdx].processed.t,
  }
}
