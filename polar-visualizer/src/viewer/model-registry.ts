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
  /** Cell index (1 = center, 2 = first pair, ..., 7 = tip) */
  readonly index: number
  /** Cell center X (GLB) — spanwise position (half-span, right side) */
  readonly glbX: number
  /** Airfoil Y (GLB) — vertical, average of top and bottom skin Y */
  readonly glbY: number
  /** Quarter-chord Z (GLB) — chordwise: LE − 0.25 × chord_GLB */
  readonly glbQcZ: number
  /** Trailing edge Z (GLB) */
  readonly glbTeZ: number
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
  /** Cell geometry for canopy models (7 cells for Ibex UL) */
  readonly cells?: readonly CanopyCellGLB[]
  /** Chord extent in GLB units (LE to TE, from top skin) */
  readonly glbChord?: number
  /** Leading edge Z position in GLB */
  readonly glbLeZ?: number
  /** Trailing edge Z position in GLB */
  readonly glbTeZ?: number
  /** Line attachment row Z positions in GLB [chordwise] */
  readonly lineRows?: {
    readonly A: number  // front
    readonly B: number  // near quarter-chord
    readonly C: number  // mid-chord
    readonly D: number  // rear
  }

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

  /** Child position in raw parent GLB coordinates (after parent scaling) */
  readonly childOffset: Vec3
  /** Child rotation [degrees] — applied as Euler XYZ */
  readonly childRotationDeg: Vec3

  /**
   * Shoulder offset as fraction of child's raw body extent.
   * The pivot point sits this far above the child's CG.
   * Used to separate the pilot pitch pivot from the CG.
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
  /** Pilot forward shift from riser [NED normalized] */
  readonly pilotFwdShift: number
  /** Pilot downward shift from riser [NED normalized] */
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
  glbToNED: (3.29 / 3.529) / REF_HEIGHT,           // 0.4972
  referenceHeight: REF_HEIGHT,

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
  glbChord: 3.529,   // LE top (+0.655) to TE (−2.874)
  glbLeZ: 0.655,     // leading edge Z
  glbTeZ: -2.874,    // trailing edge Z

  // ── line row Z positions (chordwise) ──
  lineRows: {
    A:  0.120,    // 15% chord — LE support
    B: -0.270,    // 26% chord — near quarter-chord
    C: -1.231,    // 53% chord — mid-chord
    D: -1.567,    // 63% chord — rear (not at TE)
  },

  // ── 7 cells: QC and TE positions in GLB units ──
  // QC Z = LE (+0.655) − 0.25 × 3.529 = −0.227
  // Center cell uses X=0 (symmetry plane); X is the right-side half-cell center
  cells: [
    { index: 1, glbX: 0.230, glbY: 4.377, glbQcZ: -0.227, glbTeZ: -2.874 },
    { index: 2, glbX: 0.694, glbY: 4.362, glbQcZ: -0.227, glbTeZ: -2.874 },
    { index: 3, glbX: 1.170, glbY: 4.315, glbQcZ: -0.227, glbTeZ: -2.874 },
    { index: 4, glbX: 1.647, glbY: 4.215, glbQcZ: -0.227, glbTeZ: -2.874 },
    { index: 5, glbX: 2.106, glbY: 4.057, glbQcZ: -0.227, glbTeZ: -2.874 },
    { index: 6, glbX: 2.539, glbY: 3.852, glbQcZ: -0.227, glbTeZ: -2.874 },
    { index: 7, glbX: 2.941, glbY: 3.600, glbQcZ: -0.227, glbTeZ: -2.874 },
  ],
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
//  Vehicle assemblies
// ─────────────────────────────────────────────────────────────────────

/**
 * Ibex UL canopy + wingsuit pilot assembly.
 *
 * The canopy is scaled by 1.5× before compositing with the pilot body.
 * See MODEL-GEOMETRY.md § "Assembly: Ibex UL + Wingsuit Pilot".
 */
export const CANOPY_WINGSUIT_ASSEMBLY: VehicleAssembly = {
  id: 'ibex-wingsuit',
  description: 'Ibex UL canopy with wingsuit pilot',

  parentId: 'cp2',
  childId: 'tsimwingsuit',

  parentScale: 1.5,  // CANOPY_SCALE — visual fit

  // Pilot position in parent GLB coords (after parent scaling)
  // From PILOT_OFFSET in model-loader.ts: position (0, −0.540, 0)
  childOffset: { x: 0, y: -0.540, z: 0 },
  // −90° X rotation: prone → hanging
  childRotationDeg: { x: -90, y: 0, z: 0 },

  shoulderOffsetFraction: 0.10,   // 10% of body extent
  trailingEdgeShift: -0.30,       // bridle attachment shift toward canopy TE

  deployScales: {
    pc: 0.4,       // PC model × normalization scale
    snivel: 0.6,   // snivel model × normalization scale
    bridle: 1.5,   // bridle model × normalization scale
  },

  // Physics
  trimAngleDeg: 6,
  pilotFwdShift: 0.28,       // NED normalized
  pilotDownShift: 0.163,     // NED normalized
}

/**
 * Ibex UL canopy + slick skydiver assembly.
 *
 * Same assembly rules as wingsuit, different pilot sub-model.
 */
export const CANOPY_SLICK_ASSEMBLY: VehicleAssembly = {
  id: 'ibex-slick',
  description: 'Ibex UL canopy with slick skydiver',

  parentId: 'cp2',
  childId: 'tslick',

  parentScale: 1.5,

  childOffset: { x: 0, y: -0.540, z: 0 },
  childRotationDeg: { x: -90, y: 0, z: 0 },

  shoulderOffsetFraction: 0.10,
  trailingEdgeShift: -0.30,

  deployScales: undefined,  // slick has no deployment sequence

  trimAngleDeg: 6,
  pilotFwdShift: 0.28,
  pilotDownShift: 0.163,
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
