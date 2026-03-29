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
import type { GPSPipelinePoint } from '../gps/types'
import type { OrientationEKF } from '../kalman/orientation-ekf'
import type { CanopyState } from './canopy-estimator'

const MODEL_PATH = '/models/tsimwingsuit.glb'
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
  private canvas: HTMLCanvasElement

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

  private ekf: OrientationEKF | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setClearColor(0x0a0a1a)

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

    // Aero overlay (body frame — vectors stay in native frame)
    this.aeroOverlay = new GPSAeroOverlay(this.scene)
    this.canopyAeroOverlay = new GPSAeroOverlay(this.scene)

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
    } catch (e) {
      console.error('Failed to load wingsuit model:', e)
    }

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

  setAeroConfig(config: AeroOverlayConfig) {
    this.aeroOverlay.setConfig(config)
  }

  setCanopyAeroConfig(config: AeroOverlayConfig) {
    this.canopyAeroOverlay.setConfig(config)
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
    const material = new THREE.LineBasicMaterial({ color: 0x3060a0, opacity: 0.3, transparent: true })
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

    // Get the body-to-inertial quaternion
    let bodyQuat: THREE.Quaternion
    if (canopyPhase && cs && cs.valid) {
      bodyQuat = bodyToInertialQuat(cs.phi, cs.theta, cs.psi)
    } else {
      bodyQuat = bodyToInertialQuat(pt.aero.roll, pt.aero.theta, pt.aero.psi)
    }

    // Body frame: rotate world by INVERSE body quat
    // This makes the world rotate around the stationary vehicle
    const inverseBodyQuat = bodyQuat.clone().invert()
    this.worldGroup.quaternion.copy(inverseBodyQuat)

    // Also need to rotate the translation by the inverse quat
    // so position offset is in body frame coordinates
    const translatedPos = vehicleScenePos.clone().negate()
    translatedPos.applyQuaternion(inverseBodyQuat)
    this.worldGroup.position.copy(translatedPos)

    // Vehicle at origin, identity rotation
    this.model.position.set(0, 0, 0)
    this.model.quaternion.identity()

    // Canopy in body frame (no inertial rotation)
    if (this.canopyModel) {
      if (cs && cs.valid && canopyPhase) {
        this.canopyModel.visible = true
        this.canopyModel.position.set(0, 0, 0)
        // Canopy relative to body: invert body quat, apply canopy quat
        const canopyInertialQuat = bodyToInertialQuat(cs.phi, cs.theta, cs.psi)
        const canopyRelBody = inverseBodyQuat.clone().multiply(canopyInertialQuat)
        this.canopyModel.quaternion.copy(canopyRelBody)
      } else {
        this.canopyModel.visible = false
      }
    }

    // Aero overlay at origin (body frame — vectors are native)
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
