/**
 * beta-equilibrium.ts — Estimate sideslip (β) from lateral force equilibrium.
 *
 * Given measured GPS state (V, α, φ), find the β that produces zero
 * net lateral force in the body frame. This is the steady-state
 * coordinated-turn assumption: the wingsuit is in lateral equilibrium,
 * so the aerodynamic side force balances the gravitational lateral component.
 *
 * The solve uses the full segment model — each segment sees different
 * local β depending on its spanwise position and the body rotation rates.
 * For the steady-state solve, we assume p ≈ 0, r ≈ 0 (no active roll/yaw rates).
 *
 * Usage:
 *   npx tsx scripts/beta-equilibrium.ts [--speed 45] [--alpha 5] [--phi 15]
 *   npx tsx scripts/beta-equilibrium.ts --sweep-phi --speed 45 --alpha 5
 *   npx tsx scripts/beta-equilibrium.ts --sweep-speed --alpha 5 --phi 20
 */

import type { SimState, SimConfig } from '../src/polar/sim-state.ts'
import type { ContinuousPolar, SegmentControls } from '../src/polar/continuous-polar.ts'
import { computeDerivatives } from '../src/polar/sim.ts'
import { defaultControls } from '../src/polar/aero-segment.ts'
import { computeInertia, computeCenterOfMass, ZERO_INERTIA } from '../src/polar/inertia.ts'
import {
  ibexulContinuous,
  aurafiveContinuous,
  a5segmentsContinuous,
  slicksinContinuous,
} from '../src/polar/polar-data.ts'

// ─── Polar Registry ──────────────────────────────────────────────────────────

const POLARS: Record<string, ContinuousPolar> = {
  ibexul: ibexulContinuous,
  aurafive: aurafiveContinuous,
  a5segments: a5segmentsContinuous,
  slicksin: slicksinContinuous,
}

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

// ─── Core Solver ──────────────────────────────────────────────────────────────

export interface BetaEquilibriumResult {
  beta_deg: number       // solved sideslip angle
  Fy_residual: number    // remaining lateral force [N] (should be ~0)
  converged: boolean
  iterations: number
  // Context
  V_ms: number
  alpha_deg: number
  phi_deg: number
  // Derived
  turnRate_dps: number   // steady-state turn rate implied by this bank angle
  radius_m: number       // turn radius
}

/**
 * Find β that zeroes the net body-frame lateral force (Fy_body ≈ 0).
 *
 * In a coordinated turn at bank angle φ:
 *   - Gravity has a lateral component: m·g·sin(φ)·cos(θ)
 *   - Aerodynamic side force must balance it
 *   - β adjusts until CY(β) produces the right side force
 *
 * We use the full sim derivatives: vDot = 0 in steady state means
 * the lateral acceleration is zero. Newton-Raphson on vDot(β) = 0.
 */
export function solveBetaEquilibrium(
  V_ms: number,
  alpha_deg: number,
  phi_deg: number,
  config: SimConfig,
  options?: {
    maxIter?: number
    tolerance?: number
    betaGuess_deg?: number
    gamma_deg?: number   // measured flight path angle (overrides -20° estimate)
  },
): BetaEquilibriumResult {
  const maxIter = options?.maxIter ?? 50
  const tol = options?.tolerance ?? 1e-4  // N — lateral force tolerance
  const DEG = Math.PI / 180
  const RAD = 180 / Math.PI

  const alpha = alpha_deg * DEG
  const phi = phi_deg * DEG

  // θ = α + γ — use measured γ when available, else estimate
  const gamma = (options?.gamma_deg ?? -20) * DEG
  const theta = alpha + gamma

  let beta = (options?.betaGuess_deg ?? 0) * DEG

  for (let iter = 0; iter < maxIter; iter++) {
    // Build state: body-frame velocity from V, α, β
    const u = V_ms * Math.cos(alpha) * Math.cos(beta)
    const v = V_ms * Math.sin(beta)
    const w = V_ms * Math.sin(alpha) * Math.cos(beta)

    // In a steady coordinated turn, r = g·sin(φ) / V (yaw rate)
    // and p ≈ 0 (no roll acceleration)
    const g = 9.81
    const r_steady = (g * Math.sin(phi)) / V_ms
    // q from steady pull (centripetal in pitch): q = g·(1/cos(φ) - cos(φ)) / V  (approx)
    // For small φ this is ~0; for large φ it matters
    const q_steady = 0  // simplification — pitch rate ≈ 0 in steady glide

    const state: SimState = {
      x: 0, y: 0, z: 0,
      u, v, w,
      phi: phi_deg * DEG,
      theta,
      psi: 0,  // heading doesn't affect forces
      p: 0,
      q: q_steady,
      r: r_steady,
    }

    const d = computeDerivatives(state, config)
    const Fy = d.vDot * config.mass  // lateral force = m·vDot

    if (Math.abs(Fy) < tol) {
      return makeResult(beta * RAD, Fy, true, iter, V_ms, alpha_deg, phi_deg)
    }

    // Numerical derivative: ∂Fy/∂β
    const db = 0.001  // rad
    const beta2 = beta + db
    const u2 = V_ms * Math.cos(alpha) * Math.cos(beta2)
    const v2 = V_ms * Math.sin(beta2)
    const w2 = V_ms * Math.sin(alpha) * Math.cos(beta2)

    const state2: SimState = { ...state, u: u2, v: v2, w: w2 }
    const d2 = computeDerivatives(state2, config)
    const Fy2 = d2.vDot * config.mass

    const dFy_dBeta = (Fy2 - Fy) / db

    if (Math.abs(dFy_dBeta) < 1e-10) {
      // Flat — no sensitivity, can't converge
      return makeResult(beta * RAD, Fy, false, iter, V_ms, alpha_deg, phi_deg)
    }

    // Newton step
    beta = beta - Fy / dFy_dBeta

    // Clamp to reasonable range
    beta = Math.max(-30 * DEG, Math.min(30 * DEG, beta))
  }

  return makeResult(beta * RAD, NaN, false, maxIter, V_ms, alpha_deg, phi_deg)
}

function makeResult(
  beta_deg: number, Fy: number, converged: boolean, iterations: number,
  V_ms: number, alpha_deg: number, phi_deg: number,
): BetaEquilibriumResult {
  const g = 9.81
  const phi_rad = phi_deg * Math.PI / 180
  // Steady-state turn rate: ψ̇ = g·tan(φ) / V
  const turnRate = (g * Math.tan(phi_rad)) / V_ms
  const radius = Math.abs(phi_deg) > 0.5 ? V_ms / Math.abs(turnRate) : Infinity

  return {
    beta_deg,
    Fy_residual: Fy,
    converged,
    iterations,
    V_ms,
    alpha_deg,
    phi_deg,
    turnRate_dps: turnRate * 180 / Math.PI,
    radius_m: radius,
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string, def: number) => {
    const i = args.indexOf(flag)
    return i >= 0 && i + 1 < args.length ? parseFloat(args[i + 1]) : def
  }
  const has = (flag: string) => args.includes(flag)

  return {
    speed: get('--speed', 45),
    alpha: get('--alpha', 5),
    phi: get('--phi', 15),
    sweepPhi: has('--sweep-phi'),
    sweepSpeed: has('--sweep-speed'),
    polar: (() => {
      // Find a positional arg that matches a known polar name
      const known = ['a5segments', 'ibexul', 'aurafive', 'slicksin']
      return args.find(a => !a.startsWith('-') && known.includes(a)) ?? 'a5segments'
    })(),
  }
}

function main() {
  const opts = parseArgs()
  const polar = POLARS[opts.polar]
  if (!polar) {
    console.error(`Unknown polar: ${opts.polar}. Try: ${Object.keys(POLARS).join(', ')}`)
    process.exit(1)
  }
  const config = buildConfig(polar)

  console.log(`\n═══ Beta Equilibrium Solver ═══`)
  console.log(`Polar: ${opts.polar}  |  mass: ${config.mass} kg  |  ρ: ${config.rho} kg/m³\n`)

  if (opts.sweepPhi) {
    // Sweep bank angle at fixed speed and alpha
    console.log(`Sweep φ at V=${opts.speed} m/s, α=${opts.alpha}°\n`)
    console.log(`${'φ (°)'.padStart(8)}  ${'β (°)'.padStart(8)}  ${'ψ̇ (°/s)'.padStart(9)}  ${'R (m)'.padStart(8)}  ${'Fy (N)'.padStart(8)}  conv`)
    console.log('─'.repeat(62))

    for (let phi = -45; phi <= 45; phi += 5) {
      if (Math.abs(phi) < 0.1) continue  // skip zero (trivial)
      const r = solveBetaEquilibrium(opts.speed, opts.alpha, phi, config)
      console.log(
        `${phi.toFixed(1).padStart(8)}  ` +
        `${r.beta_deg.toFixed(3).padStart(8)}  ` +
        `${r.turnRate_dps.toFixed(2).padStart(9)}  ` +
        `${(r.radius_m < 10000 ? r.radius_m.toFixed(1) : '∞').padStart(8)}  ` +
        `${r.Fy_residual.toFixed(4).padStart(8)}  ` +
        `${r.converged ? '✓' : '✗'}`,
      )
    }
  } else if (opts.sweepSpeed) {
    // Sweep airspeed at fixed alpha and phi
    console.log(`Sweep V at α=${opts.alpha}°, φ=${opts.phi}°\n`)
    console.log(`${'V (m/s)'.padStart(8)}  ${'β (°)'.padStart(8)}  ${'ψ̇ (°/s)'.padStart(9)}  ${'R (m)'.padStart(8)}  ${'Fy (N)'.padStart(8)}  conv`)
    console.log('─'.repeat(62))

    for (let V = 25; V <= 65; V += 5) {
      const r = solveBetaEquilibrium(V, opts.alpha, opts.phi, config)
      console.log(
        `${V.toFixed(1).padStart(8)}  ` +
        `${r.beta_deg.toFixed(3).padStart(8)}  ` +
        `${r.turnRate_dps.toFixed(2).padStart(9)}  ` +
        `${(r.radius_m < 10000 ? r.radius_m.toFixed(1) : '∞').padStart(8)}  ` +
        `${r.Fy_residual.toFixed(4).padStart(8)}  ` +
        `${r.converged ? '✓' : '✗'}`,
      )
    }
  } else {
    // Single point
    const r = solveBetaEquilibrium(opts.speed, opts.alpha, opts.phi, config)
    console.log(`V = ${r.V_ms} m/s`)
    console.log(`α = ${r.alpha_deg}°`)
    console.log(`φ = ${r.phi_deg}°`)
    console.log()
    console.log(`β = ${r.beta_deg.toFixed(4)}°  ${r.converged ? '(converged)' : '(NOT converged)'}`)
    console.log(`Fy residual = ${r.Fy_residual.toFixed(6)} N`)
    console.log(`Turn rate = ${r.turnRate_dps.toFixed(2)} °/s`)
    console.log(`Turn radius = ${r.radius_m.toFixed(1)} m`)
    console.log(`Iterations: ${r.iterations}`)
  }

  console.log()
}

// Only run CLI when executed directly (not imported)
if (process.argv[1]?.endsWith('beta-equilibrium.ts')) main()
