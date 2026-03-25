/**
 * flysight-stability.ts — Stability mode extraction from raw FlySight GPS data.
 *
 * Reads FlySight TRACK.CSV directly via the GPS pipeline (SG smoothing, binary
 * search AOA, body rates, angular acceleration), then performs PSD + autocorrelation
 * mode extraction and eigenvalue prediction overlay.
 *
 * Usage:
 *   npx tsx scripts/flysight-stability.ts <track-csv> [--window start,end] [--polar a5segments]
 *
 * Examples:
 *   npx tsx scripts/flysight-stability.ts ../public/05-04-25/TRACK.CSV
 *   npx tsx scripts/flysight-stability.ts ../public/05-04-25/TRACK.CSV --window 15,60
 *   npx tsx scripts/flysight-stability.ts ../public/05-04-25/TRACK.CSV --window 15,60 --polar a5segments
 */

import * as fs from 'fs'
import * as path from 'path'
import { processGPSFile } from '../src/gps/gps-pipeline.ts'
import type { GPSPipelinePoint } from '../src/gps/types.ts'
import type { PolarEvaluator } from '../src/gps/wse.ts'
import { a5segmentsContinuous } from '../src/polar/polar-data.ts'
import { defaultControls, computeSegmentForce, computeWindFrameNED, sumAllSegments } from '../src/polar/aero-segment.ts'
import { computeCenterOfMass, computeInertia } from '../src/polar/inertia.ts'
import { findTrim } from './lib/trim-finder.ts'
import { numericalJacobian, eigenvalues, classifyModes, sortModes, nameModes } from './lib/linearize.ts'
import type { NaturalMode } from './lib/analysis-types.ts'

// ─── Config ─────────────────────────────────────────────────────────────────

interface EigenPrediction {
  airspeed_ms: number
  alpha_deg: number
  gamma_deg: number
  modes: NaturalMode[]
}

const R2D = 180 / Math.PI
const D2R = Math.PI / 180

// ─── Polar Evaluator (same as gps-polar-table.ts but standalone for scripts) ─

function buildPolarEvaluator(airspeed = 40, rho = 1.225): PolarEvaluator {
  const polar = a5segmentsContinuous
  const segments = polar.aeroSegments ?? []
  const controls = defaultControls()
  const massRef = 1.875
  const cgMeters = computeCenterOfMass(polar.massSegments ?? [], massRef, polar.m)
  const sRef = polar.s
  const beta_deg = 0

  return (alpha_deg: number) => {
    const q = 0.5 * rho * airspeed * airspeed
    const qS = q * sRef
    const segForces = segments.map(seg =>
      computeSegmentForce(seg, alpha_deg, beta_deg, controls, rho, airspeed)
    )
    const { windDir, liftDir, sideDir } = computeWindFrameNED(alpha_deg, beta_deg)
    const system = sumAllSegments(
      segments, segForces, cgMeters, polar.referenceLength,
      windDir, liftDir, sideDir, controls, massRef,
    )
    const totalLift = liftDir.x * system.force.x + liftDir.y * system.force.y + liftDir.z * system.force.z
    const totalDrag = -(windDir.x * system.force.x + windDir.y * system.force.y + windDir.z * system.force.z)
    return {
      cl: qS > 1e-10 ? totalLift / qS : 0,
      cd: qS > 1e-10 ? totalDrag / qS : 0,
    }
  }
}

// ─── Signal Processing (from gps-modes.ts) ──────────────────────────────────

function detrend(signal: number[], order = 5): number[] {
  const n = signal.length
  if (n < 2) return signal
  const x = signal.map((_, i) => 2 * i / (n - 1) - 1)
  const cols = order + 1
  const AtA: number[][] = Array.from({ length: cols }, () => new Array(cols).fill(0))
  const Aty: number[] = new Array(cols).fill(0)
  for (let i = 0; i < n; i++) {
    const basis: number[] = [1]
    for (let j = 1; j <= order; j++) basis.push(basis[j - 1] * x[i])
    for (let j = 0; j < cols; j++) {
      Aty[j] += basis[j] * signal[i]
      for (let k = 0; k < cols; k++) AtA[j][k] += basis[j] * basis[k]
    }
  }
  const aug = AtA.map((row, i) => [...row, Aty[i]])
  for (let col = 0; col < cols; col++) {
    let maxRow = col
    for (let row = col + 1; row < cols; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]
    const pivot = aug[col][col]
    if (Math.abs(pivot) < 1e-15) continue
    for (let j = col; j <= cols; j++) aug[col][j] /= pivot
    for (let row = 0; row < cols; row++) {
      if (row === col) continue
      const factor = aug[row][col]
      for (let j = col; j <= cols; j++) aug[row][j] -= factor * aug[col][j]
    }
  }
  const coeffs = aug.map(row => row[cols])
  return signal.map((v, i) => {
    let trend = 0; let xi = 1; const xn = x[i]
    for (let j = 0; j < cols; j++) { trend += coeffs[j] * xi; xi *= xn }
    return v - trend
  })
}

function hannWindow(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))))
}

function fft(signal: number[]): Array<[number, number]> {
  let n = 1
  while (n < signal.length) n *= 2
  const re = new Array(n).fill(0)
  const im = new Array(n).fill(0)
  for (let i = 0; i < signal.length; i++) re[i] = signal[i]
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    while (j & bit) { j ^= bit; bit >>= 1 }
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len *= 2) {
    const halfLen = len / 2
    const angle = -2 * Math.PI / len
    const wRe = Math.cos(angle), wIm = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0
      for (let j = 0; j < halfLen; j++) {
        const tRe = curRe * re[i + j + halfLen] - curIm * im[i + j + halfLen]
        const tIm = curRe * im[i + j + halfLen] + curIm * re[i + j + halfLen]
        re[i + j + halfLen] = re[i + j] - tRe
        im[i + j + halfLen] = im[i + j] - tIm
        re[i + j] += tRe; im[i + j] += tIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe; curRe = nextRe
      }
    }
  }
  return Array.from({ length: n }, (_, i) => [re[i], im[i]])
}

interface PsdResult { freqs: number[]; power: number[]; label: string; unit: string }

function computePsd(signal: number[], fs_hz: number, segmentLength?: number): PsdResult {
  const n = signal.length
  const segLen = segmentLength ?? Math.min(n, Math.max(32, Math.pow(2, Math.round(Math.log2(n / 2)))))
  const window = hannWindow(segLen)
  const windowPower = window.reduce((s, w) => s + w * w, 0)
  const hop = Math.floor(segLen / 2)
  const numSegments = Math.max(1, Math.floor((n - segLen) / hop) + 1)
  let nfft = 1
  while (nfft < segLen) nfft *= 2
  const psdBins = new Array(Math.floor(nfft / 2) + 1).fill(0)
  for (let seg = 0; seg < numSegments; seg++) {
    const start = seg * hop
    const windowed = new Array(nfft).fill(0)
    for (let i = 0; i < segLen && start + i < n; i++) windowed[i] = signal[start + i] * window[i]
    const fftResult = fft(windowed)
    for (let k = 0; k <= nfft / 2; k++) {
      const mag2 = fftResult[k][0] ** 2 + fftResult[k][1] ** 2
      const scale = k === 0 || k === nfft / 2 ? 1 : 2
      psdBins[k] += (scale * mag2) / (fs_hz * windowPower * numSegments)
    }
  }
  const freqs = psdBins.map((_, k) => k * fs_hz / nfft)
  return { freqs, power: psdBins, label: '', unit: '' }
}

interface Peak { freq_Hz: number; power: number; damping: number; period_s: number }

function findPeaks(freqs: number[], power: number[], minFreq = 0.02, maxFreq = 5): Peak[] {
  const peaks: Peak[] = []
  for (let i = 2; i < freqs.length - 2; i++) {
    if (freqs[i] < minFreq || freqs[i] > maxFreq) continue
    if (power[i] > power[i - 1] && power[i] > power[i + 1] && power[i] > power[i - 2] && power[i] > power[i + 2]) {
      // -3dB bandwidth estimate
      const halfPow = power[i] / 2
      let bwLo = freqs[i], bwHi = freqs[i]
      for (let j = i - 1; j >= 0; j--) { if (power[j] < halfPow) { bwLo = freqs[j]; break } }
      for (let j = i + 1; j < freqs.length; j++) { if (power[j] < halfPow) { bwHi = freqs[j]; break } }
      const bandwidth = bwHi - bwLo
      const damping = bandwidth / (2 * freqs[i])
      peaks.push({ freq_Hz: freqs[i], power: power[i], damping, period_s: 1 / freqs[i] })
    }
  }
  peaks.sort((a, b) => b.power - a.power)
  return peaks.slice(0, 8)
}

function autocorrelation(signal: number[], maxLag: number): number[] {
  const n = signal.length
  const mean = signal.reduce((s, v) => s + v, 0) / n
  const centered = signal.map(v => v - mean)
  const var0 = centered.reduce((s, v) => s + v * v, 0)
  if (var0 < 1e-15) return new Array(maxLag + 1).fill(0)
  const result: number[] = []
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i < n - lag; i++) sum += centered[i] * centered[i + lag]
    result.push(sum / var0)
  }
  return result
}

// ─── Eigenvalue Prediction ──────────────────────────────────────────────────

function computeEigenvaluePrediction(airspeed: number): EigenPrediction | null {
  const polar = a5segmentsContinuous
  const segments = polar.aeroSegments ?? []
  const massRef = polar.referenceLength ?? 1.875
  const controls = defaultControls()
  const cgMeters = polar.massSegments?.length
    ? computeCenterOfMass(polar.massSegments, massRef, polar.m)
    : { x: 0, y: 0, z: 0 }
  const inertia = polar.massSegments
    ? computeInertia(polar.inertiaMassSegments ?? polar.massSegments, massRef, polar.m)
    : { Ixx: 1, Iyy: 1, Izz: 1, Ixz: 0 }

  const config = {
    segments,
    controls,
    cgMeters,
    inertia,
    mass: polar.m,
    height: massRef,
    rho: 1.225,
  }

  const trim = findTrim(airspeed, config, { alphaGuess_deg: 10, thetaGuess_deg: -10 })
  if (!trim.converged) return null

  const J = numericalJacobian(trim.state, config)
  const eigs = eigenvalues(J)
  const modes = classifyModes(eigs)
  const sorted = sortModes(modes)
  const named = nameModes(sorted)

  return {
    airspeed_ms: airspeed,
    alpha_deg: trim.alpha_deg,
    gamma_deg: trim.gamma_deg,
    modes: named,
  }
}

// ─── HTML Report ────────────────────────────────────────────────────────────

function generateHTML(
  points: GPSPipelinePoint[],
  window: [number, number] | null,
  eigenPrediction: EigenPrediction | null,
  filename: string,
): string {
  const pts = window
    ? points.filter(p => p.processed.t >= window[0] && p.processed.t <= window[1])
    : points

  if (pts.length < 10) return '<html><body>Not enough data points in window</body></html>'

  const dt = pts.length > 1 ? (pts[pts.length - 1].processed.t - pts[0].processed.t) / (pts.length - 1) : 0.05
  const fs_hz = 1 / dt

  // Extract signals
  const t = pts.map(p => p.processed.t)
  const V = pts.map(p => p.processed.airspeed)
  const alpha = pts.map(p => p.aero.aoa * R2D)
  const phi = pts.map(p => p.aero.roll * R2D)
  const theta = pts.map(p => p.aero.theta * R2D)
  const psi = pts.map(p => ((p.aero.psi * R2D) % 360 + 360) % 360)
  const gamma = pts.map(p => p.aero.gamma * R2D)
  const p_rate = pts.map(p => p.bodyRates?.p ?? 0)
  const q_rate = pts.map(p => p.bodyRates?.q ?? 0)
  const r_rate = pts.map(p => p.bodyRates?.r ?? 0)

  // Compute means for summary
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
  const std = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) }

  // PSD on detrended signals
  const signals = [
    { data: q_rate, label: 'q (pitch rate)', unit: '°/s' },
    { data: p_rate, label: 'p (roll rate)', unit: '°/s' },
    { data: r_rate, label: 'r (yaw rate)', unit: '°/s' },
    { data: alpha, label: 'α (AOA)', unit: '°' },
    { data: phi, label: 'φ (bank)', unit: '°' },
    { data: V, label: 'V (airspeed)', unit: 'm/s' },
  ]

  const psdResults = signals.map(s => {
    const psd = computePsd(detrend(s.data), fs_hz)
    return { ...psd, label: s.label, unit: s.unit }
  })

  const allPeaks = psdResults.map(psd => ({
    label: psd.label,
    peaks: findPeaks(psd.freqs, psd.power),
  }))

  // Autocorrelation
  const maxLagSamples = Math.min(pts.length - 1, Math.round(fs_hz * 10))
  const acorrResults = signals.map(s => ({
    label: s.label,
    lags: Array.from({ length: maxLagSamples + 1 }, (_, i) => i / fs_hz),
    values: autocorrelation(detrend(s.data), maxLagSamples),
  }))

  // Eigenvalue markers for PSD overlay
  let eigenMarkers = ''
  if (eigenPrediction) {
    const longModes = eigenPrediction.modes.filter(m => m.name.includes('Short') || m.name.includes('Phugoid'))
    const latModes = eigenPrediction.modes.filter(m => m.name.includes('Dutch') || m.name.includes('Roll') || m.name.includes('Spiral'))
    eigenMarkers = JSON.stringify({ longitudinal: longModes, lateral: latModes })
  }

  // Build Chart.js datasets JSON
  const chartData = {
    timeSeries: {
      t,
      datasets: [
        { label: 'V (m/s)', data: V, color: 'rgba(100,180,255,0.8)' },
        { label: 'α (°)', data: alpha, color: 'rgba(255,140,80,0.8)' },
        { label: 'γ (°)', data: gamma, color: 'rgba(120,220,120,0.8)' },
        { label: 'φ (°)', data: phi, color: 'rgba(200,100,255,0.8)' },
        { label: 'θ (°)', data: theta, color: 'rgba(255,220,80,0.8)' },
      ],
    },
    rates: {
      t,
      datasets: [
        { label: 'p (°/s)', data: p_rate, color: 'rgba(100,180,255,0.8)' },
        { label: 'q (°/s)', data: q_rate, color: 'rgba(255,140,80,0.8)' },
        { label: 'r (°/s)', data: r_rate, color: 'rgba(120,220,120,0.8)' },
      ],
    },
    psd: psdResults.map(p => ({
      label: p.label,
      freqs: p.freqs.filter((_, i) => p.freqs[i] > 0.01 && p.freqs[i] < 5),
      power: p.power.filter((_, i) => p.freqs[i] > 0.01 && p.freqs[i] < 5),
    })),
    peaks: allPeaks,
    autocorr: acorrResults.map(a => ({
      label: a.label,
      lags: a.lags.slice(0, Math.min(a.lags.length, Math.round(fs_hz * 5))),
      values: a.values.slice(0, Math.min(a.values.length, Math.round(fs_hz * 5))),
    })),
  }

  // Summary stats
  const summary = {
    file: filename,
    window: window ? `${window[0]}–${window[1]}s` : 'full',
    duration: `${(pts[pts.length - 1].processed.t - pts[0].processed.t).toFixed(1)}s`,
    points: pts.length,
    sampleRate: `${fs_hz.toFixed(1)} Hz`,
    meanV: `${mean(V).toFixed(1)} m/s (${(mean(V) * 2.237).toFixed(0)} mph)`,
    meanAlpha: `${mean(alpha).toFixed(1)}°`,
    meanGamma: `${mean(gamma).toFixed(1)}°`,
    meanPhi: `${mean(phi).toFixed(1)}° ± ${std(phi).toFixed(1)}°`,
    stdP: `${std(p_rate).toFixed(2)} °/s`,
    stdQ: `${std(q_rate).toFixed(2)} °/s`,
    stdR: `${std(r_rate).toFixed(2)} °/s`,
  }

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>FlySight Stability — ${filename}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body { background: #1a1a2e; color: #e0e0e0; font-family: 'Courier New', monospace; margin: 20px; }
  h1 { color: #4fc3f7; margin-bottom: 5px; }
  h2 { color: #81d4fa; margin-top: 30px; }
  .summary { background: #16213e; padding: 15px; border-radius: 8px; margin: 15px 0; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .summary div { font-size: 13px; }
  .summary .label { color: #90a4ae; }
  .summary .value { color: #4fc3f7; font-weight: bold; }
  .chart-row { display: flex; gap: 20px; margin: 10px 0; flex-wrap: wrap; }
  .chart-box { flex: 1; min-width: 400px; height: 280px; background: #16213e; border-radius: 8px; padding: 10px; position: relative; }
  .chart-box canvas { position: absolute; top: 10px; left: 10px; right: 10px; bottom: 10px; }
  .peaks-table { border-collapse: collapse; margin: 10px 0; width: 100%; }
  .peaks-table th, .peaks-table td { padding: 6px 12px; text-align: left; border-bottom: 1px solid #2a2a4a; font-size: 13px; }
  .peaks-table th { color: #4fc3f7; }
  .eigen-tag { background: #e65100; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 8px; }
</style>
</head><body>

<h1>🐻‍❄️ FlySight Stability Analysis</h1>
<div style="color:#90a4ae; margin-bottom:20px;">${filename} — Polar Claw / a5segments model</div>

<div class="summary">
${Object.entries(summary).map(([k, v]) => `  <div><span class="label">${k}:</span> <span class="value">${v}</span></div>`).join('\n')}
</div>

${eigenPrediction ? `
<h2>Eigenvalue Prediction (V=${eigenPrediction.airspeed_ms.toFixed(0)} m/s, α=${eigenPrediction.alpha_deg.toFixed(1)}°, γ=${eigenPrediction.gamma_deg.toFixed(1)}°)</h2>
<table class="peaks-table">
<tr><th>Mode</th><th>Frequency (Hz)</th><th>Damping ζ</th><th>Time to Half (s)</th><th>Eigenvalue</th></tr>
${eigenPrediction.modes.map(m => {
  const t2h = m.stable ? m.timeToHalf_s.toFixed(2) : 'UNSTABLE'
  return `<tr><td>${m.name}</td><td>${m.frequency_Hz.toFixed(3)}</td><td>${m.dampingRatio.toFixed(3)}</td><td>${t2h}</td><td>${m.realPart.toFixed(3)} ± ${m.imagPart.toFixed(3)}i</td></tr>`
}).join('\n')}
</table>
` : ''}

<h2>Time Series</h2>
<div class="chart-row">
  <div class="chart-box"><canvas id="ch-states"></canvas></div>
  <div class="chart-box"><canvas id="ch-rates"></canvas></div>
</div>

<h2>Power Spectral Density</h2>
<div class="chart-row">
  <div class="chart-box"><canvas id="ch-psd-long"></canvas></div>
  <div class="chart-box"><canvas id="ch-psd-lat"></canvas></div>
</div>

<h2>Autocorrelation</h2>
<div class="chart-row">
  <div class="chart-box"><canvas id="ch-acorr-long"></canvas></div>
  <div class="chart-box"><canvas id="ch-acorr-lat"></canvas></div>
</div>

<h2>Detected Peaks</h2>
<table class="peaks-table">
<tr><th>Signal</th><th>Freq (Hz)</th><th>Period (s)</th><th>PSD Damping ζ</th><th>Power</th></tr>
<tbody id="peaks-body"></tbody>
</table>

<script>
const DATA = ${JSON.stringify(chartData)};
const EIGEN = ${eigenMarkers || 'null'};

// ─── Time Series ──────────────────────────────────────────
function makeTimeSeries(canvasId, group) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: group.datasets.map(ds => ({
        label: ds.label,
        data: group.t.map((t, i) => ({ x: t, y: ds.data[i] })),
        borderColor: ds.color,
        backgroundColor: 'transparent',
        pointRadius: 0,
        borderWidth: 1.2,
        showLine: true,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: '#ccc', font: { size: 11 } } } },
      scales: {
        x: { title: { display: true, text: 'Time (s)', color: '#90a4ae' }, grid: { color: 'rgba(60,60,100,0.3)' }, ticks: { color: '#90a4ae' } },
        y: { grid: { color: 'rgba(60,60,100,0.3)' }, ticks: { color: '#90a4ae' } },
      },
    },
  });
}
makeTimeSeries('ch-states', DATA.timeSeries);
makeTimeSeries('ch-rates', DATA.rates);

// ─── PSD ──────────────────────────────────────────────────
const PSD_COLORS = ['rgba(100,180,255,0.8)','rgba(255,140,80,0.8)','rgba(120,220,120,0.8)','rgba(200,100,255,0.8)','rgba(255,220,80,0.8)','rgba(255,100,100,0.8)'];
function makePsd(canvasId, indices) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  const datasets = indices.map((idx, di) => ({
    label: DATA.psd[idx].label,
    data: DATA.psd[idx].freqs.map((f, i) => ({ x: f, y: Math.log10(Math.max(1e-10, DATA.psd[idx].power[i])) })),
    borderColor: PSD_COLORS[di],
    backgroundColor: 'transparent',
    pointRadius: 0,
    borderWidth: 1.5,
    showLine: true,
  }));
  // Add eigenvalue vertical lines if available
  if (EIGEN) {
    const modes = canvasId.includes('long') ? (EIGEN.longitudinal || []) : (EIGEN.lateral || []);
    modes.forEach(m => {
      const freq = m.frequency_Hz;
      if (freq > 0.01 && freq < 5) {
        datasets.push({
          label: m.name + ' (model)',
          data: [{ x: freq, y: -8 }, { x: freq, y: 2 }],
          borderColor: 'rgba(233,69,96,0.7)',
          borderDash: [5, 3],
          pointRadius: 0,
          borderWidth: 2,
          showLine: true,
        });
      }
    });
  }
  new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: '#ccc', font: { size: 11 } } } },
      scales: {
        x: { title: { display: true, text: 'Frequency (Hz)', color: '#90a4ae' }, grid: { color: 'rgba(60,60,100,0.3)' }, ticks: { color: '#90a4ae' }, type: 'logarithmic', min: 0.02, max: 5 },
        y: { title: { display: true, text: 'log₁₀ PSD', color: '#90a4ae' }, grid: { color: 'rgba(60,60,100,0.3)' }, ticks: { color: '#90a4ae' } },
      },
    },
  });
}
makePsd('ch-psd-long', [0, 3, 5]);  // q, alpha, V
makePsd('ch-psd-lat', [1, 2, 4]);   // p, r, phi

// ─── Autocorrelation ──────────────────────────────────────
function makeAcorr(canvasId, indices) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: indices.map((idx, di) => ({
        label: DATA.autocorr[idx].label,
        data: DATA.autocorr[idx].lags.map((l, i) => ({ x: l, y: DATA.autocorr[idx].values[i] })),
        borderColor: PSD_COLORS[di],
        backgroundColor: 'transparent',
        pointRadius: 0,
        borderWidth: 1.2,
        showLine: true,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: '#ccc', font: { size: 11 } } } },
      scales: {
        x: { title: { display: true, text: 'Lag (s)', color: '#90a4ae' }, grid: { color: 'rgba(60,60,100,0.3)' }, ticks: { color: '#90a4ae' } },
        y: { title: { display: true, text: 'Autocorrelation', color: '#90a4ae' }, grid: { color: 'rgba(60,60,100,0.3)' }, ticks: { color: '#90a4ae' }, min: -1, max: 1 },
      },
    },
  });
}
makeAcorr('ch-acorr-long', [0, 3, 5]);
makeAcorr('ch-acorr-lat', [1, 2, 4]);

// ─── Peaks table ──────────────────────────────────────────
const tbody = document.getElementById('peaks-body');
DATA.peaks.forEach(group => {
  group.peaks.slice(0, 3).forEach(pk => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + group.label + '</td><td>' + pk.freq_Hz.toFixed(3) + '</td><td>' + pk.period_s.toFixed(2) + '</td><td>' + pk.damping.toFixed(3) + '</td><td>' + pk.power.toExponential(2) + '</td>';
    tbody.appendChild(tr);
  });
});
</script>
</body></html>`
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const fileArg = args.find(a => !a.startsWith('--'))
  if (!fileArg) {
    console.error('Usage: npx tsx scripts/flysight-stability.ts <track-csv> [--window start,end]')
    process.exit(1)
  }

  const filepath = path.resolve(fileArg)
  if (!fs.existsSync(filepath)) {
    console.error(`File not found: ${filepath}`)
    process.exit(1)
  }

  // Parse window arg
  let window: [number, number] | null = null
  const winArg = args.find(a => a.startsWith('--window'))
  if (winArg) {
    const idx = args.indexOf(winArg)
    const val = winArg.includes('=') ? winArg.split('=')[1] : args[idx + 1]
    if (val) {
      const [s, e] = val.split(',').map(Number)
      if (!isNaN(s) && !isNaN(e)) window = [s, e]
    }
  }

  console.log(`\n🐻‍❄️ FlySight Stability Analysis`)
  console.log(`   File: ${path.basename(filepath)}`)
  console.log(`   Window: ${window ? `${window[0]}–${window[1]}s` : 'auto (full flight)'}`)

  // Read and process through GPS pipeline
  const text = fs.readFileSync(filepath, 'utf-8')
  const evaluator = buildPolarEvaluator()

  const t0 = performance.now()
  const result = processGPSFile(text, {
    polarEvaluator: evaluator,
    pilotMass: 77.5,
    sRef: 2.0,
  })
  const elapsed = performance.now() - t0

  console.log(`   Processed: ${result.pointCount} points in ${elapsed.toFixed(0)}ms (${result.format})`)
  console.log(`   Duration: ${result.duration.toFixed(1)}s`)

  const pts = result.points
  if (pts.length < 10) {
    console.error('Not enough data points')
    process.exit(1)
  }

  // Auto-window: skip first 5s and last 5s if no window specified
  if (!window) {
    const tStart = pts[0].processed.t + 5
    const tEnd = pts[pts.length - 1].processed.t - 5
    if (tEnd > tStart + 10) window = [tStart, tEnd]
  }

  const winPts = window
    ? pts.filter(p => p.processed.t >= window![0] && p.processed.t <= window![1])
    : pts

  // Summary stats
  const meanV = winPts.reduce((s, p) => s + p.processed.airspeed, 0) / winPts.length
  const meanAlpha = winPts.reduce((s, p) => s + p.aero.aoa * R2D, 0) / winPts.length
  const meanGamma = winPts.reduce((s, p) => s + p.aero.gamma * R2D, 0) / winPts.length
  const meanPhi = winPts.reduce((s, p) => s + p.aero.roll * R2D, 0) / winPts.length

  console.log(`\n   Flight summary (window):`)
  console.log(`     V_mean  = ${meanV.toFixed(1)} m/s (${(meanV * 2.237).toFixed(0)} mph)`)
  console.log(`     α_mean  = ${meanAlpha.toFixed(1)}°`)
  console.log(`     γ_mean  = ${meanGamma.toFixed(1)}°`)
  console.log(`     φ_mean  = ${meanPhi.toFixed(1)}°`)

  // Eigenvalue prediction at mean airspeed
  console.log(`\n   Computing eigenvalue prediction at V=${meanV.toFixed(0)} m/s...`)
  const eigenPred = computeEigenvaluePrediction(meanV)
  if (eigenPred) {
    console.log(`   Trim: α=${eigenPred.alpha_deg.toFixed(1)}°, γ=${eigenPred.gamma_deg.toFixed(1)}°`)
    console.log(`\n   Predicted modes:`)
    for (const m of eigenPred.modes) {
      const t2h = m.stable ? m.timeToHalf_s.toFixed(2) + 's' : 'UNSTABLE'
      console.log(`     ${m.name.padEnd(20)} f=${m.frequency_Hz.toFixed(3)} Hz  ζ=${m.dampingRatio.toFixed(3)}  t½=${t2h}`)
    }
  } else {
    console.log(`   ⚠ Could not find trim at V=${meanV.toFixed(0)} m/s`)
  }

  // Generate HTML report
  const scriptDir = path.dirname(new URL(import.meta.url).pathname)
  const outDir = path.join(scriptDir, 'results')
  fs.mkdirSync(outDir, { recursive: true })
  const baseName = path.basename(path.dirname(filepath)) || 'flysight'
  const htmlPath = path.join(outDir, `${baseName}-stability.html`)

  const html = generateHTML(pts, window, eigenPred, path.basename(filepath))
  fs.writeFileSync(htmlPath, html)
  console.log(`\n   📊 HTML report: ${htmlPath}`)
}

main()
