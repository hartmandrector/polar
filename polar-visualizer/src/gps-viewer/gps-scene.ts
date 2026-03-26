/**
 * GPS Flight Viewer — 3D Scene
 * 
 * Simplified Three.js scene for GPS replay.
 * Loads the wingsuit model and applies orientation from pipeline data.
 * Camera follows the model with orbit controls + follow tightness slider.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bodyToInertialQuat } from '../viewer/frames'
import { GPSAeroOverlay, type AeroOverlayConfig } from './gps-aero-overlay'
import { MomentInset } from './moment-inset'
import type { GPSPipelinePoint } from '../gps/types'
import type { OrientationEKF } from '../kalman/orientation-ekf'
import type { CanopyState } from './canopy-estimator'

const MODEL_PATH = '/models/tsimwingsuit.glb'
const CANOPY_PATH = '/models/cp2.gltf'
// GLB model is 3.55 units tall, pilot is 1.875m → scale to real meters
const MODEL_SCALE = 1.875 / 3.55  // ≈ 0.528

/** Follow distance range (meters) — lerps from far (loose) to near (tight) */
const FOLLOW_DIST_FAR = 15
const FOLLOW_DIST_NEAR = 7
/** Follow height range (meters) */
const FOLLOW_HEIGHT_FAR = 5
const FOLLOW_HEIGHT_NEAR = 2.5

export class GPSScene {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private model: THREE.Group | null = null
  private canopyModel: THREE.Group | null = null
  private canopyStates: CanopyState[] = []
  private canvas: HTMLCanvasElement

  // Trail
  private trail: THREE.Line | null = null
  private trailPositions: THREE.Vector3[] = []

  // Data
  private data: GPSPipelinePoint[] = []
  private currentIndex = 0

  // Camera follow
  /** 0 = static camera, 1 = tight follow */
  private followTightness = 0.3
  private prevModelPos = new THREE.Vector3()
  private flightDir = new THREE.Vector3(0, 0, 1)

  // Aero overlay
  private aeroOverlay: GPSAeroOverlay
  private canopyAeroOverlay: GPSAeroOverlay
  private momentInset: MomentInset

  // Orientation EKF (optional — when set, drives model orientation via predictAt)
  private ekf: OrientationEKF | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setClearColor(0x0a0a1a)

    // Scene
    this.scene = new THREE.Scene()

    // Lighting
    const ambient = new THREE.AmbientLight(0x404060, 1.5)
    this.scene.add(ambient)
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0)
    dirLight.position.set(5, 10, 5)
    this.scene.add(dirLight)
    const fillLight = new THREE.DirectionalLight(0x4060ff, 0.5)
    fillLight.position.set(-3, -2, -5)
    this.scene.add(fillLight)

    // Camera
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50000)
    this.camera.position.set(0, 20, -50)

    // Controls
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.1
    this.controls.target.set(0, 0, 0)

    // Grid (ground reference)
    const grid = new THREE.GridHelper(2000, 200, 0x1a3060, 0x0f2040)  // 2km, 10m squares
    this.scene.add(grid)

    // Axes helper
    const axes = new THREE.AxesHelper(2)
    this.scene.add(axes)

    // Aero overlay
    this.aeroOverlay = new GPSAeroOverlay(this.scene)
    this.canopyAeroOverlay = new GPSAeroOverlay(this.scene)

    // Moment breakdown inset (bottom-left of scene panel)
    const scenePanel = canvas.parentElement!
    this.momentInset = new MomentInset(scenePanel)

    // Start resize handling
    this.handleResize()
    window.addEventListener('resize', () => this.handleResize())

    // Load model
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
      this.scene.add(this.model)
    } catch (e) {
      console.error('Failed to load wingsuit model:', e)
    }

    // Load canopy model
    try {
      const gltf = await loader.loadAsync(CANOPY_PATH)
      this.canopyModel = gltf.scene as THREE.Group
      // cp2.gltf: maxDim 6.266 GLB units, real canopy span ~10m
      // Scale so 1 GLB unit ≈ real meters. Canopy span = 6.266 * scale
      // Ibex UL span ≈ 8.7m → scale = 8.7 / 6.266 ≈ 1.39
      this.canopyModel.scale.setScalar(1.39)
      this.canopyModel.visible = false
      this.scene.add(this.canopyModel)
    } catch (e) {
      console.error('Failed to load canopy model:', e)
    }
  }

  /** Set follow tightness: 0 = static camera, 1 = tight follow */
  setFollowTightness(value: number) {
    this.followTightness = Math.max(0, Math.min(1, value))
  }

  /** Set the aero model config for force vector overlay */
  setAeroConfig(config: AeroOverlayConfig) {
    this.aeroOverlay.setConfig(config)
  }

  /** Set the canopy aero model config for canopy force vector overlay */
  setCanopyAeroConfig(config: AeroOverlayConfig) {
    this.canopyAeroOverlay.setConfig(config)
  }

  setData(points: GPSPipelinePoint[]) {
    this.data = points
    this.currentIndex = 0

    // Build trail geometry from NED positions → Three.js
    this.buildTrail()
  }

  /** Set orientation EKF for physics-based rotation interpolation */
  setEKF(ekf: OrientationEKF) {
    this.ekf = ekf
  }

  /** Set canopy state estimates (aligned 1:1 with data points) */
  setCanopyStates(states: CanopyState[]) {
    this.canopyStates = states
  }

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
      this.scene.remove(this.trail)
      this.trail.geometry.dispose()
    }

    if (this.data.length < 2) return

    this.trailPositions = this.data.map(p => this.nedToScene(p))

    const geometry = new THREE.BufferGeometry().setFromPoints(this.trailPositions)
    const material = new THREE.LineBasicMaterial({ color: 0x3060a0, opacity: 0.4, transparent: true })
    this.trail = new THREE.Line(geometry, material)
    this.scene.add(this.trail)

    // Center camera on start of trail
    if (this.trailPositions.length > 0) {
      const start = this.trailPositions[0]
      this.controls.target.copy(start)
      this.camera.position.set(start.x + 20, start.y + 30, start.z - 50)
      this.prevModelPos.copy(start)
      this.controls.update()
    }
  }

  setIndex(index: number, fraction = 0) {
    this.currentIndex = Math.max(0, Math.min(index, this.data.length - 1))

    if (!this.model || this.data.length === 0) return

    const pt = this.data[this.currentIndex]
    const pos = this.nedToScene(pt)

    // Interpolate position between current and next sample
    if (fraction > 0 && this.currentIndex < this.data.length - 1) {
      const next = this.nedToScene(this.data[this.currentIndex + 1])
      pos.lerp(next, fraction)
    }

    // Update flight direction from velocity between frames
    const delta = pos.clone().sub(this.prevModelPos)
    if (delta.lengthSq() > 0.01) {
      this.flightDir.lerp(delta.normalize(), 0.3)
      this.flightDir.normalize()
    }
    this.prevModelPos.copy(pos)

    // Model position + orientation
    this.model.position.copy(pos)

    // Orientation: use canopy orientation during canopy phase, wingsuit otherwise
    const mode = pt.flightMode?.mode ?? 0
    const canopyPhase = mode >= 5 && mode <= 7
    const cs = this.canopyStates[this.currentIndex]

    if (canopyPhase && cs && cs.valid) {
      // Under canopy: pilot hangs vertically beneath the canopy.
      // Start from canopy orientation, then pitch ~90° nose-up so the
      // wingsuit model hangs down instead of flying horizontal.
      const canopyQuat = bodyToInertialQuat(cs.phi, cs.theta, cs.psi)
      // Pitch up 80° (not full 90° — pilot leans slightly forward under canopy)
      const hangPitch = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), -80 * Math.PI / 180
      )
      canopyQuat.multiply(hangPitch)
      this.model.quaternion.copy(canopyQuat)
    } else {
      // Wingsuit/freefall: SG pipeline angles
      const phi = pt.aero.roll
      const theta = pt.aero.theta
      const psi = pt.aero.psi
      this.model.quaternion.copy(bodyToInertialQuat(phi, theta, psi))
    }

    // ── Canopy model positioning ──
    if (this.canopyModel) {
      if (cs && cs.valid && canopyPhase) {
        this.canopyModel.visible = true

        // Canopy model origin = riser convergence point → position at pilot
        this.canopyModel.position.copy(pos)

        // Canopy orientation from CN-derived Euler angles
        this.canopyModel.quaternion.copy(bodyToInertialQuat(cs.phi, cs.theta, cs.psi))
      } else {
        this.canopyModel.visible = false
      }
    }

    // Camera target always tracks the model (with slight smoothing)
    this.controls.target.lerp(pos, 0.15)

    // Camera position follow — lerp toward ideal chase position
    if (this.followTightness > 0) {
      // Chase distance/height shrink as tightness increases
      const t = this.followTightness
      const dist = FOLLOW_DIST_FAR + (FOLLOW_DIST_NEAR - FOLLOW_DIST_FAR) * t
      const height = FOLLOW_HEIGHT_FAR + (FOLLOW_HEIGHT_NEAR - FOLLOW_HEIGHT_FAR) * t

      const idealPos = pos.clone()
        .sub(this.flightDir.clone().multiplyScalar(dist))
        .add(new THREE.Vector3(0, height, 0))

      // Lerp strength scales with tightness: 0 = no pull, 1 = aggressive
      // Use exponential scaling so low values are gentle, high values snap
      const lerpFactor = this.followTightness * this.followTightness * 0.15
      this.camera.position.lerp(idealPos, lerpFactor)
    }

    // Aero overlay — wingsuit during freefall, canopy during canopy phase
    if (!canopyPhase) {
      this.aeroOverlay.update(pt, pos)
      this.canopyAeroOverlay.hide()
      this.momentInset.update(
        this.aeroOverlay.lastMoments,
        this.aeroOverlay.lastControls,
        this.aeroOverlay.lastConverged,
      )
    } else if (cs && cs.valid) {
      this.aeroOverlay.hide()
      // Canopy overlay uses canopy orientation + AOA
      this.canopyAeroOverlay.aeroOverrides = {
        aoa: cs.aoa,
        roll: cs.phi,
        theta: cs.theta,
        psi: cs.psi,
      }
      this.canopyAeroOverlay.update(pt, pos)
      this.momentInset.update(
        this.canopyAeroOverlay.lastMoments,
        this.canopyAeroOverlay.lastControls,
        this.canopyAeroOverlay.lastConverged,
      )
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
