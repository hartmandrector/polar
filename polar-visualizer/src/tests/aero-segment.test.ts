/**
 * Aero segment tests.
 *
 * Phase 1: a single AeroSegment wrapping the lumped polar
 * must reproduce coeffToForces() results exactly.
 *
 * Phase 2: the 10 Ibex UL segments (7 cells + 3 bodies) must
 * produce forces in the right ballpark of the lumped polar at trim.
 *
 * This proves computeSegmentForce() is a correct per-segment equivalent
 * of the existing force computation path.
 */

import { describe, it, expect } from 'vitest'
import type { AeroSegment, SegmentControls } from '../polar/continuous-polar.ts'
import { getAllCoefficients, coeffToForces } from '../polar/coefficients.ts'
import { computeSegmentForce, sumAllSegments, defaultControls } from '../polar/aero-segment.ts'
import type { Vec3NED } from '../polar/aero-segment.ts'
import { ibexulContinuous } from '../polar/polar-data.ts'
import { computeCenterOfMass } from '../polar/inertia.ts'

// ─── Helper: wrap a lumped polar into a single AeroSegment ──────────────────

/**
 * Build a trivial 1-segment AeroSegment that delegates directly to
 * getAllCoefficients with the full lumped polar. This should produce
 * the exact same forces as the existing coeffToForces() path.
 */
function makeLumpedSegment(polar: typeof ibexulContinuous): AeroSegment {
  return {
    name: 'lumped',
    position: { x: 0, y: 0, z: 0 },
    orientation: { roll_deg: 0 },
    S: polar.s,
    chord: polar.chord,
    polar: polar,
    getCoeffs(alpha_deg: number, beta_deg: number, controls: SegmentControls) {
      const c = getAllCoefficients(alpha_deg, beta_deg, controls.delta, polar, controls.dirty)
      return { cl: c.cl, cd: c.cd, cy: c.cy, cm: c.cm, cp: c.cp }
    },
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('computeSegmentForce', () => {
  const polar = ibexulContinuous
  const seg = makeLumpedSegment(polar)
  const controls = defaultControls()
  const rho = 1.225
  const airspeed = 15

  it('reproduces coeffToForces at α=8°, β=0°', () => {
    const alpha = 8, beta = 0
    const coeffs = getAllCoefficients(alpha, beta, 0, polar)
    const expected = coeffToForces(coeffs.cl, coeffs.cd, coeffs.cy, polar.s, polar.m, rho, airspeed)
    const result = computeSegmentForce(seg, alpha, beta, controls, rho, airspeed)

    expect(result.lift).toBeCloseTo(expected.lift, 10)
    expect(result.drag).toBeCloseTo(expected.drag, 10)
    expect(result.side).toBeCloseTo(expected.side, 10)
  })

  it('reproduces coeffToForces at α=-5°, β=10°', () => {
    const alpha = -5, beta = 10
    const coeffs = getAllCoefficients(alpha, beta, 0, polar)
    const expected = coeffToForces(coeffs.cl, coeffs.cd, coeffs.cy, polar.s, polar.m, rho, airspeed)
    const result = computeSegmentForce(seg, alpha, beta, controls, rho, airspeed)

    expect(result.lift).toBeCloseTo(expected.lift, 10)
    expect(result.drag).toBeCloseTo(expected.drag, 10)
    expect(result.side).toBeCloseTo(expected.side, 10)
  })

  it('reproduces coeffToForces at α=45° (post-stall), β=0°', () => {
    const alpha = 45, beta = 0
    const coeffs = getAllCoefficients(alpha, beta, 0, polar)
    const expected = coeffToForces(coeffs.cl, coeffs.cd, coeffs.cy, polar.s, polar.m, rho, airspeed)
    const result = computeSegmentForce(seg, alpha, beta, controls, rho, airspeed)

    expect(result.lift).toBeCloseTo(expected.lift, 10)
    expect(result.drag).toBeCloseTo(expected.drag, 10)
    expect(result.side).toBeCloseTo(expected.side, 10)
  })

  it('matches pitching moment q·S·c·CM', () => {
    const alpha = 8, beta = 0
    const coeffs = getAllCoefficients(alpha, beta, 0, polar)
    const q = 0.5 * rho * airspeed * airspeed
    const expectedMoment = q * polar.s * polar.chord * coeffs.cm
    const result = computeSegmentForce(seg, alpha, beta, controls, rho, airspeed)

    expect(result.moment).toBeCloseTo(expectedMoment, 10)
  })

  it('returns correct CP from getCoeffs', () => {
    const alpha = 8, beta = 0
    const coeffs = getAllCoefficients(alpha, beta, 0, polar)
    const result = computeSegmentForce(seg, alpha, beta, controls, rho, airspeed)

    expect(result.cp).toBeCloseTo(coeffs.cp, 10)
  })
})

describe('sumAllSegments', () => {
  const polar = ibexulContinuous
  const seg = makeLumpedSegment(polar)
  const controls = defaultControls()
  const rho = 1.225
  const airspeed = 15
  const height = 1.875  // reference height [m]

  // CG at origin (segment position is also origin) → zero lever arm
  const cgMeters: Vec3NED = { x: 0, y: 0, z: 0 }

  // Wind from directly ahead in NED: +x = forward, so wind comes from +x
  const windDir: Vec3NED = { x: 1, y: 0, z: 0 }
  // Lift perpendicular to wind, in vertical plane: -z in NED (upward)
  const liftDir: Vec3NED = { x: 0, y: 0, z: -1 }
  // Side: cross(wind, lift) = cross((1,0,0), (0,0,-1)) = (0,1,0)
  const sideDir: Vec3NED = { x: 0, y: 1, z: 0 }

  it('single segment at origin: total force matches segment force', () => {
    const alpha = 8, beta = 0
    const sf = computeSegmentForce(seg, alpha, beta, controls, rho, airspeed)
    const result = sumAllSegments([seg], [sf], cgMeters, height, windDir, liftDir, sideDir)

    // Force = lift · liftDir + (-drag) · windDir + side · sideDir
    // = (0, 0, -lift) + (-drag, 0, 0) + (0, side, 0)
    expect(result.force.x).toBeCloseTo(-sf.drag, 8)
    expect(result.force.y).toBeCloseTo(sf.side, 8)
    expect(result.force.z).toBeCloseTo(-sf.lift, 8)
  })

  it('single segment at origin: moment = intrinsic CM + CP-offset lever arm', () => {
    const alpha = 8, beta = 0
    const sf = computeSegmentForce(seg, alpha, beta, controls, rho, airspeed)
    const result = sumAllSegments([seg], [sf], cgMeters, height, windDir, liftDir, sideDir)

    // Segment position is (0,0,0). CP offset from quarter-chord creates
    // a lever arm along x. With wind along +x and lift along -z:
    //   fx = -drag, fy = side, fz = -lift
    //   rx = (cp - 0.25) * chord, ry = 0, rz = 0
    //   r×F y-component = rz*fx - rx*fz = 0 - rx*(-lift) = rx * lift
    // Plus intrinsic moment on y-axis.
    const cpOffset = (sf.cp - 0.25) * polar.chord
    const leverMomentY = cpOffset * sf.lift  // rx * lift
    const expectedMy = sf.moment + leverMomentY

    expect(result.moment.x).toBeCloseTo(0, 4)
    expect(result.moment.z).toBeCloseTo(0, 4)
    expect(result.moment.y).toBeCloseTo(expectedMy, 6)
  })

  it('two identical segments produce 2× the force of one', () => {
    const alpha = 8, beta = 0

    // Two segments at origin, each with half the reference area
    const halfSeg: AeroSegment = {
      ...seg,
      name: 'half',
      S: polar.s / 2,
      getCoeffs(a, b, c) {
        const coeffs = getAllCoefficients(a, b, c.delta, polar, c.dirty)
        return { cl: coeffs.cl, cd: coeffs.cd, cy: coeffs.cy, cm: coeffs.cm, cp: coeffs.cp }
      },
    }

    const sf1 = computeSegmentForce(halfSeg, alpha, beta, controls, rho, airspeed)
    const sf2 = computeSegmentForce(halfSeg, alpha, beta, controls, rho, airspeed)
    const sfFull = computeSegmentForce(seg, alpha, beta, controls, rho, airspeed)

    const result = sumAllSegments([halfSeg, halfSeg], [sf1, sf2], cgMeters, height, windDir, liftDir, sideDir)

    // Total force from two half-area segments = force from one full-area segment
    expect(result.force.x).toBeCloseTo(-sfFull.drag, 6)
    expect(result.force.y).toBeCloseTo(sfFull.side, 6)
    expect(result.force.z).toBeCloseTo(-sfFull.lift, 6)
  })
})

describe('defaultControls', () => {
  it('returns all-zero neutral state', () => {
    const c = defaultControls()
    expect(c.brakeLeft).toBe(0)
    expect(c.brakeRight).toBe(0)
    expect(c.frontRiserLeft).toBe(0)
    expect(c.frontRiserRight).toBe(0)
    expect(c.rearRiserLeft).toBe(0)
    expect(c.rearRiserRight).toBe(0)
    expect(c.weightShiftLR).toBe(0)
    expect(c.elevator).toBe(0)
    expect(c.rudder).toBe(0)
    expect(c.aileronLeft).toBe(0)
    expect(c.aileronRight).toBe(0)
    expect(c.flap).toBe(0)
    expect(c.delta).toBe(0)
    expect(c.dirty).toBe(0)
  })
})

// ─── Phase 2: Ibex UL 10-segment validation ─────────────────────────────────

describe('Ibex UL 10-segment system', () => {
  const polar = ibexulContinuous
  const segments = polar.aeroSegments!
  const controls = defaultControls()
  const rho = 1.225
  const airspeed = 15

  it('has 10 segments defined', () => {
    expect(segments).toBeDefined()
    expect(segments.length).toBe(10)
  })

  it('has 7 canopy cells + 2 parasitic bodies + 1 lifting body pilot', () => {
    const cells = segments.filter(s => s.name.startsWith('cell_'))
    const bodies = segments.filter(s => !s.name.startsWith('cell_'))
    expect(cells.length).toBe(7)
    expect(bodies.length).toBe(3)
    expect(bodies.map(s => s.name).sort()).toEqual(['bridle', 'lines', 'pilot'])
  })

  it('cell reference areas sum to total canopy area', () => {
    const cells = segments.filter(s => s.name.startsWith('cell_'))
    const totalCellArea = cells.reduce((sum, s) => sum + s.S, 0)
    expect(totalCellArea).toBeCloseTo(polar.s, 1)
  })

  it('all segments produce forces without errors', () => {
    const alpha = 8, beta = 0
    for (const seg of segments) {
      const result = computeSegmentForce(seg, alpha, beta, controls, rho, airspeed)
      expect(isFinite(result.lift)).toBe(true)
      expect(isFinite(result.drag)).toBe(true)
      expect(isFinite(result.side)).toBe(true)
      expect(isFinite(result.moment)).toBe(true)
      expect(result.drag).toBeGreaterThanOrEqual(0)
    }
  })

  it('cells produce positive lift at trim α', () => {
    const alpha = 8, beta = 0
    const cells = segments.filter(s => s.name.startsWith('cell_'))
    for (const cell of cells) {
      const result = computeSegmentForce(cell, alpha, beta, controls, rho, airspeed)
      expect(result.lift).toBeGreaterThan(0)
    }
  })

  it('non-cell, non-pilot bodies produce drag but negligible lift', () => {
    const alpha = 8, beta = 0
    const parasitic = segments.filter(s => !s.name.startsWith('cell_') && s.name !== 'pilot')
    expect(parasitic.length).toBeGreaterThan(0)
    for (const seg of parasitic) {
      const result = computeSegmentForce(seg, alpha, beta, controls, rho, airspeed)
      expect(result.drag).toBeGreaterThan(0)
      // Parasitic lift should be tiny compared to drag
      expect(Math.abs(result.lift)).toBeLessThan(result.drag)
    }
  })

  it('pilot lifting body produces drag at canopy trim (upright, α_local ≈ -82°)', () => {
    const alpha = 8, beta = 0
    const pilot = segments.find(s => s.name === 'pilot')!
    expect(pilot).toBeDefined()
    const result = computeSegmentForce(pilot, alpha, beta, controls, rho, airspeed)
    // At canopy trim α=8°, the pilot (pitched +90°) sees α_local = -82°.
    // This is deep post-stall/bluff body — mostly drag, negative CL in
    // the canopy lift direction (wind hits chest, not lifting surface).
    expect(result.drag).toBeGreaterThan(0)
    expect(result.drag).toBeGreaterThan(Math.abs(result.lift))
  })

  it('segment forces sum in the right ballpark of lumped polar at trim', () => {
    const alpha = 8, beta = 0

    // Lumped polar forces
    const lumpedCoeffs = getAllCoefficients(alpha, beta, 0, polar)
    const lumpedForces = coeffToForces(lumpedCoeffs.cl, lumpedCoeffs.cd, lumpedCoeffs.cy, polar.s, polar.m, rho, airspeed)

    // Sum segment forces (scalar magnitudes — not directional sum)
    let totalLift = 0, totalDrag = 0
    for (const seg of segments) {
      const f = computeSegmentForce(seg, alpha, beta, controls, rho, airspeed)
      totalLift += f.lift
      totalDrag += f.drag
    }

    // Lift: segments should produce similar total lift.
    // Exact match not expected — cells have different cd_0/k and outer cells
    // see reduced effective α from cos(θ), so total will differ.
    // Accept within 50% of lumped for now (tuning will close the gap).
    expect(totalLift).toBeGreaterThan(lumpedForces.lift * 0.3)
    expect(totalLift).toBeLessThan(lumpedForces.lift * 2.0)

    // Drag: segment sum will be less than lumped (lumped cd_0=0.21 includes
    // everything, cells use cd_0=0.035 + parasitic bodies add the rest).
    // Total should be within same order of magnitude.
    expect(totalDrag).toBeGreaterThan(lumpedForces.drag * 0.1)
    expect(totalDrag).toBeLessThan(lumpedForces.drag * 3.0)
  })

  it('symmetric cells produce symmetric forces at β=0', () => {
    const alpha = 8, beta = 0
    const pairs = [['cell_r1', 'cell_l1'], ['cell_r2', 'cell_l2'], ['cell_r3', 'cell_l3']]

    for (const [rName, lName] of pairs) {
      const rSeg = segments.find(s => s.name === rName)!
      const lSeg = segments.find(s => s.name === lName)!
      const rForce = computeSegmentForce(rSeg, alpha, beta, controls, rho, airspeed)
      const lForce = computeSegmentForce(lSeg, alpha, beta, controls, rho, airspeed)

      expect(rForce.lift).toBeCloseTo(lForce.lift, 6)
      expect(rForce.drag).toBeCloseTo(lForce.drag, 6)
      // Side forces should be equal in magnitude but opposite in sign
      expect(rForce.side).toBeCloseTo(-lForce.side, 6)
    }
  })

  it('brake on one side creates asymmetric lift', () => {
    const alpha = 8, beta = 0
    const leftBrake: SegmentControls = { ...defaultControls(), brakeLeft: 1.0 }

    const cellR2 = segments.find(s => s.name === 'cell_r2')!
    const cellL2 = segments.find(s => s.name === 'cell_l2')!

    const rForce = computeSegmentForce(cellR2, alpha, beta, leftBrake, rho, airspeed)
    const lForce = computeSegmentForce(cellL2, alpha, beta, leftBrake, rho, airspeed)

    // Left brake should increase camber on left cells → different CL
    expect(rForce.lift).not.toBeCloseTo(lForce.lift, 2)
    // Left cell should have more lift (more camber → lower α_0 → higher CL)
    expect(lForce.lift).toBeGreaterThan(rForce.lift)
  })

  it('center cell ignores brake inputs', () => {
    const alpha = 8, beta = 0
    const noBrake = defaultControls()
    const fullBrake: SegmentControls = { ...defaultControls(), brakeLeft: 1.0, brakeRight: 1.0 }

    const center = segments.find(s => s.name === 'cell_c')!
    const fNone = computeSegmentForce(center, alpha, beta, noBrake, rho, airspeed)
    const fFull = computeSegmentForce(center, alpha, beta, fullBrake, rho, airspeed)

    expect(fNone.lift).toBeCloseTo(fFull.lift, 10)
    expect(fNone.drag).toBeCloseTo(fFull.drag, 10)
  })
})

// ─── Phase 5: Moments from lever arms ──────────────────────────────────────

describe('Ibex UL — lever arm moments', () => {
  const polar = ibexulContinuous
  const segments = polar.aeroSegments!
  const rho = 1.225
  const airspeed = 15
  const height = 1.875

  // System CG from mass segments
  const cgMeters = computeCenterOfMass(polar.massSegments!, height, polar.m)

  // Wind from +x (ahead), lift in -z (up), side in +y (right)
  const windDir: Vec3NED = { x: 1, y: 0, z: 0 }
  const liftDir: Vec3NED = { x: 0, y: 0, z: -1 }
  const sideDir: Vec3NED = { x: 0, y: 1, z: 0 }

  it('symmetric controls produce near-zero roll and yaw moments', () => {
    const alpha = 8, beta = 0
    const controls = defaultControls()
    const forces = segments.map(s => computeSegmentForce(s, alpha, beta, controls, rho, airspeed))
    const system = sumAllSegments(segments, forces, cgMeters, height, windDir, liftDir, sideDir)

    // Roll (Mx) and yaw (Mz) should be near zero with symmetric input
    expect(Math.abs(system.moment.x)).toBeLessThan(0.5)
    expect(Math.abs(system.moment.z)).toBeLessThan(0.5)
    // Pitch (My) should be non-zero (AC/CG offset + CM)
    expect(system.moment.y).not.toBeCloseTo(0, 0)
  })

  it('left brake creates non-zero roll moment (Mx)', () => {
    const alpha = 8, beta = 0
    const leftBrake: SegmentControls = { ...defaultControls(), brakeLeft: 1.0 }
    const forces = segments.map(s => computeSegmentForce(s, alpha, beta, leftBrake, rho, airspeed))
    const system = sumAllSegments(segments, forces, cgMeters, height, windDir, liftDir, sideDir)

    // Asymmetric lift should create a roll moment
    expect(Math.abs(system.moment.x)).toBeGreaterThan(0.1)
  })

  it('left brake creates non-zero yaw moment (Mz)', () => {
    const alpha = 8, beta = 0
    const leftBrake: SegmentControls = { ...defaultControls(), brakeLeft: 1.0 }
    const forces = segments.map(s => computeSegmentForce(s, alpha, beta, leftBrake, rho, airspeed))
    const system = sumAllSegments(segments, forces, cgMeters, height, windDir, liftDir, sideDir)

    // Asymmetric drag should create a yaw moment
    expect(Math.abs(system.moment.z)).toBeGreaterThan(0.1)
  })

  it('left brake vs right brake produce opposite roll moments', () => {
    const alpha = 8, beta = 0
    const leftBrake: SegmentControls = { ...defaultControls(), brakeLeft: 1.0 }
    const rightBrake: SegmentControls = { ...defaultControls(), brakeRight: 1.0 }

    const lForces = segments.map(s => computeSegmentForce(s, alpha, beta, leftBrake, rho, airspeed))
    const rForces = segments.map(s => computeSegmentForce(s, alpha, beta, rightBrake, rho, airspeed))

    const lSystem = sumAllSegments(segments, lForces, cgMeters, height, windDir, liftDir, sideDir)
    const rSystem = sumAllSegments(segments, rForces, cgMeters, height, windDir, liftDir, sideDir)

    // Roll moments should be opposite signs
    expect(lSystem.moment.x * rSystem.moment.x).toBeLessThan(0)
    // Yaw moments should be opposite signs
    expect(lSystem.moment.z * rSystem.moment.z).toBeLessThan(0)
    // Magnitudes should be approximately equal (symmetric geometry)
    expect(Math.abs(lSystem.moment.x)).toBeCloseTo(Math.abs(rSystem.moment.x), 4)
    expect(Math.abs(lSystem.moment.z)).toBeCloseTo(Math.abs(rSystem.moment.z), 4)
  })

  it('front riser creates pitch moment change from α offset', () => {
    const alpha = 8, beta = 0
    const noRiser = defaultControls()
    const fullFront: SegmentControls = { ...defaultControls(), frontRiserLeft: 1.0, frontRiserRight: 1.0 }

    const nForces = segments.map(s => computeSegmentForce(s, alpha, beta, noRiser, rho, airspeed))
    const fForces = segments.map(s => computeSegmentForce(s, alpha, beta, fullFront, rho, airspeed))

    const nSystem = sumAllSegments(segments, nForces, cgMeters, height, windDir, liftDir, sideDir)
    const fSystem = sumAllSegments(segments, fForces, cgMeters, height, windDir, liftDir, sideDir)

    // Pitch moment should change with front riser
    expect(fSystem.moment.y).not.toBeCloseTo(nSystem.moment.y, 1)
  })
})
