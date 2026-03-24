/**
 * GPS Flight Viewer — Replay Controller
 * 
 * Plays through GPS pipeline data in real time (or scaled).
 * Calls back on each frame with current index and time.
 */

import type { GPSPipelinePoint } from '../gps/types'

export type ReplayCallback = (index: number, time: number, fraction: number) => void

export class GPSReplay {
  private data: GPSPipelinePoint[]
  private callback: ReplayCallback
  private _playing = false
  private _speed = 1
  private currentIndex = 0
  private lastFrameTime = 0
  private playbackTime = 0
  private rafId = 0

  constructor(data: GPSPipelinePoint[], callback: ReplayCallback) {
    this.data = data
    this.callback = callback
  }

  get playing() { return this._playing }
  get speed() { return this._speed }
  set speed(v: number) { this._speed = v }

  setData(data: GPSPipelinePoint[]) {
    this.data = data
    this.currentIndex = 0
    this.playbackTime = 0
    this._playing = false
  }

  play() {
    if (this.data.length === 0) return
    this._playing = true
    this.lastFrameTime = performance.now()

    // If at end, restart
    if (this.currentIndex >= this.data.length - 1) {
      this.currentIndex = 0
      this.playbackTime = 0
    }

    this.tick()
  }

  pause() {
    this._playing = false
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = 0
  }

  stop() {
    this.pause()
    this.currentIndex = 0
    this.playbackTime = 0
  }

  seekIndex(idx: number) {
    this.currentIndex = Math.max(0, Math.min(idx, this.data.length - 1))
    this.playbackTime = this.data[this.currentIndex]?.processed.t ?? 0
  }

  private tick = () => {
    if (!this._playing) return

    const now = performance.now()
    const wallDt = (now - this.lastFrameTime) / 1000
    this.lastFrameTime = now

    // Advance playback time
    this.playbackTime += wallDt * this._speed

    // Find the data index for current playback time
    while (
      this.currentIndex < this.data.length - 1 &&
      this.data[this.currentIndex + 1].processed.t <= this.playbackTime
    ) {
      this.currentIndex++
    }

    // Compute interpolation fraction between currentIndex and next sample
    let fraction = 0
    if (this.currentIndex < this.data.length - 1) {
      const t0 = this.data[this.currentIndex].processed.t
      const t1 = this.data[this.currentIndex + 1].processed.t
      const dt = t1 - t0
      if (dt > 1e-6) {
        fraction = Math.max(0, Math.min(1, (this.playbackTime - t0) / dt))
      }
    }

    // Callback
    this.callback(this.currentIndex, this.playbackTime, fraction)

    // Stop at end
    if (this.currentIndex >= this.data.length - 1) {
      this._playing = false
      // Fire one last callback at the end position
      this.callback(this.currentIndex, this.data[this.currentIndex].processed.t, 0)
      return
    }

    this.rafId = requestAnimationFrame(this.tick)
  }
}
