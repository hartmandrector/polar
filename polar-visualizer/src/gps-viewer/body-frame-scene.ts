/**
 * GPS Flight Viewer — Body Frame Scene
 * 
 * Vehicle-at-origin, identity rotation.
 * World group rotated by inverse body quaternion so everything
 * appears in the vehicle's body frame.
 * Force vectors and moment arcs are naturally in body frame.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bodyToInertialQuat } from '../viewer/frames'
import { GPSAeroOverlay, type AeroOverlayConfig } from './gps-aero-overlay'
import { BodyRateAxisHelper, EulerAxisHelper } from './axis-helper'
import type { GPSPipelinePoint } from '../gps/types'
import type { OrientationEKF } from '../kalman/orientation-ekf'
import type { CanopyState } from './canopy-estimator'
import type { DeployReplayTimeline } from './deploy-replay'
import type { ExitEstimate } from './exit-detector'
import { HeadModelRenderer } from './head-renderer'
import type { HeadSensorPoint } from './head-sensor'
import type { CameraSensorPoint, CameraMountOffset } from './camera-sensor'

const MODEL_PATH = '/models/WSV8.glb'
const CANOPY_PATH = '/models/cp2.gltf'
const MODEL_SCALE = 1.875 / 3.55

export class BodyFrameScene {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private model: THREE.Group | null = null
  private canopyModel: THREE.Group | null = null
  private canopyStates: CanopyState[] = []
  private deployTimeline: DeployReplayTimeline | null = null
    private lastValidCanopyState: CanopyState | null = null
  private exitEstimate: ExitEstimate | null = null
  private canvas: HTMLCanvasElement
  private headRenderer: HeadModelRenderer | null = null

  // World group — rotated by inverse body quat
  private worldGroup: THREE.Group

  // Trail (child of worldGroup)
  private trail: THREE.Line | null = null
  private trailPositions: THREE.Vector3[] = []

  // Data
  private data: GPSPipelinePoint[] = []
  private currentIndex = 0

  // Aero overlay (in body frame — no rotation needed)
  private aeroOverlay: GPSAeroOverlay
  private canopyAeroOverlay: GPSAeroOverlay
  private bodyRateAxis: BodyRateAxisHelper
  private eulerAxis: EulerAxisHelper  // shown in "all" mode

  private ekf: OrientationEKF | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setClearColor(0x000000, 0)  // transparent for PNG export

    this.scene = new THREE.Scene()

    // World group — holds trail, gets inverse body rotation
    this.worldGroup = new THREE.Group()
    this.scene.add(this.worldGroup)

    // Lighting
    const ambient = new THREE.AmbientLight(0x404060, 1.5)
    this.scene.add(ambient)
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0)
    dirLight.position.set(5, 10, 5)
    this.scene.add(dirLight)
    const fillLight = new THREE.DirectionalLight(0x4060ff, 0.5)
    fillLight.position.set(-3, -2, -5)
    this.scene.add(fillLight)

    // Camera — start from the side for body frame inspection
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50000)
    this.camera.position.set(8, 3, 0)

    // OrbitControls around origin
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.1
    this.controls.target.set(0, 0, 0)

    // Log camera state after user stops dragging (for playwright capture presets)
    this.controls.addEventListener('end', () => {
      const p = this.camera.position
      console.log(`[Body Camera] position: [${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}], zoom: ${this.camera.zoom.toFixed(2)}`)
    })

    // Aero overlay (body frame — vectors stay in native frame)
    this.aeroOverlay = new GPSAeroOverlay(this.scene)
    this.aeroOverlay.bodyFrame = true
    this.canopyAeroOverlay = new GPSAeroOverlay(this.scene)
    this.canopyAeroOverlay.bodyFrame = true
    this.canopyAeroOverlay.canopyMode = true

    // Body rate axis helper (p/q/r + gravity)
    this.bodyRateAxis = new BodyRateAxisHelper()
    this.scene.add(this.bodyRateAxis.group)

    // Euler axis helper (φ/θ/ψ) — hidden by default, shown in "all" mode
    this.eulerAxis = new EulerAxisHelper()
    this.eulerAxis.group.visible = false
    this.scene.add(this.eulerAxis.group)

    this.handleResize()
    window.addEventListener('resize', () => this.handleResize())

    this.loadModel()
    this.animate()
  }

  private async loadModel() {
    const loader = new GLTFLoader()
    try {
      const gltf = await loader.loadAsync(MODEL_PATH)
      this.model = gltf.scene as THREE.Group
      this.model.scale.setScalar(MODEL_SCALE)
      this.model.position.set(0, 0, 0)
      this.scene.add(this.model)
      this.headRenderer = new HeadModelRenderer(this.scene)
      if (this.pendingSensorData) {
        this.headRenderer.setSensorData(this.pendingSensorData.data)
        this.headRenderer.setTimeOffset(this.pendingSensorData.offset)
        this.pendingSensorData = null
      }
      if (this.pendingCameraData) {
        this.headRenderer.setCameraData(this.pendingCameraData)
        this.pendingCameraData = null
      }
    } catch (e) {
      console.error('Failed to load wingsuit model:', e)
    }

    try {
      const gltf = await loader.loadAsync(CANOPY_PATH)
      this.canopyModel = gltf.scene as THREE.Group
      this.canopyModel.scale.setScalar(1.39 * 0.66)
      this.canopyModel.visible = false
      // Make canopy semi-transparent so aero vectors show through
      this.canopyModel.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          const mat = mesh.material as THREE.Material
          if (mat) {
            mat.transparent = true
            mat.opacity = 0.65
            mat.depthWrite = false
          }
        }
      })
      this.scene.add(this.canopyModel)
    } catch (e) {
      console.error('Failed to load canopy model:', e)
    }
  }

  setAeroConfig(config: AeroOverlayConfig) {
    this.aeroOverlay.setConfig(config)
  }

  setCanopyAeroConfig(config: AeroOverlayConfig) {
    this.canopyAeroOverlay.setConfig(config)
  }

  /** Set axis helper visibility mode: 'none' | 'frame' | 'all' */
  setAxisMode(mode: 'none' | 'frame' | 'all') {
    this.bodyRateAxis.group.visible = mode === 'frame' || mode === 'all'
    this.eulerAxis.group.visible = mode === 'all'
  }

  setData(points: GPSPipelinePoint[]) {
    this.data = points
    this.currentIndex = 0
    this.buildTrail()

    if (points.length > 0) {
      this.camera.position.set(8, 3, 0)
      this.controls.update()
    }
  }

  setEKF(ekf: OrientationEKF) {
    this.ekf = ekf
  }

  setCanopyStates(states: CanopyState[]) {
    this.canopyStates = states
  }

  setDeployTimeline(timeline: DeployReplayTimeline) {
    this.deployTimeline = timeline

  }

  setExitEstimate(est: ExitEstimate | null) {
    this.exitEstimate = est
  }

  private pendingSensorData: { data: HeadSensorPoint[]; offset: number } | null = null

  setHeadSensorData(data: HeadSensorPoint[], timeOffset = 0) {
    if (this.headRenderer) {
      this.headRenderer.setSensorData(data)
      this.headRenderer.setTimeOffset(timeOffset)
    } else {
      this.pendingSensorData = { data, offset: timeOffset }
    }
  }

  private pendingCameraData: CameraSensorPoint[] | null = null

  setCameraData(data: CameraSensorPoint[]) {
    if (this.headRenderer) {
      this.headRenderer.setCameraData(data)
    } else {
      this.pendingCameraData = data
    }
  }

  setCameraMountOffset(offset: CameraMountOffset) {
    this.headRenderer?.setCameraMountOffset(offset)
  }

  private nedToScene(p: GPSPipelinePoint): THREE.Vector3 {
    return new THREE.Vector3(
      -p.processed.posE,
      -p.processed.posD,
      p.processed.posN,
    )
  }

  private buildTrail() {
    if (this.trail) {
      this.worldGroup.remove(this.trail)
      this.trail.geometry.dispose()
    }

    if (this.data.length < 2) return

    this.trailPositions = this.data.map(p => this.nedToScene(p))

    const geometry = new THREE.BufferGeometry().setFromPoints(this.trailPositions)
    const material = new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.3, transparent: true })
    this.trail = new THREE.Line(geometry, material)
    this.worldGroup.add(this.trail)
  }

  setIndex(index: number, fraction = 0) {
    this.currentIndex = Math.max(0, Math.min(index, this.data.length - 1))

    if (!this.model || this.data.length === 0) return

    const pt = this.data[this.currentIndex]

    // Vehicle scene position (absolute)
    const vehicleScenePos = this.nedToScene(pt)
    if (fraction > 0 && this.currentIndex < this.data.length - 1) {
      const next = this.nedToScene(this.data[this.currentIndex + 1])
      vehicleScenePos.lerp(next, fraction)
    }

    // ── Body frame: vehicle at origin with identity rotation ──
    // World group: translate + rotate by inverse body quat
    this.worldGroup.position.copy(vehicleScenePos.clone().negate())

    const mode = pt.flightMode?.mode ?? 0
    const canopyPhase = mode >= 5 && mode <= 7
    const cs = this.canopyStates[this.currentIndex]

    // Deploy timeline awareness
    const drp = this.deployTimeline?.points[this.currentIndex]
    const isPreLineStretch = drp && (drp.subPhase === 'pc_toss' || drp.subPhase === 'bridle_stretch')
    const isPostLineStretch = drp && drp.subPhase !== 'pre_deploy' && !isPreLineStretch
    const isFullFlight = drp?.subPhase === 'full_flight'
    const isDeploying = drp && drp.subPhase !== 'pre_deploy' && drp.subPhase !== 'full_flight'
    const isLanding = mode === 7

    // Use current canopy state, or fall back to last valid when estimator loses lock
    const effectiveCs = (cs && cs.valid) ? cs
      : ((isLanding || canopyPhase) && this.lastValidCanopyState) ? this.lastValidCanopyState
      : null
    if (cs && cs.valid) this.lastValidCanopyState = cs

    // Get the body-to-inertial quaternion
    // Pre-line-stretch: use wingsuit angles even if flight mode says canopy
    let bodyQuat: THREE.Quaternion
    const isGround = mode === 1
    if (this.exitEstimate && this.currentIndex >= this.exitEstimate.pushOffIndex && this.currentIndex <= this.exitEstimate.flyingIndex) {
      // Exit transition: lerp from standing to flying pose (overrides ground mode)
      // Standing: roll=0, pitch=90°, heading from flyingIndex (stable)
      const ex = this.exitEstimate
      const range = ex.flyingIndex - ex.pushOffIndex
      const t = range > 0 ? (this.currentIndex - ex.pushOffIndex) / range : 1
      const s = t * t * (3 - 2 * t) // smoothstep

      const flyPt = this.data![Math.min(ex.flyingIndex, this.data!.length - 1)]
      const flyingHeading = flyPt.aero.psi
      const standingQuat = bodyToInertialQuat(0, Math.PI / 2, flyingHeading)
      const flyingQuat = bodyToInertialQuat(flyPt.aero.roll, flyPt.aero.theta, flyingHeading)
      standingQuat.slerp(flyingQuat, s)
      bodyQuat = standingQuat
    } else if (isGround) {
      // Ground mode: stand upright, heading from flying index (stable)
      const groundHeading = this.exitEstimate
        ? this.data![Math.min(this.exitEstimate.flyingIndex, this.data!.length - 1)].aero.psi
        : pt.aero.psi
      bodyQuat = bodyToInertialQuat(0, Math.PI / 2, groundHeading)
    } else if (isPreLineStretch) {
      // Blend roll toward zero by line stretch
      let roll = pt.aero.roll
      if (drp) {
        const pcIdx = this.deployTimeline!.timing.pcTossIndex ?? this.currentIndex
        const lsIdx = this.deployTimeline!.timing.lineStretchIndex ?? this.currentIndex
        const range = lsIdx - pcIdx
        const t = range > 0 ? Math.max(0, Math.min(1, (this.currentIndex - pcIdx) / range)) : 0
        roll = roll * (1 - t)  // lerp toward zero
      }
      bodyQuat = bodyToInertialQuat(roll, pt.aero.theta, pt.aero.psi)
    } else if ((isPostLineStretch || (canopyPhase && !this.deployTimeline)) && effectiveCs) {
      bodyQuat = bodyToInertialQuat(effectiveCs.phi, effectiveCs.theta, effectiveCs.psi)
    } else {
      bodyQuat = bodyToInertialQuat(pt.aero.roll, pt.aero.theta, pt.aero.psi)
    }

    // Body frame: rotate world by INVERSE body quat
    // This makes the world rotate around the stationary vehicle
    const inverseBodyQuat = bodyQuat.clone().invert()
    this.worldGroup.quaternion.copy(inverseBodyQuat)

    // Update gravity indicator in body frame
    this.bodyRateAxis.updateGravity(inverseBodyQuat)

    // Update euler axes in body scene (for "all" mode)
    // φθψ are inertial-fixed, so they rotate with the world = inverse body quat
    if (this.eulerAxis.group.visible) {
      this.eulerAxis.group.quaternion.copy(inverseBodyQuat)
    }

    // Also need to rotate the translation by the inverse quat
    // so position offset is in body frame coordinates
    const translatedPos = vehicleScenePos.clone().negate()
    translatedPos.applyQuaternion(inverseBodyQuat)
    this.worldGroup.position.copy(translatedPos)

    // Vehicle at origin, identity rotation (or hang pitch under canopy — but not pre-line-stretch)
    this.model.position.set(0, 0, 0)
    if ((isPostLineStretch || (canopyPhase && !this.deployTimeline && !isPreLineStretch)) || isFullFlight) {
      // Pilot hangs ~80° pitched up under canopy
      const hangPitch = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), -80 * Math.PI / 180
      )
      this.model.quaternion.copy(hangPitch)
    } else {
      this.model.quaternion.identity()
    }

    // Head model — use bodyQuat for relative rotation computation
    if (this.headRenderer) {
      this.headRenderer.update(pt.processed.t, this.model.position, this.model.quaternion, MODEL_SCALE, bodyQuat)
    }

    // Canopy in body frame — deploy-aware
    const BASE_CANOPY_SCALE_BF = 1.39 * 0.66  // body frame uses slightly different base scale
    if (this.canopyModel) {
      if (isDeploying) {
        // During deployment: only show canopy from line_stretch onward, horizontal scale
        if (isPostLineStretch && !isPreLineStretch && drp!.deployFraction > 0.05 && effectiveCs) {
          this.canopyModel.visible = true
          const h = 0.3 + drp!.deployFraction * 0.7
          this.canopyModel.scale.set(BASE_CANOPY_SCALE_BF * h, BASE_CANOPY_SCALE_BF, BASE_CANOPY_SCALE_BF * h)
          this.canopyModel.position.set(0, 0, 0)
          const canopyInertialQuat = bodyToInertialQuat(effectiveCs.phi, effectiveCs.theta, effectiveCs.psi)
          const canopyRelBody = inverseBodyQuat.clone().multiply(canopyInertialQuat)
          this.canopyModel.quaternion.copy(canopyRelBody)
        } else {
          this.canopyModel.visible = false
        }
      } else if (effectiveCs && (isFullFlight || isLanding || (canopyPhase && !this.deployTimeline))) {
        this.canopyModel.visible = true
        this.canopyModel.scale.set(BASE_CANOPY_SCALE_BF, BASE_CANOPY_SCALE_BF, BASE_CANOPY_SCALE_BF)
        this.canopyModel.position.set(0, 0, 0)
        const canopyInertialQuat = bodyToInertialQuat(effectiveCs.phi, effectiveCs.theta, effectiveCs.psi)
        const canopyRelBody = inverseBodyQuat.clone().multiply(canopyInertialQuat)
        this.canopyModel.quaternion.copy(canopyRelBody)
      } else {
        this.canopyModel.visible = false
      }
    }

    // Aero overlay at origin (body frame — vectors are native)
    // Pre-line-stretch: show wingsuit aero even if flight mode says canopy
    const showCanopyAero = (isPostLineStretch || (canopyPhase && !this.deployTimeline)) && !isPreLineStretch
    const origin = new THREE.Vector3(0, 0, 0)
    if (!showCanopyAero) {
      this.aeroOverlay.update(pt, origin)
      this.canopyAeroOverlay.hide()
    } else if (effectiveCs) {
      this.aeroOverlay.hide()
      this.canopyAeroOverlay.deployFraction = (isDeploying && drp) ? drp.deployFraction : 1.0
      this.canopyAeroOverlay.aeroOverrides = {
        aoa: effectiveCs.aoa,
        roll: effectiveCs.phi,
        theta: effectiveCs.theta,
        psi: effectiveCs.psi,
      }
      this.canopyAeroOverlay.update(pt, origin)
    } else {
      this.aeroOverlay.hide()
      this.canopyAeroOverlay.hide()
    }
  }

  private handleResize() {
    const parent = this.canvas.parentElement
    if (!parent) return
    const w = parent.clientWidth
    const h = parent.clientHeight
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private animate = () => {
    requestAnimationFrame(this.animate)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  // ── Camera accessors for keyframe system ──

  getCameraPosition(): THREE.Vector3 { return this.camera.position.clone() }
  getCameraZoom(): number { return this.camera.zoom }

  setCameraState(position: THREE.Vector3, zoom: number) {
    this.controls.enableDamping = false
    this.camera.position.copy(position)
    this.camera.zoom = zoom
    this.camera.updateProjectionMatrix()
    this.controls.update()
    this.controls.enableDamping = true
  }

  releaseKeyframeOverride() { /* no-op */ }

  setControlSolverEnabled(enabled: boolean) {
    this.aeroOverlay.enableControlSolver = enabled
    this.canopyAeroOverlay.enableControlSolver = enabled
  }

  setCanopyConstraint(constraint: import('./control-solver').CanopyControlConstraint) {
    this.canopyAeroOverlay.canopyConstraint = constraint
  }
}
