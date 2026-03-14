/**
 * report-html.ts — Generate self-contained Chart.js HTML report.
 *
 * Produces a single .html file with embedded data and interactive plots:
 *   1. Root locus (σ vs ω) — eigenvalue plane
 *   2. Damping ratio vs airspeed
 *   3. Frequency vs airspeed
 *   4. Trim curves (α, θ, γ vs airspeed)
 *   5. Time-to-half vs airspeed
 *
 * If a baseline run is provided, overlays both as solid vs dashed.
 */

import type { AnalysisRun, SpeedPoint, RunComparison } from './analysis-types.ts'

const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js'

// ─── Color palette ──────────────────────────────────────────────────────────

const COLORS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231',
  '#911eb4', '#42d4f4', '#f032e6', '#bfef45',
  '#fabed4', '#469990',
]

const BASELINE_ALPHA = '66'  // 40% opacity hex suffix for baseline lines

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeJson(data: unknown): string {
  return JSON.stringify(data).replace(/<\/script/g, '<\\/script')
}

/** Filter to converged points and deduplicate conjugate modes */
function getConvergedPoints(run: AnalysisRun): SpeedPoint[] {
  return run.speeds.filter(sp => sp.converged)
}

/** Assign consistent color index to modes across speeds by sorting */
function getModeTraces(points: SpeedPoint[]): Map<string, Array<{ v: number, mode: import('./linearize.ts').NaturalMode }>> {
  // Collect all unique mode names across all speed points to get stable ordering
  const nameOrder: string[] = []
  for (const sp of points) {
    for (const m of sp.modes) {
      if (m.name && !nameOrder.includes(m.name)) nameOrder.push(m.name)
    }
  }

  const traces = new Map<string, Array<{ v: number, mode: import('./linearize.ts').NaturalMode }>>()
  for (const name of nameOrder) {
    traces.set(name, [])
  }

  for (const sp of points) {
    for (const m of sp.modes) {
      const key = m.name || 'Unknown'
      if (!traces.has(key)) traces.set(key, [])
      traces.get(key)!.push({ v: sp.airspeed_ms, mode: m })
    }
  }
  return traces
}

// ─── HTML Generation ────────────────────────────────────────────────────────

export function generateReport(current: AnalysisRun, baseline?: AnalysisRun): string {
  const title = baseline
    ? `Stability Analysis — ${current.polar} (vs baseline)`
    : `Stability Analysis — ${current.polar}`

  const currentPoints = getConvergedPoints(current)
  const baselinePoints = baseline ? getConvergedPoints(baseline) : []

  const currentTraces = getModeTraces(currentPoints)
  const baselineTraces = baseline ? getModeTraces(baselinePoints) : new Map()

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
  .trim-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .trim-table th, .trim-table td { padding: 6px 10px; text-align: right; font-size: 0.85em; border-bottom: 1px solid #2a2a4a; }
  .trim-table th { color: #888; font-weight: 500; }
  .trim-table td { color: #ddd; font-variant-numeric: tabular-nums; }
  .trim-table tr:hover td { background: #1e2d50; }
  .stable { color: #4ade80; }
  .unstable { color: #f87171; }
  .legend-hint { text-align: center; color: #666; font-size: 0.8em; margin-top: 16px; }
  ${baseline ? '.baseline-tag { color: #888; font-size: 0.75em; } .baseline-tag::before { content: "⬜ baseline "; } .current-tag { color: #eee; font-size: 0.75em; } .current-tag::before { content: "⬛ current "; }' : ''}
</style>
</head>
<body>
<h1>${title}</h1>
<div class="subtitle">
  Mass: ${current.mass_kg} kg &nbsp;│&nbsp; Ref: ${current.referenceLength_m} m &nbsp;│&nbsp;
  ${current.isWingsuit ? 'Wingsuit' : 'Canopy'} &nbsp;│&nbsp;
  ${current.timestamp}
  ${baseline ? ' &nbsp;│&nbsp; <span class="baseline-tag">Baseline: ' + baseline.timestamp + '</span>' : ''}
</div>

<div class="grid">

<!-- 1. Root Locus -->
<div class="chart-box">
  <h2>Root Locus (σ–ω plane)</h2>
  <canvas id="rootLocus"></canvas>
</div>

<!-- 2. Damping Ratio vs Airspeed -->
<div class="chart-box">
  <h2>Damping Ratio (ζ) vs Airspeed</h2>
  <canvas id="dampingChart"></canvas>
</div>

<!-- 3. Frequency vs Airspeed -->
<div class="chart-box">
  <h2>Natural Frequency vs Airspeed</h2>
  <canvas id="freqChart"></canvas>
</div>

<!-- 4. Time to Half vs Airspeed -->
<div class="chart-box">
  <h2>Time to Half Amplitude vs Airspeed</h2>
  <canvas id="t2hChart"></canvas>
</div>

<!-- 5. Trim Curves -->
<div class="chart-box">
  <h2>Trim Conditions vs Airspeed</h2>
  <canvas id="trimChart"></canvas>
</div>

<!-- 6. qDot (pendulum moment) -->
<div class="chart-box">
  <h2>Residual Pitch Moment (qDot) vs Airspeed</h2>
  <canvas id="qdotChart"></canvas>
</div>

<!-- 7. Mode Legend -->
<div class="chart-box full">
  <h2>Mode Legend</h2>
  ${generateModeLegend(currentPoints)}
</div>

<!-- 8. Trim Table -->
<div class="chart-box full">
  <h2>Trim Conditions Table</h2>
  ${generateTrimTable(currentPoints, baselinePoints)}
</div>

</div>

<div class="legend-hint">
  ${baseline ? 'Solid lines = current run &nbsp;│&nbsp; Dashed lines = baseline' : ''}
  &nbsp; Click legend entries to toggle &nbsp;│&nbsp; Hover for values
</div>

<script>
const CURRENT = ${escapeJson(currentPoints)};
const BASELINE = ${escapeJson(baselinePoints)};
const CURRENT_TRACES = ${escapeJson(Object.fromEntries(currentTraces))};
const BASELINE_TRACES = ${escapeJson(Object.fromEntries(baselineTraces))};
const COLORS = ${escapeJson(COLORS)};
const HAS_BASELINE = ${baseline ? 'true' : 'false'};

${chartScripts()}
</script>
</body>
</html>`
}

function generateModeLegend(points: SpeedPoint[]): string {
  // Collect unique mode names in order, with color assignment matching getModeTraces
  const nameOrder: string[] = []
  for (const sp of points) {
    for (const m of sp.modes) {
      if (m.name && !nameOrder.includes(m.name)) nameOrder.push(m.name)
    }
  }

  const descriptions: Record<string, string> = {
    'Short period': 'Fast pitch oscillation. Determines how quickly the vehicle responds to angle-of-attack changes.',
    'Phugoid': 'Slow speed/altitude exchange. Long-period oscillation trading kinetic ↔ potential energy.',
    'Dutch roll': 'Coupled yaw-roll oscillation. "Wagging" motion after lateral disturbances.',
    'Roll subsidence': 'Pure roll damping. How quickly a roll disturbance dies out (non-oscillatory).',
    'Yaw damping': 'Pure yaw damping. How quickly a yaw disturbance dies out (non-oscillatory).',
    'Spiral': 'Slow lateral divergence/convergence. Unstable spiral = turns tighten without pilot input.',
    'Lateral divergence': 'Fast lateral instability. Vehicle yaws/sideslips divergently — requires active pilot control.',
    'Heading': 'Neutral yaw mode (σ≈0). No restoring force to a heading — this is normal.',
    'Slow mode': 'Slow stable mode. Long time constant, minor dynamic significance.',
  }

  let rows = ''
  for (let i = 0; i < nameOrder.length; i++) {
    const name = nameOrder[i]
    const color = COLORS[i % COLORS.length]
    const desc = descriptions[name] ?? ''
    const type = ['Short period', 'Phugoid', 'Dutch roll'].includes(name) ? 'Oscillatory' : 'Real'
    rows += `<tr>
      <td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${color};vertical-align:middle;margin-right:6px"></span> ${name}</td>
      <td style="color:#aaa">${type}</td>
      <td style="color:#999;text-align:left">${desc}</td>
    </tr>`
  }

  return `<table class="trim-table">
    <thead><tr><th style="text-align:left">Mode</th><th style="text-align:left">Type</th><th style="text-align:left">Description</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

function generateTrimTable(current: SpeedPoint[], baseline: SpeedPoint[]): string {
  const baseMap = new Map(baseline.map(p => [p.airspeed_ms, p]))

  let rows = ''
  for (const sp of current) {
    const b = baseMap.get(sp.airspeed_ms)
    const delta = (cur: number, base: number | undefined, dec = 2) => {
      if (base === undefined) return ''
      const d = cur - base
      if (Math.abs(d) < 0.005) return ''
      const cls = d > 0 ? 'unstable' : 'stable'
      return ` <span class="${cls}" style="font-size:0.75em">(${d > 0 ? '+' : ''}${d.toFixed(dec)})</span>`
    }
    rows += `<tr>
      <td>${sp.airspeed_ms}</td>
      <td>${sp.airspeed_kmh.toFixed(1)}</td>
      <td>${sp.alpha_deg.toFixed(2)}${delta(sp.alpha_deg, b?.alpha_deg)}</td>
      <td>${sp.theta_deg.toFixed(2)}${delta(sp.theta_deg, b?.theta_deg)}</td>
      <td>${sp.gamma_deg.toFixed(2)}${delta(sp.gamma_deg, b?.gamma_deg)}</td>
      <td>${sp.qDot.toFixed(3)}${delta(sp.qDot, b?.qDot, 3)}</td>
      <td>${sp.residual.toExponential(1)}</td>
    </tr>`
  }

  return `<table class="trim-table">
    <thead><tr>
      <th>V [m/s]</th><th>V [km/h]</th><th>α [°]</th><th>θ [°]</th><th>γ [°]</th><th>qDot [rad/s²]</th><th>Residual</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

function chartScripts(): string {
  return `
// ─── Utilities ──────────────────────────────────────────────────────────────

function makeDatasets(tracesObj, colorsArr, dashed) {
  const datasets = [];
  let idx = 0;
  for (const [name, points] of Object.entries(tracesObj)) {
    const color = colorsArr[idx % colorsArr.length];
    datasets.push({
      label: (dashed ? '[baseline] ' : '') + name,
      data: points,
      borderColor: dashed ? color + '${BASELINE_ALPHA}' : color,
      backgroundColor: dashed ? color + '${BASELINE_ALPHA}' : color,
      borderDash: dashed ? [6, 4] : [],
      pointRadius: dashed ? 3 : 5,
      pointStyle: dashed ? 'triangle' : 'circle',
      tension: 0.3,
      hidden: dashed,  // baseline hidden by default, click legend to show
    });
    idx++;
  }
  return datasets;
}

const gridColor = 'rgba(255,255,255,0.08)';
const tickColor = '#888';

const defaultScales = {
  x: { grid: { color: gridColor }, ticks: { color: tickColor } },
  y: { grid: { color: gridColor }, ticks: { color: tickColor } },
};

// ─── 1. Root Locus ──────────────────────────────────────────────────────────

(function() {
  const datasets = [];
  let idx = 0;
  for (const [name, points] of Object.entries(CURRENT_TRACES)) {
    const color = COLORS[idx % COLORS.length];
    datasets.push({
      label: name,
      data: points.map(p => ({ x: p.mode.realPart, y: Math.abs(p.mode.imagPart) })),
      borderColor: color,
      backgroundColor: color,
      pointRadius: 6,
      showLine: true,
      tension: 0.3,
    });
    idx++;
  }

  if (HAS_BASELINE) {
    idx = 0;
    for (const [name, points] of Object.entries(BASELINE_TRACES)) {
      const color = COLORS[idx % COLORS.length] + '${BASELINE_ALPHA}';
      datasets.push({
        label: '[baseline] ' + name,
        data: points.map(p => ({ x: p.mode.realPart, y: Math.abs(p.mode.imagPart) })),
        borderColor: color,
        backgroundColor: color,
        borderDash: [6, 4],
        pointRadius: 4,
        pointStyle: 'triangle',
        showLine: true,
        tension: 0.3,
        hidden: true,
      });
      idx++;
    }
  }

  new Chart(document.getElementById('rootLocus'), {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: tickColor, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = ctx.raw;
              return ctx.dataset.label + ': σ=' + p.x.toFixed(3) + ', ω=' + p.y.toFixed(3);
            }
          }
        }
      },
      scales: {
        x: { title: { display: true, text: 'σ (real) [1/s]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
        y: { title: { display: true, text: '|ω| (imag) [rad/s]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor }, beginAtZero: true },
      },
      // Draw stability boundary (σ=0 line)
      annotation: { annotations: { stabilityLine: { type: 'line', xMin: 0, xMax: 0, borderColor: 'rgba(248,113,113,0.5)', borderWidth: 2, borderDash: [4,4] }}}
    }
  });
})();

// ─── 2. Damping Ratio vs Airspeed ───────────────────────────────────────────

(function() {
  const datasets = [];
  let idx = 0;
  for (const [name, points] of Object.entries(CURRENT_TRACES)) {
    const color = COLORS[idx % COLORS.length];
    datasets.push({
      label: name,
      data: points.map(p => ({ x: p.v, y: p.mode.dampingRatio })),
      borderColor: color, backgroundColor: color,
      pointRadius: 5, showLine: true, tension: 0.3,
    });
    idx++;
  }
  if (HAS_BASELINE) {
    idx = 0;
    for (const [name, points] of Object.entries(BASELINE_TRACES)) {
      const color = COLORS[idx % COLORS.length] + '${BASELINE_ALPHA}';
      datasets.push({
        label: '[baseline] ' + name,
        data: points.map(p => ({ x: p.v, y: p.mode.dampingRatio })),
        borderColor: color, backgroundColor: color, borderDash: [6,4],
        pointRadius: 3, pointStyle: 'triangle', showLine: true, tension: 0.3, hidden: true,
      });
      idx++;
    }
  }

  new Chart(document.getElementById('dampingChart'), {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: tickColor, usePointStyle: true } } },
      scales: {
        x: { title: { display: true, text: 'Airspeed [m/s]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
        y: { title: { display: true, text: 'ζ (damping ratio)', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
      }
    }
  });
})();

// ─── 3. Frequency vs Airspeed ───────────────────────────────────────────────

(function() {
  const datasets = [];
  let idx = 0;
  for (const [name, points] of Object.entries(CURRENT_TRACES)) {
    const color = COLORS[idx % COLORS.length];
    datasets.push({
      label: name,
      data: points.map(p => ({ x: p.v, y: p.mode.frequency_Hz })),
      borderColor: color, backgroundColor: color,
      pointRadius: 5, showLine: true, tension: 0.3,
    });
    idx++;
  }
  if (HAS_BASELINE) {
    idx = 0;
    for (const [name, points] of Object.entries(BASELINE_TRACES)) {
      const color = COLORS[idx % COLORS.length] + '${BASELINE_ALPHA}';
      datasets.push({
        label: '[baseline] ' + name,
        data: points.map(p => ({ x: p.v, y: p.mode.frequency_Hz })),
        borderColor: color, backgroundColor: color, borderDash: [6,4],
        pointRadius: 3, pointStyle: 'triangle', showLine: true, tension: 0.3, hidden: true,
      });
      idx++;
    }
  }

  new Chart(document.getElementById('freqChart'), {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: tickColor, usePointStyle: true } } },
      scales: {
        x: { title: { display: true, text: 'Airspeed [m/s]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
        y: { title: { display: true, text: 'Frequency [Hz]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor }, beginAtZero: true },
      }
    }
  });
})();

// ─── 4. Time to Half vs Airspeed ────────────────────────────────────────────

(function() {
  const datasets = [];
  let idx = 0;
  for (const [name, points] of Object.entries(CURRENT_TRACES)) {
    const color = COLORS[idx % COLORS.length];
    datasets.push({
      label: name,
      data: points.map(p => ({ x: p.v, y: Math.min(p.mode.timeToHalf_s, 30) })),  // cap at 30s for readability
      borderColor: color, backgroundColor: color,
      pointRadius: 5, showLine: true, tension: 0.3,
    });
    idx++;
  }
  if (HAS_BASELINE) {
    idx = 0;
    for (const [name, points] of Object.entries(BASELINE_TRACES)) {
      const color = COLORS[idx % COLORS.length] + '${BASELINE_ALPHA}';
      datasets.push({
        label: '[baseline] ' + name,
        data: points.map(p => ({ x: p.v, y: Math.min(p.mode.timeToHalf_s, 30) })),
        borderColor: color, backgroundColor: color, borderDash: [6,4],
        pointRadius: 3, pointStyle: 'triangle', showLine: true, tension: 0.3, hidden: true,
      });
      idx++;
    }
  }

  new Chart(document.getElementById('t2hChart'), {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: tickColor, usePointStyle: true } } },
      scales: {
        x: { title: { display: true, text: 'Airspeed [m/s]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
        y: { title: { display: true, text: 'T½ [s] (capped at 30)', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor }, beginAtZero: true },
      }
    }
  });
})();

// ─── 5. Trim Curves ─────────────────────────────────────────────────────────

(function() {
  const datasets = [
    { label: 'α (angle of attack)', data: CURRENT.map(p => ({x: p.airspeed_ms, y: p.alpha_deg})), borderColor: '#e6194b', backgroundColor: '#e6194b', pointRadius: 5, showLine: true, tension: 0.3 },
    { label: 'θ (pitch angle)', data: CURRENT.map(p => ({x: p.airspeed_ms, y: p.theta_deg})), borderColor: '#3cb44b', backgroundColor: '#3cb44b', pointRadius: 5, showLine: true, tension: 0.3 },
    { label: 'γ (flight path)', data: CURRENT.map(p => ({x: p.airspeed_ms, y: p.gamma_deg})), borderColor: '#4363d8', backgroundColor: '#4363d8', pointRadius: 5, showLine: true, tension: 0.3 },
  ];

  if (HAS_BASELINE && BASELINE.length) {
    datasets.push(
      { label: '[baseline] α', data: BASELINE.map(p => ({x: p.airspeed_ms, y: p.alpha_deg})), borderColor: '#e6194b${BASELINE_ALPHA}', backgroundColor: '#e6194b${BASELINE_ALPHA}', borderDash: [6,4], pointRadius: 3, pointStyle: 'triangle', showLine: true, tension: 0.3, hidden: true },
      { label: '[baseline] θ', data: BASELINE.map(p => ({x: p.airspeed_ms, y: p.theta_deg})), borderColor: '#3cb44b${BASELINE_ALPHA}', backgroundColor: '#3cb44b${BASELINE_ALPHA}', borderDash: [6,4], pointRadius: 3, pointStyle: 'triangle', showLine: true, tension: 0.3, hidden: true },
      { label: '[baseline] γ', data: BASELINE.map(p => ({x: p.airspeed_ms, y: p.gamma_deg})), borderColor: '#4363d8${BASELINE_ALPHA}', backgroundColor: '#4363d8${BASELINE_ALPHA}', borderDash: [6,4], pointRadius: 3, pointStyle: 'triangle', showLine: true, tension: 0.3, hidden: true },
    );
  }

  new Chart(document.getElementById('trimChart'), {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: tickColor, usePointStyle: true } } },
      scales: {
        x: { title: { display: true, text: 'Airspeed [m/s]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
        y: { title: { display: true, text: 'Angle [°]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
      }
    }
  });
})();

// ─── 6. qDot vs Airspeed ────────────────────────────────────────────────────

(function() {
  const datasets = [
    { label: 'qDot (current)', data: CURRENT.map(p => ({x: p.airspeed_ms, y: p.qDot})), borderColor: '#f58231', backgroundColor: '#f58231', pointRadius: 5, showLine: true, tension: 0.3 },
  ];

  if (HAS_BASELINE && BASELINE.length) {
    datasets.push({
      label: 'qDot (baseline)', data: BASELINE.map(p => ({x: p.airspeed_ms, y: p.qDot})),
      borderColor: '#f58231${BASELINE_ALPHA}', backgroundColor: '#f58231${BASELINE_ALPHA}',
      borderDash: [6,4], pointRadius: 3, pointStyle: 'triangle', showLine: true, tension: 0.3, hidden: true,
    });
  }

  new Chart(document.getElementById('qdotChart'), {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: tickColor, usePointStyle: true } } },
      scales: {
        x: { title: { display: true, text: 'Airspeed [m/s]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
        y: { title: { display: true, text: 'qDot [rad/s²]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
      }
    }
  });
})();
`
}
