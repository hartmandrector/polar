/**
 * GPS Viewer — Rotation Axis Helpers
 * 
 * Visual axis indicators with Greek letter labels and live rotation data.
 * - Inertial frame: φ/θ/ψ Euler angle axes
 * - Body frame: p/q/r body rate axes
 * 
 * Colors match the force/moment vector palette.
 */

import * as THREE from 'three'

// Colors matching gps-aero-overlay.ts moment colors
const COL_ROLL  = 0xff6644  // φ / p — roll
const COL_PITCH = 0x44ff66  // θ / q — pitch  
const COL_YAW   = 0x6644ff  // ψ / r — yaw

const AXIS_LENGTH = 1.5
const LABEL_OFFSET = 1.8

function makeTextSprite(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  
  ctx.clearRect(0, 0, 128, 64)
  
  // Dark outline
  ctx.font = 'bold 48px serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 6
  ctx.strokeText(text, 64, 32)
  
  // Colored fill
  const hex = '#' + color.toString(16).padStart(6, '0')
  ctx.fillStyle = hex
  ctx.fillText(text, 64, 32)
  
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(0.8, 0.4, 1)
  return sprite
}

function makeAxisLine(dir: THREE.Vector3, color: number): THREE.Line {
  const points = [new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(AXIS_LENGTH)]
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = new THREE.LineBasicMaterial({ color, linewidth: 2, depthTest: false })
  return new THREE.Line(geo, mat)
}

function makeArrowTip(dir: THREE.Vector3, color: number): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.06, 0.2, 8)
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.copy(dir.clone().multiplyScalar(AXIS_LENGTH))
  // Orient cone along direction
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
  return mesh
}

/**
 * Euler angle axis helper for inertial frame.
 * Shows φ (roll/x-forward), θ (pitch/y-right), ψ (yaw/z-down→up in scene)
 * Positioned at top-right of the vehicle.
 */
export class EulerAxisHelper {
  readonly group: THREE.Group

  private phiLabel: THREE.Sprite
  private thetaLabel: THREE.Sprite
  private psiLabel: THREE.Sprite

  constructor() {
    this.group = new THREE.Group()
    this.group.renderOrder = 999

    // In Three.js scene coords: X=east→left, Y=up, Z=north→forward
    // Body NED: x=forward(N), y=right(E), z=down(D)
    // Scene: x=-E, y=-D, z=N
    // So body-x(fwd) = scene-z, body-y(right) = scene-(-x), body-z(down) = scene-(-y)
    
    // Roll axis = body x-forward = scene +Z
    const rollDir = new THREE.Vector3(0, 0, 1)
    this.group.add(makeAxisLine(rollDir, COL_ROLL))
    this.group.add(makeArrowTip(rollDir, COL_ROLL))
    this.phiLabel = makeTextSprite('φ', COL_ROLL)
    this.phiLabel.position.copy(rollDir.clone().multiplyScalar(LABEL_OFFSET))
    this.group.add(this.phiLabel)

    // Pitch axis = body y-right = scene -X
    const pitchDir = new THREE.Vector3(-1, 0, 0)
    this.group.add(makeAxisLine(pitchDir, COL_PITCH))
    this.group.add(makeArrowTip(pitchDir, COL_PITCH))
    this.thetaLabel = makeTextSprite('θ', COL_PITCH)
    this.thetaLabel.position.copy(pitchDir.clone().multiplyScalar(LABEL_OFFSET))
    this.group.add(this.thetaLabel)

    // Yaw axis = body z-down = scene -Y (show as +Y for visual clarity)
    const yawDir = new THREE.Vector3(0, 1, 0)
    this.group.add(makeAxisLine(yawDir, COL_YAW))
    this.group.add(makeArrowTip(yawDir, COL_YAW))
    this.psiLabel = makeTextSprite('ψ', COL_YAW)
    this.psiLabel.position.copy(yawDir.clone().multiplyScalar(LABEL_OFFSET))
    this.group.add(this.psiLabel)

    // Position offset so it doesn't overlap the vehicle
    this.group.position.set(2.5, 2.0, 0)
  }
}

/**
 * Body rate axis helper for body frame.
 * Shows p (roll), q (pitch), r (yaw) with rotation direction arcs.
 */
export class BodyRateAxisHelper {
  readonly group: THREE.Group

  private pLabel: THREE.Sprite
  private qLabel: THREE.Sprite
  private rLabel: THREE.Sprite

  constructor() {
    this.group = new THREE.Group()
    this.group.renderOrder = 999

    // Same NED→scene mapping as EulerAxisHelper
    const rollDir = new THREE.Vector3(0, 0, 1)
    this.group.add(makeAxisLine(rollDir, COL_ROLL))
    this.group.add(makeArrowTip(rollDir, COL_ROLL))
    this.pLabel = makeTextSprite('p', COL_ROLL)
    this.pLabel.position.copy(rollDir.clone().multiplyScalar(LABEL_OFFSET))
    this.group.add(this.pLabel)

    const pitchDir = new THREE.Vector3(-1, 0, 0)
    this.group.add(makeAxisLine(pitchDir, COL_PITCH))
    this.group.add(makeArrowTip(pitchDir, COL_PITCH))
    this.qLabel = makeTextSprite('q', COL_PITCH)
    this.qLabel.position.copy(pitchDir.clone().multiplyScalar(LABEL_OFFSET))
    this.group.add(this.qLabel)

    const yawDir = new THREE.Vector3(0, 1, 0)
    this.group.add(makeAxisLine(yawDir, COL_YAW))
    this.group.add(makeArrowTip(yawDir, COL_YAW))
    this.rLabel = makeTextSprite('r', COL_YAW)
    this.rLabel.position.copy(yawDir.clone().multiplyScalar(LABEL_OFFSET))
    this.group.add(this.rLabel)

    // Position offset
    this.group.position.set(2.5, 2.0, 0)
  }
}
