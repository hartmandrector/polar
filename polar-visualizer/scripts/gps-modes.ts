/**
 * gps-modes.ts — Extract dynamic stability modes from GPS flight data.
 *
 * Computes power spectral density (PSD) of body rates and state variables
 * to identify natural mode frequencies and damping ratios.
 *
 * Usage:
 *   npx tsx scripts/gps-modes.ts <csv-file> [--window start,end] [--polar a5segments]
 *
 * Examples:
 *   npx tsx scripts/gps-modes.ts ../flight.csv --window 10,46
 *   npx tsx scripts/gps-modes.ts ../flight.csv --window 10,46 --polar a5segments
 *
 * Outputs:
 *   Terminal:  Detected peaks and mode candidates
 *   HTML:      scripts/results/gps-modes.html (PSD plots + autocorrelation)
 */

import * as fs from 'fs'
import * as path from 'path'

// ─── Types ──────────────────────────────────────────────────────────────────

interface GpsRow {
  t: number; V: number; alpha: number; gamma: number; phi: number
  theta: number; psi: number; p: number; q: number; r: number
  CL: number; CD: number
}

interface Metadata {
  vehicle: string; date: string; pilot_mass_kg: number
  wing_area_m2: number; gps_rate_hz: number; notes: string
}

interface PsdResult {
  freqs: number[]     // Hz
  power: number[]     // power spectral density
  label: string
  unit: string
}

interface Peak {
  freq_Hz: number
  power: number
  bandwidth_Hz: number  // -3dB bandwidth
  damping: number       // ζ ≈ bandwidth / (2 * freq)
  period_s: number
}

interface AutocorrResult {
  lags: number[]        // seconds
  values: number[]      // normalized autocorrelation
  label: string
}

interface DampingEstimate {
  freq_Hz: number
  damping: number       // ζ from envelope decay
  timeToHalf_s: number
  method: string
}

// ─── CSV Parser ─────────────────────────────────────────────────────────────

function parseCsv(filepath: string): { meta: Metadata, rows: GpsRow[] } {
  const text = fs.readFileSync(filepath, 'utf-8')
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  const metaMap: Record<string, string> = {}
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('#')) {
      const m = line.match(/^#\s*(\w+):\s*(.+)$/)
      if (m) metaMap[m[1]] = m[2]
    } else {
      dataLines.push(line)
    }
  }

  const header = dataLines[0].split(',').map(h => h.trim())
  const rows: GpsRow[] = []
  for (let i = 1; i < dataLines.length; i++) {
    const vals = dataLines[i].split(',')
    if (vals.length < header.length) continue
    const row: Record<string, number> = {}
    for (let j = 0; j < header.length; j++) row[header[j]] = parseFloat(vals[j])
    rows.push({
      t: row['t'] ?? 0, V: row['V'] ?? 0, alpha: row['alpha'] ?? 0,
      gamma: row['gamma'] ?? 0, phi: row['phi'] ?? 0, theta: row['theta'] ?? 0,
      psi: row['psi'] ?? 0, p: row['p'] ?? 0, q: row['q'] ?? 0, r: row['r'] ?? 0,
      CL: row['CL'] ?? 0, CD: row['CD'] ?? 0,
    })
  }

  return {
    meta: {
      vehicle: metaMap['vehicle'] ?? 'unknown',
      date: metaMap['date'] ?? 'unknown',
      pilot_mass_kg: parseFloat(metaMap['pilot_mass_kg'] ?? '77.5'),
      wing_area_m2: parseFloat(metaMap['wing_area_m2'] ?? '2.0'),
      gps_rate_hz: parseFloat(metaMap['gps_rate_hz'] ?? '5'),
      notes: metaMap['notes'] ?? '',
    },
    rows,
  }
}

// ─── Signal Processing ──────────────────────────────────────────────────────

/** Remove polynomial trend from signal (default order 5 for maneuver removal) */
function detrend(signal: number[], order = 5): number[] {
  const n = signal.length
  if (n < 2) return signal

  // Normalize x to [-1, 1] for numerical stability
  const x = signal.map((_, i) => 2 * i / (n - 1) - 1)

  // Build Vandermonde matrix and solve via normal equations
  // A^T A c = A^T y
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

  // Solve via Gaussian elimination
  const aug = AtA.map((row, i) => [...row, Aty[i]])
  for (let col = 0; col < cols; col++) {
    // Pivot
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

  // Subtract polynomial fit
  return signal.map((v, i) => {
    let trend = 0
    let xi = 1
    const xn = x[i]
    for (let j = 0; j < cols; j++) { trend += coeffs[j] * xi; xi *= xn }
    return v - trend
  })
}

/** Hann window */
function hannWindow(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))))
}

/** FFT (radix-2 Cooley-Tukey, zero-padded to next power of 2) */
function fft(signal: number[]): Array<[number, number]> {
  // Zero-pad to next power of 2
  let n = 1
  while (n < signal.length) n *= 2
  const re = new Array(n).fill(0)
  const im = new Array(n).fill(0)
  for (let i = 0; i < signal.length; i++) re[i] = signal[i]

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    while (j & bit) { j ^= bit; bit >>= 1 }
    j ^= bit
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]]
    }
  }

  // Butterfly computation
  for (let len = 2; len <= n; len *= 2) {
    const halfLen = len / 2
    const angle = -2 * Math.PI / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0
      for (let j = 0; j < halfLen; j++) {
        const tRe = curRe * re[i + j + halfLen] - curIm * im[i + j + halfLen]
        const tIm = curRe * im[i + j + halfLen] + curIm * re[i + j + halfLen]
        re[i + j + halfLen] = re[i + j] - tRe
        im[i + j + halfLen] = im[i + j] - tIm
        re[i + j] += tRe
        im[i + j] += tIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }

  return Array.from({ length: n }, (_, i) => [re[i], im[i]] as [number, number])
}

/** Compute one-sided PSD using Welch's method (50% overlap) */
function computePsd(signal: number[], fs_hz: number, segmentLength?: number): PsdResult & { freqs: number[], power: number[] } {
  const n = signal.length
  const segLen = segmentLength ?? Math.min(n, Math.max(32, Math.pow(2, Math.round(Math.log2(n / 2)))))
  const window = hannWindow(segLen)
  const windowPower = window.reduce((s, w) => s + w * w, 0)

  const hop = Math.floor(segLen / 2)  // 50% overlap
  const numSegments = Math.max(1, Math.floor((n - segLen) / hop) + 1)

  // Zero-padded FFT length
  let nfft = 1
  while (nfft < segLen) nfft *= 2

  const psdBins = new Array(Math.floor(nfft / 2) + 1).fill(0)

  for (let seg = 0; seg < numSegments; seg++) {
    const start = seg * hop
    const windowed = new Array(nfft).fill(0)
    for (let i = 0; i < segLen && start + i < n; i++) {
      windowed[i] = signal[start + i] * window[i]
    }

    const fftResult = fft(windowed)

    // Accumulate one-sided PSD
    for (let k = 0; k <= nfft / 2; k++) {
      const mag2 = fftResult[k][0] ** 2 + fftResult[k][1] ** 2
      const scale = (k === 0 || k === nfft / 2) ? 1 : 2  // one-sided doubling
      psdBins[k] += scale * mag2 / (fs_hz * windowPower)
    }
  }

  // Average
  for (let k = 0; k < psdBins.length; k++) psdBins[k] /= numSegments

  const freqs = Array.from({ length: psdBins.length }, (_, k) => k * fs_hz / nfft)

  return { freqs, power: psdBins, label: '', unit: '' }
}

/** Find peaks in PSD (local maxima above threshold) */
function findPeaks(freqs: number[], power: number[], minFreq = 0.01, maxFreq = 2.5): Peak[] {
  const peaks: Peak[] = []
  const maxPower = Math.max(...power.filter((_, i) => freqs[i] >= minFreq && freqs[i] <= maxFreq))
  const threshold = maxPower * 0.01  // 1% of max — permissive, let classification filter

  for (let i = 2; i < power.length - 2; i++) {
    if (freqs[i] < minFreq || freqs[i] > maxFreq) continue
    if (power[i] < threshold) continue

    // Local max (compare with 2 neighbors each side)
    if (power[i] > power[i - 1] && power[i] > power[i + 1] &&
        power[i] > power[i - 2] && power[i] > power[i + 2]) {
      // Estimate -3dB bandwidth
      const halfPower = power[i] / 2
      let bwLow = freqs[i], bwHigh = freqs[i]
      for (let j = i - 1; j >= 0; j--) {
        if (power[j] < halfPower) { bwLow = freqs[j]; break }
      }
      for (let j = i + 1; j < power.length; j++) {
        if (power[j] < halfPower) { bwHigh = freqs[j]; break }
      }
      const bandwidth = bwHigh - bwLow

      peaks.push({
        freq_Hz: freqs[i],
        power: power[i],
        bandwidth_Hz: bandwidth,
        damping: bandwidth / (2 * freqs[i]),  // ζ ≈ Δf / (2·f₀)
        period_s: 1 / freqs[i],
      })
    }
  }

  // Sort by power descending
  return peaks.sort((a, b) => b.power - a.power)
}

/** Normalized autocorrelation */
function autocorrelation(signal: number[], maxLag: number): AutocorrResult & { lags: number[], values: number[] } {
  const n = signal.length
  const mean = signal.reduce((s, v) => s + v, 0) / n
  const centered = signal.map(v => v - mean)
  const var0 = centered.reduce((s, v) => s + v * v, 0)

  const numLags = Math.min(maxLag, n - 1)
  const lags: number[] = []
  const values: number[] = []

  for (let lag = 0; lag <= numLags; lag++) {
    let sum = 0
    for (let i = 0; i < n - lag; i++) sum += centered[i] * centered[i + lag]
    lags.push(lag)
    values.push(var0 > 1e-10 ? sum / var0 : 0)
  }

  return { lags, values, label: '' }
}

/** Estimate damping from autocorrelation envelope decay */
function estimateDampingFromAutocorr(acf: number[], fs_hz: number): DampingEstimate[] {
  const estimates: DampingEstimate[] = []

  // Find zero crossings to identify oscillation period
  const crossings: number[] = []
  for (let i = 1; i < acf.length; i++) {
    if (acf[i - 1] * acf[i] < 0) crossings.push(i - 1 + Math.abs(acf[i - 1]) / Math.abs(acf[i] - acf[i - 1]))
  }

  if (crossings.length >= 4) {
    // Period from average spacing of zero crossings (half-period between consecutive)
    const halfPeriods: number[] = []
    for (let i = 1; i < crossings.length; i++) halfPeriods.push((crossings[i] - crossings[i - 1]) / fs_hz)
    const avgHalfPeriod = halfPeriods.reduce((s, v) => s + v, 0) / halfPeriods.length
    const period = avgHalfPeriod * 2
    const freq = 1 / period

    // Envelope decay: find local maxima of |acf|
    const envPeaks: Array<{ lag: number, val: number }> = []
    for (let i = 1; i < acf.length - 1; i++) {
      if (Math.abs(acf[i]) > Math.abs(acf[i - 1]) && Math.abs(acf[i]) > Math.abs(acf[i + 1]) && Math.abs(acf[i]) > 0.05) {
        envPeaks.push({ lag: i, val: Math.abs(acf[i]) })
      }
    }

    if (envPeaks.length >= 2) {
      // Fit exponential decay: |r(τ)| ∝ e^(-σ·τ)
      // ln(|r|) = -σ·τ + c  →  linear regression
      const x = envPeaks.map(p => p.lag / fs_hz)
      const y = envPeaks.map(p => Math.log(p.val))
      const n = x.length
      let sx = 0, sy = 0, sxx = 0, sxy = 0
      for (let i = 0; i < n; i++) {
        sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]
      }
      const sigma = -(n * sxy - sx * sy) / (n * sxx - sx * sx)  // decay rate

      if (sigma > 0) {
        const omega_n = 2 * Math.PI * freq
        const zeta = sigma / omega_n

        estimates.push({
          freq_Hz: freq,
          damping: zeta,
          timeToHalf_s: Math.LN2 / sigma,
          method: 'autocorrelation envelope',
        })
      }
    }
  }

  return estimates
}

// ─── Mode Classification ────────────────────────────────────────────────────

interface ModeCandidate {
  name: string
  signal: string
  freq_Hz: number
  period_s: number
  damping: number
  timeToHalf_s: number
  confidence: string   // high/medium/low
  method: string
}

function classifyModes(
  psdResults: Map<string, { psd: PsdResult, peaks: Peak[] }>,
  acfDamping: Map<string, DampingEstimate[]>,
): ModeCandidate[] {
  const candidates: ModeCandidate[] = []

  // Short period: look in q(t) for peaks 0.5–3 Hz
  const qPeaks = psdResults.get('q')?.peaks.filter(p => p.freq_Hz > 0.3 && p.freq_Hz < 3.0) ?? []
  if (qPeaks.length > 0) {
    const best = qPeaks[0]
    const acfEst = acfDamping.get('q')?.find(e => Math.abs(e.freq_Hz - best.freq_Hz) < 0.3)
    candidates.push({
      name: 'Short period',
      signal: 'q (pitch rate)',
      freq_Hz: best.freq_Hz,
      period_s: best.period_s,
      damping: acfEst?.damping ?? best.damping,
      timeToHalf_s: acfEst?.timeToHalf_s ?? (best.damping > 0 ? Math.LN2 / (best.damping * 2 * Math.PI * best.freq_Hz) : Infinity),
      confidence: qPeaks[0].power > (psdResults.get('q')?.peaks[0]?.power ?? 0) * 0.3 ? 'high' : 'medium',
      method: acfEst ? 'PSD peak + ACF envelope' : 'PSD half-power bandwidth',
    })
  }

  // Phugoid: look in V(t) for peaks 0.01–0.2 Hz
  const vPeaks = psdResults.get('V')?.peaks.filter(p => p.freq_Hz > 0.01 && p.freq_Hz < 0.2) ?? []
  if (vPeaks.length > 0) {
    const best = vPeaks[0]
    const acfEst = acfDamping.get('V')?.find(e => Math.abs(e.freq_Hz - best.freq_Hz) < 0.05)
    candidates.push({
      name: 'Phugoid',
      signal: 'V (airspeed)',
      freq_Hz: best.freq_Hz,
      period_s: best.period_s,
      damping: acfEst?.damping ?? best.damping,
      timeToHalf_s: acfEst?.timeToHalf_s ?? (best.damping > 0 ? Math.LN2 / (best.damping * 2 * Math.PI * best.freq_Hz) : Infinity),
      confidence: 'medium',
      method: acfEst ? 'PSD peak + ACF envelope' : 'PSD half-power bandwidth',
    })
  }

  // Dutch roll: look in r(t) and p(t) for peaks 0.1–1.0 Hz
  const rPeaks = psdResults.get('r')?.peaks.filter(p => p.freq_Hz > 0.05 && p.freq_Hz < 1.5) ?? []
  const pPeaks = psdResults.get('p')?.peaks.filter(p => p.freq_Hz > 0.05 && p.freq_Hz < 1.5) ?? []

  // Check for correlated peaks in r and p (dutch roll shows in both)
  for (const rPeak of rPeaks.slice(0, 3)) {
    const matchingP = pPeaks.find(pp => Math.abs(pp.freq_Hz - rPeak.freq_Hz) < 0.1)
    if (matchingP) {
      const acfEst = acfDamping.get('r')?.find(e => Math.abs(e.freq_Hz - rPeak.freq_Hz) < 0.15)
      candidates.push({
        name: 'Dutch roll',
        signal: 'r (yaw) + p (roll)',
        freq_Hz: (rPeak.freq_Hz + matchingP.freq_Hz) / 2,
        period_s: 1 / ((rPeak.freq_Hz + matchingP.freq_Hz) / 2),
        damping: acfEst?.damping ?? rPeak.damping,
        timeToHalf_s: acfEst?.timeToHalf_s ?? Infinity,
        confidence: 'high',
        method: 'Correlated PSD peaks (r+p)' + (acfEst ? ' + ACF' : ''),
      })
      break  // take best match only
    }
  }

  // If no correlated dutch roll, check r alone
  if (!candidates.find(c => c.name === 'Dutch roll') && rPeaks.length > 0) {
    const best = rPeaks[0]
    // Don't double-count as short period
    if (!candidates.find(c => Math.abs(c.freq_Hz - best.freq_Hz) < 0.15)) {
      const acfEst = acfDamping.get('r')?.find(e => Math.abs(e.freq_Hz - best.freq_Hz) < 0.15)
      candidates.push({
        name: 'Dutch roll (tentative)',
        signal: 'r (yaw)',
        freq_Hz: best.freq_Hz,
        period_s: best.period_s,
        damping: acfEst?.damping ?? best.damping,
        timeToHalf_s: acfEst?.timeToHalf_s ?? Infinity,
        confidence: 'low',
        method: 'Single PSD peak in r',
      })
    }
  }

  // Also report any alpha peaks (may show short period from different angle)
  const alphaPeaks = psdResults.get('alpha')?.peaks.filter(p => p.freq_Hz > 0.3 && p.freq_Hz < 3.0) ?? []
  if (alphaPeaks.length > 0) {
    const best = alphaPeaks[0]
    // Check if it matches existing short period
    const existing = candidates.find(c => c.name === 'Short period')
    if (existing && Math.abs(existing.freq_Hz - best.freq_Hz) < 0.3) {
      existing.confidence = 'high'
      existing.signal += ' + α'
    } else if (!existing) {
      candidates.push({
        name: 'Short period',
        signal: 'α (angle of attack)',
        freq_Hz: best.freq_Hz,
        period_s: best.period_s,
        damping: best.damping,
        timeToHalf_s: best.damping > 0 ? Math.LN2 / (best.damping * 2 * Math.PI * best.freq_Hz) : Infinity,
        confidence: 'medium',
        method: 'PSD peak in α',
      })
    }
  }

  return candidates.sort((a, b) => b.freq_Hz - a.freq_Hz)
}

// ─── HTML Report ────────────────────────────────────────────────────────────

const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js'

function escapeJson(data: unknown): string {
  return JSON.stringify(data).replace(/<\/script/g, '<\\/script')
}

function generateHtml(
  meta: Metadata,
  rows: GpsRow[],
  psdMap: Map<string, { psd: PsdResult, peaks: Peak[] }>,
  acfMap: Map<string, AutocorrResult>,
  modeCandidates: ModeCandidate[],
  eigenModes?: Array<{ name: string, freq_Hz: number, damping: number }>,
): string {
  const title = `GPS Mode Analysis — ${meta.vehicle} ${meta.date}`

  // Prepare data for charts
  const psdData: Record<string, { freqs: number[], power: number[], peaks: Peak[] }> = {}
  for (const [key, val] of psdMap) {
    psdData[key] = { freqs: val.psd.freqs, power: val.psd.power, peaks: val.peaks }
  }

  const acfData: Record<string, { lags: number[], values: number[] }> = {}
  for (const [key, val] of acfMap) {
    acfData[key] = { lags: val.lags.map(l => l / meta.gps_rate_hz), values: val.values }
  }

  const signalColors: Record<string, string> = {
    q: '#3cb44b', V: '#42d4f4', alpha: '#e6194b',
    p: '#f58231', r: '#4363d8', phi: '#f032e6',
    theta: '#bfef45', gamma: '#469990',
  }

  const signalLabels: Record<string, string> = {
    q: 'q (pitch rate)', V: 'V (airspeed)', alpha: 'α (AOA)',
    p: 'p (roll rate)', r: 'r (yaw rate)', phi: 'φ (bank)',
    theta: 'θ (pitch)', gamma: 'γ (flight path)',
  }

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
  .mode-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .mode-table th, .mode-table td { padding: 8px 12px; text-align: right; font-size: 0.85em; border-bottom: 1px solid #2a2a4a; }
  .mode-table th { color: #888; font-weight: 500; text-align: left; }
  .mode-table td { color: #ddd; font-variant-numeric: tabular-nums; }
  .mode-table td:first-child, .mode-table th:first-child { text-align: left; }
  .mode-table tr:hover td { background: #1e2d50; }
  .conf-high { color: #4ade80; } .conf-medium { color: #fbbf24; } .conf-low { color: #f87171; }
  .eigen-row td { color: #888; font-style: italic; }
</style>
</head>
<body>
<h1>${title}</h1>
<div class="subtitle">
  ${meta.date} &nbsp;│&nbsp; ${meta.gps_rate_hz} Hz &nbsp;│&nbsp;
  ${rows.length} samples (${((rows[rows.length-1].t - rows[0].t)).toFixed(1)}s) &nbsp;│&nbsp;
  V: ${Math.min(...rows.map(r=>r.V)).toFixed(0)}–${Math.max(...rows.map(r=>r.V)).toFixed(0)} m/s
</div>

<div class="grid">

<!-- Mode Candidates Table -->
<div class="chart-box full">
  <h2>Detected Modes</h2>
  <table class="mode-table">
    <thead><tr>
      <th>Mode</th><th>Signal</th><th style="text-align:right">f [Hz]</th><th style="text-align:right">T [s]</th>
      <th style="text-align:right">ζ</th><th style="text-align:right">T½ [s]</th>
      <th>Confidence</th><th>Method</th>
    </tr></thead>
    <tbody>
    ${modeCandidates.map(m => `<tr>
      <td><strong>${m.name}</strong></td>
      <td>${m.signal}</td>
      <td style="text-align:right">${m.freq_Hz.toFixed(3)}</td>
      <td style="text-align:right">${m.period_s.toFixed(2)}</td>
      <td style="text-align:right">${m.damping.toFixed(3)}</td>
      <td style="text-align:right">${m.timeToHalf_s < 100 ? m.timeToHalf_s.toFixed(2) : '∞'}</td>
      <td class="conf-${m.confidence}">${m.confidence}</td>
      <td style="color:#888">${m.method}</td>
    </tr>`).join('\n')}
    ${eigenModes ? eigenModes.map(m => `<tr class="eigen-row">
      <td>${m.name} (model)</td><td>eigenvalue prediction</td>
      <td style="text-align:right">${m.freq_Hz.toFixed(3)}</td>
      <td style="text-align:right">${m.freq_Hz > 0 ? (1/m.freq_Hz).toFixed(2) : '∞'}</td>
      <td style="text-align:right">${m.damping.toFixed(3)}</td>
      <td style="text-align:right">—</td>
      <td style="color:#888">—</td><td style="color:#666">eigenvalue analysis</td>
    </tr>`).join('\n') : ''}
    </tbody>
  </table>
</div>

<!-- PSD: Longitudinal -->
<div class="chart-box">
  <h2>PSD — Longitudinal (q, V, α)</h2>
  <canvas id="psdLon"></canvas>
</div>

<!-- PSD: Lateral -->
<div class="chart-box">
  <h2>PSD — Lateral (p, r, φ)</h2>
  <canvas id="psdLat"></canvas>
</div>

<!-- Autocorrelation: q -->
<div class="chart-box">
  <h2>Autocorrelation — q (pitch rate)</h2>
  <canvas id="acfQ"></canvas>
</div>

<!-- Autocorrelation: r -->
<div class="chart-box">
  <h2>Autocorrelation — r (yaw rate)</h2>
  <canvas id="acfR"></canvas>
</div>

<!-- Autocorrelation: V -->
<div class="chart-box">
  <h2>Autocorrelation — V (airspeed)</h2>
  <canvas id="acfV"></canvas>
</div>

<!-- Autocorrelation: p -->
<div class="chart-box">
  <h2>Autocorrelation — p (roll rate)</h2>
  <canvas id="acfP"></canvas>
</div>

<!-- Time series for reference -->
<div class="chart-box full">
  <h2>Body Rates — Time Series (analysis window)</h2>
  <canvas id="timeSeries"></canvas>
</div>

</div>

<script>
const PSD = ${escapeJson(psdData)};
const ACF = ${escapeJson(acfData)};
const GPS = ${escapeJson(rows)};
const MODES = ${escapeJson(modeCandidates)};
const COLORS = ${escapeJson(signalColors)};
const LABELS = ${escapeJson(signalLabels)};

const gridColor = 'rgba(255,255,255,0.08)';
const tickColor = '#888';

function psdChart(canvasId, signals) {
  const datasets = [];
  for (const sig of signals) {
    if (!PSD[sig]) continue;
    datasets.push({
      label: LABELS[sig] || sig,
      data: PSD[sig].freqs.map((f, i) => ({x: f, y: 10 * Math.log10(Math.max(PSD[sig].power[i], 1e-20))})),
      borderColor: COLORS[sig] || '#fff',
      backgroundColor: 'transparent',
      pointRadius: 0, showLine: true, borderWidth: 1.5,
    });
    // Mark peaks
    for (const pk of PSD[sig].peaks) {
      datasets.push({
        label: sig + ' peak ' + pk.freq_Hz.toFixed(2) + ' Hz',
        data: [{x: pk.freq_Hz, y: 10 * Math.log10(Math.max(pk.power, 1e-20))}],
        borderColor: COLORS[sig] || '#fff',
        backgroundColor: COLORS[sig] || '#fff',
        pointRadius: 8, pointStyle: 'triangle', showLine: false,
      });
    }
  }

  // Add vertical lines for detected modes
  for (const mode of MODES) {
    datasets.push({
      label: mode.name + ' (' + mode.freq_Hz.toFixed(2) + ' Hz)',
      data: [{x: mode.freq_Hz, y: -80}, {x: mode.freq_Hz, y: 40}],
      borderColor: 'rgba(255,255,255,0.3)', borderDash: [4,4],
      pointRadius: 0, showLine: true, borderWidth: 1,
    });
  }

  new Chart(document.getElementById(canvasId), {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: tickColor, usePointStyle: true, font: { size: 10 } } } },
      scales: {
        x: { title: { display: true, text: 'Frequency [Hz]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor }, min: 0, max: 2.5 },
        y: { title: { display: true, text: 'PSD [dB]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
      },
    },
  });
}

function acfChart(canvasId, sig) {
  if (!ACF[sig]) return;
  new Chart(document.getElementById(canvasId), {
    type: 'scatter',
    data: { datasets: [{
      label: LABELS[sig] || sig,
      data: ACF[sig].lags.map((l, i) => ({x: l, y: ACF[sig].values[i]})),
      borderColor: COLORS[sig] || '#fff', backgroundColor: 'transparent',
      pointRadius: 0, showLine: true, borderWidth: 1.5,
    }]},
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: tickColor } } },
      scales: {
        x: { title: { display: true, text: 'Lag [s]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
        y: { title: { display: true, text: 'Autocorrelation', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor }, min: -1, max: 1 },
      },
    },
  });
}

psdChart('psdLon', ['q', 'V', 'alpha']);
psdChart('psdLat', ['p', 'r', 'phi']);
acfChart('acfQ', 'q');
acfChart('acfR', 'r');
acfChart('acfV', 'V');
acfChart('acfP', 'p');

// Time series
new Chart(document.getElementById('timeSeries'), {
  type: 'scatter',
  data: { datasets: [
    { label: 'p (roll)', data: GPS.map(r => ({x: r.t, y: r.p})), borderColor: COLORS.p, pointRadius: 0, showLine: true, borderWidth: 1.5 },
    { label: 'q (pitch)', data: GPS.map(r => ({x: r.t, y: r.q})), borderColor: COLORS.q, pointRadius: 0, showLine: true, borderWidth: 1.5 },
    { label: 'r (yaw)', data: GPS.map(r => ({x: r.t, y: r.r})), borderColor: COLORS.r, pointRadius: 0, showLine: true, borderWidth: 1.5 },
  ]},
  options: {
    responsive: true,
    plugins: { legend: { labels: { color: tickColor, usePointStyle: true } } },
    scales: {
      x: { title: { display: true, text: 'Time [s]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
      y: { title: { display: true, text: 'Rate [°/s]', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
    },
  },
});
</script>
</body>
</html>`
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const rawArgs = process.argv.slice(2)
  const posArgs = rawArgs.filter(a => !a.startsWith('--'))

  // Parse --window
  let window: [number, number] | undefined
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--window' && rawArgs[i + 1]) {
      const parts = rawArgs[i + 1].split(',').map(Number)
      if (parts.length === 2) window = [parts[0], parts[1]]
    }
  }

  // Parse --polar for eigenvalue comparison
  let polarName: string | undefined
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--polar' && rawArgs[i + 1]) polarName = rawArgs[i + 1]
  }

  const csvPath = posArgs[0]
  if (!csvPath) {
    console.error('Usage: npx tsx scripts/gps-modes.ts <csv-file> [--window start,end] [--polar name]')
    process.exit(1)
  }

  const resolvedPath = path.resolve(csvPath)
  if (!fs.existsSync(resolvedPath)) { console.error(`File not found: ${resolvedPath}`); process.exit(1) }

  const { meta, rows: allRows } = parseCsv(resolvedPath)

  // Apply window
  const rows = window
    ? allRows.filter(r => r.t >= window![0] && r.t <= window![1])
    : allRows

  console.log(`📂 Loaded ${allRows.length} total samples, using ${rows.length} ${window ? `(window ${window[0]}–${window[1]}s)` : '(full)'}`)
  console.log(`   ${meta.gps_rate_hz} Hz, V: ${Math.min(...rows.map(r => r.V)).toFixed(1)}–${Math.max(...rows.map(r => r.V)).toFixed(1)} m/s`)

  const fs_hz = meta.gps_rate_hz

  // Extract signals and detrend
  const signals: Record<string, number[]> = {
    q: detrend(rows.map(r => r.q)),
    V: detrend(rows.map(r => r.V)),
    alpha: detrend(rows.map(r => r.alpha)),
    p: detrend(rows.map(r => r.p)),
    r: detrend(rows.map(r => r.r)),
    phi: detrend(rows.map(r => r.phi)),
    theta: detrend(rows.map(r => r.theta)),
    gamma: detrend(rows.map(r => r.gamma)),
  }

  // Compute PSD and find peaks
  console.log('\n📊 Power Spectral Density analysis:')
  const psdMap = new Map<string, { psd: PsdResult, peaks: Peak[] }>()
  for (const [name, sig] of Object.entries(signals)) {
    const psd = computePsd(sig, fs_hz)
    psd.label = name
    const peaks = findPeaks(psd.freqs, psd.power)
    psdMap.set(name, { psd, peaks })

    if (peaks.length > 0) {
      console.log(`   ${name.padEnd(6)} peaks: ${peaks.slice(0, 3).map(p => `${p.freq_Hz.toFixed(3)} Hz (ζ≈${p.damping.toFixed(2)})`).join(', ')}`)
    }
  }

  // Compute autocorrelation + damping estimates
  console.log('\n📈 Autocorrelation damping estimates:')
  const acfMap = new Map<string, AutocorrResult>()
  const acfDampingMap = new Map<string, DampingEstimate[]>()

  for (const name of ['q', 'V', 'p', 'r', 'alpha', 'phi']) {
    const sig = signals[name]
    const maxLagSamples = Math.min(sig.length - 1, Math.floor(fs_hz * 15))  // up to 15s lag
    const acf = autocorrelation(sig, maxLagSamples)
    acf.label = name
    acfMap.set(name, acf)

    const dampEst = estimateDampingFromAutocorr(acf.values, fs_hz)
    acfDampingMap.set(name, dampEst)

    if (dampEst.length > 0) {
      console.log(`   ${name.padEnd(6)} → f=${dampEst[0].freq_Hz.toFixed(3)} Hz, ζ=${dampEst[0].damping.toFixed(3)}, T½=${dampEst[0].timeToHalf_s.toFixed(2)}s`)
    }
  }

  // Classify modes
  const modeCandidates = classifyModes(psdMap, acfDampingMap)

  console.log('\n🎯 Detected stability modes:')
  console.log(`   ${'Mode'.padEnd(22)} ${'f [Hz]'.padStart(8)} ${'T [s]'.padStart(8)} ${'ζ'.padStart(6)} ${'T½ [s]'.padStart(8)} ${'Confidence'.padStart(10)}`)
  console.log(`   ${'─'.repeat(66)}`)
  for (const m of modeCandidates) {
    console.log(`   ${m.name.padEnd(22)} ${m.freq_Hz.toFixed(3).padStart(8)} ${m.period_s.toFixed(2).padStart(8)} ${m.damping.toFixed(3).padStart(6)} ${(m.timeToHalf_s < 100 ? m.timeToHalf_s.toFixed(2) : '∞').padStart(8)} ${m.confidence.padStart(10)}`)
  }

  // Load eigenvalue predictions for comparison if polar specified
  let eigenModes: Array<{ name: string, freq_Hz: number, damping: number }> | undefined
  if (polarName) {
    const latestPath = path.join(path.dirname(process.argv[1] ?? '.'), 'results', `${polarName}-latest.json`)
    if (fs.existsSync(latestPath)) {
      const run = JSON.parse(fs.readFileSync(latestPath, 'utf-8'))
      // Find speed point closest to mean GPS speed
      const meanV = rows.reduce((s, r) => s + r.V, 0) / rows.length
      const closest = run.speeds.reduce((best: Record<string, unknown>, sp: Record<string, unknown>) =>
        Math.abs((sp['airspeed_ms'] as number) - meanV) < Math.abs((best['airspeed_ms'] as number) - meanV) ? sp : best,
        run.speeds[0])

      if (closest && (closest as Record<string, unknown>)['modes']) {
        eigenModes = ((closest as Record<string, unknown>)['modes'] as Array<Record<string, unknown>>)
          .filter((m: Record<string, unknown>) => (m['name'] as string) && (m['name'] as string) !== 'Heading')
          .map((m: Record<string, unknown>) => ({
            name: m['name'] as string,
            freq_Hz: m['frequency_Hz'] as number,
            damping: m['dampingRatio'] as number,
          }))

        console.log(`\n📐 Eigenvalue predictions (${polarName} at ${(closest as Record<string, unknown>)['airspeed_ms']} m/s):`)
        for (const m of eigenModes) {
          console.log(`   ${m.name.padEnd(22)} ${m.freq_Hz.toFixed(3).padStart(8)}    ζ=${m.damping.toFixed(3)}`)
        }
      }
    } else {
      console.warn(`\n⚠️  No eigenvalue results found for ${polarName}. Run eigenvalue-analysis.ts first.`)
    }
  }

  // Generate HTML
  const scriptDir = path.join(path.dirname(process.argv[1] ?? '.'), 'results')
  if (!fs.existsSync(scriptDir)) fs.mkdirSync(scriptDir, { recursive: true })

  const html = generateHtml(meta, rows, psdMap, acfMap, modeCandidates, eigenModes)
  const htmlPath = path.join(scriptDir, 'gps-modes.html')
  fs.writeFileSync(htmlPath, html)
  console.log(`\n📊 HTML report: ${htmlPath}`)
}

main()
