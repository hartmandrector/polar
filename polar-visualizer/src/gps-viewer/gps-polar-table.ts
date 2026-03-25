/**
 * Build system polar table and evaluator for GPS pipeline AOA matching.
 * 
 * Bridges the segment model (src/polar/) with the GPS pipeline (src/gps/).
 */

import { a5segmentsContinuous } from '../polar/polar-data'
import { defaultControls, computeSegmentForce, computeWindFrameNED, sumAllSegments } from '../polar/aero-segment'
import { computeCenterOfMass } from '../polar/inertia'
import type { SystemPolarPoint, PolarEvaluator } from '../gps/wse'

const A5_REF_LENGTH = 1.93
const DEFAULT_AIRSPEED = 40  // m/s — reference speed for coefficient normalization
const DEFAULT_RHO = 1.225

/**
 * Build a polar table from the A5 segments model (legacy, for fallback).
 * Sweeps α from -5° to 30° in 0.5° steps → 71 points.
 */
export function buildSystemPolarTable(): SystemPolarPoint[] {
  const evaluator = buildPolarEvaluator()
  const points: SystemPolarPoint[] = []
  for (let alpha = -5; alpha <= 30; alpha += 0.5) {
    const { cl, cd } = evaluator(alpha)
    points.push({ alpha_deg: alpha, cl, cd })
  }
  return points
}

/**
 * Build an on-demand segment model evaluator for binary search AOA matching.
 * Evaluates CL/CD at any α by running the full segment model.
 * Captures segments, CG, controls at construction time.
 */
export function buildPolarEvaluator(
  airspeed = DEFAULT_AIRSPEED,
  rho = DEFAULT_RHO,
): PolarEvaluator {
  const polar = a5segmentsContinuous
  const segments = polar.aeroSegments ?? []
  const controls = defaultControls()
  const massRef = 1.875
  const cgMeters = computeCenterOfMass(polar.massSegments ?? [], massRef, polar.m)
  const sRef = polar.s
  const beta_deg = 0

  return (alpha_deg: number) => {
    const q = 0.5 * rho * airspeed * airspeed
    const qS = q * sRef

    const segForces = segments.map(seg =>
      computeSegmentForce(seg, alpha_deg, beta_deg, controls, rho, airspeed)
    )
    const { windDir, liftDir, sideDir } = computeWindFrameNED(alpha_deg, beta_deg)
    const system = sumAllSegments(
      segments, segForces, cgMeters, polar.referenceLength,
      windDir, liftDir, sideDir, controls, massRef,
    )

    const totalLift = liftDir.x * system.force.x + liftDir.y * system.force.y + liftDir.z * system.force.z
    const totalDrag = -(windDir.x * system.force.x + windDir.y * system.force.y + windDir.z * system.force.z)

    const cl = qS > 1e-10 ? totalLift / qS : 0
    const cd = qS > 1e-10 ? totalDrag / qS : 0

    return { cl, cd }
  }
}
