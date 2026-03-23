/**
 * Wind Model — Placeholder
 * 
 * Meteorological "from" convention: wN positive = wind FROM north (blowing south).
 * Airspeed = ground velocity + wind vector (addition).
 * 
 * Example: flying north at 10 m/s, 10 m/s north wind (from north):
 *   airspeed_N = 10 + 10 = 20 m/s (headwind increases airspeed)
 * 
 * Future: estimate wind from track data (orbit method, speed variations, etc.)
 */

import { WindVector } from './types';

/** Zero-wind model: ground velocity = airspeed */
export function zeroWind(): WindVector {
  return { wN: 0, wE: 0, wD: 0 };
}

/** Constant wind model (meteorological "from" convention) */
export function constantWind(wN: number, wE: number, wD: number = 0): WindVector {
  return { wN, wE, wD };
}

/** Apply wind correction: airspeed = ground velocity + wind ("from" convention) */
export function applyWindCorrection(
  velN: number, velE: number, velD: number,
  wind: WindVector,
): { avN: number; avE: number; avD: number } {
  return {
    avN: velN + wind.wN,
    avE: velE + wind.wE,
    avD: velD + wind.wD,
  };
}
