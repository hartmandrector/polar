/**
 * linearize.ts — Numerical Jacobian via central finite differences.
 *
 * Given a derivative function f(state) → derivatives, computes the
 * state-space matrix A = ∂f/∂x around a trim point by perturbing
 * each state variable independently.
 *
 * Central differences: A[i][j] ≈ (f_j(x + δe_i) - f_j(x - δe_i)) / (2δ)
 */

import type { SimState, SimConfig, SimDerivatives } from '../../src/polar/sim-state.ts'
import { computeDerivatives } from '../../src/polar/sim.ts'

/**
 * State variable names in canonical order.
 * Position states (x, y, z) are excluded — they don't affect derivatives
 * (the EOM is autonomous in position).
 */
export const STATE_NAMES = [
  'u', 'v', 'w',           // body velocity
  'phi', 'theta', 'psi',   // Euler angles
  'p', 'q', 'r',           // body rates
] as const

export type StateName = typeof STATE_NAMES[number]

/** Derivative names that correspond to each state */
export const DERIV_NAMES: Record<StateName, keyof SimDerivatives> = {
  u: 'uDot', v: 'vDot', w: 'wDot',
  phi: 'phiDot', theta: 'thetaDot', psi: 'psiDot',
  p: 'pDot', q: 'qDot', r: 'rDot',
}

const N = STATE_NAMES.length  // 9x9 system

/**
 * Perturbation sizes for each state variable.
 * Velocities: 0.01 m/s, angles: 0.001 rad (~0.06°), rates: 0.001 rad/s
 */
const DEFAULT_PERTURBATION: Record<StateName, number> = {
  u: 0.01, v: 0.01, w: 0.01,
  phi: 0.001, theta: 0.001, psi: 0.001,
  p: 0.001, q: 0.001, r: 0.001,
}

/** Clone a SimState */
function cloneState(s: SimState): SimState {
  return { ...s }
}

/** Get the derivative value corresponding to a state variable */
function getDerivValue(d: SimDerivatives, stateName: StateName): number {
  return d[DERIV_NAMES[stateName]] as number
}

/**
 * Compute the numerical Jacobian (state-space A matrix) around a trim point.
 *
 * @param trimState  - Equilibrium state
 * @param config     - SimConfig (segments, controls, mass, inertia, etc.)
 * @param perturbations - Optional per-state perturbation sizes
 * @returns A[i][j] where i = derivative row, j = state column (9×9)
 */
export function numericalJacobian(
  trimState: SimState,
  config: SimConfig,
  perturbations?: Partial<Record<StateName, number>>,
): number[][] {
  const eps = { ...DEFAULT_PERTURBATION, ...perturbations }

  const A: number[][] = Array.from({ length: N }, () => new Array(N).fill(0))

  for (let j = 0; j < N; j++) {
    const name = STATE_NAMES[j]
    const delta = eps[name]

    // Forward perturbation
    const sPlus = cloneState(trimState)
    ;(sPlus as unknown as Record<string, number>)[name] += delta

    // Backward perturbation
    const sMinus = cloneState(trimState)
    ;(sMinus as unknown as Record<string, number>)[name] -= delta

    const dPlus = computeDerivatives(sPlus, config)
    const dMinus = computeDerivatives(sMinus, config)

    // Central difference for each derivative row
    for (let i = 0; i < N; i++) {
      const rowName = STATE_NAMES[i]
      A[i][j] = (getDerivValue(dPlus, rowName) - getDerivValue(dMinus, rowName)) / (2 * delta)
    }
  }

  return A
}

/**
 * Compute eigenvalues of a real matrix using the QR algorithm.
 *
 * Returns complex eigenvalues as [real, imag] pairs.
 * For a 9×9 system this is perfectly tractable.
 */
export function eigenvalues(A: number[][]): Array<[number, number]> {
  const n = A.length
  let H = hessenberg(A)

  // QR iteration with shifts (100 iterations is overkill for 9×9)
  const maxIter = 200
  for (let iter = 0; iter < maxIter; iter++) {
    // Check for convergence of bottom element
    if (n > 1 && Math.abs(H[n - 1][n - 2]) < 1e-12) break

    // Wilkinson shift
    const shift = H[n - 1][n - 1]
    for (let i = 0; i < n; i++) H[i][i] -= shift

    const { Q, R } = qrDecompose(H)
    H = matMul(R, Q)
    for (let i = 0; i < n; i++) H[i][i] += shift
  }

  // Extract eigenvalues from quasi-upper-triangular form
  const eigs: Array<[number, number]> = []
  let i = 0
  while (i < n) {
    if (i === n - 1 || Math.abs(H[i + 1][i]) < 1e-10) {
      // Real eigenvalue
      eigs.push([H[i][i], 0])
      i++
    } else {
      // Complex conjugate pair from 2×2 block
      const a = H[i][i], b = H[i][i + 1]
      const c = H[i + 1][i], d = H[i + 1][i + 1]
      const trace = a + d
      const det = a * d - b * c
      const disc = trace * trace - 4 * det
      if (disc < 0) {
        const re = trace / 2
        const im = Math.sqrt(-disc) / 2
        eigs.push([re, im])
        eigs.push([re, -im])
      } else {
        const sq = Math.sqrt(disc)
        eigs.push([(trace + sq) / 2, 0])
        eigs.push([(trace - sq) / 2, 0])
      }
      i += 2
    }
  }

  return eigs
}

// ─── Matrix Utilities ───────────────────────────────────────────────────────

/** Reduce to upper Hessenberg form via Householder reflections */
function hessenberg(M: number[][]): number[][] {
  const n = M.length
  const H = M.map(row => [...row])

  for (let k = 0; k < n - 2; k++) {
    // Compute Householder vector for column k below diagonal
    const x: number[] = []
    for (let i = k + 1; i < n; i++) x.push(H[i][k])

    const norm = Math.sqrt(x.reduce((s, v) => s + v * v, 0))
    if (norm < 1e-15) continue

    x[0] += Math.sign(x[0] || 1) * norm
    const vNorm = Math.sqrt(x.reduce((s, v) => s + v * v, 0))
    for (let i = 0; i < x.length; i++) x[i] /= vNorm

    // Apply H = (I - 2vv^T) H (I - 2vv^T)
    // Left multiply: rows k+1..n
    for (let j = k; j < n; j++) {
      let dot = 0
      for (let i = 0; i < x.length; i++) dot += x[i] * H[k + 1 + i][j]
      for (let i = 0; i < x.length; i++) H[k + 1 + i][j] -= 2 * dot * x[i]
    }
    // Right multiply: columns k+1..n
    for (let i = 0; i < n; i++) {
      let dot = 0
      for (let j = 0; j < x.length; j++) dot += H[i][k + 1 + j] * x[j]
      for (let j = 0; j < x.length; j++) H[i][k + 1 + j] -= 2 * dot * x[j]
    }
  }
  return H
}

/** QR decomposition via Givens rotations (stable for Hessenberg) */
function qrDecompose(H: number[][]): { Q: number[][], R: number[][] } {
  const n = H.length
  const R = H.map(row => [...row])
  const Q: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) as number))

  for (let i = 0; i < n - 1; i++) {
    const a = R[i][i], b = R[i + 1][i]
    const r = Math.sqrt(a * a + b * b)
    if (r < 1e-15) continue
    const c = a / r, s = b / r

    // Apply Givens to R (rows i, i+1)
    for (let j = i; j < n; j++) {
      const ri = R[i][j], ri1 = R[i + 1][j]
      R[i][j] = c * ri + s * ri1
      R[i + 1][j] = -s * ri + c * ri1
    }
    // Apply Givens to Q (columns i, i+1)
    for (let j = 0; j < n; j++) {
      const qi = Q[j][i], qi1 = Q[j][i + 1]
      Q[j][i] = c * qi + s * qi1
      Q[j][i + 1] = -s * qi + c * qi1
    }
  }
  return { Q, R }
}

/** Matrix multiply C = A * B */
function matMul(A: number[][], B: number[][]): number[][] {
  const n = A.length
  const C = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++)
        C[i][j] += A[i][k] * B[k][j]
  return C
}

// ─── Analysis Helpers ───────────────────────────────────────────────────────

export interface NaturalMode {
  name: string
  realPart: number       // σ [1/s] — negative = stable
  imagPart: number       // ω [rad/s]
  frequency_Hz: number   // ω / 2π
  period_s: number       // 2π / ω (Infinity for non-oscillatory)
  dampingRatio: number   // ζ = -σ / √(σ² + ω²)
  stable: boolean
  timeToHalf_s: number   // ln(2) / |σ| — time to halve (or double) amplitude
}

/**
 * Classify eigenvalues into named natural modes.
 *
 * For a symmetric flight condition (β ≈ 0), the 9 eigenvalues typically
 * decompose into:
 * - Short period (complex pair) — fast pitch oscillation
 * - Phugoid (complex pair) — slow speed/altitude exchange
 * - Dutch roll (complex pair) — coupled yaw-roll oscillation
 * - Roll subsidence (real) — pure roll damping
 * - Spiral (real, near zero) — slow heading divergence/convergence
 * - Heading (real, zero) — neutral ψ (not a dynamic mode)
 */
export function classifyModes(eigs: Array<[number, number]>): NaturalMode[] {
  return eigs.map(([re, im]) => {
    const omega = Math.abs(im)
    const sigma = re
    const magnitude = Math.sqrt(sigma * sigma + omega * omega)

    return {
      name: '',  // filled in by heuristic below
      realPart: sigma,
      imagPart: im,
      frequency_Hz: omega / (2 * Math.PI),
      period_s: omega > 1e-6 ? (2 * Math.PI) / omega : Infinity,
      dampingRatio: magnitude > 1e-10 ? -sigma / magnitude : 0,
      stable: sigma < 0,
      timeToHalf_s: Math.abs(sigma) > 1e-10 ? Math.LN2 / Math.abs(sigma) : Infinity,
    }
  })
}

/** Sort modes by frequency (oscillatory first, then by |σ| for real modes) */
export function sortModes(modes: NaturalMode[]): NaturalMode[] {
  return [...modes].sort((a, b) => {
    // Oscillatory before non-oscillatory
    const aOsc = a.imagPart !== 0 ? 1 : 0
    const bOsc = b.imagPart !== 0 ? 1 : 0
    if (aOsc !== bOsc) return bOsc - aOsc
    // By frequency (descending)
    return b.frequency_Hz - a.frequency_Hz
  })
}

/**
 * Auto-name modes based on heuristics.
 *
 * Call on the deduplicated (no negative conjugates) mode list for ONE speed point.
 * Mutates the `name` field in place and returns the same array.
 *
 * Heuristics:
 *   Oscillatory (sorted by descending frequency):
 *     - Highest freq → "Short period"
 *     - Lowest freq (< 0.15 Hz) → "Phugoid"
 *     - Remaining → "Dutch roll"
 *   Real (sorted by descending |σ|):
 *     - σ ≈ 0 (|σ| < 0.001) → "Heading"
 *     - σ > 0 → "Spiral" (or "Lateral divergence" if fast, T₂ < 0.5s)
 *     - Fastest stable → "Roll subsidence"
 *     - Second fastest → "Yaw damping"
 *     - Remaining → "Slow mode"
 */
export function nameModes(modes: NaturalMode[]): NaturalMode[] {
  // Split into oscillatory and real
  const osc = modes.filter(m => m.imagPart > 1e-6).sort((a, b) => b.frequency_Hz - a.frequency_Hz)
  const real = modes.filter(m => m.imagPart <= 1e-6)

  // Name oscillatory modes
  if (osc.length >= 1) osc[0].name = 'Short period'
  if (osc.length >= 2) {
    // Check if lowest freq is phugoid-like (< 0.15 Hz)
    const lowest = osc[osc.length - 1]
    if (lowest.frequency_Hz < 0.15) {
      lowest.name = 'Phugoid'
      // Everything in between is Dutch roll
      for (let i = 1; i < osc.length - 1; i++) osc[i].name = 'Dutch roll'
    } else {
      // No clear phugoid — remaining are Dutch roll
      for (let i = 1; i < osc.length; i++) osc[i].name = 'Dutch roll'
    }
  }
  // If exactly 2 and lowest not phugoid, second is Dutch roll (already handled)
  if (osc.length === 2 && !osc[1].name) osc[1].name = 'Dutch roll'

  // Name real modes
  // First pass: heading (neutral)
  for (const m of real) {
    if (Math.abs(m.realPart) < 0.001) {
      m.name = 'Heading'
    }
  }

  // Second pass: unstable modes
  for (const m of real) {
    if (m.name) continue
    if (m.realPart > 0) {
      m.name = m.timeToHalf_s < 0.5 ? 'Lateral divergence' : 'Spiral'
    }
  }

  // Third pass: stable modes sorted by |σ| descending
  const stableUnnamed = real.filter(m => !m.name).sort((a, b) => Math.abs(b.realPart) - Math.abs(a.realPart))
  if (stableUnnamed.length >= 1) stableUnnamed[0].name = 'Roll subsidence'
  if (stableUnnamed.length >= 2) stableUnnamed[1].name = 'Yaw damping'
  for (let i = 2; i < stableUnnamed.length; i++) {
    stableUnnamed[i].name = 'Slow mode'
  }

  return modes
}
