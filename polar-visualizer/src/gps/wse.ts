/**
 * Wingsuit Simulation Engine (WSE) — Aero Extraction
 * 
 * Extracts aerodynamic parameters (kl, kd, roll) from GPS-derived velocity
 * and acceleration in NED frame.
 * 
 * Key operation: decompose measured acceleration into lift (⊥ velocity)
 * and drag (∥ velocity) components, then normalize to get kl/kd.
 * 
 * AOA estimation uses a pre-built system polar table (α → CL, CD)
 * generated externally from the segment model. The table is matched
 * against observed CL/CD at each GPS timestep.
 */

import { GRAVITY } from './atmosphere';
import { AeroExtraction, SustainedSpeeds, BodyRates } from './types';

function signum(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

// ============================================================================
// Core KL/KD Extraction
// ============================================================================

/**
 * Extract wingsuit parameters from measured velocity and acceleration.
 * All inputs in NED frame.
 * 
 * @returns [kl, kd, roll] where kl/kd are normalized force coefficients
 */
export function calculateWingsuitParameters(
  vN: number, vE: number, vD: number,
  aN: number, aE: number, aD: number,
  currentKl: number, currentKd: number, currentRoll: number,
): [number, number, number] {
  const accelDminusG = aD - GRAVITY;
  const vel = Math.sqrt(vN * vN + vE * vE + vD * vD);
  if (vel < 1.0) return [currentKl, currentKd, currentRoll];

  // Project acceleration onto velocity → drag component
  const proj = (aN * vN + aE * vE + accelDminusG * vD) / vel;
  const dragN = proj * vN / vel;
  const dragE = proj * vE / vel;
  const dragD = proj * vD / vel;
  const dragSign = -signum(dragN * vN + dragE * vE + dragD * vD);
  const accelDrag = dragSign * Math.sqrt(dragN * dragN + dragE * dragE + dragD * dragD);

  // Reject from velocity → lift component
  const liftN = aN - dragN;
  const liftE = aE - dragE;
  const liftD = accelDminusG - dragD;
  const accelLift = Math.sqrt(liftN * liftN + liftE * liftE + liftD * liftD);

  const kl = accelLift / GRAVITY / vel / vel;
  const kd = accelDrag / GRAVITY / vel / vel;

  // Roll angle
  const groundSpeed = Math.sqrt(vN * vN + vE * vE);
  let roll = currentRoll;
  if (groundSpeed > 1.0) {
    const rollArg = (1 - aD / GRAVITY - kd * vel * vD) / (kl * groundSpeed * vel);
    if (Math.abs(rollArg) <= 1.0) {
      const rollMag = Math.acos(rollArg);
      const rollSign = signum(liftN * -vE + liftE * vN);
      roll = rollSign * rollMag;
    }
  }

  return [kl, kd, roll];
}

// ============================================================================
// Sustained Speed Computation
// ============================================================================

/** Convert kl, kd to sustained speed coordinates */
export function calculateSustainedSpeeds(kl: number, kd: number): SustainedSpeeds {
  const denom = Math.pow(kl * kl + kd * kd, 0.75);
  if (denom < 1e-12) return { vxs: 0, vys: 0 };
  return { vxs: kl / denom, vys: kd / denom };
}

/** Convert CL, CD, wing area, mass, rho to sustained speeds */
export function coeffToSustainedSpeeds(
  cl: number, cd: number, s: number, m: number, rho: number,
): SustainedSpeeds {
  const k = 0.5 * rho * s / m;
  const kl = cl * k / GRAVITY;
  const kd = cd * k / GRAVITY;
  return calculateSustainedSpeeds(kl, kd);
}

// ============================================================================
// System Polar Table — AOA Matching
// ============================================================================

/** One row in a pre-computed system polar table (built externally from segment model) */
export interface SystemPolarPoint {
  alpha_deg: number;
  cl: number;
  cd: number;
}

/**
 * Find the AOA that best matches observed CL/CD against the system polar table.
 * 
 * Uses exhaustive search with parabolic interpolation for sub-step resolution.
 * CL is weighted more heavily since it's more sensitive to α than CD.
 */
export function matchAOAFromTable(
  observedCL: number,
  observedCD: number,
  table: SystemPolarPoint[],
): { alpha_deg: number; residual: number } {
  if (table.length === 0) return { alpha_deg: 0, residual: Infinity };

  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < table.length; i++) {
    const dCL = observedCL - table[i].cl;
    const dCD = observedCD - table[i].cd;
    // Weight: CL error matters more than CD for α identification
    const dist = dCL * dCL + 0.25 * dCD * dCD;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  // Parabolic interpolation between neighbors for sub-step resolution
  const p = table[bestIdx];
  if (bestIdx > 0 && bestIdx < table.length - 1) {
    const prev = table[bestIdx - 1];
    const next = table[bestIdx + 1];

    const dPrev = observedCL - prev.cl;
    const dCur = observedCL - p.cl;
    const dNext = observedCL - next.cl;

    const denom = 2 * (dPrev - 2 * dCur + dNext);
    if (Math.abs(denom) > 1e-10) {
      const offset = (dPrev - dNext) / denom;
      const clamped = Math.max(-0.5, Math.min(0.5, offset));
      return {
        alpha_deg: p.alpha_deg + clamped * (next.alpha_deg - prev.alpha_deg) / 2,
        residual: Math.sqrt(bestDist),
      };
    }
  }

  return { alpha_deg: p.alpha_deg, residual: Math.sqrt(bestDist) };
}

// ============================================================================
// Full Aero Extraction
// ============================================================================

/**
 * Full aero extraction at one GPS timestep:
 *   velocity + acceleration → kl/kd/roll → CL/CD → AOA via polar table match
 * 
 * @param sRef  System reference area (m²)
 * @param mRef  Pilot mass (kg)
 * @param polarTable  Pre-built system polar table (from segment model sweep)
 */
export function extractAero(
  vN: number, vE: number, vD: number,
  aN: number, aE: number, aD: number,
  rho: number,
  sRef: number,
  mRef: number,
  polarTable?: SystemPolarPoint[],
  prevKl = 0.01, prevKd = 0.01, prevRoll = 0,
): AeroExtraction {
  const [kl, kd, roll] = calculateWingsuitParameters(vN, vE, vD, aN, aE, aD, prevKl, prevKd, prevRoll);
  const ss = calculateSustainedSpeeds(kl, kd);
  const ssMag = Math.sqrt(ss.vxs * ss.vxs + ss.vys * ss.vys);

  // Convert kl/kd back to CL/CD for polar matching
  const k = 0.5 * rho * sRef / mRef;
  const cl = k > 1e-12 ? kl * GRAVITY / k : 0;
  const cd = k > 1e-12 ? kd * GRAVITY / k : 0;

  let aoa = 0;
  let residual = Infinity;

  if (polarTable && polarTable.length > 0) {
    const match = matchAOAFromTable(cl, cd, polarTable);
    aoa = match.alpha_deg * Math.PI / 180;
    residual = match.residual;
  }

  // Euler angles — compose AOA on top of airspeed vector (matches CloudBASE)
  const airHorizontal = Math.sqrt(vN * vN + vE * vE);
  const gamma = airHorizontal > 0.1 ? -Math.atan2(vD, airHorizontal) : 0;
  const headingAir = Math.atan2(vE, vN);
  const theta = gamma + aoa * Math.cos(roll);
  // Heading correction: α·sin(φ) projects into heading plane, scaled by 1/cos(θ)
  const cosTheta = Math.cos(theta);
  const psi = headingAir + (Math.abs(cosTheta) > 0.01 ? aoa * Math.sin(roll) / cosTheta : 0);

  return {
    kl, kd, roll,
    cl, cd,
    sustainedX: ss.vxs,
    sustainedY: ss.vys,
    sustainedMag: ssMag,
    aoa,
    aoaResidual: residual,
    gamma,
    theta,
    psi,
  };
}

// ============================================================================
// Body Rates — Inverse DKE from Euler Rates
// ============================================================================

const R2D = 180 / Math.PI;

/**
 * Apply inverse DKE (Differential Kinematic Equation) to convert
 * Euler rates (φ̇, θ̇, ψ̇) to body-axis rates (p, q, r).
 *
 *   p = φ̇ − ψ̇·sin(θ)
 *   q = θ̇·cos(φ) + ψ̇·sin(φ)·cos(θ)
 *   r = −θ̇·sin(φ) + ψ̇·cos(φ)·cos(θ)
 *
 * All inputs/outputs in radians and rad/s; returned BodyRates in deg/s.
 *
 * @param phi    Smoothed roll angles (rad)
 * @param theta  Smoothed pitch angles (rad)
 * @param phiDot   Euler roll rate (rad/s) from LS derivative
 * @param thetaDot Euler pitch rate (rad/s) from LS derivative
 * @param psiDot   Euler yaw rate (rad/s) from LS derivative
 */
export function applyInverseDKE(
  phi: number[],
  theta: number[],
  phiDot: number[],
  thetaDot: number[],
  psiDot: number[],
): BodyRates[] {
  const n = phi.length;
  const rates: BodyRates[] = [];

  for (let i = 0; i < n; i++) {
    const sinPhi = Math.sin(phi[i]);
    const cosPhi = Math.cos(phi[i]);
    const sinTheta = Math.sin(theta[i]);
    const cosTheta = Math.cos(theta[i]);

    const p = phiDot[i] - psiDot[i] * sinTheta;
    const q = thetaDot[i] * cosPhi + psiDot[i] * sinPhi * cosTheta;
    const r = -thetaDot[i] * sinPhi + psiDot[i] * cosPhi * cosTheta;

    rates.push({ p: p * R2D, q: q * R2D, r: r * R2D });
  }

  return rates;
}

/**
 * Legacy: Compute body rates from Euler angle time histories using finite differences.
 * @deprecated Use SG-smoothed angles + LS derivative + applyInverseDKE instead.
 */
export function computeBodyRates(
  aeroPoints: { t: number; phi: number; theta: number; psi: number }[],
): BodyRates[] {
  const n = aeroPoints.length;
  if (n === 0) return [];
  if (n === 1) return [{ p: 0, q: 0, r: 0 }];

  /** Unwrap angle difference to [-π, π] */
  function unwrap(a2: number, a1: number): number {
    let diff = a2 - a1;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return diff;
  }

  const rates: BodyRates[] = [];

  for (let i = 0; i < n; i++) {
    let phiDot: number, thetaDot: number, psiDot: number;

    if (i === 0) {
      const dt = aeroPoints[1].t - aeroPoints[0].t;
      if (dt < 1e-6) { rates.push({ p: 0, q: 0, r: 0 }); continue; }
      phiDot = (aeroPoints[1].phi - aeroPoints[0].phi) / dt;
      thetaDot = (aeroPoints[1].theta - aeroPoints[0].theta) / dt;
      psiDot = unwrap(aeroPoints[1].psi, aeroPoints[0].psi) / dt;
    } else if (i === n - 1) {
      const dt = aeroPoints[i].t - aeroPoints[i - 1].t;
      if (dt < 1e-6) { rates.push({ p: 0, q: 0, r: 0 }); continue; }
      phiDot = (aeroPoints[i].phi - aeroPoints[i - 1].phi) / dt;
      thetaDot = (aeroPoints[i].theta - aeroPoints[i - 1].theta) / dt;
      psiDot = unwrap(aeroPoints[i].psi, aeroPoints[i - 1].psi) / dt;
    } else {
      const dt = aeroPoints[i + 1].t - aeroPoints[i - 1].t;
      if (dt < 1e-6) { rates.push({ p: 0, q: 0, r: 0 }); continue; }
      phiDot = (aeroPoints[i + 1].phi - aeroPoints[i - 1].phi) / dt;
      thetaDot = (aeroPoints[i + 1].theta - aeroPoints[i - 1].theta) / dt;
      psiDot = unwrap(aeroPoints[i + 1].psi, aeroPoints[i - 1].psi) / dt;
    }

    const { phi, theta } = aeroPoints[i];
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const p = phiDot - psiDot * sinTheta;
    const q = thetaDot * cosPhi + psiDot * sinPhi * cosTheta;
    const r = -thetaDot * sinPhi + psiDot * cosPhi * cosTheta;

    rates.push({ p: p * R2D, q: q * R2D, r: r * R2D });
  }

  return rates;
}
