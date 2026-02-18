/**
 * Tests for apparent-mass.ts and composite-frame.ts
 *
 * Validates:
 *   - Flat-plate apparent mass formulas (translational + rotational)
 *   - Canopy geometry derivation from polar params
 *   - Deployment-scaled apparent mass
 *   - Effective mass/inertia combination
 *   - CompositeFrame assembly and caching
 *   - frameToSimConfig conversion
 *   - Anisotropic translational EOM (Lamb/Kirchhoff Coriolis)
 */

import { describe, it, expect } from 'vitest'
import {
  computeApparentMass,
  computeApparentInertia,
  computeApparentMassResult,
  canopyGeometryFromPolar,
  apparentMassAtDeploy,
  effectiveMass,
  effectiveInertia,
} from '../polar/apparent-mass.ts'
import type { CanopyGeometry } from '../polar/apparent-mass.ts'
import {
  buildCompositeFrame,
  frameNeedsRebuild,
  frameToSimConfig,
} from '../polar/composite-frame.ts'
import type { CompositeFrameConfig } from '../polar/composite-frame.ts'
import {
  ibexulContinuous,
  makeIbexAeroSegments,
  rotatePilotMass,
  translationalEOMAnisotropic,
  translationalEOM,
} from '../polar/index.ts'

// ── Test constants ──────────────────────────────────────────────────────────

/** Ibex UL canopy geometry */
const IBEX_GEOM: CanopyGeometry = canopyGeometryFromPolar(20.439, 2.5)
const RHO = 1.225

// ══════════════════════════════════════════════════════════════════════════════
//  Apparent Mass
// ══════════════════════════════════════════════════════════════════════════════

describe('computeApparentMass', () => {
  it('z-axis (normal) apparent mass is largest', () => {
    const m = computeApparentMass(IBEX_GEOM, RHO)
    expect(m.z).toBeGreaterThan(m.y * 0.01) // z is significant
    expect(m.z).toBeGreaterThan(m.x)         // z >> x
    expect(m.y).toBeGreaterThan(m.x)         // y > x (span > chord)
  })

  it('matches hand-calculated normal apparent mass', () => {
    // m_a_z = (π/4) · ρ · c² · b
    // = 0.7854 · 1.225 · 6.25 · 8.1756
    // ≈ 49.2 kg
    const m = computeApparentMass(IBEX_GEOM, RHO)
    expect(m.z).toBeCloseTo(Math.PI / 4 * RHO * 2.5 * 2.5 * IBEX_GEOM.span, 1)
  })

  it('x-axis (chordwise) is small — thin plate in its own plane', () => {
    const m = computeApparentMass(IBEX_GEOM, RHO)
    // Thickness = 10% chord = 0.25 m, so m_a_x << m_a_z
    expect(m.x).toBeLessThan(1.0) // well under 1 kg
  })

  it('scales linearly with density', () => {
    const m1 = computeApparentMass(IBEX_GEOM, 1.0)
    const m2 = computeApparentMass(IBEX_GEOM, 2.0)
    expect(m2.z / m1.z).toBeCloseTo(2.0, 5)
    expect(m2.y / m1.y).toBeCloseTo(2.0, 5)
  })
})

describe('computeApparentInertia', () => {
  it('roll inertia (Ixx) is significant', () => {
    const I = computeApparentInertia(IBEX_GEOM, RHO)
    // I_a_xx = (π/4) · ρ · c² · b³ / 12
    const expected = Math.PI / 4 * RHO * 2.5 * 2.5 * IBEX_GEOM.span ** 3 / 12
    expect(I.Ixx).toBeCloseTo(expected, 1)
  })

  it('pitch inertia (Iyy) uses chord distribution', () => {
    const I = computeApparentInertia(IBEX_GEOM, RHO)
    // I_a_yy = (π/4) · ρ · b · c³ / 12
    const expected = Math.PI / 4 * RHO * IBEX_GEOM.span * 2.5 ** 3 / 12
    expect(I.Iyy).toBeCloseTo(expected, 1)
  })

  it('yaw inertia (Izz) is small — thin plate in-plane rotation', () => {
    const I = computeApparentInertia(IBEX_GEOM, RHO)
    expect(I.Izz).toBeLessThan(I.Ixx * 0.05) // much smaller than roll
  })
})

describe('canopyGeometryFromPolar', () => {
  it('derives span from area / chord', () => {
    const geom = canopyGeometryFromPolar(20.439, 2.5)
    expect(geom.span).toBeCloseTo(20.439 / 2.5, 6)
    expect(geom.chord).toBe(2.5)
    expect(geom.area).toBe(20.439)
  })
})

describe('apparentMassAtDeploy', () => {
  it('full deploy matches direct computation', () => {
    const full = computeApparentMassResult(IBEX_GEOM, RHO)
    const atDeploy = apparentMassAtDeploy(IBEX_GEOM, 1.0, RHO)
    expect(atDeploy.mass.z).toBeCloseTo(full.mass.z, 1)
    expect(atDeploy.inertia.Ixx).toBeCloseTo(full.inertia.Ixx, 1)
  })

  it('zero deploy has much smaller apparent mass', () => {
    const full = computeApparentMassResult(IBEX_GEOM, RHO)
    const packed = apparentMassAtDeploy(IBEX_GEOM, 0.0, RHO)
    expect(packed.mass.z).toBeLessThan(full.mass.z * 0.1)
  })

  it('half deploy is intermediate', () => {
    const full = computeApparentMassResult(IBEX_GEOM, RHO)
    const packed = apparentMassAtDeploy(IBEX_GEOM, 0.0, RHO)
    const half = apparentMassAtDeploy(IBEX_GEOM, 0.5, RHO)
    expect(half.mass.z).toBeGreaterThan(packed.mass.z)
    expect(half.mass.z).toBeLessThan(full.mass.z)
  })
})

describe('effectiveMass / effectiveInertia', () => {
  it('adds apparent mass to physical mass per axis', () => {
    const apparent = computeApparentMass(IBEX_GEOM, RHO)
    const eff = effectiveMass(77.5, apparent)
    expect(eff.x).toBeCloseTo(77.5 + apparent.x, 5)
    expect(eff.y).toBeCloseTo(77.5 + apparent.y, 5)
    expect(eff.z).toBeCloseTo(77.5 + apparent.z, 5)
  })

  it('adds apparent inertia to diagonal only', () => {
    const physI = { Ixx: 10, Iyy: 20, Izz: 5, Ixy: -1, Ixz: -2, Iyz: -0.5 }
    const appI = computeApparentInertia(IBEX_GEOM, RHO)
    const eff = effectiveInertia(physI, appI)
    expect(eff.Ixx).toBeCloseTo(10 + appI.Ixx, 5)
    expect(eff.Iyy).toBeCloseTo(20 + appI.Iyy, 5)
    expect(eff.Izz).toBeCloseTo(5 + appI.Izz, 5)
    // Off-diagonal unchanged
    expect(eff.Ixy).toBe(-1)
    expect(eff.Ixz).toBe(-2)
    expect(eff.Iyz).toBe(-0.5)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
//  Anisotropic Translational EOM
// ══════════════════════════════════════════════════════════════════════════════

describe('translationalEOMAnisotropic', () => {
  it('matches isotropic EOM when masses are equal', () => {
    const force = { x: 100, y: -50, z: 200 }
    const vel = { x: 12, y: -2, z: 4 }
    const omega = { p: 0.1, q: -0.05, r: 0.03 }
    const mass = 77.5

    const iso = translationalEOM(force, mass, vel, omega)
    const aniso = translationalEOMAnisotropic(
      force, { x: mass, y: mass, z: mass }, vel, omega,
    )
    expect(aniso.uDot).toBeCloseTo(iso.uDot, 10)
    expect(aniso.vDot).toBeCloseTo(iso.vDot, 10)
    expect(aniso.wDot).toBeCloseTo(iso.wDot, 10)
  })

  it('produces different Coriolis coupling with anisotropic mass', () => {
    const force = { x: 0, y: 0, z: 0 }
    const vel = { x: 10, y: 0, z: 5 }
    const omega = { p: 0, q: 0.1, r: 0 }

    // Isotropic: u̇ = -q·w, ẇ = q·u
    const iso = translationalEOM(force, 100, vel, omega)

    // Anisotropic with m_z >> m_x:
    // u̇ = (F_x + m_y·r·v - m_z·q·w) / m_x = -m_z·q·w / m_x
    // With m_z = 200, m_x = 100: u̇ = -200·0.1·5 / 100 = -1.0
    // Iso: u̇ = -0.1·5 = -0.5
    const aniso = translationalEOMAnisotropic(
      force, { x: 100, y: 100, z: 200 }, vel, omega,
    )
    expect(Math.abs(aniso.uDot)).toBeGreaterThan(Math.abs(iso.uDot))
    expect(aniso.uDot).toBeCloseTo(-200 * 0.1 * 5 / 100, 10)
  })

  it('zero angular rate gives same result regardless of mass anisotropy', () => {
    const force = { x: 100, y: -50, z: 200 }
    const vel = { x: 12, y: -2, z: 4 }
    const omega = { p: 0, q: 0, r: 0 }

    const iso = translationalEOM(force, 80, vel, omega)
    const aniso = translationalEOMAnisotropic(
      force, { x: 80, y: 120, z: 160 }, vel, omega,
    )
    // With ω=0, only F/m_axis matters
    expect(aniso.uDot).toBeCloseTo(100 / 80, 10)
    expect(aniso.vDot).toBeCloseTo(-50 / 120, 10)
    expect(aniso.wDot).toBeCloseTo(200 / 160, 10)
    // Isotropic: all use m=80
    expect(iso.uDot).toBeCloseTo(100 / 80, 10)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
//  Composite Frame
// ══════════════════════════════════════════════════════════════════════════════

describe('buildCompositeFrame', () => {
  function makeFrameConfig(): CompositeFrameConfig {
    return {
      polar: ibexulContinuous,
      makeAeroSegments: () => makeIbexAeroSegments(),
      rotatePilotMass: rotatePilotMass,
      height: 1.875,
      rho: RHO,
    }
  }

  it('produces valid CG within segment bounds', () => {
    const frame = buildCompositeFrame(makeFrameConfig())
    // CG should be near origin in x, and in the z > 0 (below) region
    expect(frame.cg.x).toBeDefined()
    expect(frame.cg.z).toBeDefined()
    expect(frame.totalMass).toBe(77.5)
  })

  it('has positive definite inertia', () => {
    const frame = buildCompositeFrame(makeFrameConfig())
    expect(frame.inertia.Ixx).toBeGreaterThan(0)
    expect(frame.inertia.Iyy).toBeGreaterThan(0)
    expect(frame.inertia.Izz).toBeGreaterThan(0)
  })

  it('effective mass > physical mass (apparent mass adds)', () => {
    const frame = buildCompositeFrame(makeFrameConfig())
    expect(frame.effectiveMass.x).toBeGreaterThan(frame.totalMass)
    expect(frame.effectiveMass.y).toBeGreaterThan(frame.totalMass)
    expect(frame.effectiveMass.z).toBeGreaterThan(frame.totalMass)
  })

  it('effective inertia > physical inertia', () => {
    const frame = buildCompositeFrame(makeFrameConfig())
    expect(frame.effectiveInertia.Ixx).toBeGreaterThan(frame.inertia.Ixx)
    expect(frame.effectiveInertia.Iyy).toBeGreaterThan(frame.inertia.Iyy)
    expect(frame.effectiveInertia.Izz).toBeGreaterThan(frame.inertia.Izz)
  })

  it('deploy=0 gives smaller apparent mass than deploy=1', () => {
    const cfg = makeFrameConfig()
    const packed = buildCompositeFrame(cfg, 0)
    const full = buildCompositeFrame(cfg, 1)
    expect(packed.apparentMass.mass.z).toBeLessThan(full.apparentMass.mass.z)
  })

  it('records deploy and pilotPitch in the frame', () => {
    const frame = buildCompositeFrame(makeFrameConfig(), 0.5, 10)
    expect(frame.deploy).toBe(0.5)
    expect(frame.pilotPitch).toBe(10)
  })
})

describe('frameNeedsRebuild', () => {
  it('returns false when nothing changed', () => {
    const cfg: CompositeFrameConfig = {
      polar: ibexulContinuous,
      makeAeroSegments: () => makeIbexAeroSegments(),
      rotatePilotMass: rotatePilotMass,
      height: 1.875,
      rho: RHO,
    }
    const frame = buildCompositeFrame(cfg, 1.0, 0)
    expect(frameNeedsRebuild(frame, 1.0, 0)).toBe(false)
  })

  it('returns true when deploy changes', () => {
    const cfg: CompositeFrameConfig = {
      polar: ibexulContinuous,
      makeAeroSegments: () => makeIbexAeroSegments(),
      rotatePilotMass: rotatePilotMass,
      height: 1.875,
      rho: RHO,
    }
    const frame = buildCompositeFrame(cfg, 0.5, 0)
    expect(frameNeedsRebuild(frame, 0.7, 0)).toBe(true)
  })

  it('returns true when pilot pitch changes', () => {
    const cfg: CompositeFrameConfig = {
      polar: ibexulContinuous,
      makeAeroSegments: () => makeIbexAeroSegments(),
      rotatePilotMass: rotatePilotMass,
      height: 1.875,
      rho: RHO,
    }
    const frame = buildCompositeFrame(cfg, 1.0, 0)
    expect(frameNeedsRebuild(frame, 1.0, 5)).toBe(true)
  })
})

describe('frameToSimConfig', () => {
  it('produces a valid SimConfig with apparent mass', () => {
    const cfg: CompositeFrameConfig = {
      polar: ibexulContinuous,
      makeAeroSegments: () => makeIbexAeroSegments(),
      rotatePilotMass: rotatePilotMass,
      height: 1.875,
      rho: RHO,
    }
    const frame = buildCompositeFrame(cfg)
    const controls = {
      brakeLeft: 0, brakeRight: 0,
      frontRiserLeft: 0, frontRiserRight: 0,
      rearRiserLeft: 0, rearRiserRight: 0,
      weightShiftLR: 0, elevator: 0, rudder: 0,
      aileronLeft: 0, aileronRight: 0, flap: 0,
      pitchThrottle: 0, yawThrottle: 0, rollThrottle: 0, dihedral: 0.5, wingsuitDeploy: 0,
      delta: 0, dirty: 0, unzip: 0,
      pilotPitch: 0, deploy: 1,
    }
    const simCfg = frameToSimConfig(frame, controls, true)

    expect(simCfg.segments.length).toBeGreaterThan(0)
    expect(simCfg.mass).toBe(77.5)
    expect(simCfg.massPerAxis).toBeDefined()
    expect(simCfg.massPerAxis!.z).toBeGreaterThan(77.5)
    expect(simCfg.inertia.Ixx).toBeGreaterThan(0)
  })

  it('without apparent mass, massPerAxis is undefined', () => {
    const cfg: CompositeFrameConfig = {
      polar: ibexulContinuous,
      makeAeroSegments: () => makeIbexAeroSegments(),
      rotatePilotMass: rotatePilotMass,
      height: 1.875,
      rho: RHO,
    }
    const frame = buildCompositeFrame(cfg)
    const controls = {
      brakeLeft: 0, brakeRight: 0,
      frontRiserLeft: 0, frontRiserRight: 0,
      rearRiserLeft: 0, rearRiserRight: 0,
      weightShiftLR: 0, elevator: 0, rudder: 0,
      aileronLeft: 0, aileronRight: 0, flap: 0,
      pitchThrottle: 0, yawThrottle: 0, rollThrottle: 0, dihedral: 0.5, wingsuitDeploy: 0,
      delta: 0, dirty: 0, unzip: 0,
      pilotPitch: 0, deploy: 1,
    }
    const simCfg = frameToSimConfig(frame, controls, false)
    expect(simCfg.massPerAxis).toBeUndefined()
    expect(simCfg.mass).toBe(77.5)
  })
})
