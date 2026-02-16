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
  compassLabels: THREE.Group
  bodyAxisLabels: THREE.Group
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

  // Compass labels (N/E/D) — inertial frame reference
  const compassLabels = createCompassLabels()
  compassLabels.visible = false
  scene.add(compassLabels)

  // Body axis labels (x/y/z) — body frame reference
  const bodyAxisLabels = createBodyAxisLabels()
  bodyAxisLabels.visible = false
  scene.add(bodyAxisLabels)

  return { scene, camera, renderer, controls, gridHelper, compassLabels, bodyAxisLabels }
}

// ─── Compass Labels ──────────────────────────────────────────────────────────

/**
 * Create a canvas-based text sprite for a single letter.
 * Uses a large bubble-style font rendered to a canvas texture.
 */
function makeTextSprite(letter: string, color: string): THREE.Sprite {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Transparent background
  ctx.clearRect(0, 0, size, size)

  // Bubble font style — large, bold, rounded
  ctx.font = 'bold 180px Arial, Helvetica, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Dark outline for readability
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 12
  ctx.lineJoin = 'round'
  ctx.strokeText(letter, size / 2, size / 2)

  // Fill with the given color
  ctx.fillStyle = color
  ctx.fillText(letter, size / 2, size / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })

  const sprite = new THREE.Sprite(material)
  sprite.scale.set(1.2, 1.2, 1)
  return sprite
}

/**
 * Create the N and E compass label group.
 *
 * In Three.js inertial frame (corrected, det=+1):
 *   North (NED x) → Three.js +Z
 *   East  (NED y) → Three.js -X
 *
 * Labels are placed at the edge of the grid (radius ~10).
 */
function createCompassLabels(): THREE.Group {
  const group = new THREE.Group()
  const dist = 10.5  // just beyond grid edge (grid is 20×20, half = 10)
  const height = 0.6 // slightly above the grid plane

  // North — along +Z in Three.js
  const nSprite = makeTextSprite('N', '#44aaff')
  nSprite.position.set(0, height, dist)
  group.add(nSprite)

  // East — along -X in Three.js
  const eSprite = makeTextSprite('E', '#ffaa44')
  eSprite.position.set(-dist, height, 0)
  group.add(eSprite)

  // Down — along -Y in Three.js (NED z → Three.js -Y)
  const dSprite = makeTextSprite('D', '#44ff88')
  dSprite.position.set(0, -dist, 0)
  group.add(dSprite)

  return group
}

/**
 * Create body axis labels (x, y, z) at the ends of the AxesHelper.
 *
 * In Three.js body frame (NED mapping):
 *   x_B (NED forward) → Three.js +Z
 *   y_B (NED right)   → Three.js -X
 *   z_B (NED down)    → Three.js -Y
 *
 * Labels positioned at radius ~1.8 (just beyond AxesHelper length 1.5).
 */
function createBodyAxisLabels(): THREE.Group {
  const group = new THREE.Group()
  const dist = 1.8

  // x_B (forward = NED x) → Three.js +Z
  const xSprite = makeTextSprite('x', '#ff4444')
  xSprite.scale.set(0.6, 0.6, 1)
  xSprite.position.set(0, 0, dist)
  group.add(xSprite)

  // y_B (right = NED y) → Three.js -X
  const ySprite = makeTextSprite('y', '#44ff44')
  ySprite.scale.set(0.6, 0.6, 1)
  ySprite.position.set(-dist, 0, 0)
  group.add(ySprite)

  // z_B (down = NED z) → Three.js -Y
  const zSprite = makeTextSprite('z', '#4444ff')
  zSprite.scale.set(0.6, 0.6, 1)
  zSprite.position.set(0, -dist, 0)
  group.add(zSprite)

  return group
}

export function resizeRenderer(ctx: SceneContext, container: HTMLElement): void {
  const w = container.clientWidth
  const h = container.clientHeight
  if (w === 0 || h === 0) return
  ctx.renderer.setSize(w, h)
  ctx.camera.aspect = w / h
  ctx.camera.updateProjectionMatrix()
}
