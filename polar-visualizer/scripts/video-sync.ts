/**
 * video-sync.ts — Calculate time offset between FlySight GPS and Insta360 video
 * 
 * Usage:
 *   npx tsx scripts/video-sync.ts <flysight.csv> <gyroflow-project.gyroflow> [--camera-csv <cameradata.csv>]
 * 
 * Outputs:
 *   - Coarse offset from epoch timestamps (gyroflow project file)
 *   - Fine offset from cross-correlation of angular rates (if camera CSV provided)
 *   - Summary of how timelines overlap
 * 
 * The offset tells you: video_time_ms + offset_ms = gps_pipeline_time_ms
 */

import * as fs from 'fs'
import * as path from 'path'

// ── Types ──────────────────────────────────────────────────────────────────

interface FlySightPoint {
  /** Absolute UTC epoch in ms */
  epochMs: number
  /** ISO timestamp string */
  timeStr: string
  lat: number
  lon: number
  hMSL: number
  velN: number
  velE: number
  velD: number
}

interface CameraFrame {
  frame: number
  /** ms from video start */
  timestampMs: number
  orgPitch: number
  orgYaw: number
  orgRoll: number
  orgQuatW: number
  orgQuatX: number
  orgQuatY: number
  orgQuatZ: number
}

interface GyroflowProject {
  videoStartEpochMs: number
  videoDurationMs: number
  fps: number
  numFrames: number
  cameraModel: string
}

interface SyncResult {
  /** Add this to video timestamp (ms) to get GPS pipeline time (ms) */
  offsetMs: number
  /** Method used: 'epoch' | 'correlation' */
  method: string
  /** Confidence: 'coarse' (epoch only) | 'fine' (cross-correlated) */
  confidence: string
  /** Human-readable summary */
  summary: string
}

// ── Parsers ────────────────────────────────────────────────────────────────

function parseFlySightCSV(filepath: string): FlySightPoint[] {
  const text = fs.readFileSync(filepath, 'utf-8')
  const lines = text.trim().split('\n')
  
  // Find header line (skip comment lines starting with $)
  let headerIdx = 0
  while (headerIdx < lines.length && lines[headerIdx].startsWith('$')) headerIdx++
  if (headerIdx >= lines.length) throw new Error('No header found in FlySight CSV')
  
  const headers = lines[headerIdx].split(',').map(h => h.trim())
  const timeCol = headers.indexOf('time')
  const latCol = headers.indexOf('lat')
  const lonCol = headers.indexOf('lon')
  const hMSLCol = headers.indexOf('hMSL')
  const velNCol = headers.indexOf('velN')
  const velECol = headers.indexOf('velE')
  const velDCol = headers.indexOf('velD')
  
  if (timeCol < 0) throw new Error('No "time" column in FlySight CSV')
  
  const points: FlySightPoint[] = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    const timeStr = cols[timeCol]?.trim()
    if (!timeStr || !timeStr.includes('T')) continue
    
    const epochMs = new Date(timeStr).getTime()
    if (isNaN(epochMs)) continue
    
    points.push({
      epochMs,
      timeStr,
      lat: parseFloat(cols[latCol]) || 0,
      lon: parseFloat(cols[lonCol]) || 0,
      hMSL: parseFloat(cols[hMSLCol]) || 0,
      velN: parseFloat(cols[velNCol]) || 0,
      velE: parseFloat(cols[velECol]) || 0,
      velD: parseFloat(cols[velDCol]) || 0,
    })
  }
  return points
}

function parseGyroflowProject(filepath: string): GyroflowProject {
  const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
  const vi = data.video_info || {}
  const gs = data.gyro_source || {}
  const cal = data.calibration_data || {}
  
  return {
    videoStartEpochMs: (vi.created_at || 0) * 1000,
    videoDurationMs: vi.duration_ms || vi.vfr_duration_ms || 0,
    fps: vi.fps || vi.vfr_fps || 30,
    numFrames: vi.num_frames || 0,
    cameraModel: gs.detected_source || cal.camera_model || 'unknown',
  }
}

function parseCameraCSV(filepath: string): CameraFrame[] {
  const text = fs.readFileSync(filepath, 'utf-8')
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  
  const idx = (name: string) => headers.indexOf(name)
  const frames: CameraFrame[] = []
  
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    frames.push({
      frame: parseInt(cols[idx('frame')]) || 0,
      timestampMs: parseFloat(cols[idx('timestamp_ms')]) || 0,
      orgPitch: parseFloat(cols[idx('org_pitch')]) || 0,
      orgYaw: parseFloat(cols[idx('org_yaw')]) || 0,
      orgRoll: parseFloat(cols[idx('org_roll')]) || 0,
      orgQuatW: parseFloat(cols[idx('org_quat_w')]) || 0,
      orgQuatX: parseFloat(cols[idx('org_quat_x')]) || 0,
      orgQuatY: parseFloat(cols[idx('org_quat_y')]) || 0,
      orgQuatZ: parseFloat(cols[idx('org_quat_z')]) || 0,
    })
  }
  return frames
}

// ── Angular rate from quaternions ──────────────────────────────────────────

/** Compute angular rate magnitude (deg/s) between consecutive quaternion frames */
function quatAngularRates(frames: CameraFrame[]): { tMs: number; rateDeg: number }[] {
  const rates: { tMs: number; rateDeg: number }[] = []
  for (let i = 1; i < frames.length; i++) {
    const dt = (frames[i].timestampMs - frames[i - 1].timestampMs) / 1000 // seconds
    if (dt <= 0) continue
    
    // Relative quaternion: q_rel = q_prev^-1 * q_curr
    const a = frames[i - 1], b = frames[i]
    // Conjugate of a (unit quat inverse)
    const aw = a.orgQuatW, ax = -a.orgQuatX, ay = -a.orgQuatY, az = -a.orgQuatZ
    // Hamilton product: conj(a) * b
    const rw = aw * b.orgQuatW - ax * b.orgQuatX - ay * b.orgQuatY - az * b.orgQuatZ
    const rx = aw * b.orgQuatX + ax * b.orgQuatW + ay * b.orgQuatZ - az * b.orgQuatY
    const ry = aw * b.orgQuatY - ax * b.orgQuatZ + ay * b.orgQuatW + az * b.orgQuatX
    const rz = aw * b.orgQuatZ + ax * b.orgQuatY - ay * b.orgQuatX + az * b.orgQuatW
    
    // Angle from relative quaternion
    const sinHalf = Math.sqrt(rx * rx + ry * ry + rz * rz)
    const angle = 2 * Math.atan2(sinHalf, Math.abs(rw)) // radians
    const rateDeg = (angle * 180 / Math.PI) / dt
    
    rates.push({
      tMs: (frames[i].timestampMs + frames[i - 1].timestampMs) / 2,
      rateDeg,
    })
  }
  return rates
}

/** Compute GPS angular rate magnitude from velocity-derived body rates */
function gpsAngularRates(points: FlySightPoint[]): { epochMs: number; rateDeg: number }[] {
  const R2D = 180 / Math.PI
  const rates: { epochMs: number; rateDeg: number }[] = []
  
  for (let i = 1; i < points.length; i++) {
    const dt = (points[i].epochMs - points[i - 1].epochMs) / 1000
    if (dt <= 0) continue
    
    const a = points[i - 1], b = points[i]
    
    // Heading change rate (yaw rate proxy)
    const hdgA = Math.atan2(a.velE, a.velN)
    const hdgB = Math.atan2(b.velE, b.velN)
    let dHdg = hdgB - hdgA
    while (dHdg > Math.PI) dHdg -= 2 * Math.PI
    while (dHdg < -Math.PI) dHdg += 2 * Math.PI
    const yawRate = Math.abs(dHdg / dt) * R2D
    
    // Flight path angle change rate (pitch rate proxy)
    const speedA = Math.sqrt(a.velN ** 2 + a.velE ** 2 + a.velD ** 2)
    const speedB = Math.sqrt(b.velN ** 2 + b.velE ** 2 + b.velD ** 2)
    const gammaA = speedA > 0.5 ? Math.asin(-a.velD / speedA) : 0
    const gammaB = speedB > 0.5 ? Math.asin(-b.velD / speedB) : 0
    const pitchRate = Math.abs((gammaB - gammaA) / dt) * R2D
    
    // Combined magnitude
    const rateDeg = Math.sqrt(yawRate ** 2 + pitchRate ** 2)
    
    rates.push({
      epochMs: (a.epochMs + b.epochMs) / 2,
      rateDeg,
    })
  }
  return rates
}

// ── Cross-correlation ──────────────────────────────────────────────────────

/**
 * Cross-correlate camera and GPS angular rate signals.
 * Returns the lag (in ms) that maximizes correlation.
 * GPS rates are at GPS timestamps; camera rates are relative.
 * The coarse offset maps camera time → GPS epoch time.
 * We search ±searchMs around the coarse offset for the best fine alignment.
 */
function crossCorrelate(
  cameraRates: { tMs: number; rateDeg: number }[],
  gpsRates: { epochMs: number; rateDeg: number }[],
  coarseOffsetMs: number,
  searchMs: number = 5000,
  stepMs: number = 50,
): { bestOffsetMs: number; correlation: number } {
  // Resample both signals to uniform grid
  const resampleMs = 100 // 10 Hz
  
  // Find overlap region
  const camStart = cameraRates[0].tMs
  const camEnd = cameraRates[cameraRates.length - 1].tMs
  const gpsStart = gpsRates[0].epochMs
  const gpsEnd = gpsRates[gpsRates.length - 1].epochMs
  
  let bestCorr = -Infinity
  let bestOffset = coarseOffsetMs
  
  for (let lag = coarseOffsetMs - searchMs; lag <= coarseOffsetMs + searchMs; lag += stepMs) {
    // At this lag: camera_time + lag = gps_epoch_time
    // Overlap: max(camStart + lag, gpsStart) to min(camEnd + lag, gpsEnd)
    const overlapStart = Math.max(camStart + lag, gpsStart)
    const overlapEnd = Math.min(camEnd + lag, gpsEnd)
    
    if (overlapEnd - overlapStart < 5000) continue // need at least 5s overlap
    
    let sumXY = 0, sumX2 = 0, sumY2 = 0, n = 0
    
    for (let t = overlapStart; t <= overlapEnd; t += resampleMs) {
      // Camera value at t - lag (camera time)
      const camT = t - lag
      const camVal = interpolateRate(cameraRates, camT, r => r.tMs)
      // GPS value at t (epoch time)
      const gpsVal = interpolateRate(gpsRates, t, r => r.epochMs)
      
      if (camVal !== null && gpsVal !== null) {
        sumXY += camVal * gpsVal
        sumX2 += camVal * camVal
        sumY2 += gpsVal * gpsVal
        n++
      }
    }
    
    if (n > 10 && sumX2 > 0 && sumY2 > 0) {
      const corr = sumXY / Math.sqrt(sumX2 * sumY2)
      if (corr > bestCorr) {
        bestCorr = corr
        bestOffset = lag
      }
    }
  }
  
  return { bestOffsetMs: bestOffset, correlation: bestCorr }
}

function interpolateRate(
  rates: { rateDeg: number }[],
  t: number,
  getT: (r: any) => number,
): number | null {
  // Binary search for nearest
  let lo = 0, hi = rates.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (getT(rates[mid]) <= t) lo = mid
    else hi = mid
  }
  
  const tLo = getT(rates[lo])
  const tHi = getT(rates[hi])
  if (Math.abs(tLo - t) > 500 && Math.abs(tHi - t) > 500) return null
  
  // Linear interpolate
  const frac = tHi !== tLo ? (t - tLo) / (tHi - tLo) : 0
  return rates[lo].rateDeg + frac * (rates[hi].rateDeg - rates[lo].rateDeg)
}

// ── Main ───────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const s = Math.abs(ms / 1000)
  const min = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1)
  const sign = ms < 0 ? '-' : '+'
  return `${sign}${min}:${sec.padStart(4, '0')}`
}

function main() {
  const args = process.argv.slice(2)
  
  if (args.length < 2) {
    console.log(`
video-sync — Calculate time offset between FlySight GPS and Insta360 video

Usage:
  npx tsx scripts/video-sync.ts <flysight.csv> <gyroflow.gyroflow> [--camera-csv <cameradata.csv>]

The gyroflow project file provides the video start epoch for coarse sync.
The camera CSV (optional) provides per-frame quaternions for fine cross-correlation.

Output: offset in ms such that video_time + offset = gps_pipeline_time
`)
    process.exit(1)
  }
  
  const flysightPath = args[0]
  const gyroflowPath = args[1]
  let cameraCsvPath: string | null = null
  
  const cameraIdx = args.indexOf('--camera-csv')
  if (cameraIdx >= 0 && args[cameraIdx + 1]) {
    cameraCsvPath = args[cameraIdx + 1]
  }
  
  // ── Parse inputs ──
  console.log('Parsing FlySight GPS...')
  const gpsPoints = parseFlySightCSV(flysightPath)
  console.log(`  ${gpsPoints.length} points, ${gpsPoints[0]?.timeStr} → ${gpsPoints[gpsPoints.length - 1]?.timeStr}`)
  
  console.log('Parsing Gyroflow project...')
  const project = parseGyroflowProject(gyroflowPath)
  console.log(`  Camera: ${project.cameraModel}`)
  console.log(`  Frames: ${project.numFrames} @ ${project.fps} fps`)
  console.log(`  Duration: ${(project.videoDurationMs / 1000).toFixed(1)}s`)
  console.log(`  Video start epoch: ${project.videoStartEpochMs} (${new Date(project.videoStartEpochMs).toISOString()})`)
  
  // ── Coarse sync via epoch ──
  const gpsStartEpoch = gpsPoints[0].epochMs
  const gpsEndEpoch = gpsPoints[gpsPoints.length - 1].epochMs
  const gpsDuration = (gpsEndEpoch - gpsStartEpoch) / 1000
  
  // GPS pipeline time starts at t=0 for the first GPS point.
  // video_time + offset = gps_pipeline_time
  // video_time + offset = (video_epoch + video_time) - gps_start_epoch ... no.
  // 
  // GPS pipeline: t = 0 at first GPS point, so pipeline_t = epochMs - gpsStartEpoch
  // Video: video_t = 0 at video start, epoch = videoStartEpochMs + video_t
  // 
  // To convert video_t → pipeline_t:
  //   video_epoch = videoStartEpochMs + video_t
  //   pipeline_t = video_epoch - gpsStartEpoch
  //   pipeline_t = videoStartEpochMs + video_t - gpsStartEpoch
  //   pipeline_t = video_t + (videoStartEpochMs - gpsStartEpoch)
  //
  // So offset = videoStartEpochMs - gpsStartEpoch
  
  const coarseOffsetMs = project.videoStartEpochMs - gpsStartEpoch
  
  console.log('\n── Coarse Sync (epoch timestamps) ──')
  console.log(`  Video starts ${(coarseOffsetMs / 1000).toFixed(1)}s relative to GPS start`)
  console.log(`  GPS pipeline t=0 maps to video t=${(-coarseOffsetMs / 1000).toFixed(1)}s`)
  
  // Timeline overlap
  const overlapStart = Math.max(0, -coarseOffsetMs) // in video time
  const overlapEnd = Math.min(project.videoDurationMs, gpsEndEpoch - project.videoStartEpochMs)
  const overlapDuration = (overlapEnd - overlapStart) / 1000
  
  console.log(`  Overlap: ${overlapDuration.toFixed(1)}s`)
  console.log(`  Video t=${(overlapStart / 1000).toFixed(1)}s → t=${(overlapEnd / 1000).toFixed(1)}s`)
  
  let result: SyncResult = {
    offsetMs: coarseOffsetMs,
    method: 'epoch',
    confidence: 'coarse',
    summary: '',
  }
  
  // ── Fine sync via cross-correlation ──
  if (cameraCsvPath) {
    console.log(`\nParsing camera CSV: ${cameraCsvPath}`)
    const cameraFrames = parseCameraCSV(cameraCsvPath)
    console.log(`  ${cameraFrames.length} frames`)
    
    console.log('Computing angular rates...')
    const cameraRates = quatAngularRates(cameraFrames)
    const gpsRates = gpsAngularRates(gpsPoints)
    console.log(`  Camera: ${cameraRates.length} rate samples`)
    console.log(`  GPS: ${gpsRates.length} rate samples`)
    
    // For cross-correlation, camera times are relative (video_t in ms).
    // GPS rates have epochMs. We need: camera_t + offset = gps_epochMs
    // coarse offset for this: videoStartEpochMs (so camera_t + videoStartEpochMs ≈ gps_epochMs)
    const epochCoarse = project.videoStartEpochMs
    
    console.log('Cross-correlating (±5s search around coarse offset)...')
    const { bestOffsetMs, correlation } = crossCorrelate(
      cameraRates, gpsRates, epochCoarse, 5000, 20
    )
    
    const fineCorrection = bestOffsetMs - epochCoarse
    console.log(`  Best epoch offset: ${bestOffsetMs} ms`)
    console.log(`  Fine correction: ${fineCorrection > 0 ? '+' : ''}${fineCorrection} ms`)
    console.log(`  Correlation: ${correlation.toFixed(4)}`)
    
    // Convert to pipeline time offset
    const fineOffsetMs = bestOffsetMs - gpsStartEpoch
    
    if (correlation > 0.3) {
      result = {
        offsetMs: fineOffsetMs,
        method: 'correlation',
        confidence: 'fine',
        summary: `Fine sync: r=${correlation.toFixed(3)}, correction=${fineCorrection}ms from epoch`,
      }
    } else {
      console.log('  ⚠ Low correlation — falling back to coarse epoch sync')
    }
  }
  
  // ── Output ──
  console.log('\n══════════════════════════════════════')
  console.log('  SYNC RESULT')
  console.log('══════════════════════════════════════')
  console.log(`  Method: ${result.method} (${result.confidence})`)
  console.log(`  Offset: ${result.offsetMs.toFixed(0)} ms (${formatTime(result.offsetMs)})`)
  console.log(``)
  console.log(`  video_time + ${result.offsetMs.toFixed(0)} = gps_pipeline_time`)
  console.log(``)
  console.log(`  Example: video frame at t=60s → pipeline t=${((60000 + result.offsetMs) / 1000).toFixed(1)}s`)
  if (result.summary) console.log(`  ${result.summary}`)
  console.log('══════════════════════════════════════')
  
  // Write sync result as JSON
  const outPath = path.join(path.dirname(gyroflowPath), 'sync-result.json')
  const syncData = {
    flysight: path.basename(flysightPath),
    video: path.basename(gyroflowPath),
    offsetMs: result.offsetMs,
    method: result.method,
    confidence: result.confidence,
    videoStartEpochMs: project.videoStartEpochMs,
    gpsStartEpochMs: gpsStartEpoch,
    overlapDurationS: overlapDuration,
    generatedAt: new Date().toISOString(),
  }
  fs.writeFileSync(outPath, JSON.stringify(syncData, null, 2))
  console.log(`\nSync result written to: ${outPath}`)
}

main()
