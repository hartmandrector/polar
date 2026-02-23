/**
 * 3D model loading — wingsuit, canopy (with pilot sub-model), slick skydiver, airplane.
 *
 * Models are loaded from the public/models/ directory.
 * When loading a canopy model with a pilot type, both are composed into a single
 * normalized group so the pilot hangs below the canopy at the riser attachment point.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { windDirectionBody } from './frames.ts'
import {
  CANOPY_WINGSUIT_ASSEMBLY, CANOPY_SLICK_ASSEMBLY,
  WINGSUIT_GEOMETRY, SLICK_GEOMETRY, CANOPY_GEOMETRY,
  MODEL_REGISTRY, TARGET_SIZE, deriveAssemblyOffsets,
  type VehicleAssembly, type ModelGeometry,
} from './model-registry.ts'
import type { VehicleDefinition, GLBMetadata } from './vehicle-registry.ts'

export type ModelType = 'wingsuit' | 'canopy' | 'skydiver' | 'airplane'
export type PilotType = 'wingsuit' | 'slick'

const MODEL_PATHS: Record<ModelType, string> = {
  wingsuit: WINGSUIT_GEOMETRY.path,
  canopy: CANOPY_GEOMETRY.path,
  skydiver: SLICK_GEOMETRY.path,
  airplane: MODEL_REGISTRY['airplane'].path,
}

interface ModelOverrides {
  mainPath?: string
  pilotPath?: string
  mainScale?: number
  pilotScale?: number
  assembly?: VehicleAssembly
}

/** Pilot sub-model GLB paths (reuses same assets as standalone models) */
const PILOT_PATHS: Record<PilotType, string> = {
  wingsuit: WINGSUIT_GEOMETRY.path,
  slick: SLICK_GEOMETRY.path,
}

/** Pilot sub-model geometry (for fabricOvershoot, bbox measurements) */
const PILOT_GEOMETRY: Record<PilotType, ModelGeometry> = {
  wingsuit: WINGSUIT_GEOMETRY,
  slick: SLICK_GEOMETRY,
}

/** Look up the vehicle assembly for a given pilot type under the canopy. */
function getAssembly(pilotType: PilotType): VehicleAssembly {
  return pilotType === 'slick' ? CANOPY_SLICK_ASSEMBLY : CANOPY_WINGSUIT_ASSEMBLY
}

function getCanopyAssemblyScales(assembly: VehicleAssembly): { parentScale: number; childScale: number } {
  return {
    parentScale: assembly.parentScale,
    childScale: assembly.childScale ?? 1,
  }
}

function getComponentScale(component?: VehicleDefinition['equipment'][number] | VehicleDefinition['pilot']): number {
  return component?.scale ?? 1
}

function getCanopyComponent(vehicle: VehicleDefinition): VehicleDefinition['equipment'][number] | undefined {
  return vehicle.equipment.find((component) => component.glb?.filePath === CANOPY_GEOMETRY.path)
    ?? vehicle.equipment.find((component) => component.id.startsWith('canopy'))
    ?? vehicle.equipment[0]
}

function resolveVehicleAssembly(vehicle: VehicleDefinition, pilotType: PilotType): VehicleAssembly {
  const base = getAssembly(pilotType)
  const canopyComponent = getCanopyComponent(vehicle)
  const canopyComponentScale = getComponentScale(canopyComponent)
  const pilotComponentScale = getComponentScale(vehicle.pilot)

  // Derive baseline proportions from parentScale.
  const pilotBase = base.parentScale
  const baseDerived = deriveAssemblyOffsets(PILOT_GEOMETRY[pilotType], CANOPY_GEOMETRY, pilotBase)

  // Apply component scales independently so canopy and pilot are decoupled.
  const fullCanopyScale = base.parentScale * canopyComponentScale

  if (!baseDerived) {
    return { ...base, parentScale: fullCanopyScale, baseParentScale: base.parentScale }
  }

  const finalChildScale = baseDerived.childScale * pilotComponentScale

  return {
    ...base,
    parentScale: fullCanopyScale,
    baseParentScale: base.parentScale,
    childScale: finalChildScale,
    childOffset: {
      x: baseDerived.childOffset.x,
      y: baseDerived.childOffset.y * pilotComponentScale,
      z: baseDerived.childOffset.z,
    },
    shoulderOffsetFraction: baseDerived.shoulderOffsetFraction,
  }
}

function resolveGlbScale(glb?: GLBMetadata): number | undefined {
  if (!glb) return undefined
  if (glb.physicalReference) {
    return glb.physicalReference.meters / glb.physicalReference.glbExtent
  }
  if (glb.glbMaxDim) {
    const meters = glb.physicalSize.height ?? glb.physicalSize.chord ?? glb.physicalSize.span
    if (meters) return meters / glb.glbMaxDim
  }
  return undefined
}

function resolveMainPath(vehicle: VehicleDefinition, modelType: ModelType): string {
  if (modelType === 'canopy' || modelType === 'airplane') {
    const glb = vehicle.equipment.find((component) => component.glb)?.glb
    return glb?.filePath ?? MODEL_PATHS[modelType]
  }
  return vehicle.pilot.glb?.filePath ?? MODEL_PATHS[modelType]
}

function resolvePilotPath(vehicle: VehicleDefinition, pilotType?: PilotType): string | undefined {
  if (!pilotType) return undefined
  if (pilotType === 'wingsuit') return vehicle.pilot.glb?.filePath ?? PILOT_PATHS[pilotType]
  return PILOT_PATHS[pilotType]
}

// ── Legacy constants (now sourced from registry) ────────────────────────────
// These are kept as named exports for backward compatibility (main.ts imports
// CANOPY_SCALE for deployment span/chord scaling).

/**
 * Pilot positioning relative to canopy in raw GLB coordinates.
 * Now sourced from VehicleAssembly.childOffset / childRotationDeg.
 *
 * OLD:
 *   const PILOT_OFFSET = {
 *     position: new THREE.Vector3(0, -0.540, 0),
 *     rotation: new THREE.Euler(-Math.PI / 2, 0, 0),
 *   }
 */
function pilotOffset(assembly: VehicleAssembly): { position: THREE.Vector3; rotation: THREE.Euler } {
  const o = assembly.childOffset
  const r = assembly.childRotationDeg
  return {
    position: new THREE.Vector3(o.x, o.y, o.z),
    rotation: new THREE.Euler(
      r.x * Math.PI / 180,
      r.y * Math.PI / 180,
      r.z * Math.PI / 180,
    ),
  }
}

/**
 * Scale factor for the canopy mesh — now sourced from assembly.parentScale.
 * Re-exported for backward compatibility (main.ts deployment scaling).
 */
export const CANOPY_SCALE = CANOPY_WINGSUIT_ASSEMBLY.parentScale  // 4.5



/**
 * Wingsuit deployment visualization group.
 * Contains the PC, snivel, bridle, and lines — all pre-loaded and hidden.
 * Positions and visibility are driven by the wingsuitDeploy slider in main.ts.
 */
export interface WingsuitDeployGroup {
  /** Container group parented to the outer model group */
  group: THREE.Group
  /** Pilot chute GLB mesh */
  pc: THREE.Group
  /** Snivel (canopy in bag) GLB mesh */
  snivel: THREE.Group
  /** Bridle line: container → PC */
  bridleLine: THREE.Line
  /** Left shoulder → snivel line */
  lineLeft: THREE.Line
  /** Right shoulder → snivel line */
  lineRight: THREE.Line
}

export interface LoadedModel {
  type: ModelType
  group: THREE.Group  // The container group we rotate for attitude
  model: THREE.Group  // The loaded/composed scene inside (normalized)
  /** Bounding box length along the Z-axis (flight direction) in normalized units */
  bodyLength: number
  /** Scale factor to convert pilot body meters to model units (for mass overlay) */
  pilotScale: number
  /** Base canopy scale at full deployment (for dynamic span/chord scaling) */
  canopyBaseScale?: number
  /** Which pilot sub-model is loaded (only for canopy) */
  pilotType?: PilotType
  /** Pivot group for bridle + pilot chute (only for canopy), rotatable per wind direction */
  bridleGroup?: THREE.Group
  /** Pivot group for pilot body pitch rotation (only for canopy).
   *  Origin sits at the riser attachment point; rotating about X pitches the pilot fore/aft. */
  pilotPivot?: THREE.Group
  /** The canopy GLB mesh (only for canopy). Used for deployment horizontal scaling. */
  canopyModel?: THREE.Group
  /**
   * CG offset applied to center the model at the origin [Three.js scene units].
   * This is the vector subtracted from the model's position so the CG sits at (0,0,0).
   * Force vectors must subtract this same offset from their computed positions.
   * Only set for canopy models positioned via applyCgFromMassSegments.
   */
  cgOffsetThree?: THREE.Vector3
  /** Base model position before any CG offset (captured on first CG call) */
  baseModelPos?: THREE.Vector3
  /** Base bridle position before any CG offset (captured on first CG call) */
  baseBridlePos?: THREE.Vector3
  /**
   * Pilot pitch pivot point in NED normalised coordinates, derived from
   * the 3D model's pilotPivot position.  Used by rotatePilotMass() so the
   * mass-overlay balls swing about the same point as the GLB pilot model.
   * Computed once at load time; undefined for non-canopy models.
   */
  massPivotNED?: { x: number; z: number }
  /** Wingsuit deployment visualization (only for wingsuit) */
  deployGroup?: WingsuitDeployGroup
  /**
   * Ratio between the visual canopy scale and the physics scale.
   * When the canopy mesh is enlarged via component scale (e.g. 1.5×), canopy-attached
   * aero/mass positions need to be multiplied by this ratio so they align with the
   * enlarged mesh. Pilot-body positions use the base pilotScale (ratio = 1.0).
   * Default: 1.0 (no enlargement).
   */
  canopyScaleRatio: number
  /**
   * Current canopy component scale (1.0 = base, 1.5 = 50% enlargement).
   * Drives both the GLB mesh size and the canopyScaleRatio for aero overlays.
   * Default: 1.0 for non-canopy models.
   */
  canopyComponentScale: number
  /**
   * Atomically update the canopy component scale at runtime.
   * Scales the canopy GLB mesh and recalculates canopyScaleRatio + canopyBaseScale
   * so that physics overlays stay aligned with the enlarged mesh.
   * Only available for canopy-type models; undefined for others.
   */
  setCanopyScale?: (scale: number) => void
  /**
   * Atomically update the pilot body scale at runtime based on height in cm.
   * Rescales the pilot GLB model and recalculates the shoulder offset so the
   * riser attachment point stays fixed.  Only available for canopy composites.
   */
  setPilotHeight?: (heightCm: number) => void
  /**
   * Pilot size compensation factor from the assembly.
   * Used to scale pilot-only mass/aero positions to match the compensated mesh.
   * Default: 1.0 (no compensation).
   */
  pilotSizeCompensation: number
}

const loader = new GLTFLoader()
const rawCache = new Map<string, THREE.Group>()

/** Load a raw GLTF/GLB and cache by path. Returns a clone. */
async function loadRawGltf(path: string): Promise<THREE.Group> {
  if (rawCache.has(path)) {
    return rawCache.get(path)!.clone()
  }
  const gltf = await loader.loadAsync(path)
  const model = gltf.scene as THREE.Group
  rawCache.set(path, model.clone())
  return model
}

/**
 * Reference size for normalization — now sourced from model-registry.ts.
 * All models with a pilot body are scaled so the pilot's max raw dimension
 * maps to TARGET_SIZE. This keeps the wingsuit the same screen size whether
 * viewed standalone or as a sub-model under a canopy.
 */
// TARGET_SIZE = 2.0 (from model-registry.ts)

/**
 * Cached raw max dimension of the wingsuit GLB.
 * Measured once on first load, then reused for canopy composites so scaling
 * is consistent between standalone wingsuit and canopy+wingsuit views.
 */
let wingsuitRawMaxDim = 0

/**
 * Load a model, returning a group that wraps the loaded GLTF scene.
 * The outer group is what we rotate for attitude.
 *
 * For canopy models with a pilotType, both the canopy and pilot are loaded
 * and composed in raw GLB coordinates, then normalized together.
 */
export async function loadModel(type: ModelType, pilotType?: PilotType, overrides?: ModelOverrides): Promise<LoadedModel> {
  const group = new THREE.Group()
  group.name = `model-${type}`

  // Load main model
  const mainPath = overrides?.mainPath ?? MODEL_PATHS[type]
  const mainModel = await loadRawGltf(mainPath)

  // For canopy + pilot, compose both before normalization
  let compositeRoot: THREE.Group
  let pilotRawHeight = 0  // raw pilot max extent in GLB units (before normalization)
  let referenceDim = 0    // the dimension used for normalization (pilot body size)
  let canopyBaseScale: number | undefined
  let pilotSizeCompensation = 1.0  // compensation factor for pilot GLB scale
  if (type === 'canopy' && pilotType) {
    const assembly = overrides?.assembly ?? getAssembly(pilotType)
    const pilotGeo = PILOT_GEOMETRY[pilotType]
    const offset = pilotOffset(assembly)

    compositeRoot = new THREE.Group()

    // Scale canopy mesh to realistic size (pilot stays 1:1).
    // parentScale from registry (currently 1.5).
    //
    // X-axis flip (negative X scale): the canopy GLB has +X = right (from
    // pilot perspective), but the Three.js scene convention is +X = left
    // (nedToThreeJS maps NED +y/right to Three.js −X). Without the flip,
    // the canopy right wing would render on the opposite side from the
    // physics right-side cells. Negative X scale flips the mesh so both
    // agree: right = Three.js −X.
    // Three.js WebGLRenderer detects the negative determinant and auto-
    // reverses face winding, so normals and culling remain correct.
    // Derive assembly scales from measured GLB extents (glbToMeters).
    const { parentScale, childScale } = getCanopyAssemblyScales(assembly)
    const cs = parentScale
    mainModel.scale.set(-cs, cs, cs)
    compositeRoot.add(mainModel)

    const pilotPath = overrides?.pilotPath ?? PILOT_PATHS[pilotType]
    const pilotModel = await loadRawGltf(pilotPath)
    // Measure pilot's raw bounding box max extent (body length in GLB coords)
    const pilotBox = new THREE.Box3().setFromObject(pilotModel)
    const pilotSize = pilotBox.getSize(new THREE.Vector3())
    pilotRawHeight = Math.max(pilotSize.x, pilotSize.y, pilotSize.z)  // longest axis = body length

    // Scale pilot to match canopy's physical proportions.
    // childScale corrects for different GLB-to-meters ratios between canopy
    // and pilot models, so the pilot renders at the correct physical size
    // relative to the canopy mesh (otherwise the pilot appears ~17% too large).
    // pilotSizeCompensation provides an additional per-assembly adjustment for
    // inherent GLB model scale differences before the physics conversion.
    pilotSizeCompensation = assembly.pilotSizeCompensation ?? 1.0
    const childSc = childScale * pilotSizeCompensation
    pilotModel.scale.setScalar(childSc)

    // Wrap pilot in a pivot group at the riser attachment point.
    // Rotating this group about X pitches the hanging pilot fore/aft.
    const pilotPivot = new THREE.Group()
    pilotPivot.name = 'pilot-pitch-pivot'

    // After the pre-rotation the body hangs along Y: head at +Y, feet at -Y.
    // Raw GLB body length along Z → becomes Y extent.
    // The model origin is at the CG (belly button).  The riser attachment
    // (shoulders) is slightly above that — shoulderOffsetFraction of body extent.
    // Shift the model DOWN within the pivot so shoulders sit at the pivot
    // origin, and move the pivot UP by the same amount so the pilot's resting
    // position stays at childOffset (net position unchanged, but rotation
    // center is now at the shoulders).
    // The effective offset accounts for childScale: the scaled shoulder
    // position in the rotated model determines the actual displacement.
    // NOTE: childOffset.y was computed assuming the base childScale, so when
    // pilotSizeCompensation is applied, the offset must also scale to keep
    // the pivot at the riser attachment point.
    const bodyExtentY = pilotSize.z  // raw body length along GLB Z
    const shoulderOffset = assembly.shoulderOffsetFraction * bodyExtentY * childSc
    const scaledOffsetY = offset.position.y * pilotSizeCompensation  // scale offset for compensation
    pilotPivot.position.set(
      offset.position.x,
      scaledOffsetY + shoulderOffset,
      offset.position.z,
    )
    pilotModel.position.set(0, -shoulderOffset, 0)
    pilotModel.rotation.copy(offset.rotation)
    pilotPivot.add(pilotModel)
    compositeRoot.add(pilotPivot)
    ;(compositeRoot as any)._pilotPivot = pilotPivot

    // Store base pilot values for the setPilotHeight closure.
    // NOTE: Store the FULL initial pivot position (including shoulderOffset) so that
    // ratio scaling produces the correct net position. If we stored scaledOffsetY
    // alone, the shoulder offset would scale independently and the two nearly-canceling
    // values would produce positions close to zero at small ratios.
    ;(compositeRoot as any)._pilotModel = pilotModel
    ;(compositeRoot as any)._basePilotChildScale = childSc
    ;(compositeRoot as any)._pilotBodyExtentY = bodyExtentY
    ;(compositeRoot as any)._pilotShoulderFrac = assembly.shoulderOffsetFraction
    ;(compositeRoot as any)._baseShoulderOffset = shoulderOffset  // initial shoulder offset at baseline
    const scaledOffsetPos = offset.position.clone()
    scaledOffsetPos.y = scaledOffsetY + shoulderOffset  // store FULL initial position
    ;(compositeRoot as any)._pilotOffsetPos = scaledOffsetPos

    // Use the standalone pilot raw dimension as reference
    // so the pilot appears the same size as when viewed standalone.
    // If we haven't cached it yet, measure it now from the pilot GLB.
    if (wingsuitRawMaxDim === 0) {
      // Measure from a fresh clone (unpositioned, unrotated)
      const refModel = await loadRawGltf(PILOT_PATHS[pilotType])
      const refBox = new THREE.Box3().setFromObject(refModel)
      const refSize = refBox.getSize(new THREE.Vector3())
      wingsuitRawMaxDim = Math.max(refSize.x, refSize.y, refSize.z)
    }
    referenceDim = wingsuitRawMaxDim

    // Store info for post-normalization bridle loading (uses bridleTop from registry)
    ;(compositeRoot as any)._needsBridle = true
    ;(compositeRoot as any)._assembly = assembly
    ;(compositeRoot as any)._pilotFabricOvershoot = pilotGeo.fabricOvershoot ?? 1.15
  } else {
    compositeRoot = mainModel
    // For standalone models, use their own max dimension
    const box = new THREE.Box3().setFromObject(compositeRoot)
    const size = box.getSize(new THREE.Vector3())
    referenceDim = Math.max(size.x, size.y, size.z)

    // Cache wingsuit raw dimension for later canopy composites
    if (type === 'wingsuit' && wingsuitRawMaxDim === 0) {
      wingsuitRawMaxDim = referenceDim
    }
  }

  // ── Normalize and center ──
  // For canopy models: center at riser convergence (canopy GLB origin).
  // For other models: center at bbox midpoint (legacy behavior).
  //
  // pilotScale: converts NED-normalized meters → Three.js scene units.
  // For canopy: derived FROM the canopy mesh scale so physics segment
  // positions land exactly on the GLB mesh. Formula:
  //   canopyMeshScale = parentScale × s  (scene units per GLB unit)
  //   pilotScale = canopyMeshScale / glbToMeters
  // For standalone: derived from pilot body length (legacy).
  const box = new THREE.Box3().setFromObject(compositeRoot)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  let bodyLength = 2.0
  let pilotScale = 1.0
  let canopyScaleRatio = 1.0
  let canopyComponentScale = 1.0
  // Base values captured for the setCanopyScale closure
  let _canopyBasePS = 0   // baseParentScale (assembly scale without component multiplier)
  let _canopyNormS = 0    // TARGET_SIZE / referenceDim normalization factor
  let _canopyOverlayPS = 1.0  // assembly overlay position scale
  if (referenceDim > 0) {
    const s = TARGET_SIZE / referenceDim
    compositeRoot.scale.multiplyScalar(s)

    if (type === 'canopy') {
      // Riser convergence centering: the canopy GLB origin (riser convergence
      // point) is at (0,0,0) in compositeRoot space. After uniform scaling by s,
      // it stays at compositeRoot.position. We leave position at (0,0,0) so the
      // riser convergence sits at the Three.js scene origin.
      // applyCgFromMassSegments (called later by main.ts) will shift the model
      // so the physics CG is at the origin instead — both mesh and force vectors
      // shift by the same offset, keeping alignment.

      // pilotScale from the canopy mesh: ensures NED physics positions map to
      // the correct Three.js coordinates for the canopy GLB geometry.
      // Use baseParentScale (without component scaling) so physics positions
      // stay at the correct physical size regardless of canopy visual scaling.
      // The canopy mesh may be enlarged via component scale for visual clarity,
      // but forces/mass should render at physically correct positions.
      const resolvedAssembly: VehicleAssembly | undefined = (compositeRoot as any)._assembly
      const physicsParentScale = resolvedAssembly?.baseParentScale ?? Math.abs(mainModel.scale.x)
      canopyBaseScale = Math.abs(mainModel.scale.x) * s  // full visual scale (for deployment)
      // NOTE: pilotSizeCompensation is NOT applied here — pilotScale affects ALL
      // overlay positions (canopy + pilot). Compensation is handled separately
      // in the pilot mesh scaling path above.
      pilotScale = (physicsParentScale * s) / CANOPY_GEOMETRY.glbToMeters
      // Component scale = visual enlargement factor (fullScale / baseScale)
      canopyComponentScale = physicsParentScale > 0
        ? Math.abs(mainModel.scale.x) / physicsParentScale
        : 1.0
      // canopyScaleRatio: maps physics positions to match the visually scaled mesh.
      // Uses the assembly's measured overlayPositionScale (accounts for the different
      // transform pipelines between Three.js mesh scaling and NED→scene conversion).
      const overlayPS = resolvedAssembly?.overlayPositionScale ?? 1.0
      canopyScaleRatio = canopyComponentScale * overlayPS
      // Capture base values for runtime re-scaling (setCanopyScale closure)
      _canopyBasePS = physicsParentScale
      _canopyNormS = s
      _canopyOverlayPS = overlayPS

    } else {
      // Standalone models: bbox-center at origin (legacy)
      compositeRoot.position.sub(center.multiplyScalar(s))
      bodyLength = size.z * s
      pilotScale = bodyLength / WINGSUIT_GEOMETRY.referenceHeight  // pilot height (1.875m, same for all models)
    }
  }

  group.add(compositeRoot)

  // Load bridle+PC after normalization so it doesn't affect bounding box / scale.
  // The bridleGroup is added to the outer `group` (not compositeRoot) so it
  // inherits the attitude rotation but is positioned in normalized coordinates.
  let bridleGroup: THREE.Group | undefined
  if ((compositeRoot as any)._needsBridle) {
    const assembly: VehicleAssembly = (compositeRoot as any)._assembly
    const bridlePCModel = await loadRawGltf('/models/bridalandpc.gltf')
    const s = compositeRoot.scale.x  // normalization scale (should be positive)
    const bridleScale = assembly.deployScales?.bridle ?? 3.0
    bridlePCModel.scale.setScalar(bridleScale * Math.abs(s))

    bridleGroup = new THREE.Group()
    bridleGroup.name = 'bridle-pc-pivot'
    bridleGroup.add(bridlePCModel)

    // Get bridleTop attachment from registry and convert to Three.js coordinates.
    // Registry stores GLB coords; transform through the same pipeline as the canopy mesh.
    const attachment = CANOPY_GEOMETRY.attachments!.find(a => a.name === 'bridleTop')!
    const glb = attachment.glb
    // GLB → Three.js with canopy X-flip: (x, y, z) → (−x × cs × s, y × cs × s, z × cs × s)
    const { parentScale } = getCanopyAssemblyScales(assembly)
    const cs = parentScale
    const attachX = -glb.x * cs * s
    const attachY =  glb.y * cs * s
    const attachZ =  glb.z * cs * s
    
    // Position at attachment in normalized scene coordinates (compositeRoot position is 0,0,0)
    bridleGroup.position.set(attachX, attachY, attachZ)

    group.add(bridleGroup)
  }

  // ── Wingsuit deployment visualization ──
  // Load PC and snivel GLBs, create bridle/line geometry.
  // Everything starts hidden; main.ts drives visibility + positions from wsDeploy slider.
  let deployGroup: WingsuitDeployGroup | undefined
  if (type === 'wingsuit') {
    const s = compositeRoot.scale.x  // normalization scale
    const dGroup = new THREE.Group()
    dGroup.name = 'ws-deploy-group'
    dGroup.visible = false  // hidden at deploy = 0

    // Load PC model (pilot chute)
    const pcModel = await loadRawGltf('/models/pc.glb')
    pcModel.scale.setScalar(0.4 * s)  // PC is small (~0.5m diameter)
    pcModel.visible = false
    dGroup.add(pcModel)

    // Load snivel model (canopy in bag)
    const snivelModel = await loadRawGltf('/models/snivel.glb')
    snivelModel.scale.setScalar(0.6 * s)  // snivel bag is slightly bigger than PC
    snivelModel.visible = false
    dGroup.add(snivelModel)

    // Bridle line: container → PC (orange/red line)
    const bridleLineMat = new THREE.LineBasicMaterial({ color: 0xff6600, linewidth: 2 })
    const bridleLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ])
    const bridleLine = new THREE.Line(bridleLineGeo, bridleLineMat)
    bridleLine.visible = false
    dGroup.add(bridleLine)

    // Shoulder-to-snivel lines (dark grey, one per shoulder)
    const lineMat = new THREE.LineBasicMaterial({ color: 0x444444, linewidth: 1 })
    const lineGeoL = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ])
    const lineGeoR = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ])
    const lineLeft = new THREE.Line(lineGeoL, lineMat)
    const lineRight = new THREE.Line(lineGeoR, lineMat)
    lineLeft.visible = false
    lineRight.visible = false
    dGroup.add(lineLeft)
    dGroup.add(lineRight)

    group.add(dGroup)

    deployGroup = {
      group: dGroup,
      pc: pcModel,
      snivel: snivelModel,
      bridleLine,
      lineLeft,
      lineRight,
    }
  }

  const result: LoadedModel = {
    type, group, model: compositeRoot, bodyLength, pilotScale, pilotType,
    bridleGroup, pilotPivot: (compositeRoot as any)._pilotPivot,
    canopyModel: type === 'canopy' ? mainModel : undefined,
    canopyBaseScale, canopyScaleRatio, canopyComponentScale, deployGroup,
    pilotSizeCompensation,
  }

  // Coupled scaling: setCanopyScale atomically updates the GLB mesh size,
  // canopyScaleRatio, canopyBaseScale, and canopyComponentScale so that the
  // visual mesh and physics overlays always stay aligned.
  if (type === 'canopy' && mainModel && _canopyBasePS > 0) {
    const _initialComponentScale = canopyComponentScale
    // Capture the original bridle base position before any scaling
    let _origBridlePos: THREE.Vector3 | undefined
    result.setCanopyScale = (newScale: number) => {
      const newFull = _canopyBasePS * newScale
      mainModel.scale.set(-newFull, newFull, newFull)
      result.canopyScaleRatio = newScale * _canopyOverlayPS
      result.canopyBaseScale = newFull * _canopyNormS
      result.canopyComponentScale = newScale

      // Update baseBridlePos to reflect the new canopy scale.
      // The original baseBridlePos was captured at _initialComponentScale;
      // scale it by newScale/_initialComponentScale so the deployment code
      // in main.ts (which applies spanScale/chordScale on top) stays correct.
      if (bridleGroup && result.baseBridlePos) {
        if (!_origBridlePos) _origBridlePos = result.baseBridlePos.clone()
        const scaleRatio = newScale / _initialComponentScale
        result.baseBridlePos.set(
          _origBridlePos.x * scaleRatio,
          _origBridlePos.y * scaleRatio,
          _origBridlePos.z * scaleRatio,
        )
      }
    }
  }

  // Pilot height rescaling: adjusts the pilot body scale and repositions
  // the shoulder offset so the riser attachment point stays fixed.
  if (type === 'canopy' && (compositeRoot as any)._pilotModel) {
    const _pm = (compositeRoot as any)._pilotModel as THREE.Group
    const _pp = (compositeRoot as any)._pilotPivot as THREE.Group
    const _baseCS: number = (compositeRoot as any)._basePilotChildScale
    const _bodyY: number = (compositeRoot as any)._pilotBodyExtentY
    const _sFrac: number = (compositeRoot as any)._pilotShoulderFrac
    const _baseShoulder: number = (compositeRoot as any)._baseShoulderOffset
    const _offPos: THREE.Vector3 = (compositeRoot as any)._pilotOffsetPos
    result.setPilotHeight = (heightCm: number) => {
      const ratio = heightCm / 187.5
      const newChildScale = _baseCS * ratio
      _pm.scale.setScalar(newChildScale)
      // Scale the full initial pivot position by ratio to maintain correct proportions.
      // The shoulder offset for the mesh-within-pivot also scales by ratio.
      const newShoulderOffset = _baseShoulder * ratio
      _pp.position.set(_offPos.x, _offPos.y * ratio, _offPos.z)
      _pm.position.set(0, -newShoulderOffset, 0)
    }
  }

  return result
}

/**
 * Load a vehicle using registry GLB metadata, falling back to legacy paths.
 */
export async function loadVehicleModel(vehicle: VehicleDefinition, pilotType?: PilotType): Promise<LoadedModel> {
  const modelType = vehicle.modelType ?? 'wingsuit'
  const mainPath = resolveMainPath(vehicle, modelType)
  const pilotPath = resolvePilotPath(vehicle, pilotType)
  const useOverrides = modelType !== 'canopy'
  const mainScale = useOverrides
    ? resolveGlbScale(modelType === 'airplane'
      ? vehicle.equipment.find((component) => component.glb)?.glb
      : vehicle.pilot.glb)
    : undefined
  const pilotScale = useOverrides ? resolveGlbScale(vehicle.pilot.glb) : undefined
  const assembly = modelType === 'canopy' && pilotType
    ? resolveVehicleAssembly(vehicle, pilotType)
    : undefined
  return loadModel(modelType, pilotType, { mainPath, pilotPath, mainScale, pilotScale, assembly })
}

/**
 * Shift the model mesh so CG (not bbox center) sits at the scene origin.
 *
 * @param loadedModel   The loaded model to adjust
 * @param cgOffsetFraction  How far forward the CG is from the bbox center,
 *                          as a fraction of body length (from polar.cgOffsetFraction).
 *                          Positive = CG is forward of geometric center.
 */
export function applyCgOffset(loadedModel: LoadedModel, cgOffsetFraction: number): void {
  // Three.js Z = NED X (forward); shift model backward so CG sits at origin
  loadedModel.model.position.z -= cgOffsetFraction * loadedModel.bodyLength
}

/**
 * Shift the model so the mass-segment CG sits at the scene origin.
 *
 * For canopy systems, the CG is computed from mass segments (pilot body +
 * canopy cells) and doesn't coincide with the geometric center. This function
 * moves the entire model group so the thick force vectors (which originate
 * at the computed CG) emanate from the scene origin.
 *
 * CG centering works in three coordinated steps, all using the same offset:
 *
 *   1. **Model mesh** — this function shifts the 3D model and bridle so the
 *      computed CG sits at the scene origin (Three.js 0,0,0).
 *
 *   2. **Force vectors** — `updateForceVectors()` in vectors.ts receives
 *      `cgOffsetThree` (stored on LoadedModel) and subtracts it from every
 *      arrow position via the `shiftPos()` helper.
 *
 *   3. **Mass overlay** — `massOverlay.group.position` is set to
 *      `-cgOffsetThree` in main.ts so the point-mass spheres move with
 *      the model mesh.
 *
 * If mass segment positions are adjusted later, the CG recomputes
 * automatically and all three systems stay in sync.
 *
 * @param loadedModel  The loaded model to adjust
 * @param cgNED        CG position in NED meters from computeCenterOfMass()
 */
export function applyCgFromMassSegments(
  loadedModel: LoadedModel,
  cgNED: { x: number; y: number; z: number },
): void {
  // Capture base positions on first call so subsequent calls are absolute, not cumulative
  if (!loadedModel.baseModelPos) {
    loadedModel.baseModelPos = loadedModel.model.position.clone()
  }
  if (!loadedModel.baseBridlePos && loadedModel.bridleGroup) {
    loadedModel.baseBridlePos = loadedModel.bridleGroup.position.clone()
  }

  // NED→Three.js: three.x = -ned.y, three.y = -ned.z, three.z = ned.x
  // Scale by pilotScale to get model units
  const ps = loadedModel.pilotScale
  const cgThreeX = -cgNED.y * ps
  const cgThreeY = -cgNED.z * ps
  const cgThreeZ =  cgNED.x * ps

  // Step 1: Set model position = base - cgOffset (absolute, not incremental)
  const cgOffsetThree = new THREE.Vector3(cgThreeX, cgThreeY, cgThreeZ)
  loadedModel.model.position.set(
    loadedModel.baseModelPos.x - cgThreeX,
    loadedModel.baseModelPos.y - cgThreeY,
    loadedModel.baseModelPos.z - cgThreeZ,
  )

  // Also shift bridle group if present (it's a sibling of model in the group)
  if (loadedModel.bridleGroup && loadedModel.baseBridlePos) {
    loadedModel.bridleGroup.position.set(
      loadedModel.baseBridlePos.x - cgThreeX,
      loadedModel.baseBridlePos.y - cgThreeY,
      loadedModel.baseBridlePos.z - cgThreeZ,
    )
  }

  // Store offset for Steps 2 & 3 (vectors and mass overlay)
  loadedModel.cgOffsetThree = cgOffsetThree
}

/**
 * Apply a pre-computed attitude quaternion to the model group.
 *
 * Pass `null` for body frame (identity rotation).
 * Pass the body-to-inertial quaternion for inertial frame.
 *
 * The quaternion is computed upstream (main.ts) from either body Euler
 * angles or wind Euler angles + α/β, so this function doesn't need
 * to know which mode is active.
 */
/**
 * Rotate the bridle+PC pivot so it aligns with the relative wind direction.
 *
 * The combined bridalandpc.gltf model has the bridle extending along +Z
 * from the attachment point at origin. We rotate the pivot so the bridle
 * aligns with the wind direction in body frame.
 *
 * @param model  The loaded canopy model (must have bridleGroup)
 * @param alpha_deg  Angle of attack in degrees
 * @param beta_deg   Sideslip angle in degrees
 */
const _defaultBridleDir = new THREE.Vector3(0, 0, 1)
const _bridleQuat = new THREE.Quaternion()

export function updateBridleOrientation(model: LoadedModel, alpha_deg: number, beta_deg: number): void {
  if (!model.bridleGroup) return
  const windDir = windDirectionBody(alpha_deg, beta_deg)
  _bridleQuat.setFromUnitVectors(_defaultBridleDir, windDir)
  model.bridleGroup.quaternion.copy(_bridleQuat)
}

export function applyAttitude(
  group: THREE.Group,
  rotation: THREE.Quaternion | null
): void {
  if (!rotation) {
    group.quaternion.identity()
  } else {
    group.quaternion.copy(rotation)
  }
}

/**
 * Update wingsuit deployment visualization based on wsDeploy fraction [0, 1].
 *
 * Kinematic sequence (all objects travel aft along -Z in Three.js = +X in NED):
 *
 * | deploy   | PC                      | Bridle            | Snivel              | Lines              |
 * |----------|-------------------------|-------------------|---------------------|--------------------|
 * | 0.0      | hidden                  | hidden            | hidden              | hidden             |
 * | >0.0     | appears at container    | container → PC    | hidden              | hidden             |
 * | 0.0→0.5  | moves aft to bridle len | grows with PC     | hidden              | hidden             |
 * | 0.5      | at max bridle distance  | full length       | appears at container| shoulders → snivel |
 * | 0.5→1.0  | continues aft           | continues growing | moves aft           | grow with snivel   |
 * | 1.0      | at full line extension  | full              | at line-stretch     | full length        |
 *
 * @param model       The wingsuit loaded model with deployGroup
 * @param deploy      Deployment fraction [0, 1]
 * @param alpha_deg   AoA in degrees (for wind direction)
 * @param beta_deg    Sideslip in degrees
 */
export function updateWingsuitDeploy(
  model: LoadedModel,
  deploy: number,
  alpha_deg: number,
  beta_deg: number,
): void {
  const dg = model.deployGroup
  if (!dg) return

  // Nothing to show at deploy = 0
  if (deploy < 0.001) {
    dg.group.visible = false
    return
  }
  dg.group.visible = true

  // ── Reference positions in Three.js model coordinates ──
  // Three.js: +Z = forward (NED +X), -Z = aft (NED -X)
  // Container (mid-back) is slightly behind CG, at about -0.15 bodyLength in Z
  // Shoulders are slightly lateral (±X) and slightly forward (+Z)
  const bl = model.bodyLength
  const containerZ = -0.15 * bl   // mid-back, slightly aft of CG
  const containerY = 0.05 * bl    // slightly above center (back surface)
  const shoulderX = 0.20 * bl     // lateral offset for shoulders
  const shoulderZ = 0.10 * bl     // shoulders are slightly forward of CG

  // Maximum distances (in model units, scaled to body)
  const maxBridleLen = 0.8 * bl   // ~1.5m real bridle → 80% of body length
  const maxLineLen = 1.5 * bl     // ~2.8m real lines → 150% of body length

  // Wind direction in Three.js body coords (deployment hardware trails aft along wind)
  const windBody = windDirectionBody(alpha_deg, beta_deg)
  // windBody points where wind comes FROM in Three.js coords
  // Deployment objects trail downwind = opposite direction
  const trailDir = windBody.clone().negate()

  // ── PC position ──
  // deploy 0→0.5: PC moves from container to bridle-length distance
  // deploy 0.5→1.0: PC continues to max bridle + line distance
  const pcDist = deploy < 0.5
    ? (deploy / 0.5) * maxBridleLen
    : maxBridleLen + ((deploy - 0.5) / 0.5) * maxLineLen
  const pcPos = new THREE.Vector3(0, containerY, containerZ)
    .addScaledVector(trailDir, pcDist)
  dg.pc.position.copy(pcPos)
  dg.pc.visible = true

  // Orient PC to face the wind direction
  const pcLookTarget = pcPos.clone().add(windBody)
  dg.pc.lookAt(pcLookTarget)

  // ── Bridle line: container → PC ──
  const containerPos = new THREE.Vector3(0, containerY, containerZ)
  const bridleGeo = dg.bridleLine.geometry as THREE.BufferGeometry
  const bridlePositions = bridleGeo.getAttribute('position') as THREE.BufferAttribute
  bridlePositions.setXYZ(0, containerPos.x, containerPos.y, containerPos.z)
  bridlePositions.setXYZ(1, pcPos.x, pcPos.y, pcPos.z)
  bridlePositions.needsUpdate = true
  dg.bridleLine.visible = true

  // ── Snivel ──
  // Appears at deploy ≈ 0.5, moves aft from container to line-length distance
  if (deploy >= 0.45) {
    const snivelFrac = Math.min(1, (deploy - 0.45) / 0.55)  // 0 at 0.45, 1 at 1.0
    const snivelDist = snivelFrac * maxLineLen * 0.7  // snivel doesn't go as far as PC
    const snivelPos = new THREE.Vector3(0, containerY, containerZ)
      .addScaledVector(trailDir, snivelDist)
    dg.snivel.position.copy(snivelPos)
    dg.snivel.visible = true

    // Orient snivel to trail in wind
    const snivelLookTarget = snivelPos.clone().add(windBody)
    dg.snivel.lookAt(snivelLookTarget)

    // ── Lines: shoulders → snivel ──
    const shoulderL = new THREE.Vector3(-shoulderX, containerY, shoulderZ)
    const shoulderR = new THREE.Vector3(shoulderX, containerY, shoulderZ)

    const lineGeoL = dg.lineLeft.geometry as THREE.BufferGeometry
    const linePosL = lineGeoL.getAttribute('position') as THREE.BufferAttribute
    linePosL.setXYZ(0, shoulderL.x, shoulderL.y, shoulderL.z)
    linePosL.setXYZ(1, snivelPos.x, snivelPos.y, snivelPos.z)
    linePosL.needsUpdate = true
    dg.lineLeft.visible = true

    const lineGeoR = dg.lineRight.geometry as THREE.BufferGeometry
    const linePosR = lineGeoR.getAttribute('position') as THREE.BufferAttribute
    linePosR.setXYZ(0, shoulderR.x, shoulderR.y, shoulderR.z)
    linePosR.setXYZ(1, snivelPos.x, snivelPos.y, snivelPos.z)
    linePosR.needsUpdate = true
    dg.lineRight.visible = true
  } else {
    dg.snivel.visible = false
    dg.lineLeft.visible = false
    dg.lineRight.visible = false
  }
}
