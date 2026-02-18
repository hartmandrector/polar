/**
 * Mass point overlay — renders point-mass model as small spheres
 * in the 3D viewport, with CG highlighted.
 *
 * Positions are in NED body frame, converted to Three.js at render time.
 * Sphere size is proportional to mass fraction for visual clarity.
 * Dynamically adapts to any number of mass segments.
 */

import * as THREE from 'three'
import type { MassSegment } from '../polar/continuous-polar.ts'
import { getPhysicalMassPositions, computeCenterOfMass } from '../polar/inertia.ts'
import { nedToThreeJS } from './frames.ts'

export interface MassOverlay {
  group: THREE.Group
  /** Update sphere positions from a polar's mass segments */
  update(segments: MassSegment[], height: number, weight: number, pilotScale: number): void
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
    opacity: 0.85,
    specular: 0x444444,
    shininess: 60,
  })
  const linesMaterial = new THREE.LineBasicMaterial({
    color: MASS_COLOR,
    transparent: true,
    opacity: 0.25,
  })

  const sphereGeo = new THREE.SphereGeometry(1, 12, 8)

  // CG marker (always present)
  const cgMesh = new THREE.Mesh(sphereGeo, cgMaterial)
  cgMesh.name = 'cg-marker'
  group.add(cgMesh)

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

  function update(segments: MassSegment[], height: number, weight: number, pilotScale: number): void {
    if (segments.length === 0) return

    ensureMeshCount(segments.length)

    const masses = getPhysicalMassPositions(segments, height, weight)
    const cg = computeCenterOfMass(segments, height, weight)

    // pilotScale converts pilot-body meters to model units
    const scale = pilotScale
    const maxMass = Math.max(...masses.map(m => m.mass))

    for (let i = 0; i < masses.length; i++) {
      const mp = masses[i]
      const mesh = massPoints[i]

      // NED body → Three.js via nedToThreeJS
      const threePos = nedToThreeJS({ x: mp.x, y: mp.y, z: mp.z })
      mesh.position.set(
        threePos.x * scale,
        threePos.y * scale,
        threePos.z * scale
      )

      const t = mp.mass / maxMass
      const radius = MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS)
      mesh.scale.setScalar(radius)
    }

    // CG marker
    const cgThree = nedToThreeJS({ x: cg.x, y: cg.y, z: cg.z })
    cgMesh.position.set(
      cgThree.x * scale,
      cgThree.y * scale,
      cgThree.z * scale
    )
    cgMesh.scale.setScalar(MAX_RADIUS * 1.3)

    // Remove old lines
    const oldLines = group.children.filter(c => c.name === 'mass-line')
    oldLines.forEach(l => group.remove(l))

    // Draw connecting lines from each mass point to CG
    for (const mesh of massPoints) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        mesh.position.clone(),
        cgMesh.position.clone(),
      ])
      const line = new THREE.Line(geometry, linesMaterial)
      line.name = 'mass-line'
      group.add(line)
    }
  }

  function setVisible(visible: boolean): void {
    group.visible = visible
  }

  return { group, update, setVisible }
}
