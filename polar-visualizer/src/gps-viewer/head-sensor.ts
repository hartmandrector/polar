/**
 * Head Sensor Data — Parser + Types for fused sensor fusion CSV
 *
 * Reads the export from sensor_fusion_viewer: ~13 Hz sensor data
 * with orientation quaternions, Euler angles, body/earth accelerations,
 * gyro rates, and interpolated GPS.
 *
 * Coordinate frames:
 *   Fused CSV:  NWU (North-West-Up) — Earth frame
 *   GPS scene:  NED (North-East-Down) — physics frame
 *   Three.js:   Y-up
 *
 * Quaternion: body-to-earth, scalar-first (qw, qx, qy, qz)
 */

export interface HeadSensorPoint {
  t: number            // seconds from start
  // Euler angles (degrees, NWU from fusion)
  roll: number
  pitch: number
  yaw: number
  // Quaternion body-to-earth NWU (scalar-first)
  qw: number
  qx: number
  qy: number
  qz: number
  // Body-frame sensors (g units)
  accelBodyX: number
  accelBodyY: number
  accelBodyZ: number
  gyroX: number        // deg/s
  gyroY: number
  gyroZ: number
  // Gravity estimate in body frame (g units)
  gravBodyX: number
  gravBodyY: number
  gravBodyZ: number
  // Linear acceleration in body frame (gravity removed, g units)
  linearAccelX: number
  linearAccelY: number
  linearAccelZ: number
  // Magnetometer (body frame, optional — not in all exports)
  magX: number    // NaN if not available
  magY: number
  magZ: number
  // GPS time sync (NaN when no GPS fix)
  gpsLat: number
  gpsLon: number
  gpsHMSL: number
}

/**
 * Parse fused sensor fusion CSV export.
 * Skips comment lines (#) and unit row (second non-comment line).
 */
export function parseHeadSensorCSV(text: string): HeadSensorPoint[] {
  const lines = text.split('\n')
  const points: HeadSensorPoint[] = []

  let headerCols: string[] = []
  let headerFound = false
  let unitRowSkipped = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const cols = line.split(',')

    if (!headerFound) {
      headerCols = cols.map(c => c.trim())
      headerFound = true
      continue
    }

    if (!unitRowSkipped) {
      // Second non-comment line is units row
      unitRowSkipped = true
      continue
    }

    // Parse data row by column name
    const get = (name: string): number => {
      const idx = headerCols.indexOf(name)
      if (idx < 0 || idx >= cols.length) return NaN
      const v = parseFloat(cols[idx])
      return v
    }

    points.push({
      t: get('timestamp'),
      roll: get('roll'),
      pitch: get('pitch'),
      yaw: get('yaw'),
      qw: get('qw'),
      qx: get('qx'),
      qy: get('qy'),
      qz: get('qz'),
      accelBodyX: get('accel_body_x'),
      accelBodyY: get('accel_body_y'),
      accelBodyZ: get('accel_body_z'),
      gyroX: get('gyro_x'),
      gyroY: get('gyro_y'),
      gyroZ: get('gyro_z'),
      gravBodyX: get('gravity_body_x'),
      gravBodyY: get('gravity_body_y'),
      gravBodyZ: get('gravity_body_z'),
      linearAccelX: get('linear_accel_x'),
      linearAccelY: get('linear_accel_y'),
      linearAccelZ: get('linear_accel_z'),
      magX: get('mag_x'),
      magY: get('mag_y'),
      magZ: get('mag_z'),
      gpsLat: get('gps_lat'),
      gpsLon: get('gps_lon'),
      gpsHMSL: get('gps_hMSL'),
    })
  }

  return points
}

/**
 * Find the head sensor point closest to time t using binary search.
 * Returns index and interpolation fraction to next point.
 */
export function findHeadIndex(points: HeadSensorPoint[], t: number): { index: number; fraction: number } {
  if (points.length === 0) return { index: 0, fraction: 0 }

  let lo = 0, hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (points[mid].t <= t) lo = mid
    else hi = mid - 1
  }

  if (lo >= points.length - 1) return { index: points.length - 1, fraction: 0 }

  const dt = points[lo + 1].t - points[lo].t
  const fraction = dt > 0 ? Math.min(1, (t - points[lo].t) / dt) : 0
  return { index: lo, fraction }
}
