/**
 * Composite body frame — cached assembly of all swappable components.
 *
 * The system is built from canopy + pilot + PC + bridle + risers,
 * each with their own aero and mass segments.  The CompositeFrame
 * is a snapshot computed once per configuration change (deploy,
 * pilot pitch, component swap) and reused across integration steps.
 *
 * See SIMULATION.md §14 for architecture discussion.
 *
 * Pure math — no Three.js, DOM, or rendering dependencies.
 * Portable to CloudBASE.
 */

import type { AeroSegment, ContinuousPolar, MassSegment, SegmentControls } from './continuous-polar.ts'
import type { Vec3NED } from './aero-segment.ts'
import type { InertiaComponents } from './inertia.ts'
import type { ApparentMassResult, CanopyGeometry } from './apparent-mass.ts'
import type { SimConfig } from './sim-state.ts'
import { computeCenterOfMass, computeInertia } from './inertia.ts'
import { computeApparentMassResult, canopyGeometryFromPolar, apparentMassAtDeploy, effectiveMass, effectiveInertia } from './apparent-mass.ts'

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Cached snapshot of the assembled vehicle.
 *
 * Recomputed when any of these change:
 *   - Deploy fraction (canopy inflation)
 *   - Pilot pitch angle (pendulum swing)
 *   - Component swap (different canopy, pilot type)
 *
 * NOT recomputed every integration step — that's the whole point.
 */
export interface CompositeFrame {
  // ── Geometry ──
  /** Assembled aero segments (canopy cells + parasitic bodies) */
  aeroSegments: AeroSegment[]
  /** Weight mass segments (for gravitational CG) */
  weightSegments: MassSegment[]
  /** Inertia mass segments (includes buoyant air masses for tensor) */
  inertiaSegments: MassSegment[]

  // ── Derived quantities ──
  /** System center of mass in body frame [m] */
  cg: Vec3NED
  /** Physical inertia tensor about CG [kg·m²] */
  inertia: InertiaComponents
  /** Total system mass [kg] */
  totalMass: number

  // ── Apparent mass ──
  /** Canopy planform geometry (for apparent mass calculation) */
  canopyGeometry: CanopyGeometry
  /** Apparent mass / inertia at current deploy state */
  apparentMass: ApparentMassResult
  /** Effective mass per axis: physical + apparent [kg] */
  effectiveMass: { x: number; y: number; z: number }
  /** Effective inertia: physical + apparent diagonal [kg·m²] */
  effectiveInertia: InertiaComponents

  // ── Configuration snapshot ──
  /** Reference height [m] used for de-normalization */
  height: number
  /** Air density [kg/m³] used for apparent mass */
  rho: number
  /** Deployment fraction at which this frame was computed */
  deploy: number
  /** Pilot pitch at which this frame was computed [deg] */
  pilotPitch: number
}

// ─── Configuration for Building a Frame ─────────────────────────────────────

/**
 * Inputs required to build a CompositeFrame.
 *
 * This separates "what we're assembling" from "the cached result".
 */
export interface CompositeFrameConfig {
  /** The canopy polar (ibexulContinuous, etc.) */
  polar: ContinuousPolar
  /** Function to get aero segments — may depend on pilot type */
  makeAeroSegments: () => AeroSegment[]
  /** Function to get mass segments — depends on pilot pitch + deploy */
  rotatePilotMass: (pilotPitch_deg: number, pivot?: { x: number; z: number }, deploy?: number) => {
    weight: MassSegment[]
    inertia: MassSegment[]
  }
  /** Pilot height [m] for de-normalization */
  height: number
  /** Air density [kg/m³] */
  rho: number
  /** Pivot point for pilot rotation (optional override) */
  pivot?: { x: number; z: number }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Build a CompositeFrame from configuration and current deploy/pitch state.
 *
 * This is the single function that computes CG, inertia, apparent mass,
 * and caches everything.  Call it when:
 *   - Deploy fraction changes (canopy inflation)
 *   - Pilot pitch changes (pendulum swing)
 *   - Component swap occurs
 *
 * Do NOT call every integration step — that's what SimConfig is for.
 *
 * @param frameConfig  Assembly recipe (polar, segment factories, height, rho)
 * @param deploy       Deployment fraction 0–1
 * @param pilotPitch   Pilot pitch angle [deg], 0 = hanging vertical
 */
export function buildCompositeFrame(
  frameConfig: CompositeFrameConfig,
  deploy: number = 1,
  pilotPitch: number = 0,
): CompositeFrame {
  const { polar, makeAeroSegments, rotatePilotMass: rotateFn, height, rho, pivot } = frameConfig

  // 1. Get aero segments (depends on pilot type, not deploy/pitch)
  const aeroSegments = makeAeroSegments()

  // 2. Get mass segments (depends on pilot pitch + deploy)
  const { weight: weightSegments, inertia: inertiaSegments } = rotateFn(pilotPitch, pivot, deploy)

  // 3. Compute CG from weight segments
  const cg = computeCenterOfMass(weightSegments, height, polar.m) as Vec3NED

  // 4. Compute physical inertia from inertia segments (includes air mass)
  const inertia = computeInertia(inertiaSegments, height, polar.m)

  // 5. Canopy geometry for apparent mass
  const fullGeom = canopyGeometryFromPolar(polar.s, polar.chord)

  // 6. Apparent mass at current deploy state
  const apparentMass = deploy < 0.999
    ? apparentMassAtDeploy(fullGeom, deploy, rho)
    : computeApparentMassResult(fullGeom, rho)

  // 7. Effective mass and inertia
  const effMass = effectiveMass(polar.m, apparentMass.mass)
  const effInertia = effectiveInertia(inertia, apparentMass.inertia)

  return {
    aeroSegments,
    weightSegments,
    inertiaSegments,
    cg,
    inertia,
    totalMass: polar.m,
    canopyGeometry: fullGeom,
    apparentMass,
    effectiveMass: effMass,
    effectiveInertia: effInertia,
    height,
    rho,
    deploy,
    pilotPitch,
  }
}

// ─── Dirty Check ────────────────────────────────────────────────────────────

/**
 * Check whether the frame needs to be rebuilt.
 *
 * Returns true if deploy or pilotPitch have changed beyond
 * the tolerance thresholds.
 *
 * @param frame       Current cached frame
 * @param deploy      New deployment fraction
 * @param pilotPitch  New pilot pitch [deg]
 * @param deployTol   Deployment change threshold (default 0.001)
 * @param pitchTol    Pitch change threshold [deg] (default 0.01)
 */
export function frameNeedsRebuild(
  frame: CompositeFrame,
  deploy: number,
  pilotPitch: number,
  deployTol: number = 0.001,
  pitchTol: number = 0.01,
): boolean {
  return (
    Math.abs(frame.deploy - deploy) > deployTol ||
    Math.abs(frame.pilotPitch - pilotPitch) > pitchTol
  )
}

// ─── SimConfig Conversion ───────────────────────────────────────────────────

/**
 * Convert a CompositeFrame + controls into a SimConfig for the integrator.
 *
 * This bridges the cached frame (recomputed on mass changes) to the
 * per-step config (constant between rebuilds).
 *
 * When `useApparentMass` is true, the effective mass and inertia
 * (physical + apparent) are used.  Otherwise, physical only.
 *
 * @param frame            Cached composite frame
 * @param controls         Current control inputs
 * @param useApparentMass  Whether to include apparent mass (default true)
 */
export function frameToSimConfig(
  frame: CompositeFrame,
  controls: SegmentControls,
  useApparentMass: boolean = true,
): SimConfig {
  return {
    segments: frame.aeroSegments,
    controls,
    cgMeters: frame.cg,
    inertia: useApparentMass ? frame.effectiveInertia : frame.inertia,
    mass: frame.totalMass,
    massPerAxis: useApparentMass ? frame.effectiveMass : undefined,
    height: frame.height,
    rho: frame.rho,
  }
}
