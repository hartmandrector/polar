/**
 * Coefficient readout panel — updates the numeric display.
 */

import type { FullCoefficients } from '../polar/continuous-polar.ts'
import { coeffToForces, coeffToSS } from '../polar/coefficients.ts'
import type { ContinuousPolar } from '../polar/continuous-polar.ts'
import type { InertiaComponents } from '../polar/inertia.ts'

function setTextContent(id: string, text: string): void {
  const el = document.getElementById(id)
  if (el) el.textContent = text
}

function fmt(n: number, digits = 3): string {
  return n.toFixed(digits)
}

export function updateReadout(
  coeffs: FullCoefficients,
  polar: ContinuousPolar,
  airspeed: number,
  rho: number,
  legacyCoeffs?: { cl: number, cd: number, cp: number }
): void {
  // Coefficients
  setTextContent('r-cl', fmt(coeffs.cl))
  setTextContent('r-cd', fmt(coeffs.cd))
  setTextContent('r-cy', fmt(coeffs.cy))
  setTextContent('r-cm', fmt(coeffs.cm))
  setTextContent('r-cn', fmt(coeffs.cn))
  setTextContent('r-cl-roll', fmt(coeffs.cl_roll))
  setTextContent('r-cp', fmt(coeffs.cp))
  setTextContent('r-f', `${fmt(coeffs.f)} (${(coeffs.f * 100).toFixed(0)}%)`)

  // Forces
  const forces = coeffToForces(coeffs.cl, coeffs.cd, coeffs.cy, polar.s, polar.m, rho, airspeed)
  setTextContent('r-lift', `${fmt(forces.lift, 1)} N`)
  setTextContent('r-drag', `${fmt(forces.drag, 1)} N`)
  setTextContent('r-side', `${fmt(forces.side, 1)} N`)
  setTextContent('r-weight', `${fmt(forces.weight, 1)} N`)

  const ld = coeffs.cd > 0.001 ? coeffs.cl / coeffs.cd : 0
  setTextContent('r-ld', fmt(ld, 2))
  const glideAngle = Math.atan2(coeffs.cd, coeffs.cl) * (180 / Math.PI)
  setTextContent('r-glide', `${fmt(glideAngle, 1)}°`)

  // Legacy coefficients
  if (legacyCoeffs) {
    setTextContent('r-cl-leg', fmt(legacyCoeffs.cl))
    setTextContent('r-cd-leg', fmt(legacyCoeffs.cd))
    setTextContent('r-cp-leg', fmt(legacyCoeffs.cp))
  } else {
    setTextContent('r-cl-leg', '—')
    setTextContent('r-cd-leg', '—')
    setTextContent('r-cp-leg', '—')
  }
}

/**
 * Update the inertia & angular acceleration readout.
 */
export function updateInertiaReadout(
  inertia: InertiaComponents,
  coeffs: FullCoefficients,
  polar: ContinuousPolar,
  airspeed: number,
  rho: number
): void {
  // Display principal moments of inertia
  setTextContent('r-ixx', fmt(inertia.Ixx, 2))
  setTextContent('r-iyy', fmt(inertia.Iyy, 2))
  setTextContent('r-izz', fmt(inertia.Izz, 2))

  // Compute torques: τ = q·S·c·C_moment
  const q = 0.5 * rho * airspeed * airspeed
  const pitchTorque = q * polar.s * polar.chord * coeffs.cm
  const yawTorque = q * polar.s * polar.chord * coeffs.cn
  const rollTorque = q * polar.s * polar.chord * coeffs.cl_roll

  // Angular acceleration: α̈ = τ / I  (simplified, ignoring cross-coupling)
  const pitchAccel = inertia.Iyy > 0.001 ? pitchTorque / inertia.Iyy : 0
  const yawAccel = inertia.Izz > 0.001 ? yawTorque / inertia.Izz : 0
  const rollAccel = inertia.Ixx > 0.001 ? rollTorque / inertia.Ixx : 0

  setTextContent('r-pitch-accel', `${fmt(pitchAccel * 180 / Math.PI, 1)}°/s²`)
  setTextContent('r-yaw-accel', `${fmt(yawAccel * 180 / Math.PI, 1)}°/s²`)
  setTextContent('r-roll-accel', `${fmt(rollAccel * 180 / Math.PI, 1)}°/s²`)
}

/**
 * Update the Rates readout section.
 * Shows Euler rates (from UI), body rates (from inverse DKE), and
 * angular acceleration (from rotational EOM).
 */
export function updateRatesReadout(
  eulerRates: { phiDot: number; thetaDot: number; psiDot: number },
  bodyRates: { p: number; q: number; r: number },
  bodyAccel: { pDot: number; qDot: number; rDot: number } | null,
): void {
  const d = 180 / Math.PI
  setTextContent('r-euler-rates',
    `${fmt(eulerRates.phiDot * d, 1)}, ${fmt(eulerRates.thetaDot * d, 1)}, ${fmt(eulerRates.psiDot * d, 1)} °/s`)
  setTextContent('r-body-rates',
    `${fmt(bodyRates.p * d, 1)}, ${fmt(bodyRates.q * d, 1)}, ${fmt(bodyRates.r * d, 1)} °/s`)
  if (bodyAccel) {
    setTextContent('r-body-accel',
      `${fmt(bodyAccel.pDot * d, 1)}, ${fmt(bodyAccel.qDot * d, 1)}, ${fmt(bodyAccel.rDot * d, 1)} °/s²`)
  } else {
    setTextContent('r-body-accel', '—')
  }
}

/**
 * Update the Positions readout section.
 * Shows CG in body and inertial frames.
 */
export function updatePositionsReadout(
  cgBody: { x: number; y: number; z: number },
  cgInertial: { x: number; y: number; z: number } | null,
): void {
  setTextContent('r-cg-body',
    `${fmt(cgBody.x, 3)}, ${fmt(cgBody.y, 3)}, ${fmt(cgBody.z, 3)} m`)
  if (cgInertial) {
    setTextContent('r-cg-inertial',
      `${fmt(cgInertial.x, 3)}, ${fmt(cgInertial.y, 3)}, ${fmt(cgInertial.z, 3)} m`)
  } else {
    setTextContent('r-cg-inertial', '—')
  }
}
