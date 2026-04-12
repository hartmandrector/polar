/**
 * Capture Session State — Full scene configuration for Playwright automation
 * 
 * Serialized as JSON, transferred to the Playwright capture server.
 * Playwright navigates to GPS viewer with ?capture=<base64> or posts CAPTURE_INIT
 * with this state, and the viewer auto-configures everything.
 */

export interface CaptureSessionState {
  /** Schema version */
  version: 1

  /** Track file path relative to public/ (e.g. "07-29-25/TRACK.CSV") */
  trackPath: string

  /** Head sensor fused CSV path relative to public/ (null = no sensor data) */
  sensorPath: string | null

  /** Head sensor time offset (seconds) — auto-computed or manual */
  headTimeOffset: number

  /** Canopy estimator: trim offset degrees */
  trimOffset: number

  /** Roll method: 'aero' | 'coordinated' | 'full' | 'blended' */
  rollMethod: string

  /** Show data overlays */
  displayOverlays: boolean

  /** Axis helpers mode: 'none' | 'frame' | 'all' */
  axisHelpers: string

  /** Keyframe mode enabled */
  keyframeEnabled: boolean

  /** Full keyframe data (camera keyframes + capture range) */
  keyframes: {
    version: 1
    inertial: { t: number; position: [number, number, number]; zoom: number }[]
    body: { t: number; position: [number, number, number]; zoom: number }[]
    captureStart: number | null
    captureEnd: number | null
  }

  /** Capture parameters */
  capture: {
    frameRate: number
    startTime: number
    endTime: number
    totalFrames: number
    flightDate: string
  }
}
