/**
 * GPS Viewer — PNG Capture Handler
 * 
 * Listens for postMessage commands from playwright-capture to render
 * individual frames at exact timestamps with full output interpolation.
 * 
 * Protocol:
 *   CAPTURE_INIT  → CAPTURE_READY   (negotiate frame range)
 *   REQUEST_FRAME → FRAME_READY     (render + signal)
 *   CAPTURE_ABORT                    (cancel)
 */

import type { GPSPipelinePoint } from '../gps/types'
import type { CaptureSessionState } from './capture-session'

export interface CaptureCallbacks {
  /** Render frame at time t with interpolation fraction between indices */
  renderFrame: (index: number, fraction: number) => void
  /** Get flight time boundaries from flight computer modes */
  getFlightBounds: () => { startTime: number; endTime: number }
}

export class CaptureHandler {
  private points: GPSPipelinePoint[] = []
  private frameRate = 60
  private startTime = 0
  private endTime = 0
  private totalFrames = 0
  private active = false
  private statusEl: HTMLElement | null = null
  private frameCountEl: HTMLElement | null = null
  private flightDate: string = ''

  constructor(private callbacks: CaptureCallbacks) {
    window.addEventListener('message', this.onMessage)
  }

  setData(points: GPSPipelinePoint[], flightDate?: string) {
    this.points = points
    if (flightDate) this.flightDate = flightDate
    ;(window as any).__dataLoaded = true
  }

  bindUI(statusEl: HTMLElement, frameCountEl: HTMLElement) {
    this.statusEl = statusEl
    this.frameCountEl = frameCountEl
  }

  private onMessage = (e: MessageEvent) => {
    const d = e.data
    if (!d || typeof d.type !== 'string') return

    switch (d.type) {
      case 'CAPTURE_INIT':
        this.handleInit(d)
        break
      case 'REQUEST_FRAME':
        this.handleFrame(d.frame)
        break
      case 'CAPTURE_ABORT':
        this.active = false
        this.updateStatus('Aborted')
        break
    }
  }

  private handleInit(d: any) {
    this.frameRate = d.frameRate || 60

    // Use provided times or auto-detect from flight computer
    const bounds = this.callbacks.getFlightBounds()
    this.startTime = d.startTime ?? bounds.startTime
    this.endTime = d.endTime ?? bounds.endTime
    this.totalFrames = Math.ceil((this.endTime - this.startTime) * this.frameRate)
    this.active = true

    this.updateStatus('Ready')
    this.updateFrameCount(0)

    window.postMessage({
      type: 'CAPTURE_READY',
      totalFrames: this.totalFrames,
      startTime: this.startTime,
      endTime: this.endTime,
      frameRate: this.frameRate,
    }, '*')

    // Also set on window for playwright waitForFunction
    ;(window as any).__captureReady = {
      totalFrames: this.totalFrames,
      startTime: this.startTime,
      endTime: this.endTime,
    }
  }

  private handleFrame(frame: number) {
    if (!this.active || this.points.length === 0) return

    const t = this.startTime + frame / this.frameRate
    const { index, fraction } = this.findIndexFraction(t)

    // Render the interpolated frame
    this.callbacks.renderFrame(index, fraction)

    // Signal frame is ready
    ;(window as any).__lastRenderedFrame = frame
    window.postMessage({ type: 'FRAME_READY', frame }, '*')

    this.updateStatus('Capturing')
    this.updateFrameCount(frame)
  }

  /**
   * Find the bracketing index and interpolation fraction for time t.
   * Returns { index, fraction } where fraction ∈ [0, 1) between index and index+1.
   */
  private findIndexFraction(t: number): { index: number; fraction: number } {
    const pts = this.points
    if (pts.length === 0) return { index: 0, fraction: 0 }

    // Binary search for the last point with t <= target
    let lo = 0, hi = pts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (pts[mid].processed.t <= t) lo = mid
      else hi = mid - 1
    }

    const index = lo
    if (index >= pts.length - 1) return { index: pts.length - 1, fraction: 0 }

    const t0 = pts[index].processed.t
    const t1 = pts[index + 1].processed.t
    const dt = t1 - t0
    const fraction = dt > 0 ? Math.min(1, Math.max(0, (t - t0) / dt)) : 0

    return { index, fraction }
  }

  /**
   * Build a complete URL with all session state as query params.
   * Playwright navigates to this URL to replicate the exact scene.
   */
  private buildCaptureUrl(session: CaptureSessionState | null): string {
    const base = new URL('/gps.html', window.location.origin)
    if (!session) {
      // Fallback: just pass current URL
      return window.location.href
    }

    if (session.trackPath) base.searchParams.set('track', session.trackPath)
    if (session.sensorPath) base.searchParams.set('sensor', session.sensorPath)
    base.searchParams.set('trim', String(session.trimOffset))
    base.searchParams.set('roll', session.rollMethod)
    base.searchParams.set('overlays', session.displayOverlays ? '1' : '0')
    base.searchParams.set('axis', session.axisHelpers)
    base.searchParams.set('kf', session.keyframeEnabled ? '1' : '0')

    // Keyframes as base64 JSON
    if (session.keyframes) {
      const kfJson = JSON.stringify(session.keyframes)
      base.searchParams.set('keyframes', btoa(kfJson))
    }

    return base.toString()
  }

  /** Trigger capture externally (from UI button) */
  startCapture() {
    if (this.points.length === 0) {
      this.updateStatus('No data loaded')
      return
    }

    const bounds = this.callbacks.getFlightBounds()
    this.startTime = bounds.startTime
    this.endTime = bounds.endTime
    this.frameRate = 60
    this.totalFrames = Math.ceil((this.endTime - this.startTime) * this.frameRate)
    this.active = true

    this.updateStatus('Waiting for playwright...')
    this.updateFrameCount(0)

    // Build flight metadata for folder naming
    const dateStr = this.flightDate || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

    // POST to playwright-capture server to start the capture
    // Include full session state so Playwright can auto-configure a fresh instance
    const sessionState = (window as any).__getCaptureSession?.()
    if (sessionState) {
      sessionState.capture = {
        frameRate: this.frameRate,
        startTime: this.startTime,
        endTime: this.endTime,
        totalFrames: this.totalFrames,
        flightDate: dateStr,
      }
    }

    // Build complete capture URL with all current state as params
    const captureUrl = this.buildCaptureUrl(sessionState)

    fetch('http://localhost:3333/capture-polar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalFrames: this.totalFrames,
        frameRate: this.frameRate,
        startTime: this.startTime,
        endTime: this.endTime,
        flightDate: dateStr,
        url: captureUrl,
        session: sessionState ?? null,
      }),
    }).then(r => {
      if (!r.ok) this.updateStatus('Server error')
    }).catch(() => {
      this.updateStatus('Cannot reach capture server (port 3333)')
    })
  }

  private updateStatus(text: string) {
    if (this.statusEl) this.statusEl.textContent = text
  }

  private updateFrameCount(frame: number) {
    if (this.frameCountEl) {
      this.frameCountEl.textContent = `${frame} / ${this.totalFrames}`
    }
  }

  dispose() {
    window.removeEventListener('message', this.onMessage)
  }
}
