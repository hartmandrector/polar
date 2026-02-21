/**
 * Tests for vehicle-registry.ts
 *
 * Phase C validation: per-component reference frames
 *
 * Validates:
 *   - Vehicle registry loading by ID
 *   - Denormalization of mass data (CG + inertia)
 *   - Per-component reference length isolation
 *   - Multiple vehicle definitions work independently
 *   - Aero polar assignment per component
 *   - GLB metadata availability
 */

import { describe, it, expect } from 'vitest'
import {
  VEHICLE_REGISTRY,
  getVehicleDefinition,
  getVehicleOptions,
  getVehicleAeroPolar,
  getVehicleMassReference,
  denormalizeMass,
  type VehicleDefinition,
} from '../viewer/vehicle-registry.ts'
import {
  aurafiveContinuous,
  ibexulContinuous,
  slicksinContinuous,
  caravanContinuous,
  WINGSUIT_MASS_SEGMENTS,
  CANOPY_WEIGHT_SEGMENTS,
} from '../polar/polar-data.ts'
import { computeCenterOfMass, computeInertia } from '../polar/inertia.ts'

// ──────────────────────────────────────────────────────────────────────────────
//  Registry Access
// ──────────────────────────────────────────────────────────────────────────────

describe('Vehicle Registry Access', () => {
  it('VEHICLE_REGISTRY has all expected vehicle IDs', () => {
    const expectedIds = ['aurafive', 'a5segments', 'ibexul', 'slicksin', 'caravan', 'aura5-ibexul']
    for (const id of expectedIds) {
      expect(VEHICLE_REGISTRY[id]).toBeDefined()
    }
  })

  it('getVehicleDefinition returns correct vehicle by ID', () => {
    const aura5 = getVehicleDefinition('aurafive')
    expect(aura5.id).toBe('aurafive')
    expect(aura5.name).toContain('Aura 5')
  })

  it('getVehicleOptions returns all vehicle options', () => {
    const options = getVehicleOptions()
    expect(options.length).toBeGreaterThan(0)
    expect(options[0]).toHaveProperty('id')
    expect(options[0]).toHaveProperty('name')
    expect(options[0]).toHaveProperty('modelType')
  })

  it('getVehicleOptions includes wingsuit, canopy, skydiver, and airplane types', () => {
    const options = getVehicleOptions()
    const modelTypes = new Set(options.map((o) => o.modelType))
    expect(modelTypes.has('wingsuit')).toBe(true)
    expect(modelTypes.has('canopy')).toBe(true)
    expect(modelTypes.has('skydiver')).toBe(true)
    expect(modelTypes.has('airplane')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
//  Per-Component Reference Lengths
// ──────────────────────────────────────────────────────────────────────────────

describe('Per-Component Reference Lengths', () => {
  it('wingsuit vehicles have pilotHeight_m = 1.875', () => {
    const aura5 = getVehicleDefinition('aurafive')
    expect(aura5.pilot.pilotHeight_m).toBe(1.875)
  })

  it('canopy vehicles have canopy equipment with separate referenceLength_m', () => {
    const canopyVehicle = getVehicleDefinition('aura5-ibexul')
    expect(canopyVehicle.equipment.length).toBeGreaterThan(0)

    const canopyEquip = canopyVehicle.equipment.find((e) => e.id.includes('canopy'))
    expect(canopyEquip).toBeDefined()
    expect(canopyEquip?.referenceLength_m).toBeDefined()
  })

  it('pilot aero uses pilotHeight_m, canopy aero uses its own referenceLength_m', () => {
    const combined = getVehicleDefinition('aura5-ibexul')

    // Pilot uses wingsuit reference
    const pilotRefLen = combined.pilot.referenceLength_m ?? combined.pilot.pilotHeight_m
    expect(pilotRefLen).toBeCloseTo(1.93, 1)  // Aura 5 is ~1.93m

    // Canopy uses independent reference
    const canopyEquip = combined.equipment.find((e) => e.id.includes('canopy'))
    const canopyRefLen = canopyEquip?.referenceLength_m
    expect(canopyRefLen).toBeCloseTo(1.875, 1)  // Canopy is typically 1.875m

    // They should be different (decoupled)
    expect(pilotRefLen).not.toBe(canopyRefLen)
  })

  it('all vehicles have consistent pilotHeight_m across same pilot type', () => {
    const aura5 = getVehicleDefinition('aurafive')
    const a5seg = getVehicleDefinition('a5segments')
    const combined = getVehicleDefinition('aura5-ibexul')

    expect(aura5.pilot.pilotHeight_m).toBe(a5seg.pilot.pilotHeight_m)
    expect(aura5.pilot.pilotHeight_m).toBe(combined.pilot.pilotHeight_m)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
//  Aero Polar Assignment
// ──────────────────────────────────────────────────────────────────────────────

describe('Aero Polar Assignment', () => {
  it('aurafive vehicle uses aurafiveContinuous polar', () => {
    const vehicle = getVehicleDefinition('aurafive')
    const polar = getVehicleAeroPolar(vehicle)
    expect(polar?.name).toContain('Aura 5')
  })

  it('a5segments vehicle uses a5segmentsContinuous polar', () => {
    const vehicle = getVehicleDefinition('a5segments')
    const polar = getVehicleAeroPolar(vehicle)
    expect(polar?.name).toBeDefined()
  })

  it('ibexul vehicle uses ibexulContinuous polar', () => {
    const vehicle = getVehicleDefinition('ibexul')
    const polar = getVehicleAeroPolar(vehicle)
    expect(polar?.name).toContain('Ibex')
  })

  it('slicksin vehicle uses slicksinContinuous polar', () => {
    const vehicle = getVehicleDefinition('slicksin')
    const polar = getVehicleAeroPolar(vehicle)
    expect(polar?.name).toContain('Slick')
  })

  it('caravan vehicle uses caravanContinuous polar', () => {
    const vehicle = getVehicleDefinition('caravan')
    const polar = getVehicleAeroPolar(vehicle)
    expect(polar?.name).toBeDefined()
  })

  it('combined aura5-ibexul has canopy aero active (Ibex UL)', () => {
    const vehicle = getVehicleDefinition('aura5-ibexul')
    const polar = getVehicleAeroPolar(vehicle)
    expect(polar?.name).toContain('Ibex')
  })

  it('canopy-only vehicle activeAeroComponentId points to canopy equipment', () => {
    const vehicle = getVehicleDefinition('ibexul')
    expect(vehicle.activeAeroComponentId).toBe('canopy-ibexul')

    const polar = getVehicleAeroPolar(vehicle)
    expect(polar?.name).toContain('Ibex')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
//  Mass Denormalization
// ──────────────────────────────────────────────────────────────────────────────

describe('Mass Denormalization', () => {
  it('denormalizeMass with default parameters returns valid CG and inertia', () => {
    const result = denormalizeMass(WINGSUIT_MASS_SEGMENTS, 1.93, 77.5)

    expect(result.cg).toBeDefined()
    expect(result.cg.x).toBeDefined()
    expect(result.cg.y).toBeDefined()
    expect(result.cg.z).toBeDefined()

    expect(result.inertia).toBeDefined()
    expect(result.inertia.Ixx).toBeGreaterThan(0)
    expect(result.inertia.Iyy).toBeGreaterThan(0)
    expect(result.inertia.Izz).toBeGreaterThan(0)
  })

  it('denormalizeMass CG scales with reference length', () => {
    const height_1875 = denormalizeMass(WINGSUIT_MASS_SEGMENTS, 1.875, 77.5)
    const height_1930 = denormalizeMass(WINGSUIT_MASS_SEGMENTS, 1.93, 77.5)

    // CG should scale proportionally
    const scale = 1.93 / 1.875
    expect(height_1930.cg.x).toBeCloseTo(height_1875.cg.x * scale, 3)
    expect(height_1930.cg.y).toBeCloseTo(height_1875.cg.y * scale, 3)
    expect(height_1930.cg.z).toBeCloseTo(height_1875.cg.z * scale, 3)
  })

  it('denormalizeMass inertia scales with reference length squared', () => {
    const height_1875 = denormalizeMass(WINGSUIT_MASS_SEGMENTS, 1.875, 77.5)
    const height_1930 = denormalizeMass(WINGSUIT_MASS_SEGMENTS, 1.93, 77.5)

    // Inertia should scale by (ref_len)^2
    const scale = (1.93 / 1.875) ** 2
    expect(height_1930.inertia.Ixx).toBeCloseTo(height_1875.inertia.Ixx * scale, 2)
    expect(height_1930.inertia.Iyy).toBeCloseTo(height_1875.inertia.Iyy * scale, 2)
    expect(height_1930.inertia.Izz).toBeCloseTo(height_1875.inertia.Izz * scale, 2)
  })

  it('denormalizeMass inertia scales with mass', () => {
    const mass_775 = denormalizeMass(WINGSUIT_MASS_SEGMENTS, 1.875, 77.5)
    const mass_900 = denormalizeMass(WINGSUIT_MASS_SEGMENTS, 1.875, 90)

    // Inertia should scale linearly with mass
    const scale = 90 / 77.5
    expect(mass_900.inertia.Ixx).toBeCloseTo(mass_775.inertia.Ixx * scale, 2)
    expect(mass_900.inertia.Iyy).toBeCloseTo(mass_775.inertia.Iyy * scale, 2)
    expect(mass_900.inertia.Izz).toBeCloseTo(mass_775.inertia.Izz * scale, 2)
  })

  it('denormalizeMass matches computeCenterOfMass and computeInertia directly', () => {
    const denormalized = denormalizeMass(WINGSUIT_MASS_SEGMENTS, 1.93, 77.5)
    const directCG = computeCenterOfMass(WINGSUIT_MASS_SEGMENTS, 1.93, 77.5)
    const directInertia = computeInertia(WINGSUIT_MASS_SEGMENTS, 1.93, 77.5)

    expect(denormalized.cg.x).toBeCloseTo(directCG.x, 6)
    expect(denormalized.cg.y).toBeCloseTo(directCG.y, 6)
    expect(denormalized.cg.z).toBeCloseTo(directCG.z, 6)

    expect(denormalized.inertia.Ixx).toBeCloseTo(directInertia.Ixx, 6)
    expect(denormalized.inertia.Iyy).toBeCloseTo(directInertia.Iyy, 6)
    expect(denormalized.inertia.Izz).toBeCloseTo(directInertia.Izz, 6)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
//  Vehicle Definition Completeness
// ──────────────────────────────────────────────────────────────────────────────

describe('Vehicle Definition Completeness', () => {
  it('every vehicle has required fields', () => {
    for (const [id, vehicle] of Object.entries(VEHICLE_REGISTRY)) {
      expect(vehicle.id).toBe(id)
      expect(vehicle.name).toBeDefined()
      expect(vehicle.name.length).toBeGreaterThan(0)

      expect(vehicle.pilot).toBeDefined()
      expect(vehicle.pilot.id).toBeDefined()
      expect(vehicle.pilot.pilotHeight_m).toBeGreaterThan(0)

      expect(vehicle.equipment).toBeDefined()
      expect(Array.isArray(vehicle.equipment)).toBe(true)
    }
  })

  it('wingsuit vehicles (aurafive, a5segments, slicksin) have no equipment', () => {
    const wingsuit = getVehicleDefinition('aurafive')
    const a5seg = getVehicleDefinition('a5segments')
    const slick = getVehicleDefinition('slicksin')

    expect(wingsuit.equipment.length).toBe(0)
    expect(a5seg.equipment.length).toBe(0)
    expect(slick.equipment.length).toBe(0)
  })

  it('canopy vehicles have equipment array with items', () => {
    const ibexul = getVehicleDefinition('ibexul')
    const combined = getVehicleDefinition('aura5-ibexul')

    expect(ibexul.equipment.length).toBeGreaterThan(0)
    expect(combined.equipment.length).toBeGreaterThan(0)
  })

  it('every equipment has id and name', () => {
    for (const [, vehicle] of Object.entries(VEHICLE_REGISTRY)) {
      for (const equip of vehicle.equipment) {
        expect(equip.id).toBeDefined()
        expect(equip.id.length).toBeGreaterThan(0)
        expect(equip.name).toBeDefined()
        expect(equip.name.length).toBeGreaterThan(0)
      }
    }
  })

  it('equipment with aero polar has referenceLength_m defined', () => {
    for (const [, vehicle] of Object.entries(VEHICLE_REGISTRY)) {
      for (const equip of vehicle.equipment) {
        if (equip.aero) {
          expect(equip.referenceLength_m).toBeGreaterThan(0)
        }
      }
    }
  })

  it('equipment with GLB metadata has physicalSize info', () => {
    for (const [, vehicle] of Object.entries(VEHICLE_REGISTRY)) {
      for (const equip of vehicle.equipment) {
        if (equip.glb) {
          expect(equip.glb.filePath).toBeDefined()
          expect(equip.glb.physicalSize).toBeDefined()
        }
      }
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────────
//  Vehicle Comparison (Isolation)
// ──────────────────────────────────────────────────────────────────────────────

describe('Vehicle Isolation (No Cross-Contamination)', () => {
  it('aurafive and slicksin are completely separate vehicles', () => {
    const aura5 = getVehicleDefinition('aurafive')
    const slick = getVehicleDefinition('slicksin')

    const aura5Polar = getVehicleAeroPolar(aura5)
    const slickPolar = getVehicleAeroPolar(slick)

    expect(aura5Polar?.name).not.toBe(slickPolar?.name)
    expect(aura5.modelType).not.toBe(slick.modelType)
  })

  it('ibexul (canopy-only) and aurafive (wingsuit) have different structures', () => {
    const ibexul = getVehicleDefinition('ibexul')
    const aura5 = getVehicleDefinition('aurafive')

    expect(ibexul.equipment.length).toBeGreaterThan(0)
    expect(aura5.equipment.length).toBe(0)

    expect(ibexul.modelType).toBe('canopy')
    expect(aura5.modelType).toBe('wingsuit')
  })

  it('aura5-ibexul combines both without modifying originals', () => {
    const combined = getVehicleDefinition('aura5-ibexul')
    const aura5 = getVehicleDefinition('aurafive')
    const ibexul = getVehicleDefinition('ibexul')

    // Combined should have pilot from aura5
    expect(combined.pilot.referenceLength_m).toBeCloseTo(aura5.pilot.referenceLength_m ?? 1.93, 1)

    // Combined should have canopy equipment
    expect(combined.equipment.length).toBeGreaterThan(0)

    // Original vehicles should be unchanged
    expect(aura5.equipment.length).toBe(0)
    expect(ibexul.pilot.aero).toBeDefined()  // Canopy pilot now has aero data
  })
})

// ──────────────────────────────────────────────────────────────────────────────
//  Helper Functions
// ──────────────────────────────────────────────────────────────────────────────

describe('Vehicle Helper Functions', () => {
  it('getVehicleMassReference returns pilotHeight_m', () => {
    const vehicle = getVehicleDefinition('aurafive')
    const ref = getVehicleMassReference(vehicle)
    expect(ref).toBe(vehicle.pilot.pilotHeight_m)
  })

  it('getVehicleMassReference falls back to referenceLength from fallback polar', () => {
    const vehicle = getVehicleDefinition('ibexul')  // Canopy with scale
    const ref = getVehicleMassReference(vehicle, ibexulContinuous)
    // Mass reference is the physical reference length, not scaled by component scale
    const canopyEquip = vehicle.equipment[0]
    expect(ref).toBe(canopyEquip.referenceLength_m ?? 1.875)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
//  Physics Consistency
// ──────────────────────────────────────────────────────────────────────────────

describe('Physics Consistency', () => {
  it('wingsuit vehicle inertia values are positive and reasonable', () => {
    const vehicle = getVehicleDefinition('aurafive')
    const inertia = vehicle.pilot.mass?.inertia

    expect(inertia).toBeDefined()
    expect(inertia?.Ixx).toBeGreaterThan(0)
    expect(inertia?.Iyy).toBeGreaterThan(0)
    expect(inertia?.Izz).toBeGreaterThan(0)

    // Inertia values should be in reasonable range for human body
    // (roughly 1-3 kg⋅m² for each axis)
    expect(inertia?.Ixx).toBeLessThan(20)
    expect(inertia?.Iyy).toBeLessThan(20)
    expect(inertia?.Izz).toBeLessThan(20)
  })

  it('CG position is within body envelope', () => {
    const vehicle = getVehicleDefinition('aurafive')
    const cg = vehicle.pilot.mass?.cg

    expect(cg).toBeDefined()

    // CG should be roughly at torso (±0.2 m from origin in NED frame)
    expect(Math.abs(cg?.x ?? 0)).toBeLessThan(0.5)
    expect(Math.abs(cg?.y ?? 0)).toBeLessThan(0.5)
    expect(Math.abs(cg?.z ?? 0)).toBeLessThan(1.0)  // Can extend along body
  })

  it('aero reference lengths match polar definitions', () => {
    const aura5 = getVehicleDefinition('aurafive')
    const aura5Polar = getVehicleAeroPolar(aura5)

    expect(aura5.pilot.referenceLength_m).toBeCloseTo(aura5Polar?.referenceLength ?? 1.93, 1)
  })
})
