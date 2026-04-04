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

  return {
    pushOffIndex: pushIdx,
    flyingIndex: flyingIdx,
    pushOffTime: points[pushIdx].processed.t,
    flyingTime: points[flyingIdx].processed.t,
  }
}
