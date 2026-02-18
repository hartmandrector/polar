/**
 * Apparent (added) mass model — virtual inertia from displaced air.
 *
 * When an accelerating body displaces air it must also accelerate
 * that air.  This is modelled as additional mass and inertia terms
 * that are added diagonally to the physical mass/inertia before
 * evaluating the EOM.
 *
 * See SIMULATION.md §12 for derivation and relevance table.
 *
 * Pure math — no Three.js, DOM, or rendering dependencies.
 * Portable to CloudBASE.
 */

import type { InertiaComponents } from './inertia.ts'

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Translational apparent-mass components [kg].
 *
 * Added diagonally to the physical mass in each body-axis equation:
 *   (m + m_a_x) * u̇ = F_x + ...
 *   (m + m_a_y) * v̇ = F_y + ...
 *   (m + m_a_z) * ẇ = F_z + ...
 */
export interface ApparentMass {
  /** Chordwise (x-body) apparent mass [kg] — small for thin canopy */
  x: number
  /** Spanwise (y-body) apparent mass [kg] — relevant for sideslip */
  y: number
  /** Normal (z-body) apparent mass [kg] — dominant term, disc of air */
  z: number
}

/**
 * Rotational apparent-inertia components [kg·m²].
 *
 * Added diagonally to the physical inertia tensor:
 *   (I_xx + I_a_xx) * ṗ = M_x + ...
 */
export interface ApparentInertia {
  /** Roll apparent inertia [kg·m²] */
  Ixx: number
  /** Pitch apparent inertia [kg·m²] */
  Iyy: number
  /** Yaw apparent inertia [kg·m²] */
  Izz: number
}

/**
 * Combined apparent-mass result.
 */
export interface ApparentMassResult {
  mass: ApparentMass
  inertia: ApparentInertia
}

// ─── Canopy Geometry ────────────────────────────────────────────────────────

/**
 * Parameters describing the canopy planform for apparent-mass calculation.
 */
export interface CanopyGeometry {
  /** Projected span [m] */
  span: number
  /** Mean aerodynamic chord [m] */
  chord: number
  /** Projected planform area [m²] (= span × chord for rectangular) */
  area: number
}

// ─── Flat-Plate Approximation ───────────────────────────────────────────────

/**
 * Compute translational apparent mass using the flat-plate approximation.
 *
 * For a thin canopy of span b and chord c:
 *
 *   m_a_z ≈ (π/4) · ρ · c² · b   — disc of air of diameter c
 *   m_a_y ≈ (π/4) · ρ · b² · c   — disc of air of diameter b
 *   m_a_x ≈ small (thin plate in its own plane), approximated as
 *           (π/4) · ρ · t² · S  where t ≈ 0.10·c (10% thickness)
 *
 * These are classical Lamb/Theodorsen results for flat plates and
 * thin ellipsoids in potential flow.
 *
 * @param geom  Canopy planform geometry
 * @param rho   Air density [kg/m³]
 * @returns Translational apparent mass components [kg]
 */
export function computeApparentMass(
  geom: CanopyGeometry,
  rho: number = 1.225,
): ApparentMass {
  const { span, chord } = geom
  const PI_4 = Math.PI / 4

  // Normal (z): disc of diameter = chord, length = span
  const z = PI_4 * rho * chord * chord * span

  // Spanwise (y): disc of diameter = span, length = chord
  const y = PI_4 * rho * span * span * chord

  // Chordwise (x): thin plate — use ~10% thickness ratio
  const t = 0.10 * chord
  const x = PI_4 * rho * t * t * span

  return { x, y, z }
}

/**
 * Compute rotational apparent inertia using strip theory.
 *
 * For rotation about each axis the apparent inertia is the integral
 * of the 2D added-mass distribution along the span/chord:
 *
 *   I_a_xx (roll):  ∫ m'_z(y) · y² dy ≈ (π/4) · ρ · c² · b³ / 12
 *   I_a_yy (pitch): ∫ m'_z(x) · x² dx ≈ (π/4) · ρ · b · c⁴ / 12
 *                   (assuming uniform section; x measured from mid-chord)
 *   I_a_zz (yaw):   ∫ m'_x(y) · y² dy ≈ small (thin-plate in-plane)
 *
 * These use the uniform strip assumption — adequate for a rectangular
 * ram-air canopy.
 *
 * @param geom  Canopy planform geometry
 * @param rho   Air density [kg/m³]
 * @returns Rotational apparent inertia components [kg·m²]
 */
export function computeApparentInertia(
  geom: CanopyGeometry,
  rho: number = 1.225,
): ApparentInertia {
  const { span, chord } = geom
  const PI_4 = Math.PI / 4

  // Roll: z-added-mass distributed along span, second moment about x-axis
  // ∫_{-b/2}^{b/2} (π/4 · ρ · c²) · y² dy = (π/4) · ρ · c² · b³ / 12
  const Ixx = PI_4 * rho * chord * chord * span * span * span / 12

  // Pitch: z-added-mass distributed along chord, second moment about y-axis
  // ∫_{-c/2}^{c/2} (π/4 · ρ · b) · x² dx = (π/4) · ρ · b · c⁴... wait
  // Actually the 2D section added mass per unit span is (π/4)·ρ·c²
  // For pitch about mid-chord:
  // I_a_yy = ∫_{-b/2}^{b/2} (added mass per unit span) · 0 dy — no, pitch
  // rotates about the y-axis, sweeping chord through air.
  // Per unit chord strip at position x from centre:
  //   dm_a = (π/4) · ρ · b · dx  (thin strip normal to x)
  //   dI = dm_a · x²
  //   I_a_yy = ∫_{-c/2}^{c/2} (π/4 · ρ · b) · x² dx = (π/4) · ρ · b · c³/12
  const Iyy = PI_4 * rho * span * chord * chord * chord / 12

  // Yaw: in-plane rotation, small — use thickness-based added mass
  const t = 0.10 * chord
  const Izz = PI_4 * rho * t * t * span * span * span / 12

  return { Ixx, Iyy, Izz }
}

/**
 * Compute both translational and rotational apparent mass/inertia.
 *
 * Convenience wrapper combining `computeApparentMass()` and
 * `computeApparentInertia()`.
 *
 * @param geom  Canopy planform geometry
 * @param rho   Air density [kg/m³]
 */
export function computeApparentMassResult(
  geom: CanopyGeometry,
  rho: number = 1.225,
): ApparentMassResult {
  return {
    mass: computeApparentMass(geom, rho),
    inertia: computeApparentInertia(geom, rho),
  }
}

// ─── Effective Mass / Inertia Helpers ───────────────────────────────────────

/**
 * Combine physical mass with apparent mass into effective mass per axis.
 *
 * Returns `{ x, y, z }` where each component is `m + m_a_axis`.
 * These effective masses replace `m` in the translational EOM
 * when apparent mass is enabled.
 *
 * @param physicalMass  Total system mass [kg]
 * @param apparent      Apparent mass components [kg]
 */
export function effectiveMass(
  physicalMass: number,
  apparent: ApparentMass,
): { x: number; y: number; z: number } {
  return {
    x: physicalMass + apparent.x,
    y: physicalMass + apparent.y,
    z: physicalMass + apparent.z,
  }
}

/**
 * Combine physical inertia tensor with apparent inertia.
 *
 * Apparent inertia is added only to the diagonal terms.
 * Off-diagonal terms (Ixy, Ixz, Iyz) are unchanged.
 *
 * @param physical  Physical inertia tensor
 * @param apparent  Apparent inertia components
 */
export function effectiveInertia(
  physical: InertiaComponents,
  apparent: ApparentInertia,
): InertiaComponents {
  return {
    Ixx: physical.Ixx + apparent.Ixx,
    Iyy: physical.Iyy + apparent.Iyy,
    Izz: physical.Izz + apparent.Izz,
    Ixy: physical.Ixy,
    Ixz: physical.Ixz,
    Iyz: physical.Iyz,
  }
}

/**
 * Derive canopy geometry from ContinuousPolar-level parameters.
 *
 * Many polars store `s` (reference area) and `chord` but not span.
 * Span is derived as `S / chord` (rectangular planform assumption).
 *
 * @param area   Reference planform area [m²]
 * @param chord  Mean aerodynamic chord [m]
 */
export function canopyGeometryFromPolar(
  area: number,
  chord: number,
): CanopyGeometry {
  return {
    span: area / chord,
    chord,
    area,
  }
}

/**
 * Scale apparent mass by deployment fraction.
 *
 * During deployment the canopy transitions from a packed bundle
 * (negligible apparent mass) to a fully inflated wing.  Both span
 * and chord scale with deployment:
 *
 *   span_eff  = span · (0.1 + 0.9 · deploy)   — matches polar-data spanScale
 *   chord_eff = chord · deploy                  — simplified: chord grows linearly
 *
 * The resulting geometry is fed to `computeApparentMassResult()` to get
 * deployment-dependent apparent mass.
 *
 * @param fullGeom  Fully-deployed canopy geometry
 * @param deploy    Deployment fraction 0–1
 * @param rho       Air density [kg/m³]
 */
export function apparentMassAtDeploy(
  fullGeom: CanopyGeometry,
  deploy: number,
  rho: number = 1.225,
): ApparentMassResult {
  const clampedDeploy = Math.max(0, Math.min(1, deploy))

  // Match the span scaling from rotatePilotMass() in polar-data.ts
  const spanScale = 0.1 + 0.9 * clampedDeploy
  const chordScale = 0.2 + 0.8 * clampedDeploy  // min 20% chord when packed

  const deployGeom: CanopyGeometry = {
    span: fullGeom.span * spanScale,
    chord: fullGeom.chord * chordScale,
    area: fullGeom.span * spanScale * fullGeom.chord * chordScale,
  }

  return computeApparentMassResult(deployGeom, rho)
}
