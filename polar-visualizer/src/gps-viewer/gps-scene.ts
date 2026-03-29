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
import type { GPSPipelinePoint } from '../gps/types'
import type { OrientationEKF } from '../kalman/orientation-ekf'
import type { CanopyState } from './canopy-estimator'

const MODEL_PATH = '/models/tsimwingsuit.glb'
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
  private canvas: HTMLCanvasElement

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

    // Aero overlay (attached to scene root, not worldGroup — stays at vehicle)
    this.aeroOverlay = new GPSAeroOverlay(this.scene)
    this.canopyAeroOverlay = new GPSAeroOverlay(this.scene)

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
    } catch (e) {
      console.error('Failed to load wingsuit model:', e)
    }

    // Load canopy model
    try {
      const gltf = await loader.loadAsync(CANOPY_PATH)
      this.canopyModel = gltf.scene as THREE.Group
      this.canopyModel.scale.setScalar(1.39 * 0.7)
      this.canopyModel.visible = false
      this.scene.add(this.canopyModel)
    } catch (e) {
      console.error('Failed to load canopy model:', e)
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
    const canopyPhase = mode >= 5 && mode <= 7
    const cs = this.canopyStates[this.currentIndex]

    if (canopyPhase && cs && cs.valid) {
      // Under canopy: pilot hangs vertically
      const canopyQuat = bodyToInertialQuat(cs.phi, cs.theta, cs.psi)
      const hangPitch = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), -80 * Math.PI / 180
      )
      canopyQuat.multiply(hangPitch)
      this.model.quaternion.copy(canopyQuat)
    } else {
      // Wingsuit/freefall: SG pipeline angles
      this.model.quaternion.copy(bodyToInertialQuat(pt.aero.roll, pt.aero.theta, pt.aero.psi))
    }

    // ── Canopy model ──
    if (this.canopyModel) {
      if (cs && cs.valid && canopyPhase) {
        this.canopyModel.visible = true
        // Canopy at origin (same as vehicle — riser convergence)
        this.canopyModel.position.set(0, 0, 0)
        this.canopyModel.quaternion.copy(bodyToInertialQuat(cs.phi, cs.theta, cs.psi))
      } else {
        this.canopyModel.visible = false
      }
    }

    // ── Aero overlay ──
    // Pass origin (0,0,0) as position since vehicle is at origin
    const origin = new THREE.Vector3(0, 0, 0)
    if (!canopyPhase) {
      this.aeroOverlay.update(pt, origin)
      this.canopyAeroOverlay.hide()
    } else if (cs && cs.valid) {
      this.aeroOverlay.hide()
      this.canopyAeroOverlay.aeroOverrides = {
        aoa: cs.aoa,
        roll: cs.phi,
        theta: cs.theta,
        psi: cs.psi,
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
