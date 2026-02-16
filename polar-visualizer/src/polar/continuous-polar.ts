/**
 * ContinuousPolar — Full-range aerodynamic polar model
 * 
 * This module is UI-independent. It will eventually be copied into CloudBASE.
 * No Three.js, DOM, or rendering dependencies allowed here.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Coefficients {
  cl: number
  cd: number
}

export interface SustainedSpeeds {
  vxs: number
  vys: number
}

export interface FullCoefficients {
  cl: number
  cd: number
  cy: number
  cm: number
  cn: number     // yaw moment coefficient (+ nose right)
  cl_roll: number // roll moment coefficient (+ right wing down)
  cp: number
  f: number   // separation function value
}

/**
 * Mass segment — a single point-mass in the body mass model.
 *
 * Positions are height-normalized and in the NED body frame:
 *   x = forward (head direction), y = right, z = down
 *
 * Mass ratios are fractions of polar.m (total system mass).
 * They sum to ~1.0 for a complete model.
 */
export interface MassSegment {
  name: string
  massRatio: number
  normalizedPosition: { x: number; y: number; z: number }
}

/**
 * Symmetric (δ) control derivatives — how a single control axis
 * morphs the base polar parameters.  P(δ) = P_base + δ · d_P
 */
export interface SymmetricControl {
  d_alpha_0?: number         // Δα_0 per unit δ [deg] (brakes: negative = more camber)
  d_cd_0?: number            // ΔCD_0 per unit δ
  d_cl_alpha?: number        // ΔCL_α per unit δ [1/rad]
  d_k?: number               // ΔK per unit δ
  d_alpha_stall_fwd?: number // Δα_stall_fwd per unit δ [deg]
  d_alpha_stall_back?: number // Δα_stall_back per unit δ [deg]
  d_cd_n?: number            // ΔCD_n per unit δ
  d_cp_0?: number            // ΔCP_0 per unit δ (direct CP shift, fraction of chord)
  d_cp_alpha?: number        // ΔCP_α per unit δ (reduces CP travel with α)
  cm_delta?: number          // ΔCM per unit δ (pitch moment from control)
}

/**
 * The core continuous polar definition.
 * 
 * All angles in radians in the math; stored as degrees in the interface
 * for human readability (converted at evaluation time).
 */
export interface ContinuousPolar {
  // Identity
  name: string
  type: 'Wingsuit' | 'Canopy' | 'Slick' | 'Tracking' | 'Airplane' | 'Other'

  // Attached-flow lift model
  cl_alpha: number        // Lift curve slope [1/rad]
  alpha_0: number         // Zero-lift AOA [deg]

  // Drag model
  cd_0: number            // Parasitic (zero-lift) drag coefficient
  k: number               // Induced drag factor: CD = CD_0 + K * CL^2

  // Flat-plate / separated flow
  cd_n: number            // Normal-force drag coefficient (broadside, ~1.2–2.0)
  cd_n_lateral: number    // Lateral broadside drag (for sideslip)

  // Forward stall
  alpha_stall_fwd: number    // Forward stall angle [deg]
  s1_fwd: number             // Forward stall sigmoid sharpness [deg]

  // Back stall
  alpha_stall_back: number   // Back-stall angle [deg]
  s1_back: number            // Back-stall sigmoid sharpness [deg]

  // Side force & moments
  cy_beta: number         // Side force derivative [1/rad]
  cn_beta: number         // Yaw moment derivative [1/rad] (+ nose right = stable)
  cl_beta: number         // Roll moment derivative [1/rad] (+ right wing down)

  // Pitching moment (attached flow)
  cm_0: number            // Zero-alpha pitching moment
  cm_alpha: number        // Pitching moment slope [1/rad]

  // Center of pressure (attached flow, as fraction of chord from leading edge)
  cp_0: number            // CP at zero alpha
  cp_alpha: number        // CP shift per radian of alpha [1/rad]

  // Center of gravity (fraction of chord from leading edge)
  cg: number              // CG location (e.g. 0.30 for airplane, 0.45 for wingsuit)

  // Lateral center of pressure (fraction of chord from LE, for side force origin)
  cp_lateral: number      // Lateral CP (typically near CG for symmetric bodies)

  // Physical
  s: number               // Reference area [m²]
  m: number               // Mass [kg]
  chord: number           // Reference chord / body length [m]

  // Control dimension (optional — δ morphs these derivatives)
  controls?: {
    brake?: SymmetricControl
    front_riser?: SymmetricControl
    rear_riser?: SymmetricControl
    dirty?: SymmetricControl      // Wingsuit: dirty flying (reduced efficiency)
  }

  // Mass distribution (optional — point-mass models)
  massSegments?: MassSegment[]         // Weight segments (contribute to gravitational force)
  inertiaMassSegments?: MassSegment[]  // Inertia segments (contribute to rotational inertia, includes buoyant masses)

  // CG offset from bbox center as fraction of body length along flight axis.
  // Used by model-loader to shift the 3D mesh so CG sits at the scene origin.
  cgOffsetFraction?: number

  // Aerodynamic segment breakdown (optional — enables per-segment rendering)
  aeroSegments?: AeroSegment[]
}

// ─── Aerodynamic Segments ────────────────────────────────────────────────────

/**
 * A single aerodynamic segment — a surface, body, or sub-wing panel
 * that produces forces at a known position in the body frame.
 *
 * All positions are NED body-frame, normalized by reference height (1.875 m),
 * matching the MassSegment convention.
 *
 * Each canopy cell segment has its own ContinuousPolar and computes
 * its own local α, β, and δ based on cell orientation and control inputs.
 * Parasitic bodies (lines, pilot, bridle) use simple constant coefficients.
 *
 * Forces from all segments are summed at the combined canopy-pilot CG
 * using rigid-body equations.
 */
export interface AeroSegment {
  /** Human-readable name (e.g. 'cell_c', 'cell_r1', 'lines', 'pilot') */
  name: string

  /** Aerodynamic center position in NED body frame (normalized) */
  position: { x: number; y: number; z: number }

  /**
   * Cell orientation from arc geometry.
   * roll_deg: arc angle θ — 0° at center, ±12°/24°/36° at outer cells.
   *           Determines how freestream α, β map to local flow angles.
   * pitch_deg: optional incidence offset (washout, trim tab, etc.)
   *
   * For non-canopy segments (lines, pilot, bridle), orientation is
   * { roll_deg: 0 } — they see freestream directly.
   */
  orientation: { roll_deg: number; pitch_deg?: number }

  /** Reference area [m²] for this segment */
  S: number

  /** Segment chord [m] — for local CM calculation (moment = q·S·c·CM) */
  chord: number

  /**
   * Pitch offset of this segment relative to the canopy body frame [deg].
   *
   * A canopy pilot hanging vertically is rotated +90° in pitch compared
   * to a prone wingsuit pilot. The freestream α is transformed by this
   * offset before evaluating the segment's polar:
   *   α_local = α_freestream - pitchOffset_deg
   *
   * Also rotates the CP offset direction: a 90° pitch means the chord
   * runs along NED z (vertical) instead of NED x (forward).
   *
   * Default: 0 (no rotation — segment aligned with body frame).
   */
  pitchOffset_deg?: number

  /**
   * This segment's own ContinuousPolar, if applicable.
   *
   * Canopy cell segments: each cell has its own polar with its own
   * aerodynamic parameters. All 7 cells typically share the same base
   * airfoil profile, but each evaluates coefficients independently at
   * its own local α, β, δ.
   *
   * Parasitic bodies: undefined — they use constant coefficients.
   */
  polar?: ContinuousPolar

  /**
   * Evaluate coefficients at given FREESTREAM flow conditions.
   *
   * For canopy cells, this function internally:
   * 1. Transforms freestream α, β into local α_local, β_local
   *    based on this cell's orientation (arc angle θ)
   * 2. Applies any riser-induced α offset (Δα from front/rear riser)
   * 3. Determines the local δ (camber change) from brake inputs
   *    and this cell's position in the brake cascade
   * 4. Evaluates cell's own ContinuousPolar at (α_effective, β_local, δ)
   * 5. Returns coefficients + center of pressure for this segment
   *
   * For parasitic bodies, returns constant CD (ignores controls).
   *
   * @param alpha_deg  Freestream angle of attack [deg]
   * @param beta_deg   Freestream sideslip angle [deg]
   * @param controls   Current control inputs
   * @returns coefficients + center of pressure (chord fraction)
   */
  getCoeffs(
    alpha_deg: number,
    beta_deg: number,
    controls: SegmentControls,
  ): {
    cl: number    // lift coefficient
    cd: number    // drag coefficient
    cy: number    // side force coefficient
    cm: number    // pitching moment coefficient (about segment AC)
    cp: number    // center of pressure (chord fraction, for force application)
  }
}

// ─── Segment Controls ────────────────────────────────────────────────────────

/**
 * All possible control inputs, passed to every segment.
 * Each segment picks the controls it responds to and ignores the rest.
 *
 * Canopy cells respond to brake and riser inputs on their side.
 * Airplane segments respond to elevator, rudder, flap deflections.
 * Pilot body responds to weight shift.
 * Simple drag bodies (lines, bridle) ignore controls entirely.
 *
 * Values are normalized: 0 = neutral, +1 = full deflection.
 * Negative values allowed where meaningful (e.g. speed bar = negative front riser).
 */
export interface SegmentControls {
  // ── Canopy inputs (6 total) ──
  brakeLeft: number       // 0–1, left brake toggle
  brakeRight: number      // 0–1, right brake toggle
  frontRiserLeft: number  // 0–1, left front riser
  frontRiserRight: number // 0–1, right front riser
  rearRiserLeft: number   // 0–1, left rear riser
  rearRiserRight: number  // 0–1, right rear riser

  // ── Pilot body inputs ──
  weightShiftLR: number   // -1 (left) to +1 (right), lateral weight shift

  // ── Airplane inputs ──
  elevator: number        // -1 to +1, elevator deflection
  rudder: number          // -1 to +1, rudder deflection
  aileronLeft: number     // -1 to +1, left aileron
  aileronRight: number    // -1 to +1, right aileron
  flap: number            // 0–1, flap deflection (symmetric)

  // ── Universal ──
  delta: number           // Generic symmetric control (current δ slider — arch, brakes, etc.)
  dirty: number           // Wingsuit dirty-flying factor
  unzip: number           // Wingsuit unzip factor: 0 = zipped (wingsuit), 1 = unzipped (slick)
  pilotPitch: number      // Pilot body pitch relative to canopy [deg], 0 = hanging vertical
  deploy: number          // Canopy deployment fraction: 0 = line stretch, 1 = fully deployed
}
