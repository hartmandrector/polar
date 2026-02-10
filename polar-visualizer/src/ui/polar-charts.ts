/**
 * Polar charts — two Chart.js panels with dropdown view selectors.
 *
 * Chart 1 (α-based): CL vs α, CD vs α, CP vs α, L/D vs α
 * Chart 2 (cross-plot): CL vs CD (polar curve), Vxs vs Vys (speed polar)
 *
 * All curves colored by AOA using the same gradient.
 * A cursor marks the current α position on both charts.
 */

import {
  Chart,
  ScatterController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { sweepPolar, aoaToColor, aoaColorLegend, type PolarPoint, type SweepConfig } from './chart-data.ts'
import type { ContinuousPolar } from '../polar/continuous-polar.ts'

// ─── Register Chart.js components ────────────────────────────────────────────

Chart.register(ScatterController, LineElement, PointElement, LinearScale, Title, Tooltip, Legend)

// ─── Types ───────────────────────────────────────────────────────────────────

export type Chart1View = 'cl' | 'cd' | 'cp' | 'ld'
export type Chart2View = 'polar' | 'speed'

interface ChartState {
  chart1: Chart | null
  chart2: Chart | null
  points: PolarPoint[]
  chart1View: Chart1View
  chart2View: Chart2View
  currentAlpha: number
  minAlpha: number
  maxAlpha: number
}

// ─── Module state ────────────────────────────────────────────────────────────

const state: ChartState = {
  chart1: null,
  chart2: null,
  points: [],
  chart1View: 'cl',
  chart2View: 'polar',
  currentAlpha: 12,
  minAlpha: -10,
  maxAlpha: 90,
}

// ─── Vertical line plugin (α cursor for AOA-based charts) ────────────────────

const verticalLinePlugin = {
  id: 'verticalLine',
  afterDraw(chart: Chart) {
    const opts = (chart.options.plugins as any)?.verticalLine
    if (!opts || opts.x == null) return
    const { ctx, chartArea, scales } = chart
    const xScale = scales['x']
    if (!xScale) return
    const xPixel = xScale.getPixelForValue(opts.x)
    if (xPixel < chartArea.left || xPixel > chartArea.right) return
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(xPixel, chartArea.top)
    ctx.lineTo(xPixel, chartArea.bottom)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = opts.color || '#ffffff'
    ctx.setLineDash([4, 4])
    ctx.stroke()
    ctx.restore()
  }
}

Chart.register(verticalLinePlugin)

// ─── Chart configuration helpers ─────────────────────────────────────────────

const CHART1_LABELS: Record<Chart1View, { title: string, yLabel: string }> = {
  cl: { title: 'Lift Coefficient', yLabel: 'CL' },
  cd: { title: 'Drag Coefficient', yLabel: 'CD' },
  cp: { title: 'Center of Pressure', yLabel: 'CP (% chord)' },
  ld: { title: 'Glide Ratio', yLabel: 'L/D' },
}

const CHART2_LABELS: Record<Chart2View, { title: string, xLabel: string, yLabel: string }> = {
  polar: { title: 'Polar Curve', xLabel: 'CD', yLabel: 'CL' },
  speed: { title: 'Speed Polar', xLabel: 'Vxs (m/s)', yLabel: 'Vys (m/s)' },
}

function chart1Data(view: Chart1View, points: PolarPoint[]): { x: number, y: number }[] {
  const getter: Record<Chart1View, (p: PolarPoint) => number> = {
    cl: p => p.cl,
    cd: p => p.cd,
    cp: p => p.cp,
    ld: p => p.ld,
  }
  const fn = getter[view]
  return points.map(p => ({ x: p.alpha, y: fn(p) }))
}

function chart2Data(view: Chart2View, points: PolarPoint[]): { x: number, y: number }[] {
  if (view === 'polar') return points.map(p => ({ x: p.cd, y: p.cl }))
  return points.map(p => ({ x: p.vxs, y: p.vys }))
}

/** Find the point nearest to currentAlpha for the cursor highlight on chart2 */
function cursorPoint2(view: Chart2View, points: PolarPoint[], alpha: number): { x: number, y: number } | null {
  if (points.length === 0) return null
  let best = points[0]
  let bestDist = Math.abs(best.alpha - alpha)
  for (const p of points) {
    const d = Math.abs(p.alpha - alpha)
    if (d < bestDist) { best = p; bestDist = d }
  }
  if (view === 'polar') return { x: best.cd, y: best.cl }
  return { x: best.vxs, y: best.vys }
}

// ─── Dark theme defaults ─────────────────────────────────────────────────────

const GRID_COLOR = 'rgba(255, 255, 255, 0.08)'
const TICK_COLOR = '#8888aa'
const TITLE_COLOR = '#e94560'
const CURSOR_COLOR = '#ffffff'

function baseScaleOptions(label: string): any {
  return {
    grid: { color: GRID_COLOR },
    ticks: { color: TICK_COLOR, font: { size: 10 } },
    title: { display: true, text: label, color: TICK_COLOR, font: { size: 11 } },
  }
}

// ─── Create / update charts ──────────────────────────────────────────────────

function createChart1(canvas: HTMLCanvasElement): Chart {
  const { points, chart1View, currentAlpha, minAlpha, maxAlpha } = state
  const data = chart1Data(chart1View, points)
  const colors = points.map(p => p.color)
  const info = CHART1_LABELS[chart1View]

  return new Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: info.yLabel,
          data,
          pointBackgroundColor: colors,
          pointBorderColor: colors,
          pointRadius: 1.5,
          pointHoverRadius: 4,
          showLine: true,
          borderWidth: 2,
          segment: {
            borderColor: (ctx: any) => colors[ctx.p0DataIndex] || '#888',
          },
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { bottom: 8 } },
      plugins: {
        legend: { display: false },
        title: { display: true, text: info.title, color: TITLE_COLOR, font: { size: 13, weight: 'bold' as const } },
        tooltip: {
          callbacks: {
            label: (ctx: any) => `α=${ctx.parsed.x.toFixed(1)}°  ${info.yLabel}=${ctx.parsed.y.toFixed(4)}`,
          },
        },
        verticalLine: { x: currentAlpha, color: CURSOR_COLOR },
      } as any,
      scales: {
        x: { ...baseScaleOptions('α (deg)'), min: minAlpha, max: maxAlpha, reverse: true },
        y: baseScaleOptions(info.yLabel),
      },
    },
  })
}

function createChart2(canvas: HTMLCanvasElement): Chart {
  const { points, chart2View, currentAlpha } = state
  const data = chart2Data(chart2View, points)
  const colors = points.map(p => p.color)
  const info = CHART2_LABELS[chart2View]
  const cursor = cursorPoint2(chart2View, points, currentAlpha)

  return new Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: info.yLabel,
          data,
          pointBackgroundColor: colors,
          pointBorderColor: colors,
          pointRadius: 1.5,
          pointHoverRadius: 4,
          showLine: true,
          borderWidth: 2,
          segment: {
            borderColor: (ctx: any) => colors[ctx.p0DataIndex] || '#888',
          },
          fill: false,
        },
        // Cursor point
        {
          label: 'Current α',
          data: cursor ? [cursor] : [],
          pointBackgroundColor: CURSOR_COLOR,
          pointBorderColor: CURSOR_COLOR,
          pointRadius: 6,
          pointBorderWidth: 2,
          showLine: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { bottom: 8 } },
      plugins: {
        legend: { display: false },
        title: { display: true, text: info.title, color: TITLE_COLOR, font: { size: 13, weight: 'bold' } },
        tooltip: {
          filter: (item: any) => item.datasetIndex === 0,
          callbacks: {
            label: (ctx: any) => {
              const p = points[ctx.dataIndex]
              return p ? `α=${p.alpha.toFixed(1)}°  x=${ctx.parsed.x.toFixed(3)}  y=${ctx.parsed.y.toFixed(3)}` : ''
            },
          },
        },
      },
      scales: {
        x: { ...baseScaleOptions(info.xLabel), reverse: chart2View === 'polar' },
        y: { ...baseScaleOptions(info.yLabel), reverse: chart2View === 'speed' },
      },
    },
  })
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize chart panels. Call once after DOM is ready.
 * Creates two Chart.js instances with dropdown selectors wired up.
 */
export function initCharts(): void {
  const canvas1 = document.getElementById('chart1-canvas') as HTMLCanvasElement
  const canvas2 = document.getElementById('chart2-canvas') as HTMLCanvasElement
  const select1 = document.getElementById('chart1-select') as HTMLSelectElement
  const select2 = document.getElementById('chart2-select') as HTMLSelectElement

  if (!canvas1 || !canvas2) {
    console.warn('Chart canvases not found — skipping chart init')
    return
  }

  // Wire dropdown handlers
  select1?.addEventListener('change', () => {
    state.chart1View = select1.value as Chart1View
    rebuildChart1()
  })
  select2?.addEventListener('change', () => {
    state.chart2View = select2.value as Chart2View
    rebuildChart2()
  })

  // Build AOA legend
  buildAoaLegend()
}

function rebuildChart1(): void {
  const canvas = document.getElementById('chart1-canvas') as HTMLCanvasElement
  if (!canvas) return
  if (state.chart1) state.chart1.destroy()
  state.chart1 = createChart1(canvas)
}

function rebuildChart2(): void {
  const canvas = document.getElementById('chart2-canvas') as HTMLCanvasElement
  if (!canvas) return
  if (state.chart2) state.chart2.destroy()
  state.chart2 = createChart2(canvas)
}

/**
 * Recompute the full polar sweep and update both charts.
 * Call when β, δ, dirty, polar, airspeed, or ρ change.
 */
export function updateChartSweep(
  polar: ContinuousPolar,
  config: Partial<SweepConfig>,
  currentAlpha: number,
): void {
  state.currentAlpha = currentAlpha
  state.minAlpha = config.minAlpha ?? -10
  state.maxAlpha = config.maxAlpha ?? 90

  // Recompute full sweep
  state.points = sweepPolar(polar, {
    minAlpha: state.minAlpha,
    maxAlpha: state.maxAlpha,
    step: 0.5,
    ...config,
  })

  // Rebuild both charts (full data change)
  rebuildChart1()
  rebuildChart2()
  buildAoaLegend()
}

/**
 * Move the α cursor on both charts without recomputing the sweep.
 * Call when only α changes.
 */
export function updateChartCursor(currentAlpha: number): void {
  state.currentAlpha = currentAlpha

  // Chart 1: update vertical line position
  if (state.chart1) {
    const plugins = state.chart1.options.plugins as any
    if (plugins.verticalLine) {
      plugins.verticalLine.x = currentAlpha
    }
    state.chart1.update('none')
  }

  // Chart 2: move cursor point
  if (state.chart2) {
    const cursor = cursorPoint2(state.chart2View, state.points, currentAlpha)
    const cursorDataset = state.chart2.data.datasets[1]
    if (cursorDataset && cursor) {
      cursorDataset.data = [cursor]
    }
    state.chart2.update('none')
  }
}

// ─── AOA color legend ────────────────────────────────────────────────────────

function buildAoaLegend(): void {
  const container = document.getElementById('aoa-legend')
  if (!container) return

  const stops = aoaColorLegend(state.minAlpha, state.maxAlpha, 9)
  const reversedColors = [...stops].reverse().map(s => s.color).join(', ')

  container.innerHTML = `
    <div class="aoa-gradient" style="background: linear-gradient(to right, ${reversedColors}); height: 8px; border-radius: 4px;"></div>
    <div class="aoa-labels">
      <span>${stops[stops.length - 1].alpha}°</span>
      <span>${stops[Math.floor(stops.length / 2)].alpha}°</span>
      <span>${stops[0].alpha}°</span>
    </div>
  `
}
