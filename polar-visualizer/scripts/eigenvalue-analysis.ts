/**
 * eigenvalue-analysis.ts — Natural mode analysis for Polar vehicles.
 *
 * Usage: npx tsx scripts/eigenvalue-analysis.ts [polar] [airspeed_ms]
 *
 * Examples:
 *   npx tsx scripts/eigenvalue-analysis.ts ibexul 12
 *   npx tsx scripts/eigenvalue-analysis.ts aurafive 30
 *   npx tsx scripts/eigenvalue-analysis.ts ibexul          # sweep 8–20 m/s
 *
 * Output: Trim conditions, A matrix, eigenvalues, natural modes
 * with frequency, damping ratio, and stability classification.
 */

import { ibexulContinuous, aurafiveContinuous, a5segmentsContinuous, slicksinContinuous } from '../src/polar/polar-data.ts'
import type { ContinuousPolar, SegmentControls } from '../src/polar/continuous-polar.ts'
import type { SimConfig } from '../src/polar/sim-state.ts'
import { computeInertia, computeCenterOfMass, ZERO_INERTIA } from '../src/polar/inertia.ts'
import { defaultControls } from '../src/polar/aero-segment.ts'
import { findTrim } from './lib/trim-finder.ts'
import { numericalJacobian, eigenvalues, classifyModes, sortModes, STATE_NAMES } from './lib/linearize.ts'

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

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2)
  const polarName = args[0] ?? 'ibexul'
  const specificSpeed = args[1] ? parseFloat(args[1]) : null

  const polar = POLARS[polarName]
  if (!polar) {
    console.error(`Unknown polar: ${polarName}. Available: ${Object.keys(POLARS).join(', ')}`)
    process.exit(1)
  }

  console.log(`╔══════════════════════════════════════════════════════════════╗`)
  console.log(`║  Eigenvalue / Natural Mode Analysis — ${polarName.padEnd(22)} ║`)
  console.log(`║  Mass: ${polar.m} kg  │  Ref: ${polar.referenceLength ?? 1.875} m                        ║`)
  console.log(`╚══════════════════════════════════════════════════════════════╝`)

  const config = buildConfig(polar)
  // Default speed range depends on vehicle type
  const isWingsuit = polarName.startsWith('a5') || polarName === 'aurafive' || polarName === 'slicksin'
  const defaultSpeeds = isWingsuit
    ? [25, 30, 35, 40, 45, 50, 55]
    : [8, 10, 12, 14, 16, 18, 20]
  const speeds = specificSpeed ? [specificSpeed] : defaultSpeeds

  for (const V of speeds) {
    console.log(`\n${'═'.repeat(60)}`)
    console.log(`  Airspeed: ${V} m/s (${(V * 3.6).toFixed(1)} km/h, ${(V * 2.237).toFixed(1)} mph)`)
    console.log(`${'═'.repeat(60)}`)

    // 1. Find trim
    const trimOpts = isWingsuit
      ? { alphaGuess_deg: 10, thetaGuess_deg: -10 }
      : { alphaGuess_deg: 10, thetaGuess_deg: -30 }
    const trim = findTrim(V, config, trimOpts)
    if (!trim.converged) {
      console.log(`  ⚠️  Trim did not converge (residual: ${trim.residual.toExponential(2)})`)
      console.log(`      Best guess: α=${trim.alpha_deg.toFixed(2)}°, θ=${trim.theta_deg.toFixed(2)}°`)
      continue
    }

    console.log(`\n  Trim: α = ${trim.alpha_deg.toFixed(2)}°, θ = ${trim.theta_deg.toFixed(2)}°`)
    console.log(`        γ = ${trim.gamma_deg.toFixed(2)}° (flight path)`)
    console.log(`        qDot = ${trim.qDot.toFixed(3)} rad/s² (pendulum-stabilized moment)`)
    console.log(`        Residual: ${trim.residual.toExponential(2)} (${trim.iterations} iterations)`)

    // 2. Compute Jacobian
    const A = numericalJacobian(trim.state, config)

    if (specificSpeed) {
      printMatrix('State-Space A Matrix', A)
    }

    // 3. Eigenvalues
    const eigs = eigenvalues(A)
    const modes = sortModes(classifyModes(eigs))

    // 4. Display modes
    console.log(`\n  Natural Modes:`)
    console.log(`  ${'─'.repeat(56)}`)
    console.log(`  ${'Mode'.padEnd(6)} ${'σ [1/s]'.padStart(10)} ${'ω [rad/s]'.padStart(10)} ${'f [Hz]'.padStart(8)} ${'ζ'.padStart(6)} ${'T½ [s]'.padStart(8)} ${'Stable'.padStart(7)}`)
    console.log(`  ${'─'.repeat(56)}`)

    for (let i = 0; i < modes.length; i++) {
      const m = modes[i]
      // Skip conjugate duplicates (negative imaginary)
      if (m.imagPart < -1e-6) continue

      const typeStr = m.imagPart > 1e-6 ? 'osc' : 'real'
      const stableStr = m.stable ? '  ✓' : '  ✗'
      const t2h = m.timeToHalf_s < 1000 ? m.timeToHalf_s.toFixed(2) : '   ∞'

      console.log(`  ${(typeStr).padEnd(6)} ${fmt(m.realPart, 10, 4)} ${fmt(m.imagPart, 10, 4)} ${fmt(m.frequency_Hz, 8, 3)} ${fmt(m.dampingRatio, 6, 3)} ${t2h.padStart(8)} ${stableStr}`)
    }
  }

  console.log()
}

main()
