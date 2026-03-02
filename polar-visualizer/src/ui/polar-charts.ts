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
import { sweepPolar, sweepSegments, sweepLegacyPolar, aoaToColor, aoaColorLegend, type PolarPoint, type LegacyPoint, type SweepConfig } from './chart-data.ts'
import type { ContinuousPolar, AeroSegment, SegmentControls } from '../polar/continuous-polar.ts'
import type { WSEQPolar } from '../polar/polar-data.ts'

// ─── Register Chart.js components ────────────────────────────────────────────

Chart.register(ScatterController, LineElement, PointElement, LinearScale, Title, Tooltip, Legend)

// ─── Types ───────────────────────────────────────────────────────────────────

export type Chart1View = 'cl' | 'cd' | 'cp' | 'ld'
export type Chart2View = 'polar' | 'speed'

interface ChartState {
  chart1: Chart | null
  chart2: Chart | null
  points: PolarPoint[]
  legacyPoints: LegacyPoint[]
  showLegacy: boolean
  useMph: boolean
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
  legacyPoints: [],
  showLegacy: true,
  useMph: false,
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

const MS_TO_MPH = 2.23694

function chart2Labels(view: Chart2View, mph: boolean): { title: string, xLabel: string, yLabel: string } {
  if (view === 'polar') return { title: 'Polar Curve', xLabel: 'CD', yLabel: 'CL' }
  const unit = mph ? 'mph' : 'm/s'
  return { title: 'Speed Polar', xLabel: `Vxs (${unit})`, yLabel: `Vys (${unit})` }
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
  const k = state.useMph ? MS_TO_MPH : 1
  return points.map(p => ({ x: p.vxs * k, y: p.vys * k }))
}

// ─── Legacy data helpers ─────────────────────────────────────────────────────

function legacyChart1Data(view: Chart1View, points: LegacyPoint[]): { x: number, y: number }[] {
  const getter: Record<Chart1View, (p: LegacyPoint) => number> = {
    cl: p => p.cl,
    cd: p => p.cd,
    cp: p => p.cp,
    ld: p => p.ld,
  }
  const fn = getter[view]
  return points.map(p => ({ x: p.alpha, y: fn(p) }))
}

function legacyChart2Data(view: Chart2View, points: LegacyPoint[]): { x: number, y: number }[] {
  if (view === 'polar') return points.map(p => ({ x: p.cd, y: p.cl }))
  const k = state.useMph ? MS_TO_MPH : 1
  return points.map(p => ({ x: p.vxs * k, y: p.vys * k }))
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
  const k = state.useMph ? MS_TO_MPH : 1
  return { x: best.vxs * k, y: best.vys * k }
}

// ─── Dark theme defaults ─────────────────────────────────────────────────────

const GRID_COLOR = 'rgba(255, 255, 255, 0.08)'
const TICK_COLOR = '#8888aa'
const TITLE_COLOR = '#e94560'
const CURSOR_COLOR = '#ffffff'

// ─── Glide line colors ──────────────────────────────────────────────────────

/** Positive glide ratios: brighter, more saturated */
const GLIDE_COLORS_POS = ['#44aaff', '#44dd88', '#dddd44']  // 1:1, 2:1, 3:1
/** Negative glide ratios: dimmer, desaturated */
const GLIDE_COLORS_NEG = ['#665577', '#556655', '#666644']  // -1:1, -2:1, -3:1
const GLIDE_RATIOS = [1, 2, 3]

// ─── Glide line plugin ──────────────────────────────────────────────────────

/**
 * Draws L/D glide ratio reference lines on chart2 (polar curve and speed polar).
 * Lines radiate from origin at slopes corresponding to 1:1, 2:1, 3:1 glide ratios.
 */
const glideLinesPlugin = {
  id: 'glideLines',
  afterDraw(chart: Chart) {
    const opts = (chart.options.plugins as any)?.glideLines
    if (!opts?.enabled) return

    const { ctx, chartArea, scales } = chart
    const xScale = scales['x']
    const yScale = scales['y']
    if (!xScale || !yScale) return

    ctx.save()
    ctx.setLineDash([6, 4])
    ctx.lineWidth = 1

    const mode: 'polar' | 'speed' = opts.mode

    for (let i = 0; i < GLIDE_RATIOS.length; i++) {
      const ratio = GLIDE_RATIOS[i]

      // Positive glide ratio
      drawGlideLine(ctx, chartArea, xScale, yScale, mode, ratio, GLIDE_COLORS_POS[i], opts.labelSide ?? 'right')
      // Negative glide ratio
      drawGlideLine(ctx, chartArea, xScale, yScale, mode, -ratio, GLIDE_COLORS_NEG[i], opts.labelSide ?? 'right')
    }

    ctx.restore()
  }
}

function drawGlideLine(
  ctx: CanvasRenderingContext2D,
  chartArea: { left: number, right: number, top: number, bottom: number },
  xScale: any,
  yScale: any,
  mode: 'polar' | 'speed',
  ratio: number,  // positive or negative L/D
  color: string,
  labelSide: string,
): void {
  // Origin in pixel coords
  const ox = xScale.getPixelForValue(0)
  const oy = yScale.getPixelForValue(0)

  // Compute a far endpoint along the glide line
  // Polar curve (CL vs CD): CL = ratio * CD → y = ratio * x
  // Speed polar (Vxs vs Vys): Vys = Vxs / ratio → y = x / ratio
  // Note: both charts may have reversed axes, so we extend in data space
  // and let the scale conversion handle pixel direction.

  let farX: number, farY: number
  if (mode === 'polar') {
    // Extend along CD axis; x-axis is reversed (high CD on left)
    // Use a large CD value to extend line to chart edge
    farX = 2.0  // CD
    farY = ratio * farX  // CL
  } else {
    // Speed polar: extend along Vxs axis
    farX = 500  // Vxs (large enough for any unit)
    farY = farX / ratio  // Vys = Vxs / L/D
  }

  const ex = xScale.getPixelForValue(farX)
  const ey = yScale.getPixelForValue(farY)

  // Clip to chart area
  const clipped = clipLine(ox, oy, ex, ey, chartArea)
  if (!clipped) return

  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.moveTo(clipped.x1, clipped.y1)
  ctx.lineTo(clipped.x2, clipped.y2)
  ctx.stroke()

  // Label at the edge of the line
  const labelX = clipped.x2
  const labelY = clipped.y2
  const label = `${ratio > 0 ? '' : ''}${ratio}:1`

  ctx.setLineDash([])
  ctx.font = '10px monospace'
  ctx.fillStyle = color
  ctx.textAlign = labelSide === 'right' ? 'left' : 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(label, labelX + (labelSide === 'right' ? 3 : -3), labelY - 2)
  ctx.setLineDash([6, 4])
}

/** Cohen-Sutherland style line clipping to a rect */
function clipLine(
  x1: number, y1: number, x2: number, y2: number,
  area: { left: number, right: number, top: number, bottom: number },
): { x1: number, y1: number, x2: number, y2: number } | null {
  const { left, right, top, bottom } = area
  const dx = x2 - x1
  const dy = y2 - y1

  let tMin = 0, tMax = 1

  // Clip against each edge
  const edges = [
    { p: -dx, q: x1 - left },
    { p: dx, q: right - x1 },
    { p: -dy, q: y1 - top },
    { p: dy, q: bottom - y1 },
  ]

  for (const { p, q } of edges) {
    if (Math.abs(p) < 1e-10) {
      if (q < 0) return null  // parallel and outside
    } else {
      const t = q / p
      if (p < 0) {
        tMin = Math.max(tMin, t)
      } else {
        tMax = Math.min(tMax, t)
      }
    }
  }

  if (tMin > tMax) return null

  return {
    x1: x1 + tMin * dx,
    y1: y1 + tMin * dy,
    x2: x1 + tMax * dx,
    y2: y1 + tMax * dy,
  }
}

Chart.register(glideLinesPlugin)

function baseScaleOptions(label: string): any {
  return {
    grid: { color: GRID_COLOR },
    ticks: { color: TICK_COLOR, font: { size: 10 } },
    title: { display: true, text: label, color: TICK_COLOR, font: { size: 11 } },
  }
}

// ─── Create / update charts ──────────────────────────────────────────────────

/** Create a legacy overlay dataset (thin line, same AOA coloring) */
function legacyDataset(data: { x: number, y: number }[], colors: string[]): any {
  return {
    label: 'Legacy',
    data,
    pointBackgroundColor: colors,
    pointBorderColor: colors,
    pointRadius: 0.8,
    pointHoverRadius: 3,
    showLine: true,
    borderWidth: 1,
    borderDash: [],
    segment: {
      borderColor: (ctx: any) => colors[ctx.p0DataIndex] || '#888',
    },
    fill: false,
  }
}

function createChart1(canvas: HTMLCanvasElement): Chart {
  const { points, legacyPoints, showLegacy, chart1View, currentAlpha, minAlpha, maxAlpha } = state
  const data = chart1Data(chart1View, points)
  const colors = points.map(p => p.color)
  const info = CHART1_LABELS[chart1View]

  return new Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [
        // Continuous polar (thick)
        {
          label: info.yLabel,
          data,
          pointBackgroundColor: colors,
          pointBorderColor: colors,
          pointRadius: 1.5,
          pointHoverRadius: 4,
          showLine: true,
          borderWidth: 2.5,
          segment: {
            borderColor: (ctx: any) => colors[ctx.p0DataIndex] || '#888',
          },
          fill: false,
        },
        // Legacy polar (thin) — only if enabled and has data
        ...(showLegacy && legacyPoints.length > 0 ? [
          legacyDataset(
            legacyChart1Data(chart1View, legacyPoints),
            legacyPoints.map(p => p.color)
          )
        ] : []),
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
  const { points, legacyPoints, showLegacy, chart2View, currentAlpha } = state
  const data = chart2Data(chart2View, points)
  const colors = points.map(p => p.color)
  const info = chart2Labels(chart2View, state.useMph)
  const cursor = cursorPoint2(chart2View, points, currentAlpha)

  return new Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [
        // Continuous polar (thick)
        {
          label: info.yLabel,
          data,
          pointBackgroundColor: colors,
          pointBorderColor: colors,
          pointRadius: 1.5,
          pointHoverRadius: 4,
          showLine: true,
          borderWidth: 2.5,
          segment: {
            borderColor: (ctx: any) => colors[ctx.p0DataIndex] || '#888',
          },
          fill: false,
        },
        // Legacy polar (thin) — only if enabled and has data
        ...(showLegacy && legacyPoints.length > 0 ? [
          legacyDataset(
            legacyChart2Data(chart2View, legacyPoints),
            legacyPoints.map(p => p.color)
          )
        ] : []),
        // Cursor point (always last)
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
        glideLines: { enabled: true, mode: chart2View === 'polar' ? 'polar' : 'speed' },
      } as any,
      scales: {
        x: {
          ...baseScaleOptions(info.xLabel),
          reverse: chart2View === 'polar',
          ...(chart2View === 'speed' ? { min: 0 } : {}),
        },
        y: {
          ...baseScaleOptions(info.yLabel),
          reverse: chart2View === 'speed',
          ...(chart2View === 'speed' ? { min: 0 } : {}),
          ...(chart2View === 'polar' ? {} : {}),
        },
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

  // Wire legacy checkboxes
  const legacyCb1 = document.getElementById('chart1-legacy') as HTMLInputElement
  const legacyCb2 = document.getElementById('chart2-legacy') as HTMLInputElement
  const syncLegacy = () => {
    // Both checkboxes stay in sync
    const checked = legacyCb1?.checked ?? legacyCb2?.checked ?? true
    if (legacyCb1) legacyCb1.checked = checked
    if (legacyCb2) legacyCb2.checked = checked
    state.showLegacy = checked
    rebuildChart1()
    rebuildChart2()
  }
  legacyCb1?.addEventListener('change', syncLegacy)
  legacyCb2?.addEventListener('change', syncLegacy)

  // Wire mph checkbox
  const mphCb = document.getElementById('chart2-mph') as HTMLInputElement
  mphCb?.addEventListener('change', () => {
    state.useMph = mphCb.checked
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
  legacyPolar?: WSEQPolar,
  segments?: AeroSegment[],
  controls?: SegmentControls,
  massReference_m?: number,
): void {
  state.currentAlpha = currentAlpha
  state.minAlpha = config.minAlpha ?? -10
  state.maxAlpha = config.maxAlpha ?? 90

  // Use segment-summed sweep when segments are available, otherwise single-airfoil
  if (segments && segments.length > 0 && controls) {
    const massReference = massReference_m ?? polar.referenceLength
    state.points = sweepSegments(segments, polar, massReference, controls, {
      minAlpha: state.minAlpha,
      maxAlpha: state.maxAlpha,
      step: 0.5,
      ...config,
    })
  } else {
    state.points = sweepPolar(polar, {
      minAlpha: state.minAlpha,
      maxAlpha: state.maxAlpha,
      step: 0.5,
      ...config,
    })
  }

  // Recompute legacy sweep
  if (legacyPolar) {
    state.legacyPoints = sweepLegacyPolar(legacyPolar, {
      minAlpha: state.minAlpha,
      maxAlpha: state.maxAlpha,
      step: 0.5,
      ...config,
    })
  } else {
    state.legacyPoints = []
  }

  // Rebuild both charts (full data change)
  rebuildChart1()
  rebuildChart2()
  buildAoaLegend()
}

/**
 * Toggle legacy polar overlay on charts.
 */
export function setChartLegacy(show: boolean): void {
  state.showLegacy = show
  rebuildChart1()
  rebuildChart2()
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

  // Chart 2: move cursor point (always the last dataset)
  if (state.chart2) {
    const cursor = cursorPoint2(state.chart2View, state.points, currentAlpha)
    const datasets = state.chart2.data.datasets
    const cursorDataset = datasets[datasets.length - 1]
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
