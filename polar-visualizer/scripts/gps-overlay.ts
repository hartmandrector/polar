/**
 * gps-overlay.ts — Overlay GPS flight data against eigenvalue trim predictions.
 *
 * Usage:
 *   npx tsx scripts/gps-overlay.ts <csv-file> [polar] [flags]
 *
 * Examples:
 *   npx tsx scripts/gps-overlay.ts ../twin-gps-stability.csv a5segments
 *   npx tsx scripts/gps-overlay.ts ../data.csv a5segments --trim-window 25,47
 *
 * Flags:
 *   --trim-window <start>,<end>   Time window (seconds) to highlight as "near-trim"
 *   --no-html                     Skip HTML report
 *
 * Outputs:
 *   HTML:  scripts/results/gps-overlay-<polar>.html
 */

import * as fs from 'fs'
import * as path from 'path'
import { ibexulContinuous, aurafiveContinuous, a5segmentsContinuous, slicksinContinuous } from '../src/polar/polar-data.ts'
import type { ContinuousPolar } from '../src/polar/continuous-polar.ts'
import type { SimConfig } from '../src/polar/sim-state.ts'
import { computeInertia, computeCenterOfMass, ZERO_INERTIA } from '../src/polar/inertia.ts'
import { defaultControls } from '../src/polar/aero-segment.ts'
import { findTrim } from './lib/trim-finder.ts'

// ─── Types ──────────────────────────────────────────────────────────────────

interface GpsRow {
  t: number
  V: number
  alpha: number
  gamma: number
  phi: number
  theta: number
  psi: number
  p: number
  q: number
  r: number
  CL: number
  CD: number
  qbar?: number
  rho?: number
}

interface TrimPoint {
  V: number
  alpha_deg: number
  theta_deg: number
  gamma_deg: number
  qDot: number
  converged: boolean
  CL?: number
  CD?: number
}

interface Metadata {
  vehicle: string
  date: string
  pilot_mass_kg: number
  wing_area_m2: number
  segment: string
  gps_rate_hz: number
  notes: string
}

// ─── Polar Registry ─────────────────────────────────────────────────────────

const POLARS: Record<string, ContinuousPolar> = {
  ibexul: ibexulContinuous,
  aurafive: aurafiveContinuous,
  a5segments: a5segmentsContinuous,
  slicksin: slicksinContinuous,
}

// ─── CSV Parser ─────────────────────────────────────────────────────────────

function parseCsv(filepath: string): { meta: Metadata, rows: GpsRow[] } {
  const text = fs.readFileSync(filepath, 'utf-8')
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  // Parse metadata comments
  const meta: Record<string, string> = {}
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('#')) {
      const m = line.match(/^#\s*(\w+):\s*(.+)$/)
      if (m) meta[m[1]] = m[2]
    } else {
      dataLines.push(line)
    }
  }

  // Parse header
  const header = dataLines[0].split(',').map(h => h.trim())

  // Parse rows
  const rows: GpsRow[] = []
  for (let i = 1; i < dataLines.length; i++) {
    const vals = dataLines[i].split(',')
    if (vals.length < header.length) continue

    const row: Record<string, number> = {}
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = parseFloat(vals[j])
    }

    rows.push({
      t: row['t'] ?? 0,
      V: row['V'] ?? 0,
      alpha: row['alpha'] ?? 0,
      gamma: row['gamma'] ?? 0,
      phi: row['phi'] ?? 0,
      theta: row['theta'] ?? 0,
      psi: row['psi'] ?? 0,
      p: row['p'] ?? 0,
      q: row['q'] ?? 0,
      r: row['r'] ?? 0,
      CL: row['CL'] ?? 0,
      CD: row['CD'] ?? 0,
      qbar: row['qbar'],
      rho: row['rho'],
    })
  }

  return {
    meta: {
      vehicle: meta['vehicle'] ?? 'unknown',
      date: meta['date'] ?? 'unknown',
      pilot_mass_kg: parseFloat(meta['pilot_mass_kg'] ?? '77.5'),
      wing_area_m2: parseFloat(meta['wing_area_m2'] ?? '2.0'),
      segment: meta['segment'] ?? 'unknown',
      gps_rate_hz: parseFloat(meta['gps_rate_hz'] ?? '5'),
      notes: meta['notes'] ?? '',
    },
    rows,
  }
}

// ─── Build SimConfig ────────────────────────────────────────────────────────

function buildConfig(polar: ContinuousPolar): SimConfig {
  const segments = polar.aeroSegments ?? []
  const massRef = polar.referenceLength ?? 1.875
  const cgMeters = polar.massSegments?.length
    ? computeCenterOfMass(polar.massSegments, massRef, polar.m)
    : { x: 0, y: 0, z: 0 }
  const inertia = polar.massSegments
    ? computeInertia(polar.inertiaMassSegments ?? polar.massSegments, massRef, polar.m)
    : ZERO_INERTIA

  return {
    segments,
    controls: { ...defaultControls() },
    cgMeters,
    inertia,
    mass: polar.m,
    height: massRef,
    rho: 1.225,
  }
}

// ─── Trim Sweep ─────────────────────────────────────────────────────────────

function computeTrimCurve(polar: ContinuousPolar, isWingsuit: boolean): TrimPoint[] {
  const config = buildConfig(polar)
  const speeds = isWingsuit
    ? Array.from({ length: 40 }, (_, i) => 20 + i)      // 20–59 m/s, 1 m/s steps
    : Array.from({ length: 20 }, (_, i) => 6 + i * 0.5)  // 6–15.5 m/s

  const trimOpts = isWingsuit
    ? { alphaGuess_deg: 10, thetaGuess_deg: -10 }
    : { alphaGuess_deg: 10, thetaGuess_deg: -30 }

  const points: TrimPoint[] = []
  for (const V of speeds) {
    const trim = findTrim(V, config, trimOpts)
    if (trim.converged) {
      // Compute CL, CD at trim from force balance
      const gamma_rad = trim.gamma_deg * Math.PI / 180
      const m = polar.m
      const g = 9.81
      const S = polar.aeroSegments?.[0]?.S ?? 2.0
      const rho = 1.225
      const qbar = 0.5 * rho * V * V
      points.push({
        V,
        alpha_deg: trim.alpha_deg,
        theta_deg: trim.theta_deg,
        gamma_deg: trim.gamma_deg,
        qDot: trim.qDot,
        converged: true,
        CL: m * g * Math.cos(gamma_rad) / (qbar * S),
        CD: -m * g * Math.sin(gamma_rad) / (qbar * S),
      })
    }
  }
  return points
}

// ─── HTML Report ────────────────────────────────────────────────────────────

const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js'

function escapeJson(data: unknown): string {
  return JSON.stringify(data).replace(/<\/script/g, '<\\/script')
}

function generateHtml(
  meta: Metadata,
  rows: GpsRow[],
  trimCurve: TrimPoint[],
  polarName: string,
  trimWindow?: [number, number],
): string {
  const title = `GPS Overlay — ${meta.vehicle} ${meta.date} vs ${polarName}`

  // Split GPS data into full flight and trim window
  const inWindow = trimWindow
    ? rows.filter(r => r.t >= trimWindow[0] && r.t <= trimWindow[1])
    : []

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<script src="${CHART_JS_CDN}"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
  h1 { text-align: center; margin-bottom: 8px; font-size: 1.6em; color: #f0f0f0; }
  .subtitle { text-align: center; color: #888; margin-bottom: 24px; font-size: 0.9em; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 1600px; margin: 0 auto; }
  .chart-box { background: #16213e; border-radius: 8px; padding: 16px; }
  .chart-box.full { grid-column: 1 / -1; }
  .chart-box h2 { font-size: 1.0em; color: #ccc; margin-bottom: 10px; }
  canvas { width: 100% !important; }
  .legend-hint { text-align: center; color: #666; font-size: 0.8em; margin-top: 16px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; max-width: 1600px; margin: 0 auto 20px; }
  .stat-box { background: #16213e; border-radius: 8px; padding: 12px; text-align: center; }
  .stat-box .value { font-size: 1.4em; color: #f0f0f0; font-weight: 600; }
  .stat-box .label { font-size: 0.8em; color: #888; margin-top: 4px; }
</style>
</head>
<body>
<h1>${title}</h1>
<div class="subtitle">
  ${meta.date} &nbsp;│&nbsp; ${meta.pilot_mass_kg} kg &nbsp;│&nbsp; S=${meta.wing_area_m2} m² &nbsp;│&nbsp;
  ${meta.gps_rate_hz} Hz &nbsp;│&nbsp; ${rows.length} samples (${(rows[rows.length-1].t - rows[0].t).toFixed(1)}s)
  ${trimWindow ? ' &nbsp;│&nbsp; Trim window: ' + trimWindow[0] + '–' + trimWindow[1] + 's' : ''}
</div>

<div class="stats">
  <div class="stat-box"><div class="value">${rows[0].V.toFixed(0)}–${Math.max(...rows.map(r=>r.V)).toFixed(0)} m/s</div><div class="label">Speed range</div></div>
  <div class="stat-box"><div class="value">${Math.min(...rows.map(r=>r.gamma)).toFixed(0)}° to ${Math.max(...rows.map(r=>r.gamma)).toFixed(0)}°</div><div class="label">γ range</div></div>
  <div class="stat-box"><div class="value">${Math.min(...rows.map(r=>r.alpha)).toFixed(1)}–${Math.max(...rows.map(r=>r.alpha)).toFixed(1)}°</div><div class="label">α range</div></div>
  <div class="stat-box"><div class="value">${(Math.max(...rows.map(r=>r.CL/r.CD))).toFixed(2)}</div><div class="label">Peak L/D</div></div>
</div>

<div class="grid">

<!-- 1. V vs time -->
<div class="chart-box">
  <h2>Airspeed vs Time</h2>
  <canvas id="vTime"></canvas>
</div>

<!-- 2. α, γ, θ vs time -->
<div class="chart-box">
  <h2>Angles vs Time</h2>
  <canvas id="anglesTime"></canvas>
</div>

<!-- 3. V vs α — measured + trim curve -->
<div class="chart-box">
  <h2>α vs Airspeed (measured + trim prediction)</h2>
  <canvas id="vAlpha"></canvas>
</div>

<!-- 4. V vs γ — measured + trim curve -->
<div class="chart-box">
  <h2>γ vs Airspeed (measured + trim prediction)</h2>
  <canvas id="vGamma"></canvas>
</div>

<!-- 5. CL vs α — measured + model -->
<div class="chart-box">
  <h2>CL vs α (measured)</h2>
  <canvas id="clAlpha"></canvas>
</div>

<!-- 6. CL vs CD (drag polar) -->
<div class="chart-box">
  <h2>Drag Polar (CL vs CD)</h2>
  <canvas id="clCd"></canvas>
</div>

<!-- 7. Body rates vs time -->
<div class="chart-box full">
  <h2>Body Rates (p, q, r) vs Time</h2>
  <canvas id="ratesTime"></canvas>
</div>

<!-- 8. L/D vs V -->
<div class="chart-box full">
  <h2>L/D vs Airspeed</h2>
  <canvas id="ldV"></canvas>
</div>

</div>

<div class="legend-hint">
  Solid colored = GPS measured &nbsp;│&nbsp; White dashed = eigenvalue trim prediction &nbsp;│&nbsp; Click legends to toggle
  ${trimWindow ? ' &nbsp;│&nbsp; Bright dots = trim window (' + trimWindow[0] + '–' + trimWindow[1] + 's)' : ''}
</div>

<script>
const GPS = ${escapeJson(rows)};
const TRIM = ${escapeJson(trimCurve)};
const WINDOW = ${escapeJson(inWindow)};
const HAS_WINDOW = ${inWindow.length > 0};

const gridColor = 'rgba(255,255,255,0.08)';
const tickColor = '#888';
const gpsColor = '#42d4f4';
const gpsDim = 'rgba(66,212,244,0.3)';
const windowColor = '#fabed4';
const trimColor = '#ffffff';

function scatterOpts(xLabel, yLabel) {
  return {
    responsive: true,
    plugins: { legend: { labels: { color: tickColor, usePointStyle: true } } },
    scales: {
      x: { title: { display: true, text: xLabel, color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
      y: { title: { display: true, text: yLabel, color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
    }
  };
}

// 1. V vs time
new Chart(document.getElementById('vTime'), {
  type: 'scatter',
  data: { datasets: [
    { label: 'Airspeed', data: GPS.map(r => ({x: r.t, y: r.V})), borderColor: gpsColor, backgroundColor: gpsColor, pointRadius: 2, showLine: true, tension: 0.3 },
  ]},
  options: scatterOpts('Time [s]', 'V [m/s]'),
});

// 2. Angles vs time
new Chart(document.getElementById('anglesTime'), {
  type: 'scatter',
  data: { datasets: [
    { label: 'α', data: GPS.map(r => ({x: r.t, y: r.alpha})), borderColor: '#e6194b', backgroundColor: '#e6194b', pointRadius: 2, showLine: true, tension: 0.3 },
    { label: 'γ', data: GPS.map(r => ({x: r.t, y: r.gamma})), borderColor: '#4363d8', backgroundColor: '#4363d8', pointRadius: 2, showLine: true, tension: 0.3 },
    { label: 'θ', data: GPS.map(r => ({x: r.t, y: r.theta})), borderColor: '#3cb44b', backgroundColor: '#3cb44b', pointRadius: 2, showLine: true, tension: 0.3 },
  ]},
  options: scatterOpts('Time [s]', 'Angle [°]'),
});

// 3. V vs α
(function(){
  const ds = [
    { label: 'GPS (full)', data: GPS.map(r => ({x: r.V, y: r.alpha})), borderColor: gpsDim, backgroundColor: gpsDim, pointRadius: 3, showLine: false },
    { label: 'Trim prediction', data: TRIM.map(p => ({x: p.V, y: p.alpha_deg})), borderColor: trimColor, backgroundColor: trimColor, pointRadius: 0, showLine: true, borderDash: [6,4], tension: 0.3, borderWidth: 2 },
  ];
  if (HAS_WINDOW) ds.splice(1, 0, { label: 'GPS (trim window)', data: WINDOW.map(r => ({x: r.V, y: r.alpha})), borderColor: windowColor, backgroundColor: windowColor, pointRadius: 5, showLine: false });
  new Chart(document.getElementById('vAlpha'), { type: 'scatter', data: { datasets: ds }, options: scatterOpts('V [m/s]', 'α [°]') });
})();

// 4. V vs γ
(function(){
  const ds = [
    { label: 'GPS (full)', data: GPS.map(r => ({x: r.V, y: r.gamma})), borderColor: gpsDim, backgroundColor: gpsDim, pointRadius: 3, showLine: false },
    { label: 'Trim prediction', data: TRIM.map(p => ({x: p.V, y: p.gamma_deg})), borderColor: trimColor, backgroundColor: trimColor, pointRadius: 0, showLine: true, borderDash: [6,4], tension: 0.3, borderWidth: 2 },
  ];
  if (HAS_WINDOW) ds.splice(1, 0, { label: 'GPS (trim window)', data: WINDOW.map(r => ({x: r.V, y: r.gamma})), borderColor: windowColor, backgroundColor: windowColor, pointRadius: 5, showLine: false });
  new Chart(document.getElementById('vGamma'), { type: 'scatter', data: { datasets: ds }, options: scatterOpts('V [m/s]', 'γ [°]') });
})();

// 5. CL vs α
(function(){
  const ds = [
    { label: 'GPS (full)', data: GPS.map(r => ({x: r.alpha, y: r.CL})), borderColor: gpsDim, backgroundColor: gpsDim, pointRadius: 3, showLine: false },
    { label: 'Trim CL', data: TRIM.filter(p=>p.CL).map(p => ({x: p.alpha_deg, y: p.CL})), borderColor: trimColor, backgroundColor: trimColor, pointRadius: 0, showLine: true, borderDash: [6,4], tension: 0.3, borderWidth: 2 },
  ];
  if (HAS_WINDOW) ds.splice(1, 0, { label: 'GPS (trim window)', data: WINDOW.map(r => ({x: r.alpha, y: r.CL})), borderColor: windowColor, backgroundColor: windowColor, pointRadius: 5, showLine: false });
  new Chart(document.getElementById('clAlpha'), { type: 'scatter', data: { datasets: ds }, options: scatterOpts('α [°]', 'CL') });
})();

// 6. CL vs CD
(function(){
  const ds = [
    { label: 'GPS (full)', data: GPS.map(r => ({x: r.CD, y: r.CL})), borderColor: gpsDim, backgroundColor: gpsDim, pointRadius: 3, showLine: false },
    { label: 'Trim prediction', data: TRIM.filter(p=>p.CD).map(p => ({x: p.CD, y: p.CL})), borderColor: trimColor, backgroundColor: trimColor, pointRadius: 0, showLine: true, borderDash: [6,4], tension: 0.3, borderWidth: 2 },
  ];
  if (HAS_WINDOW) ds.splice(1, 0, { label: 'GPS (trim window)', data: WINDOW.map(r => ({x: r.CD, y: r.CL})), borderColor: windowColor, backgroundColor: windowColor, pointRadius: 5, showLine: false });
  new Chart(document.getElementById('clCd'), { type: 'scatter', data: { datasets: ds }, options: scatterOpts('CD', 'CL') });
})();

// 7. Body rates
new Chart(document.getElementById('ratesTime'), {
  type: 'scatter',
  data: { datasets: [
    { label: 'p (roll)', data: GPS.map(r => ({x: r.t, y: r.p})), borderColor: '#e6194b', backgroundColor: '#e6194b', pointRadius: 2, showLine: true, tension: 0.3 },
    { label: 'q (pitch)', data: GPS.map(r => ({x: r.t, y: r.q})), borderColor: '#3cb44b', backgroundColor: '#3cb44b', pointRadius: 2, showLine: true, tension: 0.3 },
    { label: 'r (yaw)', data: GPS.map(r => ({x: r.t, y: r.r})), borderColor: '#4363d8', backgroundColor: '#4363d8', pointRadius: 2, showLine: true, tension: 0.3 },
  ]},
  options: scatterOpts('Time [s]', 'Rate [°/s]'),
});

// 8. L/D vs V
(function(){
  const ds = [
    { label: 'GPS (full)', data: GPS.filter(r=>r.CD>0.01).map(r => ({x: r.V, y: r.CL/r.CD})), borderColor: gpsDim, backgroundColor: gpsDim, pointRadius: 3, showLine: false },
    { label: 'Trim prediction', data: TRIM.filter(p=>p.CD&&p.CD>0.01).map(p => ({x: p.V, y: p.CL/p.CD})), borderColor: trimColor, backgroundColor: trimColor, pointRadius: 0, showLine: true, borderDash: [6,4], tension: 0.3, borderWidth: 2 },
  ];
  if (HAS_WINDOW) ds.splice(1, 0, { label: 'GPS (trim window)', data: WINDOW.filter(r=>r.CD>0.01).map(r => ({x: r.V, y: r.CL/r.CD})), borderColor: windowColor, backgroundColor: windowColor, pointRadius: 5, showLine: false });
  new Chart(document.getElementById('ldV'), { type: 'scatter', data: { datasets: ds }, options: scatterOpts('V [m/s]', 'L/D') });
})();
</script>
</body>
</html>`
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const rawArgs = process.argv.slice(2)
  const flags = new Set(rawArgs.filter(a => a.startsWith('--')))
  const posArgs = rawArgs.filter(a => !a.startsWith('--'))

  // Parse --trim-window
  let trimWindow: [number, number] | undefined
  for (const arg of rawArgs) {
    if (arg.startsWith('--trim-window=')) {
      const parts = arg.slice('--trim-window='.length).split(',').map(Number)
      if (parts.length === 2) trimWindow = [parts[0], parts[1]]
    }
  }
  // Also check next-arg form: --trim-window 25,47
  const twIdx = rawArgs.indexOf('--trim-window')
  if (twIdx >= 0 && rawArgs[twIdx + 1]) {
    const parts = rawArgs[twIdx + 1].split(',').map(Number)
    if (parts.length === 2) trimWindow = [parts[0], parts[1]]
  }

  const csvPath = posArgs[0]
  const polarName = posArgs[1] ?? 'a5segments'

  if (!csvPath) {
    console.error('Usage: npx tsx scripts/gps-overlay.ts <csv-file> [polar] [--trim-window start,end]')
    console.error('Available polars:', Object.keys(POLARS).join(', '))
    process.exit(1)
  }

  const resolvedPath = path.resolve(csvPath)
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`)
    process.exit(1)
  }

  const polar = POLARS[polarName]
  if (!polar) {
    console.error(`Unknown polar: ${polarName}. Available: ${Object.keys(POLARS).join(', ')}`)
    process.exit(1)
  }

  const isWingsuit = polarName.startsWith('a5') || polarName === 'aurafive' || polarName === 'slicksin'

  // Parse CSV
  const { meta, rows } = parseCsv(resolvedPath)
  console.log(`📂 Loaded ${rows.length} samples from ${meta.date} (${meta.vehicle})`)
  console.log(`   V: ${rows[0].V.toFixed(1)}–${Math.max(...rows.map(r => r.V)).toFixed(1)} m/s`)
  console.log(`   Duration: ${(rows[rows.length - 1].t - rows[0].t).toFixed(1)}s at ${meta.gps_rate_hz} Hz`)

  // Compute trim curve
  console.log(`\n🔧 Computing trim curve for ${polarName}...`)
  const trimCurve = computeTrimCurve(polar, isWingsuit)
  console.log(`   ${trimCurve.length} converged trim points`)

  // Quick comparison: find GPS points closest to trim speeds
  if (trimWindow) {
    const windowRows = rows.filter(r => r.t >= trimWindow[0] && r.t <= trimWindow[1])
    console.log(`\n📊 Trim window (${trimWindow[0]}–${trimWindow[1]}s): ${windowRows.length} samples`)

    // Average the window
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
    const wV = avg(windowRows.map(r => r.V))
    const wAlpha = avg(windowRows.map(r => r.alpha))
    const wGamma = avg(windowRows.map(r => r.gamma))
    const wTheta = avg(windowRows.map(r => r.theta))
    const wQ = avg(windowRows.map(r => r.q))
    const wCL = avg(windowRows.map(r => r.CL))

    // Find closest trim point
    const closest = trimCurve.reduce((best, p) =>
      Math.abs(p.V - wV) < Math.abs(best.V - wV) ? p : best, trimCurve[0])

    console.log(`\n   ${''.padEnd(20)} ${'GPS avg'.padStart(10)} ${'Trim pred'.padStart(10)} ${'Δ'.padStart(8)}`)
    console.log(`   ${'─'.repeat(50)}`)
    console.log(`   ${'V [m/s]'.padEnd(20)} ${wV.toFixed(1).padStart(10)} ${closest.V.toFixed(1).padStart(10)} ${(wV - closest.V).toFixed(1).padStart(8)}`)
    console.log(`   ${'α [°]'.padEnd(20)} ${wAlpha.toFixed(1).padStart(10)} ${closest.alpha_deg.toFixed(1).padStart(10)} ${(wAlpha - closest.alpha_deg).toFixed(1).padStart(8)}`)
    console.log(`   ${'γ [°]'.padEnd(20)} ${wGamma.toFixed(1).padStart(10)} ${closest.gamma_deg.toFixed(1).padStart(10)} ${(wGamma - closest.gamma_deg).toFixed(1).padStart(8)}`)
    console.log(`   ${'θ [°]'.padEnd(20)} ${wTheta.toFixed(1).padStart(10)} ${closest.theta_deg.toFixed(1).padStart(10)} ${(wTheta - closest.theta_deg).toFixed(1).padStart(8)}`)
    console.log(`   ${'q [°/s]'.padEnd(20)} ${wQ.toFixed(1).padStart(10)} ${'0.0'.padStart(10)} ${wQ.toFixed(1).padStart(8)}`)
  }

  // Generate HTML
  if (!flags.has('--no-html')) {
    const resultsDir = path.join(path.dirname(resolvedPath), 'polar-visualizer', 'scripts', 'results')
    // Use the scripts/results directory
    const scriptDir = path.join(path.dirname(process.argv[1] ?? '.'), 'results')
    if (!fs.existsSync(scriptDir)) fs.mkdirSync(scriptDir, { recursive: true })

    const html = generateHtml(meta, rows, trimCurve, polarName, trimWindow)
    const htmlPath = path.join(scriptDir, `gps-overlay-${polarName}.html`)
    fs.writeFileSync(htmlPath, html)
    console.log(`\n📊 HTML report: ${htmlPath}`)
  }
}

main()
