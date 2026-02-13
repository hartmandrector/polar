/**
 * Factory functions for building AeroSegments.
 *
 * This module is UI-independent. It will eventually be copied into CloudBASE.
 * No Three.js, DOM, or rendering dependencies allowed here.
 *
 * - makeCanopyCellSegment(): builds a 7-cell canopy cell with local flow
 *   transformation, brake → δ, and riser → Δα handling.
 * - makeParasiticSegment(): builds a constant-CD body (lines, pilot, bridle).
 */

import type { AeroSegment, SegmentControls, ContinuousPolar } from './continuous-polar.ts'
import { getAllCoefficients } from './coefficients.ts'

const DEG2RAD = Math.PI / 180

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum α change from full riser input [deg] */
const ALPHA_MAX_RISER = 10

// ─── Canopy Cell Segment ─────────────────────────────────────────────────────

/**
 * Build a canopy cell AeroSegment.
 *
 * Each cell has its own ContinuousPolar (derived from a shared base profile)
 * and computes local flow angles from freestream based on its arc orientation.
 *
 * Control response:
 * - Brakes → trailing-edge camber change (δ), cascading from tips inward.
 *   Center cell gets zero brake (no brake lines reach it).
 * - Risers → angle of attack offset (Δα), approximately uniform across cells.
 *   Front riser decreases α (steeper dive), rear riser increases α (flatter).
 *
 * @param name             Human-readable segment name (e.g. 'cell_c', 'cell_r2')
 * @param position         NED body-frame position (normalized by reference height)
 * @param rollDeg          Arc angle θ [deg] — 0° center, ±12/24/36° for outer cells
 * @param side             Which side of the canopy for control routing
 * @param brakeSensitivity How much brake δ this cell sees (0 for center, 0.4→1.0 outer)
 * @param riserSensitivity How much riser Δα this cell sees (~1.0 for all cells)
 * @param cellPolar        This cell's own ContinuousPolar (typically base with per-cell S, cd_0)
 */
export function makeCanopyCellSegment(
  name: string,
  position: { x: number; y: number; z: number },
  rollDeg: number,
  side: 'left' | 'right' | 'center',
  brakeSensitivity: number,
  riserSensitivity: number,
  cellPolar: ContinuousPolar,
): AeroSegment {
  const theta = rollDeg * DEG2RAD

  return {
    name,
    position,
    orientation: { roll_deg: rollDeg },
    S: cellPolar.s,
    chord: cellPolar.chord,
    polar: cellPolar,

    getCoeffs(alpha_deg: number, beta_deg: number, controls: SegmentControls) {
      // ── Local flow angles from cell orientation ──
      // Cell at arc angle θ sees a rotated projection of freestream
      const alphaLocal = alpha_deg * Math.cos(theta) + beta_deg * Math.sin(theta)
      const betaLocal = -alpha_deg * Math.sin(theta) + beta_deg * Math.cos(theta)

      // ── Riser → α offset ──
      let frontRiser: number, rearRiser: number
      if (side === 'center') {
        frontRiser = (controls.frontRiserLeft + controls.frontRiserRight) / 2
        rearRiser = (controls.rearRiserLeft + controls.rearRiserRight) / 2
      } else if (side === 'right') {
        frontRiser = controls.frontRiserRight
        rearRiser = controls.rearRiserRight
      } else {
        frontRiser = controls.frontRiserLeft
        rearRiser = controls.rearRiserLeft
      }
      const deltaAlphaRiser = (-frontRiser + rearRiser) * ALPHA_MAX_RISER * riserSensitivity
      const alphaEffective = alphaLocal + deltaAlphaRiser

      // ── Brake → δ camber change ──
      let brakeInput: number
      if (side === 'center') {
        brakeInput = 0  // center cell: no brake lines reach it
      } else if (side === 'right') {
        brakeInput = controls.brakeRight
      } else {
        brakeInput = controls.brakeLeft
      }
      const deltaEffective = brakeInput * brakeSensitivity

      // ── Evaluate Kirchhoff model at (α_effective, β_local, δ_effective) ──
      const c = getAllCoefficients(alphaEffective, betaLocal, deltaEffective, cellPolar)
      return { cl: c.cl, cd: c.cd, cy: c.cy, cm: c.cm, cp: c.cp }
    },
  }
}

// ─── Lifting Body Segment ────────────────────────────────────────────────────

/**
 * Build a lifting body AeroSegment from a full ContinuousPolar.
 *
 * Unlike parasitic segments (constant CD), a lifting body evaluates the
 * full Kirchhoff model at the freestream α and β. This gives proper
 * angle-dependent CL, CD, CY, CM, and CP — exactly like a standalone
 * flight vehicle.
 *
 * Use cases:
 * - Wingsuit pilot suspended under a canopy (same aero as freeflying wingsuit)
 * - Slick skydiver under canopy (body produces some lift at angle)
 * - Any body with non-trivial aerodynamics
 *
 * The segment uses the polar's own S and chord as reference values.
 * The `delta` and `dirty` controls flow through to the polar's
 * SymmetricControl derivatives if present.
 *
 * @param name            Human-readable segment name (e.g. 'pilot')
 * @param position        NED body-frame position (normalized by reference height)
 * @param bodyPolar       The full ContinuousPolar for this body
 * @param pitchOffset_deg Pitch rotation of this body relative to the canopy body
 *                        frame [deg]. A canopy pilot hanging vertically has +90°.
 *                        Default: 0 (prone/aligned with body frame).
 */
export function makeLiftingBodySegment(
  name: string,
  position: { x: number; y: number; z: number },
  bodyPolar: ContinuousPolar,
  pitchOffset_deg: number = 0,
): AeroSegment {
  return {
    name,
    position,
    orientation: { roll_deg: 0 },
    S: bodyPolar.s,
    chord: bodyPolar.chord,
    pitchOffset_deg,

    getCoeffs(alpha_deg: number, beta_deg: number, controls: SegmentControls) {
      // Transform freestream α to the segment's local frame.
      // A +90° pitch offset means the body is upright (hanging under canopy):
      // the canopy's freestream α (≈10°) maps to the body seeing wind from
      // the front/chest, which is deep post-stall in the wingsuit polar.
      const localAlpha = alpha_deg - pitchOffset_deg
      const c = getAllCoefficients(localAlpha, beta_deg, controls.delta, bodyPolar, controls.dirty)
      return { cl: c.cl, cd: c.cd, cy: c.cy, cm: c.cm, cp: c.cp }
    },
  }
}

// ─── Parasitic Body Segment ──────────────────────────────────────────────────

/**
 * Build a parasitic body AeroSegment (lines, pilot body, bridle/PC).
 *
 * These have constant coefficients — they don't respond to controls
 * and don't use the Kirchhoff model. Just simple drag bodies with
 * optional minor lift.
 *
 * @param name      Human-readable segment name
 * @param position  NED body-frame position (normalized)
 * @param S         Reference area [m²]
 * @param chord     Reference chord [m]
 * @param cd        Constant drag coefficient
 * @param cl        Constant lift coefficient (usually 0 or very small)
 * @param cy        Constant side force coefficient (usually 0)
 */
export function makeParasiticSegment(
  name: string,
  position: { x: number; y: number; z: number },
  S: number,
  chord: number,
  cd: number,
  cl: number = 0,
  cy: number = 0,
): AeroSegment {
  return {
    name,
    position,
    orientation: { roll_deg: 0 },
    S,
    chord,

    getCoeffs(_alpha_deg: number, _beta_deg: number, _controls: SegmentControls) {
      return { cl, cd, cy, cm: 0, cp: 0.25 }
    },
  }
}
