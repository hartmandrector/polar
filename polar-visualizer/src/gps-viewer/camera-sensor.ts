/**
 * Camera Sensor Data — Parser + Types for Gyroflow camera CSV export
 *
 * Reads per-frame or full-rate (1 kHz) camera IMU data exported from Gyroflow.
 * Provides orientation quaternions for driving the head model from camera perspective.
 *
 * Coordinate frames:
 *   Gyroflow org_quat: camera orientation (convention TBD — likely gravity-aligned,
 *     possibly ENU or similar). Will be mapped empirically.
 *   GPS pipeline: NED
 *   Three.js: Y-up
 *
 * Time: timestamp_ms is relative to video start (can be negative for pre-roll IMU).
 *   Converted to GPS pipeline time via sync offset from sync-result.json.
 */

export interface CameraSensorPoint {
  /** Frame number from Gyroflow export */
  frame: number
  /** Milliseconds from video start (can be negative) */
  timestampMs: number
  /** GPS pipeline time in seconds (after sync offset applied) */
  pipelineTimeS: number
  /** Orientation quaternion (scalar-first) — raw from Gyroflow */
  qw: number
  qx: number
  qy: number
  qz: number
  /** Euler angles from Gyroflow (degrees) */
  pitch: number
  yaw: number
  roll: number
  /** Raw gyro (deg/s) */
  gyroX: number
  gyroY: number
  gyroZ: number
  /** Raw accelerometer */
  accX: number
  accY: number
  accZ: number
}

export interface CameraSyncResult {
  /** Relative path to FlySight CSV (in public/) */
  flysight?: string
  /** Absolute path to .insv video file */
  video?: string
  /** Absolute path to Gyroflow camera data CSV */
  gyroflow?: string
  offsetMs: number
  method: string
  confidence: string
  videoStartEpochMs: number
  gpsStartEpochMs: number
  overlapDurationS?: number
  generatedAt?: string
  /** Saved camera mount offset */
  mountOffset?: CameraMountOffset
}

/** Mount offset for camera-to-head orientation correction */
export interface CameraMountOffset {
  /** Heading offset in degrees */
  headingDeg: number
  /** Pitch offset in degrees (negative = compensate forward tilt) */
  pitchDeg: number
  /** Roll offset in degrees */
  rollDeg: number
}

export const DEFAULT_MOUNT_OFFSET: CameraMountOffset = {
  headingDeg: 0,
  pitchDeg: -20,
  rollDeg: 0,
}

/**
 * Parse Gyroflow camera data CSV.
 * Header: frame,timestamp_ms,org_acc_x,...,org_quat_w,org_quat_x,org_quat_y,org_quat_z,...
 *
 * @param text - Raw CSV text
 * @param syncOffsetMs - Offset to convert video time → GPS pipeline time:
 *   pipeline_time_ms = timestamp_ms + syncOffsetMs
 */
export function parseCameraSensorCSV(
  text: string,
  syncOffsetMs: number,
): CameraSensorPoint[] {
  const lines = text.split('\n')
  const points: CameraSensorPoint[] = []

  if (lines.length < 2) return points

  const headerLine = lines[0].trim()
  const headers = headerLine.split(',').map(h => h.trim())

  const col = (name: string): number => headers.indexOf(name)

  const frameCol = col('frame')
  const tsCol = col('timestamp_ms')
  const accXCol = col('org_acc_x')
  const accYCol = col('org_acc_y')
  const accZCol = col('org_acc_z')
  const pitchCol = col('org_pitch')
  const yawCol = col('org_yaw')
  const rollCol = col('org_roll')
  const gyroXCol = col('org_gyro_x')
  const gyroYCol = col('org_gyro_y')
  const gyroZCol = col('org_gyro_z')
  const qwCol = col('org_quat_w')
  const qxCol = col('org_quat_x')
  const qyCol = col('org_quat_y')
  const qzCol = col('org_quat_z')

  if (qwCol < 0 || qxCol < 0 || qyCol < 0 || qzCol < 0) {
    console.error('Camera CSV missing org_quat columns')
    return points
  }
  if (tsCol < 0) {
    console.error('Camera CSV missing timestamp_ms column')
    return points
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cols = line.split(',')
    const get = (idx: number): number => {
      if (idx < 0 || idx >= cols.length) return NaN
      return parseFloat(cols[idx])
    }

    const tsMs = get(tsCol)
    if (isNaN(tsMs)) continue

    const pipelineMs = tsMs + syncOffsetMs
    points.push({
      frame: get(frameCol) || 0,
      timestampMs: tsMs,
      pipelineTimeS: pipelineMs / 1000,
      qw: get(qwCol),
      qx: get(qxCol),
      qy: get(qyCol),
      qz: get(qzCol),
      pitch: get(pitchCol),
      yaw: get(yawCol),
      roll: get(rollCol),
      gyroX: get(gyroXCol),
      gyroY: get(gyroYCol),
      gyroZ: get(gyroZCol),
      accX: get(accXCol),
      accY: get(accYCol),
      accZ: get(accZCol),
    })
  }

  return points
}

/**
 * Parse sync-result.json content.
 */
export function parseSyncResult(text: string): CameraSyncResult | null {
  try {
    const data = JSON.parse(text)
    if (typeof data.offsetMs !== 'number') return null
    return {
      flysight: data.flysight || undefined,
      video: data.video || undefined,
      gyroflow: data.gyroflow || undefined,
      offsetMs: data.offsetMs,
      method: data.method || 'unknown',
      confidence: data.confidence || 'unknown',
      videoStartEpochMs: data.videoStartEpochMs || 0,
      gpsStartEpochMs: data.gpsStartEpochMs || 0,
      overlapDurationS: data.overlapDurationS,
      generatedAt: data.generatedAt,
      mountOffset: data.mountOffset || undefined,
    }
  } catch {
    return null
  }
}

/**
 * Find the camera sensor point closest to GPS pipeline time t (seconds).
 * Returns index and interpolation fraction to next point.
 */
export function findCameraIndex(
  points: CameraSensorPoint[],
  pipelineTimeS: number,
): { index: number; fraction: number } {
  if (points.length === 0) return { index: 0, fraction: 0 }

  let lo = 0, hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (points[mid].pipelineTimeS <= pipelineTimeS) lo = mid
    else hi = mid - 1
  }

  if (lo >= points.length - 1) return { index: points.length - 1, fraction: 0 }

  const dt = points[lo + 1].pipelineTimeS - points[lo].pipelineTimeS
  const fraction = dt > 0 ? Math.min(1, (pipelineTimeS - points[lo].pipelineTimeS) / dt) : 0
  return { index: lo, fraction }
}
