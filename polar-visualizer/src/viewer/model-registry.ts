/**
 * Model Geometry Registry
 * =======================
 *
 * Single source of truth for all GLB model geometry: bounding boxes,
 * physical dimensions, axis mappings, landmarks, cell positions, and
 * assembly rules.
 *
 * Every spatial constant that was previously a magic number in model-loader.ts,
 * vectors.ts, or polar-data.ts traces back to a measurement recorded in
 * MODEL-GEOMETRY.md and codified here.
 *
 * Coordinate systems:
 *   - GLB: per-model, as authored (arbitrary units, per-model axes)
 *   - Meters: physical SI units
 *   - NED normalized: NED body frame divided by reference height (1.875 m)
 *   - Three.js: Y-up rendering frame (converted via nedToThreeJS)
 */

// ─────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────

/** 3D vector in an arbitrary frame (GLB, NED, or meters). */
export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** Axis-aligned bounding box in GLB units. */
export interface BBox {
  readonly min: Vec3
  readonly max: Vec3
  readonly size: Vec3
}

/**
 * Mapping from GLB axes to NED body axes.
 *
 * Each NED axis is expressed as { glbAxis, sign }:
 *   - `glbAxis`: which GLB axis ('x' | 'y' | 'z') maps to this NED axis
 *   - `sign`: +1 or −1 for same or flipped direction
 *
 * Example: wingsuit has GLB +Z = head = NED +x (forward),
 * so `ned_x: { glbAxis: 'z', sign: +1 }`.
 */
export interface AxisMapping {
  readonly ned_x: { readonly glbAxis: 'x' | 'y' | 'z'; readonly sign: 1 | -1 }
  readonly ned_y: { readonly glbAxis: 'x' | 'y' | 'z'; readonly sign: 1 | -1 }
  readonly ned_z: { readonly glbAxis: 'x' | 'y' | 'z'; readonly sign: 1 | -1 }
}

/** A named landmark position in GLB coordinates. */
export interface Landmark {
  readonly name: string
  readonly glb: Vec3
  readonly description?: string
}

/** A named attachment point (riser, shoulder, container back, etc.). */
export interface Attachment {
  readonly name: string
  readonly glb: Vec3
  readonly description?: string
}

/**
 * Canopy cell geometry extracted from GLB mesh measurements.
 *
 * Positions are in GLB units at the cell's quarter-chord point (aerodynamic center).
 * The center cell uses X=0 (symmetry plane). Left cells mirror at −X.
 */
export interface CanopyCellGLB {
  /** Cell index (1 = center, 2 = first pair from center, ..., 4 = outermost) */
  readonly index: number
  /** Cell center X (GLB) — spanwise position (right-side center of full cell) */
  readonly glbX: number
  /** Airfoil Y (GLB) — vertical, average of top and bottom skin Y */
  readonly glbY: number
  /** Quarter-chord Z (GLB) — chordwise: LE − 0.25 × chord_GLB */
  readonly glbQcZ: number
  /** Trailing edge Z (GLB) */
  readonly glbTeZ: number
}

/**
 * Canopy rib geometry extracted from GLB mesh measurements.
 *
 * Each rib is a vertical airfoil-shaped panel at a specific spanwise position.
 * Load-bearing ribs carry A/B/C/D suspension lines and form cell boundaries.
 * Non-load-bearing ribs sit at cell centers for shape.
 */
export interface CanopyRibGLB {
  /** Rib index matching GLB mesh naming (1–8 per half-span) */
  readonly index: number
  /** Spanwise X position (GLB units, right side ≥ 0) */
  readonly glbX: number
  /** Bottom of airfoil profile Y (GLB) */
  readonly glbYMin: number
  /** Top of airfoil profile Y (GLB) */
  readonly glbYMax: number
  /** Bottom skin Y at the leading edge (GLB) — where the A-line
   *  attaches to the canopy at the LE. Derived from a_N_upper mesh yMax.
   *  Only present on load-bearing ribs (which carry A-lines). */
  readonly glbYBottomLE?: number
  /** Spanwise X at the A-line LE attachment (GLB) — typically inboard
   *  of the rib edge because lines converge toward center.
   *  Derived from a_N_upper mesh xMax. Only load-bearing ribs. */
  readonly glbXBottomLE?: number
  /** Spanwise X at the TE cell boundary (GLB) — the bottom skin
   *  is narrower than the rib edge, especially toward the tips.
   *  Derived from Bottom_N_L panel xMax. Only load-bearing ribs. */
  readonly glbXBottomTE?: number
  /** Bottom surface Y at the trailing edge (GLB) — the TE is thin,
   *  so the bottom sits well above glbYMin (which is at max thickness).
   *  Derived from Top_N_L panel yMin (TE seam Y at outer-TE corner).
   *  Only load-bearing ribs. */
  readonly glbYBottomTE?: number
  /** Chord-line Y at the leading edge (GLB) — the Y coordinate of the
   *  most-forward vertex (max Z) on the rib mesh, i.e. the true airfoil
   *  nose.  NOT the bounding-box midpoint — the nose is offset toward
   *  the lower surface on a cambered profile. */
  readonly glbYChordLE: number
  /** Spanwise X of the nose vertex (max Z) on the rib mesh (GLB).
   *  Differs from glbX because glbX is the rib's outer edge while the
   *  nose vertex sits slightly inboard. */
  readonly glbXNose: number
  /** Z of the nose vertex on the rib mesh (GLB).  Slightly aft of the
   *  top skin zLE (0.655) because the rib profile stops short of the
   *  fabric leading edge. All ribs cluster around 0.626–0.627. */
  readonly glbZNose: number
  /** Whether this rib carries suspension lines (A/B/C/D) */
  readonly loadBearing: boolean
}

/**
 * Bounding box for one cell (or one side of a paired cell) in GLB coordinates.
 *
 * The 8 corners follow the canopy arc — inner and outer Y values differ
 * because the canopy curves downward toward the wingtips.
 */
export interface CellBoundsGLB {
  readonly cellIndex: number
  readonly side: 'center' | 'right' | 'left'
  /** Inner boundary rib X (0 for center cell) */
  readonly xInner: number
  /** Outer boundary rib X */
  readonly xOuter: number
  /** Inner boundary rib Y range (full airfoil profile) */
  readonly yMinInner: number
  readonly yMaxInner: number
  /** Outer boundary rib Y range (full airfoil profile) */
  readonly yMinOuter: number
  readonly yMaxOuter: number
  /** Inner A-line LE attachment X (inboard of rib edge) */
  readonly xBottomLEInner: number
  /** Outer A-line LE attachment X (inboard of rib edge) */
  readonly xBottomLEOuter: number
  /** Inner A-line LE attachment Y */
  readonly yBottomLEInner: number
  /** Outer A-line LE attachment Y */
  readonly yBottomLEOuter: number
  /** Inner TE cell boundary X (bottom skin, inboard of rib edge) */
  readonly xBottomTEInner: number
  /** Outer TE cell boundary X (bottom skin, inboard of rib edge) */
  readonly xBottomTEOuter: number
  /** Inner TE cell boundary Y (TE seam, above yMin) */
  readonly yBottomTEInner: number
  /** Outer TE cell boundary Y (TE seam, above yMin) */
  readonly yBottomTEOuter: number
  /** Chord-line LE Y at inner boundary — true nose vertex Y */
  readonly yChordLEInner: number
  /** Chord-line LE Y at outer boundary — true nose vertex Y */
  readonly yChordLEOuter: number
  /** Nose vertex X at inner boundary (inboard of rib edge) */
  readonly xNoseInner: number
  /** Nose vertex X at outer boundary (inboard of rib edge) */
  readonly xNoseOuter: number
  /** Nose vertex Z — rib mesh LE, slightly aft of top-skin zLE */
  readonly zNose: number
  /** Leading edge Z — top skin (chordwise forward) */
  readonly zLE: number
  /** Leading edge Z — bottom skin / A-line attachment (chordwise, aft of top LE) */
  readonly zBottomLE: number
  /** Trailing edge Z (chordwise aft) */
  readonly zTE: number
}

// ─────────────────────────────────────────────────────────────────────
//  Line-set types
// ─────────────────────────────────────────────────────────────────────

/**
 * A single suspension-line attachment or junction point in GLB coordinates.
 *
 * All positions are right-side (+X). Left-side mirrors at −X.
 */
export interface LinePointGLB {
  /** Spanwise position (GLB, right side ≥ 0) */
  readonly glbX: number
  /** Vertical position (GLB, Y-up) */
  readonly glbY: number
  /** Chordwise position (GLB, +Z = forward) */
  readonly glbZ: number
}

/**
 * Line geometry for one load-bearing rib (right side).
 *
 * Each rib carries four line groups: A (LE), B (forward of QC),
 * C (aft of QC), D (rear).
 *
 * A + B upper lines cascade into a single lower line → front riser.
 * C + D upper lines cascade into a single lower line → rear riser.
 *
 * The cascade point is where two upper lines merge into one lower line.
 * Extracted from the lower segment's top vertex (start of the combined line).
 */
export interface LineSetRibGLB {
  /** Load-bearing rib index (2, 4, 6, 8) */
  readonly ribIndex: number

  // ── Canopy attachment points (top of upper line segments) ──
  /** A-line canopy attachment — forward (LE support) */
  readonly aCanopy: LinePointGLB
  /** B-line canopy attachment — forward of quarter-chord */
  readonly bCanopy: LinePointGLB
  /** C-line canopy attachment — aft of quarter-chord */
  readonly cCanopy: LinePointGLB
  /** D-line canopy attachment — rear */
  readonly dCanopy: LinePointGLB

  // ── Cascade junctions (where upper lines merge into lower) ──
  /** A/B cascade — front group junction (→ front riser) */
  readonly abCascade: LinePointGLB
  /** C/D cascade — rear group junction (→ rear riser) */
  readonly cdCascade: LinePointGLB

  // ── Lower line riser-end points (bottom of lower segments) ──
  /** A/B lower line end near front riser */
  readonly abRiserEnd: LinePointGLB
  /** C/D lower line end near rear riser */
  readonly cdRiserEnd: LinePointGLB
}

/**
 * Riser geometry in GLB coordinates (right side).
 *
 * The riser spans from top (where lower lines attach) to bottom
 * (at the harness / pilot attachment).
 */
export interface RiserGLB {
  /** Top of riser — where lower lines connect */
  readonly top: LinePointGLB
  /** Bottom of riser — at harness */
  readonly bottom: LinePointGLB
}

/**
 * Complete suspension line set geometry for a canopy model.
 *
 * Contains per-rib line attachment points, cascade junctions, and riser
 * endpoints. All positions are right-side GLB coordinates (+X = right).
 *
 * Extracted from cp2.gltf mesh vertices using extract-lines.cjs.
 */
export interface LineSetGLB {
  /** Per-rib line data for each load-bearing rib */
  readonly ribs: readonly LineSetRibGLB[]
  /** Front riser (receives A/B lower lines) */
  readonly frontRiser: RiserGLB
  /** Rear riser (receives C/D lower lines) */
  readonly rearRiser: RiserGLB
}

/**
 * Complete geometry description for a single GLB model file.
 *
 * Contains everything needed to convert from GLB space to physical meters
 * and NED-normalized coordinates, independent of how the model is assembled
 * with other models.
 */
export interface ModelGeometry {
  /** Model identifier (matches filename without extension) */
  readonly id: string
  /** Path to GLB/GLTF file relative to public/ */
  readonly path: string
  /** Human-readable description */
  readonly description: string

  // ── raw GLB measurements ──
  readonly bbox: BBox
  /** Maximum dimension across all axes [GLB units] */
  readonly maxDim: number
  /** Which axis has the maximum dimension */
  readonly maxDimAxis: 'x' | 'y' | 'z'

  // ── axis mapping ──
  readonly axes: AxisMapping

  // ── physical dimensions ──
  /** The physical dimension [m] that maps to `maxDim` (or a specific GLB extent) */
  readonly physicalReference: {
    /** What the dimension represents (e.g. 'pilotHeight', 'chord') */
    readonly name: string
    /** Physical value in meters */
    readonly meters: number
    /** GLB extent this maps to (defaults to maxDim if not specified) */
    readonly glbExtent: number
  }

  /** Derived: GLB units → meters. `physicalReference.meters / physicalReference.glbExtent` */
  readonly glbToMeters: number
  /** Derived: GLB units → NED normalized. `glbToMeters / referenceHeight` */
  readonly glbToNED: number
  /** Reference height for NED normalization [m] */
  readonly referenceHeight: number

  // ── internal transforms ──
  /** Internal mesh rotation (as authored in Blender) — e.g. −180° X flip */
  readonly internalRotationDeg?: Vec3
  /** Internal mesh scale (as authored) — e.g. 0.050 */
  readonly internalScale?: number

  // ── landmarks ──
  readonly landmarks: readonly Landmark[]
  readonly attachments: readonly Attachment[]

  // ── canopy-specific ──
  /** Cell geometry for canopy models (4 cells: center + 3 pairs for Ibex UL) */
  readonly cells?: readonly CanopyCellGLB[]
  /** Chord extent in GLB units (LE to TE, from top skin) */
  readonly glbChord?: number
  /** Leading edge Z position in GLB (top skin) */
  readonly glbLeZ?: number
  /** Leading edge Z position in GLB (bottom skin / A-line attachment) */
  readonly glbBottomLeZ?: number
  /** Trailing edge Z position in GLB */
  readonly glbTeZ?: number
  /** Line attachment row Z positions in GLB [chordwise] */
  readonly lineRows?: {
    readonly A: number  // front
    readonly B: number  // near quarter-chord
    readonly C: number  // mid-chord
    readonly D: number  // rear
  }

  /** Rib geometry for canopy models — positions and Y extents from GLB */
  readonly ribs?: readonly CanopyRibGLB[]

  /** Suspension line set geometry — per-rib attachments, cascades, risers */
  readonly lineSet?: LineSetGLB

  // ── pilot-body-specific ──
  /** CG offset from BBox center as fraction of body length (forward = positive) */
  readonly cgOffsetFraction?: number
  /** Fabric overshoot factor — GLB mesh extends past physical body by this ratio */
  readonly fabricOvershoot?: number
}

/**
 * Rules for composing two models into an assembled vehicle.
 *
 * The assembly pipeline:
 * 1. Load both models in their raw GLB coordinates
 * 2. Apply `parentScale` to the parent model (e.g. CANOPY_SCALE)
 * 3. Position the child in the parent's GLB frame using `childOffset` + `childRotation`
 * 4. Normalize the composite using the child's raw max dimension as reference
 */
export interface VehicleAssembly {
  /** Assembly identifier */
  readonly id: string
  readonly description: string

  /** Parent model (the one that gets scaled) */
  readonly parentId: string
  /** Child model (the pilot body — provides normalization reference) */
  readonly childId: string

  /** Scale applied to parent before compositing [dimensionless] */
  readonly parentScale: number

  /**
   * Base parent scale before component scaling (used for NED→scene conversion).
   * When component scales enlarge the canopy mesh beyond physical proportions,
   * pilotScale (NED→scene) should use this base value so physics positions
   * remain at the correct physical size.
   * Falls back to parentScale if not set.
   */
  readonly baseParentScale?: number

  /**
   * Scale applied to the child model within the composite [dimensionless].
   * Corrects for different GLB-to-meters ratios between parent and child:
   *   childScale = parentScale × childGlbToMeters / parentGlbToMeters
   * Without this, the pilot body appears oversized relative to the canopy.
   */
  readonly childScale?: number

  /** Child position in raw parent GLB coordinates (after parent scaling) */
  readonly childOffset: Vec3
  /** Child rotation [degrees] — applied as Euler XYZ */
  readonly childRotationDeg: Vec3

  /**
   * Shoulder offset as fraction of child's raw body extent (before childScale).
   * Derived from the shoulder attachment landmark: glbZ / maxDim.
   * The effective offset in the composite is: fraction × bodyExtent × childScale.
   */
  readonly shoulderOffsetFraction: number

  /** Bridle/PC attachment: trailing edge shift in normalized coordinates */
  readonly trailingEdgeShift: number

  /** Deployment sub-model scales (fraction of normalization scale) */
  readonly deployScales?: {
    readonly pc: number       // pilot chute
    readonly snivel: number   // canopy in bag
    readonly bridle: number   // bridle line
  }

  // ── physics ──
  /** Trim angle [degrees] — canopy trim in straight flight */
  readonly trimAngleDeg: number
  /**
   * Pilot forward shift from riser [NED normalized].
   * In a vertical hang the CG is directly below the riser → 0.
   * Non-zero only if the body hangs off-center from the attachment.
   */
  readonly pilotFwdShift: number
  /**
   * Pilot downward shift from riser [NED normalized].
   * Derived from shoulder-to-CG distance: shoulder_glbZ × pilotGlbToMeters / REF_HEIGHT.
   */
  readonly pilotDownShift: number
}

// ─────────────────────────────────────────────────────────────────────
//  Conversion helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert a GLB position to NED-normalized using the model's axis mapping
 * and scale factors.
 *
 * @param glb     Position in GLB coordinates
 * @param model   Model geometry (provides axes and glbToNED)
 * @returns       Position in NED-normalized coordinates
 */
export function glbToNED(glb: Vec3, model: ModelGeometry): Vec3 {
  const s = model.glbToNED
  const a = model.axes
  return {
    x: glb[a.ned_x.glbAxis] * a.ned_x.sign * s || 0,
    y: glb[a.ned_y.glbAxis] * a.ned_y.sign * s || 0,
    z: glb[a.ned_z.glbAxis] * a.ned_z.sign * s || 0,
  }
}

/**
 * Convert a GLB position to physical meters.
 */
export function glbToMeters(glb: Vec3, model: ModelGeometry): Vec3 {
  const s = model.glbToMeters
  const a = model.axes
  return {
    x: glb[a.ned_x.glbAxis] * a.ned_x.sign * s || 0,
    y: glb[a.ned_y.glbAxis] * a.ned_y.sign * s || 0,
    z: glb[a.ned_z.glbAxis] * a.ned_z.sign * s || 0,
  }
}

/**
 * Get canopy cell positions in NED-normalized coordinates.
 *
 * Returns positions relative to the GLB origin (riser convergence for cp2).
 * To get positions relative to the system CG, subtract the CG position.
 *
 * @param model   Canopy model geometry (must have cells)
 * @param point   'qc' for quarter-chord (aerodynamic center) or 'te' for trailing edge
 */
export function getCellPositionsNED(
  model: ModelGeometry,
  point: 'qc' | 'te' = 'qc',
): { index: number; ned: Vec3; side: 'center' | 'right' | 'left' }[] {
  if (!model.cells) return []
  const results: { index: number; ned: Vec3; side: 'center' | 'right' | 'left' }[] = []

  for (const cell of model.cells) {
    const z = point === 'qc' ? cell.glbQcZ : cell.glbTeZ
    // Center cell at X=0 (symmetry plane)
    const glbCenter: Vec3 = { x: 0, y: cell.glbY, z }
    if (cell.index === 1) {
      results.push({ index: cell.index, ned: glbToNED(glbCenter, model), side: 'center' })
    } else {
      // Right side (+X in GLB → +y in NED)
      const glbRight: Vec3 = { x: cell.glbX, y: cell.glbY, z }
      results.push({ index: cell.index, ned: glbToNED(glbRight, model), side: 'right' })
      // Left side (−X in GLB → −y in NED)
      const glbLeft: Vec3 = { x: -cell.glbX, y: cell.glbY, z }
      results.push({ index: cell.index, ned: glbToNED(glbLeft, model), side: 'left' })
    }
  }
  return results
}

/**
 * Compute bounding boxes for all canopy cells in GLB coordinates.
 *
 * Each cell is bounded spanwise by load-bearing ribs and chordwise by LE/TE.
 * Height (Y) values follow the canopy arc at each boundary rib.
 *
 * Returns one entry for the center cell, and right + left entries for
 * each paired cell (mirrored at −X).
 */
export function getCellBoundsGLB(model: ModelGeometry): CellBoundsGLB[] {
  if (!model.cells || !model.ribs || model.glbLeZ == null || model.glbTeZ == null) return []

  const ribs = model.ribs
  // Build rib lookup by index for O(1) access
  const ribByIdx = new Map<number, CanopyRibGLB>()
  for (const r of ribs) ribByIdx.set(r.index, r)

  // Load-bearing rib indices define cell boundaries, sorted by position
  const lbRibs = ribs.filter(r => r.loadBearing).sort((a, b) => a.glbX - b.glbX)

  const results: CellBoundsGLB[] = []
  const zLE = model.glbLeZ
  const zBottomLE = model.glbBottomLeZ ?? model.glbLeZ  // fall back to top skin LE
  const zTE = model.glbTeZ

  /** A-line LE attachment X for a rib — falls back to rib glbX if not specified. */
  const xBLE = (rib: CanopyRibGLB) => rib.glbXBottomLE ?? rib.glbX
  /** A-line LE attachment Y for a rib — falls back to rib yMin if not specified. */
  const yBLE = (rib: CanopyRibGLB) => rib.glbYBottomLE ?? rib.glbYMin
  /** TE cell boundary X — falls back to rib glbX if not specified. */
  const xBTE = (rib: CanopyRibGLB) => rib.glbXBottomTE ?? rib.glbX
  /** TE cell boundary Y — falls back to rib yMin if not specified. */
  const yBTE = (rib: CanopyRibGLB) => rib.glbYBottomTE ?? rib.glbYMin
  /** Chord-line LE Y — true nose vertex (max Z on rib mesh). */
  const yCLE = (rib: CanopyRibGLB) => rib.glbYChordLE
  /** Nose vertex X — slightly inboard of rib edge. */
  const xNose = (rib: CanopyRibGLB) => rib.glbXNose
  /** Nose vertex Z — rib mesh LE, slightly aft of top skin. */
  const zNose = (rib: CanopyRibGLB) => rib.glbZNose

  // Cell 1 (center): spans from −Rib_2 to +Rib_2
  const centerRib = ribByIdx.get(1)  // Rib_1 (non-load-bearing center)
  const firstLB = lbRibs[0]          // Rib_2 (first load-bearing)
  if (centerRib && firstLB) {
    results.push({
      cellIndex: 1,
      side: 'center',
      xInner: -firstLB.glbX,
      xOuter: firstLB.glbX,
      yMinInner: firstLB.glbYMin,
      yMaxInner: firstLB.glbYMax,
      yMinOuter: firstLB.glbYMin,
      yMaxOuter: firstLB.glbYMax,
      xBottomLEInner: -xBLE(firstLB),
      xBottomLEOuter: xBLE(firstLB),
      yBottomLEInner: yBLE(firstLB),
      yBottomLEOuter: yBLE(firstLB),
      xBottomTEInner: -xBTE(firstLB),
      xBottomTEOuter: xBTE(firstLB),
      yBottomTEInner: yBTE(firstLB),
      yBottomTEOuter: yBTE(firstLB),
      yChordLEInner: yCLE(firstLB),
      yChordLEOuter: yCLE(firstLB),
      xNoseInner: -xNose(firstLB),
      xNoseOuter: xNose(firstLB),
      zNose: zNose(firstLB),
      zLE, zBottomLE, zTE,
    })
  }

  // Paired cells: each spans between consecutive load-bearing ribs
  for (let i = 0; i < lbRibs.length - 1; i++) {
    const inner = lbRibs[i]
    const outer = lbRibs[i + 1]
    const cellIndex = i + 2  // cell 2, 3, 4

    // Right side (+X)
    results.push({
      cellIndex,
      side: 'right',
      xInner: inner.glbX,
      xOuter: outer.glbX,
      yMinInner: inner.glbYMin,
      yMaxInner: inner.glbYMax,
      yMinOuter: outer.glbYMin,
      yMaxOuter: outer.glbYMax,
      xBottomLEInner: xBLE(inner),
      xBottomLEOuter: xBLE(outer),
      yBottomLEInner: yBLE(inner),
      yBottomLEOuter: yBLE(outer),
      xBottomTEInner: xBTE(inner),
      xBottomTEOuter: xBTE(outer),
      yBottomTEInner: yBTE(inner),
      yBottomTEOuter: yBTE(outer),
      yChordLEInner: yCLE(inner),
      yChordLEOuter: yCLE(outer),
      xNoseInner: xNose(inner),
      xNoseOuter: xNose(outer),
      zNose: (zNose(inner) + zNose(outer)) / 2,
      zLE, zBottomLE, zTE,
    })

    // Left side (−X, mirrored)
    results.push({
      cellIndex,
      side: 'left',
      xInner: -inner.glbX,
      xOuter: -outer.glbX,
      yMinInner: inner.glbYMin,
      yMaxInner: inner.glbYMax,
      yMinOuter: outer.glbYMin,
      yMaxOuter: outer.glbYMax,
      xBottomLEInner: -xBLE(inner),
      xBottomLEOuter: -xBLE(outer),
      yBottomLEInner: yBLE(inner),
      yBottomLEOuter: yBLE(outer),
      xBottomTEInner: -xBTE(inner),
      xBottomTEOuter: -xBTE(outer),
      yBottomTEInner: yBTE(inner),
      yBottomTEOuter: yBTE(outer),
      yChordLEInner: yCLE(inner),
      yChordLEOuter: yCLE(outer),
      xNoseInner: -xNose(inner),
      xNoseOuter: -xNose(outer),
      zNose: (zNose(inner) + zNose(outer)) / 2,
      zLE, zBottomLE, zTE,
    })
  }

  return results
}

/**
 * Apply an assembly offset to shift GLB-origin-relative positions
 * to system-CG-relative positions.
 *
 * @param position  NED-normalized position relative to GLB origin
 * @param cgNED     System CG in NED-normalized (relative to same GLB origin)
 */
export function relativeToCG(position: Vec3, cgNED: Vec3): Vec3 {
  return {
    x: position.x - cgNED.x,
    y: position.y - cgNED.y,
    z: position.z - cgNED.z,
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Model definitions
// ─────────────────────────────────────────────────────────────────────

// Reference height used throughout the system (pilot height in meters)
// TODO(ref-audit): keep as render-only; do not mix with aero reference length
const REF_HEIGHT = 1.875

/**
 * tsimwingsuit.glb — Wingsuit Pilot (Aura 5)
 *
 * Measurements from Three.js Editor via tools/glb-measure.js.
 * See MODEL-GEOMETRY.md § tsimwingsuit.glb for full documentation.
 */
export const WINGSUIT_GEOMETRY: ModelGeometry = {
  id: 'tsimwingsuit',
  path: '/models/tsimwingsuit.glb',
  description: 'Wingsuit pilot (Aura 5) — used standalone and as canopy sub-model',

  bbox: {
    min: { x: -1.412, y: -0.284, z: -2.473 },
    max: { x:  1.412, y:  0.328, z:  1.077 },
    size: { x: 2.824, y: 0.612, z: 3.550 },
  },
  maxDim: 3.550,
  maxDimAxis: 'z',

  axes: {
    ned_x: { glbAxis: 'z', sign:  1 },   // GLB +Z = head = NED forward
    ned_y: { glbAxis: 'x', sign: -1 },   // GLB −X = right hand = NED right
    ned_z: { glbAxis: 'y', sign: -1 },   // GLB −Y = dorsal→ventral = NED down
  },

  physicalReference: {
    name: 'pilotHeight',
    meters: REF_HEIGHT,
    glbExtent: 3.550,
  },
  glbToMeters: REF_HEIGHT / 3.550,               // 0.5282
  glbToNED: (REF_HEIGHT / 3.550) / REF_HEIGHT,   // 0.2817
  referenceHeight: REF_HEIGHT,

  internalRotationDeg: { x: -179.91, y: 0, z: 0 },
  internalScale: 0.050,

  landmarks: [
    { name: 'cg',         glb: { x: 0, y: 0, z: 0 },       description: 'GLB origin ≈ belly CG' },
    { name: 'bboxCenter', glb: { x: 0, y: 0.022, z: -0.698 }, description: 'Geometric center of BBox' },
  ],

  attachments: [
    { name: 'container_back',  glb: { x: 0, y: 0.320, z: -0.128 },    description: 'PC/bridle attachment (mid-back)' },
    { name: 'shoulder_left',   glb: { x:  0.240, y: 0, z: 0.560 },     description: 'Left shoulder (riser, wing LE)' },
    { name: 'shoulder_right',  glb: { x: -0.240, y: 0, z: 0.560 },     description: 'Right shoulder (riser, wing LE)' },
  ],

  cgOffsetFraction: 0.197,
  fabricOvershoot: 1.15,
}

/**
 * tslick.glb — Slick Skydiver
 *
 * Same axis convention as wingsuit, slightly smaller BBox.
 * See MODEL-GEOMETRY.md § tslick.glb.
 */
export const SLICK_GEOMETRY: ModelGeometry = {
  id: 'tslick',
  path: '/models/tslick.glb',
  description: 'Slick skydiver — used standalone and as canopy sub-model',

  bbox: {
    min: { x: -0.850, y: -0.284, z: -2.307 },
    max: { x:  0.850, y:  0.328, z:  1.077 },
    size: { x: 1.700, y: 0.612, z: 3.384 },
  },
  maxDim: 3.384,
  maxDimAxis: 'z',

  axes: {
    ned_x: { glbAxis: 'z', sign:  1 },
    ned_y: { glbAxis: 'x', sign: -1 },
    ned_z: { glbAxis: 'y', sign: -1 },
  },

  physicalReference: {
    name: 'pilotHeight',
    meters: REF_HEIGHT,
    glbExtent: 3.384,
  },
  glbToMeters: REF_HEIGHT / 3.384,               // 0.5541
  glbToNED: (REF_HEIGHT / 3.384) / REF_HEIGHT,   // 0.2955
  referenceHeight: REF_HEIGHT,

  internalRotationDeg: { x: -179.91, y: 0, z: 0 },
  internalScale: 0.050,

  landmarks: [
    { name: 'cg',         glb: { x: 0, y: 0, z: 0 },       description: 'GLB origin ≈ belly CG' },
    { name: 'bboxCenter', glb: { x: 0, y: 0.022, z: -0.615 }, description: 'Geometric center of BBox' },
  ],

  attachments: [
    { name: 'container_back', glb: { x: 0, y: 0.320, z: -0.128 }, description: 'PC/bridle attachment (estimated)' },
  ],

  cgOffsetFraction: 0.197,
  fabricOvershoot: 1.15,
}

/**
 * cp2.gltf — Ibex UL Canopy
 *
 * 7-cell RAM-air paraglider with suspension lines and embedded pilot reference.
 * GLB origin at riser convergence (bottom of line set).
 * See MODEL-GEOMETRY.md § cp2.gltf for full documentation.
 *
 * Scale: glbToMeters derived from physical chord (3.29 m) / GLB chord (3.529),
 * NOT from the pilot body, since this model has no pilot body.
 */
export const CANOPY_GEOMETRY: ModelGeometry = {
  id: 'cp2',
  path: '/models/cp2.gltf',
  description: 'Ibex UL canopy — 7-cell RAM-air, 220 ft²',

  bbox: {
    min: { x: -3.133, y: -0.002, z: -2.874 },
    max: { x:  3.133, y:  4.735, z:  0.655 },
    size: { x: 6.266, y: 4.738, z: 3.528 },
  },
  maxDim: 6.266,
  maxDimAxis: 'x',

  // Canopy GLB: +Z = forward (LE), +Y = up (canopy above), +X = right
  // NED: x = forward, y = right, z = down
  axes: {
    ned_x: { glbAxis: 'z', sign:  1 },   // GLB +Z = LE direction = NED forward
    ned_y: { glbAxis: 'x', sign:  1 },   // GLB +X = right span = NED right
    ned_z: { glbAxis: 'y', sign: -1 },   // GLB −Y = down = NED down
  },

  physicalReference: {
    name: 'chord',
    meters: 3.29,       // physical chord [m] — 220 ft², area/arc-span
    glbExtent: 3.529,   // GLB chord (LE top Z +0.655 to TE Z −2.874)
  },
  glbToMeters: 3.29 / 3.529,                       // 0.9322
  glbToNED: (3.29 / 3.529) / 1.875,                // derived: glbToMeters / referenceHeight
  referenceHeight: 1.875,                           // same as pilot height for now

  landmarks: [
    { name: 'bboxCenter',      glb: { x: 0, y: 2.366, z: -1.110 },  description: 'Geometric center of BBox' },
    { name: 'leCenter',        glb: { x: 0, y: 4.533, z:  0.655 },  description: 'Leading edge center cell (top skin)' },
    { name: 'teCenter',        glb: { x: 0, y: 4.221, z: -2.874 },  description: 'Trailing edge center cell' },
    { name: 'riserConvergence', glb: { x: 0, y: 0.240, z: -0.050 }, description: 'Near GLB origin — risers meet here' },
    { name: 'embeddedPilot',   glb: { x: 0, y: -5.280, z: -0.080 }, description: 'wingsuit4glb ref: rot −96.4° X' },
  ],

  attachments: [
    { name: 'frontRiser',     glb: { x: 0, y: 0.250, z: -0.006 }, description: 'Front riser (19% chord from LE)' },
    { name: 'rearRiser',      glb: { x: 0, y: 0.233, z: -0.096 }, description: 'Rear riser (21% chord from LE)' },
    { name: 'riserBottom_R',  glb: { x:  0.256, y: 0, z: 0 },    description: 'Right riser at harness' },
    { name: 'riserBottom_L',  glb: { x: -0.256, y: 0, z: 0 },    description: 'Left riser at harness' },
    { name: 'bridleTop',      glb: { x: 0, y: 4.672, z: -0.848 }, description: 'Top of canopy (76% chord from LE)' },
  ],

  // ── chord geometry ──
  glbChord: 3.529,        // LE top (+0.655) to TE (−2.874)
  glbLeZ: 0.655,          // leading edge Z (top skin)
  glbBottomLeZ: 0.308,    // leading edge Z (bottom skin / A-line attachment)
                          // from a2_upper zMax=0.308, a4_upper zMax=0.307
  glbTeZ: -2.874,         // trailing edge Z

  // ── line row Z positions (chordwise) ──
  lineRows: {
    A:  0.120,    // 15% chord — LE support
    B: -0.270,    // 26% chord — near quarter-chord
    C: -1.231,    // 53% chord — mid-chord
    D: -1.567,    // 63% chord — rear (not at TE)
  },

  // ── 4 full cells: QC and TE positions in GLB units ──
  //
  // A paraglider cell spans two mesh bays, bounded by load-bearing ribs
  // (which carry A/B/C/D suspension lines) with a non-load-bearing rib
  // in the center for shape.  The GLB has 8 ribs per half-span:
  //   Load-bearing (with lines): Rib_2 (0.459), Rib_4 (1.412), Rib_6 (2.329), Rib_8 (3.133)
  //   Non-load-bearing (center): Rib_1 (0.000), Rib_3 (0.928), Rib_5 (1.882), Rib_7 (2.749)
  //
  // Cell glbX/glbY/glbQcZ use the non-load-bearing rib's true nose vertex
  // (glbXNose, glbYChordLE, glbZNose) for the chord-plane aerodynamic center.
  // QC Z = noseZ + 0.25 × (teZ − noseZ) ≈ 0.627 + 0.25 × (−3.501) ≈ −0.248
  // Previously used top-skin LE (0.655) giving QC Z = −0.227 — ~19 mm too far forward.
  cells: [
    { index: 1, glbX: 0.000, glbY: 4.337, glbQcZ: -0.248, glbTeZ: -2.874 },  // center cell  (Rib_1 nose)
    { index: 2, glbX: 0.895, glbY: 4.305, glbQcZ: -0.249, glbTeZ: -2.874 },  // inner pair   (Rib_3 nose)
    { index: 3, glbX: 1.763, glbY: 4.107, glbQcZ: -0.249, glbTeZ: -2.874 },  // mid pair     (Rib_5 nose)
    { index: 4, glbX: 2.555, glbY: 3.699, glbQcZ: -0.249, glbTeZ: -2.874 },  // outer pair   (Rib_7 nose)
  ],

  // ── rib geometry: Y extents + LE/TE attachment positions from GLB ──
  //
  // glbYMin/glbYMax: full airfoil profile bounds from Rib_N_L meshes.
  // glbXBottomLE/glbYBottomLE: A-line attachment at LE (a_N_upper xMax/yMax).
  // glbXBottomTE: bottom skin X at TE cell boundary (Bottom_N_L xMax,
  //   the outer panel whose outer edge is at that rib).
  // glbYBottomTE: TE seam Y (Top_N_L yMin — the trailing edge is thin,
  //   so the bottom surface sits well above yMin at max thickness).
  // Only load-bearing ribs have LE/TE attachment data.
  // glbYChordLE / glbXNose / glbZNose: extracted from actual rib mesh vertex
  //   with maximum Z (the airfoil nose), using extract-rib-noses.cjs.
  ribs: [
    { index: 1, glbX: 0.000, glbYMin: 4.155, glbYMax: 4.681, glbYChordLE: 4.337, glbXNose: 0.000, glbZNose: 0.627, loadBearing: false },  // center rib (no lines)
    { index: 2, glbX: 0.459, glbYMin: 4.149, glbYMax: 4.675, glbYChordLE: 4.331, glbXNose: 0.448, glbZNose: 0.626, glbXBottomLE: 0.447, glbYBottomLE: 4.151, glbXBottomTE: 0.448, glbYBottomTE: 4.331, loadBearing: true  },  // LE: a2_upper, TE: Bottom_1_L xMax / Top_1_L yMin
    { index: 3, glbX: 0.928, glbYMin: 4.123, glbYMax: 4.646, glbYChordLE: 4.305, glbXNose: 0.895, glbZNose: 0.626, loadBearing: false },  // cell 2 center (no lines)
    { index: 4, glbX: 1.412, glbYMin: 4.058, glbYMax: 4.571, glbYChordLE: 4.236, glbXNose: 1.336, glbZNose: 0.626, glbXBottomLE: 1.300, glbYBottomLE: 4.061, glbXBottomTE: 1.336, glbYBottomTE: 4.236, loadBearing: true  },  // LE: a4_upper, TE: Bottom_3_L xMax / Top_3_L yMin
    { index: 5, glbX: 1.882, glbYMin: 3.936, glbYMax: 4.429, glbYChordLE: 4.107, glbXNose: 1.763, glbZNose: 0.626, loadBearing: false },  // cell 3 center (no lines)
    { index: 6, glbX: 2.329, glbYMin: 3.766, glbYMax: 4.233, glbYChordLE: 3.928, glbXNose: 2.172, glbZNose: 0.626, glbXBottomLE: 2.092, glbYBottomLE: 3.769, glbXBottomTE: 2.172, glbYBottomTE: 3.928, loadBearing: true  },  // LE: a6_upper, TE: Bottom_5_L xMax / Top_5_L yMin
    { index: 7, glbX: 2.749, glbYMin: 3.549, glbYMax: 3.983, glbYChordLE: 3.699, glbXNose: 2.555, glbZNose: 0.626, loadBearing: false },  // cell 4 center (no lines)
    { index: 8, glbX: 3.133, glbYMin: 3.289, glbYMax: 3.688, glbYChordLE: 3.427, glbXNose: 2.910, glbZNose: 0.627, glbXBottomLE: 2.795, glbYBottomLE: 3.293, glbXBottomTE: 2.909, glbYBottomTE: 3.427, loadBearing: true  },  // LE: a8_upper, TE: Bottom_7_L xMax / Top_7_L yMin
  ],

  // ── suspension line set: per-rib attachments, cascades, risers ──
  //
  // Extracted from cp2.gltf mesh vertices using extract-lines.cjs.
  // All positions are right-side GLB coordinates (+X = right).
  // Canopy attachment = top vertex (yMax) of upper segment.
  // Cascade = top vertex (yMax) of lower segment (start of combined line).
  // Riser end = bottom vertex (yMin) of lower segment.
  lineSet: {
    ribs: [
      {
        ribIndex: 2,
        aCanopy:    { glbX: 0.442, glbY: 4.151, glbZ:  0.299 },
        bCanopy:    { glbX: 0.443, glbY: 4.186, glbZ: -0.472 },
        cCanopy:    { glbX: 0.444, glbY: 4.223, glbZ: -1.271 },
        dCanopy:    { glbX: 0.446, glbY: 4.261, glbZ: -1.943 },
        abCascade:  { glbX: 0.440, glbY: 3.067, glbZ: -0.059 },
        cdCascade:  { glbX: 0.438, glbY: 3.110, glbZ: -1.181 },
        abRiserEnd: { glbX: 0.435, glbY: 0.500, glbZ: -0.016 },
        cdRiserEnd: { glbX: 0.422, glbY: 0.465, glbZ: -0.197 },
      },
      {
        ribIndex: 4,
        aCanopy:    { glbX: 1.293, glbY: 4.061, glbZ:  0.299 },
        bCanopy:    { glbX: 1.301, glbY: 4.094, glbZ: -0.473 },
        cCanopy:    { glbX: 1.307, glbY: 4.131, glbZ: -1.275 },
        dCanopy:    { glbX: 1.318, glbY: 4.168, glbZ: -1.944 },
        abCascade:  { glbX: 1.035, glbY: 3.004, glbZ: -0.064 },
        cdCascade:  { glbX: 1.045, glbY: 3.045, glbZ: -1.182 },
        abRiserEnd: { glbX: 0.439, glbY: 0.499, glbZ: -0.012 },
        cdRiserEnd: { glbX: 0.424, glbY: 0.464, glbZ: -0.197 },
      },
      {
        ribIndex: 6,
        aCanopy:    { glbX: 2.085, glbY: 3.769, glbZ:  0.301 },
        bCanopy:    { glbX: 2.101, glbY: 3.799, glbZ: -0.474 },
        cCanopy:    { glbX: 2.118, glbY: 3.834, glbZ: -1.276 },
        dCanopy:    { glbX: 2.136, glbY: 3.866, glbZ: -1.944 },
        abCascade:  { glbX: 1.593, glbY: 2.799, glbZ: -0.064 },
        cdCascade:  { glbX: 1.615, glbY: 2.836, glbZ: -1.184 },
        abRiserEnd: { glbX: 0.439, glbY: 0.498, glbZ: -0.011 },
        cdRiserEnd: { glbX: 0.425, glbY: 0.464, glbZ: -0.195 },
      },
      {
        ribIndex: 8,
        aCanopy:    { glbX: 2.788, glbY: 3.293, glbZ:  0.303 },
        bCanopy:    { glbX: 2.811, glbY: 3.319, glbZ: -0.475 },
        cCanopy:    { glbX: 2.835, glbY: 3.348, glbZ: -1.276 },
        dCanopy:    { glbX: 2.860, glbY: 3.376, glbZ: -1.945 },
        abCascade:  { glbX: 2.088, glbY: 2.465, glbZ: -0.063 },
        cdCascade:  { glbX: 2.119, glbY: 2.494, glbZ: -1.184 },
        abRiserEnd: { glbX: 0.438, glbY: 0.497, glbZ: -0.011 },
        cdRiserEnd: { glbX: 0.425, glbY: 0.463, glbZ: -0.195 },
      },
    ],
    frontRiser: {
      top:    { glbX: 0.429, glbY: 0.502, glbZ: -0.011 },
      bottom: { glbX: 0.255, glbY: -0.002, glbZ: -0.000 },
    },
    rearRiser: {
      top:    { glbX: 0.419, glbY: 0.469, glbZ: -0.190 },
      bottom: { glbX: 0.253, glbY: -0.002, glbZ: -0.003 },
    },
  },
}

/**
 * airplane.glb — Dornier Do 228-200 (visual placeholder)
 *
 * Used only for exit visualization; no physics coupling.
 */
export const AIRPLANE_GEOMETRY: ModelGeometry = {
  id: 'airplane',
  path: '/models/airplane.glb',
  description: 'Dornier Do 228-200 — visual exit aircraft',

  bbox: {
    min: { x: -8.310, y: -1.063, z: -8.023 },
    max: { x:  8.310, y:  3.373, z:  7.556 },
    size: { x: 16.619, y: 4.436, z: 15.579 },
  },
  maxDim: 16.619,
  maxDimAxis: 'x',

  axes: {
    ned_x: { glbAxis: 'z', sign: 1 },
    ned_y: { glbAxis: 'x', sign: 1 },
    ned_z: { glbAxis: 'y', sign: -1 },
  },

  physicalReference: {
    name: 'wingspan',
    meters: 16.97,       // Do 228 wingspan
    glbExtent: 16.619,
  },
  glbToMeters: 16.97 / 16.619,
  glbToNED: (16.97 / 16.619) / REF_HEIGHT,
  referenceHeight: REF_HEIGHT,

  landmarks: [],
  attachments: [],
}

// ─────────────────────────────────────────────────────────────────────
//  Deployment sub-model geometry (visual only)
// ─────────────────────────────────────────────────────────────────────

/** bridalandpc.gltf — bridle line + pilot chute for canopy view */
export const BRIDLE_PC_GEOMETRY: ModelGeometry = {
  id: 'bridalandpc',
  path: '/models/bridalandpc.gltf',
  description: 'Bridle line + pilot chute (canopy deployment visual)',

  bbox: {
    min: { x: -0.240, y: -0.240, z: -3.690 },
    max: { x:  0.240, y:  0.240, z:  0.000 },
    size: { x: 0.480, y: 0.480, z: 3.690 },
  },
  maxDim: 3.690,
  maxDimAxis: 'z',

  axes: {
    ned_x: { glbAxis: 'z', sign: 1 },
    ned_y: { glbAxis: 'x', sign: 1 },
    ned_z: { glbAxis: 'y', sign: -1 },
  },

  physicalReference: { name: 'bridleLength', meters: 3.0, glbExtent: 3.690 },
  glbToMeters: 3.0 / 3.690,
  glbToNED: (3.0 / 3.690) / REF_HEIGHT,
  referenceHeight: REF_HEIGHT,

  landmarks: [],
  attachments: [],
}

/** pc.glb — standalone pilot chute (wingsuit deployment) */
export const PC_GEOMETRY: ModelGeometry = {
  id: 'pc',
  path: '/models/pc.glb',
  description: 'Pilot chute (wingsuit deployment visual)',

  bbox: {
    min: { x: -0.240, y: -0.240, z: -0.410 },
    max: { x:  0.240, y:  0.240, z:  0.000 },
    size: { x: 0.480, y: 0.480, z: 0.410 },
  },
  maxDim: 0.480,
  maxDimAxis: 'x',

  axes: {
    ned_x: { glbAxis: 'z', sign: 1 },
    ned_y: { glbAxis: 'x', sign: 1 },
    ned_z: { glbAxis: 'y', sign: -1 },
  },

  physicalReference: { name: 'diameter', meters: 0.46, glbExtent: 0.480 },
  glbToMeters: 0.46 / 0.480,
  glbToNED: (0.46 / 0.480) / REF_HEIGHT,
  referenceHeight: REF_HEIGHT,

  landmarks: [],
  attachments: [],
}

/** snivel.glb — canopy in bag (wingsuit deployment) */
export const SNIVEL_GEOMETRY: ModelGeometry = {
  id: 'snivel',
  path: '/models/snivel.glb',
  description: 'Canopy in bag (wingsuit deployment visual)',

  bbox: {
    min: { x: -0.800, y: -0.600, z: -0.600 },
    max: { x:  0.800, y:  0.600, z:  0.600 },
    size: { x: 1.600, y: 1.200, z: 1.200 },
  },
  maxDim: 1.600,
  maxDimAxis: 'x',

  axes: {
    ned_x: { glbAxis: 'z', sign: 1 },
    ned_y: { glbAxis: 'x', sign: 1 },
    ned_z: { glbAxis: 'y', sign: -1 },
  },

  physicalReference: { name: 'bagWidth', meters: 0.40, glbExtent: 1.600 },
  glbToMeters: 0.40 / 1.600,
  glbToNED: (0.40 / 1.600) / REF_HEIGHT,
  referenceHeight: REF_HEIGHT,

  landmarks: [],
  attachments: [],
}

// ─────────────────────────────────────────────────────────────────────
//  Assembly offset derivation
// ─────────────────────────────────────────────────────────────────────

/**
 * Derive assembly offsets from measured GLB geometry and current scales.
 *
 * **Design Specification (from user measurement):**
 * - Reference frame: Pilot height (1.875m), not canopy chord
 * - Shoulder location: 0.1 × pilot height measured from pilot's head/top
 *   - In GLB coords: shoulder_left.z ≈ 0.560 m (from wingsuit/slick attachments)
 *   - Physical distance: 0.560 GLB × pilotGeometry.glbToMeters = pilot shoulder position
 *   - Normalized: shoulder_meters / 1.875 = shoulderOffsetFraction
 * - Attachment point: Riser convergence (canopy {0, 0.240, −0.050})
 * - Normalization: Offsets expressed as fractions for scale invariance
 *
 * **Implementation:**
 * 1. childScale = canopyScale × (pilotGeometry.glbToMeters / canopyGeometry.glbToMeters)
 * 2. shoulderOffsetFraction = (shoulder_glbZ × pilotGeometry.glbToMeters) / REF_HEIGHT
 * 3. childOffset.y = −(shoulder_glbZ × childScale) to align shoulder with harness
 *
 * This allows dynamic recalculation whenever scales change, without hardcoding
 * assembly geometry.
 */
export function deriveAssemblyOffsets(
  pilotGeometry: ModelGeometry,
  canopyGeometry: ModelGeometry,
  canopyScale: number,
):
  | {
      childScale: number
      childOffset: Vec3
      shoulderOffsetFraction: number
    }
  | undefined {
  // Only pilot models have shoulder attachments; slick has no shoulder in wingsuit mode
  const shoulderAttachment = pilotGeometry.attachments?.find(
    (a) => a.name === 'shoulder_left',
  )
  if (!shoulderAttachment) {
    return undefined
  }

  const shoulderGlbZ = shoulderAttachment.glb.z

  // Scale pilot to render correctly relative to the post-scaled canopy
  const childScale = canopyScale * (pilotGeometry.glbToMeters / canopyGeometry.glbToMeters)

  // Shoulder offset normalized by pilot height (1.875m)
  // For wingsuit: 0.560 × 0.5282 / 1.875 ≈ 0.158 ✓
  // For slick: 0.560 × 0.5541 / 1.875 ≈ 0.166 ✓
  const shoulderMeters = Math.abs(shoulderGlbZ) * pilotGeometry.glbToMeters
  const shoulderOffsetFraction = shoulderMeters / REF_HEIGHT

  // Position pilot so its shoulder aligns with the canopy harness point (y = 0)
  // Negative because child coords are in pilot's local frame
  const childOffsetY = -shoulderGlbZ * childScale

  return {
    childScale,
    childOffset: { x: 0, y: childOffsetY, z: 0 },
    shoulderOffsetFraction,
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Vehicle assemblies
// ─────────────────────────────────────────────────────────────────────

/**
 * Ibex UL canopy + wingsuit pilot assembly.
 *
 * The canopy is scaled by 3.0× before compositing with the pilot body.
 * See MODEL-GEOMETRY.md § "Assembly: Ibex UL + Wingsuit Pilot".
 *
 * **Offset Derivation:** All values below (childScale, childOffset, shoulderOffsetFraction)
 * are precomputed from deriveAssemblyOffsets() using measured GLB geometry and pilot height
 * reference (1.875m). See deriveAssemblyOffsets() for design specification and formula.
 */
export const CANOPY_WINGSUIT_ASSEMBLY: VehicleAssembly = {
  id: 'ibex-wingsuit',
  description: 'Ibex UL canopy with wingsuit pilot',

  parentId: 'cp2',
  childId: 'tsimwingsuit',

  parentScale: 3,  // CANOPY_SCALE — visual fit (testing decoupling)

  // childScale: parentScale × wingsuit_glbToMeters / canopy_glbToMeters
  //   = 3.0 × (1.875/3.550) / (3.29/3.529) = 1.700
  // Without this the pilot body renders too large relative to the canopy.
  // Precomputed via deriveAssemblyOffsets(WINGSUIT_GEOMETRY, CANOPY_GEOMETRY, 3.0)
  childScale: 1.7,

  // Pilot position in parent GLB coords.
  // Derived: -(shoulder_glbZ × childScale) = -(0.560 × 1.700) = -0.952
  // Places the shoulder (riser attachment) at canopy Y = 0 (harness point).
  // Precomputed via deriveAssemblyOffsets(WINGSUIT_GEOMETRY, CANOPY_GEOMETRY, 3.0)
  childOffset: { x: 0, y: -0.952, z: 0 },
  // −90° X rotation: prone → hanging
  childRotationDeg: { x: -90, y: 0, z: 0 },

  // shoulder_left glbZ (0.560) / maxDim (3.550) = 0.158
  // Shoulder position normalized by pilot height (1.875m)
  // Precomputed via deriveAssemblyOffsets(WINGSUIT_GEOMETRY, CANOPY_GEOMETRY, 3.0)
  shoulderOffsetFraction: 0.158,
  trailingEdgeShift: -0.30,       // bridle attachment shift toward canopy TE

  deployScales: {
    pc: 0.8,       // PC model × normalization scale (0.4 × 2.0 for parentScale 3.0)
    snivel: 1.2,   // snivel model × normalization scale (0.6 × 2.0 for parentScale 3.0)
    bridle: 3.0,   // bridle model × normalization scale (1.5 × 2.0 for parentScale 3.0)
  },

  // Physics
  trimAngleDeg: 6,
  pilotFwdShift: 0,          // positions are absolute NED relative to riser
  pilotDownShift: 0,         // positions are absolute NED relative to riser
}

/**
 * Ibex UL canopy + slick skydiver assembly.
 *
 * Same assembly rules as wingsuit, different pilot sub-model.
 *
 * **Offset Derivation:** All values below (childScale, childOffset, shoulderOffsetFraction)
 * are precomputed from deriveAssemblyOffsets() using measured GLB geometry and pilot height
 * reference (1.875m). See deriveAssemblyOffsets() for design specification and formula.
 */
export const CANOPY_SLICK_ASSEMBLY: VehicleAssembly = {
  id: 'ibex-slick',
  description: 'Ibex UL canopy with slick skydiver',

  parentId: 'cp2',
  childId: 'tslick',

  parentScale: 3.0,

  // childScale: parentScale × slick_glbToMeters / canopy_glbToMeters
  //   = 3.0 × (1.875/3.384) / (3.29/3.529) = 1.784
  // Precomputed via deriveAssemblyOffsets(SLICK_GEOMETRY, CANOPY_GEOMETRY, 3.0)
  childScale: 1.784,

  // -(shoulder_glbZ × childScale) = -(0.560 × 1.784) = -0.999
  // Precomputed via deriveAssemblyOffsets(SLICK_GEOMETRY, CANOPY_GEOMETRY, 3.0)
  childOffset: { x: 0, y: -0.999, z: 0 },
  childRotationDeg: { x: -90, y: 0, z: 0 },

  // shoulder_glbZ (0.560) / maxDim (3.384) = 0.166
  // Shoulder position normalized by pilot height (1.875m)
  // Precomputed via deriveAssemblyOffsets(SLICK_GEOMETRY, CANOPY_GEOMETRY, 3.0)
  shoulderOffsetFraction: 0.166,
  trailingEdgeShift: -0.30,

  deployScales: undefined,  // slick has no deployment sequence

  trimAngleDeg: 6,
  pilotFwdShift: 0,
  pilotDownShift: 0,
}

// ─────────────────────────────────────────────────────────────────────
//  Lookup tables
// ─────────────────────────────────────────────────────────────────────

/** All model geometries indexed by id. */
export const MODEL_REGISTRY: Readonly<Record<string, ModelGeometry>> = {
  tsimwingsuit: WINGSUIT_GEOMETRY,
  tslick: SLICK_GEOMETRY,
  cp2: CANOPY_GEOMETRY,
  airplane: AIRPLANE_GEOMETRY,
  bridalandpc: BRIDLE_PC_GEOMETRY,
  pc: PC_GEOMETRY,
  snivel: SNIVEL_GEOMETRY,
}

/** All vehicle assemblies indexed by id. */
export const ASSEMBLY_REGISTRY: Readonly<Record<string, VehicleAssembly>> = {
  'ibex-wingsuit': CANOPY_WINGSUIT_ASSEMBLY,
  'ibex-slick': CANOPY_SLICK_ASSEMBLY,
}

// ─────────────────────────────────────────────────────────────────────
//  Rendering constants (derived from assembly + model data)
// ─────────────────────────────────────────────────────────────────────

/**
 * Target size for normalization in Three.js scene units.
 * All models with a pilot body are scaled so the pilot's max raw dimension
 * maps to this value. Kept separate from geometry data since it's a
 * rendering concern, not a physical measurement.
 */
export const TARGET_SIZE = 2.0
