/**
 * Mass point overlay — renders point-mass model as small spheres
 * in the 3D viewport, with CG highlighted.
 *
 * Positions are in NED body frame, converted to Three.js at render time.
 * Sphere size is proportional to mass fraction for visual clarity.
 * Dynamically adapts to any number of mass segments.
 *
 * CG marker: semi-transparent red sphere with crosshair lines (⊕ convention).
 * CP marker: green octahedron (diamond) — standard CP symbol in XFLR5/Tornado.
 */

import * as THREE from 'three'
import type { MassSegment } from '../polar/continuous-polar.ts'
import { getPhysicalMassPositions, computeCenterOfMass } from '../polar/inertia.ts'
import { nedToThreeJS } from './frames.ts'

export interface MassOverlay {
  group: THREE.Group
  /** Update sphere positions from a polar's mass segments.
   *  @param weightSegments  Optional weight-only segments for CG marker (excludes buoyant air mass).
   *                          When omitted, CG is computed from the display segments.
   */
  update(segments: MassSegment[], height: number, weight: number, pilotScale: number, canopyScaleRatio?: number, weightSegments?: MassSegment[]): void
  /** Update CP diamond marker position from system CP chord fraction or 3D NED position */
  updateCP(cpFraction: number, cgFraction: number, chord: number, height: number, pilotScale: number, massSegments?: MassSegment[], cpNED?: { x: number; y: number; z: number }, canopyScaleRatio?: number): void
  /** Toggle visibility */
  setVisible(visible: boolean): void
}

const MASS_COLOR = 0x44ccff
const CG_COLOR = 0xff4444
const MIN_RADIUS = 0.09
const MAX_RADIUS = 0.24

/**
 * Create the mass overlay group. Spheres are created dynamically
 * based on the number of mass segments provided to update().
 */
export function createMassOverlay(): MassOverlay {
  const group = new THREE.Group()
  group.name = 'mass-overlay'
  group.visible = false

  const massMaterial = new THREE.MeshPhongMaterial({
    color: MASS_COLOR,
    transparent: true,
    opacity: 0.7,
    specular: 0x222222,
    shininess: 40,
  })
  const cgMaterial = new THREE.MeshPhongMaterial({
    color: CG_COLOR,
    transparent: true,
    opacity: 0.45,
    specular: 0x444444,
    shininess: 60,
  })
  const cpMaterial = new THREE.MeshPhongMaterial({
    color: 0x44ff88,
    transparent: true,
    opacity: 0.55,
    specular: 0x224422,
    shininess: 50,
  })
  const linesMaterial = new THREE.LineBasicMaterial({
    color: MASS_COLOR,
    transparent: true,
    opacity: 0.25,
  })
  const crosshairMaterial = new THREE.LineBasicMaterial({
    color: CG_COLOR,
    transparent: true,
    opacity: 0.7,
  })

  const sphereGeo = new THREE.SphereGeometry(1, 12, 8)
  const octaGeo = new THREE.OctahedronGeometry(1, 0)

  // CG marker — semi-transparent sphere with crosshair lines (⊕)
  const cgGroup = new THREE.Group()
  cgGroup.name = 'cg-marker'
  const cgMesh = new THREE.Mesh(sphereGeo, cgMaterial)
  cgGroup.add(cgMesh)

  // Crosshair lines inside the CG sphere (axis-aligned, diameter = 2 unit radii)
  const crossLen = 1.3  // extends slightly beyond sphere surface for visibility
  const xPts = [new THREE.Vector3(-crossLen, 0, 0), new THREE.Vector3(crossLen, 0, 0)]
  const yPts = [new THREE.Vector3(0, -crossLen, 0), new THREE.Vector3(0, crossLen, 0)]
  const zPts = [new THREE.Vector3(0, 0, -crossLen), new THREE.Vector3(0, 0, crossLen)]
  for (const pts of [xPts, yPts, zPts]) {
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const line = new THREE.Line(geo, crosshairMaterial)
    line.name = 'cg-crosshair'
    cgGroup.add(line)
  }
  group.add(cgGroup)

  // CP marker — green diamond (octahedron)
  const cpMesh = new THREE.Mesh(octaGeo, cpMaterial)
  cpMesh.name = 'cp-marker'
  cpMesh.visible = false
  group.add(cpMesh)

  // Dynamic mass point meshes
  let massPoints: THREE.Mesh[] = []

  /** Ensure we have exactly `count` mass-point meshes. */
  function ensureMeshCount(count: number): void {
    // Remove excess
    while (massPoints.length > count) {
      const mesh = massPoints.pop()!
      group.remove(mesh)
      mesh.geometry.dispose()
    }
    // Add missing
    while (massPoints.length < count) {
      const mesh = new THREE.Mesh(sphereGeo, massMaterial)
      mesh.name = `mass-point-${massPoints.length}`
      group.add(mesh)
      massPoints.push(mesh)
    }
  }

  function update(segments: MassSegment[], height: number, weight: number, pilotScale: number, canopyScaleRatio: number = 1.0, weightSegments?: MassSegment[]): void {
    ensureMeshCount(segments.length)
    if (segments.length === 0) return

    // height = massReference (pilotHeight_m for wingsuits, referenceLength for canopies)
    const masses = getPhysicalMassPositions(segments, height, weight)
    // CG marker uses weight-only segments (excludes buoyant air mass that
    // contributes to rotational inertia but not gravitational weight).
    const cgSegs = weightSegments ?? segments
    const cg = computeCenterOfMass(cgSegs, height, weight)

    // pilotScale converts pilot-body meters to model units
    const scale = pilotScale
    const maxMass = Math.max(...masses.map(m => m.mass))

    for (let i = 0; i < masses.length; i++) {
      const mp = masses[i]
      const mesh = massPoints[i]

      // Canopy-attached mass points scale with canopy component scale
      const isCanopy = mp.name.startsWith('canopy_')
      const posScale = isCanopy ? canopyScaleRatio : 1.0

      // NED body → Three.js via nedToThreeJS
      const threePos = nedToThreeJS({ x: mp.x, y: mp.y, z: mp.z })
      mesh.position.set(
        threePos.x * scale * posScale,
        threePos.y * scale * posScale,
        threePos.z * scale * posScale
      )

      const t = mp.mass / maxMass
      const radius = MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS)
      mesh.scale.setScalar(radius)
    }

    // CG marker
    const cgThree = nedToThreeJS({ x: cg.x, y: cg.y, z: cg.z })
    cgGroup.position.set(
      cgThree.x * scale,
      cgThree.y * scale,
      cgThree.z * scale
    )
    cgGroup.scale.setScalar(MAX_RADIUS * 0.65)

    // Remove old lines
    const oldLines = group.children.filter(c => c.name === 'mass-line')
    oldLines.forEach(l => group.remove(l))

    // Draw connecting lines from each mass point to CG
    for (const mesh of massPoints) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        mesh.position.clone(),
        cgGroup.position.clone(),
      ])
      const line = new THREE.Line(geometry, linesMaterial)
      line.name = 'mass-line'
      group.add(line)
    }
  }

  /**
   * Update CP diamond marker position.
   *
   * When a 3D cpNED position is provided (from M×F/|F|² in segment-summed
   * path), position the diamond directly at that height-normalised NED point.
   *
   * Otherwise fall back to the 1D chord-fraction approach:
   *   cpFraction / cgFraction are chord fractions from LE (0=nose, 1=tail).
   *   chord is the reference chord [m] for converting fractions to distances.
   */
  function updateCP(
    cpFraction: number,
    cgFraction: number,
    chord: number,
    height: number,
    pilotScale: number,
    massSegments?: MassSegment[],
    cpNEDin?: { x: number; y: number; z: number },
    canopyScaleRatio: number = 1.0,
  ): void {
    // CP is a canopy-level metric — scale with canopy visual enlargement
    const cpScale = pilotScale * canopyScaleRatio
    if (cpNEDin) {
      // 3D system CP from cross-product formula — position directly
      const cpThree = nedToThreeJS(cpNEDin)
      cpMesh.position.set(
        cpThree.x * cpScale,
        cpThree.y * cpScale,
        cpThree.z * cpScale,
      )
    } else if (massSegments && massSegments.length > 0) {
      // Fallback: position CP along chord axis relative to computed CG
      // Phase C: height may mix mass/aero references for wingsuits (~2.9%).
      // For canopies (the only vehicle with mass segments + CP) both are 1.875.
      const cg = computeCenterOfMass(massSegments, height, 1)
      const cpOffsetNorm = (cgFraction - cpFraction) * chord / height
      const cpNED = { x: cg.x + cpOffsetNorm, y: cg.y, z: cg.z }
      const cpThree = nedToThreeJS(cpNED)
      cpMesh.position.set(
        cpThree.x * cpScale,
        cpThree.y * cpScale,
        cpThree.z * cpScale,
      )
    } else {
      // No mass segments — use chord-fraction directly
      // Phase C: height may mix mass/aero references (see above).
      const cpNED = { x: (0.5 - cpFraction) * (1.0 / height), y: 0, z: 0 }
      const cpThree = nedToThreeJS(cpNED)
      cpMesh.position.set(
        cpThree.x * cpScale,
        cpThree.y * cpScale,
        cpThree.z * cpScale,
      )
    }
    cpMesh.scale.setScalar(MAX_RADIUS * 0.65)
    cpMesh.visible = true
  }

  function setVisible(visible: boolean): void {
    group.visible = visible
    if (!visible) cpMesh.visible = false
  }

  return { group, update, updateCP, setVisible }
}
