/**
 * Build system polar table for GPS pipeline AOA matching.
 * 
 * Bridges the segment model (src/polar/) with the GPS pipeline (src/gps/).
 * Produces a SystemPolarPoint[] array by sweeping α through the segment model.
 */

import { sweepSegments } from '../ui/chart-data'
import { a5segmentsContinuous } from '../polar/polar-data'
import { defaultControls } from '../polar/aero-segment'
import type { SystemPolarPoint } from '../gps/wse'

const A5_REF_LENGTH = 1.93

/**
 * Build a polar table from the A5 segments model.
 * Sweeps α from -5° to 30° in 0.5° steps → 71 points.
 */
export function buildSystemPolarTable(): SystemPolarPoint[] {
  const segments = a5segmentsContinuous.aeroSegments ?? []
  const controls = defaultControls()

  const points = sweepSegments(segments, a5segmentsContinuous, A5_REF_LENGTH, controls, {
    minAlpha: -5,
    maxAlpha: 30,
    step: 0.5,
  })

  return points.map(p => ({
    alpha_deg: p.alpha,
    cl: p.cl,
    cd: p.cd,
  }))
}
