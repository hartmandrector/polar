/**
 * Tests for model-registry.ts — geometry data, conversion helpers,
 * and consistency invariants.
 */
import { describe, it, expect } from 'vitest'
import {
  WINGSUIT_GEOMETRY, SLICK_GEOMETRY, CANOPY_GEOMETRY,
  AIRPLANE_GEOMETRY, BRIDLE_PC_GEOMETRY, PC_GEOMETRY, SNIVEL_GEOMETRY,
  CANOPY_WINGSUIT_ASSEMBLY, CANOPY_SLICK_ASSEMBLY,
  MODEL_REGISTRY, ASSEMBLY_REGISTRY, TARGET_SIZE,
  glbToNED, glbToMeters, getCellPositionsNED, relativeToCG,
  type ModelGeometry, type Vec3,
} from '../viewer/model-registry.ts'

// ─────────────────────────────────────────────────────────────────
//  Helper
// ─────────────────────────────────────────────────────────────────

const approx = (v: number, decimals = 3) => +v.toFixed(decimals)

// ─────────────────────────────────────────────────────────────────
//  Scale factor consistency
// ─────────────────────────────────────────────────────────────────

describe('ModelGeometry scale consistency', () => {
  const allModels: ModelGeometry[] = Object.values(MODEL_REGISTRY)

  it('every model has glbToMeters = physicalReference.meters / physicalReference.glbExtent', () => {
    for (const m of allModels) {
      const expected = m.physicalReference.meters / m.physicalReference.glbExtent
      expect(approx(m.glbToMeters, 6)).toBe(approx(expected, 6))
    }
  })

  it('every model has glbToNED = glbToMeters / referenceHeight', () => {
    for (const m of allModels) {
      const expected = m.glbToMeters / m.referenceHeight
      expect(approx(m.glbToNED, 6)).toBe(approx(expected, 6))
    }
  })

  it('referenceHeight is 1.875 for all models', () => {
    for (const m of allModels) {
      expect(m.referenceHeight).toBe(1.875)
    }
  })

  it('bbox.size matches max-min for all models (within rounding)', () => {
    for (const m of allModels) {
      expect(m.bbox.size.x).toBeCloseTo(m.bbox.max.x - m.bbox.min.x, 2)
      expect(m.bbox.size.y).toBeCloseTo(m.bbox.max.y - m.bbox.min.y, 2)
      expect(m.bbox.size.z).toBeCloseTo(m.bbox.max.z - m.bbox.min.z, 2)
    }
  })
})

// ─────────────────────────────────────────────────────────────────
//  Individual model properties
// ─────────────────────────────────────────────────────────────────

describe('Wingsuit geometry', () => {
  const m = WINGSUIT_GEOMETRY

  it('GLB max dim is Z (head-to-toe)', () => {
    expect(m.maxDimAxis).toBe('z')
    expect(m.maxDim).toBe(3.550)
  })

  it('glbToMeters maps full body to 1.875 m', () => {
    expect(approx(m.maxDim * m.glbToMeters)).toBe(1.875)
  })

  it('axis mapping: GLB +Z = NED +x (forward)', () => {
    expect(m.axes.ned_x).toEqual({ glbAxis: 'z', sign: 1 })
  })

  it('cgOffsetFraction is 0.197', () => {
    expect(m.cgOffsetFraction).toBe(0.197)
  })
})

describe('Slick geometry', () => {
  const m = SLICK_GEOMETRY

  it('GLB max dim is Z (head-to-toe)', () => {
    expect(m.maxDimAxis).toBe('z')
    expect(m.maxDim).toBe(3.384)
  })

  it('glbToNED matches code GLB_TO_NED ≈ 0.2955', () => {
    // The code's GLB_TO_NED = 0.2962 was measured from slick
    expect(approx(m.glbToNED, 3)).toBe(approx(1 / 3.384, 3))
  })
})

describe('Canopy geometry', () => {
  const m = CANOPY_GEOMETRY

  it('chord reference produces glbToMeters ≈ 0.932', () => {
    expect(approx(m.glbToMeters)).toBe(approx(3.29 / 3.529))
  })

  it('has 7 cells', () => {
    expect(m.cells).toHaveLength(7)
    expect(m.cells![0].index).toBe(1)
    expect(m.cells![6].index).toBe(7)
  })

  it('center cell (1) has smallest X, tip cell (7) has largest', () => {
    expect(m.cells![0].glbX).toBeLessThan(m.cells![6].glbX)
  })

  it('all cells have same QC Z (flat trailing edge)', () => {
    for (const c of m.cells!) {
      expect(c.glbQcZ).toBe(-0.227)
    }
  })

  it('glbChord = LE_Z - TE_Z', () => {
    expect(approx(m.glbLeZ! - m.glbTeZ!)).toBe(approx(m.glbChord!))
  })
})

// ─────────────────────────────────────────────────────────────────
//  Conversion helpers
// ─────────────────────────────────────────────────────────────────

describe('glbToNED()', () => {
  it('converts wingsuit origin (0,0,0) to NED (0,0,0)', () => {
    const ned = glbToNED({ x: 0, y: 0, z: 0 }, WINGSUIT_GEOMETRY)
    expect(ned.x).toBe(0)
    expect(ned.y).toBe(0)
    expect(ned.z).toBe(0)
  })

  it('maps wingsuit GLB +Z to NED +x (forward)', () => {
    const ned = glbToNED({ x: 0, y: 0, z: 1 }, WINGSUIT_GEOMETRY)
    const s = WINGSUIT_GEOMETRY.glbToNED
    expect(approx(ned.x)).toBe(approx(s))
    expect(ned.y).toBe(0)
    expect(ned.z).toBe(0)
  })

  it('maps wingsuit GLB −X to NED +y (right)', () => {
    // GLB X maps with sign=-1 to NED y → GLB(-1) * (-1) * s = +s
    const ned = glbToNED({ x: -1, y: 0, z: 0 }, WINGSUIT_GEOMETRY)
    const s = WINGSUIT_GEOMETRY.glbToNED
    expect(ned.x).toBe(0)
    expect(approx(ned.y)).toBe(approx(s))
    expect(ned.z).toBe(0)
  })

  it('maps canopy GLB +X to NED +y (right)', () => {
    const ned = glbToNED({ x: 1, y: 0, z: 0 }, CANOPY_GEOMETRY)
    const s = CANOPY_GEOMETRY.glbToNED
    expect(ned.x).toBe(0)
    expect(approx(ned.y)).toBe(approx(s))
    expect(ned.z).toBe(0)
  })

  it('maps canopy GLB +Y to NED −z (up → down inverted)', () => {
    const ned = glbToNED({ x: 0, y: 1, z: 0 }, CANOPY_GEOMETRY)
    const s = CANOPY_GEOMETRY.glbToNED
    expect(ned.x).toBe(0)
    expect(ned.y).toBe(0)
    expect(approx(ned.z)).toBe(approx(-s))
  })
})

describe('glbToMeters()', () => {
  it('wingsuit head (+Z max) converts to ~1.875 m forward', () => {
    const head: Vec3 = { x: 0, y: 0, z: WINGSUIT_GEOMETRY.bbox.max.z }
    const m = glbToMeters(head, WINGSUIT_GEOMETRY)
    expect(approx(m.x, 2)).toBe(approx(WINGSUIT_GEOMETRY.bbox.max.z * WINGSUIT_GEOMETRY.glbToMeters, 2))
  })
})

describe('getCellPositionsNED()', () => {
  it('returns 13 entries (1 center + 6×2 left/right)', () => {
    const cells = getCellPositionsNED(CANOPY_GEOMETRY)
    expect(cells).toHaveLength(13)
  })

  it('center cell has y ≈ 0 (on symmetry plane)', () => {
    const cells = getCellPositionsNED(CANOPY_GEOMETRY)
    const center = cells.find(c => c.side === 'center')!
    expect(center.index).toBe(1)
    expect(Math.abs(center.ned.y)).toBeLessThan(0.001)
  })

  it('right cells have positive y, left cells have negative y', () => {
    const cells = getCellPositionsNED(CANOPY_GEOMETRY)
    for (const c of cells) {
      if (c.side === 'right') expect(c.ned.y).toBeGreaterThan(0)
      if (c.side === 'left') expect(c.ned.y).toBeLessThan(0)
    }
  })

  it('cell z (NED down) is negative (canopy is above origin)', () => {
    const cells = getCellPositionsNED(CANOPY_GEOMETRY)
    for (const c of cells) {
      expect(c.ned.z).toBeLessThan(0)  // canopy Y is positive → NED z is negative (above)
    }
  })

  it('tip cell (7) has larger |y| than cell 2', () => {
    const cells = getCellPositionsNED(CANOPY_GEOMETRY)
    const tip = cells.find(c => c.index === 7 && c.side === 'right')!
    const inner = cells.find(c => c.index === 2 && c.side === 'right')!
    expect(Math.abs(tip.ned.y)).toBeGreaterThan(Math.abs(inner.ned.y))
  })

  it('quarter-chord x (NED forward) is in reasonable range', () => {
    const cells = getCellPositionsNED(CANOPY_GEOMETRY)
    const center = cells.find(c => c.side === 'center')!
    // QC Z in GLB = -0.227, glbToNED = 0.497
    // NED x = glb_z * sign(+1) * glbToNED ≈ -0.227 * 0.497 ≈ -0.113
    expect(approx(center.ned.x, 2)).toBe(approx(-0.227 * CANOPY_GEOMETRY.glbToNED, 2))
  })
})

describe('relativeToCG()', () => {
  it('subtracts CG position', () => {
    const pos: Vec3 = { x: 1, y: 2, z: 3 }
    const cg: Vec3 = { x: 0.5, y: 1, z: 1.5 }
    const result = relativeToCG(pos, cg)
    expect(result).toEqual({ x: 0.5, y: 1, z: 1.5 })
  })
})

// ─────────────────────────────────────────────────────────────────
//  Assembly consistency
// ─────────────────────────────────────────────────────────────────

describe('Assembly configurations', () => {
  it('all assembly parent/child IDs exist in MODEL_REGISTRY', () => {
    for (const a of Object.values(ASSEMBLY_REGISTRY)) {
      expect(MODEL_REGISTRY).toHaveProperty(a.parentId)
      expect(MODEL_REGISTRY).toHaveProperty(a.childId)
    }
  })

  it('canopy-wingsuit assembly has correct CANOPY_SCALE', () => {
    expect(CANOPY_WINGSUIT_ASSEMBLY.parentScale).toBe(1.5)
  })

  it('both assemblies share the same trim angle', () => {
    expect(CANOPY_WINGSUIT_ASSEMBLY.trimAngleDeg).toBe(6)
    expect(CANOPY_SLICK_ASSEMBLY.trimAngleDeg).toBe(6)
  })

  it('pilot shifts are consistent between assemblies', () => {
    expect(CANOPY_WINGSUIT_ASSEMBLY.pilotFwdShift).toBe(CANOPY_SLICK_ASSEMBLY.pilotFwdShift)
    expect(CANOPY_WINGSUIT_ASSEMBLY.pilotDownShift).toBe(CANOPY_SLICK_ASSEMBLY.pilotDownShift)
  })
})

// ─────────────────────────────────────────────────────────────────
//  Registry completeness
// ─────────────────────────────────────────────────────────────────

describe('Registry completeness', () => {
  it('MODEL_REGISTRY has 7 models', () => {
    expect(Object.keys(MODEL_REGISTRY)).toHaveLength(7)
  })

  it('ASSEMBLY_REGISTRY has 2 assemblies', () => {
    expect(Object.keys(ASSEMBLY_REGISTRY)).toHaveLength(2)
  })

  it('TARGET_SIZE is 2.0', () => {
    expect(TARGET_SIZE).toBe(2.0)
  })

  it('every model has non-empty path and description', () => {
    for (const m of Object.values(MODEL_REGISTRY)) {
      expect(m.path.length).toBeGreaterThan(0)
      expect(m.description.length).toBeGreaterThan(0)
    }
  })

  it('every model has 3 unique axes in its mapping', () => {
    for (const m of Object.values(MODEL_REGISTRY)) {
      const axes = new Set([m.axes.ned_x.glbAxis, m.axes.ned_y.glbAxis, m.axes.ned_z.glbAxis])
      expect(axes.size).toBe(3)
    }
  })
})
