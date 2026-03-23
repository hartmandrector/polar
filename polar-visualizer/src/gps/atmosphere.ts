/**
 * Atmosphere Model — ISA Standard Atmosphere
 * 
 * Ported from kalman/wse.ts. All standard ISA computations.
 */

// ISA standard atmosphere constants
export const GRAVITY = 9.80665;       // m/s²
export const GAS_CONST = 8.31447;     // J/mol/K
export const RHO_0 = 1.225;           // kg/m³ sea level density
export const PRESSURE_0 = 101325.0;   // Pa sea level pressure
export const TEMP_0 = 288.15;         // K (15°C)
export const LAPSE_RATE = 0.0065;     // K/m
export const MM_AIR = 0.0289644;      // kg/mol molar mass of dry air

const BARO_EXP = GRAVITY * MM_AIR / (GAS_CONST * LAPSE_RATE);

/** Temperature in Kelvin at altitude (m MSL) */
export function temperature(altitude: number): number {
  return TEMP_0 - LAPSE_RATE * altitude;
}

/** Barometric pressure in Pascals at altitude (m MSL) */
export function altitudeToPressure(altitude: number): number {
  return PRESSURE_0 * Math.pow(1 - LAPSE_RATE * altitude / TEMP_0, BARO_EXP);
}

/** Air density kg/m³ at altitude with optional temperature offset */
export function getRho(altitude: number, temperatureOffset: number = 0): number {
  const pressure = altitudeToPressure(altitude);
  const temp = temperature(altitude) + temperatureOffset;
  return pressure / (GAS_CONST / MM_AIR) / temp;
}

/** Dynamic pressure Pa from density and airspeed */
export function dynamicPressure(rho: number, airspeed: number): number {
  return 0.5 * rho * airspeed * airspeed;
}
