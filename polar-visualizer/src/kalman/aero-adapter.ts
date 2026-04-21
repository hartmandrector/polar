/**
 * aero-adapter.ts — Bridges the segment aero model to the Kalman filter's
 * AeroMomentModel interface.
 *
 * Design:
 *   - Works with ANY assembled vehicle (wingsuit, canopy, slick, etc.)
 *   - Takes segments, CG, height, inertia at construction time
 *   - Maps Kalman control inputs (δ_pitch, δ_roll, δ_yaw ∈ [-1,1])
 *     to SegmentControls
 *   - Evaluates full segment model → returns [L, M, N] moments
 *   - Provides inertia diagonal for Euler's rotational equations
 *
 * Ground handling:
 *   - Below MIN_AIRSPEED, moments are zeroed (filter runs as kinematic-only)
 *   - This prevents the aero model from producing nonsense at V≈0
 */

import type { AeroSegment, SegmentControls } from '../polar/continuous-polar.ts'
import type { Vec3NED, SystemForces } from '../polar/aero-segment.ts'
import type { AngularVelocity } from '../polar/eom.ts'
import type { InertiaComponents } from '../polar/inertia.ts'
import { evaluateAeroForces } from '../polar/aero-segment.ts'
import type { AeroMomentModel } from './types.ts'

/** Below this airspeed, aero moments are zero (filter is kinematic-only) */
const MIN_AIRSPEED = 5 // m/s

/**
 * Configuration for building an AeroMomentAdapter.
 * All the data needed to evaluate one vehicle's aero model.
 */
export interface AeroAdapterConfig {
  /** Assembled aero segments for this vehicle */
  segments: AeroSegment[]
  /** System CG in meters (NED body frame) */
  cgMeters: Vec3NED
  /** Reference height for denormalization (m) */
  height: number
  /** Inertia tensor about CG */
  inertia: InertiaComponents
  /** Air density (kg/m³) — default 1.225 */
  rho?: number
  /**
   * Map Kalman control vector to SegmentControls.
   * If not provided, uses defaultControlMapper (wingsuit: pitch/roll/yaw throttle).
   */
  controlMapper?: (deltaPitch: number, deltaRoll: number, deltaYaw: number) => SegmentControls
}

/**
 * Default control mapper for wingsuit (a5segments).
 * Maps [-1,1] control inputs to SegmentControls.
 */
/** Neutral controls — all zeros */
const NEUTRAL_CONTROLS: SegmentControls = {
  brakeLeft: 0, brakeRight: 0,
  frontRiserLeft: 0, frontRiserRight: 0,
  rearRiserLeft: 0, rearRiserRight: 0,
  weightShiftLR: 0,
  elevator: 0, rudder: 0,
  aileronLeft: 0, aileronRight: 0,
  flap: 0,
  pitchThrottle: 0, rollThrottle: 0, yawThrottle: 0,
  dihedral: 0, wingsuitDeploy: 0,
  delta: 0, dirty: 0, unzip: 0,
  pilotPitch: 0, deploy: 0,
}

/**
 * Default control mapper for wingsuit (a5segments).
 * Maps [-1,1] control inputs to SegmentControls.
 */
function wingsuitControlMapper(
  deltaPitch: number,
  deltaRoll: number,
  deltaYaw: number,
): SegmentControls {
  return {
    ...NEUTRAL_CONTROLS,
    pitchThrottle: deltaPitch,
    rollThrottle: deltaRoll,
    yawThrottle: deltaYaw,
  }
}

/**
 * AeroMomentAdapter — wraps evaluateAeroForces for the Kalman filter.
 *
 * Usage:
 *   const adapter = createAeroAdapter({
 *     segments: a5segmentsContinuous.aeroSegments!,
 *     cgMeters: { x: 0, y: 0, z: 0 },
 *     height: 1.875,
 *     inertia: vehicleDef.mass.inertia,
 *   })
 *   ekf.setAeroModel(adapter)
 */
export class AeroMomentAdapter implements AeroMomentModel {
  private readonly segments: AeroSegment[]
  private readonly cgMeters: Vec3NED
  private readonly height: number
  private readonly inertiaData: InertiaComponents
  private rho: number
  private readonly mapControls: (dp: number, dr: number, dy: number) => SegmentControls

  constructor(config: AeroAdapterConfig) {
    this.segments = config.segments
    this.cgMeters = config.cgMeters
    this.height = config.height
    this.inertiaData = config.inertia
    this.rho = config.rho ?? 1.225
    this.mapControls = config.controlMapper ?? wingsuitControlMapper
  }

  /** Update air density for the current point */
  setRho(rho: number): void {
    this.rho = rho
  }

  evaluateMoments(
    alpha: number,
    V: number,
    p: number, q: number, r: number,
    deltaPitch: number, deltaRoll: number, deltaYaw: number,
  ): [number, number, number] {
    // Ground handling: zero moments at low airspeed
    if (V < MIN_AIRSPEED) return [0, 0, 0]

    // Build body velocity from airspeed + alpha (NED body frame)
    // V_body = (V cos(α), 0, V sin(α))  — zero sideslip assumption
    const bodyVel: Vec3NED = {
      x: V * Math.cos(alpha),
      y: 0,
      z: V * Math.sin(alpha),
    }

    const omega: AngularVelocity = { p, q, r }
    const controls = this.mapControls(deltaPitch, deltaRoll, deltaYaw)

    const result: SystemForces = evaluateAeroForces(
      this.segments,
      this.cgMeters,
      this.height,
      bodyVel,
      omega,
      controls,
      this.rho,
    )

    return [result.moment.x, result.moment.y, result.moment.z]
  }

  getInertia(): [number, number, number] {
    return [this.inertiaData.Ixx, this.inertiaData.Iyy, this.inertiaData.Izz]
  }
}

/**
 * Convenience factory — creates an AeroMomentAdapter from config.
 */
export function createAeroAdapter(config: AeroAdapterConfig): AeroMomentAdapter {
  return new AeroMomentAdapter(config)
}
