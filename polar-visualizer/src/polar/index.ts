/**
 * Polar module — public API.
 * 
 * This is the barrel export for the polar math library.
 * Everything in this directory is UI-independent and will be
 * copied into CloudBASE.
 */

export type { ContinuousPolar, Coefficients, SustainedSpeeds, FullCoefficients, SymmetricControl, MassSegment, AeroSegment, SegmentControls } from './continuous-polar.ts'
export { separation, f_fwd, f_back, cl_attached, cd_attached, cl_plate, cd_plate } from './kirchhoff.ts'
export { getCL, getCD, getCY, getCM, getCP, getAllCoefficients, coeffToForces, coeffToSS } from './coefficients.ts'
export {
  continuousPolars, legacyPolars,
  aurafivepolar, ibexulpolar, slicksinpolar, caravanpolar,
  aurafiveContinuous, ibexulContinuous, slicksinContinuous, caravanContinuous,
  getLegacyCoefficients
} from './polar-data.ts'
export type { WSEQPolar } from './polar-data.ts'
export { computeInertia, ZERO_INERTIA, computeCenterOfMass, getPhysicalMassPositions, calculateInertiaComponents } from './inertia.ts'
export type { InertiaComponents } from './inertia.ts'
export { computeSegmentForce, sumAllSegments, defaultControls } from './aero-segment.ts'
export type { Vec3NED, SegmentForceResult, SystemForces } from './aero-segment.ts'
export { makeCanopyCellSegment, makeParasiticSegment } from './segment-factories.ts'
