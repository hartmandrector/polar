/**
 * eigenvalue-analysis.ts — Natural mode analysis for Polar vehicles.
 *
 * Usage:
 *   npx tsx scripts/eigenvalue-analysis.ts [polar] [airspeed_ms] [flags]
 *
 * Examples:
 *   npx tsx scripts/eigenvalue-analysis.ts ibexul 12
 *   npx tsx scripts/eigenvalue-analysis.ts a5segments            # sweep
 *   npx tsx scripts/eigenvalue-analysis.ts a5segments --save-baseline
 *   npx tsx scripts/eigenvalue-analysis.ts a5segments --compare
 *
 * Flags:
 *   --save-baseline   Save current run as baseline JSON
 *   --compare         Compare against saved baseline (terminal + HTML overlay)
 *   --no-html         Skip HTML report generation
 *   --no-print        Skip terminal output
 *
 * Outputs:
 *   Terminal:  Mode tables (always, unless --no-print)
 *   JSON:      scripts/results/<polar>-latest.json (always)
 *   HTML:      scripts/results/<polar>-report.html (unless --no-html)
 *   Baseline:  scripts/results/<polar>-baseline.json (with --save-baseline)
 */

import * as fs from 'fs'
import * as path from 'path'
import { ibexulContinuous, aurafiveContinuous, a5segmentsContinuous, slicksinContinuous } from '../src/polar/polar-data.ts'
import type { ContinuousPolar, SegmentControls } from '../src/polar/continuous-polar.ts'
import type { SimConfig } from '../src/polar/sim-state.ts'
import { computeInertia, computeCenterOfMass, ZERO_INERTIA } from '../src/polar/inertia.ts'
import { defaultControls } from '../src/polar/aero-segment.ts'
import { findTrim } from './lib/trim-finder.ts'
import { numericalJacobian, eigenvalues, classifyModes, sortModes, STATE_NAMES } from './lib/linearize.ts'
import type { AnalysisRun, SpeedPoint } from './lib/analysis-types.ts'
import { generateReport } from './lib/report-html.ts'

// ─── Polar Registry ─────────────────────────────────────────────────────────

const POLARS: Record<string, ContinuousPolar> = {
  ibexul: ibexulContinuous,
  aurafive: aurafiveContinuous,
  a5segments: a5segmentsContinuous,
  slicksin: slicksinContinuous,
}

// ─── Build SimConfig from a ContinuousPolar ─────────────────────────────────

function buildConfig(polar: ContinuousPolar, controls?: Partial<SegmentControls>): SimConfig {
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
    controls: { ...defaultControls(), ...controls },
    cgMeters,
    inertia,
    mass: polar.m,
    height: massRef,
    rho: 1.225,
  }
}

// ─── Formatting ─────────────────────────────────────────────────────────────

function fmt(n: number, width = 10, dec = 4): string {
  return n.toFixed(dec).padStart(width)
}

function printMatrix(name: string, M: number[][]): void {
  console.log(`\n${name} (${M.length}×${M[0].length}):`)
  const header = '          ' + STATE_NAMES.map(n => n.padStart(10)).join('')
  console.log(header)
  for (let i = 0; i < M.length; i++) {
    const row = STATE_NAMES[i].padStart(8) + '  ' + M[i].map(v => fmt(v)).join('')
    console.log(row)
  }
}

// ─── Analysis Core ──────────────────────────────────────────────────────────

function analyzeSpeed(V: number, config: SimConfig, isWingsuit: boolean, includeMatrix: boolean): SpeedPoint {
  const trimOpts = isWingsuit
    ? { alphaGuess_deg: 10, thetaGuess_deg: -10 }
    : { alphaGuess_deg: 10, thetaGuess_deg: -30 }

  const trim = findTrim(V, config, trimOpts)

  if (!trim.converged) {
    return {
      airspeed_ms: V,
      airspeed_kmh: V * 3.6,
      airspeed_mph: V * 2.237,
      converged: false,
      residual: trim.residual,
      alpha_deg: trim.alpha_deg,
      theta_deg: trim.theta_deg,
      gamma_deg: trim.gamma_deg,
      qDot: trim.qDot,
      modes: [],
    }
  }

  const A = numericalJacobian(trim.state, config)
  const eigs = eigenvalues(A)
  const modes = sortModes(classifyModes(eigs))
  // Filter out conjugate duplicates
  const uniqueModes = modes.filter(m => m.imagPart >= -1e-6)

  return {
    airspeed_ms: V,
    airspeed_kmh: V * 3.6,
    airspeed_mph: V * 2.237,
    converged: true,
    residual: trim.residual,
    alpha_deg: trim.alpha_deg,
    theta_deg: trim.theta_deg,
    gamma_deg: trim.gamma_deg,
    qDot: trim.qDot,
    modes: uniqueModes,
    A: includeMatrix ? A : undefined,
  }
}

// ─── Terminal Printing ──────────────────────────────────────────────────────

function printSpeedPoint(sp: SpeedPoint, showMatrix: boolean, baseline?: SpeedPoint): void {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  Airspeed: ${sp.airspeed_ms} m/s (${sp.airspeed_kmh.toFixed(1)} km/h, ${sp.airspeed_mph.toFixed(1)} mph)`)
  console.log(`${'═'.repeat(60)}`)

  if (!sp.converged) {
    console.log(`  ⚠️  Trim did not converge (residual: ${sp.residual.toExponential(2)})`)
    console.log(`      Best guess: α=${sp.alpha_deg.toFixed(2)}°, θ=${sp.theta_deg.toFixed(2)}°`)
    return
  }

  // Trim conditions
  const d = (cur: number, base: number | undefined, dec = 2): string => {
    if (base === undefined) return ''
    const diff = cur - base
    if (Math.abs(diff) < Math.pow(10, -dec)) return ''
    return ` (${diff > 0 ? '+' : ''}${diff.toFixed(dec)})`
  }

  console.log(`\n  Trim: α = ${sp.alpha_deg.toFixed(2)}°${d(sp.alpha_deg, baseline?.alpha_deg)}, θ = ${sp.theta_deg.toFixed(2)}°${d(sp.theta_deg, baseline?.theta_deg)}`)
  console.log(`        γ = ${sp.gamma_deg.toFixed(2)}°${d(sp.gamma_deg, baseline?.gamma_deg)} (flight path)`)
  console.log(`        qDot = ${sp.qDot.toFixed(3)}${d(sp.qDot, baseline?.qDot, 3)} rad/s² (pendulum moment)`)
  console.log(`        Residual: ${sp.residual.toExponential(2)}`)

  if (showMatrix && sp.A) {
    printMatrix('State-Space A Matrix', sp.A)
  }

  // Mode table
  console.log(`\n  Natural Modes:`)
  console.log(`  ${'─'.repeat(56)}`)
  console.log(`  ${'Mode'.padEnd(6)} ${'σ [1/s]'.padStart(10)} ${'ω [rad/s]'.padStart(10)} ${'f [Hz]'.padStart(8)} ${'ζ'.padStart(6)} ${'T½ [s]'.padStart(8)} ${'Stable'.padStart(7)}`)
  console.log(`  ${'─'.repeat(56)}`)

  for (const m of sp.modes) {
    const typeStr = m.imagPart > 1e-6 ? 'osc' : 'real'
    const stableStr = m.stable ? '  ✓' : '  ✗'
    const t2h = m.timeToHalf_s < 1000 ? m.timeToHalf_s.toFixed(2) : '   ∞'

    console.log(`  ${typeStr.padEnd(6)} ${fmt(m.realPart, 10, 4)} ${fmt(m.imagPart, 10, 4)} ${fmt(m.frequency_Hz, 8, 3)} ${fmt(m.dampingRatio, 6, 3)} ${t2h.padStart(8)} ${stableStr}`)
  }
}

// ─── File I/O ───────────────────────────────────────────────────────────────

function resultsDir(): string {
  // __dirname equivalent for ESM — works with tsx
  const scriptDir = path.dirname(process.argv[1] ?? '.')
  const dir = path.join(scriptDir, 'results')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function saveJson(run: AnalysisRun, filename: string): string {
  const dir = resultsDir()
  const filepath = path.join(dir, filename)
  fs.writeFileSync(filepath, JSON.stringify(run, null, 2))
  return filepath
}

function loadJson(filename: string): AnalysisRun | null {
  const filepath = path.join(resultsDir(), filename)
  if (!fs.existsSync(filepath)) return null
  return JSON.parse(fs.readFileSync(filepath, 'utf-8')) as AnalysisRun
}

function saveHtml(html: string, filename: string): string {
  const dir = resultsDir()
  const filepath = path.join(dir, filename)
  fs.writeFileSync(filepath, html)
  return filepath
}

function getGitHash(): string | undefined {
  try {
    const cp = require('child_process') as { execSync: (cmd: string, opts: { encoding: string }) => string }
    return cp.execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return undefined
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const rawArgs = process.argv.slice(2)

  // Parse flags
  const flags = new Set(rawArgs.filter(a => a.startsWith('--')))
  const posArgs = rawArgs.filter(a => !a.startsWith('--'))

  const saveBaseline = flags.has('--save-baseline')
  const compare = flags.has('--compare')
  const noHtml = flags.has('--no-html')
  const noPrint = flags.has('--no-print')

  const polarName = posArgs[0] ?? 'ibexul'
  const specificSpeed = posArgs[1] ? parseFloat(posArgs[1]) : null

  const polar = POLARS[polarName]
  if (!polar) {
    console.error(`Unknown polar: ${polarName}. Available: ${Object.keys(POLARS).join(', ')}`)
    process.exit(1)
  }

  const isWingsuit = polarName.startsWith('a5') || polarName === 'aurafive' || polarName === 'slicksin'
  const defaultSpeeds = isWingsuit
    ? [25, 30, 35, 40, 45, 50, 55]
    : [8, 10, 12, 14, 16, 18, 20]
  const speeds = specificSpeed ? [specificSpeed] : defaultSpeeds

  const config = buildConfig(polar)

  // ── Run analysis ──
  const run: AnalysisRun = {
    polar: polarName,
    mass_kg: polar.m,
    referenceLength_m: polar.referenceLength ?? 1.875,
    isWingsuit,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    commitHash: getGitHash(),
    speeds: [],
  }

  for (const V of speeds) {
    run.speeds.push(analyzeSpeed(V, config, isWingsuit, specificSpeed !== null))
  }

  // ── Load baseline for comparison ──
  let baseline: AnalysisRun | null = null
  if (compare) {
    baseline = loadJson(`${polarName}-baseline.json`)
    if (!baseline) {
      console.warn(`⚠️  No baseline found for ${polarName}. Run with --save-baseline first.`)
    }
  }

  // ── Terminal output ──
  if (!noPrint) {
    console.log(`╔══════════════════════════════════════════════════════════════╗`)
    console.log(`║  Eigenvalue / Natural Mode Analysis — ${polarName.padEnd(22)} ║`)
    console.log(`║  Mass: ${polar.m} kg  │  Ref: ${(polar.referenceLength ?? 1.875).toFixed(3)} m${' '.repeat(24)}║`)
    if (baseline) {
      console.log(`║  Comparing against baseline: ${baseline.timestamp.padEnd(30)} ║`)
    }
    console.log(`╚══════════════════════════════════════════════════════════════╝`)

    const baseMap = new Map(baseline?.speeds.map(sp => [sp.airspeed_ms, sp]))

    for (const sp of run.speeds) {
      printSpeedPoint(sp, specificSpeed !== null, baseMap?.get(sp.airspeed_ms))
    }
    console.log()
  }

  // ── Save results ──
  const latestPath = saveJson(run, `${polarName}-latest.json`)
  console.log(`📄 JSON saved: ${latestPath}`)

  if (saveBaseline) {
    const baselinePath = saveJson(run, `${polarName}-baseline.json`)
    console.log(`📌 Baseline saved: ${baselinePath}`)
  }

  // ── Generate HTML report ──
  if (!noHtml) {
    const html = generateReport(run, baseline ?? undefined)
    const htmlPath = saveHtml(html, `${polarName}-report.html`)
    console.log(`📊 HTML report: ${htmlPath}`)
  }
}

main()
