/**
 * Polar module — public API.
 * 
 * This is the barrel export for the polar math library.
 * Everything in this directory is UI-independent and will be
 * copied into CloudBASE.
 */

export type { ContinuousPolar, Coefficients, SustainedSpeeds, FullCoefficients, SymmetricControl, MassSegment, AeroSegment, SegmentControls } from './continuous-polar.ts'
export { separation, f_fwd, f_back, cl_attached, cd_attached, cl_plate, cd_plate } from './kirchhoff.ts'
export { getCL, getCD, getCY, getCM, getCP, getAllCoefficients, coeffToForces, coeffToSS, netForceToPseudo, lerpPolar } from './coefficients.ts'
export type { PseudoCoefficients } from './coefficients.ts'
export {
  continuousPolars, legacyPolars,
  aurafivepolar, ibexulpolar, slicksinpolar, caravanpolar,
  aurafiveContinuous, ibexulContinuous, slicksinContinuous, caravanContinuous,
  a5segmentsContinuous, makeA5SegmentsAeroSegments,
  getLegacyCoefficients, makeIbexAeroSegments, rotatePilotMass,
  PILOT_PIVOT_X, PILOT_PIVOT_Z, CANOPY_PILOT_SEGMENTS
} from './polar-data.ts'
export type { WSEQPolar } from './polar-data.ts'
export { computeInertia, ZERO_INERTIA, computeCenterOfMass, getPhysicalMassPositions, calculateInertiaComponents } from './inertia.ts'
export type { InertiaComponents } from './inertia.ts'
export { computeSegmentForce, sumAllSegments, defaultControls, computeWindFrameNED, evaluateAeroForces, evaluateAeroForcesDetailed } from './aero-segment.ts'
export type { Vec3NED, SegmentForceResult, SystemForces, WindFrameNED, SegmentAeroResult } from './aero-segment.ts'
export type { ControlConstants, WingsuitControlConstants } from './segment-factories.ts'
export { makeCanopyCellSegment, makeParasiticSegment, makeLiftingBodySegment, makeUnzippablePilotSegment, makeBrakeFlapSegment, DEFAULT_CONSTANTS, makeWingsuitHeadSegment, makeWingsuitLiftingSegment, DEFAULT_WINGSUIT_CONSTANTS } from './segment-factories.ts'
export { gravityBody, translationalEOM, translationalEOMAnisotropic, rotationalEOM, eulerRates, eulerRatesToBodyRates, bodyToInertialVelocity, computePilotPendulumParams, pilotPendulumEOM, pilotSwingDampingTorque } from './eom.ts'
export type { AngularVelocity, AngularAcceleration, TranslationalAcceleration, EulerRates, PilotPendulumParams } from './eom.ts'
export type { SimState, SimStateExtended, SimDerivatives, SimConfig } from './sim-state.ts'
export { computeDerivatives, forwardEuler, rk4Step, simulate } from './sim.ts'
export { computeApparentMass, computeApparentInertia, computeApparentMassResult, canopyGeometryFromPolar, apparentMassAtDeploy, effectiveMass, effectiveInertia } from './apparent-mass.ts'
export type { ApparentMass, ApparentInertia, ApparentMassResult, CanopyGeometry } from './apparent-mass.ts'
export { buildCompositeFrame, frameNeedsRebuild, frameToSimConfig } from './composite-frame.ts'
export type { CompositeFrame, CompositeFrameConfig } from './composite-frame.ts'
