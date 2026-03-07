/**
 * Deployment shared types.
 *
 * Used by deploy-wingsuit.ts (physics), deploy-render.ts (visuals),
 * and sim-runner.ts (orchestration). No Three.js or physics imports.
 */

// ─── Vec3 ────────────────────────────────────────────────────────────────────

/** Simple 3D vector — NED body-relative meters */
export interface Vec3 {
  x: number; y: number; z: number
}

// ─── Wingsuit Deploy ─────────────────────────────────────────────────────────

export type WingsuitDeployPhase =
  | 'idle'
  | 'pc_toss'
  | 'bridle_paying_out'
  | 'pin_release'
  | 'canopy_extracting'
  | 'line_stretch'

export interface BridleSegmentState {
  position: Vec3       // body-relative, meters
  velocity: Vec3       // body-relative, m/s
  visible: boolean     // renderer visibility
  freed: boolean       // has tension unstowed this segment?
}

export interface CanopyBagState {
  position: Vec3
  velocity: Vec3
  /** Pitch angle [rad] — constrained ±90° by line geometry */
  pitch: number
  pitchRate: number
  /** Roll angle [rad] — constrained ±90° by riser spread */
  roll: number
  rollRate: number
  /** Accumulated yaw [rad] — free axis, becomes initial line twist */
  yaw: number
  yawRate: number
}

/** Full render state produced each tick for the renderer */
export interface WingsuitDeployRenderState {
  phase: WingsuitDeployPhase
  pcPosition: Vec3
  pcCD: number                    // current tension-dependent CD
  segments: BridleSegmentState[]
  canopyBag: CanopyBagState | null
  bridleTension: number           // [N] scalar at PC end
  pinTension: number              // [N] at pin segment
  bagTension: number              // [N] suspension line tension (bag to body)
  chainDistance: number            // PC-to-body [m]
  bagDistance: number              // bag-to-body [m] (suspension line stretch)
}

/** Snapshot frozen at line stretch for canopy IC computation */
export interface LineStretchSnapshot {
  /** Wingsuit sim state at moment of line stretch */
  bodyState: {
    x: number; y: number; z: number
    u: number; v: number; w: number
    phi: number; theta: number; psi: number
    p: number; q: number; r: number
  }
  /** PC position + velocity in inertial frame */
  pcPosition: Vec3
  pcVelocity: Vec3
  /** Canopy bag state */
  canopyBag: CanopyBagState
  /** Tension axis: unit vector from pilot hips to canopy bag (body frame) */
  tensionAxis: Vec3
  /** Tension axis in inertial NED frame */
  tensionAxisInertial: Vec3
  /** Total chain distance [m] */
  chainDistance: number
  /** Simulation time [s] */
  time: number
}
