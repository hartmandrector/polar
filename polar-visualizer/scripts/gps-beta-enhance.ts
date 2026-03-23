/**
 * gps-beta-enhance.ts — Enhance GPS stability CSV with orientation corrections.
 *
 * Two modes:
 *
 * **Wingsuit mode** (default):
 *   Reads stability CSV, solves for steady-state β at each timestep using the
 *   segment model's lateral force equilibrium, recomputes θ, ψ, and body rates.
 *
 * **Canopy mode** (--mode canopy):
 *   Reads canopy CSV with canopy normal vector (NED position of canopy relative
 *   to pilot). Derives canopy orientation from the tension line geometry + airspeed,
 *   extracts α, β, φ, θ, ψ, and computes body rates via inverse DKE.
 *
 * Usage:
 *   npx tsx scripts/gps-beta-enhance.ts <csv> [options]
 *
 * Options:
 *   --mode <wingsuit|canopy>  Processing mode (default: wingsuit)
 *   --polar <name>            Polar for β solver (wingsuit mode, default: a5segments)
 *   --trim-offset <deg>       Canopy trim AOA offset (canopy mode, default: 3.0)
 *   --output <file>           Output CSV path (default: <input>-enhanced.csv)
 */

import { readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import type { SimConfig } from '../src/polar/sim-state.ts'
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
import { solveBetaEquilibrium } from './beta-equilibrium.ts'

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

// ─── Constants ───────────────────────────────────────────────────────────────

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

// ─── Generic CSV Parser ──────────────────────────────────────────────────────

function parseCSV(filepath: string): { metadata: string[]; headers: string[]; data: Record<string, number>[] } {
  const text = readFileSync(filepath, 'utf-8')
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  const metadata: string[] = []
  let headerIdx = -1

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#')) {
      metadata.push(lines[i])
    } else {
      headerIdx = i
      break
    }
  }

  if (headerIdx < 0) throw new Error('No header row found')

  const headers = lines[headerIdx].split(',').map(h => h.trim())
  const data: Record<string, number>[] = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const vals = lines[i].split(',')
    if (vals.length < headers.length) continue

    const row: Record<string, number> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = parseFloat(vals[j])
    }
    data.push(row)
  }

  return { metadata, headers, data }
}

// ─── Wingsuit Mode (equilibrium β solver) ────────────────────────────────────

interface StabilityRow {
  t: number
  V: number
  alpha: number   // deg
  gamma: number   // deg
  phi: number     // deg
  theta: number   // deg
  psi: number     // deg
  p: number       // deg/s
  q: number       // deg/s
  r: number       // deg/s
  CL: number
  CD: number
  qbar: number
  rho: number
}

interface CorrectedState {
  beta: number        // deg
  theta_corr: number  // deg
  psi_corr: number    // deg
}

function correctAngles(row: StabilityRow, beta_deg: number): CorrectedState {
  const phi = row.phi * DEG
  const beta = beta_deg * DEG
  const alpha = row.alpha * DEG
  const gamma = row.gamma * DEG

  const theta_corr = (gamma + alpha * Math.cos(phi) - beta * Math.sin(phi)) * RAD

  const theta_rad = theta_corr * DEG
  const cosTheta = Math.cos(theta_rad)
  const dpsi = cosTheta > 0.01 ? (beta * Math.cos(phi)) / cosTheta * RAD : 0
  const psi_corr = row.psi + dpsi

  return { beta: beta_deg, theta_corr, psi_corr }
}

function runWingsuitMode(inputFile: string, polarName: string, outputPath: string) {
  const polar = POLARS[polarName]
  if (!polar) {
    console.error(`Unknown polar: ${polarName}. Try: ${Object.keys(POLARS).join(', ')}`)
    process.exit(1)
  }
  const config = buildConfig(polar)
  const { metadata, data } = parseCSV(inputFile)

  const rows: StabilityRow[] = data.map(d => ({
    t: d['t'] ?? 0, V: d['V'] ?? 0, alpha: d['alpha'] ?? 0, gamma: d['gamma'] ?? 0,
    phi: d['phi'] ?? 0, theta: d['theta'] ?? 0, psi: d['psi'] ?? 0,
    p: d['p'] ?? 0, q: d['q'] ?? 0, r: d['r'] ?? 0,
    CL: d['CL'] ?? 0, CD: d['CD'] ?? 0, qbar: d['qbar'] ?? 0, rho: d['rho'] ?? 0,
  }))

  if (rows.length === 0) { console.error('No data rows.'); process.exit(1) }

  console.log(`\n═══ GPS Beta Enhancement — Wingsuit Mode ═══`)
  console.log(`Input:  ${inputFile}`)
  console.log(`Polar:  ${polarName}  |  mass: ${config.mass} kg`)
  console.log(`Points: ${rows.length}  |  t: ${rows[0].t}–${rows[rows.length - 1].t} s\n`)

  // Solve β
  const corrected: CorrectedState[] = []
  let convergedCount = 0
  for (const row of rows) {
    const localConfig = row.rho > 0 ? { ...config, rho: row.rho } : config
    const result = solveBetaEquilibrium(row.V, row.alpha, row.phi, localConfig, {
      betaGuess_deg: corrected.length > 0 ? corrected[corrected.length - 1].beta : 0,
      gamma_deg: row.gamma,
    })
    if (result.converged) convergedCount++
    corrected.push(correctAngles(row, result.beta_deg))
  }
  console.log(`β solve: ${convergedCount}/${rows.length} converged`)

  // Recompute body rates
  const phi = rows.map(r => r.phi * DEG)
  const theta = corrected.map(c => c.theta_corr * DEG)
  const psi = corrected.map(c => c.psi_corr * DEG)
  const newRates = computeBodyRatesFromAngles(rows.map(r => r.t), phi, theta, psi)

  // Statistics
  printWingsuitStats(rows, corrected, newRates)

  // Write output
  const outLines: string[] = [
    ...metadata,
    `# enhanced_by: polar-visualizer/gps-beta-enhance`,
    `# mode: wingsuit`,
    `# polar: ${polarName}`,
    `# beta_source: lateral_force_equilibrium`,
    't,V,alpha,beta,gamma,phi,theta,theta_corr,psi,psi_corr,p,q,r,p_corr,q_corr,r_corr,CL,CD,qbar,rho',
  ]

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], c = corrected[i], nr = newRates[i]
    outLines.push([
      r.t.toFixed(2), r.V.toFixed(2), r.alpha.toFixed(2), c.beta.toFixed(4), r.gamma.toFixed(2),
      r.phi.toFixed(2), r.theta.toFixed(2), c.theta_corr.toFixed(2),
      r.psi.toFixed(1), c.psi_corr.toFixed(1),
      r.p.toFixed(2), r.q.toFixed(2), r.r.toFixed(2),
      nr.p.toFixed(2), nr.q.toFixed(2), nr.r.toFixed(2),
      r.CL.toFixed(6), r.CD.toFixed(6), r.qbar.toFixed(1), r.rho.toFixed(4),
    ].join(','))
  }

  writeFileSync(outputPath, outLines.join('\n') + '\n')
  console.log(`\nOutput: ${outputPath}\n`)
}

function printWingsuitStats(rows: StabilityRow[], corrected: CorrectedState[], newRates: { p: number; q: number; r: number }[]) {
  let maxBeta = 0, sumBeta = 0, maxDTheta = 0, maxDPsi = 0, maxDp = 0, maxDq = 0, maxDr = 0
  for (let i = 0; i < rows.length; i++) {
    const b = Math.abs(corrected[i].beta)
    maxBeta = Math.max(maxBeta, b); sumBeta += b
    maxDTheta = Math.max(maxDTheta, Math.abs(corrected[i].theta_corr - rows[i].theta))
    maxDPsi = Math.max(maxDPsi, Math.abs(corrected[i].psi_corr - rows[i].psi))
    maxDp = Math.max(maxDp, Math.abs(newRates[i].p - rows[i].p))
    maxDq = Math.max(maxDq, Math.abs(newRates[i].q - rows[i].q))
    maxDr = Math.max(maxDr, Math.abs(newRates[i].r - rows[i].r))
  }
  console.log(`\n─── Correction Statistics ───`)
  console.log(`β:  mean ${(sumBeta / rows.length).toFixed(3)}°  max ${maxBeta.toFixed(3)}°`)
  console.log(`Δθ: max ${maxDTheta.toFixed(3)}°`)
  console.log(`Δψ: max ${maxDPsi.toFixed(3)}°`)
  console.log(`Δp: max ${maxDp.toFixed(3)} °/s`)
  console.log(`Δq: max ${maxDq.toFixed(3)} °/s`)
  console.log(`Δr: max ${maxDr.toFixed(3)} °/s`)
}

// ─── Canopy Mode (canopy normal → orientation) ──────────────────────────────

/**
 * Canopy normal CSV expected columns:
 *   t      — time [s]
 *   V      — airspeed [m/s]
 *   vN     — air-relative velocity North [m/s]
 *   vE     — air-relative velocity East [m/s]
 *   vD     — air-relative velocity Down [m/s]
 *   cnN    — canopy normal North [m] (canopy position relative to pilot, NED)
 *   cnE    — canopy normal East [m]
 *   cnD    — canopy normal Down [m]
 *
 * Optional: CL, CD, qbar, rho (passed through if present)
 */

interface CanopyRow {
  t: number
  V: number
  vN: number
  vE: number
  vD: number
  cnN: number   // canopy normal NED — canopy position relative to pilot
  cnE: number
  cnD: number
  CL: number
  CD: number
  qbar: number
  rho: number
}

interface CanopyOrientation {
  alpha: number   // deg — canopy AOA
  beta: number    // deg — canopy sideslip
  phi: number     // deg — canopy roll
  theta: number   // deg — canopy pitch
  psi: number     // deg — canopy heading
}

/**
 * Derive canopy orientation from the canopy normal vector and airspeed.
 *
 * The canopy normal vector (CN) points from pilot to canopy — this IS the
 * tension line direction. The canopy's longitudinal axis aligns with the
 * airspeed projected onto the plane perpendicular to CN.
 *
 * Steps:
 * 1. Normalize CN to get the tension unit vector (up from pilot to canopy)
 * 2. The canopy's "down" axis is -CN (toward the pilot)
 * 3. Project airspeed onto the plane perpendicular to CN → canopy forward axis
 * 4. Cross product gives the canopy lateral axis
 * 5. Extract Euler angles from the resulting DCM
 * 6. AOA = angle between airspeed and canopy forward, in the longitudinal plane
 * 7. β = angle between airspeed and canopy forward, in the lateral plane
 *
 * The trim offset accounts for the canopy's natural AOA at trim — the
 * canopy normal tilts aft of the airspeed vector by the trim angle.
 */
function canopyOrientationFromNormal(
  vN: number, vE: number, vD: number,
  cnN: number, cnE: number, cnD: number,
  trimOffset_deg: number,
): CanopyOrientation {
  // Airspeed vector (NED)
  const V = Math.sqrt(vN * vN + vE * vE + vD * vD)
  if (V < 0.5) return { alpha: 0, beta: 0, phi: 0, theta: 0, psi: 0 }

  // Canopy normal unit vector (pilot → canopy direction)
  const cnMag = Math.sqrt(cnN * cnN + cnE * cnE + cnD * cnD)
  if (cnMag < 0.01) return { alpha: 0, beta: 0, phi: 0, theta: 0, psi: 0 }

  const uN = cnN / cnMag  // "up" direction in NED (toward canopy)
  const uE = cnE / cnMag
  const uD = cnD / cnMag

  // Canopy "down" axis (body z, positive down) = -CN
  // This is the line tension direction from canopy to pilot
  const zN = -uN
  const zE = -uE
  const zD = -uD

  // Derive canopy forward axis from the CN geometry, NOT from airspeed.
  //
  // The canopy forward direction is perpendicular to CN in the vertical plane
  // containing CN. This is the direction the canopy "faces" — determined by
  // where the lines tilt, not where the wind comes from.
  //
  // Method: rotate CN 90° toward horizontal in the vertical plane containing CN.
  // Forward = CN × (CN × down_hat), normalized.
  // Equivalently: project the NED down vector onto the plane ⊥ to CN, negate it.
  //
  // CN horizontal component gives heading; CN tilt from vertical gives pitch.

  // Project NED down (0,0,1) onto plane ⊥ to CN, then negate to get forward
  // down_perp = down - (down · CN_hat) * CN_hat = (0,0,1) - uD * (uN, uE, uD)
  // forward = -down_perp (canopy flies away from the "hanging" direction)
  let fN = uD * uN        // -( -uD * uN ) = uD * uN
  let fE = uD * uE        // -( -uD * uE ) = uD * uE
  let fD = uD * uD - 1.0  // -( 1 - uD² )  = uD² - 1

  const fMag = Math.sqrt(fN * fN + fE * fE + fD * fD)
  if (fMag < 1e-6) {
    // CN is straight up/down — canopy heading undefined. Use airspeed heading.
    const hd = Math.atan2(vE, vN) * RAD
    return { alpha: 0, beta: 0, phi: 0, theta: 0, psi: hd }
  }

  // Canopy forward axis (body x) — perpendicular to CN in the vertical plane
  fN /= fMag; fE /= fMag; fD /= fMag

  // Canopy right axis (body y) = z × x (down cross forward)
  const rN = zE * fD - zD * fE
  const rE = zD * fN - zN * fD
  const rD = zN * fE - zE * fN

  // DCM: columns are body x (forward), body y (right), body z (down) in NED
  // Row 0 = N components, Row 1 = E components, Row 2 = D components
  //
  //        [fN  rN  zN]
  // DCM =  [fE  rE  zE]
  //        [fD  rD  zD]
  //
  // This is the rotation matrix from body to NED (R_nb)

  // Extract Euler angles (3-2-1: ψ, θ, φ)
  // θ = -asin(R[2][0]) = -asin(fD)
  const theta_rad = -Math.asin(Math.max(-1, Math.min(1, fD)))

  // ψ = atan2(R[1][0], R[0][0]) = atan2(fE, fN)
  const psi_rad = Math.atan2(fE, fN)

  // φ = atan2(R[2][1], R[2][2]) = atan2(rD, zD)
  const phi_rad = Math.atan2(rD, zD)

  // Airspeed unit vector
  const wN = vN / V
  const wE = vE / V
  const wD = vD / V

  // AOA: angle between airspeed and canopy forward axis in the xz plane
  // The airspeed in body frame: [V·cos(α)·cos(β), V·sin(β), V·sin(α)·cos(β)]
  // α = atan2(w_body, u_body) where u=forward, w=down components of airspeed
  const u_body = wN * fN + wE * fE + wD * fD  // airspeed · forward
  const w_body = wN * zN + wE * zE + wD * zD  // airspeed · down

  // Raw geometric α (without trim offset)
  const alpha_geom = Math.atan2(w_body, u_body) * RAD

  // Apply trim offset: the canopy's equilibrium has the CN tilted aft,
  // so the geometric α from CN already includes the trim. The trim offset
  // is how much α the canopy flies at in steady state.
  // For display/coefficient purposes we report the aero α (relative to trim).
  const alpha = alpha_geom + trimOffset_deg

  // Sideslip: lateral component of airspeed in body frame
  const v_body = wN * rN + wE * rE + wD * rD  // airspeed · right
  const beta = Math.asin(Math.max(-1, Math.min(1, v_body))) * RAD

  return {
    alpha,
    beta,
    phi: phi_rad * RAD,
    theta: theta_rad * RAD,
    psi: psi_rad * RAD,
  }
}

function runCanopyMode(inputFile: string, trimOffset_deg: number, outputPath: string) {
  const { metadata, data } = parseCSV(inputFile)

  // Validate required columns
  const required = ['t', 'V', 'vN', 'vE', 'vD', 'cnN', 'cnE', 'cnD']
  const missing = required.filter(c => !(c in (data[0] ?? {})))
  if (missing.length > 0) {
    console.error(`Missing required columns for canopy mode: ${missing.join(', ')}`)
    console.error(`Expected: ${required.join(', ')}`)
    process.exit(1)
  }

  const rows: CanopyRow[] = data.map(d => ({
    t: d['t'] ?? 0, V: d['V'] ?? 0,
    vN: d['vN'] ?? 0, vE: d['vE'] ?? 0, vD: d['vD'] ?? 0,
    cnN: d['cnN'] ?? 0, cnE: d['cnE'] ?? 0, cnD: d['cnD'] ?? 0,
    CL: d['CL'] ?? NaN, CD: d['CD'] ?? NaN, qbar: d['qbar'] ?? NaN, rho: d['rho'] ?? NaN,
  }))

  if (rows.length === 0) { console.error('No data rows.'); process.exit(1) }

  console.log(`\n═══ GPS Beta Enhancement — Canopy Mode ═══`)
  console.log(`Input:      ${inputFile}`)
  console.log(`Trim offset: ${trimOffset_deg}°`)
  console.log(`Points:     ${rows.length}  |  t: ${rows[0].t}–${rows[rows.length - 1].t} s\n`)

  // Step 1: Derive orientation from canopy normal at each timestep
  const orientations: CanopyOrientation[] = rows.map(r =>
    canopyOrientationFromNormal(r.vN, r.vE, r.vD, r.cnN, r.cnE, r.cnD, trimOffset_deg)
  )

  // Step 2: Compute body rates from the derived Euler angles via inverse DKE
  const phi = orientations.map(o => o.phi * DEG)
  const theta = orientations.map(o => o.theta * DEG)
  const psi = orientations.map(o => o.psi * DEG)
  const times = rows.map(r => r.t)
  const bodyRates = computeBodyRatesFromAngles(times, phi, theta, psi)

  // Step 3: Statistics
  let sumAlpha = 0, sumBeta = 0, maxBeta = 0, maxAlpha = 0
  for (const o of orientations) {
    sumAlpha += Math.abs(o.alpha)
    maxAlpha = Math.max(maxAlpha, Math.abs(o.alpha))
    sumBeta += Math.abs(o.beta)
    maxBeta = Math.max(maxBeta, Math.abs(o.beta))
  }
  console.log(`─── Canopy Orientation Statistics ───`)
  console.log(`α:  mean ${(sumAlpha / rows.length).toFixed(2)}°  max ${maxAlpha.toFixed(2)}°`)
  console.log(`β:  mean ${(sumBeta / rows.length).toFixed(3)}°  max ${maxBeta.toFixed(3)}°`)

  let maxP = 0, maxQ = 0, maxR = 0
  for (const r of bodyRates) {
    maxP = Math.max(maxP, Math.abs(r.p))
    maxQ = Math.max(maxQ, Math.abs(r.q))
    maxR = Math.max(maxR, Math.abs(r.r))
  }
  console.log(`p:  max ${maxP.toFixed(2)} °/s`)
  console.log(`q:  max ${maxQ.toFixed(2)} °/s`)
  console.log(`r:  max ${maxR.toFixed(2)} °/s`)

  // Step 4: Write output
  const outLines: string[] = [
    ...metadata,
    `# enhanced_by: polar-visualizer/gps-beta-enhance`,
    `# mode: canopy`,
    `# trim_offset_deg: ${trimOffset_deg}`,
    `# orientation_source: canopy_normal_vector`,
    't,V,alpha,beta,phi,theta,psi,p,q,r,cnN,cnE,cnD,vN,vE,vD,CL,CD,qbar,rho',
  ]

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const o = orientations[i]
    const br = bodyRates[i]
    outLines.push([
      r.t.toFixed(2),
      r.V.toFixed(2),
      o.alpha.toFixed(2),
      o.beta.toFixed(4),
      o.phi.toFixed(2),
      o.theta.toFixed(2),
      o.psi.toFixed(1),
      br.p.toFixed(2),
      br.q.toFixed(2),
      br.r.toFixed(2),
      r.cnN.toFixed(4),
      r.cnE.toFixed(4),
      r.cnD.toFixed(4),
      r.vN.toFixed(2),
      r.vE.toFixed(2),
      r.vD.toFixed(2),
      isNaN(r.CL) ? '' : r.CL.toFixed(6),
      isNaN(r.CD) ? '' : r.CD.toFixed(6),
      isNaN(r.qbar) ? '' : r.qbar.toFixed(1),
      isNaN(r.rho) ? '' : r.rho.toFixed(4),
    ].join(','))
  }

  writeFileSync(outputPath, outLines.join('\n') + '\n')
  console.log(`\nOutput: ${outputPath}\n`)
}

// ─── Shared: Body Rate Computation from Euler Angles ─────────────────────────

function computeBodyRatesFromAngles(
  times: number[],
  phi: number[],    // rad
  theta: number[],  // rad
  psi: number[],    // rad
): { p: number; q: number; r: number }[] {
  const n = times.length
  const rates: { p: number; q: number; r: number }[] = []

  for (let i = 0; i < n; i++) {
    const dt_fwd = i < n - 1 ? times[i + 1] - times[i] : times[i] - times[i - 1]
    const dt_bwd = i > 0 ? times[i] - times[i - 1] : dt_fwd

    let phiDot: number, thetaDot: number, psiDot: number

    if (i === 0) {
      phiDot = (phi[1] - phi[0]) / dt_fwd
      thetaDot = (theta[1] - theta[0]) / dt_fwd
      psiDot = unwrapDiff(psi[1], psi[0]) / dt_fwd
    } else if (i === n - 1) {
      phiDot = (phi[i] - phi[i - 1]) / dt_bwd
      thetaDot = (theta[i] - theta[i - 1]) / dt_bwd
      psiDot = unwrapDiff(psi[i], psi[i - 1]) / dt_bwd
    } else {
      const dt_c = times[i + 1] - times[i - 1]
      phiDot = (phi[i + 1] - phi[i - 1]) / dt_c
      thetaDot = (theta[i + 1] - theta[i - 1]) / dt_c
      psiDot = unwrapDiff(psi[i + 1], psi[i - 1]) / dt_c
    }

    const sp = Math.sin(phi[i])
    const cp = Math.cos(phi[i])
    const st = Math.sin(theta[i])
    const ct = Math.cos(theta[i])

    rates.push({
      p: (phiDot - psiDot * st) * RAD,
      q: (thetaDot * cp + psiDot * sp * ct) * RAD,
      r: (-thetaDot * sp + psiDot * cp * ct) * RAD,
    })
  }

  return rates
}

function unwrapDiff(a2: number, a1: number): number {
  let d = a2 - a1
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string, def: string) => {
    const i = args.indexOf(flag)
    return i >= 0 && i + 1 < args.length ? args[i + 1] : def
  }
  const known = ['a5segments', 'ibexul', 'aurafive', 'slicksin']
  const inputFile = args.find(a => !a.startsWith('-') && !known.includes(a))

  return {
    input: inputFile ?? '',
    mode: get('--mode', 'wingsuit') as 'wingsuit' | 'canopy',
    polar: get('--polar', 'a5segments'),
    trimOffset: parseFloat(get('--trim-offset', '3.0')),
    output: get('--output', ''),
  }
}

function main() {
  const opts = parseArgs()

  if (!opts.input) {
    console.error('Usage: npx tsx scripts/gps-beta-enhance.ts <csv> [--mode wingsuit|canopy] [options]')
    console.error('  Wingsuit: --polar <name>')
    console.error('  Canopy:   --trim-offset <deg>')
    process.exit(1)
  }

  const outputPath = opts.output || (() => {
    const dir = dirname(opts.input)
    const base = basename(opts.input, '.csv')
    return join(dir, `${base}-enhanced.csv`)
  })()

  if (opts.mode === 'canopy') {
    runCanopyMode(opts.input, opts.trimOffset, outputPath)
  } else {
    runWingsuitMode(opts.input, opts.polar, outputPath)
  }
}

main()
