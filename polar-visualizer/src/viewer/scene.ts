/**
 * Three.js scene setup — camera, lights, grid, orbit controls.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface SceneContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  gridHelper: THREE.GridHelper
}

export function createScene(canvas: HTMLCanvasElement): SceneContext {
  // Renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setClearColor(0x1a1a2e)
  renderer.shadowMap.enabled = false

  // Scene
  const scene = new THREE.Scene()

  // Camera
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500)
  camera.position.set(4, 3, 5)
  camera.lookAt(0, 0, 0)

  // Orbit controls
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.target.set(0, 0, 0)

  // Lights
  const ambientLight = new THREE.AmbientLight(0x404060, 1.5)
  scene.add(ambientLight)

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5)
  dirLight.position.set(5, 10, 7.5)
  scene.add(dirLight)

  const dirLight2 = new THREE.DirectionalLight(0x8888cc, 0.5)
  dirLight2.position.set(-5, 3, -5)
  scene.add(dirLight2)

  // Grid
  const gridHelper = new THREE.GridHelper(20, 20, 0x333355, 0x222244)
  scene.add(gridHelper)

  // Axes helper (small)
  const axesHelper = new THREE.AxesHelper(1.5)
  scene.add(axesHelper)

  return { scene, camera, renderer, controls, gridHelper }
}

export function resizeRenderer(ctx: SceneContext, container: HTMLElement): void {
  const w = container.clientWidth
  const h = container.clientHeight
  if (w === 0 || h === 0) return
  ctx.renderer.setSize(w, h)
  ctx.camera.aspect = w / h
  ctx.camera.updateProjectionMatrix()
}
