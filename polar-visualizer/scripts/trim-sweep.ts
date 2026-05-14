/**
 * trim-sweep.ts — Pitch-throttle trim manifold + stability sweep.
 *
 * For each (airspeed, pitch throttle) pair:
 *   1. Find trim α, θ via the same Newton solver used by eigenvalue-analysis
 *   2. Linearize about that trim, compute eigenvalues
 *   3. Report trim α, residual qDot, short-period ζ, worst lateral mode
 *
 * The pitch throttle drives hipCamber + legBend internally (Phase D.2 coupling),
 * so the entire posture range is exercised:
 *   pitchThrottle = -1   → full nose-down (legs straight, hips flat)
 *   pitchThrottle =  0   → neutral baseline
 *   pitchThrottle = +1   → full nose-up (legs bent, hips arched)
 *
 * Output: 2D table — rows = airspeed, columns = pitch throttle settings.
 *
 * Usage:
 *   npx tsx scripts/trim-sweep.ts a5segments
 *   npx tsx scripts/trim-sweep.ts a5segments --pitch-steps 7 --speed-steps 5
 *   npx tsx scripts/trim-sweep.ts a5segments --speeds 25,35,45 --pitches -1,0,1
 *   npx tsx scripts/trim-sweep.ts a5segments --no-html
 *
 * Outputs:
 *   Terminal:  Color-coded tables (always, unless --no-print)
 *   HTML:      scripts/results/<polar>-trim-sweep.html (unless --no-html)
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  ibexulContinuous,
  aurafiveContinuous,
  a5segmentsContinuous,
  slicksinContinuous,
} from '../src/polar/polar-data.ts'
import type { ContinuousPolar, SegmentControls } from '../src/polar/continuous-polar.ts'
import type { SimConfig } from '../src/polar/sim-state.ts'
import { computeInertia, computeCenterOfMass, ZERO_INERTIA } from '../src/polar/inertia.ts'
import { defaultControls } from '../src/polar/aero-segment.ts'
import { findTrim } from './lib/trim-finder.ts'
import {
  numericalJacobian,
  eigenvalues,
  classifyModes,
  sortModes,
  nameModes,
} from './lib/linearize.ts'
import { computeDerivatives } from '../src/polar/sim.ts'
import type { SimState } from '../src/polar/sim-state.ts'

// ─── Polar Registry ──────────────────────────────────────────────────────────

const POLARS: Record<string, ContinuousPolar> = {
  ibexul: ibexulContinuous,
  aurafive: aurafiveContinuous,
  a5segments: a5segmentsContinuous,
  slicksin: slicksinContinuous,
}

// ─── Config builder (controls overridable) ───────────────────────────────────

function buildConfig(polar: ContinuousPolar, controls: Partial<SegmentControls>): SimConfig {
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

// ─── CLI args ────────────────────────────────────────────────────────────────

interface Args {
  polarName: string
  speeds: number[]
  pitches: number[]
  writeHtml: boolean
  print: boolean
}

function parseList(s: string): number[] {
  return s.split(',').map((x) => parseFloat(x.trim())).filter((x) => Number.isFinite(x))
}

function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a]
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1))
  return out
}

function parseArgs(argv: string[]): Args {
  const polarName = argv.find((a) => !a.startsWith('--')) ?? 'a5segments'

  let speedSteps = 8
  let pitchSteps = 5
  let speeds: number[] | null = null
  let pitches: number[] | null = null
  let writeHtml = true
  let print = true

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--speed-steps') speedSteps = parseInt(argv[++i], 10)
    else if (a === '--pitch-steps') pitchSteps = parseInt(argv[++i], 10)
    else if (a === '--speeds') speeds = parseList(argv[++i])
    else if (a === '--pitches') pitches = parseList(argv[++i])
    else if (a === '--no-html') writeHtml = false
    else if (a === '--no-print') print = false
  }

  return {
    polarName,
    speeds: speeds ?? linspace(25, 80, speedSteps),
    pitches: pitches ?? linspace(-1, 1, pitchSteps),
    writeHtml,
    print,
  }
}

// ─── Stability summary at one trim ───────────────────────────────────────────

interface CellResult {
  alphaDeg: number
  thetaDeg: number
  gammaDeg: number
  qDot: number
  residual: number
  converged: boolean
  shortPeriodZeta: number | null
  shortPeriodFreqHz: number | null
  worstLateralSigma: number      // max σ across roll/yaw/Dutch-roll modes (positive = unstable)
  worstLateralLabel: string      // mode name
  dutchRollZeta: number | null
}

function analyseCell(polar: ContinuousPolar, V: number, pitchT: number): CellResult {
  const config = buildConfig(polar, { pitchThrottle: pitchT })

  const trim = findTrim(V, config, {
    alphaGuess_deg: 10,
    thetaGuess_deg: -20,
  })

  if (!trim.converged) {
    return {
      alphaDeg: trim.alpha_deg,
      thetaDeg: trim.theta_deg,
      gammaDeg: trim.gamma_deg,
      qDot: trim.qDot,
      residual: trim.residual,
      converged: false,
      shortPeriodZeta: null,
      shortPeriodFreqHz: null,
      worstLateralSigma: NaN,
      worstLateralLabel: '—',
      dutchRollZeta: null,
    }
  }

  const A = numericalJacobian(trim.state, config)
  const eigs = eigenvalues(A)
  const modes = nameModes(sortModes(classifyModes(eigs)))

  let spZ: number | null = null
  let spF: number | null = null
  let drZ: number | null = null
  let worstSigma = -Infinity
  let worstLabel = 'stable'
  for (const m of modes) {
    if (m.name === 'Short period') {
      spZ = m.dampingRatio
      spF = m.frequency_Hz
    }
    if (m.name === 'Dutch roll') {
      drZ = m.dampingRatio
    }
    // Lateral instability hunt: only count non-pitch modes
    const isPitch = m.name === 'Short period' || m.name === 'Phugoid'
    if (!isPitch && m.realPart > worstSigma) {
      worstSigma = m.realPart
      worstLabel = m.name
    }
  }

  return {
    alphaDeg: trim.alpha_deg,
    thetaDeg: trim.theta_deg,
    gammaDeg: trim.gamma_deg,
    qDot: trim.qDot,
    residual: trim.residual,
    converged: true,
    shortPeriodZeta: spZ,
    shortPeriodFreqHz: spF,
    worstLateralSigma: worstSigma === -Infinity ? NaN : worstSigma,
    worstLateralLabel: worstLabel,
    dutchRollZeta: drZ,
  }
}

// ─── 3-DOF longitudinal trim (uDot=wDot=qDot=0) ──────────────────────────────
//
// Solves α, θ, pitchThrottle simultaneously so the vehicle is in true
// steady longitudinal flight at a given airspeed: no translational acceleration
// AND no residual pitching moment. This represents the actual trimmed posture
// the model can hold without pendulum assist.

interface FullTrimResult {
  airspeed_ms: number
  converged: boolean
  alphaDeg: number
  thetaDeg: number
  gammaDeg: number
  pitchThrottle: number
  glideRatio: number | null
  residual: number
  iterations: number
  shortPeriodZeta: number | null
  shortPeriodFreqHz: number | null
  dutchRollZeta: number | null
  worstLateralSigma: number
  worstLateralLabel: string
}

function residuals3(
  V: number,
  alpha: number,
  theta: number,
  pT: number,
  polar: ContinuousPolar,
): { uDot: number; wDot: number; qDot: number; state: SimState; config: SimConfig } {
  const config = buildConfig(polar, { pitchThrottle: pT })
  const state: SimState = {
    x: 0, y: 0, z: 0,
    u: V * Math.cos(alpha), v: 0, w: V * Math.sin(alpha),
    phi: 0, theta, psi: 0,
    p: 0, q: 0, r: 0,
  }
  const d = computeDerivatives(state, config)
  return { uDot: d.uDot, wDot: d.wDot, qDot: d.qDot, state, config }
}

function findFullTrim(V: number, polar: ContinuousPolar): FullTrimResult {
  const RAD = 180 / Math.PI
  const maxIter = 300
  const tol = 1e-5

  let alpha = 8 * Math.PI / 180
  let theta = -20 * Math.PI / 180
  let pT = 0

  let lastRes = { uDot: 0, wDot: 0, qDot: 0, state: null as SimState | null, config: null as SimConfig | null }
  let converged = false
  let iter = 0

  for (iter = 0; iter < maxIter; iter++) {
    const r = residuals3(V, alpha, theta, pT, polar)
    lastRes = r
    const rss = Math.sqrt(r.uDot ** 2 + r.wDot ** 2 + r.qDot ** 2)
    if (rss < tol) { converged = true; break }

    // 3×3 Jacobian via finite differences
    const da = 1e-4, dt = 1e-4, dp = 1e-3
    const rA = residuals3(V, alpha + da, theta, pT, polar)
    const rT = residuals3(V, alpha, theta + dt, pT, polar)
    const rP = residuals3(V, alpha, theta, pT + dp, polar)

    const J = [
      [(rA.uDot - r.uDot) / da, (rT.uDot - r.uDot) / dt, (rP.uDot - r.uDot) / dp],
      [(rA.wDot - r.wDot) / da, (rT.wDot - r.wDot) / dt, (rP.wDot - r.wDot) / dp],
      [(rA.qDot - r.qDot) / da, (rT.qDot - r.qDot) / dt, (rP.qDot - r.qDot) / dp],
    ]

    // Solve J · [dα, dθ, dpT] = -[r]  via Cramer (3×3)
    function det3(m: number[][]): number {
      return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    }
    const D = det3(J)
    if (!Number.isFinite(D) || Math.abs(D) < 1e-20) break
    const b = [-r.uDot, -r.wDot, -r.qDot]
    const Jx = [[b[0], J[0][1], J[0][2]], [b[1], J[1][1], J[1][2]], [b[2], J[2][1], J[2][2]]]
    const Jy = [[J[0][0], b[0], J[0][2]], [J[1][0], b[1], J[1][2]], [J[2][0], b[2], J[2][2]]]
    const Jz = [[J[0][0], J[0][1], b[0]], [J[1][0], J[1][1], b[1]], [J[2][0], J[2][1], b[2]]]
    const dAlpha = det3(Jx) / D
    const dTheta = det3(Jy) / D
    const dpT = det3(Jz) / D

    // Damped step
    const cap = 0.05
    alpha += Math.max(-cap, Math.min(cap, dAlpha))
    theta += Math.max(-cap, Math.min(cap, dTheta))
    pT += Math.max(-0.2, Math.min(0.2, dpT))
    // Allow extrapolation beyond [-1, 1] but flag in result
  }

  const r = lastRes
  const rss = Math.sqrt(r.uDot ** 2 + r.wDot ** 2 + r.qDot ** 2)
  const gammaDeg = (theta - alpha) * RAD
  const glideRatio = converged && gammaDeg < 0
    ? 1 / Math.tan(Math.abs(gammaDeg) * Math.PI / 180)
    : null

  // Eigenvalue snapshot at the trim
  let spZ: number | null = null, spF: number | null = null, drZ: number | null = null
  let worstSigma = -Infinity, worstLabel = 'stable'
  if (converged && r.state && r.config) {
    try {
      const A = numericalJacobian(r.state, r.config)
      const eigs = eigenvalues(A)
      const modes = nameModes(sortModes(classifyModes(eigs)))
      for (const m of modes) {
        if (m.name === 'Short period') { spZ = m.dampingRatio; spF = m.frequency_Hz }
        if (m.name === 'Dutch roll') { drZ = m.dampingRatio }
        const isPitch = m.name === 'Short period' || m.name === 'Phugoid'
        if (!isPitch && m.realPart > worstSigma) { worstSigma = m.realPart; worstLabel = m.name }
      }
    } catch { /* eigen failure non-fatal */ }
  }

  return {
    airspeed_ms: V,
    converged,
    alphaDeg: alpha * RAD,
    thetaDeg: theta * RAD,
    gammaDeg,
    pitchThrottle: pT,
    glideRatio,
    residual: rss,
    iterations: iter,
    shortPeriodZeta: spZ,
    shortPeriodFreqHz: spF,
    dutchRollZeta: drZ,
    worstLateralSigma: worstSigma === -Infinity ? NaN : worstSigma,
    worstLateralLabel: worstLabel,
  }
}

// ─── Pretty printing ─────────────────────────────────────────────────────────

const C_RESET = '\x1b[0m'
const C_GREEN = '\x1b[32m'
const C_YELLOW = '\x1b[33m'
const C_RED = '\x1b[31m'
const C_DIM = '\x1b[2m'
const C_BOLD = '\x1b[1m'

function colorByZeta(z: number | null): string {
  if (z === null || !Number.isFinite(z)) return C_DIM
  if (z >= 0.10) return C_GREEN
  if (z >= 0.0) return C_YELLOW
  return C_RED
}

function colorBySigma(s: number): string {
  if (!Number.isFinite(s)) return C_DIM
  if (s <= 0) return C_GREEN
  if (s <= 0.5) return C_YELLOW
  return C_RED
}

function fmt(n: number, w: number, dec: number): string {
  if (!Number.isFinite(n)) return ' —'.padStart(w)
  return n.toFixed(dec).padStart(w)
}

function printTable(
  title: string,
  speeds: number[],
  pitches: number[],
  cells: CellResult[][],
  cellExtractor: (c: CellResult) => { value: string; color: string },
): void {
  console.log()
  console.log(`${C_BOLD}${title}${C_RESET}`)
  // header
  const colW = 11
  let header = '  V (m/s) │'
  for (const p of pitches) header += ` pitch=${p.toFixed(2).padStart(5)}`.padStart(colW)
  console.log(header)
  console.log('  ' + '─'.repeat(header.length - 2))
  for (let i = 0; i < speeds.length; i++) {
    let row = `  ${speeds[i].toFixed(0).padStart(5)}   │`
    for (let j = 0; j < pitches.length; j++) {
      const { value, color } = cellExtractor(cells[i][j])
      row += `${color}${value.padStart(colW)}${C_RESET}`
    }
    console.log(row)
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const polar = POLARS[args.polarName]
  if (!polar) {
    console.error(`Unknown polar "${args.polarName}". Available: ${Object.keys(POLARS).join(', ')}`)
    process.exit(1)
  }

  console.log(`╔══════════════════════════════════════════════════════════════╗`)
  console.log(`║  Trim Sweep — ${args.polarName.padEnd(48)}║`)
  console.log(`║  Mass: ${polar.m} kg │ Ref: ${(polar.referenceLength ?? 1.875).toFixed(3)} m${' '.repeat(34)}║`)
  console.log(`╚══════════════════════════════════════════════════════════════╝`)

  const cells: CellResult[][] = []
  for (const V of args.speeds) {
    const row: CellResult[] = []
    for (const p of args.pitches) {
      row.push(analyseCell(polar, V, p))
    }
    cells.push(row)
  }

  // 3-DOF longitudinal trim per speed (solves α, θ, pitchThrottle)
  const fullTrim: FullTrimResult[] = args.speeds.map((V) => findFullTrim(V, polar))

  if (!args.print) {
    if (args.writeHtml) writeReport(args.polarName, polar, args.speeds, args.pitches, cells, fullTrim)
    return
  }

  printTable('Trim α [deg] (pitch throttle vs airspeed)', args.speeds, args.pitches, cells, (c) => ({
    value: c.converged ? fmt(c.alphaDeg, 7, 2) : '   FAIL',
    color: c.converged ? '' : C_RED,
  }))

  printTable('Flight-path angle γ [deg] (steeper = more negative)', args.speeds, args.pitches, cells, (c) => ({
    value: c.converged ? fmt(c.gammaDeg, 7, 2) : '   FAIL',
    color: c.converged ? '' : C_RED,
  }))

  printTable('Short-period damping ζ', args.speeds, args.pitches, cells, (c) => ({
    value: c.shortPeriodZeta === null ? '   —' : fmt(c.shortPeriodZeta, 7, 3),
    color: colorByZeta(c.shortPeriodZeta),
  }))

  printTable('Dutch-roll damping ζ (— = mode absent at this trim)', args.speeds, args.pitches, cells, (c) => ({
    value: c.dutchRollZeta === null ? '   —' : fmt(c.dutchRollZeta, 7, 3),
    color: colorByZeta(c.dutchRollZeta),
  }))

  printTable('Worst lateral σ [1/s] (>0 = unstable)', args.speeds, args.pitches, cells, (c) => ({
    value: !Number.isFinite(c.worstLateralSigma) ? '   —' : fmt(c.worstLateralSigma, 7, 3),
    color: colorBySigma(c.worstLateralSigma),
  }))

  printTable('Worst lateral mode', args.speeds, args.pitches, cells, (c) => ({
    value: c.worstLateralLabel,
    color: colorBySigma(c.worstLateralSigma),
  }))

  printTable('Residual qDot [rad/s²] (pendulum moment)', args.speeds, args.pitches, cells, (c) => ({
    value: c.converged ? fmt(c.qDot, 8, 3) : '   FAIL',
    color: '',
  }))

  console.log()
  console.log(`  ${C_GREEN}■${C_RESET} ζ ≥ 0.10 (well damped)   ${C_YELLOW}■${C_RESET} 0 ≤ ζ < 0.10 (marginal)   ${C_RED}■${C_RESET} ζ < 0 / σ > 0 (unstable)`)
  console.log()

  // ─── 3-DOF trim table (qDot=0) ─────────────────────────────────────
  console.log(`${C_BOLD}3-DOF Longitudinal Trim (uDot = wDot = qDot = 0)${C_RESET}`)
  console.log(`  Solves α, θ, AND pitchThrottle so the model holds true steady flight`)
  console.log(`  without pendulum assist. pT outside [-1, 1] = beyond control authority.`)
  console.log()
  console.log(`  V (m/s) │  pT     │   α°   │   θ°   │   γ°   │  L/D  │ SP ζ  │ DR ζ  │ lat σ`)
  console.log('  ' + '─'.repeat(78))
  for (const t of fullTrim) {
    if (!t.converged) {
      console.log(`  ${t.airspeed_ms.toFixed(0).padStart(5)}   │  ${C_RED}NO TRIM${C_RESET}`)
      continue
    }
    const pTColor = (t.pitchThrottle < -1.05 || t.pitchThrottle > 1.05) ? C_RED
      : (t.pitchThrottle < -0.95 || t.pitchThrottle > 0.95) ? C_YELLOW : ''
    const ldStr = t.glideRatio === null ? '  —  ' : t.glideRatio.toFixed(2).padStart(5)
    const spStr = t.shortPeriodZeta === null ? '  —  ' : t.shortPeriodZeta.toFixed(3).padStart(5)
    const drStr = t.dutchRollZeta === null ? '  —  ' : t.dutchRollZeta.toFixed(3).padStart(5)
    const latStr = !Number.isFinite(t.worstLateralSigma) ? '  —  ' : t.worstLateralSigma.toFixed(2).padStart(5)
    console.log(`  ${t.airspeed_ms.toFixed(0).padStart(5)}   │${pTColor} ${t.pitchThrottle.toFixed(3).padStart(6)}${C_RESET}  │ ${t.alphaDeg.toFixed(2).padStart(5)}  │ ${t.thetaDeg.toFixed(2).padStart(5)}  │ ${t.gammaDeg.toFixed(2).padStart(5)}  │ ${ldStr} │ ${colorByZeta(t.shortPeriodZeta)}${spStr}${C_RESET} │ ${colorByZeta(t.dutchRollZeta)}${drStr}${C_RESET} │ ${colorBySigma(t.worstLateralSigma)}${latStr}${C_RESET}`)
  }
  console.log()

  if (args.writeHtml) writeReport(args.polarName, polar, args.speeds, args.pitches, cells, fullTrim)
}

// ─── HTML report ──────────────────────────────────────────────────────

function writeReport(
  polarName: string,
  polar: ContinuousPolar,
  speeds: number[],
  pitches: number[],
  cells: CellResult[][],
  fullTrim: FullTrimResult[],
): void {
  const outDir = path.join('scripts', 'results')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `${polarName}-trim-sweep.html`)
  const html = renderHtml(polarName, polar, speeds, pitches, cells, fullTrim)
  fs.writeFileSync(outPath, html)
  console.log(`  HTML report: ${outPath}`)
}

function renderHtml(
  polarName: string,
  polar: ContinuousPolar,
  speeds: number[],
  pitches: number[],
  cells: CellResult[][],
  fullTrim: FullTrimResult[],
): string {
  const data = {
    polar: polarName,
    mass: polar.m,
    refLength: polar.referenceLength ?? 1.875,
    speeds,
    pitches,
    fullTrim,
    cells: cells.map((row) => row.map((c) => ({
      alphaDeg: c.alphaDeg,
      thetaDeg: c.thetaDeg,
      gammaDeg: c.gammaDeg,
      qDot: c.qDot,
      residual: c.residual,
      converged: c.converged,
      shortPeriodZeta: c.shortPeriodZeta,
      shortPeriodFreqHz: c.shortPeriodFreqHz,
      worstLateralSigma: c.worstLateralSigma,
      worstLateralLabel: c.worstLateralLabel,
      dutchRollZeta: c.dutchRollZeta,
      // L/D = 1 / tan(|gamma|)
      glideRatio: c.converged && c.gammaDeg < 0
        ? 1 / Math.tan(Math.abs(c.gammaDeg) * Math.PI / 180)
        : null,
    }))),
    timestamp: new Date().toISOString(),
  }

  const dataJson = JSON.stringify(data).replace(/<\/script/g, '<\\/script')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>🐻‍❄️ Trim Sweep — ${polarName}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 24px; background: #1a1a2e; color: #e0e0e0; }
  h1 { color: #4fc3f7; margin: 0 0 4px 0; font-size: 1.6em; font-weight: 600; }
  .subtitle { color: #90a4ae; font-size: 0.9em; margin-bottom: 4px; }
  .meta { color: #90a4ae; margin-bottom: 24px; font-size: 0.85em; font-family: 'Courier New', monospace; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(380px, 1fr)); gap: 18px; max-width: 1600px; }
  .panel { background: #16213e; border-radius: 8px; padding: 16px 18px; box-shadow: 0 1px 4px rgba(0,0,0,0.4); }
  .panel h3 { margin: 0 0 4px 0; font-size: 1em; color: #81d4fa; font-weight: 600; }
  .panel .desc { color: #90a4ae; font-size: 0.8em; margin-bottom: 10px; line-height: 1.4; }
  table.heat { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; font-size: 0.82em; font-family: 'Courier New', monospace; }
  table.heat th, table.heat td { padding: 0.35em 0.5em; text-align: center; border: 1px solid #0f1626; }
  table.heat th { background: #0f1626; color: #4fc3f7; font-weight: 600; font-size: 0.85em; }
  table.heat th.row-label { background: #0f1626; text-align: right; color: #4fc3f7; }
  table.heat td { position: relative; cursor: default; color: #1a1a2e; font-weight: 600; }
  table.heat td:hover { outline: 2px solid #4fc3f7; outline-offset: -2px; z-index: 2; }
  table.heat td:hover::after {
    content: attr(data-tip);
    position: absolute;
    bottom: 110%;
    left: 50%;
    transform: translateX(-50%);
    background: #0f1626;
    color: #e0e0e0;
    padding: 0.6em 0.9em;
    border-radius: 4px;
    font-size: 0.78em;
    font-family: 'Courier New', monospace;
    font-weight: normal;
    white-space: pre;
    z-index: 10;
    pointer-events: none;
    box-shadow: 0 2px 10px rgba(0,0,0,0.6);
    border: 1px solid #2a2a4a;
    text-align: left;
  }
  .footnote { color: #607080; font-size: 0.75em; margin-top: 28px; text-align: center; font-family: 'Courier New', monospace; }
  .footnote a { color: #4fc3f7; text-decoration: none; }
</style>
</head>
<body>
<h1>🐻‍❄️ Trim Sweep — ${polarName}</h1>
<div class="subtitle">Polar Claw · 6DOF flight dynamics</div>
<div class="meta">
  Mass ${polar.m} kg &nbsp;│&nbsp; reference length ${(polar.referenceLength ?? 1.875).toFixed(3)} m &nbsp;│&nbsp;
  ${speeds.length} speeds × ${pitches.length} pitch settings = ${speeds.length * pitches.length} trim points
</div>

<div class="grid">
  <div class="panel">
    <h3>Trim &alpha; [deg]</h3>
    <div class="desc">Steady-flight angle of attack at each (speed, pitch throttle) point.</div>
    <div id="heat-alpha"></div>
  </div>
  <div class="panel">
    <h3>Glide ratio (L/D)</h3>
    <div class="desc">Computed from flight-path angle: L/D = 1 / tan(|&gamma;|). Real wingsuit ceiling ≈ 3:1.</div>
    <div id="heat-ld"></div>
  </div>
  <div class="panel">
    <h3>Short-period damping &zeta;</h3>
    <div class="desc">Pitch oscillation damping. &zeta; ≥ 0.1 is comfortably damped.</div>
    <div id="heat-sp"></div>
  </div>
  <div class="panel">
    <h3>Dutch-roll damping &zeta;</h3>
    <div class="desc">Coupled yaw-roll oscillation. — means mode wasn't oscillatory at this trim.</div>
    <div id="heat-dr"></div>
  </div>
  <div class="panel">
    <h3>Worst lateral &sigma; [1/s]</h3>
    <div class="desc">Most divergent non-pitch real eigenvalue. &gt;0 means unstable; cell tooltip names the mode.</div>
    <div id="heat-lat"></div>
  </div>
  <div class="panel">
    <h3>Pendulum moment qDot [rad/s²]</h3>
    <div class="desc">Residual pitch acceleration after translational trim. Negative = nose-down moment (pendulum stabilises).</div>
    <div id="heat-qdot"></div>
  </div>
</div>

<h2 style="color:#81d4fa; font-size:1.15em; margin: 28px 0 6px 0; font-weight:600;">Control Design Charts</h2>
<div style="color:#90a4ae; font-size:0.85em; margin-bottom:10px; max-width:900px;">
  Required trim surface and cubic pitch response families &mdash; reference for designing Phase P smooth pitch authority.
</div>
<div class="grid">
  <div class="panel">
    <h3>Required trim surface: qDot vs pitch throttle</h3>
    <div class="desc">Each curve = one airspeed. Dashed zero line = trim point. Negative residual at full back stick = slow-speed gap. Goal: drive all curves through zero with a smooth pitch response function.</div>
    <svg id="svg-qdot-curves" viewBox="0 0 500 300" width="100%" style="display:block"></svg>
  </div>
  <div class="panel">
    <h3>Cubic pitch response family: f(pitchT, k)</h3>
    <div class="desc">f = &minus;pitchT &middot; (1 + k &middot; pitchT&sup2;). k=0 is linear (dashed). k&gt;0 adds authority progressively toward full back stick without changing neutral (pitchT=0) feel.</div>
    <svg id="svg-cubic-family" viewBox="0 0 500 300" width="100%" style="display:block"></svg>
  </div>
</div>

<h2 style="color:#81d4fa; font-size:1.15em; margin: 28px 0 6px 0; font-weight:600;">3-DOF Longitudinal Trim (uDot = wDot = qDot = 0)</h2>
<div style="color:#90a4ae; font-size:0.85em; margin-bottom: 10px; max-width: 900px;">
  Solves &alpha;, &theta;, <em>and</em> pitchThrottle simultaneously so the model holds true steady longitudinal flight at each airspeed.
  Pitch throttle outside [&minus;1, +1] (highlighted) means the trim is beyond available control authority &mdash;
  the pendulum or pilot input would have to make up the difference in real flight.
</div>
<div class="panel" style="max-width: 1200px;">
  <table class="heat" id="full-trim-table">
    <thead>
      <tr>
        <th>V (m/s)</th><th>pT</th><th>&alpha; [°]</th><th>&theta; [°]</th><th>&gamma; [°]</th>
        <th>L/D</th><th>SP &zeta;</th><th>DR &zeta;</th><th>lat &sigma;</th>
      </tr>
    </thead>
    <tbody id="full-trim-body"></tbody>
  </table>
</div>

<div class="footnote">Generated ${data.timestamp} &nbsp;·&nbsp; 🐻‍❄️ Polar Claw</div>

<script>
const DATA = ${dataJson};

function lerpColor(c1, c2, t) {
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// Diverging gradient: red (low/bad) - amber (mid) - green (high/good).
function diverging(t) {
  const RED = [220, 80, 90];
  const MID = [240, 220, 140];
  const GREEN = [90, 200, 130];
  if (t < 0.5) return lerpColor(RED, MID, t * 2);
  return lerpColor(MID, GREEN, (t - 0.5) * 2);
}

// Sequential cyan gradient for trim alpha and L/D.
function sequential(t) {
  const LO = [180, 220, 240];
  const HI = [40, 130, 200];
  return lerpColor(LO, HI, Math.max(0, Math.min(1, t)));
}

function heatColor(value, kind, range) {
  if (value === null || !isFinite(value)) return '#2a2a4a';
  if (kind === 'damping') {
    const t = Math.max(0, Math.min(1, (value + 0.2) / 0.5));
    return diverging(t);
  }
  if (kind === 'sigma') {
    const t = Math.max(0, Math.min(1, 1 - (value + 1) / 6));
    return diverging(t);
  }
  if (kind === 'sequential') {
    const { lo, hi } = range;
    if (hi === lo) return sequential(0.5);
    return sequential((value - lo) / (hi - lo));
  }
  if (kind === 'qdot') {
    const t = Math.max(0, Math.min(1, 1 - (value + 15) / 30));
    return diverging(t);
  }
  return '#2a2a4a';
}

function fmt(n, dec) {
  if (n === null || !isFinite(n)) return '—';
  return n.toFixed(dec);
}

function tooltip(cell, V, p) {
  const lines = [
    'V = ' + V.toFixed(0) + ' m/s   pitch = ' + p.toFixed(2),
    'α = ' + fmt(cell.alphaDeg, 2) + '°   θ = ' + fmt(cell.thetaDeg, 2) + '°   γ = ' + fmt(cell.gammaDeg, 2) + '°',
    'L/D = ' + fmt(cell.glideRatio, 2),
    'short-period ζ = ' + fmt(cell.shortPeriodZeta, 3) + '   f = ' + fmt(cell.shortPeriodFreqHz, 2) + ' Hz',
    'Dutch roll ζ = ' + fmt(cell.dutchRollZeta, 3),
    'worst lateral σ = ' + fmt(cell.worstLateralSigma, 3) + ' (' + cell.worstLateralLabel + ')',
    'qDot = ' + fmt(cell.qDot, 2) + ' rad/s²',
  ];
  if (!cell.converged) lines.unshift('TRIM FAILED');
  return lines.join('\\n');
}

function renderTable(elId, kind, getValue, formatValue, range) {
  const container = document.getElementById(elId);
  if (!container) return;
  let html = '<table class="heat"><thead><tr><th class="row-label">V \\\\ pitch</th>';
  for (const p of DATA.pitches) html += '<th>' + p.toFixed(2) + '</th>';
  html += '</tr></thead><tbody>';
  for (let i = 0; i < DATA.speeds.length; i++) {
    const V = DATA.speeds[i];
    html += '<tr><th class="row-label">' + V.toFixed(0) + ' m/s</th>';
    for (let j = 0; j < DATA.pitches.length; j++) {
      const cell = DATA.cells[i][j];
      const v = getValue(cell);
      const bg = heatColor(v, kind, range);
      const tip = tooltip(cell, V, DATA.pitches[j]).replace(/"/g, '&quot;');
      html += '<td style="background:' + bg + '" data-tip="' + tip + '">' + formatValue(v) + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

function collectRange(getValue) {
  let lo = Infinity, hi = -Infinity;
  for (const row of DATA.cells) for (const c of row) {
    const v = getValue(c);
    if (v !== null && isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return { lo, hi };
}

renderTable('heat-alpha', 'sequential', c => c.alphaDeg, v => v === null || !isFinite(v) ? '—' : v.toFixed(1) + '°', collectRange(c => c.alphaDeg));
renderTable('heat-ld', 'sequential', c => c.glideRatio, v => v === null || !isFinite(v) ? '—' : v.toFixed(2), collectRange(c => c.glideRatio));
renderTable('heat-sp', 'damping', c => c.shortPeriodZeta, v => v === null || !isFinite(v) ? '—' : v.toFixed(3));
renderTable('heat-dr', 'damping', c => c.dutchRollZeta, v => v === null || !isFinite(v) ? '—' : v.toFixed(3));
renderTable('heat-lat', 'sigma', c => c.worstLateralSigma, v => v === null || !isFinite(v) ? '—' : v.toFixed(2));
renderTable('heat-qdot', 'qdot', c => c.qDot, v => v === null || !isFinite(v) ? '—' : v.toFixed(1));

// --- qDot surface line chart ---
function renderQdotCurves() {
  var el = document.getElementById('svg-qdot-curves');
  if (!el) return;
  var W = 500, H = 300, ml = 55, mr = 60, mt = 24, mb = 38;
  var pw = W - ml - mr, ph = H - mt - mb;
  var toX = function(p) { return ml + (p + 1) / 2 * pw; };
  var allQ = DATA.cells.flat().filter(function(c) { return c.converged; }).map(function(c) { return c.qDot; });
  var rawMin = Math.min.apply(null, allQ), rawMax = Math.max.apply(null, allQ);
  var pad = (rawMax - rawMin) * 0.08;
  var qMin = rawMin - pad, qMax = rawMax + pad;
  var toY = function(q) { return mt + ph * (1 - (q - qMin) / (qMax - qMin)); };
  var svg = '';
  var step = (qMax - qMin) > 25 ? 10 : 5;
  for (var q = Math.ceil(qMin / step) * step; q <= qMax + 0.01; q += step) {
    var y = toY(q); if (y < mt - 2 || y > mt + ph + 2) continue;
    var isZ = Math.abs(q) < 0.001;
    svg += '<line x1="' + ml + '" y1="' + y.toFixed(1) + '" x2="' + (W-mr) + '" y2="' + y.toFixed(1) + '" stroke="' + (isZ ? '#4fc3f7' : '#fff') + '" stroke-width="' + (isZ ? 1.5 : 0.5) + '" stroke-dasharray="' + (isZ ? '5,4' : 'none') + '" opacity="' + (isZ ? 0.7 : 0.12) + '"/>';
    svg += '<text x="' + (ml-4) + '" y="' + (y+4).toFixed(1) + '" text-anchor="end" fill="' + (isZ ? '#4fc3f7' : '#90a4ae') + '" font-size="10">' + q + '</text>';
  }
  for (var p = -1; p <= 1.01; p += 0.5) {
    var x = toX(p).toFixed(1);
    svg += '<line x1="' + x + '" y1="' + (mt+ph) + '" x2="' + x + '" y2="' + (mt+ph+5) + '" stroke="#90a4ae" stroke-width="1"/>';
    svg += '<text x="' + x + '" y="' + (mt+ph+16) + '" text-anchor="middle" fill="#90a4ae" font-size="10">' + p.toFixed(1) + '</text>';
  }
  svg += '<line x1="' + ml + '" y1="' + mt + '" x2="' + ml + '" y2="' + (mt+ph) + '" stroke="#607080" stroke-width="1"/>';
  svg += '<line x1="' + ml + '" y1="' + (mt+ph) + '" x2="' + (W-mr) + '" y2="' + (mt+ph) + '" stroke="#607080" stroke-width="1"/>';
  svg += '<text x="' + (W/2) + '" y="' + (H-2) + '" text-anchor="middle" fill="#90a4ae" font-size="11">pitch throttle</text>';
  svg += '<text x="11" y="' + (mt+ph/2).toFixed(0) + '" text-anchor="middle" fill="#90a4ae" font-size="11" transform="rotate(-90 11 ' + (mt+ph/2).toFixed(0) + ')">qDot [rad/s\u00b2]</text>';
  svg += '<text x="' + (ml+pw/2).toFixed(0) + '" y="' + (mt-8) + '" text-anchor="middle" fill="#81d4fa" font-size="11" font-weight="600">Required trim surface: qDot vs pitchT</text>';
  var nS = DATA.speeds.length;
  for (var i = 0; i < nS; i++) {
    var ti = i / Math.max(nS - 1, 1);
    var ri = Math.round(80 + 160 * ti), gi = Math.round(140 - 90 * ti), bi = Math.round(220 - 160 * ti);
    var color = 'rgb(' + ri + ',' + gi + ',' + bi + ')';
    var speedIdx = i;
    var pts = DATA.pitches.map(function(pp, j) { return DATA.cells[speedIdx][j].converged ? [toX(pp), toY(DATA.cells[speedIdx][j].qDot)] : null; }).filter(Boolean);
    if (pts.length < 2) continue;
    var d = pts.map(function(pp, k) { return (k === 0 ? 'M' : 'L') + pp[0].toFixed(1) + ',' + pp[1].toFixed(1); }).join(' ');
    svg += '<path d="' + d + '" stroke="' + color + '" stroke-width="2" fill="none"/>';
    var lp = pts[pts.length - 1];
    svg += '<text x="' + (lp[0]+4).toFixed(0) + '" y="' + (lp[1]+4).toFixed(0) + '" fill="' + color + '" font-size="9">' + DATA.speeds[speedIdx].toFixed(0) + '</text>';
  }
  el.innerHTML = svg;
}

// --- Cubic pitch response family chart ---
function renderCubicFamily() {
  var el = document.getElementById('svg-cubic-family');
  if (!el) return;
  var W = 500, H = 300, ml = 55, mr = 55, mt = 24, mb = 38;
  var pw = W - ml - mr, ph = H - mt - mb;
  var kValues = [0, 0.3, 0.5, 0.8, 1.2];
  var kColors = ['#90a4ae', '#4fc3f7', '#81d4fa', '#4db6ac', '#ffb74d'];
  var yMax = 2.4, yMin = -2.4;
  var toX = function(p) { return ml + (p + 1) / 2 * pw; };
  var toY = function(r) { return mt + ph * (1 - (r - yMin) / (yMax - yMin)); };
  var svg = '';
  for (var rv = -2; rv <= 2.01; rv += 0.5) {
    var y = toY(rv); if (y < mt - 2 || y > mt + ph + 2) continue;
    var isZ = Math.abs(rv) < 0.001;
    svg += '<line x1="' + ml + '" y1="' + y.toFixed(1) + '" x2="' + (W-mr) + '" y2="' + y.toFixed(1) + '" stroke="' + (isZ ? '#4fc3f7' : '#fff') + '" stroke-width="' + (isZ ? 1.5 : 0.5) + '" stroke-dasharray="' + (isZ ? '5,4' : 'none') + '" opacity="' + (isZ ? 0.5 : 0.1) + '"/>';
    svg += '<text x="' + (ml-4) + '" y="' + (y+4).toFixed(1) + '" text-anchor="end" fill="' + (isZ ? '#4fc3f7' : '#90a4ae') + '" font-size="10">' + rv.toFixed(1) + '</text>';
  }
  var xZ = toX(0).toFixed(1);
  svg += '<line x1="' + xZ + '" y1="' + mt + '" x2="' + xZ + '" y2="' + (mt+ph) + '" stroke="#4fc3f7" stroke-width="1" stroke-dasharray="5,4" opacity="0.4"/>';
  for (var p = -1; p <= 1.01; p += 0.5) {
    var x = toX(p).toFixed(1);
    svg += '<line x1="' + x + '" y1="' + (mt+ph) + '" x2="' + x + '" y2="' + (mt+ph+5) + '" stroke="#90a4ae" stroke-width="1"/>';
    svg += '<text x="' + x + '" y="' + (mt+ph+16) + '" text-anchor="middle" fill="#90a4ae" font-size="10">' + p.toFixed(1) + '</text>';
  }
  svg += '<line x1="' + ml + '" y1="' + mt + '" x2="' + ml + '" y2="' + (mt+ph) + '" stroke="#607080" stroke-width="1"/>';
  svg += '<line x1="' + ml + '" y1="' + (mt+ph) + '" x2="' + (W-mr) + '" y2="' + (mt+ph) + '" stroke="#607080" stroke-width="1"/>';
  svg += '<text x="' + (W/2) + '" y="' + (H-2) + '" text-anchor="middle" fill="#90a4ae" font-size="11">pitch throttle</text>';
  svg += '<text x="11" y="' + (mt+ph/2).toFixed(0) + '" text-anchor="middle" fill="#90a4ae" font-size="11" transform="rotate(-90 11 ' + (mt+ph/2).toFixed(0) + ')">f(pitchT, k)</text>';
  svg += '<text x="' + (ml+pw/2).toFixed(0) + '" y="' + (mt-8) + '" text-anchor="middle" fill="#81d4fa" font-size="11" font-weight="600">f(pitchT) = \u2212pitchT \u00b7 (1 + k \u00b7 pitchT\u00b2)</text>';
  for (var ki = 0; ki < kValues.length; ki++) {
    var k = kValues[ki];
    var kcolor = kColors[ki];
    var pts2 = [];
    for (var n = 0; n <= 200; n++) {
      var tt = -1 + 2 * n / 200;
      pts2.push([toX(tt), toY(-tt * (1 + k * tt * tt))]);
    }
    var d2 = pts2.map(function(pp, ii) { return (ii === 0 ? 'M' : 'L') + pp[0].toFixed(1) + ',' + pp[1].toFixed(1); }).join(' ');
    svg += '<path d="' + d2 + '" stroke="' + kcolor + '" stroke-width="' + (ki === 0 ? 1.5 : 2) + '" fill="none"' + (ki === 0 ? ' stroke-dasharray="5,3"' : '') + '/>';
    var lp2 = pts2[0];
    svg += '<text x="' + (lp2[0]-3).toFixed(0) + '" y="' + (lp2[1]+4).toFixed(0) + '" text-anchor="end" fill="' + kcolor + '" font-size="9">k=' + k.toFixed(1) + '</text>';
  }
  el.innerHTML = svg;
}

renderQdotCurves();
renderCubicFamily();

// ─── 3-DOF full trim table ────────────────────────────────────────────
function renderFullTrim() {
  const body = document.getElementById('full-trim-body');
  if (!body) return;
  let html = '';
  for (const t of DATA.fullTrim) {
    if (!t.converged) {
      html += '<tr><td style="background:#3a1620;color:#ff8080">' + t.airspeed_ms.toFixed(0) + '</td><td colspan="8" style="background:#3a1620;color:#ff8080;text-align:left;padding-left:1em">NO TRIM (residual ' + t.residual.toExponential(1) + ')</td></tr>';
      continue;
    }
    const pT = t.pitchThrottle;
    const pTOut = pT < -1.05 || pT > 1.05;
    const pTNear = !pTOut && (pT < -0.95 || pT > 0.95);
    const pTBg = pTOut ? 'rgb(220,80,90)' : pTNear ? 'rgb(240,200,120)' : heatColor(0.5, 'sequential', { lo: 0, hi: 1 });
    const ldStr = t.glideRatio === null ? '—' : t.glideRatio.toFixed(2);
    const spZ = t.shortPeriodZeta;
    const drZ = t.dutchRollZeta;
    const lat = t.worstLateralSigma;
    html += '<tr>';
    html += '<td style="background:#0f1626;color:#4fc3f7">' + t.airspeed_ms.toFixed(0) + '</td>';
    html += '<td style="background:' + pTBg + '">' + pT.toFixed(3) + '</td>';
    html += '<td style="background:' + heatColor(t.alphaDeg, 'sequential', { lo: -5, hi: 20 }) + '">' + t.alphaDeg.toFixed(2) + '</td>';
    html += '<td style="background:' + heatColor(t.thetaDeg, 'sequential', { lo: -50, hi: 0 }) + '">' + t.thetaDeg.toFixed(2) + '</td>';
    html += '<td style="background:' + heatColor(t.gammaDeg, 'sequential', { lo: -75, hi: 0 }) + '">' + t.gammaDeg.toFixed(2) + '</td>';
    html += '<td style="background:' + (t.glideRatio === null ? '#2a2a4a' : heatColor(t.glideRatio, 'sequential', { lo: 0.3, hi: 3.0 })) + '">' + ldStr + '</td>';
    html += '<td style="background:' + heatColor(spZ, 'damping') + '">' + (spZ === null ? '—' : spZ.toFixed(3)) + '</td>';
    html += '<td style="background:' + heatColor(drZ, 'damping') + '">' + (drZ === null ? '—' : drZ.toFixed(3)) + '</td>';
    html += '<td style="background:' + heatColor(lat, 'sigma') + '">' + (!isFinite(lat) ? '—' : lat.toFixed(2)) + '</td>';
    html += '</tr>';
  }
  body.innerHTML = html;
}
renderFullTrim();
</script>
</body>
</html>`
}

main()
