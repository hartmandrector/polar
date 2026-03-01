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

// ─── Control Constants ───────────────────────────────────────────────────────

/**
 * Tunable constants that control how segments respond to brake/riser inputs.
 * Exported so that the export system can serialize and override these values.
 */
export interface ControlConstants {
  /** Maximum α change from full riser input [deg] */
  ALPHA_MAX_RISER: number
  /** Brake → α cross-coupling [deg per unit brake × sensitivity] */
  BRAKE_ALPHA_COUPLING_DEG: number
  /** Maximum trailing-edge deflection angle at full brake input [deg] */
  MAX_FLAP_DEFLECTION_DEG: number
  /** Maximum additional arc roll added to a flap segment at full brake [deg] */
  MAX_FLAP_ROLL_INCREMENT_DEG: number
}

/** Default control constants — current Ibexul tuning. */
export const DEFAULT_CONSTANTS: ControlConstants = {
  ALPHA_MAX_RISER: 10,
  BRAKE_ALPHA_COUPLING_DEG: 2.5,
  MAX_FLAP_DEFLECTION_DEG: 50,
  MAX_FLAP_ROLL_INCREMENT_DEG: 20,
}

// ─── Deployment Constants ────────────────────────────────────────────────────

/**
 * Tuning constants for how aerodynamic coefficients change during deployment.
 * At deploy = 0 (line stretch), the canopy is an uninflated fabric bundle:
 *   - Much higher parasitic drag (flapping fabric)
 *   - Much lower lift slope (poor airfoil shape)
 *   - More frontal/normal drag
 * These multipliers are linearly interpolated: value = lerp(deploy0_value, 1.0, deploy)
 */
export const DEPLOY_CD0_MULTIPLIER = 2.0        // cd_0 at deploy=0 is 2× normal
export const DEPLOY_CL_ALPHA_FRACTION = 0.3     // cl_alpha at deploy=0 is 30% of normal
export const DEPLOY_CD_N_MULTIPLIER = 1.5       // cd_n (normal drag) at deploy=0 is 1.5× normal
export const DEPLOY_STALL_FWD_OFFSET = -17      // alpha_stall_fwd shifts down 17° at deploy=0 (22→ 5°)
export const DEPLOY_S1_FWD_MULTIPLIER = 4.0     // stall transition width 4× broader at deploy=0

/**
 * Chord-wise (NED +x = forward) position offset at deploy = 0.
 * The GLB model and the NED-based segment positions use different coordinate
 * origins, so they drift apart as the model scales during deployment.
 * This offset is lerped to zero at deploy = 1 (where everything is calibrated).
 * Tune visually until the arrows sit on the scaled canopy mesh at all deploy levels.
 */
export const DEPLOY_CHORD_OFFSET = 0.15

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
 * @param rollDeg          Arc angle θ_arc [deg] — NOT Euler φ. Geometric station along
 *                         curved canopy span. 0° center, ±12/24/36° for outer cells.
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
  constants?: ControlConstants,
): AeroSegment {
  const ctrl = constants ?? DEFAULT_CONSTANTS
  const theta = rollDeg * DEG2RAD

  // Full-flight reference values (deploy = 1) — captured at factory time
  const fullS = cellPolar.s
  const fullChord = cellPolar.chord
  const fullX = position.x
  const fullY = position.y

  return {
    name,
    position: { ...position },
    orientation: { roll_deg: rollDeg },
    S: cellPolar.s,
    chord: cellPolar.chord,
    polar: cellPolar,

    /**
     * Get AC position in meters based on current deploy state.
     * At deploy=0 (line stretch), canopy is bundled: span/chord collapse.
     * At deploy=1 (full flight), positions match full-flight calibration.
     */
    getPositionMeters(controls: SegmentControls, massRef_m: number) {
      const d = Math.max(0, Math.min(1, controls.deploy))
      const spanScale = 0.1 + 0.9 * d    // span: 10% → 100%
      const chordScale = 0.3 + 0.7 * d   // chord: 30% → 100%
      const chordOffset = DEPLOY_CHORD_OFFSET * (1 - d)  // forward shift at low deploy

      return {
        x: (fullX + chordOffset) * massRef_m * chordScale,
        y: fullY * massRef_m * spanScale,
        z: position.z * massRef_m,  // line length is constant
      }
    },

    getCoeffs(alpha_deg: number, beta_deg: number, controls: SegmentControls) {
      // Use this.polar so debug overrides applied to seg.polar take effect
      const polar = this.polar ?? cellPolar

      // ── Deployment scaling ──
      const d = Math.max(0, Math.min(1, controls.deploy))
      const spanScale  = 0.1 + 0.9 * d         // min 10% span
      const chordScale = 0.3 + 0.7 * d         // min 30% chord
      const chordOffset = DEPLOY_CHORD_OFFSET * (1 - d)  // lerp to zero at full deploy
      this.S = fullS * chordScale * spanScale   // area = chord × span
      this.chord = fullChord * chordScale       // chord scales with chordScale
      this.position.x = fullX + chordOffset     // shift forward to track scaled GLB
      this.position.y = fullY * spanScale       // span collapses
      // position.z (vertical) stays fixed — line length is constant

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
      const deltaAlphaRiser = (-frontRiser + rearRiser) * ctrl.ALPHA_MAX_RISER * riserSensitivity
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
      const deltaAlphaBrake = brakeInput * brakeSensitivity * ctrl.BRAKE_ALPHA_COUPLING_DEG

      // ── Evaluate Kirchhoff model at (α_effective + brake α coupling, β_local, δ_effective) ──
      // During deployment, morph polar coefficients to model uninflated fabric
      const evalPolar = d < 1 ? {
        ...polar,
        cd_0: polar.cd_0 * (DEPLOY_CD0_MULTIPLIER + (1 - DEPLOY_CD0_MULTIPLIER) * d),
        cl_alpha: polar.cl_alpha * (DEPLOY_CL_ALPHA_FRACTION + (1 - DEPLOY_CL_ALPHA_FRACTION) * d),
        cd_n: polar.cd_n * (DEPLOY_CD_N_MULTIPLIER + (1 - DEPLOY_CD_N_MULTIPLIER) * d),
        alpha_stall_fwd: polar.alpha_stall_fwd + DEPLOY_STALL_FWD_OFFSET * (1 - d),
        s1_fwd: polar.s1_fwd * (DEPLOY_S1_FWD_MULTIPLIER + (1 - DEPLOY_S1_FWD_MULTIPLIER) * d),
      } : polar
      const c = getAllCoefficients(alphaEffective + deltaAlphaBrake, betaLocal, deltaEffective, evalPolar)
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
 * @param pivot           Optional NED pivot point for position rotation when
 *                        pilotPitch changes (e.g. riser attachment point).
 */
export function makeLiftingBodySegment(
  name: string,
  position: { x: number; y: number; z: number },
  bodyPolar: ContinuousPolar,
  pitchOffset_deg: number = 0,
  pivot?: { x: number; z: number },
): AeroSegment {
  // Store neutral position for pivot-based rotation
  const neutralX = position.x
  const neutralZ = position.z

  return {
    name,
    position: { ...position },
    orientation: { roll_deg: 0 },
    S: bodyPolar.s,
    chord: bodyPolar.chord,
    pitchOffset_deg,
    polar: bodyPolar,

    /**
     * Get AC position in meters based on pilot pitch.
     * Pilot swings around riser pivot when pitching.
     */
    getPositionMeters(controls: SegmentControls, massRef_m: number) {
      let x = neutralX
      let z = neutralZ

      // Rotate position around pivot when pilot pitches
      if (pivot && Math.abs(controls.pilotPitch) > 0.01) {
        const delta = controls.pilotPitch * Math.PI / 180
        const cos_d = Math.cos(delta)
        const sin_d = Math.sin(delta)
        const dx = neutralX - pivot.x
        const dz = neutralZ - pivot.z
        x = dx * cos_d - dz * sin_d + pivot.x
        z = dx * sin_d + dz * cos_d + pivot.z
      }

      return {
        x: x * massRef_m,
        y: position.y * massRef_m,
        z: z * massRef_m,
      }
    },

    getCoeffs(alpha_deg: number, beta_deg: number, controls: SegmentControls) {
      // Use this.polar so debug overrides applied to seg.polar take effect
      const polar = this.polar ?? bodyPolar

      // Dynamic pilot pitch — adds to the fixed pitch offset for coefficient eval.
      // pitchOffset_deg stays at the base value (used for chord direction in rendering).
      // The additional rotation is stored in _chordRotationRad for CP computation.
      const effectivePitchOffset = pitchOffset_deg + controls.pilotPitch

      // Store chord rotation for rendering/physics CP computation.
      // The AC position rotates by δ around the pivot; the chord offset
      // must also be rotated by δ so the full chord line swings rigidly.
      ;(this as any)._chordRotationRad = controls.pilotPitch * Math.PI / 180

      // Rotate position around pivot when pilot pitches.
      // Same rotation as rotatePilotMass() — the AC
      // swings around the riser attachment point.
      if (pivot && Math.abs(controls.pilotPitch) > 0.01) {
        const delta = controls.pilotPitch * Math.PI / 180
        const cos_d = Math.cos(delta)
        const sin_d = Math.sin(delta)
        const dx = neutralX - pivot.x
        const dz = neutralZ - pivot.z
        this.position.x = dx * cos_d - dz * sin_d + pivot.x
        this.position.z = dx * sin_d + dz * cos_d + pivot.z
      } else {
        this.position.x = neutralX
        this.position.z = neutralZ
      }

      // Transform freestream α to the segment's local frame.
      const localAlpha = alpha_deg - effectivePitchOffset
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
 * @param pivot            Optional NED pivot point for position rotation when
 *                         pilotPitch changes (e.g. riser attachment point).
 */
export function makeUnzippablePilotSegment(
  name: string,
  position: { x: number; y: number; z: number },
  zippedPolar: ContinuousPolar,
  unzippedPolar: ContinuousPolar,
  pitchOffset_deg: number = 0,
  pivot?: { x: number; z: number },
): AeroSegment {
  // Store neutral position for pivot-based rotation
  const neutralX = position.x
  const neutralZ = position.z

  return {
    name,
    position: { ...position },
    orientation: { roll_deg: 0 },
    S: zippedPolar.s,
    chord: zippedPolar.chord,
    pitchOffset_deg,
    polar: zippedPolar,

    /**
     * Get AC position in meters based on pilot pitch.
     * Pilot swings around riser pivot when pitching.
     */
    getPositionMeters(controls: SegmentControls, massRef_m: number) {
      let x = neutralX
      let z = neutralZ

      // Rotate position around pivot when pilot pitches
      if (pivot && Math.abs(controls.pilotPitch) > 0.01) {
        const delta = controls.pilotPitch * Math.PI / 180
        const cos_d = Math.cos(delta)
        const sin_d = Math.sin(delta)
        const dx = neutralX - pivot.x
        const dz = neutralZ - pivot.z
        x = dx * cos_d - dz * sin_d + pivot.x
        z = dx * sin_d + dz * cos_d + pivot.z
      }

      return {
        x: x * massRef_m,
        y: position.y * massRef_m,
        z: z * massRef_m,
      }
    },

    getCoeffs(alpha_deg: number, beta_deg: number, controls: SegmentControls) {
      const t = Math.max(0, Math.min(1, controls.unzip))

      // Blend polars — at t=0 this is zippedPolar, at t=1 it's unzippedPolar
      const blended = t === 0 ? (this.polar ?? zippedPolar)
                    : t === 1 ? unzippedPolar
                    : lerpPolar(t, this.polar ?? zippedPolar, unzippedPolar)

      // Update segment's S and chord so computeSegmentForce uses correct scaling
      this.S = blended.s
      this.chord = blended.chord

      // Dynamic pilot pitch — adds to the fixed pitch offset for coefficient eval.
      // pitchOffset_deg stays at the base value (used for chord direction in rendering).
      const effectivePitchOffset = pitchOffset_deg + controls.pilotPitch

      // Store chord rotation for rendering/physics CP computation.
      ;(this as any)._chordRotationRad = controls.pilotPitch * Math.PI / 180

      // Rotate position around pivot when pilot pitches.
      // Same rotation as rotatePilotMass() — the AC
      // swings around the riser attachment point.
      if (pivot && Math.abs(controls.pilotPitch) > 0.01) {
        const delta = controls.pilotPitch * Math.PI / 180
        const cos_d = Math.cos(delta)
        const sin_d = Math.sin(delta)
        const dx = neutralX - pivot.x
        const dz = neutralZ - pivot.z
        this.position.x = dx * cos_d - dz * sin_d + pivot.x
        this.position.z = dx * sin_d + dz * cos_d + pivot.z
      } else {
        this.position.x = neutralX
        this.position.z = neutralZ
      }

      const localAlpha = alpha_deg - effectivePitchOffset
      const c = getAllCoefficients(localAlpha, beta_deg, controls.delta, blended, controls.dirty)
      return { cl: c.cl, cd: c.cd, cy: c.cy, cm: c.cm, cp: c.cp }
    },
  }
}

// ─── Brake Flap Segment ─────────────────────────────────────────────────────

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
 * @param rollDeg           Arc angle θ_arc [deg] — NOT Euler φ. Same as parent cell.
 * @param side              Which side for control routing (same as parent cell)
 * @param brakeSensitivity  Brake cascade factor (same as parent cell)
 * @param flapChordFraction Maximum flap chord / cell chord at full brake (outer=0.30, inner=0.10)
 * @param parentCellS       Parent cell reference area [m²]
 * @param parentCellChord   Parent cell chord [m]
 * @param parentCellX       Parent cell x-position [normalized NED]
 * @param flapPolar         ContinuousPolar for the flap panel
 * @param referenceLength   Reference length for position normalization [m]
 * @param constants         Optional control constants
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
  parentCellX: number,
  flapPolar: ContinuousPolar,
  referenceLength: number,
  constants?: ControlConstants,
): AeroSegment {
  const ctrl = constants ?? DEFAULT_CONSTANTS
  const theta = rollDeg * DEG2RAD

  // Full-flight flap geometry (deploy = 1) — captured at factory time
  const fullMaxFlapS = flapChordFraction * parentCellS
  const fullMaxFlapChord = flapChordFraction * parentCellChord
  // CP shift at full brake = quarter chord of the PARENT cell.
  // The flap CP travels from the trailing edge toward the cell quarter-chord
  // as the fabric distorts under brake input.
  const fullMaxCpShift = 0.25 * parentCellChord / referenceLength

  // Roll increment sign — deepens the arc in the same direction as the base roll.
  const rollSign = rollDeg >= 0 ? 1 : -1

  // Full-flight trailing edge position (deploy = 1)
  const fullTeX = trailingEdgePos.x
  const fullTeY = trailingEdgePos.y
  const teZ = trailingEdgePos.z

  return {
    name,
    position: { ...trailingEdgePos },
    orientation: { roll_deg: rollDeg },
    S: 0,               // starts at zero — grows with brake input
    chord: 0,
    polar: flapPolar,

    /**
     * Get AC position in meters based on deploy and brake state.
     * Flap positions depend on both deployment scaling and brake input.
     */
    getPositionMeters(controls: SegmentControls, massRef_m: number) {
      const d = Math.max(0, Math.min(1, controls.deploy))
      const spanScale = 0.1 + 0.9 * d
      const chordScale = 0.3 + 0.7 * d
      const chordOffset = DEPLOY_CHORD_OFFSET * (1 - d)

      // Brake input from side routing
      const brakeInput = side === 'right' ? controls.brakeRight : controls.brakeLeft
      const effectiveBrake = brakeInput * brakeSensitivity

      // Flap chord and CP shift scale with deployment
      const maxFlapChord = fullMaxFlapChord * chordScale
      const maxCpShift = fullMaxCpShift * chordScale
      const cpShift = effectiveBrake * maxCpShift

      // Dynamic position: TE to cell center with chord offset
      const teX = parentCellX + chordOffset + (fullTeX - parentCellX) * chordScale + cpShift

      return {
        x: teX * massRef_m,
        y: fullTeY * spanScale * massRef_m,
        z: teZ * massRef_m,
      }
    },

    getCoeffs(alpha_deg: number, beta_deg: number, controls: SegmentControls) {
      // ── Deployment scaling ──
      const d = Math.max(0, Math.min(1, controls.deploy))
      const spanScale  = 0.1 + 0.9 * d                   // min 10% span
      const chordScale = 0.3 + 0.7 * d                   // min 30% chord
      const chordOffset = DEPLOY_CHORD_OFFSET * (1 - d)   // same forward shift as cells
      const maxFlapS = fullMaxFlapS * chordScale * spanScale  // area = chord × span
      const maxFlapChord = fullMaxFlapChord * chordScale   // chord scales with chordScale
      const maxCpShift = fullMaxCpShift * chordScale       // CP shift scales with chord
      const teX = parentCellX + chordOffset + (fullTeX - parentCellX) * chordScale  // TE toward quarter-chord + offset
      this.position.y = fullTeY * spanScale                // trailing edge y collapses

      // ── Brake input from side routing ──
      const brakeInput = side === 'right' ? controls.brakeRight : controls.brakeLeft
      const effectiveBrake = brakeInput * brakeSensitivity

      // ── Variable area and chord ──
      // Flap area grows from 0 to maxFlapS as brake is applied
      this.S = effectiveBrake * maxFlapS
      this.chord = effectiveBrake * maxFlapChord

      // ── Dynamic position ──
      // At zero brake: position is at the trailing edge.
      // As brake increases: CP moves forward toward the cell quarter-chord (nose).
      // In NED: nose is less-negative x, TE is more-negative x.
      // cpShift is positive → moves toward nose (less negative x). 
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
      const rollIncrement = effectiveBrake * ctrl.MAX_FLAP_ROLL_INCREMENT_DEG * rollSign
      const effectiveTheta = theta + rollIncrement * DEG2RAD

      // ── Local flow angles from dynamic roll orientation ──
      const alphaLocal = alpha_deg * Math.cos(effectiveTheta) + beta_deg * Math.sin(effectiveTheta)
      const betaLocal = -alpha_deg * Math.sin(effectiveTheta) + beta_deg * Math.cos(effectiveTheta)

      // Update orientation for downstream consumers (vectors, debug panel)
      this.orientation = { roll_deg: rollDeg + rollIncrement }

      // ── Flap deflection angle ──
      // The trailing edge rotates downward with brake input.
      // This increases the local α seen by the flap surface.
      const flapDeflection = effectiveBrake * ctrl.MAX_FLAP_DEFLECTION_DEG
      const alphaFlap = alphaLocal + flapDeflection

      // ── Evaluate Kirchhoff model at the flap's angle ──
      // During deployment, morph polar coefficients (same as cell segments)
      const basePolar = this.polar ?? flapPolar
      const evalPolar = d < 1 ? {
        ...basePolar,
        cd_0: basePolar.cd_0 * (DEPLOY_CD0_MULTIPLIER + (1 - DEPLOY_CD0_MULTIPLIER) * d),
        cl_alpha: basePolar.cl_alpha * (DEPLOY_CL_ALPHA_FRACTION + (1 - DEPLOY_CL_ALPHA_FRACTION) * d),
        cd_n: basePolar.cd_n * (DEPLOY_CD_N_MULTIPLIER + (1 - DEPLOY_CD_N_MULTIPLIER) * d),
        alpha_stall_fwd: basePolar.alpha_stall_fwd + DEPLOY_STALL_FWD_OFFSET * (1 - d),
        s1_fwd: basePolar.s1_fwd * (DEPLOY_S1_FWD_MULTIPLIER + (1 - DEPLOY_S1_FWD_MULTIPLIER) * d),
      } : basePolar
      const c = getAllCoefficients(alphaFlap, betaLocal, 0, evalPolar)

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

// ─── Wingsuit Segment Constants ──────────────────────────────────────────────

/**
 * Tunable constants for wingsuit throttle control response.
 * These map pitchThrottle / yawThrottle / rollThrottle to per-segment
 * aerodynamic parameter changes (α offset, CP shift, dirty coupling, etc.).
 */
export interface WingsuitControlConstants {
  // ── Pitch throttle ──
  /** Max LE α change at full pitch input [deg] */
  PITCH_ALPHA_MAX_DEG: number
  /** Max CP shift at full pitch input [chord fraction] */
  PITCH_CP_SHIFT: number
  /** Max cl_alpha change at full pitch input [1/rad] */
  PITCH_CL_ALPHA_DELTA: number
  /** Max cd_0 increase at pitch extremes */
  PITCH_CD0_DELTA: number

  // ── Yaw throttle ──
  /** Lateral CP shift for body segment at full yaw [NED y, normalized] */
  YAW_BODY_Y_SHIFT: number
  /** Lateral head shift at full yaw [NED y, normalized] */
  YAW_HEAD_Y_SHIFT: number
  /** Differential α from body twist at full yaw [deg] */
  YAW_ROLL_COUPLING_DEG: number
  /** Differential dirty coupling from yaw throttle */
  YAW_DIRTY_COUPLING: number

  // ── Roll throttle ──
  /** Differential α at full roll input [deg] — outer wings see more */
  ROLL_ALPHA_MAX_DEG: number
  /** Differential cl_alpha change at full roll [1/rad] */
  ROLL_CL_ALPHA_DELTA: number
  /** Differential cd_0 from adverse yaw at full roll */
  ROLL_CD0_DELTA: number
  /** Differential dirty coupling from roll throttle */
  ROLL_DIRTY_COUPLING: number

  // ── Dihedral ──
  /** Max inner wing dihedral at slider=1 [deg] */
  DIHEDRAL_INNER_MAX_DEG: number
  /** Max outer wing dihedral at slider=1 [deg] */
  DIHEDRAL_OUTER_MAX_DEG: number
}

/** Default wingsuit control constants — conservative starting point. */
export const DEFAULT_WINGSUIT_CONSTANTS: WingsuitControlConstants = {
  PITCH_ALPHA_MAX_DEG: 3.5,
  PITCH_CP_SHIFT: 0.13,
  PITCH_CL_ALPHA_DELTA: 0.2,
  PITCH_CD0_DELTA: 0.01,

  YAW_BODY_Y_SHIFT: 0.03,
  YAW_HEAD_Y_SHIFT: 0.02,
  YAW_ROLL_COUPLING_DEG: 0.3,
  YAW_DIRTY_COUPLING: 0.15,

  ROLL_ALPHA_MAX_DEG: 0.8,
  ROLL_CL_ALPHA_DELTA: 0.15,
  ROLL_CD0_DELTA: 0.005,
  ROLL_DIRTY_COUPLING: 0.10,

  DIHEDRAL_INNER_MAX_DEG: 16,
  DIHEDRAL_OUTER_MAX_DEG: 30,
}

// ─── Wingsuit Head Segment ───────────────────────────────────────────────────

/**
 * Build the wingsuit head (parasitic bluff body / rudder).
 *
 * Primarily drag. Acts as a rudder in sideslip because it sits far forward
 * of the CG. Responds to yawThrottle via lateral position shift.
 *
 * @param name       Segment name (e.g. 'head')
 * @param position   NED body-frame position (normalized)
 * @param S          Reference area [m²]
 * @param chord      Reference chord [m]
 * @param cd         Base drag coefficient (~0.47 sphere)
 * @param constants  Wingsuit control constants
 */
export function makeWingsuitHeadSegment(
  name: string,
  position: { x: number; y: number; z: number },
  S: number,
  chord: number,
  cd: number,
  constants?: WingsuitControlConstants,
): AeroSegment {
  const ctrl = constants ?? DEFAULT_WINGSUIT_CONSTANTS
  const baseY = position.y

  // Minimal polar so debug overrides can set cd_0 via the standard seg.polar pipeline
  const headPolar = { cd_0: cd } as ContinuousPolar

  return {
    name,
    position: { ...position },
    orientation: { roll_deg: 0 },
    S,
    chord,
    polar: headPolar,

    getCoeffs(_alpha_deg: number, beta_deg: number, controls: SegmentControls) {
      // Head shifts laterally with yaw throttle
      this.position.y = baseY + controls.yawThrottle * ctrl.YAW_HEAD_Y_SHIFT

      // Read cd_0 from this.polar so debug overrides take effect
      const cdEff = this.polar?.cd_0 ?? cd

      // In sideslip the sphere generates a side force (rudder effect)
      const beta_rad = beta_deg * DEG2RAD
      const cy = -0.5 * Math.sin(beta_rad)  // sphere side force ~ sin(β)

      return { cl: 0, cd: cdEff, cy, cm: 0, cp: 0.5 }
    },
  }
}

// ─── Wingsuit Body/Wing Segment ──────────────────────────────────────────────

/**
 * Build a wingsuit lifting body segment (center body or wing panel).
 *
 * Evaluates the full Kirchhoff model at freestream α/β with throttle
 * modifications. Each segment responds to:
 * - pitchThrottle: α offset + CP shift (all lifting segments)
 * - yawThrottle: lateral CP shift (body), differential dirty (wings)
 * - rollThrottle: differential α/camber across L/R wings
 * - dihedral: sets wing roll angle (wing segments only)
 * - dirty: per-segment tension loss
 *
 * @param name              Segment name (e.g. 'center', 'r1', 'l1')
 * @param position          NED body-frame position (normalized)
 * @param baseRollDeg       Base roll angle at dihedral=0 [deg] (0 for body, used as sign for wings)
 * @param side              Which side: 'center', 'right', or 'left'
 * @param segmentPolar      This segment's ContinuousPolar
 * @param rollSensitivity   Roll throttle sensitivity (0.6 inner, 1.0 outer)
 * @param wingType          'body' | 'inner' | 'outer' — determines dihedral scaling
 * @param constants         Wingsuit control constants
 */
export function makeWingsuitLiftingSegment(
  name: string,
  position: { x: number; y: number; z: number },
  baseRollDeg: number,
  side: 'center' | 'right' | 'left',
  segmentPolar: ContinuousPolar,
  rollSensitivity: number,
  wingType: 'body' | 'inner' | 'outer',
  constants?: WingsuitControlConstants,
): AeroSegment {
  const ctrl = constants ?? DEFAULT_WINGSUIT_CONSTANTS
  const baseY = position.y
  const sideSign = side === 'right' ? 1 : side === 'left' ? -1 : 0

  return {
    name,
    position: { ...position },
    orientation: { roll_deg: baseRollDeg },
    S: segmentPolar.s,
    chord: segmentPolar.chord,
    polar: segmentPolar,

    getCoeffs(alpha_deg: number, beta_deg: number, controls: SegmentControls) {
      const polar = this.polar ?? segmentPolar

      // ── Dihedral → roll angle ──
      const dihedral = Math.max(0, Math.min(1, controls.dihedral))
      let rollDeg = 0
      if (wingType === 'inner') {
        rollDeg = sideSign * ctrl.DIHEDRAL_INNER_MAX_DEG * dihedral
      } else if (wingType === 'outer') {
        rollDeg = sideSign * ctrl.DIHEDRAL_OUTER_MAX_DEG * dihedral
      }
      this.orientation = { roll_deg: rollDeg }
      const theta = rollDeg * DEG2RAD

      // ── Local flow angles from dihedral roll ──
      const alphaLocal = alpha_deg * Math.cos(theta) + beta_deg * Math.sin(theta)
      const betaLocal = -alpha_deg * Math.sin(theta) + beta_deg * Math.cos(theta)

      // ── Pitch throttle → α offset + CP shift ──
      const pitchT = Math.max(-1, Math.min(1, controls.pitchThrottle))
      const deltaAlphaPitch = pitchT * ctrl.PITCH_ALPHA_MAX_DEG

      // ── Roll throttle → differential α ──
      const rollT = Math.max(-1, Math.min(1, controls.rollThrottle))
      // Positive rollThrottle → right side gets +α, left gets -α
      const deltaAlphaRoll = rollT * ctrl.ROLL_ALPHA_MAX_DEG * rollSensitivity * sideSign

      // ── Yaw throttle → differential α coupling (body twist) ──
      const yawT = Math.max(-1, Math.min(1, controls.yawThrottle))
      const deltaAlphaYaw = yawT * ctrl.YAW_ROLL_COUPLING_DEG * sideSign

      // ── Total α offset ──
      const alphaEffective = alphaLocal + deltaAlphaPitch + deltaAlphaRoll + deltaAlphaYaw

      // ── Yaw throttle → lateral body shift (body segment only) ──
      if (wingType === 'body') {
        this.position.y = baseY + yawT * ctrl.YAW_BODY_Y_SHIFT
      }

      // ── Dirty coupling from throttle inputs ──
      // Yaw throttle loosens one side, tightens the other
      // Roll throttle changes tension differentially
      const dirtyBase = Math.max(0, Math.min(1, controls.dirty))
      const dirtyYaw = yawT * ctrl.YAW_DIRTY_COUPLING * sideSign
      const dirtyRoll = Math.abs(rollT) * ctrl.ROLL_DIRTY_COUPLING
      const dirtyEff = Math.max(0, Math.min(1, dirtyBase + dirtyYaw + dirtyRoll))

      // ── Evaluate Kirchhoff model ──
      const c = getAllCoefficients(alphaEffective, betaLocal, controls.delta, polar, dirtyEff)

      // ── Pitch throttle CP shift ──
      const cpShift = pitchT * ctrl.PITCH_CP_SHIFT
      const cp = c.cp + cpShift

      // ── Lift-vector tilt from dihedral ──
      // A rolled panel's lift decomposes into vertical (CL) and lateral (CY) components
      const cosT = Math.cos(theta)
      const sinT = Math.sin(theta)
      const cl = c.cl * cosT
      const cy = c.cy + c.cl * sinT

      return { cl, cd: c.cd, cy, cm: c.cm, cp }
    },
  }
}
