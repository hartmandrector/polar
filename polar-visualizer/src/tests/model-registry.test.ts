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
  glbToNED, glbToMeters, getCellPositionsNED, getCellBoundsGLB, relativeToCG,
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

  it('has 4 full cells (center + 3 pairs)', () => {
    expect(m.cells).toHaveLength(4)
    expect(m.cells![0].index).toBe(1)
    expect(m.cells![3].index).toBe(4)
  })

  it('center cell (1) has smallest X, outer cell (4) has largest', () => {
    expect(m.cells![0].glbX).toBeLessThan(m.cells![3].glbX)
  })

  it('all cells have QC Z from nose vertex (≈ −0.248 to −0.249)', () => {
    for (const c of m.cells!) {
      // QC Z = noseZ + 0.25 × (teZ − noseZ) ≈ 0.627 + 0.25 × (−3.501) ≈ −0.248
      expect(c.glbQcZ).toBeCloseTo(-0.249, 2)
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
  it('returns 7 entries (1 center + 3×2 left/right)', () => {
    const cells = getCellPositionsNED(CANOPY_GEOMETRY)
    expect(cells).toHaveLength(7)
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

  it('outer cell (4) has larger |y| than cell 2', () => {
    const cells = getCellPositionsNED(CANOPY_GEOMETRY)
    const tip = cells.find(c => c.index === 4 && c.side === 'right')!
    const inner = cells.find(c => c.index === 2 && c.side === 'right')!
    expect(Math.abs(tip.ned.y)).toBeGreaterThan(Math.abs(inner.ned.y))
  })

  it('quarter-chord x (NED forward) uses nose-derived QC Z', () => {
    const cells = getCellPositionsNED(CANOPY_GEOMETRY)
    const center = cells.find(c => c.side === 'center')!
    // QC Z in GLB ≈ -0.248 (from nose vertex), glbToNED = 0.4972
    // NED x = glb_z * sign(+1) * glbToNED ≈ -0.248 * 0.4972 ≈ -0.123
    expect(approx(center.ned.x, 2)).toBe(approx(-0.248 * CANOPY_GEOMETRY.glbToNED, 2))
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

// ─────────────────────────────────────────────────────────────────
describe('getCellBoundsGLB', () => {
  const bounds = getCellBoundsGLB(CANOPY_GEOMETRY)

  it('returns 7 entries: 1 center + 3×2 paired', () => {
    expect(bounds).toHaveLength(7)
  })

  it('center cell spans from -Rib_2 to +Rib_2', () => {
    const center = bounds.find(b => b.side === 'center')!
    expect(center.cellIndex).toBe(1)
    expect(approx(center.xInner)).toBe(-0.459)
    expect(approx(center.xOuter)).toBe(0.459)
  })

  it('cell bounds span full chord LE to TE', () => {
    for (const b of bounds) {
      expect(b.zLE).toBe(0.655)
      expect(b.zTE).toBe(-2.874)
    }
  })

  it('bottom LE uses A-line attachment Z (aft of top LE)', () => {
    for (const b of bounds) {
      expect(b.zBottomLE).toBe(0.308)
      expect(b.zBottomLE).toBeLessThan(b.zLE)
    }
  })

  it('bottom LE Y follows canopy arc (higher than yMin, lower than yMax)', () => {
    for (const b of bounds) {
      // yBottomLE from A-line attachment — between yMin and yMax
      expect(b.yBottomLEInner).toBeGreaterThanOrEqual(b.yMinInner)
      expect(b.yBottomLEInner).toBeLessThan(b.yMaxInner)
      expect(b.yBottomLEOuter).toBeGreaterThanOrEqual(b.yMinOuter)
      expect(b.yBottomLEOuter).toBeLessThan(b.yMaxOuter)
    }
  })

  it('bottom LE sourced from a_N_upper A-line attachment points', () => {
    const center = bounds.find(b => b.side === 'center')!
    // Center cell bounded by Rib_2 → a2_upper: x=0.447, y=4.151
    expect(center.xBottomLEInner).toBe(-0.447)
    expect(center.xBottomLEOuter).toBe(0.447)
    expect(center.yBottomLEInner).toBe(4.151)
    expect(center.yBottomLEOuter).toBe(4.151)
    // Outer cell right: inner=Rib_6 (a6: x=2.092 y=3.769), outer=Rib_8 (a8: x=2.795 y=3.293)
    const outerR = bounds.find(b => b.cellIndex === 4 && b.side === 'right')!
    expect(outerR.xBottomLEInner).toBe(2.092)
    expect(outerR.xBottomLEOuter).toBe(2.795)
    expect(outerR.yBottomLEInner).toBe(3.769)
    expect(outerR.yBottomLEOuter).toBe(3.293)
  })

  it('bottom LE X inboard of rib edge (lines converge)', () => {
    const rights = bounds.filter(b => b.side === 'right')
    for (const b of rights) {
      expect(b.xBottomLEInner).toBeLessThanOrEqual(b.xInner)
      expect(b.xBottomLEOuter).toBeLessThanOrEqual(b.xOuter)
    }
  })

  it('bottom TE Y above yMin (TE is thin, above max-thickness line)', () => {
    for (const b of bounds) {
      expect(b.yBottomTEInner).toBeGreaterThan(b.yMinInner)
      expect(b.yBottomTEOuter).toBeGreaterThan(b.yMinOuter)
    }
  })

  it('bottom TE X inboard of rib edge (bottom skin narrower)', () => {
    const rights = bounds.filter(b => b.side === 'right')
    for (const b of rights) {
      expect(b.xBottomTEInner).toBeLessThanOrEqual(b.xInner)
      expect(b.xBottomTEOuter).toBeLessThanOrEqual(b.xOuter)
    }
  })

  it('bottom TE sourced from Bottom_N_L xMax + Top_N_L yMin', () => {
    const center = bounds.find(b => b.side === 'center')!
    // Center cell bounded by Rib_2 → xTE=0.448, yTE=4.331
    expect(center.xBottomTEInner).toBe(-0.448)
    expect(center.xBottomTEOuter).toBe(0.448)
    expect(center.yBottomTEInner).toBe(4.331)
    expect(center.yBottomTEOuter).toBe(4.331)
    // Outer cell right: inner=Rib_6 (x=2.172 y=3.928), outer=Rib_8 (x=2.909 y=3.427)
    const outerR = bounds.find(b => b.cellIndex === 4 && b.side === 'right')!
    expect(outerR.xBottomTEInner).toBe(2.172)
    expect(outerR.xBottomTEOuter).toBe(2.909)
    expect(outerR.yBottomTEInner).toBe(3.928)
    expect(outerR.yBottomTEOuter).toBe(3.427)
  })

  it('outer cell (4) right side spans Rib_6 to Rib_8', () => {
    const outerR = bounds.find(b => b.cellIndex === 4 && b.side === 'right')!
    expect(approx(outerR.xInner)).toBe(2.329)
    expect(approx(outerR.xOuter)).toBe(3.133)
  })

  it('left cells have negative X values', () => {
    const leftCells = bounds.filter(b => b.side === 'left')
    expect(leftCells.length).toBe(3)
    for (const b of leftCells) {
      expect(b.xInner).toBeLessThan(0)
      expect(b.xOuter).toBeLessThan(0)
    }
  })

  it('Y bounds follow canopy arc (outer cells lower than inner)', () => {
    const cell2R = bounds.find(b => b.cellIndex === 2 && b.side === 'right')!
    const cell4R = bounds.find(b => b.cellIndex === 4 && b.side === 'right')!
    expect(cell4R.yMaxOuter).toBeLessThan(cell2R.yMaxInner)
  })

  it('chord LE Y is true nose vertex (max Z on rib mesh)', () => {
    // Center cell: both boundaries are Rib_2, nose Y = 4.331
    const center = bounds.find(b => b.side === 'center')!
    expect(center.yChordLEInner).toBeCloseTo(4.331, 3)
    expect(center.yChordLEOuter).toBeCloseTo(4.331, 3)
    // Outer cell right: inner Rib_6 nose Y = 3.928, outer Rib_8 nose Y = 3.427
    const outerR = bounds.find(b => b.cellIndex === 4 && b.side === 'right')!
    expect(outerR.yChordLEInner).toBeCloseTo(3.928, 3)
    expect(outerR.yChordLEOuter).toBeCloseTo(3.427, 3)
  })

  it('chord LE Y sits between yMin and yMax at each boundary', () => {
    for (const b of bounds) {
      expect(b.yChordLEInner).toBeGreaterThan(b.yMinInner)
      expect(b.yChordLEInner).toBeLessThan(b.yMaxInner)
      expect(b.yChordLEOuter).toBeGreaterThan(b.yMinOuter)
      expect(b.yChordLEOuter).toBeLessThan(b.yMaxOuter)
    }
  })

  it('chord LE Y follows canopy arc (decreases outboard)', () => {
    const cell2R = bounds.find(b => b.cellIndex === 2 && b.side === 'right')!
    const cell4R = bounds.find(b => b.cellIndex === 4 && b.side === 'right')!
    expect(cell4R.yChordLEOuter).toBeLessThan(cell2R.yChordLEInner)
  })

  it('nose X sits inboard of rib edge X', () => {
    for (const b of bounds) {
      // Nose vertex is narrower than the rib edge (except center at X=0)
      expect(Math.abs(b.xNoseInner)).toBeLessThanOrEqual(Math.abs(b.xInner) + 0.001)
      expect(Math.abs(b.xNoseOuter)).toBeLessThanOrEqual(Math.abs(b.xOuter) + 0.001)
    }
  })

  it('nose Z is slightly aft of top-skin zLE', () => {
    for (const b of bounds) {
      expect(b.zNose).toBeLessThan(b.zLE)
      expect(b.zNose).toBeGreaterThan(b.zLE - 0.05)  // within ~0.03 of zLE
    }
  })

  it('returns empty for geometry without ribs', () => {
    expect(getCellBoundsGLB(AIRPLANE_GEOMETRY)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────
//  Line set geometry
// ─────────────────────────────────────────────────────────────────

describe('LineSet geometry', () => {
  const lineSet = CANOPY_GEOMETRY.lineSet!

  it('lineSet exists on CANOPY_GEOMETRY', () => {
    expect(lineSet).toBeDefined()
  })

  it('has 4 load-bearing ribs (2, 4, 6, 8)', () => {
    expect(lineSet.ribs).toHaveLength(4)
    expect(lineSet.ribs.map(r => r.ribIndex)).toEqual([2, 4, 6, 8])
  })

  // ── Canopy attachments ──

  it('canopy attachment Y follows arc (decreases outboard)', () => {
    const ys = lineSet.ribs.map(r => r.aCanopy.glbY)
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeLessThan(ys[i - 1])
    }
  })

  it('canopy attachment X increases outboard', () => {
    const xs = lineSet.ribs.map(r => r.aCanopy.glbX)
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1])
    }
  })

  it('A attachment Z is forward (near LE)', () => {
    for (const r of lineSet.ribs) {
      expect(r.aCanopy.glbZ).toBeGreaterThan(0.2)  // near LE (~0.30)
    }
  })

  it('D attachment Z is rearmost', () => {
    for (const r of lineSet.ribs) {
      expect(r.dCanopy.glbZ).toBeLessThan(-1.9)
    }
  })

  it('canopy Z order: A > B > C > D (front to back)', () => {
    for (const r of lineSet.ribs) {
      expect(r.aCanopy.glbZ).toBeGreaterThan(r.bCanopy.glbZ)
      expect(r.bCanopy.glbZ).toBeGreaterThan(r.cCanopy.glbZ)
      expect(r.cCanopy.glbZ).toBeGreaterThan(r.dCanopy.glbZ)
    }
  })

  it('canopy Y order at each rib: A < B < C < D (rear lines attach higher)', () => {
    for (const r of lineSet.ribs) {
      expect(r.aCanopy.glbY).toBeLessThan(r.bCanopy.glbY)
      expect(r.bCanopy.glbY).toBeLessThan(r.cCanopy.glbY)
      expect(r.cCanopy.glbY).toBeLessThan(r.dCanopy.glbY)
    }
  })

  // ── Cascade junctions ──

  it('A/B cascade Y is below all canopy attachments and above riser', () => {
    for (const r of lineSet.ribs) {
      const maxCanopyY = Math.max(
        r.aCanopy.glbY, r.bCanopy.glbY, r.cCanopy.glbY, r.dCanopy.glbY
      )
      expect(r.abCascade.glbY).toBeLessThan(maxCanopyY)
      expect(r.abCascade.glbY).toBeGreaterThan(r.abRiserEnd.glbY)
    }
  })

  it('C/D cascade Y is below canopy and above riser', () => {
    for (const r of lineSet.ribs) {
      expect(r.cdCascade.glbY).toBeLessThan(r.cCanopy.glbY)
      expect(r.cdCascade.glbY).toBeGreaterThan(r.cdRiserEnd.glbY)
    }
  })

  it('cascade X is inboard of canopy X (lines converge toward center)', () => {
    for (const r of lineSet.ribs) {
      expect(r.abCascade.glbX).toBeLessThanOrEqual(r.aCanopy.glbX + 0.001)
      expect(r.cdCascade.glbX).toBeLessThanOrEqual(r.cCanopy.glbX + 0.001)
    }
  })

  it('A/B cascade Z is between A and B line Z positions', () => {
    for (const r of lineSet.ribs) {
      expect(r.abCascade.glbZ).toBeLessThan(r.aCanopy.glbZ)
      expect(r.abCascade.glbZ).toBeGreaterThan(r.bCanopy.glbZ)
    }
  })

  it('C/D cascade Z is forward of D canopy Z', () => {
    for (const r of lineSet.ribs) {
      expect(r.cdCascade.glbZ).toBeGreaterThan(r.dCanopy.glbZ)
      // Cascade sits near C-line Z (within ~0.1), not between C and D
      expect(r.cdCascade.glbZ).toBeGreaterThan(r.cCanopy.glbZ - 0.1)
    }
  })

  it('cascade Y decreases outboard (following arc)', () => {
    const abYs = lineSet.ribs.map(r => r.abCascade.glbY)
    const cdYs = lineSet.ribs.map(r => r.cdCascade.glbY)
    for (let i = 1; i < abYs.length; i++) {
      expect(abYs[i]).toBeLessThan(abYs[i - 1])
      expect(cdYs[i]).toBeLessThan(cdYs[i - 1])
    }
  })

  // ── Lower lines / riser ends ──

  it('all lower lines converge near riser top (X ≈ 0.42–0.44)', () => {
    for (const r of lineSet.ribs) {
      expect(r.abRiserEnd.glbX).toBeCloseTo(0.44, 1)
      expect(r.cdRiserEnd.glbX).toBeCloseTo(0.42, 1)
    }
  })

  it('riser end Y ≈ 0.5 (just above riser top)', () => {
    for (const r of lineSet.ribs) {
      expect(r.abRiserEnd.glbY).toBeCloseTo(0.5, 1)
      expect(r.cdRiserEnd.glbY).toBeCloseTo(0.46, 1)
    }
  })

  // ── Risers ──

  it('front riser top is above bottom', () => {
    expect(lineSet.frontRiser.top.glbY).toBeGreaterThan(lineSet.frontRiser.bottom.glbY)
  })

  it('rear riser top is above bottom', () => {
    expect(lineSet.rearRiser.top.glbY).toBeGreaterThan(lineSet.rearRiser.bottom.glbY)
  })

  it('front riser Z is forward of rear riser Z', () => {
    expect(lineSet.frontRiser.top.glbZ).toBeGreaterThan(lineSet.rearRiser.top.glbZ)
  })

  it('riser bottom Y ≈ 0 (harness level)', () => {
    expect(lineSet.frontRiser.bottom.glbY).toBeCloseTo(0, 1)
    expect(lineSet.rearRiser.bottom.glbY).toBeCloseTo(0, 1)
  })

  it('riser X narrows from top to bottom (converging toward center)', () => {
    expect(lineSet.frontRiser.bottom.glbX).toBeLessThan(lineSet.frontRiser.top.glbX)
    expect(lineSet.rearRiser.bottom.glbX).toBeLessThan(lineSet.rearRiser.top.glbX)
  })

  // ── Spot checks (exact values from extract-lines.cjs) ──

  it('rib 2 A-line canopy attachment: (0.442, 4.151, 0.299)', () => {
    const r2 = lineSet.ribs[0]
    expect(r2.aCanopy.glbX).toBeCloseTo(0.442, 3)
    expect(r2.aCanopy.glbY).toBeCloseTo(4.151, 3)
    expect(r2.aCanopy.glbZ).toBeCloseTo(0.299, 3)
  })

  it('rib 8 C/D cascade: (2.119, 2.494, -1.184)', () => {
    const r8 = lineSet.ribs[3]
    expect(r8.cdCascade.glbX).toBeCloseTo(2.119, 3)
    expect(r8.cdCascade.glbY).toBeCloseTo(2.494, 3)
    expect(r8.cdCascade.glbZ).toBeCloseTo(-1.184, 3)
  })
})
