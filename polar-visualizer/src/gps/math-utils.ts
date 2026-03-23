/**
 * Math Utilities for Signal Processing
 */

/**
 * Linear least squares slope fitting
 * Calculates the slope of y vs x using linear regression
 * 
 * @param points - Array of data points
 * @param getX - Function to extract x value from each point
 * @param getY - Function to extract y value from each point
 * @returns The slope (dy/dx)
 */
export function getSlope<T>(
  points: T[], 
  getX: (d: T) => number, 
  getY: (d: T) => number
): number {
  if (points.length < 2) {
    return 0;
  }
  
  let sumx = 0;
  let sumy = 0;
  let sumxx = 0;
  let sumxy = 0;
  
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const x = getX(point);
    const y = getY(point);
    sumx += x;
    sumy += y;
    sumxx += x * x;
    sumxy += x * y;
  }
  
  const n = points.length;
  const denominator = sumxx - sumx * sumx / n;
  
  // Avoid division by zero
  if (Math.abs(denominator) < 1e-12) {
    return 0;
  }
  
  return (sumxy - sumx * sumy / n) / denominator;
}

/**
 * Calculate derivative (rate of change) at each point using linear regression
 * over a sliding window
 * 
 * @param data - Array of data points
 * @param windowSize - Number of points to use for slope calculation (should be odd)
 * @param getTime - Function to extract time value from each point
 * @param getValue - Function to extract the value to differentiate
 * @returns Array of derivative values (dValue/dTime)
 */
export function calculateDerivative<T>(
  data: T[],
  windowSize: number,
  getTime: (d: T) => number,
  getValue: (d: T) => number
): number[] {
  if (data.length === 0) return [];
  if (data.length === 1) return [0];
  
  const halfWindow = Math.floor(windowSize / 2);
  const result: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    // Determine window bounds
    let startIdx = i - halfWindow;
    let endIdx = i + halfWindow;
    
    // Handle edges by shifting window
    if (startIdx < 0) {
      startIdx = 0;
      endIdx = Math.min(windowSize - 1, data.length - 1);
    }
    if (endIdx >= data.length) {
      endIdx = data.length - 1;
      startIdx = Math.max(0, endIdx - windowSize + 1);
    }
    
    // Extract window
    const window = data.slice(startIdx, endIdx + 1);
    
    // Calculate slope (derivative)
    const slope = getSlope(window, getTime, getValue);
    result.push(slope);
  }
  
  return result;
}

/**
 * Calculate acceleration from velocity data using linear regression
 * 
 * @param data - Array of data points with time and velocity
 * @param windowSize - Number of points for slope calculation
 * @param getTime - Function to extract time
 * @param getVelN - Function to extract North velocity
 * @param getVelW - Function to extract West velocity  
 * @param getVelU - Function to extract Up velocity
 * @returns Object with acceleration arrays for each component
 */
export function calculateAcceleration<T>(
  data: T[],
  windowSize: number,
  getTime: (d: T) => number,
  getVelN: (d: T) => number,
  getVelW: (d: T) => number,
  getVelU: (d: T) => number
): { accelNorth: number[]; accelWest: number[]; accelUp: number[] } {
  const accelNorth = calculateDerivative(data, windowSize, getTime, getVelN);
  const accelWest = calculateDerivative(data, windowSize, getTime, getVelW);
  const accelUp = calculateDerivative(data, windowSize, getTime, getVelU);
  
  return { accelNorth, accelWest, accelUp };
}
