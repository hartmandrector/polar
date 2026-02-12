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

  // Mass distribution (optional — point-mass model for inertia and overlay)
  massSegments?: MassSegment[]

  // CG offset from bbox center as fraction of body length along flight axis.
  // Used by model-loader to shift the 3D mesh so CG sits at the scene origin.
  cgOffsetFraction?: number
}
