/**
 * Simulation core tests.
 *
 * Tests the full 6DOF pipeline:
 *   - evaluateAeroForces (ω×r correction)
 *   - bodyToInertialVelocity (translational kinematics)
 *   - computeDerivatives (derivative evaluation)
 *   - forwardEuler (integration)
 *   - simulate (multi-step)
 *   - rk4Step
 */

import { describe, it, expect } from 'vitest'
import {
  computeDerivatives,
  forwardEuler,
  rk4Step,
  simulate,
} from '../polar/sim.ts'
import {
  evaluateAeroForces,
  computeSegmentForce,
  sumAllSegments,
  computeWindFrameNED,
  defaultControls,
} from '../polar/aero-segment.ts'
import {
  bodyToInertialVelocity,
  gravityBody,
} from '../polar/eom.ts'
import {
  makeIbexAeroSegments,
  ibexulContinuous,
} from '../polar/polar-data.ts'
import { computeCenterOfMass, computeInertia } from '../polar/inertia.ts'
import type { SimState, SimConfig, SimDerivatives } from '../polar/sim-state.ts'
import type { Vec3NED } from '../polar/aero-segment.ts'

const DEG = Math.PI / 180
const g = 9.80665

// ─── bodyToInertialVelocity ─────────────────────────────────────────────────

describe('bodyToInertialVelocity', () => {
  it('level flight, no yaw: body velocity = inertial velocity', () => {
    const v = bodyToInertialVelocity(10, 0, 2, 0, 0, 0)
    expect(v.x).toBeCloseTo(10, 10)  // forward = north
    expect(v.y).toBeCloseTo(0, 10)
    expect(v.z).toBeCloseTo(2, 10)   // down
  })

  it('90° yaw: forward velocity becomes east', () => {
    const v = bodyToInertialVelocity(10, 0, 0, 0, 0, Math.PI / 2)
    expect(v.x).toBeCloseTo(0, 6)    // no north
    expect(v.y).toBeCloseTo(10, 6)   // east
    expect(v.z).toBeCloseTo(0, 10)
  })

  it('90° pitch down: forward velocity becomes downward', () => {
    const v = bodyToInertialVelocity(10, 0, 0, 0, -Math.PI / 2, 0)
    expect(v.x).toBeCloseTo(0, 6)
    expect(v.y).toBeCloseTo(0, 10)
    expect(v.z).toBeCloseTo(10, 6)   // all goes into down
  })

  it('90° roll: rightward velocity becomes downward', () => {
    const v = bodyToInertialVelocity(0, 10, 0, Math.PI / 2, 0, 0)
    expect(v.x).toBeCloseTo(0, 10)
    expect(v.y).toBeCloseTo(0, 6)
    expect(v.z).toBeCloseTo(10, 6)   // right → down when rolled 90°
  })
})

// ─── evaluateAeroForces ─────────────────────────────────────────────────────

describe('evaluateAeroForces', () => {
  // Build Ibex UL segments and config for reuse
  const controls = defaultControls()
  const segments = makeIbexAeroSegments()
  const polar = ibexulContinuous
  const cgMeters = computeCenterOfMass(polar.massSegments!, 1.875, polar.m)
  const height = 1.875
  const rho = 1.225
  const airspeed = 12
  const alpha_deg = 8
  const beta_deg = 0

  it('matches static path when ω = 0', () => {
    // Static path: computeSegmentForce → sumAllSegments
    const segForces = segments.map(seg =>
      computeSegmentForce(seg, alpha_deg, beta_deg, controls, rho, airspeed)
    )
    const { windDir, liftDir, sideDir } = computeWindFrameNED(alpha_deg, beta_deg)
    const staticResult = sumAllSegments(segments, segForces, cgMeters, height, windDir, liftDir, sideDir)

    // ω×r path with ω = 0
    // Convert airspeed + α + β → body velocity
    const a = alpha_deg * DEG
    const u = airspeed * Math.cos(a)
    const w = airspeed * Math.sin(a)
    const bodyVel: Vec3NED = { x: u, y: 0, z: w }

    const dynamicResult = evaluateAeroForces(
      segments, cgMeters, height, bodyVel,
      { p: 0, q: 0, r: 0 }, controls, rho,
    )

    // Forces should match closely
    expect(dynamicResult.force.x).toBeCloseTo(staticResult.force.x, 2)
    expect(dynamicResult.force.y).toBeCloseTo(staticResult.force.y, 2)
    expect(dynamicResult.force.z).toBeCloseTo(staticResult.force.z, 2)

    // Moments should match
    expect(dynamicResult.moment.x).toBeCloseTo(staticResult.moment.x, 1)
    expect(dynamicResult.moment.y).toBeCloseTo(staticResult.moment.y, 1)
    expect(dynamicResult.moment.z).toBeCloseTo(staticResult.moment.z, 1)
  })

  it('roll rate produces roll damping moment', () => {
    const a = alpha_deg * DEG
    const u = airspeed * Math.cos(a)
    const w = airspeed * Math.sin(a)
    const bodyVel: Vec3NED = { x: u, y: 0, z: w }

    // No rotation
    const noRoll = evaluateAeroForces(
      segments, cgMeters, height, bodyVel,
      { p: 0, q: 0, r: 0 }, controls, rho,
    )

    // Positive roll rate (right wing down)
    const withRoll = evaluateAeroForces(
      segments, cgMeters, height, bodyVel,
      { p: 0.5, q: 0, r: 0 }, controls, rho,
    )

    // Roll damping: positive p should produce negative ΔL (opposing roll)
    const deltaL = withRoll.moment.x - noRoll.moment.x
    expect(deltaL).toBeLessThan(0)  // C_lp < 0 → natural roll damping
  })

  it('pitch rate produces pitch damping moment', () => {
    const a = alpha_deg * DEG
    const u = airspeed * Math.cos(a)
    const w = airspeed * Math.sin(a)
    const bodyVel: Vec3NED = { x: u, y: 0, z: w }

    const noQ = evaluateAeroForces(
      segments, cgMeters, height, bodyVel,
      { p: 0, q: 0, r: 0 }, controls, rho,
    )

    // Positive pitch rate (nose up)
    const withQ = evaluateAeroForces(
      segments, cgMeters, height, bodyVel,
      { p: 0, q: 0.5, r: 0 }, controls, rho,
    )

    // Pitch damping: positive q should produce negative ΔM (nose-down restoring)
    const deltaM = withQ.moment.y - noQ.moment.y
    expect(deltaM).toBeLessThan(0)  // C_mq < 0
  })
})

// ─── computeDerivatives ─────────────────────────────────────────────────────

describe('computeDerivatives', () => {
  // Build a realistic config from Ibex UL
  function makeConfig(): SimConfig {
    const controls = defaultControls()
    const segments = makeIbexAeroSegments()
    const polar = ibexulContinuous
    return {
      segments,
      controls,
      cgMeters: computeCenterOfMass(polar.massSegments!, 1.875, polar.m),
      inertia: computeInertia(polar.massSegments!, 1.875, polar.m),
      mass: polar.m,
      height: 1.875,
      rho: 1.225,
    }
  }

  it('free fall (no airspeed): gravity dominates', () => {
    const config = makeConfig()
    // Zero velocity — just gravity
    const state: SimState = {
      x: 0, y: 0, z: 0,
      u: 0, v: 0, w: 0,
      phi: 0, theta: 0, psi: 0,
      p: 0, q: 0, r: 0,
    }

    const d = computeDerivatives(state, config)

    // With zero airspeed, aero forces ≈ 0 (drag at zero speed = 0)
    // Gravity: gx = 0, gy = 0, gz = g ≈ 9.81
    // wDot ≈ g (falling straight down in body frame)
    expect(d.wDot).toBeCloseTo(g, 0)
    expect(d.uDot).toBeCloseTo(0, 0)
    // Position derivatives = 0 (no velocity)
    expect(d.xDot).toBeCloseTo(0, 10)
    expect(d.yDot).toBeCloseTo(0, 10)
    expect(d.zDot).toBeCloseTo(0, 10)
  })

  it('returns 12 finite derivatives for trim-like state', () => {
    const config = makeConfig()
    // Approximate trim: ~12 m/s forward, ~8° pitch down (glide angle)
    const state: SimState = {
      x: 0, y: 0, z: -1000,
      u: 11.8, v: 0, w: 1.7,
      phi: 0, theta: -6 * DEG, psi: 0,
      p: 0, q: 0, r: 0,
    }

    const d = computeDerivatives(state, config)

    // All derivatives should be finite
    for (const key of Object.keys(d) as (keyof SimDerivatives)[]) {
      expect(Number.isFinite(d[key])).toBe(true)
    }

    // At approximate trim, accelerations should be small (not exactly zero
    // because we haven't trimmed precisely)
    expect(Math.abs(d.uDot)).toBeLessThan(20)
    expect(Math.abs(d.wDot)).toBeLessThan(20)
  })
})

// ─── forwardEuler ───────────────────────────────────────────────────────────

describe('forwardEuler', () => {
  it('constant velocity → position advances linearly', () => {
    const state: SimState = {
      x: 0, y: 0, z: 0,
      u: 10, v: 0, w: 0,
      phi: 0, theta: 0, psi: 0,
      p: 0, q: 0, r: 0,
    }

    // Derivatives: only xDot = 10 (flying north)
    const deriv: SimDerivatives = {
      xDot: 10, yDot: 0, zDot: 0,
      uDot: 0, vDot: 0, wDot: 0,
      phiDot: 0, thetaDot: 0, psiDot: 0,
      pDot: 0, qDot: 0, rDot: 0,
    }

    const next = forwardEuler(state, deriv, 0.1)

    expect(next.x).toBeCloseTo(1.0, 10)  // 10 m/s × 0.1 s
    expect(next.u).toBeCloseTo(10, 10)   // unchanged
    expect(next.y).toBeCloseTo(0, 10)
    expect(next.z).toBeCloseTo(0, 10)
  })

  it('constant acceleration → velocity increments', () => {
    const state: SimState = {
      x: 0, y: 0, z: 0,
      u: 0, v: 0, w: 0,
      phi: 0, theta: 0, psi: 0,
      p: 0, q: 0, r: 0,
    }

    const deriv: SimDerivatives = {
      xDot: 0, yDot: 0, zDot: 0,
      uDot: 0, vDot: 0, wDot: g,  // free fall
      phiDot: 0, thetaDot: 0, psiDot: 0,
      pDot: 0, qDot: 0, rDot: 0,
    }

    const next = forwardEuler(state, deriv, 1.0)

    expect(next.w).toBeCloseTo(g, 6)  // 0 + g × 1
  })
})

// ─── simulate ───────────────────────────────────────────────────────────────

describe('simulate', () => {
  function makeConfig(): SimConfig {
    const controls = defaultControls()
    const segments = makeIbexAeroSegments()
    const polar = ibexulContinuous
    return {
      segments,
      controls,
      cgMeters: computeCenterOfMass(polar.massSegments!, 1.875, polar.m),
      inertia: computeInertia(polar.massSegments!, 1.875, polar.m),
      mass: polar.m,
      height: 1.875,
      rho: 1.225,
    }
  }

  it('free fall for 1 second → downward velocity ≈ g', () => {
    const config = makeConfig()
    const state: SimState = {
      x: 0, y: 0, z: 0,
      u: 0, v: 0, w: 0,
      phi: 0, theta: 0, psi: 0,
      p: 0, q: 0, r: 0,
    }

    // 50 steps × 0.02 s = 1 second
    const final = simulate(state, config, 0.02, 50)

    // After 1s of free fall, w ≈ g (≈9.8 m/s)
    // Some drag will have built up, so w < g, but should be in the ballpark
    expect(final.w).toBeGreaterThan(5)
    expect(final.w).toBeLessThan(12)

    // Should have fallen some distance (z increases in NED)
    expect(final.z).toBeGreaterThan(2)
  })

  it('gliding flight for 2 seconds remains stable', () => {
    const config = makeConfig()
    const state: SimState = {
      x: 0, y: 0, z: -1000,
      u: 11.8, v: 0, w: 1.7,
      phi: 0, theta: -6 * DEG, psi: 0,
      p: 0, q: 0, r: 0,
    }

    // 2 seconds at 50 Hz
    const final = simulate(state, config, 0.02, 100)

    // Should still be flying (not crashed to zero speed or diverged)
    const speed = Math.sqrt(final.u ** 2 + final.v ** 2 + final.w ** 2)
    expect(speed).toBeGreaterThan(5)
    expect(speed).toBeLessThan(30)

    // Attitude should be reasonable (not tumbling)
    expect(Math.abs(final.phi)).toBeLessThan(Math.PI)
    expect(Math.abs(final.theta)).toBeLessThan(Math.PI / 2)

    // Should have moved forward (x increasing, heading north)
    expect(final.x).toBeGreaterThan(10)

    // All states finite
    for (const key of ['x', 'y', 'z', 'u', 'v', 'w', 'phi', 'theta', 'psi', 'p', 'q', 'r'] as const) {
      expect(Number.isFinite(final[key])).toBe(true)
    }
  })
})

// ─── rk4Step ────────────────────────────────────────────────────────────────

describe('rk4Step', () => {
  function makeConfig(): SimConfig {
    const controls = defaultControls()
    const segments = makeIbexAeroSegments()
    const polar = ibexulContinuous
    return {
      segments,
      controls,
      cgMeters: computeCenterOfMass(polar.massSegments!, 1.875, polar.m),
      inertia: computeInertia(polar.massSegments!, 1.875, polar.m),
      mass: polar.m,
      height: 1.875,
      rho: 1.225,
    }
  }

  it('produces finite state from trim-like conditions', () => {
    const config = makeConfig()
    const state: SimState = {
      x: 0, y: 0, z: -1000,
      u: 11.8, v: 0, w: 1.7,
      phi: 0, theta: -6 * DEG, psi: 0,
      p: 0, q: 0, r: 0,
    }

    const next = rk4Step(state, config, 0.02)

    for (const key of ['x', 'y', 'z', 'u', 'v', 'w', 'phi', 'theta', 'psi', 'p', 'q', 'r'] as const) {
      expect(Number.isFinite(next[key])).toBe(true)
    }
  })

  it('RK4 and Euler converge for smooth dynamics', () => {
    const config = makeConfig()
    const state: SimState = {
      x: 0, y: 0, z: -1000,
      u: 11.8, v: 0, w: 1.7,
      phi: 0, theta: -6 * DEG, psi: 0,
      p: 0, q: 0, r: 0,
    }

    // Single step comparison
    const deriv = computeDerivatives(state, config)
    const euler1 = forwardEuler(state, deriv, 0.02)
    const rk41 = rk4Step(state, config, 0.02)

    // For a single small step, both should be close
    expect(rk41.u).toBeCloseTo(euler1.u, 1)
    expect(rk41.w).toBeCloseTo(euler1.w, 1)
    expect(rk41.theta).toBeCloseTo(euler1.theta, 2)
  })
})
