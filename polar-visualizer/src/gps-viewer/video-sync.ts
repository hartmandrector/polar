/**
 * VideoSync — owns the optional `<video id="bg-video">` element shown behind
 * the GPS viewer's dual-scene container.
 *
 * The video is intentionally inert (no src, display:none) until loadFile() is
 * called. Playwright capture sessions never load a video, so the scene
 * backgrounds stay transparent for PNG export.
 *
 * Sync model:
 *   video.currentTime = replay.playbackTime + offset
 *
 * During play at 1×, the video plays freely and we re-seek only on drift
 * (>0.1s). At other speeds we set `playbackRate` and re-seek every tick.
 * During pause / scrub we seek directly each update.
 */

const FRAME_DT = 1 / 30 // GoPro LRV default; used for nudge buttons
const DRIFT_THRESHOLD_S = 0.1

export class VideoSync {
  private video: HTMLVideoElement
  private currentURL: string | null = null
  private offsetS = 0
  private wantVisible = true
  private rotationDeg = 0
  private flipH = false
  private opacity = 1
  private loaded = false

  constructor(video: HTMLVideoElement) {
    this.video = video
    // Defensive: ensure no src attribute and element is hidden until loadFile.
    this.video.removeAttribute('src')
    this.video.style.display = 'none'
    this.video.muted = true
  }

  hasVideo(): boolean { return this.loaded }
  get frameDt(): number { return FRAME_DT }
  get offset(): number { return this.offsetS }

  loadFile(file: File): void {
    this.unload()
    // Force MIME so .lrv (GoPro) plays in browsers that gate by extension.
    const blob = new Blob([file], { type: 'video/mp4' })
    this.currentURL = URL.createObjectURL(blob)
    this.video.src = this.currentURL
    this.video.load()
    this.loaded = true
    this.applyTransform()
    this.applyVisibility()
  }

  unload(): void {
    if (this.currentURL) {
      try { URL.revokeObjectURL(this.currentURL) } catch {}
      this.currentURL = null
    }
    try { this.video.pause() } catch {}
    this.video.removeAttribute('src')
    this.video.load() // detach
    this.video.style.display = 'none'
    this.loaded = false
  }

  setOffset(s: number): void { this.offsetS = s }
  setVisible(v: boolean): void { this.wantVisible = v; this.applyVisibility() }
  setRotation(deg: number): void { this.rotationDeg = deg; this.applyTransform() }
  setFlipH(b: boolean): void { this.flipH = b; this.applyTransform() }
  setOpacity(o: number): void {
    this.opacity = Math.max(0, Math.min(1, o))
    this.video.style.opacity = String(this.opacity)
  }

  /**
   * Per-tick sync. Called from the replay callback with the current playback
   * time, the playing flag, and the playback speed multiplier.
   */
  update(playbackTime: number, playing: boolean, speed: number): void {
    if (!this.loaded) return
    const target = playbackTime + this.offsetS
    if (!Number.isFinite(target)) return

    // Clamp into [0, duration] when known.
    const dur = this.video.duration
    const clamped = Number.isFinite(dur) && dur > 0
      ? Math.max(0, Math.min(dur, target))
      : Math.max(0, target)

    if (playing) {
      // Mirror playbackRate (HTMLMediaElement supports ~0.0625..16).
      const rate = Math.max(0.0625, Math.min(16, speed))
      if (Math.abs(this.video.playbackRate - rate) > 1e-3) {
        this.video.playbackRate = rate
      }
      if (speed === 1) {
        // Free-running; correct on drift only.
        const drift = this.video.currentTime - clamped
        if (Math.abs(drift) > DRIFT_THRESHOLD_S) this.video.currentTime = clamped
        if (this.video.paused) { this.video.play().catch(() => {}) }
      } else {
        // Non-1x speeds — keep the video paused/seeked deterministically each
        // tick rather than fighting the browser's decoder.
        if (!this.video.paused) { this.video.pause() }
        if (Math.abs(this.video.currentTime - clamped) > 1e-3) {
          this.video.currentTime = clamped
        }
      }
    } else {
      if (!this.video.paused) { this.video.pause() }
      if (Math.abs(this.video.currentTime - clamped) > 1e-3) {
        this.video.currentTime = clamped
      }
    }
  }

  private applyVisibility(): void {
    this.video.style.display = this.loaded && this.wantVisible ? 'block' : 'none'
  }

  private applyTransform(): void {
    const sx = this.flipH ? -1 : 1
    this.video.style.transform = `rotate(${this.rotationDeg}deg) scaleX(${sx})`
  }
}
