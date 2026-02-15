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
import { getAllCoefficients, lerpPolar } from './coefficients.ts'

const DEG2RAD = Math.PI / 180

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum α change from full riser input [deg] */
const ALPHA_MAX_RISER = 10

/**
 * Brake → α cross-coupling [deg per unit brake × sensitivity].
 *
 * Pulling brakes physically tensions the rear of the canopy downward,
 * slightly increasing the effective angle of attack of the entire cell.
 * This is a secondary effect — the primary brake effect is the flap
 * segment (modeled separately by makeBrakeFlapSegment).
 */
const BRAKE_ALPHA_COUPLING_DEG = 2.5

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
      // Use this.polar so debug overrides applied to seg.polar take effect
      const polar = this.polar ?? cellPolar

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

      // ── Brake → α cross-coupling ──
      // Pulling brakes physically pulls the canopy TE down, slightly
      // increasing the effective AoA of the main cell body.
      const deltaAlphaBrake = brakeInput * brakeSensitivity * BRAKE_ALPHA_COUPLING_DEG

      // ── Evaluate Kirchhoff model at (α_effective + brake α coupling, β_local, δ_effective) ──
      const c = getAllCoefficients(alphaEffective + deltaAlphaBrake, betaLocal, deltaEffective, polar)
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
    polar: bodyPolar,

    getCoeffs(alpha_deg: number, beta_deg: number, controls: SegmentControls) {
      // Use this.polar so debug overrides applied to seg.polar take effect
      const polar = this.polar ?? bodyPolar

      // Transform freestream α to the segment's local frame.
      // A +90° pitch offset means the body is upright (hanging under canopy):
      // the canopy's freestream α (≈10°) maps to the body seeing wind from
      // the front/chest, which is deep post-stall in the wingsuit polar.
      const localAlpha = alpha_deg - pitchOffset_deg
      const c = getAllCoefficients(localAlpha, beta_deg, controls.delta, polar, controls.dirty)
      return { cl: c.cl, cd: c.cd, cy: c.cy, cm: c.cm, cp: c.cp }
    },
  }
}

// ── Unzippable Lifting Body ──────────────────────────────────────────────────

/**
 * Build a lifting body AeroSegment that morphs between two polars
 * based on `controls.unzip`.
 *
 * When unzip = 0: uses zippedPolar (wingsuit — large S, low cd_0, high cl_alpha)
 * When unzip = 1: uses unzippedPolar (slick — small S, high cd_0, low cl_alpha)
 * Between 0 and 1: linearly interpolates ALL polar parameters.
 *
 * The segment's S and chord are dynamically updated from the blended polar
 * so that computeSegmentForce() uses correct force scaling.
 *
 * @param name             Human-readable segment name (e.g. 'pilot')
 * @param position         NED body-frame position (normalized by reference height)
 * @param zippedPolar      Full ContinuousPolar when zipped (wingsuit)
 * @param unzippedPolar    Full ContinuousPolar when unzipped (slick)
 * @param pitchOffset_deg  Pitch rotation relative to canopy body frame [deg]
 */
export function makeUnzippablePilotSegment(
  name: string,
  position: { x: number; y: number; z: number },
  zippedPolar: ContinuousPolar,
  unzippedPolar: ContinuousPolar,
  pitchOffset_deg: number = 0,
): AeroSegment {
  return {
    name,
    position,
    orientation: { roll_deg: 0 },
    S: zippedPolar.s,
    chord: zippedPolar.chord,
    pitchOffset_deg,
    polar: zippedPolar,

    getCoeffs(alpha_deg: number, beta_deg: number, controls: SegmentControls) {
      const t = Math.max(0, Math.min(1, controls.unzip))

      // Blend polars — at t=0 this is zippedPolar, at t=1 it's unzippedPolar
      const blended = t === 0 ? (this.polar ?? zippedPolar)
                    : t === 1 ? unzippedPolar
                    : lerpPolar(t, this.polar ?? zippedPolar, unzippedPolar)

      // Update segment's S and chord so computeSegmentForce uses correct scaling
      this.S = blended.s
      this.chord = blended.chord

      const localAlpha = alpha_deg - pitchOffset_deg
      const c = getAllCoefficients(localAlpha, beta_deg, controls.delta, blended, controls.dirty)
      return { cl: c.cl, cd: c.cd, cy: c.cy, cm: c.cm, cp: c.cp }
    },
  }
}

// ─── Brake Flap Segment ─────────────────────────────────────────────────────

/**
 * Maximum trailing-edge deflection angle at full brake input [deg].
 *
 * At full brake, the trailing edge rotates ~50° below the chord line.
 * This drives the flap's local α offset above the freestream α.
 */
const MAX_FLAP_DEFLECTION_DEG = 50

/**
 * Maximum additional arc roll added to a flap segment at full brake [deg].
 *
 * When brakes are pulled the trailing-edge fabric droops on the sides,
 * deepening the spanwise arc beyond the cell's resting geometry.
 * This induces side forces through the same mechanism as the canopy
 * cell arc — the flap's roll angle tilts its lift vector laterally.
 *
 * The increment scales with effectiveBrake (= rawBrake × sensitivity),
 * so outer flaps (sensitivity 1.0) get the full increment while inner
 * flaps (sensitivity 0.4) get only 40%.
 *
 * At full brake with sensitivity 1.0:
 *   flap_r3: base 36° + 20° = 56° total roll
 *   flap_r2: base 24° + 14° = 38° total (eff. brake 0.7)
 *   flap_r1: base 12° +  8° = 20° total (eff. brake 0.4)
 */
const MAX_FLAP_ROLL_INCREMENT_DEG = 20

/**
 * Reference height for position normalization [m].
 * Used to convert physical chord measurements to normalized position offsets.
 */
const REFERENCE_HEIGHT = 1.875

/**
 * Build a brake flap AeroSegment for the trailing edge of a canopy cell.
 *
 * When brakes are applied, the trailing edge of the cell deflects downward.
 * This factory creates a variable-area segment that models the deflected
 * fabric panel as a separate lifting surface:
 *
 * - **Area**: S scales from 0 (no brake) to flapChordFraction × parentCellS
 *   at full brake input × brakeSensitivity.
 * - **Chord**: Scales proportionally with the flap area.
 * - **α offset**: The flap sees the parent cell's local α plus a deflection
 *   angle that grows with brake input (up to MAX_FLAP_DEFLECTION_DEG).
 * - **Position**: At zero brake, the flap sits at the trailing edge of the
 *   parent cell. As brake is applied, the position moves forward toward the
 *   cell center to represent the quarter-chord of the deployed flap section.
 *   The forward shift = 0.25 × deployedFlapChord (in normalized coords).
 *
 * This is the PRIMARY brake effect — the force from the deflected surface.
 * The SECONDARY effect (camber change on the remaining cell) is handled by
 * the cell's own SymmetricControl brake derivatives.
 *
 * @param name              Segment name (e.g. 'flap_r2')
 * @param trailingEdgePos   NED body-frame position at the trailing edge of parent cell (normalized)
 * @param rollDeg           Arc angle θ [deg] — same as parent cell
 * @param side              Which side for control routing (same as parent cell)
 * @param brakeSensitivity  Brake cascade factor (same as parent cell)
 * @param flapChordFraction Maximum flap chord / cell chord at full brake (outer=0.30, inner=0.10)
 * @param parentCellS       Parent cell reference area [m²]
 * @param parentCellChord   Parent cell chord [m]
 * @param flapPolar         ContinuousPolar for the flap panel
 */
export function makeBrakeFlapSegment(
  name: string,
  trailingEdgePos: { x: number; y: number; z: number },
  rollDeg: number,
  side: 'left' | 'right',
  brakeSensitivity: number,
  flapChordFraction: number,
  parentCellS: number,
  parentCellChord: number,
  flapPolar: ContinuousPolar,
): AeroSegment {
  const theta = rollDeg * DEG2RAD
  const maxFlapS = flapChordFraction * parentCellS
  const maxFlapChord = flapChordFraction * parentCellChord

  // Maximum forward shift of flap CP at full brake [normalized coords].
  // = 0.25 × maxFlapChord / referenceHeight
  // This is how far forward the position moves from the trailing edge
  // when the flap is fully deployed (representing the quarter-chord of the flap).
  const maxCpShift = 0.25 * maxFlapChord / REFERENCE_HEIGHT

  // Roll increment sign — deepens the arc in the same direction as the base roll.
  const rollSign = rollDeg >= 0 ? 1 : -1

  // Store trailing edge position (base position at zero brake)
  const teX = trailingEdgePos.x
  const teZ = trailingEdgePos.z

  return {
    name,
    position: { ...trailingEdgePos },
    orientation: { roll_deg: rollDeg },
    S: 0,               // starts at zero — grows with brake input
    chord: 0,
    polar: flapPolar,

    getCoeffs(alpha_deg: number, beta_deg: number, controls: SegmentControls) {
      // ── Brake input from side routing ──
      const brakeInput = side === 'right' ? controls.brakeRight : controls.brakeLeft
      const effectiveBrake = brakeInput * brakeSensitivity

      // ── Variable area and chord ──
      // Flap area grows from 0 to maxFlapS as brake is applied
      this.S = effectiveBrake * maxFlapS
      this.chord = effectiveBrake * maxFlapChord

      // ── Dynamic position ──
      // At zero brake: position is at the trailing edge.
      // As brake increases: position moves forward toward the cell center,
      // representing the quarter-chord of the deployed flap section.
      // The shift is along the chord direction (x in NED body frame).
      const cpShift = effectiveBrake * maxCpShift
      this.position.x = teX + cpShift
      this.position.z = teZ

      // If no brake input, return zeroes (S=0 means zero force anyway)
      if (effectiveBrake < 0.001) {
        this.orientation = { roll_deg: rollDeg }
        return { cl: 0, cd: 0, cy: 0, cm: 0, cp: 0.25 }
      }

      // ── Dynamic roll angle ──
      // Pulling brakes deepens the arc of the trailing edge fabric.
      // The roll increment scales with effectiveBrake — outer flaps that
      // respond fully get the largest additional curl.
      const rollIncrement = effectiveBrake * MAX_FLAP_ROLL_INCREMENT_DEG * rollSign
      const effectiveTheta = theta + rollIncrement * DEG2RAD

      // ── Local flow angles from dynamic roll orientation ──
      const alphaLocal = alpha_deg * Math.cos(effectiveTheta) + beta_deg * Math.sin(effectiveTheta)
      const betaLocal = -alpha_deg * Math.sin(effectiveTheta) + beta_deg * Math.cos(effectiveTheta)

      // Update orientation for downstream consumers (vectors, debug panel)
      this.orientation = { roll_deg: rollDeg + rollIncrement }

      // ── Flap deflection angle ──
      // The trailing edge rotates downward with brake input.
      // This increases the local α seen by the flap surface.
      const flapDeflection = effectiveBrake * MAX_FLAP_DEFLECTION_DEG
      const alphaFlap = alphaLocal + flapDeflection

      // ── Evaluate Kirchhoff model at the flap's angle ──
      const polar = this.polar ?? flapPolar
      const c = getAllCoefficients(alphaFlap, betaLocal, 0, polar)

      // ── Lift-vector tilt decomposition ──
      // A panel rolled at angle θ produces lift perpendicular to its surface.
      // In the freestream frame, this tilted lift vector decomposes into:
      //   CL_freestream = CL_local × cos(θ)   — vertical fraction
      //   CY_tilt       = CL_local × sin(θ)   — lateral fraction (outward)
      //
      // The canopy arc tilts each panel's normal outward — a right-side panel
      // at positive θ has its lift tilted to starboard (+Y), and a left-side
      // panel at negative θ has its lift tilted to port (-Y). Braking deepens
      // the arc, increasing θ and thus the outward side force.
      //
      // For the canopy cells, cy_beta was tuned to absorb this effect
      // implicitly. For flaps with their extreme dynamic roll angles
      // (up to 56°), this decomposition must be explicit — the CY from
      // cy_beta alone is far too small.
      const cosT = Math.cos(effectiveTheta)
      const sinT = Math.sin(effectiveTheta)
      const cl = c.cl * cosT
      const cy = c.cy + c.cl * sinT

      return { cl, cd: c.cd, cy, cm: c.cm, cp: c.cp }
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
