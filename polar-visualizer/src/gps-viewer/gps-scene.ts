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
import type { GPSPipelinePoint } from '../gps/types'

const MODEL_PATH = '/models/tsimwingsuit.glb'
// GLB model is 3.55 units tall, pilot is 1.875m → scale to real meters
const MODEL_SCALE = 1.875 / 3.55  // ≈ 0.528

/** Default follow distance behind the model (meters) */
const FOLLOW_DIST = 15
/** Default follow height above the model (meters) */
const FOLLOW_HEIGHT = 5

export class GPSScene {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private model: THREE.Group | null = null
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
  }

  /** Set follow tightness: 0 = static camera, 1 = tight follow */
  setFollowTightness(value: number) {
    this.followTightness = Math.max(0, Math.min(1, value))
  }

  /** Set the aero model config for force vector overlay */
  setAeroConfig(config: AeroOverlayConfig) {
    this.aeroOverlay.setConfig(config)
  }

  setData(points: GPSPipelinePoint[]) {
    this.data = points
    this.currentIndex = 0

    // Build trail geometry from NED positions → Three.js
    this.buildTrail()
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
    const phi = pt.aero.roll
    const theta = pt.aero.theta
    const psi = pt.aero.psi
    this.model.quaternion.copy(bodyToInertialQuat(phi, theta, psi))

    // Camera target always tracks the model (with slight smoothing)
    this.controls.target.lerp(pos, 0.15)

    // Camera position follow — lerp toward ideal chase position
    if (this.followTightness > 0) {
      // Ideal position: behind + above the model along flight direction
      const idealPos = pos.clone()
        .sub(this.flightDir.clone().multiplyScalar(FOLLOW_DIST))
        .add(new THREE.Vector3(0, FOLLOW_HEIGHT, 0))

      // Lerp strength scales with tightness: 0 = no pull, 1 = aggressive
      // Use exponential scaling so low values are gentle, high values snap
      const lerpFactor = this.followTightness * this.followTightness * 0.15
      this.camera.position.lerp(idealPos, lerpFactor)
    }

    // Aero overlay — evaluate segment model at this flight condition
    this.aeroOverlay.update(pt, pos)
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
