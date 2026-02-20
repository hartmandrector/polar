/**
 * Cell wireframe visualization — renders canopy cell bounding boxes
 * as wireframe rectangles in the 3D viewport.
 *
 * Each cell is drawn as a 12-edge wireframe box whose corners follow
 * the canopy arc (inner/outer Y differ per the rib Y extents).
 *
 * Wireframes are defined in GLB coordinates and added as children of the
 * canopy mesh group (`mainModel`), so they automatically pick up the
 * canopy scale (including X-flip) and move with the mesh.
 *
 * Color scheme:
 *   - Center cell:  cyan
 *   - Inner pair:   green
 *   - Mid pair:     yellow
 *   - Outer pair:   orange
 */

import * as THREE from 'three'
import type { CellBoundsGLB, ModelGeometry } from './model-registry.ts'
import { getCellBoundsGLB } from './model-registry.ts'

// ── Color palette per cell index ──
const CELL_COLORS: Record<number, number> = {
  1: 0x00ffff,   // cyan   — center
  2: 0x44ff44,   // green  — inner pair
  3: 0xffff00,   // yellow — mid pair
  4: 0xff8800,   // orange — outer pair
}
const DEFAULT_COLOR = 0xff00ff  // magenta fallback

export interface CellWireframes {
  /** Group containing all wireframe line segments (parent to canopy model) */
  group: THREE.Group
  /** Toggle visibility */
  setVisible(visible: boolean): void
  /** Dispose of all GPU resources */
  dispose(): void
}

/**
 * Create wireframe boxes for each canopy cell in GLB coordinates.
 *
 * Each box has 8 corners:
 *   4 at LE (zLE):  inner-bottom, inner-top, outer-bottom, outer-top
 *   4 at TE (zTE):  inner-bottom, inner-top, outer-bottom, outer-top
 *
 * Connected by 12 edges:
 *   4 chordwise (LE↔TE at each corner)
 *   4 spanwise at LE (inner↔outer, top & bottom)
 *   4 spanwise at TE (inner↔outer, top & bottom)
 *   (The top/bottom edges at each end are included in the spanwise count)
 *
 * Correction: 12 edges of a rectangular prism:
 *   4 along Z (chord): connecting LE to TE at each of 4 span×height corners
 *   4 along X (span): 2 at LE (top & bottom) + 2 at TE (top & bottom)
 *   4 along Y (height): 2 at LE (inner & outer) + 2 at TE (inner & outer)
 */
export function createCellWireframes(canopyGeometry: ModelGeometry): CellWireframes {
  const group = new THREE.Group()
  group.name = 'cell-wireframes'
  group.visible = false

  const materials: THREE.Material[] = []
  const geometries: THREE.BufferGeometry[] = []

  const bounds = getCellBoundsGLB(canopyGeometry)

  for (const cell of bounds) {
    const color = CELL_COLORS[cell.cellIndex] ?? DEFAULT_COLOR
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      depthTest: true,
    })
    materials.push(mat)

    const geo = buildCellBoxGeometry(cell)
    geometries.push(geo)

    const lines = new THREE.LineSegments(geo, mat)
    lines.name = `cell-${cell.cellIndex}-${cell.side}`
    group.add(lines)

    // LE nose triangles — extend the bottom-LE attachment point forward
    // to the top skin Z, showing where the aerodynamic chord starts.
    // One triangle per cell boundary (inner + outer load-bearing rib).
    const triGeo = buildLeTriangleGeometry(cell)
    geometries.push(triGeo)

    const triLines = new THREE.LineSegments(triGeo, mat)
    triLines.name = `cell-${cell.cellIndex}-${cell.side}-le-tri`
    group.add(triLines)

    // Chord LE connecting wire — spanwise line at the airfoil nose center
    // (profile midpoint Y) connecting inner → outer rib at each cell.
    const chordLeGeo = buildChordLeLineGeometry(cell)
    geometries.push(chordLeGeo)

    const chordLeLines = new THREE.LineSegments(chordLeGeo, mat)
    chordLeLines.name = `cell-${cell.cellIndex}-${cell.side}-chord-le`
    group.add(chordLeLines)

    // Chord plane — nearly transparent surface from nose to TE.
    const planeMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    materials.push(planeMat)

    const planeGeo = buildChordPlaneGeometry(cell)
    geometries.push(planeGeo)

    const planeMesh = new THREE.Mesh(planeGeo, planeMat)
    planeMesh.name = `cell-${cell.cellIndex}-${cell.side}-chord-plane`
    group.add(planeMesh)
  }

  return {
    group,
    setVisible(visible: boolean) {
      group.visible = visible
    },
    dispose() {
      for (const m of materials) m.dispose()
      for (const g of geometries) g.dispose()
    },
  }
}

/**
 * Build a BufferGeometry of 12 edge line segments for one cell box.
 *
 * Corner naming: [inner/outer][bottom/top][LE/TE]
 *
 *   Vertex layout (8 corners):
 *     0: inner-bottom-LE    4: outer-bottom-LE
 *     1: inner-top-LE       5: outer-top-LE
 *     2: inner-bottom-TE    6: outer-bottom-TE
 *     3: inner-top-TE       7: outer-top-TE
 *
 *   12 edges (pairs of vertex indices):
 *     Chord (Z): 0-2, 1-3, 4-6, 5-7
 *     Span  (X): 0-4, 1-5, 2-6, 3-7
 *     Height(Y): 0-1, 2-3, 4-5, 6-7
 */
function buildCellBoxGeometry(cell: CellBoundsGLB): THREE.BufferGeometry {
  const {
    xInner, xOuter,
    yMaxInner, yMaxOuter,
    xBottomLEInner, xBottomLEOuter,
    yBottomLEInner, yBottomLEOuter,
    xBottomTEInner, xBottomTEOuter,
    yBottomTEInner, yBottomTEOuter,
    zLE, zBottomLE, zTE,
  } = cell

  // 8 corners in GLB coordinates (x: span, y: height, z: chord)
  // Bottom-LE corners (0, 4): A-line attachment point at the LE.
  // Bottom-TE corners (2, 6): TE cell boundary on the bottom skin.
  // Top corners (1, 3, 5, 7): rib edge positions (full profile).
  const corners = [
    /* 0 */ xBottomLEInner, yBottomLEInner, zBottomLE,
    /* 1 */ xInner, yMaxInner, zLE,
    /* 2 */ xBottomTEInner, yBottomTEInner, zTE,
    /* 3 */ xInner, yMaxInner, zTE,
    /* 4 */ xBottomLEOuter, yBottomLEOuter, zBottomLE,
    /* 5 */ xOuter, yMaxOuter, zLE,
    /* 6 */ xBottomTEOuter, yBottomTEOuter, zTE,
    /* 7 */ xOuter, yMaxOuter, zTE,
  ]

  // 12 edges as pairs of indices
  const indices = [
    // Chord edges (Z direction: LE ↔ TE)
    0, 2,  1, 3,  4, 6,  5, 7,
    // Span edges (X direction: inner ↔ outer)
    0, 4,  1, 5,  2, 6,  3, 7,
    // Height edges (Y direction: bottom ↔ top)
    0, 1,  2, 3,  4, 5,  6, 7,
  ]

  const geometry = new THREE.BufferGeometry()
  // Expand index pairs into position pairs for LineSegments
  const positions = new Float32Array(indices.length * 3)
  for (let i = 0; i < indices.length; i++) {
    const vi = indices[i]
    positions[i * 3 + 0] = corners[vi * 3 + 0]
    positions[i * 3 + 1] = corners[vi * 3 + 1]
    positions[i * 3 + 2] = corners[vi * 3 + 2]
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

/**
 * Build wireframe triangles at the leading edge for one cell.
 *
 * Each cell boundary (inner + outer) gets a triangle that bridges the
 * gap between the bottom-LE attachment point (at zBottomLE) and the
 * aerodynamic chord start (at zLE, top skin).
 *
 * Triangle vertices at each boundary:
 *   A: (xBottomLE, yBottomLE, zBottomLE) — A-line attachment (existing box corner)
 *   B: (xRib, yMax, zLE)                — top skin LE (existing box corner)
 *   C: (xBottomLE, yBottomLE, zLE)       — new: bottom X/Y extended to top Z
 *
 * Edges: A–C, C–B, B–A  (3 edges × 2 boundaries = 6 line segments)
 */
function buildLeTriangleGeometry(cell: CellBoundsGLB): THREE.BufferGeometry {
  const {
    xInner, xOuter,
    yMaxInner, yMaxOuter,
    xBottomLEInner, xBottomLEOuter,
    yBottomLEInner, yBottomLEOuter,
    zLE, zBottomLE,
  } = cell

  // Inner boundary triangle
  const aiX = xBottomLEInner, aiY = yBottomLEInner  // A-line attachment X,Y
  const biX = xInner, biY = yMaxInner                // top skin LE X,Y

  // Outer boundary triangle
  const aoX = xBottomLEOuter, aoY = yBottomLEOuter
  const boX = xOuter, boY = yMaxOuter

  // 6 line segments (each is a pair of endpoints for LineSegments)
  const positions = new Float32Array([
    // Inner triangle: A–C (bottom attachment → extended nose)
    aiX, aiY, zBottomLE,   aiX, aiY, zLE,
    // Inner triangle: C–B (extended nose → top LE)
    aiX, aiY, zLE,         biX, biY, zLE,
    // Inner triangle: B–A (top LE → bottom attachment)
    biX, biY, zLE,         aiX, aiY, zBottomLE,

    // Outer triangle: A–C
    aoX, aoY, zBottomLE,   aoX, aoY, zLE,
    // Outer triangle: C–B
    aoX, aoY, zLE,         boX, boY, zLE,
    // Outer triangle: B–A
    boX, boY, zLE,         aoX, aoY, zBottomLE,
  ])

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

/**
 * Build a single line segment connecting the true nose vertex positions
 * at the inner and outer rib boundaries of a cell.
 *
 * The nose is the most-forward vertex (max Z) on each rib mesh.
 * Its X is inboard of the rib edge, its Y is below the bounding-box
 * midpoint (cambered profile), and its Z (~0.627) is slightly aft
 * of the top-skin LE (0.655).
 *
 * Endpoints:
 *   Inner: (xNoseInner, yChordLEInner, zNose)
 *   Outer: (xNoseOuter, yChordLEOuter, zNose)
 */
function buildChordLeLineGeometry(cell: CellBoundsGLB): THREE.BufferGeometry {
  const { xNoseInner, xNoseOuter, yChordLEInner, yChordLEOuter, zNose } = cell

  const positions = new Float32Array([
    xNoseInner, yChordLEInner, zNose,
    xNoseOuter, yChordLEOuter, zNose,
  ])

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

/**
 * Build a quad (two triangles) representing the chord plane for one cell.
 *
 * The 4 corners are:
 *   0: inner nose  (xNoseInner, yChordLEInner, zNose)   — LE inner
 *   1: outer nose  (xNoseOuter, yChordLEOuter, zNose)   — LE outer
 *   2: outer TE    (xBottomTEOuter, yBottomTEOuter, zTE) — TE outer
 *   3: inner TE    (xBottomTEInner, yBottomTEInner, zTE) — TE inner
 *
 * Two triangles: 0-1-2 and 0-2-3  (CCW winding when viewed from above)
 */
function buildChordPlaneGeometry(cell: CellBoundsGLB): THREE.BufferGeometry {
  const {
    xNoseInner, xNoseOuter,
    yChordLEInner, yChordLEOuter,
    zNose,
    xBottomTEInner, xBottomTEOuter,
    yBottomTEInner, yBottomTEOuter,
    zTE,
  } = cell

  // 4 corners
  const v0 = [xNoseInner, yChordLEInner, zNose]      // LE inner
  const v1 = [xNoseOuter, yChordLEOuter, zNose]      // LE outer
  const v2 = [xBottomTEOuter, yBottomTEOuter, zTE]   // TE outer
  const v3 = [xBottomTEInner, yBottomTEInner, zTE]   // TE inner

  // Two triangles: 0-1-2  and  0-2-3
  const positions = new Float32Array([
    ...v0, ...v1, ...v2,
    ...v0, ...v2, ...v3,
  ])

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}