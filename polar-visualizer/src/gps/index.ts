/**
 * GPS Processing Pipeline — Public API
 */

// Core pipeline
export { processGPSFile, processGNSSData, DEFAULT_CONFIG } from './gps-pipeline';
export type { PipelineConfig, PipelineResult } from './gps-pipeline';

// Parsers
export { parseTrackCSV, parseStabilityCSV, parseGenericGPSCSV, detectFormat } from './track-parser';

// SG filter
export { applySGFilter, applySGFilterMultiPass, applySGFilterToArray, smoothGPSVelocities } from './sg-filter';
export type { SGWindowSize } from './sg-coefficients';

// Math utilities
export { getSlope, calculateDerivative, calculateAcceleration, unwrapAngles } from './math-utils';

// Atmosphere
export { getRho, dynamicPressure, altitudeToPressure, temperature, GRAVITY } from './atmosphere';

// Geo utilities
export { geodeticToNED, nedToGeodetic } from './geo-utils';

// WSE aero extraction
export {
  extractAero, calculateWingsuitParameters, calculateSustainedSpeeds, coeffToSustainedSpeeds,
  matchAOAFromTable, matchAOABinarySearch, computeBodyRates, applyInverseDKE,
  type PolarEvaluator, type PolarEvaluatorFactory,
} from './wse';
export type { SystemPolarPoint } from './wse';

// Wind model
export { zeroWind, constantWind, applyWindCorrection } from './wind-model';

// Flight computer
export { FlightComputer, FlightMode, flightModeString } from './flight-computer';
export type { FlightComputerConfig, FlightComputerInput, FlightComputerOutput } from './flight-computer';

// Types
export type {
  GNSSData, TrackDataset, StabilityCSVRow,
  GPSProcessedPoint, GPSPipelinePoint, AeroExtraction,
  WindVector, SustainedSpeeds, FlightModeOutput, BodyRates,
} from './types';
