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
const COL_GRID   = 'rgba(60, 60, 100, 0.3)'
const COL_TICK   = 'rgba(140, 140, 180, 0.6)'

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

  private chart1View: Chart1View = 'polar'
  private chart2View: Chart2View = 'altitude'
  private chart3View: Chart3View = 'position'

  // ─── X-axis zoom state for chart2 (time series) ────────────────────────

  /** Current visible x-range [min, max] in seconds. null = auto (full range) */
  private chart2XRange: [number, number] | null = null

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

    let xData: number[], yData: number[], xLabel: string, yLabel: string
    let y2Data: number[] | null = null, y2Label: string | null = null

    switch (this.chart1View) {
      case 'polar':
        xData = pts.map(p => p.aero.cd)
        yData = pts.map(p => p.aero.cl)
        xLabel = 'CD'; yLabel = 'CL'
        break
      case 'speed':
        xData = pts.map(p => p.aero.sustainedX)
        yData = pts.map(p => p.aero.sustainedY)
        xLabel = 'Vxs'; yLabel = 'Vys'
        break
      case 'ld':
        xData = pts.map(p => p.processed.airspeed * 2.237) // mph
        yData = pts.map(p => p.aero.cd > 0.001 ? p.aero.cl / p.aero.cd : 0)
        xLabel = 'Airspeed (mph)'; yLabel = 'L/D'
        break
      default:
        xData = []; yData = []; xLabel = ''; yLabel = ''
    }

    const datasets: any[] = [{
      data: xData.map((x, i) => ({ x, y: yData[i] })),
      borderColor: COL_TRACE,
      backgroundColor: COL_TRACE,
      pointRadius: 1.5,
      showLine: false,
    }]

    if (y2Data) {
      datasets.push({
        data: xData.map((x, i) => ({ x, y: y2Data![i] })),
        borderColor: COL_TRACE2,
        backgroundColor: COL_TRACE2,
        pointRadius: 1.5,
        showLine: false,
      })
    }

    // Cursor point
    datasets.push({
      data: [{ x: xData[this.cursorIdx] ?? 0, y: yData[this.cursorIdx] ?? 0 }],
      borderColor: COL_CURSOR,
      backgroundColor: COL_CURSOR,
      pointRadius: 6,
      showLine: false,
    })

    // Axis options depend on view
    const xReverse = this.chart1View === 'polar'
    const yReverse = this.chart1View === 'speed'
    const yMin = undefined

    this.chart1 = new Chart(ctx, {
      type: 'scatter',
      data: { datasets },
      options: {
        ...CHART_OPTS,
        scales: {
          x: { ...CHART_OPTS.scales.x, reverse: xReverse, title: { display: true, text: xLabel, color: COL_TICK } },
          y: { ...CHART_OPTS.scales.y, reverse: yReverse, min: yMin, title: { display: true, text: yLabel, color: COL_TICK } },
        },
      },
    })
  }

  private rebuildChart2() {
    if (this.chart2) this.chart2.destroy()
    const canvas = document.getElementById('chart2') as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    const pts = this.data

    let yData: number[], yLabel: string, y2Data: number[] | null = null, y3Data: number[] | null = null
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
        yLabel = 'Body Rates (°/s)  p=blue q=orange r=green'
        break
      case 'angaccel':
        yData = pts.map(p => p.bodyRates?.pDot ?? 0)
        y2Data = pts.map(p => p.bodyRates?.qDot ?? 0)
        y3Data = pts.map(p => p.bodyRates?.rDot ?? 0)
        yLabel = 'Angular Accel (°/s²)  ṗ=blue q̇=orange ṙ=green'
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

    const datasets: any[] = [{
      data: xData.map((x, i) => ({ x, y: yData[i] })),
      borderColor: COL_TRACE,
      backgroundColor: 'transparent',
      pointRadius: 0,
      borderWidth: 1.5,
      showLine: true,
    }]

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
    this.updateCursorOnChart(this.chart1, this.chart1View)
    this.updateCursorOnChart(this.chart2, this.chart2View)
    this.updateCursorOnChart(this.chart3, this.chart3View)
  }

  private updateCursorOnChart(chart: Chart | null, _view: string) {
    if (!chart || this.data.length === 0) return
    const ds = chart.data.datasets
    const cursorDs = ds[ds.length - 1] // cursor is always last dataset
    if (!cursorDs?.data?.length) return

    // Rebuild the cursor data point from the trace dataset
    const traceDs = ds[0]
    const pt = (traceDs.data as any[])[this.cursorIdx]
    if (pt) {
      (cursorDs.data as any[])[0] = { x: pt.x, y: pt.y }
      chart.update('none') // no animation
    }
  }
}
