/**
 * gps-mass-overlay.ts — Wingsuit body mass-point overlay for the GPS viewer.
 *
 * Replaces the wingsuit cell wireframe shown when "Hide GLB" is toggled.
 * Renders the same point-mass model the simulation uses: small cyan
 * spheres at each mass segment, a red CG sphere with crosshair lines (⊕),
 * and connector lines from each segment to the CG. No CP diamond — that
 * is canopy-specific in the sim, and the wingsuit body has no equivalent.
 *
 * The visualization is anchored in inertial-frame body space (parented
 * to the same scene root as the wingsuit GLB so it inherits the body
 * pose). Positions live in NED-normalised body coordinates and are
 * converted to Three.js (Y-up) at update time.
 *
 * Scaling
 * -------
 * The wingsuit GLB renders at MODEL_SCALE = 2.06 / 3.55 (so a 3.55-m GLB
 * becomes 2.06 scene units). Pilot height (mass reference) is 1.875 m,
 * so 1 m of physical body → MODEL_SCALE ≈ 0.580 scene units. We pass
 * that as `pilotScale` into the underlying mass-overlay so the spheres
 * sit at the same scene-unit positions as the GLB skin.
 */

import * as THREE from 'three'
import type { MassSegment } from '../polar/continuous-polar.ts'
import { createMassOverlay, type MassOverlay } from '../viewer/mass-overlay.ts'

export interface GpsMassOverlay {
  /** Scene-graph group; add this to the scene where the wingsuit lives. */
  group: THREE.Group
  /** Update sphere positions / sizes. Call from setAeroConfig. */
  update(
    inertiaSegments: MassSegment[],
    weightSegments: MassSegment[] | undefined,
    height_m: number,
    weight_kg: number,
  ): void
  /** Toggle visibility (driven by the "Hide GLB" checkbox). */
  setVisible(visible: boolean): void
}

/**
 * Create a wingsuit body mass-point overlay for the GPS viewer.
 *
 * @param pilotScale  Scene-units-per-meter for the pilot body. Typical
 *                    GPS value: MODEL_SCALE = 2.06 / 3.55 ≈ 0.580.
 */
export function createGpsMassOverlay(pilotScale: number): GpsMassOverlay {
  const inner: MassOverlay = createMassOverlay()

  function update(
    inertiaSegments: MassSegment[],
    weightSegments: MassSegment[] | undefined,
    height_m: number,
    weight_kg: number,
  ): void {
    if (inertiaSegments.length === 0) return
    // canopyScaleRatio = 1 (no canopy here), pilotSizeCompensation = 1
    // (no pilot-height slider on the GPS page).
    inner.update(
      inertiaSegments,
      height_m,
      weight_kg,
      pilotScale,
      1.0,
      weightSegments,
      1.0,
    )
  }

  return {
    group: inner.group,
    update,
    setVisible: (visible) => inner.setVisible(visible),
  }
}
