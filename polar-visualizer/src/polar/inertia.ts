/**
 * Inertia model — generic point-mass inertia computation.
 *
 * Computes:
 *   - Inertia tensor components (Ixx, Iyy, Izz, Ixy, Ixz, Iyz)
 *   - Center of mass
 *   - Physical mass positions for 3D overlay
 *
 * Mass segment positions are height-normalized and in the NED body frame:
 *   x = forward (head direction), y = right, z = down
 *
 * The mass data itself lives on ContinuousPolar.massSegments.
 *
 * This module is UI-independent and portable to CloudBASE.
 */

import type { MassSegment } from './continuous-polar.ts'

export interface InertiaComponents {
  Ixx: number  // roll  (about forward axis)
  Iyy: number  // pitch (about right axis)
  Izz: number  // yaw   (about down axis)
  Ixy: number
  Ixz: number
  Iyz: number
}

/**
 * Calculate inertia tensor components from point masses.
 */
export function calculateInertiaComponents(
  masses: number[],
  positions: { x: number; y: number; z: number }[]
): InertiaComponents {
  let Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0

  for (let i = 0; i < masses.length; i++) {
    const m = masses[i]
    const { x, y, z } = positions[i]

    Ixx += m * (y * y + z * z)
    Iyy += m * (x * x + z * z)
    Izz += m * (x * x + y * y)
    Ixy -= m * x * y
    Ixz -= m * x * z
    Iyz -= m * y * z
  }

  return { Ixx, Iyy, Izz, Ixy, Ixz, Iyz }
}

/** Zero inertia fallback for polars without mass segments. */
export const ZERO_INERTIA: InertiaComponents = {
  Ixx: 0, Iyy: 0, Izz: 0, Ixy: 0, Ixz: 0, Iyz: 0
}

/**
 * Compute inertia components from a polar's mass segments.
 *
 * @param segments  Mass segments from polar.massSegments
 * @param height    Pilot height [m] (default 1.875) — scales normalized positions
 * @param weight    Total system mass [kg] — scales mass ratios
 */
export function computeInertia(
  segments: MassSegment[],
  height: number = 1.875,
  weight: number = 77.5
): InertiaComponents {
  if (segments.length === 0) return ZERO_INERTIA
  const masses = segments.map(s => s.massRatio * weight)
  const positions = segments.map(s => ({
    x: s.normalizedPosition.x * height,
    y: s.normalizedPosition.y * height,
    z: s.normalizedPosition.z * height,
  }))
  return calculateInertiaComponents(masses, positions)
}

/**
 * Compute center of mass in body-frame NED coordinates (meters).
 */
export function computeCenterOfMass(
  segments: MassSegment[],
  height: number = 1.875,
  weight: number = 77.5
): { x: number; y: number; z: number } {
  let totalMass = 0
  let cx = 0, cy = 0, cz = 0

  for (const seg of segments) {
    const m = seg.massRatio * weight
    totalMass += m
    cx += m * seg.normalizedPosition.x * height
    cy += m * seg.normalizedPosition.y * height
    cz += m * seg.normalizedPosition.z * height
  }

  if (totalMass === 0) return { x: 0, y: 0, z: 0 }

  return {
    x: cx / totalMass,
    y: cy / totalMass,
    z: cz / totalMass,
  }
}

/**
 * Get physical mass positions (absolute meters) for 3D overlay rendering.
 */
export function getPhysicalMassPositions(
  segments: MassSegment[],
  height: number = 1.875,
  weight: number = 77.5
): { name: string; mass: number; x: number; y: number; z: number }[] {
  return segments.map(s => ({
    name: s.name,
    mass: s.massRatio * weight,
    x: s.normalizedPosition.x * height,
    y: s.normalizedPosition.y * height,
    z: s.normalizedPosition.z * height,
  }))
}
