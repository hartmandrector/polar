/**
 * Vehicle registry (Phase C scaffold).
 *
 * Purpose: define per-component reference lengths and bundle pilot + equipment
 * into a single VehicleDefinition for physics and rendering.
 */

import type { ContinuousPolar, MassSegment } from '../polar/continuous-polar.ts'
import type { InertiaComponents } from '../polar/inertia.ts'
import { computeInertia, computeCenterOfMass } from '../polar/inertia.ts'
import {
  aurafiveContinuous,
  a5segmentsContinuous,
  ibexulContinuous,
  slicksinContinuous,
  caravanContinuous,
  WINGSUIT_MASS_SEGMENTS,
  CANOPY_WEIGHT_SEGMENTS,
  CANOPY_INERTIA_SEGMENTS,
} from '../polar/polar-data.ts'
import type { ModelType } from './model-loader.ts'
import { WINGSUIT_GEOMETRY, CANOPY_GEOMETRY, SLICK_GEOMETRY, AIRPLANE_GEOMETRY } from './model-registry.ts'

export interface MassModel {
  segments: MassSegment[]
  cg: { x: number; y: number; z: number } // normalized by pilotHeight_m
  inertia: InertiaComponents              // normalized by pilotHeight_m^2
}

export interface GLBMetadata {
  filePath: string
  physicalReference?: {
    meters: number
    glbExtent: number
  }
  physicalSize: {
    height?: number
    chord?: number
    span?: number
  }
  glbMaxDim?: number
  needsFlip?: boolean
}

export interface ComponentDefinition {
  id: string
  name: string
  aero?: ContinuousPolar
  glb?: GLBMetadata
  mass?: MassModel
  referenceLength_m?: number // component reference (e.g., canopy chord)
  scale?: number // component scale multiplier (1.0 = default)
}

export interface VehicleDefinition {
  id: string
  name: string
  pilot: ComponentDefinition & { pilotHeight_m: number }
  equipment: ComponentDefinition[]
  modelType?: ModelType
  activeAeroComponentId?: string
}

export const DEFAULT_VEHICLE_ID = 'aurafive'

export interface VehicleOption {
  id: string
  name: string
  modelType: ModelType
}

export function getVehicleOptions(): VehicleOption[] {
  return Object.values(VEHICLE_REGISTRY).map((vehicle) => ({
    id: vehicle.id,
    name: vehicle.name,
    modelType: vehicle.modelType ?? 'wingsuit',
  }))
}

export function getVehicleDefinition(id: string): VehicleDefinition {
  return VEHICLE_REGISTRY[id] ?? VEHICLE_REGISTRY[DEFAULT_VEHICLE_ID]
}

export function getVehicleModelType(id: string): ModelType {
  const vehicle = getVehicleDefinition(id)
  return vehicle.modelType ?? 'wingsuit'
}

export function getActiveAeroComponent(vehicle: VehicleDefinition): ComponentDefinition | null {
  const activeId = vehicle.activeAeroComponentId ?? vehicle.pilot.id
  if (vehicle.pilot.id === activeId) return vehicle.pilot
  return vehicle.equipment.find((component) => component.id === activeId) ?? null
}

export function getVehicleAeroPolar(vehicle: VehicleDefinition): ContinuousPolar | null {
  return getActiveAeroComponent(vehicle)?.aero ?? null
}

export function getVehicleMassReference(vehicle: VehicleDefinition, fallback?: ContinuousPolar): number {
  const active = getActiveAeroComponent(vehicle)
  if (active && active !== vehicle.pilot) {
    return active.referenceLength_m ?? fallback?.referenceLength ?? 1.875
  }
  return vehicle.pilot.pilotHeight_m ?? fallback?.referenceLength ?? 1.875
}

/**
 * Denormalize mass data from registry.
 * Takes normalized mass segments and produces physical CG + inertia.
 *
 * @param segments Normalized mass segments (positions / referenceLength)
 * @param referenceLength_m Pilot height or component reference [m]
 * @param totalMass_kg Total system mass [kg] (default 77.5)
 * @returns {cg, inertia} Physical center of gravity and inertia tensor
 */
export function denormalizeMass(
  segments: MassSegment[],
  referenceLength_m: number = 1.875,
  totalMass_kg: number = 77.5
): { cg: { x: number; y: number; z: number }; inertia: InertiaComponents } {
  const cg = computeCenterOfMass(segments, referenceLength_m, totalMass_kg)
  const inertia = computeInertia(segments, referenceLength_m, totalMass_kg)
  return { cg, inertia }
}

// ─── Precomputed mass data for all vehicles ──────────────────────────────────

const AURA5_MASS = denormalizeMass(WINGSUIT_MASS_SEGMENTS, 1.875, 77.5)
const SLICK_MASS = denormalizeMass([], 1.875, 77.5)  // Slick has no mass segments yet
const CANOPY_IBEXUL_MASS = denormalizeMass(CANOPY_WEIGHT_SEGMENTS, 1.875, 5)  // Canopy mass ~5kg

export const VEHICLE_REGISTRY: Record<string, VehicleDefinition> = {
  aurafive: {
    id: 'aurafive',
    name: 'Aura 5 (Wingsuit)',
    modelType: 'wingsuit',
    activeAeroComponentId: 'pilot-aurafive',
    pilot: {
      id: 'pilot-aurafive',
      name: 'Aura 5 Pilot',
      pilotHeight_m: 1.875,
      referenceLength_m: aurafiveContinuous.referenceLength,
      aero: aurafiveContinuous,
      glb: {
        filePath: WINGSUIT_GEOMETRY.path,
        physicalReference: {
          meters: WINGSUIT_GEOMETRY.physicalReference.meters,
          glbExtent: WINGSUIT_GEOMETRY.physicalReference.glbExtent,
        },
        physicalSize: { height: WINGSUIT_GEOMETRY.physicalReference.meters },
        glbMaxDim: WINGSUIT_GEOMETRY.maxDim,
      },
      mass: {
        segments: WINGSUIT_MASS_SEGMENTS,
        cg: AURA5_MASS.cg,
        inertia: AURA5_MASS.inertia,
      },
    },
    equipment: [],
  },
  a5segments: {
    id: 'a5segments',
    name: 'A5 Segments (Wingsuit 6-seg)',
    modelType: 'wingsuit',
    activeAeroComponentId: 'pilot-a5segments',
    pilot: {
      id: 'pilot-a5segments',
      name: 'Aura 5 Pilot (Segments)',
      pilotHeight_m: 1.875,
      referenceLength_m: a5segmentsContinuous.referenceLength,
      aero: a5segmentsContinuous,
      glb: {
        filePath: WINGSUIT_GEOMETRY.path,
        physicalReference: {
          meters: WINGSUIT_GEOMETRY.physicalReference.meters,
          glbExtent: WINGSUIT_GEOMETRY.physicalReference.glbExtent,
        },
        physicalSize: { height: WINGSUIT_GEOMETRY.physicalReference.meters },
        glbMaxDim: WINGSUIT_GEOMETRY.maxDim,
      },
      mass: {
        segments: WINGSUIT_MASS_SEGMENTS,
        cg: AURA5_MASS.cg,
        inertia: AURA5_MASS.inertia,
      },
    },
    equipment: [],
  },
  ibexul: {
    id: 'ibexul',
    name: 'Ibex UL (Canopy)',
    modelType: 'canopy',
    activeAeroComponentId: 'canopy-ibexul',
    pilot: {
      id: 'pilot-canopy',
      name: 'Canopy Pilot',
      pilotHeight_m: 1.875,
      scale: 1,
      referenceLength_m: aurafiveContinuous.referenceLength,
      aero: aurafiveContinuous,
      glb: {
        filePath: WINGSUIT_GEOMETRY.path,
        physicalReference: {
          meters: WINGSUIT_GEOMETRY.physicalReference.meters,
          glbExtent: WINGSUIT_GEOMETRY.physicalReference.glbExtent,
        },
        physicalSize: { height: WINGSUIT_GEOMETRY.physicalReference.meters },
        glbMaxDim: WINGSUIT_GEOMETRY.maxDim,
      },
      mass: {
        segments: WINGSUIT_MASS_SEGMENTS,
        cg: AURA5_MASS.cg,
        inertia: AURA5_MASS.inertia,
      },
    },
    equipment: [
      {
        id: 'canopy-ibexul',
        name: 'Ibex UL Canopy',
        scale: 1.0,  // physical proportions — visual scale absorbed into assembly parentScale
        aero: ibexulContinuous,
        referenceLength_m: 1.875, // TODO(phase-c): move to canopy chord reference
        glb: {
          filePath: CANOPY_GEOMETRY.path,
          physicalReference: {
            meters: CANOPY_GEOMETRY.physicalReference.meters,
            glbExtent: CANOPY_GEOMETRY.physicalReference.glbExtent,
          },
          physicalSize: {
            chord: CANOPY_GEOMETRY.physicalReference.meters,
            span: CANOPY_GEOMETRY.bbox.size.x * CANOPY_GEOMETRY.glbToMeters,
          },
          glbMaxDim: CANOPY_GEOMETRY.maxDim,
          needsFlip: true,
        },
        mass: {
          segments: CANOPY_WEIGHT_SEGMENTS,
          cg: CANOPY_IBEXUL_MASS.cg,
          inertia: CANOPY_IBEXUL_MASS.inertia,
        },
      },
    ],
  },
  slicksin: {
    id: 'slicksin',
    name: 'Slick Sin (Skydiver)',
    modelType: 'skydiver',
    activeAeroComponentId: 'pilot-slick',
    pilot: {
      id: 'pilot-slick',
      name: 'Slick Pilot',
      pilotHeight_m: 1.875,
      referenceLength_m: slicksinContinuous.referenceLength,
      aero: slicksinContinuous,
      glb: {
        filePath: SLICK_GEOMETRY.path,
        physicalReference: {
          meters: SLICK_GEOMETRY.physicalReference.meters,
          glbExtent: SLICK_GEOMETRY.physicalReference.glbExtent,
        },
        physicalSize: { height: SLICK_GEOMETRY.physicalReference.meters },
        glbMaxDim: SLICK_GEOMETRY.maxDim,
      },
      mass: {
        segments: [],
        cg: SLICK_MASS.cg,
        inertia: SLICK_MASS.inertia,
      },
    },
    equipment: [],
  },
  caravan: {
    id: 'caravan',
    name: 'Caravan (Airplane)',
    modelType: 'airplane',
    activeAeroComponentId: 'airplane-body',
    pilot: {
      id: 'pilot-airplane',
      name: 'Airplane Pilot',
      pilotHeight_m: 1.875,
    },
    equipment: [
      {
        id: 'airplane-body',
        name: 'Dornier Do 228-200',
        aero: caravanContinuous,
        referenceLength_m: caravanContinuous.referenceLength,
        glb: {
          filePath: AIRPLANE_GEOMETRY.path,
          physicalReference: {
            meters: AIRPLANE_GEOMETRY.physicalReference.meters,
            glbExtent: AIRPLANE_GEOMETRY.physicalReference.glbExtent,
          },
          physicalSize: {
            span: AIRPLANE_GEOMETRY.physicalReference.meters,
          },
          glbMaxDim: AIRPLANE_GEOMETRY.maxDim,
        },
      },
    ],
  },
  // Phase C starter entry (default Aura 5 + Ibex UL)
  'aura5-ibexul': {
    id: 'aura5-ibexul',
    name: 'Aura 5 + Ibex UL (Default)',
    modelType: 'canopy',
    activeAeroComponentId: 'canopy-ibexul',
    pilot: {
      id: 'pilot-aura5',
      name: 'Aura 5 Pilot',
      pilotHeight_m: 1.875,
      scale: 1,
      referenceLength_m: aurafiveContinuous.referenceLength,
      aero: aurafiveContinuous,
      glb: {
        filePath: WINGSUIT_GEOMETRY.path,
        physicalReference: {
          meters: WINGSUIT_GEOMETRY.physicalReference.meters,
          glbExtent: WINGSUIT_GEOMETRY.physicalReference.glbExtent,
        },
        physicalSize: { height: WINGSUIT_GEOMETRY.physicalReference.meters },
        glbMaxDim: WINGSUIT_GEOMETRY.maxDim,
      },
      mass: {
        segments: WINGSUIT_MASS_SEGMENTS,
        cg: AURA5_MASS.cg,
        inertia: AURA5_MASS.inertia,
      },
    },
    equipment: [
      {
        id: 'canopy-ibexul',
        name: 'Ibex UL Canopy',
        scale: 1.0,  // physical proportions — visual scale absorbed into assembly parentScale
        aero: ibexulContinuous,
        referenceLength_m: 1.875, // TODO(phase-c): move to canopy chord reference
        glb: {
          filePath: CANOPY_GEOMETRY.path,
          physicalReference: {
            meters: CANOPY_GEOMETRY.physicalReference.meters,
            glbExtent: CANOPY_GEOMETRY.physicalReference.glbExtent,
          },
          physicalSize: {
            chord: CANOPY_GEOMETRY.physicalReference.meters,
            span: CANOPY_GEOMETRY.bbox.size.x * CANOPY_GEOMETRY.glbToMeters,
          },
          glbMaxDim: CANOPY_GEOMETRY.maxDim,
          needsFlip: true,
        },
        mass: {
          segments: CANOPY_WEIGHT_SEGMENTS,
          cg: CANOPY_IBEXUL_MASS.cg,
          inertia: CANOPY_IBEXUL_MASS.inertia,
        },
      },
    ],
  },
}
