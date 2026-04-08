/**
 * GPS Flight Viewer — 3D Scene
 * 
 * Vehicle-at-origin architecture:
 *   - Vehicle model always at (0,0,0)
 *   - World group (trail, etc.) translated so vehicle appears stationary
 *   - OrbitControls around origin for free camera inspection
 *   - Inertial frame: vehicle rotated by body-to-inertial quat
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bodyToInertialQuat } from '../viewer/frames'
import { GPSAeroOverlay, type AeroOverlayConfig } from './gps-aero-overlay'
import { EulerAxisHelper } from './axis-helper'
import type { GPSPipelinePoint } from '../gps/types'
import type { OrientationEKF } from '../kalman/orientation-ekf'
import type { CanopyState } from './canopy-estimator'
import type { DeployReplayTimeline } from './deploy-replay'
import type { ExitEstimate } from './exit-detector'
import { HeadModelRenderer } from './head-renderer'
import type { HeadSensorPoint } from './head-sensor'
import { GPSDeployRenderer } from './gps-deploy-renderer'

const MODEL_PATH = '/models/WSV8.glb'
const CANOPY_PATH = '/models/cp2.gltf'
// GLB model is 3.55 units tall, pilot is 1.875m → scale to real meters
const MODEL_SCALE = 1.875 / 3.55  // ≈ 0.528

export class GPSScene {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private model: THREE.Group | null = null
  private canopyModel: THREE.Group | null = null
  private canopyStates: CanopyState[] = []
  private deployTimeline: DeployReplayTimeline | null = null
    /** Last valid canopy state — used during landing when airspeed drops below estimator threshold */
  private lastValidCanopyState: CanopyState | null = null
  private exitEstimate: ExitEstimate | null = null
  private deployRenderer: GPSDeployRenderer | null = null
  private canvas: HTMLCanvasElement
  private headRenderer: HeadModelRenderer | null = null

  // World group — everything that moves relative to the vehicle
  private worldGroup: THREE.Group

  // Trail (child of worldGroup)
  private trail: THREE.Line | null = null
  private trailPositions: THREE.Vector3[] = []

  // Data
  private data: GPSPipelinePoint[] = []
  private currentIndex = 0

  // Aero overlay
  private aeroOverlay: GPSAeroOverlay
  private canopyAeroOverlay: GPSAeroOverlay
  private eulerAxis: EulerAxisHelper

  /** Exposed for external moment inset to read */
  get lastOverlayState() {
    return {
      moments: this.aeroOverlay.lastMoments,
      controls: this.aeroOverlay.lastControls,
      converged: this.aeroOverlay.lastConverged,
      canopyMoments: this.canopyAeroOverlay.lastMoments,
      canopyControls: this.canopyAeroOverlay.lastControls,
      canopyConverged: this.canopyAeroOverlay.lastConverged,
    }
  }

  // Orientation EKF (optional)
  private ekf: OrientationEKF | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setClearColor(0x000000, 0)  // transparent for PNG export

    // Scene
    this.scene = new THREE.Scene()

    // World group — holds trail and any world-frame objects
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

    // Camera — starts behind and above
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50000)
    this.camera.position.set(0, 5, -12)

    // OrbitControls around origin (where vehicle always is)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.1
    this.controls.target.set(0, 0, 0)

    // Log camera state after user stops dragging (for playwright capture presets)
    this.controls.addEventListener('end', () => {
      const p = this.camera.position
      console.log(`[Inertial Camera] position: [${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}], zoom: ${this.camera.zoom.toFixed(2)}`)
    })

    // Aero overlay (attached to scene root, not worldGroup — stays at vehicle)
    this.aeroOverlay = new GPSAeroOverlay(this.scene)
    this.canopyAeroOverlay = new GPSAeroOverlay(this.scene)

    // Euler angle axis helper (φ/θ/ψ)
    this.eulerAxis = new EulerAxisHelper()
    this.scene.add(this.eulerAxis.group)

    // Resize handling
    this.handleResize()
    window.addEventListener('resize', () => this.handleResize())

    // Load models
    this.loadModel()

    // Render loop
    this.animate()
  }

  private async loadModel() {
    const loader = new GLTFLoader()
    try {
      const gltf = await loader.loadAsync(MODEL_PATH)
      this.model = gltf.scene as THREE.Group
      this.model.scale.setScalar(MODEL_SCALE)
      // Model at origin (always)
      this.model.position.set(0, 0, 0)
      this.scene.add(this.model)
      // Create head renderer (attached to wingsuit model)
      this.headRenderer = new HeadModelRenderer(this.model)
    } catch (e) {
      console.error('Failed to load wingsuit model:', e)
    }

    // Load canopy model
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
            mat.depthWrite = false  // prevents z-fighting with vectors behind
          }
        }
      })
      this.scene.add(this.canopyModel)
    } catch (e) {
      console.error('Failed to load canopy model:', e)
    }

    // Create deploy renderer (bodyLength in scene units ≈ MODEL_SCALE * 3.55 = 1.875)
    this.deployRenderer = new GPSDeployRenderer(this.scene, MODEL_SCALE * 3.55)
    if (this.deployTimeline) {
      this.deployRenderer.setTimeline(this.deployTimeline)
    }
  }

  /** Set the aero model config for force vector overlay */
  setAeroConfig(config: AeroOverlayConfig) {
    this.aeroOverlay.setConfig(config)
  }

  /** Set the canopy aero model config */
  setCanopyAeroConfig(config: AeroOverlayConfig) {
    this.canopyAeroOverlay.setConfig(config)
  }

  setData(points: GPSPipelinePoint[]) {
    this.data = points
    this.currentIndex = 0
    this.buildTrail()

    // Set initial camera position behind the flight direction
    if (points.length > 0) {
      this.camera.position.set(0, 5, -12)
      this.controls.update()
    }
  }

  /** Set orientation EKF for physics-based rotation interpolation */
  setEKF(ekf: OrientationEKF) {
    this.ekf = ekf
  }

  /** Set canopy state estimates (aligned 1:1 with data points) */
  setCanopyStates(states: CanopyState[]) {
    this.canopyStates = states
  }

  setDeployTimeline(timeline: DeployReplayTimeline) {
    this.deployTimeline = timeline
    if (this.deployRenderer) this.deployRenderer.setTimeline(timeline)

  }

  setExitEstimate(est: ExitEstimate | null) {
    this.exitEstimate = est
  }

  setHeadSensorData(data: HeadSensorPoint[], timeOffset = 0) {
    if (this.headRenderer) {
      this.headRenderer.setSensorData(data)
      this.headRenderer.setTimeOffset(timeOffset)
    }
  }

  /** Convert NED point to Three.js scene coordinates */
  private nedToScene(p: GPSPipelinePoint): THREE.Vector3 {
    return new THREE.Vector3(
      -p.processed.posE,
      -p.processed.posD,
      p.processed.posN,
    )
  }

  private buildTrail() {
    // Remove old trail
    if (this.trail) {
      this.worldGroup.remove(this.trail)
      this.trail.geometry.dispose()
    }

    if (this.data.length < 2) return

    // Trail in absolute scene coordinates (worldGroup translation handles centering)
    this.trailPositions = this.data.map(p => this.nedToScene(p))

    const geometry = new THREE.BufferGeometry().setFromPoints(this.trailPositions)
    const material = new THREE.LineBasicMaterial({ color: 0x3060a0, opacity: 0.4, transparent: true })
    this.trail = new THREE.Line(geometry, material)
    this.worldGroup.add(this.trail)
  }

  setIndex(index: number, fraction = 0) {
    this.currentIndex = Math.max(0, Math.min(index, this.data.length - 1))

    if (!this.model || this.data.length === 0) return

    const pt = this.data[this.currentIndex]

    // Vehicle scene position (absolute)
    const vehicleScenePos = this.nedToScene(pt)

    // Interpolate between current and next for smooth 60fps
    if (fraction > 0 && this.currentIndex < this.data.length - 1) {
      const next = this.nedToScene(this.data[this.currentIndex + 1])
      vehicleScenePos.lerp(next, fraction)
    }

    // ── Vehicle-at-origin: translate world group so vehicle appears at (0,0,0) ──
    this.worldGroup.position.copy(vehicleScenePos.clone().negate())

    // Model stays at origin
    this.model.position.set(0, 0, 0)

    // ── Orientation ──
    const mode = pt.flightMode?.mode ?? 0
    const isGround = mode === 1  // FlightMode.GROUND
    const canopyPhase = mode >= 5 && mode <= 7
    const cs = this.canopyStates[this.currentIndex]
    const hasSensor = this.headRenderer?.hasSensorData ?? false

    // Deploy timeline: use sub-phase to determine rendering mode
    const drp = this.deployTimeline?.points[this.currentIndex]
    const isPreLineStretch = drp && (drp.subPhase === 'pc_toss' || drp.subPhase === 'bridle_stretch')
    const isPostLineStretch = drp && drp.subPhase !== 'pre_deploy' && !isPreLineStretch
    const isFullFlight = drp?.subPhase === 'full_flight'
    const isDeploying = drp && drp.subPhase !== 'pre_deploy'
    const isLanding = mode === 7

    // Use current canopy state, or fall back to last valid when estimator loses lock
    const effectiveCs = (cs && cs.valid) ? cs
      : ((isLanding || canopyPhase) && this.lastValidCanopyState) ? this.lastValidCanopyState
      : null
    if (cs && cs.valid) this.lastValidCanopyState = cs

    if (this.exitEstimate && this.currentIndex >= this.exitEstimate.pushOffIndex && this.currentIndex <= this.exitEstimate.flyingIndex) {
      // Exit transition: lerp from standing to flying pose (overrides ground mode)
      const ex = this.exitEstimate
      const range = ex.flyingIndex - ex.pushOffIndex
      const t = range > 0 ? (this.currentIndex - ex.pushOffIndex) / range : 1
      const standingQuat = bodyToInertialQuat(0, Math.PI / 2, pt.aero.psi)
      const flyingQuat = bodyToInertialQuat(pt.aero.roll, pt.aero.theta, pt.aero.psi)
      standingQuat.slerp(flyingQuat, t)
      this.model.quaternion.copy(standingQuat)
    } else if (isGround && hasSensor) {
      // Ground mode with sensor data: stand upright, heading from head sensor
      const heading = this.headRenderer!.getHeadingAtTime(pt.processed.t)
      const standingPitch = Math.PI / 2  // 90° nose-up = standing on feet
      this.model.quaternion.copy(bodyToInertialQuat(0, standingPitch, (heading ?? 0) + Math.PI))
    } else if (isGround) {
      // Ground mode without sensor: stand upright, heading from GPS track
      const standingPitch = Math.PI / 2
      this.model.quaternion.copy(bodyToInertialQuat(0, standingPitch, pt.aero.psi))
    } else if (isPreLineStretch) {
      // Pre-line-stretch: blend roll toward zero by line stretch
      let roll = pt.aero.roll
      if (drp) {
        const pcIdx = this.deployTimeline!.timing.pcTossIndex ?? this.currentIndex
        const lsIdx = this.deployTimeline!.timing.lineStretchIndex ?? this.currentIndex
        const range = lsIdx - pcIdx
        const t = range > 0 ? Math.max(0, Math.min(1, (this.currentIndex - pcIdx) / range)) : 0
        roll = roll * (1 - t)  // lerp toward zero
      }
      this.model.quaternion.copy(bodyToInertialQuat(roll, pt.aero.theta, pt.aero.psi))
    } else if ((isPostLineStretch || (canopyPhase && !this.deployTimeline)) && effectiveCs) {
      // Post-line-stretch or canopy/landing phase: pilot hangs
      const canopyQuat = bodyToInertialQuat(effectiveCs.phi, effectiveCs.theta, effectiveCs.psi)
      const hangPitch = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), -80 * Math.PI / 180
      )
      canopyQuat.multiply(hangPitch)
      this.model.quaternion.copy(canopyQuat)
    } else {
      // Wingsuit/freefall: SG pipeline angles
      this.model.quaternion.copy(bodyToInertialQuat(pt.aero.roll, pt.aero.theta, pt.aero.psi))
    }

    // ── Head model (only when sensor data loaded) ──
    if (this.headRenderer && hasSensor) {
      this.headRenderer.update(pt.processed.t, this.model.quaternion)
    }

    // ── Canopy model + deploy rendering ──
    const BASE_CANOPY_SCALE = 1.39 * 0.66

    if (isGround) {
      // Ground mode: hide all canopy/deploy visuals
      if (this.deployRenderer) this.deployRenderer.hide()
      if (this.canopyModel) this.canopyModel.visible = false
    } else if (this.deployRenderer && isDeploying) {
      // During deployment: deploy renderer controls bridle/PC visuals
      // Pre-line-stretch: use pilot (wingsuit) model quaternion
      // Post-line-stretch: use canopy orientation (PC trails from canopy)
      let deployQuat: THREE.Quaternion
      if (isPostLineStretch && effectiveCs) {
        deployQuat = bodyToInertialQuat(effectiveCs.phi, effectiveCs.theta, effectiveCs.psi)
      } else {
        deployQuat = this.model?.quaternion?.clone() ?? new THREE.Quaternion()
      }
      this.deployRenderer.update(this.currentIndex, pt, deployQuat, this.canopyModel)
      // Canopy GLB: only show from line_stretch onward, scale horizontally only
      if (this.canopyModel) {
        if (isPostLineStretch && !isPreLineStretch && drp!.deployFraction > 0.05) {
          this.canopyModel.visible = true
          const h = 0.3 + drp!.deployFraction * 0.7  // horizontal scale factor
          this.canopyModel.scale.set(BASE_CANOPY_SCALE * h, BASE_CANOPY_SCALE, BASE_CANOPY_SCALE * h)
          this.canopyModel.position.set(0, 0, 0)
          if (effectiveCs) {
            this.canopyModel.quaternion.copy(bodyToInertialQuat(effectiveCs.phi, effectiveCs.theta, effectiveCs.psi))
          }
        } else {
          this.canopyModel.visible = false
        }
      }
    } else {
      // Not deploying — hide deploy renderer, normal canopy logic
      if (this.deployRenderer) this.deployRenderer.hide()
      if (this.canopyModel) {
        if (effectiveCs && (isFullFlight || isLanding || (canopyPhase && !this.deployTimeline))) {
          this.canopyModel.visible = true
          this.canopyModel.scale.set(BASE_CANOPY_SCALE, BASE_CANOPY_SCALE, BASE_CANOPY_SCALE)
          this.canopyModel.position.set(0, 0, 0)
          this.canopyModel.quaternion.copy(bodyToInertialQuat(effectiveCs.phi, effectiveCs.theta, effectiveCs.psi))
        } else {
          this.canopyModel.visible = false
        }
      }
    }

    // ── Aero overlay ──
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
}
