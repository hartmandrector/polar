/**
 * Savitzky-Golay Filter Implementation
 * 
 * Provides smoothing of noisy data using polynomial fitting.
 * Uses position-specific coefficients for proper edge handling.
 * 
 * This implementation:
 * - Uses pre-computed coefficients for window sizes 5-25
 * - Handles edges properly with position-specific formulas
 * - Supports multi-pass filtering for stronger smoothing
 */

import { SG_COEFFICIENTS, SGWindowSize, AVAILABLE_WINDOW_SIZES } from './sg-coefficients';

// ============================================================================
// Core Filter Function
// ============================================================================

/**
 * Apply Savitzky-Golay filter with proper endpoint formulas
 * Uses position-specific coefficients for edges, symmetric coefficients for center
 * 
 * @param data - Array of data points
 * @param windowSize - Filter window size (must be 5,7,9,11,13,15,17,19,21,23,25)
 * @param extractValue - Function to extract the numeric value from each data point
 * @returns Smoothed values array
 */
export function applySGFilter<T>(
  data: T[],
  windowSize: SGWindowSize,
  extractValue: (item: T) => number
): number[] {
  const sgConfig = SG_COEFFICIENTS[windowSize];
  if (!sgConfig) {
    throw new Error(`Unsupported window size: ${windowSize}. Available: ${AVAILABLE_WINDOW_SIZES.join(', ')}`);
  }
  
  // Need at least windowSize points for filtering
  if (data.length < windowSize) {
    // Fall back to returning original values if not enough data
    return data.map(extractValue);
  }
  
  const { halfSize, coeffs } = sgConfig;
  const result: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    let positionCoeffs: readonly number[];
    let startIdx: number;
    
    if (i < halfSize) {
      // Left edge: use position-specific coefficients
      // Window is fixed at the start: [0 ... windowSize-1]
      positionCoeffs = coeffs[i]!;
      startIdx = 0;
    } else if (i >= data.length - halfSize) {
      // Right edge: mirror the left edge approach
      // Window is fixed at the end: [data.length-windowSize ... data.length-1]
      const distanceFromEnd = data.length - 1 - i;
      positionCoeffs = [...coeffs[distanceFromEnd]!].reverse();
      startIdx = data.length - windowSize;
    } else {
      // Center: use symmetric coefficients
      positionCoeffs = coeffs[halfSize]!;
      startIdx = i - halfSize;
    }
    
    // Apply convolution
    let sum = 0;
    for (let j = 0; j < windowSize; j++) {
      const dataIdx = startIdx + j;
      if (dataIdx >= 0 && dataIdx < data.length) {
        sum += positionCoeffs[j] * extractValue(data[dataIdx]);
      }
    }
    result.push(sum);
  }
  
  return result;
}

/**
 * Apply SG filter to a simple array of numbers
 */
export function applySGFilterToArray(
  data: number[],
  windowSize: SGWindowSize
): number[] {
  return applySGFilter(data, windowSize, x => x);
}

// ============================================================================
// Multi-Pass Filter
// ============================================================================

/**
 * Apply multiple passes of SG filter with different window sizes
 * This provides stronger smoothing while maintaining edge handling
 * 
 * @param data - Array of data points
 * @param windowSizes - Array of window sizes to apply in sequence
 * @param extractValue - Function to extract numeric value
 * @returns Smoothed values array
 */
export function applySGFilterMultiPass<T>(
  data: T[],
  windowSizes: SGWindowSize[],
  extractValue: (item: T) => number
): number[] {
  if (data.length === 0) return [];
  if (windowSizes.length === 0) return data.map(extractValue);
  
  // First pass with original data
  let result = applySGFilter(data, windowSizes[0], extractValue);
  
  // Subsequent passes with the smoothed result
  for (let pass = 1; pass < windowSizes.length; pass++) {
    result = applySGFilterToArray(result, windowSizes[pass]);
  }
  
  return result;
}

// ============================================================================
// Velocity Smoothing
// ============================================================================

/**
 * Result of velocity smoothing
 */
export interface SmoothedVelocity {
  velNorth: number;  // m/s (NWU frame)
  velWest: number;   // m/s (NWU frame)
  velUp: number;     // m/s (NWU frame)
}

/**
 * Input point with velocity components
 */
export interface VelocityPoint {
  velNorth: number;
  velWest: number;
  velUp: number;
}

/**
 * Calculate smoothed velocities using multi-pass SG filter
 * 
 * @param points - Array of points with velocity data
 * @param windowSizes - Array of window sizes for multi-pass filtering
 * @returns Array of smoothed velocities
 */
export function smoothVelocities<T extends VelocityPoint>(
  points: T[],
  windowSizes: SGWindowSize[]
): SmoothedVelocity[] {
  if (points.length === 0) return [];
  
  // Apply multi-pass filter to each velocity component
  const smoothVelNorth = applySGFilterMultiPass(points, windowSizes, p => p.velNorth);
  const smoothVelWest = applySGFilterMultiPass(points, windowSizes, p => p.velWest);
  const smoothVelUp = applySGFilterMultiPass(points, windowSizes, p => p.velUp);
  
  // Combine into result array
  return points.map((_, i) => ({
    velNorth: smoothVelNorth[i],
    velWest: smoothVelWest[i],
    velUp: smoothVelUp[i]
  }));
}

/**
 * Default window sizes for GPS velocity smoothing
 * Uses 3-pass with decreasing window sizes: 25, 21, 11
 */
export const DEFAULT_GPS_SMOOTHING_WINDOWS: SGWindowSize[] = [21, 11, 7];

/**
 * Smooth GPS velocities with default settings
 */
export function smoothGPSVelocities<T extends VelocityPoint>(
  points: T[]
): SmoothedVelocity[] {
  return smoothVelocities(points, DEFAULT_GPS_SMOOTHING_WINDOWS);
}
