/**
 * GPS Flight Viewer — Chart.js Charts
 * 
 * Four chart panels with dropdown view selection.
 * Cursor tracks current playback position.
 */

import {
  Chart,
  ScatterController,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import type { GPSPipelinePoint } from '../gps/types'
import type { ContinuousPolar, AeroSegment, SegmentControls } from '../polar/continuous-polar'
import { defaultControls } from '../polar/aero-segment'
import { sweepSegments, aoaToColor, type PolarPoint, type SweepConfig } from '../ui/chart-data'

Chart.register(ScatterController, LineController, LineElement, PointElement, LinearScale, Title, Tooltip, Legend)

const R2D = 180 / Math.PI

// ─── Chart View Types ───────────────────────────────────────────────────────

type Chart1View = 'polar' | 'speed' | 'ld'
type Chart2View = 'altitude' | 'airspeed' | 'aoa' | 'gamma' | 'theta' | 'psi' | 'klkd' | 'clcd' | 'roll' | 'mode' | 'bodyrates' | 'eulerrates' | 'angaccel' | 'controls'
type Chart3View = 'position' | 'profile'

// ─── Color Constants ────────────────────────────────────────────────────────

const COL_TRACE  = 'rgba(100, 180, 255, 0.6)'
const COL_TRACE2 = 'rgba(255, 140, 80, 0.6)'
const COL_TRACE3 = 'rgba(120, 220, 120, 0.6)'
const COL_CURSOR = 'rgba(233, 69, 96, 1.0)'
const COL_DYNAMIC = 'rgba(80, 255, 180, 0.9)'   // dynamic speed point (green)
const COL_POLAR_CURSOR = 'rgba(255, 255, 100, 0.9)' // solved polar cursor (yellow)
const COL_GRID   = 'rgba(60, 60, 100, 0.3)'
const COL_TICK   = 'rgba(140, 140, 180, 0.6)'

/** Glide ratio line colors */
const GLIDE_COLORS = ['rgba(80, 160, 255, 0.25)', 'rgba(80, 220, 130, 0.25)', 'rgba(220, 220, 80, 0.25)']
const GLIDE_RATIOS = [1, 2, 3]

/** Trail duration in seconds */
const TRAIL_SECONDS = 8

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: {
    x: { grid: { color: COL_GRID }, ticks: { color: COL_TICK, font: { size: 10 } } },
    y: { grid: { color: COL_GRID }, ticks: { color: COL_TICK, font: { size: 10 } } },
  },
}

// ─── GPSCharts Class ────────────────────────────────────────────────────────

export class GPSCharts {
  private data: GPSPipelinePoint[] = []
  private cursorIdx = 0

  private chart1: Chart | null = null
  private chart2: Chart | null = null
  private chart3: Chart | null = null

  // ─── Vehicle polar for swept curve ────────────────────────────────────
  private polarSegments: AeroSegment[] | null = null
  private polar: ContinuousPolar | null = null
  private massReference = 1.875
  private canopyPolarSegments: AeroSegment[] | null = null
  private canopyPolar: ContinuousPolar | null = null
  private canopyMassReference = 1.875
  private solvedControls: SegmentControls = defaultControls()
  private lastSweep: PolarPoint[] = []
  /** True when chart is showing canopy polar (for label/color hints) */
  private sweepIsCanopy = false

  /** Sweep config — 1° steps, flight-relevant range (α ≥ 0 keeps sustained speeds positive) */
  private static readonly SWEEP_CFG: Partial<SweepConfig> = {
    minAlpha: 0,
    maxAlpha: 45,
    step: 1,
  }

  private chart1View: Chart1View = 'polar'
  private chart2View: Chart2View = 'altitude'
  private chart3View: Chart3View = 'position'

  // ─── X-axis zoom state for chart2 (time series) ────────────────────────

  /** Current visible x-range [min, max] in seconds. null = auto (full range) */
  private chart2XRange: [number, number] | null = null

  /** Index of the first main (non-raw) dataset in chart2 */
  private chart2MainIdx = 0

  constructor() {
    // Wire dropdown selects
    const s1 = document.getElementById('chart1-select') as HTMLSelectElement
    const s2 = document.getElementById('chart2-select') as HTMLSelectElement
    const s3 = document.getElementById('chart3-select') as HTMLSelectElement

    s1.addEventListener('change', () => { this.chart1View = s1.value as Chart1View; this.rebuildChart1() })
    s2.addEventListener('change', () => { this.chart2View = s2.value as Chart2View; this.rebuildChart2() })
    s3.addEventListener('change', () => { this.chart3View = s3.value as Chart3View; this.rebuildChart3() })
  }

  setData(points: GPSPipelinePoint[]) {
    this.data = points
    this.cursorIdx = 0
    this.rebuildAll()
  }

  setCursor(index: number) {
    this.cursorIdx = Math.max(0, Math.min(index, this.data.length - 1))
    this.updateCursors()
  }

  /** Force chart1 rebuild (call after setCursor when solver is not active) */
  refreshChart1() {
    this.rebuildChart1()
  }

  /** Set the vehicle polar model for swept curve rendering */
  setPolar(segments: AeroSegment[], polar: ContinuousPolar, massReference: number) {
    this.polarSegments = segments
    this.polar = polar
    this.massReference = massReference
    // Run initial sweep with default controls
    this.runSweep(defaultControls())
    this.rebuildChart1()
  }

  /** Set the canopy polar model for swept curve during canopy phases */
  setCanopyPolar(segments: AeroSegment[], polar: ContinuousPolar, massReference: number) {
    this.canopyPolarSegments = segments
    this.canopyPolar = polar
    this.canopyMassReference = massReference
  }

  /** Update the swept polar curve with new solved controls + current flight state */
  setSolvedControls(controls: SegmentControls, pointIndex?: number) {
    this.solvedControls = controls
    const pt = pointIndex != null ? this.data[pointIndex] : this.data[this.cursorIdx]
    const rho = pt?.processed?.rho ?? 1.095
    const airspeed = pt?.processed?.airspeed ?? 45
    const mode = pt?.flightMode?.mode ?? 0
    const isCanopy = mode >= 5 && mode <= 7
    this.sweepIsCanopy = isCanopy

    // Pick active polar based on flight phase
    const segs = isCanopy ? this.canopyPolarSegments : this.polarSegments
    const pol = isCanopy ? this.canopyPolar : this.polar
    const mRef = isCanopy ? this.canopyMassReference : this.massReference

    if (!segs || !pol) { this.lastSweep = []; this.rebuildChart1(); return }
    this.lastSweep = sweepSegments(segs, pol, mRef, controls, {
      ...GPSCharts.SWEEP_CFG,
      rho, airspeed,
    })
    this.rebuildChart1()
  }

  /** Run the segment sweep and cache results (wingsuit polar) */
  private runSweep(controls: SegmentControls, overrides?: Partial<SweepConfig>) {
    if (!this.polarSegments || !this.polar) { this.lastSweep = []; return }
    this.lastSweep = sweepSegments(
      this.polarSegments, this.polar, this.massReference,
      controls, { ...GPSCharts.SWEEP_CFG, ...overrides }
    )
  }

  /** Build swept polar dataset for chart1 (polar or speed view) */
  private sweptDataset(): any | null {
    if (this.lastSweep.length === 0) return null
    const view = this.chart1View
    if (view !== 'polar' && view !== 'speed') return null

    const data = this.lastSweep.map(p =>
      view === 'polar'
        ? { x: p.cd, y: p.cl }
        : { x: p.vxs, y: p.vys }
    )
    const colors = this.lastSweep.map(p => p.color)

    return {
      data,
      borderColor: colors,
      backgroundColor: colors,
      pointBackgroundColor: colors,
      pointRadius: 0,
      showLine: true,
      borderWidth: 2.5,
      order: 1,
      segment: {
        borderColor: (ctx: any) => colors[ctx.p0DataIndex] || '#888',
      },
    }
  }

  // ─── Build helpers ──────────────────────────────────────────────────────

  private rebuildAll() {
    this.rebuildChart1()
    this.rebuildChart2()
    this.rebuildChart3()
  }

  private rebuildChart1() {
    if (this.chart1) this.chart1.destroy()
    const canvas = document.getElementById('chart1') as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    const pts = this.data
    const view = this.chart1View

    let xLabel: string, yLabel: string

    switch (view) {
      case 'polar': xLabel = 'CD'; yLabel = 'CL'; break
      case 'speed': xLabel = 'Vxs'; yLabel = 'Vys'; break
      case 'ld':    xLabel = 'Airspeed (mph)'; yLabel = 'L/D'; break
      default:      xLabel = ''; yLabel = ''
    }

    const datasets: any[] = []

    // ── Glide ratio lines (speed polar and CL/CD polar) ──
    if (view === 'speed' || view === 'polar') {
      for (let g = 0; g < GLIDE_RATIOS.length; g++) {
        const ratio = GLIDE_RATIOS[g]
        const lineData: { x: number; y: number }[] = []
        if (view === 'speed') {
          // Line from origin: Vys = Vxs / ratio → slope 1/ratio through origin
          lineData.push({ x: 0, y: 0 }, { x: 80, y: 80 / ratio })
        } else {
          // CL/CD polar: CL = CD * ratio
          lineData.push({ x: 0, y: 0 }, { x: 2, y: 2 * ratio })
        }
        datasets.push({
          data: lineData,
          borderColor: GLIDE_COLORS[g],
          backgroundColor: 'transparent',
          pointRadius: 0,
          showLine: true,
          borderWidth: 1,
          borderDash: [4, 4],
          order: 3,
        })
      }
    }

    // ── Swept vehicle polar (AOA-colored line) ──
    const swept = this.sweptDataset()
    if (swept) datasets.push(swept)

    // ── Flight trace (trailing 8 seconds) ──
    const trailData = this.buildTrailData(view)
    datasets.push({
      data: trailData,
      borderColor: COL_TRACE,
      backgroundColor: COL_TRACE,
      pointRadius: 1.5,
      showLine: false,
      order: 0,
    })

    // ── Dynamic speed trail + point (actual Vx, Vy) — speed view only ──
    if (view === 'speed') {
      // 8-second trail for dynamic speeds (dark purple)
      const dynTrail = this.buildDynamicTrail()
      if (dynTrail.length > 0) {
        datasets.push({
          data: dynTrail,
          borderColor: 'rgba(140, 80, 220, 0.5)',
          backgroundColor: 'rgba(140, 80, 220, 0.5)',
          pointRadius: 1.5,
          showLine: false,
          order: 0,
        })
      }

      // Current point (green triangle)
      const cp = pts[this.cursorIdx]
      const dynX = cp ? cp.processed.groundSpeed : 0
      const dynY = cp ? cp.processed.velD : 0
      datasets.push({
        data: [{ x: dynX, y: dynY }],
        borderColor: COL_DYNAMIC,
        backgroundColor: COL_DYNAMIC,
        pointRadius: 7,
        pointStyle: 'triangle',
        showLine: false,
        order: -1,
      })
    }

    // ── Solved polar cursor (current AOA on swept curve) ──
    const polarCursor = this.findPolarCursor()
    if (polarCursor) {
      datasets.push({
        data: [polarCursor],
        borderColor: COL_POLAR_CURSOR,
        backgroundColor: COL_POLAR_CURSOR,
        pointRadius: 7,
        pointStyle: 'rectRot', // diamond
        showLine: false,
        order: -2,
      })
    }

    // ── Raw sustained cursor (red dot) ──
    const cursorPt = this.buildCursorPoint(view)
    datasets.push({
      data: [cursorPt],
      borderColor: COL_CURSOR,
      backgroundColor: COL_CURSOR,
      pointRadius: 6,
      showLine: false,
      order: -3,
    })

    // Axis options depend on view
    const xReverse = view === 'polar'
    const yReverse = view === 'speed'

    // Auto-zoom for canopy mode (smaller speed/force envelope)
    const canopyZoom = this.sweepIsCanopy && (view === 'speed' || view === 'polar')
    const xMax = canopyZoom ? (view === 'speed' ? 30 : 0.6) : undefined
    const yMax = canopyZoom ? (view === 'speed' ? 20 : 1.5) : undefined

    this.chart1 = new Chart(ctx, {
      type: 'scatter',
      data: { datasets },
      options: {
        ...CHART_OPTS,
        scales: {
          x: { ...CHART_OPTS.scales.x, reverse: xReverse, max: xMax, title: { display: true, text: xLabel, color: COL_TICK } },
          y: { ...CHART_OPTS.scales.y, reverse: yReverse, max: yMax, title: { display: true, text: yLabel, color: COL_TICK } },
        },
      },
    })
  }

  /** Build trail data: only points within TRAIL_SECONDS before cursor */
  private buildTrailData(view: Chart1View): { x: number; y: number }[] {
    const pts = this.data
    if (pts.length === 0) return []
    const curT = pts[this.cursorIdx]?.processed.t ?? 0
    const minT = curT - TRAIL_SECONDS
    const result: { x: number; y: number }[] = []

    for (let i = 0; i <= this.cursorIdx && i < pts.length; i++) {
      const p = pts[i]
      if (p.processed.t < minT) continue
      switch (view) {
        case 'polar': result.push({ x: p.aero.cd, y: p.aero.cl }); break
        case 'speed': result.push({ x: p.aero.sustainedX, y: p.aero.sustainedY }); break
        case 'ld':    result.push({ x: p.processed.airspeed * 2.237, y: p.aero.cd > 0.001 ? p.aero.cl / p.aero.cd : 0 }); break
      }
    }
    return result
  }

  /** Build dynamic speed trail: groundSpeed vs velD for last TRAIL_SECONDS (speed view) */
  private buildDynamicTrail(): { x: number; y: number }[] {
    const pts = this.data
    if (pts.length === 0) return []
    const curT = pts[this.cursorIdx]?.processed.t ?? 0
    const minT = curT - TRAIL_SECONDS
    const result: { x: number; y: number }[] = []

    for (let i = 0; i <= this.cursorIdx && i < pts.length; i++) {
      const p = pts[i]
      if (p.processed.t < minT) continue
      result.push({ x: p.processed.groundSpeed, y: p.processed.velD })
    }
    return result
  }

  /** Build cursor point for current view */
  private buildCursorPoint(view: Chart1View): { x: number; y: number } {
    const p = this.data[this.cursorIdx]
    if (!p) return { x: 0, y: 0 }
    switch (view) {
      case 'polar': return { x: p.aero.cd, y: p.aero.cl }
      case 'speed': return { x: p.aero.sustainedX, y: p.aero.sustainedY }
      case 'ld':    return { x: p.processed.airspeed * 2.237, y: p.aero.cd > 0.001 ? p.aero.cl / p.aero.cd : 0 }
      default:      return { x: 0, y: 0 }
    }
  }

  /** Find the point on the swept polar closest to current AOA */
  private findPolarCursor(): { x: number; y: number } | null {
    if (this.lastSweep.length === 0) return null
    const view = this.chart1View
    if (view !== 'polar' && view !== 'speed') return null

    const pt = this.data[this.cursorIdx]
    if (!pt) return null
    const currentAOA = pt.aero.aoa * R2D // degrees

    // Find nearest α in the sweep
    let best = this.lastSweep[0]
    let bestDist = Math.abs(best.alpha - currentAOA)
    for (const sp of this.lastSweep) {
      const d = Math.abs(sp.alpha - currentAOA)
      if (d < bestDist) { best = sp; bestDist = d }
    }

    return view === 'polar'
      ? { x: best.cd, y: best.cl }
      : { x: best.vxs, y: best.vys }
  }

  private rebuildChart2() {
    if (this.chart2) this.chart2.destroy()
    const canvas = document.getElementById('chart2') as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    const pts = this.data

    let yData: number[], yLabel: string, y2Data: number[] | null = null, y3Data: number[] | null = null
    /** Dim raw traces (pre-fix) — shown behind main data for comparison */
    let rawY: number[] | null = null, rawY2: number[] | null = null, rawY3: number[] | null = null
    const xData = pts.map(p => p.processed.t)

    switch (this.chart2View) {
      case 'altitude':
        yData = pts.map(p => p.processed.hMSL)
        yLabel = 'Altitude (m MSL)'
        break
      case 'airspeed':
        yData = pts.map(p => p.processed.airspeed * 2.237) // mph
        yLabel = 'Airspeed (mph)'
        break
      case 'aoa':
        yData = pts.map(p => p.aero.aoa * R2D)
        yLabel = 'α (°)'
        break
      case 'gamma':
        yData = pts.map(p => p.aero.gamma * R2D)
        yLabel = 'γ (°)'
        break
      case 'theta':
        yData = pts.map(p => p.aero.theta * R2D)
        yLabel = 'θ Pitch (°)'
        break
      case 'psi':
        yData = pts.map(p => ((p.aero.psi * R2D) % 360 + 360) % 360)
        yLabel = 'ψ Heading (°)'
        break
      case 'klkd':
        yData = pts.map(p => p.aero.kl)
        y2Data = pts.map(p => p.aero.kd)
        yLabel = 'kL / kD'
        break
      case 'clcd':
        yData = pts.map(p => p.aero.cl)
        y2Data = pts.map(p => p.aero.cd)
        yLabel = 'CL / CD'
        break
      case 'roll':
        yData = pts.map(p => p.aero.roll * R2D)
        yLabel = 'Bank (°)'
        break
      case 'mode':
        yData = pts.map(p => p.flightMode?.mode ?? 0)
        yLabel = 'Flight Mode'
        break
      case 'bodyrates':
        yData = pts.map(p => p.bodyRates?.p ?? 0)
        y2Data = pts.map(p => p.bodyRates?.q ?? 0)
        y3Data = pts.map(p => p.bodyRates?.r ?? 0)
        // Raw (pre-fix) traces for comparison
        rawY = pts.map(p => p.rawBodyRates?.p ?? p.bodyRates?.p ?? 0)
        rawY2 = pts.map(p => p.rawBodyRates?.q ?? p.bodyRates?.q ?? 0)
        rawY3 = pts.map(p => p.rawBodyRates?.r ?? p.bodyRates?.r ?? 0)
        yLabel = 'Body Rates (°/s)  p=blue q=orange r=green  (dim=raw)'
        break
      case 'angaccel':
        yData = pts.map(p => p.bodyRates?.pDot ?? 0)
        y2Data = pts.map(p => p.bodyRates?.qDot ?? 0)
        y3Data = pts.map(p => p.bodyRates?.rDot ?? 0)
        rawY = pts.map(p => p.rawBodyRates?.pDot ?? p.bodyRates?.pDot ?? 0)
        rawY2 = pts.map(p => p.rawBodyRates?.qDot ?? p.bodyRates?.qDot ?? 0)
        rawY3 = pts.map(p => p.rawBodyRates?.rDot ?? p.bodyRates?.rDot ?? 0)
        yLabel = 'Angular Accel (°/s²)  ṗ=blue q̇=orange ṙ=green  (dim=raw)'
        break
      case 'controls':
        yData = pts.map(p => (p.solvedControls?.pitchThrottle ?? 0) * 100)
        y2Data = pts.map(p => (p.solvedControls?.rollThrottle ?? 0) * 100)
        y3Data = pts.map(p => (p.solvedControls?.yawThrottle ?? 0) * 100)
        yLabel = 'Control Inputs (%)  pitch=blue roll=orange yaw=green'
        break
      case 'eulerrates': {
        yData = pts.map(p => p.bodyRates?.phiDot ?? 0)
        y2Data = pts.map(p => p.bodyRates?.thetaDot ?? 0)
        y3Data = pts.map(p => p.bodyRates?.psiDot ?? 0)
        yLabel = 'Euler Rates (°/s)  φ̇=blue θ̇=orange ψ̇=green'
        break
      }
      default:
        yData = []; yLabel = ''
    }

    const datasets: any[] = []

    // Dim raw traces (behind main data) — show pre-fix values for comparison
    const RAW_ALPHA = 0.2
    const rawColors = [
      `rgba(100, 180, 255, ${RAW_ALPHA})`,
      `rgba(255, 140, 80, ${RAW_ALPHA})`,
      `rgba(120, 220, 120, ${RAW_ALPHA})`,
    ]
    const rawArrays = [rawY, rawY2, rawY3]
    let rawCount = 0
    for (let r = 0; r < 3; r++) {
      if (rawArrays[r]) {
        datasets.push({
          data: xData.map((x, i) => ({ x, y: rawArrays[r]![i] })),
          borderColor: rawColors[r], backgroundColor: 'transparent',
          pointRadius: 0, borderWidth: 1, showLine: true,
        })
        rawCount++
      }
    }
    this.chart2MainIdx = rawCount

    // Main data traces (fixed/corrected)
    datasets.push({
      data: xData.map((x, i) => ({ x, y: yData[i] })),
      borderColor: COL_TRACE,
      backgroundColor: 'transparent',
      pointRadius: 0,
      borderWidth: 1.5,
      showLine: true,
    })

    if (y2Data) {
      datasets.push({
        data: xData.map((x, i) => ({ x, y: y2Data![i] })),
        borderColor: COL_TRACE2,
        backgroundColor: 'transparent',
        pointRadius: 0,
        borderWidth: 1.5,
        showLine: true,
      })
    }

    if (y3Data) {
      datasets.push({
        data: xData.map((x, i) => ({ x, y: y3Data![i] })),
        borderColor: COL_TRACE3,
        backgroundColor: 'transparent',
        pointRadius: 0,
        borderWidth: 1.5,
        showLine: true,
      })
    }

    // Cursor vertical line (as a point)
    const curT = pts[this.cursorIdx]?.processed.t ?? 0
    const curY = yData[this.cursorIdx] ?? 0
    datasets.push({
      data: [{ x: curT, y: curY }],
      borderColor: COL_CURSOR,
      backgroundColor: COL_CURSOR,
      pointRadius: 5,
      showLine: false,
    })

    this.chart2 = new Chart(ctx, {
      type: 'scatter',
      data: { datasets },
      options: {
        ...CHART_OPTS,
        scales: {
          x: {
            ...CHART_OPTS.scales.x,
            title: { display: true, text: 'Time (s)', color: COL_TICK },
            ...(this.chart2XRange ? { min: this.chart2XRange[0], max: this.chart2XRange[1] } : {}),
          },
          y: { ...CHART_OPTS.scales.y, title: { display: true, text: yLabel, color: COL_TICK } },
        },
      },
    })

    // Attach scroll-zoom on x-axis
    this.attachChart2Zoom(canvas)
  }

  private rebuildChart3() {
    if (this.chart3) this.chart3.destroy()
    const canvas = document.getElementById('chart3') as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    const pts = this.data

    let xData: number[], yData: number[], xLabel: string, yLabel: string

    switch (this.chart3View) {
      case 'position':
        xData = pts.map(p => p.processed.posE)
        yData = pts.map(p => p.processed.posN)
        xLabel = 'East (m)'; yLabel = 'North (m)'
        break
      case 'profile':
        // Horizontal distance from start
        xData = pts.map(p => Math.sqrt(p.processed.posN ** 2 + p.processed.posE ** 2))
        yData = pts.map(p => p.processed.hMSL)
        xLabel = 'Horizontal Distance (m)'; yLabel = 'Altitude (m)'
        break
      default:
        xData = []; yData = []; xLabel = ''; yLabel = ''
    }

    const datasets: any[] = [{
      data: xData.map((x, i) => ({ x, y: yData[i] })),
      borderColor: COL_TRACE,
      backgroundColor: 'transparent',
      pointRadius: 0,
      borderWidth: 1.5,
      showLine: true,
    }, {
      data: [{ x: xData[this.cursorIdx] ?? 0, y: yData[this.cursorIdx] ?? 0 }],
      borderColor: COL_CURSOR,
      backgroundColor: COL_CURSOR,
      pointRadius: 6,
      showLine: false,
    }]

    this.chart3 = new Chart(ctx, {
      type: 'scatter',
      data: { datasets },
      options: {
        ...CHART_OPTS,
        scales: {
          x: { ...CHART_OPTS.scales.x, title: { display: true, text: xLabel, color: COL_TICK } },
          y: { ...CHART_OPTS.scales.y, title: { display: true, text: yLabel, color: COL_TICK } },
        },
      },
    })
  }

  // ─── Chart2 scroll-zoom on x-axis ───────────────────────────────────────

  private chart2ZoomHandler: ((e: WheelEvent) => void) | null = null

  private attachChart2Zoom(canvas: HTMLCanvasElement) {
    // Remove previous handler if chart was rebuilt
    if (this.chart2ZoomHandler) {
      canvas.removeEventListener('wheel', this.chart2ZoomHandler)
    }

    this.chart2ZoomHandler = (e: WheelEvent) => {
      e.preventDefault()
      if (!this.chart2 || this.data.length < 2) return

      const tMin = this.data[0].processed.t
      const tMax = this.data[this.data.length - 1].processed.t
      const fullRange = tMax - tMin

      // Current range
      let [lo, hi] = this.chart2XRange ?? [tMin, tMax]
      const span = hi - lo

      // Mouse position as fraction of canvas width → time
      const rect = canvas.getBoundingClientRect()
      const frac = (e.clientX - rect.left) / rect.width
      const tMouse = lo + frac * span

      // Zoom factor: scroll up = zoom in, scroll down = zoom out
      const zoomFactor = e.deltaY > 0 ? 1.25 : 0.8
      const newSpan = Math.max(1, Math.min(fullRange, span * zoomFactor))

      // Keep mouse position anchored
      let newLo = tMouse - frac * newSpan
      let newHi = tMouse + (1 - frac) * newSpan

      // Clamp to data range
      if (newLo < tMin) { newLo = tMin; newHi = tMin + newSpan }
      if (newHi > tMax) { newHi = tMax; newLo = tMax - newSpan }
      newLo = Math.max(tMin, newLo)
      newHi = Math.min(tMax, newHi)

      // If zoomed out to full range, clear explicit range
      if (newHi - newLo >= fullRange * 0.99) {
        this.chart2XRange = null
      } else {
        this.chart2XRange = [newLo, newHi]
      }

      // Apply to chart without full rebuild
      const xScale = this.chart2.options.scales!.x as any
      if (this.chart2XRange) {
        xScale.min = this.chart2XRange[0]
        xScale.max = this.chart2XRange[1]
      } else {
        delete xScale.min
        delete xScale.max
      }
      this.chart2.update('none')
    }

    canvas.addEventListener('wheel', this.chart2ZoomHandler, { passive: false })
  }

  // ─── Cursor update (lightweight — just move the cursor point) ───────────

  private updateCursors() {
    this.updateChart1Cursor()
    this.updateCursorOnChart(this.chart2, this.chart2View)
    this.updateCursorOnChart(this.chart3, this.chart3View)
  }

  /** Update chart1 — trail, cursors, dynamic speed (all in-place, no rebuild) */
  private updateChart1Cursor() {
    if (!this.chart1 || this.data.length === 0) return
    const view = this.chart1View

    // For polar/speed views, defer to setSolvedControls() or refreshChart1()
    // which will call rebuildChart1() with fresh sweep + trail data.
    // Only do a lightweight cursor update here for L/D view.
    if (view === 'polar' || view === 'speed') return

    // L/D view — simple cursor update
    const ds = this.chart1.data.datasets
    const cursorDs = ds[ds.length - 1]
    if (!cursorDs?.data?.length) return
    const pt = this.buildCursorPoint(view)
    ;(cursorDs.data as any[])[0] = pt
    this.chart1.update('none')
  }

  private updateCursorOnChart(chart: Chart | null, _view: string) {
    if (!chart || this.data.length === 0) return
    const ds = chart.data.datasets
    const cursorDs = ds[ds.length - 1]
    if (!cursorDs?.data?.length) return

    // For chart2, skip raw traces to find main; chart3 has no raw traces
    const mainIdx = (chart === this.chart2) ? this.chart2MainIdx : 0
    const traceDs = ds[mainIdx]
    const pt = (traceDs?.data as any[])?.[this.cursorIdx]
    if (pt) {
      (cursorDs.data as any[])[0] = { x: pt.x, y: pt.y }
      chart.update('none')
    }
  }
}
