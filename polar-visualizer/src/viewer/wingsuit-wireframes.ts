/**
 * Wingsuit wireframe visualization — renders each aero segment as
 * one or more geometric bounding boxes in the 3D viewport.
 *
 * Unlike the aero model (which treats each segment as a single lifting
 * surface), the wireframe **geometry** uses per-segment box specs tuned
 * by eye to reflect the actual wingsuit shape.  The "center" aero
 * segment is drawn as two boxes (torso + leg wing), and each box stores
 * its offset from the segment reference position plus absolute extents
 * in NED metres.
 *
 * This keeps aero simple (one segment = one lifting surface) while
 * letting the visualization match reality.
 *
 * Offsets + sizes are authored in NED metres:
 *   x = fore / aft  (+x = forward / toward head)
 *   y = lateral     (+y = pilot's right)
 *   z = vertical    (+z = down, toward belly)
 *
 * They are converted to Three.js via nedToThreeJS() and scaled by
 * pilotScale (scene units per metre) at update time.
 */

import * as THREE from 'three'
import type { AeroSegment } from '../polar/continuous-polar.ts'
import { nedToThreeJS } from './frames.ts'

interface BoxSpec {
  kind?: 'box'
  color: number
  /** Offset of the box center FROM the segment's reference position, in NED metres. */
  offset: { x: number; y: number; z: number }
  /** Box extents in NED metres (x=chord, y=span, z=thickness). */
  size: { x: number; y: number; z: number }
}

/**
 * Triangular prism, tapering along the NED-x (chord) axis.
 * Used for the wingsuit leg wing: wider at the hips (forward, +x end),
 * narrower at the feet (aft, −x end).  Symmetric about y=0.
 */
interface TrianglePrismSpec {
  kind: 'triangle-xy'
  color: number
  /** Forward (wide) end x-position, NED metres, relative to segment reference. */
  xForward: number
  /** Aft (narrow) end x-position, NED metres, relative to segment reference. */
  xAft: number
  /** Full lateral width (y extent) at the forward end [m]. */
  widthAtForward: number
  /** Full lateral width (y extent) at the aft end [m]. */
  widthAtAft: number
  /** Vertical thickness (z extent) [m]. */
  thickness: number
  /** Vertical center offset, NED metres, relative to segment reference (default 0). */
  zCenter?: number
}

/**
 * Swept-wing trapezoidal prism in the x-y plane.
 * Used for the wingsuit inner wings: leading edge sweeps back as the
 * wing extends outboard, trailing edge sweeps differently.
 *
 * All x / y positions are NED metres, relative to the segment reference.
 * The prism has 8 corners (4 top + 4 bottom):
 *   inboard-LE, outboard-LE, outboard-TE, inboard-TE
 */
interface SweptWingSpec {
  kind: 'swept-wing-xy'
  color: number
  /** Inboard spanwise position (small |y|) [m]. */
  yInboard: number
  /** Outboard spanwise position (large |y|) [m]. */
  yOutboard: number
  /** Leading-edge x at the inboard station [m]. */
  xLeInboard: number
  /** Leading-edge x at the outboard station [m] (typically aft of xLeInboard → swept back). */
  xLeOutboard: number
  /** Trailing-edge x at the inboard station [m]. */
  xTeInboard: number
  /** Trailing-edge x at the outboard station [m]. */
  xTeOutboard: number
  /** Optional y-override at inboard TE (defaults to yInboard).  Use to
   *  let the inboard edge fan out or pinch inward toward the TE. */
  yTeInboard?: number
  /** Optional y-override at outboard TE (defaults to yOutboard).  Use
   *  to let the outboard edge taper toward the TE (e.g. to a point at
   *  the foot).  If both yTeInboard and yTeOutboard coincide the
   *  prism degenerates into a triangular (pointed) trailing edge. */
  yTeOutboard?: number
  /** Vertical thickness (z extent) [m]. */
  thickness: number
  /** Vertical center offset [m] (default 0). */
  zCenter?: number
}

type WireframeSpec = BoxSpec | TrianglePrismSpec | SweptWingSpec

/**
 * A5 wingsuit box geometry, keyed by aero-segment name.
 * Each entry may hold multiple boxes (e.g. center = torso + leg wing).
 *
 * Dimensions are first-pass values tuned against the viewer image — the
 * user will iterate from here.
 */
const A5_WIREFRAME_BOXES: Record<string, WireframeSpec[]> = {
  // Head — bluff body (helmeted head).  Segment position is at the neck
  // attachment; shift the box forward by ~chord/2 so the box straddles
  // the actual head rather than the neck joint.
  head: [{
    color: 0xffcc44,
    offset: { x: +0.08, y: 0, z: 0 },
    size:   { x: 0.18, y: 0.18, z: 0.20 },
  }],

  // Center — "fuselage + tail wing" aero segment, rendered as TWO pieces:
  //   (a) torso:    shoulders → waist, narrower
  //   (b) leg wing: hips → past feet, triangular tail that FLARES outward
  center: [
    {
      // Torso — +X face extends up toward the neck (halfway between the
      // previous over-shrunk and full-length versions); −X face stays at
      // the waist line (~−0.05 in segment frame) to meet the leg wing.
      color: 0xffffff,
      offset: { x: +0.225, y: 0, z: 0 },
      size:   { x: 0.55, y: 0.50, z: 0.25 },
    },
    {
      // Leg wing — triangular tail that FLARES outward toward the feet
      // (wingsuit TE tapers outboard, not inboard).  Starts at hip width
      // to match the torso, widens past the feet to capture the whole
      // tail panel.
      kind: 'triangle-xy',
      color: 0xffffff,
      xForward: -0.05,          // hip line (meets torso −X face)
      xAft:     -1.15,           // past the feet
      widthAtForward: 0.55,       // hips — matches torso width
      widthAtAft:     0.85,       // flared tail, wider than hips
      thickness: 0.12,
    },
  ],

  // Inner wings — shoulder→elbow + hip→knee fabric panels.
  // Modeled as a swept trapezoidal prism with a slanted leading edge
  // matching the wingsuit's LE sweep.  Inboard face sits at ±0.25 m to
  // butt against the torso's ±Y face.  Outboard face at ±0.55 m — pulled
  // in from the previous ±0.63 to leave room for the pink outer-wing
  // (gripper/hand) boxes.
  //
  // r1 segment position (NED) = (−0.038, +0.399, 0), so the absolute
  // span runs from y=+0.25 to y=+0.55 (offsets −0.149 → +0.151).
  //
  // Inner wings — shoulder → foot.  LE is a swept shoulder line
  // (+27° sweep, matches the GLB mesh leading edge).  TE converges
  // to a point at the foot mass location so the rear of the inner
  // wing tapers like the real wingsuit: the inboard face flares
  // outward from the shoulder toward the foot (matching the leg-
  // wing outboard face), and the outboard face pinches inward from
  // the gripper root toward the foot.
  //
  //   Foot absolute: (x ≈ −0.994, |y| ≈ +0.377)
  //   r1 seg pos absolute: (x ≈ −0.072, y ≈ +0.399)
  //   Foot relative to r1: (x ≈ −0.922, y ≈ −0.022)
  r1: [{
    kind: 'swept-wing-xy',
    color: 0x44ccff,
    yInboard:  -0.149,   // absolute +0.25 (shoulder root)
    yOutboard: +0.151,   // absolute +0.55 (gripper root)
    xLeInboard:  +0.538, // absolute +0.50 (shoulder line)
    xLeOutboard: +0.388, // absolute +0.35 (swept back ~27°)
    xTeInboard:  -0.922, // absolute −0.994 (foot x)
    xTeOutboard: -0.922, // absolute −0.994 (same — point at foot)
    yTeInboard:  -0.022, // absolute +0.377 (foot y)
    yTeOutboard: -0.022, // absolute +0.377 (same — triangular TE)
    thickness: 0.10,
  }],
  l1: [{
    kind: 'swept-wing-xy',
    color: 0x44ccff,
    // mirrored on y
    yInboard:  +0.149,   // absolute −0.25
    yOutboard: -0.151,   // absolute −0.55
    xLeInboard:  +0.538,
    xLeOutboard: +0.388,
    xTeInboard:  -0.922,
    xTeOutboard: -0.922,
    yTeInboard:  +0.022, // absolute −0.377 (foot, mirrored)
    yTeOutboard: +0.022,
    thickness: 0.10,
  }],

  // Outer wings — gripper / hand panels.  Inboard edge matches r1/l1
  // outboard y = ±0.55 m (flush with the inner wing tip), extending
  // outboard to ≈ ±0.70 m (fits on top of the red gripper area).
  // LE split between previous two attempts (+0.35 was too forward,
  // +0.20 too aft).  TE nearly flat — a straight line at ≈ −0.03
  // sits along the bottom of the gripper just aft of the hand.
  r2: [{
    kind: 'swept-wing-xy',
    color: 0xff44cc,
    yInboard:  -0.061,   // absolute +0.55 (flush with r1 tip)
    yOutboard: +0.089,   // absolute +0.70 (narrower — red area only)
    xLeInboard:  +0.226, // absolute +0.28
    xLeOutboard: +0.126, // absolute +0.18 (swept back ~0.10 m)
    xTeInboard:  -0.084, // absolute −0.03
    xTeOutboard: -0.084, // absolute −0.03 (flat — no TE taper)
    thickness: 0.08,
  }],
  l2: [{
    kind: 'swept-wing-xy',
    color: 0xff44cc,
    // mirrored on y
    yInboard:  +0.061,   // absolute −0.55
    yOutboard: -0.089,   // absolute −0.70
    xLeInboard:  +0.226,
    xLeOutboard: +0.126,
    xTeInboard:  -0.084,
    xTeOutboard: -0.084,
    thickness: 0.08,
  }],
}

const DEFAULT_COLOR = 0xffffff

/** Fallback box for segments without an explicit spec: use polar S/chord. */
function fallbackBox(seg: AeroSegment): BoxSpec {
  const chord = Math.max(seg.chord, 0.08)
  const span = seg.chord > 1e-4 ? Math.sqrt(seg.S / seg.chord) * seg.chord : chord
  return {
    color: DEFAULT_COLOR,
    offset: { x: 0, y: 0, z: 0 },
    size: { x: chord, y: Math.max(span, 0.08), z: 0.08 },
  }
}

export interface WingsuitWireframes {
  group: THREE.Group
  setVisible(visible: boolean): void
  /**
   * Build/rebuild wireframe boxes from the current polar's aeroSegments.
   * Call on polar load or when pilotScale/massReference_m change — not
   * every frame.
   */
  update(segments: AeroSegment[], pilotScale: number, massReference_m: number): void
  dispose(): void
}

export function createWingsuitWireframes(): WingsuitWireframes {
  const group = new THREE.Group()
  group.name = 'wingsuit-wireframes'
  group.visible = false

  const materials: THREE.Material[] = []
  const geometries: THREE.BufferGeometry[] = []

  function clear(): void {
    while (group.children.length > 0) group.remove(group.children[0])
    for (const g of geometries) g.dispose()
    for (const m of materials) m.dispose()
    geometries.length = 0
    materials.length = 0
  }

  function addBox(
    seg: AeroSegment,
    spec: BoxSpec,
    index: number,
    pilotScale: number,
    massReference_m: number,
  ): void {
    // nedToThreeJS: (x, y, z)_NED → (-y, -z, x)_Three
    // So box extents map: Three width = |y|, height = |z|, depth = |x|
    const boxGeo = new THREE.BoxGeometry(spec.size.y, spec.size.z, spec.size.x)
    const wireGeo = new THREE.WireframeGeometry(boxGeo)
    boxGeo.dispose()
    geometries.push(wireGeo)

    const mat = new THREE.LineBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: 0.75,
      depthTest: true,
    })
    materials.push(mat)

    const lines = new THREE.LineSegments(wireGeo, mat)
    lines.name = `wingsuit-wf-${seg.name}-${index}`

    // Geometry is authored in NED metres → scale to scene units via pilotScale.
    lines.scale.setScalar(pilotScale)

    // Box center in NED metres = seg.position (normalized) × massReference_m + offset.
    const centerNED_m = {
      x: seg.position.x * massReference_m + spec.offset.x,
      y: seg.position.y * massReference_m + spec.offset.y,
      z: seg.position.z * massReference_m + spec.offset.z,
    }
    const posThree = nedToThreeJS(centerNED_m).multiplyScalar(pilotScale)
    lines.position.copy(posThree)

    group.add(lines)
  }

  /**
   * Render a triangular prism (tapered leg wing) as line segments.
   * Builds 6 vertices in NED metres (3 top + 3 bottom) and connects:
   *   top triangle (3 edges) + bottom triangle (3 edges) + 3 verticals.
   *
   * Vertex layout (NED metres, before translation by segment position):
   *     0  forward-left-top      (xForward,  +wF/2, −thk/2 + zC)
   *     1  forward-right-top     (xForward,  −wF/2, −thk/2 + zC)
   *     2  aft-center-top        (xAft,      0,     −thk/2 + zC)
   *     3  forward-left-bottom   (xForward,  +wF/2, +thk/2 + zC)
   *     4  forward-right-bottom  (xForward,  −wF/2, +thk/2 + zC)
   *     5  aft-center-bottom     (xAft,      0,     +thk/2 + zC)
   *
   * For a more faithful trapezoid at the aft end, use `widthAtAft > 0`;
   * that splits vertex 2/5 into two per end.
   */
  function addTrianglePrism(
    seg: AeroSegment,
    spec: TrianglePrismSpec,
    index: number,
    pilotScale: number,
    massReference_m: number,
  ): void {
    const { xForward, xAft, widthAtForward, widthAtAft, thickness, zCenter = 0 } = spec
    const wF = widthAtForward / 2
    const wA = widthAtAft / 2
    const zT = zCenter - thickness / 2
    const zB = zCenter + thickness / 2

    // 8 vertices (trapezoidal prism — collapses to triangular if widthAtAft=0):
    // top:    0: fwd-left   1: fwd-right   2: aft-right   3: aft-left
    // bottom: 4: fwd-left   5: fwd-right   6: aft-right   7: aft-left
    // In NED metres, converted to Three.js:  (x,y,z) → (-y, -z, x)
    const v = (x: number, y: number, z: number) => {
      const t = nedToThreeJS({ x, y, z })
      return [t.x, t.y, t.z]
    }
    const vertsArr = new Float32Array([
      ...v(xForward, +wF, zT),  // 0 fwd-L top
      ...v(xForward, -wF, zT),  // 1 fwd-R top
      ...v(xAft,     -wA, zT),  // 2 aft-R top
      ...v(xAft,     +wA, zT),  // 3 aft-L top
      ...v(xForward, +wF, zB),  // 4 fwd-L bot
      ...v(xForward, -wF, zB),  // 5 fwd-R bot
      ...v(xAft,     -wA, zB),  // 6 aft-R bot
      ...v(xAft,     +wA, zB),  // 7 aft-L bot
    ])
    // Edges: top quad (0-1-2-3-0), bottom quad (4-5-6-7-4), 4 verticals (0-4, 1-5, 2-6, 3-7)
    const indices = new Uint16Array([
      0,1,  1,2,  2,3,  3,0,
      4,5,  5,6,  6,7,  7,4,
      0,4,  1,5,  2,6,  3,7,
    ])
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(vertsArr, 3))
    geo.setIndex(new THREE.BufferAttribute(indices, 1))
    geometries.push(geo)

    const mat = new THREE.LineBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: 0.75,
      depthTest: true,
    })
    materials.push(mat)

    const lines = new THREE.LineSegments(geo, mat)
    lines.name = `wingsuit-wf-${seg.name}-tri-${index}`
    lines.scale.setScalar(pilotScale)

    // Translate by the segment's reference position (× massReference_m)
    const posNED_m = {
      x: seg.position.x * massReference_m,
      y: seg.position.y * massReference_m,
      z: seg.position.z * massReference_m,
    }
    const posThree = nedToThreeJS(posNED_m).multiplyScalar(pilotScale)
    lines.position.copy(posThree)

    group.add(lines)
  }

  /**
   * Render a swept-wing trapezoidal prism (inner wing panel).
   * 8 corners: 4 top (z = −thk/2) + 4 bottom (z = +thk/2), arranged as
   * inboard-LE, outboard-LE, outboard-TE, inboard-TE (top), then same
   * for bottom.  All x/y are relative to the segment reference position.
   */
  function addSweptWing(
    seg: AeroSegment,
    spec: SweptWingSpec,
    index: number,
    pilotScale: number,
    massReference_m: number,
  ): void {
    const {
      yInboard, yOutboard,
      xLeInboard, xLeOutboard,
      xTeInboard, xTeOutboard,
      thickness, zCenter = 0,
    } = spec
    const yTeIn  = spec.yTeInboard  ?? yInboard
    const yTeOut = spec.yTeOutboard ?? yOutboard
    const zT = zCenter - thickness / 2
    const zB = zCenter + thickness / 2

    // NED → Three:  (x, y, z) → (-y, -z, x)
    const v = (x: number, y: number, z: number) => {
      const t = nedToThreeJS({ x, y, z })
      return [t.x, t.y, t.z]
    }
    const verts = new Float32Array([
      // Top face (z = zT)
      ...v(xLeInboard,  yInboard,  zT),   // 0 inboard-LE top
      ...v(xLeOutboard, yOutboard, zT),   // 1 outboard-LE top
      ...v(xTeOutboard, yTeOut,    zT),   // 2 outboard-TE top
      ...v(xTeInboard,  yTeIn,     zT),   // 3 inboard-TE top
      // Bottom face (z = zB)
      ...v(xLeInboard,  yInboard,  zB),   // 4 inboard-LE bot
      ...v(xLeOutboard, yOutboard, zB),   // 5 outboard-LE bot
      ...v(xTeOutboard, yTeOut,    zB),   // 6 outboard-TE bot
      ...v(xTeInboard,  yTeIn,     zB),   // 7 inboard-TE bot
    ])
    const indices = new Uint16Array([
      // Top quad
      0,1,  1,2,  2,3,  3,0,
      // Bottom quad
      4,5,  5,6,  6,7,  7,4,
      // 4 verticals
      0,4,  1,5,  2,6,  3,7,
    ])
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    geo.setIndex(new THREE.BufferAttribute(indices, 1))
    geometries.push(geo)

    const mat = new THREE.LineBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: 0.75,
      depthTest: true,
    })
    materials.push(mat)

    const lines = new THREE.LineSegments(geo, mat)
    lines.name = `wingsuit-wf-${seg.name}-swept-${index}`
    lines.scale.setScalar(pilotScale)

    const posNED_m = {
      x: seg.position.x * massReference_m,
      y: seg.position.y * massReference_m,
      z: seg.position.z * massReference_m,
    }
    const posThree = nedToThreeJS(posNED_m).multiplyScalar(pilotScale)
    lines.position.copy(posThree)

    group.add(lines)
  }

  function update(segments: AeroSegment[], pilotScale: number, massReference_m: number): void {
    clear()
    for (const seg of segments) {
      const specs = A5_WIREFRAME_BOXES[seg.name] ?? [fallbackBox(seg)]
      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i]
        if (spec.kind === 'triangle-xy') {
          addTrianglePrism(seg, spec, i, pilotScale, massReference_m)
        } else if (spec.kind === 'swept-wing-xy') {
          addSweptWing(seg, spec, i, pilotScale, massReference_m)
        } else {
          addBox(seg, spec, i, pilotScale, massReference_m)
        }
      }
    }
  }

  return {
    group,
    setVisible(visible: boolean) {
      group.visible = visible
    },
    update,
    dispose() {
      clear()
    },
  }
}
