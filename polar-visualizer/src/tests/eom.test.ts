/**
 * Equations of Motion unit tests.
 *
 * Tests the pure-math EOM functions in src/polar/eom.ts:
 *   - gravityBody
 *   - translationalEOM
 *   - rotationalEOM
 *   - eulerRates / eulerRatesToBodyRates (round-trip)
 *   - computePilotPendulumParams
 *   - pilotPendulumEOM
 *   - pilotSwingDampingTorque
 */

import { describe, it, expect } from 'vitest'
import {
  gravityBody,
  translationalEOM,
  rotationalEOM,
  eulerRates,
  eulerRatesToBodyRates,
  computePilotPendulumParams,
  pilotPendulumEOM,
  pilotSwingDampingTorque,
} from '../polar/eom.ts'
import type { PilotPendulumParams } from '../polar/eom.ts'
import type { InertiaComponents } from '../polar/inertia.ts'
import type { MassSegment } from '../polar/continuous-polar.ts'
import {
  PILOT_PIVOT_X, PILOT_PIVOT_Z, CANOPY_PILOT_SEGMENTS,
} from '../polar/polar-data.ts'

const DEG = Math.PI / 180
const g = 9.80665

// ─── gravityBody ─────────────────────────────────────────────────────────────

describe('gravityBody', () => {
  it('level flight → full gravity in z', () => {
    const gVec = gravityBody(0, 0)
    expect(gVec.x).toBeCloseTo(0, 10)
    expect(gVec.y).toBeCloseTo(0, 10)
    expect(gVec.z).toBeCloseTo(g, 6)
  })

  it('90° pitch down → full gravity forward (x)', () => {
    const gVec = gravityBody(0, Math.PI / 2)
    expect(gVec.x).toBeCloseTo(-g, 6)
    expect(gVec.y).toBeCloseTo(0, 10)
    expect(gVec.z).toBeCloseTo(0, 6)
  })

  it('90° roll right → full gravity in y', () => {
    const gVec = gravityBody(Math.PI / 2, 0)
    expect(gVec.x).toBeCloseTo(0, 10)
    expect(gVec.y).toBeCloseTo(g, 6)
    expect(gVec.z).toBeCloseTo(0, 6)
  })

  it('inverted (180° roll) → negative z', () => {
    const gVec = gravityBody(Math.PI, 0)
    expect(gVec.x).toBeCloseTo(0, 10)
    expect(gVec.y).toBeCloseTo(0, 5)
    expect(gVec.z).toBeCloseTo(-g, 6)
  })
})

// ─── translationalEOM ────────────────────────────────────────────────────────

describe('translationalEOM', () => {
  it('no rotation, no force → zero acceleration', () => {
    const a = translationalEOM(
      { x: 0, y: 0, z: 0 }, 1,
      { x: 10, y: 0, z: 0 },
      { p: 0, q: 0, r: 0 },
    )
    expect(a.uDot).toBeCloseTo(0, 10)
    expect(a.vDot).toBeCloseTo(0, 10)
    expect(a.wDot).toBeCloseTo(0, 10)
  })

  it('pure forward force → forward acceleration', () => {
    const a = translationalEOM(
      { x: 100, y: 0, z: 0 }, 10,
      { x: 0, y: 0, z: 0 },
      { p: 0, q: 0, r: 0 },
    )
    expect(a.uDot).toBeCloseTo(10, 10) // F/m = 100/10
    expect(a.vDot).toBeCloseTo(0, 10)
    expect(a.wDot).toBeCloseTo(0, 10)
  })

  it('yaw rate + forward velocity → centripetal sideslip', () => {
    // u=10, r=1 → vDot += -r*u = -10
    const a = translationalEOM(
      { x: 0, y: 0, z: 0 }, 1,
      { x: 10, y: 0, z: 0 },
      { p: 0, q: 0, r: 1 },
    )
    expect(a.vDot).toBeCloseTo(-10, 10) // pw - ru = 0 - 1*10
  })
})

// ─── rotationalEOM ───────────────────────────────────────────────────────────

describe('rotationalEOM', () => {
  it('no moment, no rates → zero angular acceleration', () => {
    const I: InertiaComponents = { Ixx: 100, Iyy: 200, Izz: 300, Ixz: 0, Ixy: 0, Iyz: 0 }
    const a = rotationalEOM(
      { x: 0, y: 0, z: 0 }, I, { p: 0, q: 0, r: 0 },
    )
    expect(a.pDot).toBeCloseTo(0, 10)
    expect(a.qDot).toBeCloseTo(0, 10)
    expect(a.rDot).toBeCloseTo(0, 10)
  })

  it('pure pitch moment → pitch acceleration', () => {
    const I: InertiaComponents = { Ixx: 100, Iyy: 200, Izz: 300, Ixz: 0, Ixy: 0, Iyz: 0 }
    const a = rotationalEOM(
      { x: 0, y: 1000, z: 0 }, I, { p: 0, q: 0, r: 0 },
    )
    expect(a.qDot).toBeCloseTo(5, 10) // M/Iyy = 1000/200
    expect(a.pDot).toBeCloseTo(0, 10)
    expect(a.rDot).toBeCloseTo(0, 10)
  })

  it('Ixz coupling routes roll moment into yaw', () => {
    const I: InertiaComponents = { Ixx: 100, Iyy: 200, Izz: 300, Ixz: 50, Ixy: 0, Iyz: 0 }
    const a = rotationalEOM(
      { x: 1000, y: 0, z: 0 }, I, { p: 0, q: 0, r: 0 },
    )
    // With Ixz = 50, pure roll moment produces both pDot and rDot
    expect(a.pDot).not.toBeCloseTo(0, 5)
    expect(a.rDot).not.toBeCloseTo(0, 5)
    // Roll accel should be positive (responding to positive L)
    expect(a.pDot).toBeGreaterThan(0)
  })
})

// ─── eulerRates ↔ eulerRatesToBodyRates round-trip ──────────────────────────

describe('eulerRates ↔ eulerRatesToBodyRates', () => {
  it('round-trips at zero attitude', () => {
    const er = eulerRates(1, 2, 3, 0, 0)
    const br = eulerRatesToBodyRates(er.phiDot, er.thetaDot, er.psiDot, 0, 0)
    expect(br.p).toBeCloseTo(1, 10)
    expect(br.q).toBeCloseTo(2, 10)
    expect(br.r).toBeCloseTo(3, 10)
  })

  it('round-trips at 30° roll, 15° pitch', () => {
    const phi = 30 * DEG, theta = 15 * DEG
    const er = eulerRates(0.5, -0.3, 0.8, phi, theta)
    const br = eulerRatesToBodyRates(er.phiDot, er.thetaDot, er.psiDot, phi, theta)
    expect(br.p).toBeCloseTo(0.5, 10)
    expect(br.q).toBeCloseTo(-0.3, 10)
    expect(br.r).toBeCloseTo(0.8, 10)
  })

  it('pure yaw rate ψ̇ at level → body r only', () => {
    const br = eulerRatesToBodyRates(0, 0, 1, 0, 0)
    expect(br.p).toBeCloseTo(0, 10)
    expect(br.q).toBeCloseTo(0, 10)
    expect(br.r).toBeCloseTo(1, 10)
  })

  it('pure yaw rate with pitch → couples into p', () => {
    // p = -ψ̇ sinθ, so nonzero pitch means ψ̇ couples into roll rate
    const theta = 20 * DEG
    const br = eulerRatesToBodyRates(0, 0, 1, 0, theta)
    expect(br.p).toBeCloseTo(-Math.sin(theta), 10)
  })
})

// ─── Pilot Pendulum: computePilotPendulumParams ─────────────────────────────

describe('computePilotPendulumParams', () => {
  // Simple test with a single point mass
  it('single point mass at known offset', () => {
    const segments: MassSegment[] = [{
      name: 'point',
      massRatio: 0.5,  // 50% of totalWeight
      normalizedPosition: { x: 0.3, y: 0, z: 0.2 },
    }]
    const pivotX = 0.1, pivotZ = 0.1
    const height = 2.0, totalWeight = 100

    const p = computePilotPendulumParams(segments, pivotX, pivotZ, height, totalWeight)

    // Mass = 0.5 * 100 = 50 kg
    expect(p.pilotMass).toBeCloseTo(50, 10)

    // dx = (0.3 - 0.1) * 2 = 0.4 m, dz = (0.2 - 0.1) * 2 = 0.2 m
    // d² = 0.16 + 0.04 = 0.20
    // Iy = 50 * 0.20 = 10 kg·m²
    expect(p.Iy_riser).toBeCloseTo(10, 10)

    // CG offset from pivot: {x: 0.4, z: 0.2}
    expect(p.cgOffset.x).toBeCloseTo(0.4, 10)
    expect(p.cgOffset.z).toBeCloseTo(0.2, 10)

    // riserToCG = sqrt(0.16 + 0.04) ≈ 0.4472
    expect(p.riserToCG).toBeCloseTo(Math.sqrt(0.2), 6)
  })

  it('two symmetric masses cancel CG offset in x', () => {
    const segments: MassSegment[] = [
      { name: 'left',  massRatio: 0.25, normalizedPosition: { x: 0.0, y: 0, z: 0.5 } },
      { name: 'right', massRatio: 0.25, normalizedPosition: { x: 0.4, y: 0, z: 0.5 } },
    ]
    const p = computePilotPendulumParams(segments, 0.2, 0, 1.0, 100)

    // Both at ±0.2 from pivot in x, both at 0.5 from pivot in z
    // CG x = (−0.2 + 0.2) / 2 = 0
    expect(p.cgOffset.x).toBeCloseTo(0, 10)
    // CG z = 0.5 (both same z)
    expect(p.cgOffset.z).toBeCloseTo(0.5, 10)
  })

  it('with real pilot segments produces reasonable values', () => {
    const p = computePilotPendulumParams(
      CANOPY_PILOT_SEGMENTS, PILOT_PIVOT_X, PILOT_PIVOT_Z,
    )
    // Pilot segment ratios sum to ~0.845 of default 77.5 kg ≈ 65.5 kg
    expect(p.pilotMass).toBeGreaterThan(50)
    expect(p.pilotMass).toBeLessThan(80)

    // Inertia about riser pivot — pilot segments span ~1.5 m from pivot
    // with ~65 kg mass, so I ≈ 60-120 kg·m² is reasonable
    expect(p.Iy_riser).toBeGreaterThan(30)
    expect(p.Iy_riser).toBeLessThan(200)

    // CG should be below pivot (positive z in NED) and aft (negative x)
    expect(p.riserToCG).toBeGreaterThan(0)
    expect(p.cgOffset.z).toBeGreaterThan(0) // below pivot
  })
})

// ─── Pilot Pendulum: pilotPendulumEOM ───────────────────────────────────────

describe('pilotPendulumEOM', () => {
  const params: PilotPendulumParams = {
    pilotMass: 70,
    Iy_riser: 10,
    riserToCG: 0.5,
    cgOffset: { x: -0.3, z: 0.4 },
  }

  it('zero swing angle → zero gravity torque → zero accel', () => {
    // thetaPilot == thetaCanopy → sin(0) = 0 → no gravity torque
    const accel = pilotPendulumEOM(params, 0, 0, 0, 0)
    expect(accel).toBeCloseTo(0, 10)
  })

  it('positive swing angle → restoring (negative) acceleration', () => {
    // thetaPilot > thetaCanopy → sin > 0 → τ_gravity < 0 → accel < 0
    const accel = pilotPendulumEOM(params, 0.1, 0, 0, 0)
    expect(accel).toBeLessThan(0)
  })

  it('negative swing angle → restoring (positive) acceleration', () => {
    const accel = pilotPendulumEOM(params, -0.1, 0, 0, 0)
    expect(accel).toBeGreaterThan(0)
  })

  it('gravity torque magnitude scales with displacement', () => {
    const small = Math.abs(pilotPendulumEOM(params, 0.05, 0, 0, 0))
    const large = Math.abs(pilotPendulumEOM(params, 0.10, 0, 0, 0))
    expect(large).toBeGreaterThan(small)
  })

  it('canopy pitch acceleration couples through', () => {
    // qDotCanopy = 1 rad/s² → tau_canopy = -Iy * 1 = -10
    // That adds -1 rad/s² to θ̈_p  (tau_canopy/Iy = -10/10)
    const withCoupling = pilotPendulumEOM(params, 0, 0, 0, 1)
    expect(withCoupling).toBeCloseTo(-1, 10)
  })

  it('aero torque contributes directly', () => {
    // 10 N·m aero torque / 10 kg·m² inertia = 1 rad/s²
    const accel = pilotPendulumEOM(params, 0, 0, 10, 0)
    expect(accel).toBeCloseTo(1, 10)
  })

  it('degenerate zero-inertia returns 0', () => {
    const degen: PilotPendulumParams = {
      pilotMass: 0, Iy_riser: 0, riserToCG: 0,
      cgOffset: { x: 0, z: 0 },
    }
    expect(pilotPendulumEOM(degen, 0.5, 0, 100, 5)).toBe(0)
  })
})

// ─── Pilot Pendulum: pilotSwingDampingTorque ────────────────────────────────

describe('pilotSwingDampingTorque', () => {
  // Two-segment test pilot for predictable geometry
  const testSegments: MassSegment[] = [
    { name: 'upper', massRatio: 0.3, normalizedPosition: { x: 0.1, y: 0, z: 0.3 } },
    { name: 'lower', massRatio: 0.3, normalizedPosition: { x: 0.1, y: 0, z: 0.6 } },
  ]
  const px = 0.1, pz = 0.1
  const height = 2.0, totalWeight = 100

  it('zero swing rate → zero damping torque', () => {
    const tau = pilotSwingDampingTorque(testSegments, px, pz, 0, 1.225, height, totalWeight)
    expect(tau).toBe(0)
  })

  it('positive swing rate → negative damping torque', () => {
    const tau = pilotSwingDampingTorque(testSegments, px, pz, 1.0, 1.225, height, totalWeight)
    expect(tau).toBeLessThan(0)
  })

  it('negative swing rate → positive damping torque', () => {
    const tau = pilotSwingDampingTorque(testSegments, px, pz, -1.0, 1.225, height, totalWeight)
    expect(tau).toBeGreaterThan(0)
  })

  it('damping magnitude scales with rate squared', () => {
    const tau1 = Math.abs(pilotSwingDampingTorque(testSegments, px, pz, 1.0, 1.225, height, totalWeight))
    const tau2 = Math.abs(pilotSwingDampingTorque(testSegments, px, pz, 2.0, 1.225, height, totalWeight))
    // v * |v| gives rate² scaling → torque ~4× larger at 2× rate
    expect(tau2 / tau1).toBeCloseTo(4, 0)
  })

  it('higher air density → more damping', () => {
    const tauLow  = Math.abs(pilotSwingDampingTorque(testSegments, px, pz, 1.0, 1.0, height, totalWeight))
    const tauHigh = Math.abs(pilotSwingDampingTorque(testSegments, px, pz, 1.0, 2.0, height, totalWeight))
    expect(tauHigh).toBeGreaterThan(tauLow)
    expect(tauHigh / tauLow).toBeCloseTo(2, 1) // linear in ρ
  })

  it('works with real pilot segments', () => {
    const tau = pilotSwingDampingTorque(
      CANOPY_PILOT_SEGMENTS, PILOT_PIVOT_X, PILOT_PIVOT_Z,
      0.5, // moderate swing rate
    )
    // Should be negative (opposing positive swing rate)
    expect(tau).toBeLessThan(0)
    // Should be finite and reasonable
    expect(Math.abs(tau)).toBeLessThan(500)
    expect(Math.abs(tau)).toBeGreaterThan(0.001)
  })
})
