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
 */

import type { GPSPipelinePoint } from '../gps/types.ts'

export interface ExitEstimate {
  /** Index where pilot pushes off (vertical speed onset) */
  pushOffIndex: number
  /** Index where flying mode is established (wingsuit or freefall) */
  flyingIndex: number
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

  // Step 1: Find first frame where mode transitions from GROUND to something else
  let firstNonGroundIdx = -1
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].flightMode?.mode ?? 0
    const curr = points[i].flightMode?.mode ?? 0
    if (prev <= 1 && curr > 1) {
      firstNonGroundIdx = i
      break
    }
  }

  if (firstNonGroundIdx < 0) return null

  // Step 2: Find first wingsuit (3) or freefall (4) frame
  let flyingIdx = -1
  for (let i = firstNonGroundIdx; i < points.length; i++) {
    const mode = points[i].flightMode?.mode ?? 0
    if (mode === 3 || mode === 4) {
      flyingIdx = i
      break
    }
  }

  // If no wingsuit/freefall found, use the first non-ground as flying
  if (flyingIdx < 0) flyingIdx = firstNonGroundIdx

  // Step 3: Walk backward from first non-ground to find push-off
  // Push-off = where vertical speed first drops below -0.5 m/s
  // (velD > 0.5 in NED, since D is positive downward)
  const PUSH_THRESHOLD = 0.5  // m/s downward (NED velD positive = falling)
  const searchStart = Math.max(0, firstNonGroundIdx - 100)  // ~5s at 20Hz

  let pushIdx = firstNonGroundIdx
  for (let i = firstNonGroundIdx; i >= searchStart; i--) {
    const velD = points[i].processed.velD
    if (velD < PUSH_THRESHOLD) {
      // Found where we weren't falling yet — push-off is next frame
      pushIdx = i + 1
      break
    }
    pushIdx = i  // keep walking back while we're falling
  }

  // Sanity: push-off should be before flying
  if (pushIdx >= flyingIdx) pushIdx = Math.max(0, flyingIdx - 1)

  return {
    pushOffIndex: pushIdx,
    flyingIndex: flyingIdx,
    pushOffTime: points[pushIdx].processed.t,
    flyingTime: points[flyingIdx].processed.t,
  }
}
