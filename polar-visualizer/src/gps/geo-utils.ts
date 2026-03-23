/**
 * Geographic Utilities — Geodetic ↔ NED conversions
 * 
 * Flat-earth approximation with average-latitude correction for East-West.
 * Haversine fallback for long distances (>~1km).
 * Ported from BASElineXR GeoUtils.java.
 */

const R = 6371000; // Earth radius in meters

/**
 * Convert geodetic coordinates to NED position relative to an origin.
 * 
 * @param lat   Target latitude (degrees)
 * @param lon   Target longitude (degrees)
 * @param alt   Target altitude MSL (meters)
 * @param lat0  Origin latitude (degrees)
 * @param lon0  Origin longitude (degrees)
 * @param alt0  Origin altitude MSL (meters)
 * @returns { n, e, d } position in meters (North-East-Down relative to origin)
 */
export function geodeticToNED(
  lat: number, lon: number, alt: number,
  lat0: number, lon0: number, alt0: number,
): { n: number; e: number; d: number } {
  const lat1 = lat0 * Math.PI / 180;
  const lon1 = lon0 * Math.PI / 180;
  const lat2 = lat * Math.PI / 180;
  const lon2 = lon * Math.PI / 180;

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  let northOffset: number;
  let eastOffset: number;

  if (Math.abs(dLat) > 0.01 || Math.abs(dLon) > 0.01) {
    // Long distance: haversine + bearing decomposition
    const bearing = Math.atan2(
      Math.sin(dLon) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon),
    );
    const distance = haversineDistance(lat1, lon1, lat2, lon2);
    northOffset = distance * Math.cos(bearing);
    eastOffset = distance * Math.sin(bearing);
  } else {
    // Short distance: flat earth with average latitude correction
    northOffset = R * dLat;
    const avgLat = (lat1 + lat2) / 2;
    eastOffset = R * dLon * Math.cos(avgLat);
  }

  return {
    n: northOffset,
    e: eastOffset,
    d: -(alt - alt0),  // Down = negative altitude change
  };
}

/** Haversine distance between two points (radians in, meters out) */
function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Convert NED offset back to geodetic coordinates.
 * Inverse of geodeticToNED for map overlay / export.
 */
export function nedToGeodetic(
  n: number, e: number, d: number,
  lat0: number, lon0: number, alt0: number,
): { lat: number; lon: number; alt: number } {
  const lat0Rad = lat0 * Math.PI / 180;
  const newLat = lat0Rad + n / R;
  const newLon = (lon0 * Math.PI / 180) + e / (R * Math.cos(lat0Rad));
  return {
    lat: newLat * 180 / Math.PI,
    lon: newLon * 180 / Math.PI,
    alt: alt0 - d,
  };
}
