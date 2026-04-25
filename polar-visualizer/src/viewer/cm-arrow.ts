/**
 * Per-segment CM (pitching moment) curved-arrow primitive.
 *
 * Wraps CurvedArrow at pitch-arc color and a compact radius suitable for
 * rendering at individual segment positions rather than at the vehicle CG.
 *
 * Usage:
 *   const arrow = new CMArrow('seg-body-cm')
 *   scene.add(arrow)
 *   arrow.setCM(cm, q, S, chord)   // update each frame from raw coefficients
 *   // — or —
 *   arrow.setMoment(sf.moment)     // update from pre-computed N·m value
 */

import * as THREE from 'three'
import { CurvedArrow } from './curved-arrow.ts'

/** Scale: N·m → arc radians for per-segment CM arrows. Tune in Phase 6.
 *  At 0.001 the arcs were rarely visible (typical segment moments are
 *  only a few N·m).  10× lifts the typical sweep into the legible range
 *  while CM_MAX_ANGLE clamps anything pathological to ±π/2. */
export const CM_SEGMENT_TORQUE_SCALE = 0.01

/** Per-segment CM arc color — dark forest green.
 *  Chosen to be visually distinct from:
 *   • the bright green lift / normal-force segment arrows (~0x44ff44),
 *   • the orange total-vehicle pitch-moment arc (0xff8844 in vectors.ts),
 *  so segment-CM arcs read clearly as "this segment's pitching moment"
 *  rather than as a vehicle-wide aero or rate vector. */
const CM_COLOR = 0x1b5e20

/** Max arc sweep for a single segment's CM contribution [rad]. */
const CM_MAX_ANGLE = Math.PI / 2

/**
 * Compact curved arc for visualizing a single segment's intrinsic pitching
 * moment (M = q·S·c·CM).  Renders around the body X-axis (pitch), same as
 * the total-moment pitch arc at the CG.
 *
 * Positive moment (nose-up / leading-edge-up) → positive arc sweep.
 */
export class CMArrow extends THREE.Group {
  private arc: CurvedArrow

  constructor(name: string) {
    super()
    this.name = name
    this.arc = new CurvedArrow('x', CM_COLOR, `${name}-arc`, {
      // Mesh dimensions deliberately ~half the values used for the total-
      // vehicle pitch arc, so per-segment CM arcs read as supporting detail
      // rather than dominating the scene next to the segment lift/drag/side
      // force arrows.  The arc radius (0.3) and the moment→angle mapping
      // (CM_SEGMENT_TORQUE_SCALE) are unchanged.
      radius: 0.3,
      tubeRadius: 0.0075,
      headLength: 0.05,
      headRadius: 0.0225,
    })
    this.add(this.arc)
  }

  /**
   * Update from raw CM coefficient and aero parameters.
   * Internally computes M = q·S·c·CM, then calls setMoment().
   */
  setCM(cm: number, q: number, S: number, chord: number): void {
    this.setMoment(q * S * chord * cm)
  }

  /**
   * Update directly from a pre-computed pitching moment [N·m].
   * This is the preferred path when SegmentForceResult.moment is available.
   *
   * Positive moment → positive arc sweep (nose-up rotation direction).
   * Arc is clamped to ±π/2 to stay legible regardless of moment magnitude.
   */
  setMoment(moment: number): void {
    const raw = moment * CM_SEGMENT_TORQUE_SCALE
    const angle = Math.sign(raw) * Math.min(Math.abs(raw), CM_MAX_ANGLE)
    this.arc.setAngle(angle)
  }

  /** Dispose GPU resources. */
  dispose(): void {
    this.arc.dispose()
  }
}
