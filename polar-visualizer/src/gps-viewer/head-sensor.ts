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
  gpsTimeMs: number    // absolute UTC ms (from gps_time column), NaN if not available
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
 * Normalizes timestamps to start at 0.
 * Returns { points, gpsStartIndex } where gpsStartIndex is the first row
 * with valid GPS data (for auto time-alignment with TRACK.CSV).
 */
export function parseHeadSensorCSV(text: string): { points: HeadSensorPoint[]; gpsStartIndex: number } {
  const lines = text.split('\n')
  const points: HeadSensorPoint[] = []

  let headerCols: string[] = []
  let headerFound = false
  let unitRowSkipped = false
  let gpsStartIndex = -1

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

    const gpsLat = get('gps_lat')
    const gpsTimeRaw = (() => {
      const idx = headerCols.indexOf('gps_time')
      if (idx < 0 || idx >= cols.length) return ''
      return cols[idx].trim()
    })()
    const gpsTimeMs = gpsTimeRaw ? new Date(gpsTimeRaw).getTime() : NaN

    // Detect first row with GPS data (prefer gps_time, fall back to gps_lat)
    if (gpsStartIndex < 0) {
      if (gpsTimeRaw && !isNaN(gpsTimeMs)) {
        gpsStartIndex = points.length
      } else if (!isNaN(gpsLat) && Math.abs(gpsLat) > 1) {
        // gps_lat > 1 degree = real geodetic coordinate (not interpolated near-zero)
        gpsStartIndex = points.length
      }
    }

    points.push({
      t: get('timestamp'),
      gpsTimeMs,
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
      gpsLat: gpsLat,
      gpsLon: get('gps_lon'),
      gpsHMSL: get('gps_hMSL'),
    })
  }

  // Normalize timestamps to start at 0
  if (points.length > 0) {
    const t0 = points[0].t
    if (t0 !== 0) {
      for (const p of points) {
        p.t -= t0
      }
    }
  }

  return { points, gpsStartIndex }
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

/**
 * Linearly interpolate between two HeadSensorPoints.
 * Used to smooth sensor vectors from ~13Hz to 60fps rendering.
 */
export function lerpSensorPoints(a: HeadSensorPoint, b: HeadSensorPoint, f: number): HeadSensorPoint {
  const l = (va: number, vb: number) => va + (vb - va) * f
  return {
    t: l(a.t, b.t),
    gpsTimeMs: l(a.gpsTimeMs, b.gpsTimeMs),
    roll: l(a.roll, b.roll),
    pitch: l(a.pitch, b.pitch),
    yaw: l(a.yaw, b.yaw),
    qw: l(a.qw, b.qw),
    qx: l(a.qx, b.qx),
    qy: l(a.qy, b.qy),
    qz: l(a.qz, b.qz),
    accelBodyX: l(a.accelBodyX, b.accelBodyX),
    accelBodyY: l(a.accelBodyY, b.accelBodyY),
    accelBodyZ: l(a.accelBodyZ, b.accelBodyZ),
    gyroX: l(a.gyroX, b.gyroX),
    gyroY: l(a.gyroY, b.gyroY),
    gyroZ: l(a.gyroZ, b.gyroZ),
    gravBodyX: l(a.gravBodyX, b.gravBodyX),
    gravBodyY: l(a.gravBodyY, b.gravBodyY),
    gravBodyZ: l(a.gravBodyZ, b.gravBodyZ),
    linearAccelX: l(a.linearAccelX, b.linearAccelX),
    linearAccelY: l(a.linearAccelY, b.linearAccelY),
    linearAccelZ: l(a.linearAccelZ, b.linearAccelZ),
    magX: l(a.magX, b.magX),
    magY: l(a.magY, b.magY),
    magZ: l(a.magZ, b.magZ),
    gpsLat: l(a.gpsLat, b.gpsLat),
    gpsLon: l(a.gpsLon, b.gpsLon),
    gpsHMSL: l(a.gpsHMSL, b.gpsHMSL),
  }
}
