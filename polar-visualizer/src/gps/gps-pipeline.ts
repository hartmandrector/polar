/**
 * GPS Processing Pipeline — Orchestrator
 * 
 * Data flow:
 *   GPS file → parse → SG smooth velocities → LS acceleration →
 *   wind correction → kl/kd extraction → sustained speeds →
 *   polar index → AOA estimation
 * 
 * Designed for drag-and-drop: accepts raw file content, returns
 * fully processed pipeline output ready for charting or replay.
 */

import { SGWindowSize } from './sg-coefficients';
import { applySGFilterMultiPass } from './sg-filter';
import { calculateDerivative } from './math-utils';
import { unwrapAngles } from './math-utils';
import { getRho, dynamicPressure } from './atmosphere';
import { geodeticToNED } from './geo-utils';
import { extractAero, SystemPolarPoint, applyInverseDKE, type PolarEvaluator, type PolarEvaluatorFactory } from './wse';
import { zeroWind, applyWindCorrection } from './wind-model';
import { FlightComputer } from './flight-computer';
import type { FlightComputerInput } from './flight-computer';
import {
  GNSSData, StabilityCSVRow,
  GPSProcessedPoint, GPSPipelinePoint,
  WindVector,
} from './types';
import {
  detectFormat, parseTrackCSV, parseStabilityCSV, parseGenericGPSCSV,
} from './track-parser';

// ============================================================================
// Pipeline Configuration
// ============================================================================

export interface PipelineConfig {
  /** SG filter window sizes for multi-pass velocity smoothing */
  smoothingWindows: SGWindowSize[];
  /** LS acceleration window size (odd number) */
  accelWindowSize: number;
  /** Temperature offset from ISA (°C) */
  temperatureOffset: number;
  /** Wind vector (meteorological "from" convention, NED). Default: zero wind */
  wind: WindVector;
  /** Pre-built system polar table for AOA estimation (fallback) */
  polarTable?: SystemPolarPoint[];
  /** Factory for per-point evaluator — uses matching rho/airspeed (preferred) */
  polarEvaluatorFactory?: PolarEvaluatorFactory;
  /** Fixed evaluator for binary search AOA (fallback if no factory) */
  polarEvaluator?: PolarEvaluator;
  /** Pilot mass (kg) — for kl/kd → CL/CD conversion */
  pilotMass: number;
  /** System reference area (m²) — for kl/kd → CL/CD conversion */
  sRef: number;
}

export const DEFAULT_CONFIG: PipelineConfig = {
  smoothingWindows: [21, 11, 7] as SGWindowSize[],
  accelWindowSize: 21,
  temperatureOffset: 0,
  wind: zeroWind(),
  pilotMass: 77.5,
  sRef: 2.0,  // wingsuit system reference area
};

// ============================================================================
// Pipeline from GNSSData array
// ============================================================================

/**
 * Process an array of GNSS points through the full pipeline.
 * Input: raw GPS with NED velocities.
 * Output: smoothed, differentiated, aero-extracted points.
 */
export function processGNSSData(
  gnss: GNSSData[],
  config: PipelineConfig = DEFAULT_CONFIG,
): GPSPipelinePoint[] {
  if (gnss.length < 5) return [];

  // Time vector (seconds from first point)
  const t0 = gnss[0].timestamp;
  const times = gnss.map(g => (g.timestamp - t0) / 1000);

  // ---- Step 1: SG smooth velocities ----
  const smoothN = applySGFilterMultiPass(gnss, config.smoothingWindows, g => g.velN);
  const smoothE = applySGFilterMultiPass(gnss, config.smoothingWindows, g => g.velE);
  const smoothD = applySGFilterMultiPass(gnss, config.smoothingWindows, g => g.velD);

  // Build intermediate points with time + smoothed velocity
  interface TimedVel { t: number; vN: number; vE: number; vD: number }
  const timedVels: TimedVel[] = gnss.map((g, i) => ({
    t: times[i],
    vN: smoothN[i],
    vE: smoothE[i],
    vD: smoothD[i],
  }));

  // ---- Step 2: LS acceleration ----
  const accelN = calculateDerivative(timedVels, config.accelWindowSize, p => p.t, p => p.vN);
  const accelE = calculateDerivative(timedVels, config.accelWindowSize, p => p.t, p => p.vE);
  const accelD = calculateDerivative(timedVels, config.accelWindowSize, p => p.t, p => p.vD);

  // ---- Step 3: Convert lat/lon/hMSL to NED position relative to first point ----
  const rawPosN = new Float64Array(gnss.length);
  const rawPosE = new Float64Array(gnss.length);
  const rawPosD = new Float64Array(gnss.length);
  const lat0 = gnss[0].lat;
  const lon0 = gnss[0].lon;
  const alt0 = gnss[0].hMSL;
  for (let i = 1; i < gnss.length; i++) {
    const ned = geodeticToNED(gnss[i].lat, gnss[i].lon, gnss[i].hMSL, lat0, lon0, alt0);
    rawPosN[i] = ned.n;
    rawPosE[i] = ned.e;
    rawPosD[i] = ned.d;
  }

  // ---- Step 3.5: SG smooth position (same windows as velocity) ----
  const posN = applySGFilterMultiPass(Array.from(rawPosN), config.smoothingWindows, v => v);
  const posE = applySGFilterMultiPass(Array.from(rawPosE), config.smoothingWindows, v => v);
  const posD = applySGFilterMultiPass(Array.from(rawPosD), config.smoothingWindows, v => v);

  // ---- Step 4: Process each point ----
  const results: GPSPipelinePoint[] = [];
  let prevKl = 0.01;
  let prevKd = 0.01;
  let prevRoll = 0;

  for (let i = 0; i < gnss.length; i++) {
    const g = gnss[i];
    const rho = getRho(g.hMSL, config.temperatureOffset);

    // Wind correction
    const { avN, avE, avD } = applyWindCorrection(
      smoothN[i], smoothE[i], smoothD[i], config.wind,
    );
    const airspeed = Math.sqrt(avN * avN + avE * avE + avD * avD);
    const groundSpeed = Math.sqrt(smoothN[i] * smoothN[i] + smoothE[i] * smoothE[i]);
    const qbar = dynamicPressure(rho, airspeed);

    const processed: GPSProcessedPoint = {
      t: times[i],
      velN: smoothN[i],
      velE: smoothE[i],
      velD: smoothD[i],
      accelN: accelN[i],
      accelE: accelE[i],
      accelD: accelD[i],
      airspeed,
      groundSpeed,
      posN: posN[i],
      posE: posE[i],
      posD: posD[i],
      hMSL: g.hMSL,
      lat: g.lat,
      lon: g.lon,
      rho,
      qbar,
    };

    // Aero extraction (use wind-corrected velocities)
    const aero = extractAero(
      avN, avE, avD,
      accelN[i], accelE[i], accelD[i],
      rho,
      config.sRef,
      config.pilotMass,
      config.polarEvaluatorFactory,
      config.polarEvaluator,
      config.polarTable,
      prevKl, prevKd, prevRoll,
    );

    // Track previous values for low-speed fallback
    if (airspeed > 5) {
      prevKl = aero.kl;
      prevKd = aero.kd;
      prevRoll = aero.roll;
    }

    results.push({ processed, aero });
  }

  // ---- Step 5: Flight computer mode detection ----
  const fc = new FlightComputer();
  const fcInputs: FlightComputerInput[] = results.map(r => ({
    t: r.processed.t,
    groundSpeed: r.processed.groundSpeed,
    climb: -r.processed.velD,  // climb = -velD (positive up)
    hMSL: r.processed.hMSL,
    aero: r.aero,
  }));
  const modes = fc.processAll(fcInputs);
  for (let i = 0; i < results.length; i++) {
    results[i].flightMode = modes[i];
  }

  // ---- Step 5.5: SG-smooth AOA, recompose θ and ψ ----
  // AOA from table matching is stair-stepped; smooth it, then recompose
  // θ = γ + α·cos(φ) and ψ = ψ_air + α·sin(φ)/cos(θ) from the smoothed α
  const rawAoa = results.map(r => r.aero.aoa);
  const smoothAoa = applySGFilterMultiPass(rawAoa, config.smoothingWindows, v => v);
  for (let i = 0; i < results.length; i++) {
    const a = results[i].aero;
    const aoaOld = a.aoa;
    a.aoa = smoothAoa[i];
    // Recompose θ and ψ with smoothed α (same formulas as extractAero)
    const dAlpha = smoothAoa[i] - aoaOld;
    a.theta += dAlpha * Math.cos(a.roll);
    a.psi   += a.roll !== 0 ? dAlpha * Math.sin(a.roll) / Math.cos(a.theta) : 0;
  }

  // ---- Step 6: SG-smooth Euler angles, LS differentiate, inverse DKE → body rates ----
  // Extract raw Euler angles from aero extraction
  const rawPhi   = results.map(r => r.aero.roll);
  const rawTheta = results.map(r => r.aero.theta);
  const rawPsi   = results.map(r => r.aero.psi);

  // Unwrap heading and roll to handle ±π wraparound before smoothing
  // Heading wraps during turns; roll wraps during corkscrew/barrel-roll maneuvers
  const unwrappedPsi = unwrapAngles(rawPsi);
  const unwrappedPhi = unwrapAngles(rawPhi);

  // SG multi-pass smooth (same windows as velocity)
  const smoothPhi   = applySGFilterMultiPass(unwrappedPhi, config.smoothingWindows, v => v);
  const smoothTheta = applySGFilterMultiPass(rawTheta, config.smoothingWindows, v => v);
  const smoothPsi   = applySGFilterMultiPass(unwrappedPsi, config.smoothingWindows, v => v);

  // LS linear fit derivative → Euler rates (rad/s)
  const timedAngles = results.map((r, i) => ({
    t: r.processed.t,
    phi: smoothPhi[i],
    theta: smoothTheta[i],
    psi: smoothPsi[i],
  }));
  const phiDots   = calculateDerivative(timedAngles, config.accelWindowSize, d => d.t, d => d.phi);
  const thetaDots = calculateDerivative(timedAngles, config.accelWindowSize, d => d.t, d => d.theta);
  const psiDots   = calculateDerivative(timedAngles, config.accelWindowSize, d => d.t, d => d.psi);

  // Inverse DKE: (φ̇, θ̇, ψ̇) + (φ, θ) → (p, q, r)
  const bodyRates = applyInverseDKE(smoothPhi, smoothTheta, phiDots, thetaDots, psiDots);
  const R2D = 180 / Math.PI;
  for (let i = 0; i < results.length; i++) {
    results[i].bodyRates = {
      ...bodyRates[i],
      phiDot: phiDots[i] * R2D,
      thetaDot: thetaDots[i] * R2D,
      psiDot: psiDots[i] * R2D,
    };
    // Write SG-smoothed unwrapped angles back so downstream consumers
    // (renderer, force arrows, fixed orientations) see continuous angles
    // instead of ±π-wrapped raw values.
    results[i].aero.roll = smoothPhi[i];
    results[i].aero.theta = smoothTheta[i];
    results[i].aero.psi = smoothPsi[i];
  }

  // ---- Step 7: LS angular acceleration from body rates (no additional smoothing) ----
  const timedRates = results.map((r, i) => ({
    t: r.processed.t,
    p: bodyRates[i].p,
    q: bodyRates[i].q,
    r: bodyRates[i].r,
  }));
  const pDots = calculateDerivative(timedRates, config.accelWindowSize, d => d.t, d => d.p);
  const qDots = calculateDerivative(timedRates, config.accelWindowSize, d => d.t, d => d.q);
  const rDots = calculateDerivative(timedRates, config.accelWindowSize, d => d.t, d => d.r);

  for (let i = 0; i < results.length; i++) {
    if (results[i].bodyRates) {
      results[i].bodyRates!.pDot = pDots[i];
      results[i].bodyRates!.qDot = qDots[i];
      results[i].bodyRates!.rDot = rDots[i];
    }
  }

  return results;
}

// ============================================================================
// Pipeline from raw file content (drag-and-drop entry point)
// ============================================================================

export interface PipelineResult {
  format: string;
  pointCount: number;
  duration: number;          // seconds
  startEpochMs: number;      // first GNSS timestamp (ms since Unix epoch) for absolute time alignment
  points: GPSPipelinePoint[];
  /** Stability CSV rows if input was stability format (pass-through) */
  stabilityRows?: StabilityCSVRow[];
}

/**
 * Process a GPS file from raw text content.
 * Auto-detects format (FlySight TRACK.CSV, stability CSV, generic GPS CSV).
 */
export function processGPSFile(
  content: string,
  config: Partial<PipelineConfig> = {},
): PipelineResult {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const format = detectFormat(content);

  if (format === 'stability') {
    // Stability CSV already has processed data — pass through but also
    // convert to GNSS format for pipeline processing
    const rows = parseStabilityCSV(content);
    const gnss = stabilityToGNSS(rows);
    const points = processGNSSData(gnss, fullConfig);
    return {
      format: 'stability',
      pointCount: points.length,
      duration: points.length > 0 ? points[points.length - 1].processed.t : 0,
      startEpochMs: gnss.length > 0 ? gnss[0].timestamp : 0,
      points,
      stabilityRows: rows,
    };
  }

  let gnss: GNSSData[];
  if (format === 'flysight') {
    gnss = parseTrackCSV(content).gnssData;
  } else {
    gnss = parseGenericGPSCSV(content);
  }

  const points = processGNSSData(gnss, fullConfig);
  return {
    format,
    pointCount: points.length,
    duration: points.length > 0 ? points[points.length - 1].processed.t : 0,
    startEpochMs: gnss.length > 0 ? gnss[0].timestamp : 0,
    points,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** Convert stability CSV rows to GNSSData for pipeline compatibility */
function stabilityToGNSS(rows: StabilityCSVRow[]): GNSSData[] {
  const t0 = Date.now();
  return rows.map(r => ({
    type: 'GNSS' as const,
    isoTime: new Date(t0 + r.t * 1000).toISOString(),
    timestamp: t0 + r.t * 1000,
    lat: 0,
    lon: 0,
    hMSL: r.hMSL,
    velN: r.vN,
    velE: r.vE,
    velD: r.vD,
    hAcc: 0,
    vAcc: 0,
    sAcc: 0,
    numSV: 0,
  }));
}
