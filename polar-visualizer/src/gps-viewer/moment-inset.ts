/**
 * Moment Breakdown Inset — Mini 3D viewer showing moment decomposition
 *
 * Concentric curved arrows per axis (pitch, roll, yaw) showing:
 *   - Aero moment (suit demand) — red/orange
 *   - Pilot input (solved, Pass 2) — green
 *   - Gyroscopic coupling — yellow
 *   - Net residual — white
 *
 * Supports multiple vehicle modes via pluggable legend formatters.
 * Arc rendering is shared; only the legend (controls + labels) changes per mode.
 */

import * as THREE from 'three'
import type {
  AxisMoments,
  VehicleMode,
  WingsuitControls,
  CanopyControls,
  CanopyControlMap,
  MomentLegendFormatter,
} from './moment-types'
import { WingsuitLegendFormatter } from './moment-wingsuit'
import { CanopyLegendFormatter } from './moment-canopy'

// Re-export types so existing importers don't break
export type { MomentBreakdown, AxisMoments } from './moment-types'

// ─── Configuration ──────────────────────────────────────────────────────────

/** Fallback max moment if all values are near zero [N·m] */
const MIN_SCALE = 5
/** Arc segments for smooth curves */
const ARC_PTS = 32

// Radii for concentric arcs (innermost → outermost)
// Aero+Pilot are combined into the innermost arc; 3 rings total
const RADII = {
  aero:  0.6,  // combined aero + pilot (innermost)
  gyro:  0.9,  // gyroscopic coupling (middle)
  net:   1.15, // I·α net (outermost)
}

// Colors
const COLORS = {
  aero:  0xff6644,  // orange-red: aero + pilot combined demand
  gyro:  0xffdd44,  // yellow: gyroscopic coupling
  net:   0xffffff,  // white: I·α (measured rotational acceleration × inertia)
}

// Axis orientations in the mini scene (fixed camera looking at origin)
// Arcs stacked vertically: pitch top, roll middle, yaw bottom
const AXIS_OFFSETS: Record<string, THREE.Vector3> = {
  pitch: new THREE.Vector3(0,  3.0, 0),
  roll:  new THREE.Vector3(0,  0.0, 0),
  yaw:   new THREE.Vector3(0, -3.0, 0),
}

// Arc plane normals for each axis (in mini-scene space)
const AXIS_NORMALS: Record<string, THREE.Vector3> = {
  pitch: new THREE.Vector3(0, 0, 1),
  roll:  new THREE.Vector3(0, 0, 1),
  yaw:   new THREE.Vector3(0, 0, 1),
}

// ─── Arc Builder ────────────────────────────────────────────────────────────

function buildArc(
  center: THREE.Vector3,
  normal: THREE.Vector3,
  radius: number,
  moment: number,
  color: number,
  maxMoment: number,
): THREE.Line {
  const fraction = Math.min(1, Math.abs(moment) / maxMoment)
  const angle = fraction * Math.PI * 1.8
  const sign = moment >= 0 ? 1 : -1

  const perp1 = new THREE.Vector3()
  if (Math.abs(normal.y) < 0.9) perp1.crossVectors(normal, new THREE.Vector3(0, 1, 0)).normalize()
  else perp1.crossVectors(normal, new THREE.Vector3(1, 0, 0)).normalize()
  const perp2 = new THREE.Vector3().crossVectors(normal, perp1).normalize()

  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= ARC_PTS; i++) {
    const a = (i / ARC_PTS) * angle * sign
    const p = center.clone()
      .add(perp1.clone().multiplyScalar(Math.cos(a) * radius))
      .add(perp2.clone().multiplyScalar(Math.sin(a) * radius))
    pts.push(p)
  }

  const geo = new THREE.BufferGeometry().setFromPoints(pts)
  const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 })
  const line = new THREE.Line(geo, mat)

  if (pts.length >= 2 && angle > 0.1) {
    const tip = pts[pts.length - 1]
    const prev = pts[pts.length - 2]
    const dir = tip.clone().sub(prev).normalize()
    const headLen = radius * 0.2
    const headGeo = new THREE.ConeGeometry(headLen * 0.4, headLen, 6)
    const headMat = new THREE.MeshBasicMaterial({ color })
    const head = new THREE.Mesh(headGeo, headMat)
    head.position.copy(tip)
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    line.add(head)
  }

  return line
}

// ─── Main Class ─────────────────────────────────────────────────────────────

export class MomentInset {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.OrthographicCamera
  private container: HTMLDivElement
  private legend: HTMLDivElement

  // Arc groups per axis (pilot folded into aero; 3 arcs per axis)
  private arcGroups: Record<string, {
    aero: THREE.Line | null
    gyro: THREE.Line | null
    net:  THREE.Line | null
  }> = {
    pitch: { aero: null, gyro: null, net: null },
    roll:  { aero: null, gyro: null, net: null },
    yaw:   { aero: null, gyro: null, net: null },
  }

  // Mode-specific legend formatter
  private formatter: MomentLegendFormatter
  private currentMode: VehicleMode = 'wingsuit'

  // Formatter registry
  private formatters: Record<VehicleMode, MomentLegendFormatter> = {
    wingsuit: new WingsuitLegendFormatter(),
    canopy:   new CanopyLegendFormatter(),
  }

  constructor(parentEl: HTMLElement, embedded = false) {
    this.formatter = this.formatters.wingsuit

    // Outer container — flex row: [text legend | arc canvas]
    this.container = document.createElement('div')
    this.container.id = 'moment-inset'
    if (embedded) {
      this.container.style.cssText = `
        width: 100%; display: flex; flex-direction: row; align-items: stretch;
        pointer-events: none;
      `
    } else {
      this.container.style.cssText = `
        position: absolute; top: 8px; left: 8px;
        display: flex; flex-direction: row; align-items: stretch;
        pointer-events: none; z-index: 10;
      `
      parentEl.style.position = 'relative'
    }
    parentEl.appendChild(this.container)

    // Left column: text legend
    this.legend = document.createElement('div')
    this.legend.style.cssText = `
      flex: 1 1 auto;
      font-size: 13px; font-family: monospace;
      color: #ccc; line-height: 1.55;
      pointer-events: none;
      white-space: pre;
      padding: 4px 6px 4px 4px;
    `
    this.container.appendChild(this.legend)

    // Right column: arc canvas wrapper (fixed width, flex column for 3 arc rows)
    const arcCol = document.createElement('div')
    arcCol.style.cssText = `
      flex: 0 0 120px; display: flex; flex-direction: column;
      align-items: center; justify-content: space-around;
      pointer-events: none;
    `
    this.container.appendChild(arcCol)

    // Canvas — sized to the arc column
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'width: 120px; height: 360px; flex: 0 0 auto;'
    arcCol.appendChild(canvas)

    // Renderer — internal resolution 120×360
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(120, 360)
    this.renderer.setClearColor(0x000000, 0)

    // Scene
    this.scene = new THREE.Scene()

    // Orthographic camera — narrow view, tall enough to see all 3 arc rows
    // AXIS_OFFSETS are at y=+3, 0, -3; arcs have max radius ~1.15
    // So scene height needed ≈ 2*(3+1.3) = 8.6; width ≈ 2*(1.3) = 2.6
    const canvasW = 120, canvasH = 360
    const aspect = canvasW / canvasH  // 1/3
    const viewH = 4.5  // half-height: covers ±4.5 → full range -3-1.3 to +3+1.3
    this.camera = new THREE.OrthographicCamera(
      -viewH * aspect, viewH * aspect, viewH, -viewH, 0.1, 10,
    )
    this.camera.position.z = 5
    this.camera.lookAt(0, 0, 0)

    // No 3D sprite labels — axis names rendered in HTML legend rows

    this.render()
  }

  /** Switch vehicle mode — changes legend formatting */
  setMode(mode: VehicleMode) {
    if (mode === this.currentMode) return
    this.currentMode = mode
    this.formatter = this.formatters[mode]
  }

  /** Get current vehicle mode */
  get mode(): VehicleMode { return this.currentMode }

  /** Update the control→axis mapping (canopy mode only) */
  setControlMap(map: CanopyControlMap | null) {
    this.formatter.setControlMap?.(map)
  }

  /** Update moment breakdown and re-render */
  update(
    moments: AxisMoments,
    controls: WingsuitControls | CanopyControls,
    converged?: boolean,
  ) {
    // Update arcs (shared across all modes)
    for (const axisName of ['pitch', 'roll', 'yaw'] as const) {
      const m = moments[axisName]
      const center = AXIS_OFFSETS[axisName]
      const normal = AXIS_NORMALS[axisName]
      const group = this.arcGroups[axisName]

      // Remove old arcs
      for (const key of ['aero', 'gyro', 'net'] as const) {
        if (group[key]) {
          this.scene.remove(group[key]!)
          group[key]!.geometry.dispose()
          group[key] = null
        }
      }

      // Combine aero + pilot into one arc (total controlled aero demand)
      const combined = m.aero + m.pilot
      const axisMax = Math.max(
        Math.abs(combined), Math.abs(m.gyro), Math.abs(m.net),
        MIN_SCALE,
      )

      if (Math.abs(combined) > 0.1)
        group.aero = buildArc(center, normal, RADII.aero, combined, COLORS.aero, axisMax)
      // pilot arc always null (folded into aero)
      if (Math.abs(m.gyro) > 0.1)
        group.gyro = buildArc(center, normal, RADII.gyro, m.gyro, COLORS.gyro, axisMax)
      if (Math.abs(m.net) > 0.1)
        group.net = buildArc(center, normal, RADII.net, m.net, COLORS.net, axisMax)

      for (const key of ['aero', 'gyro', 'net'] as const) {
        if (group[key]) this.scene.add(group[key]!)
      }
    }

    // Delegate legend to mode-specific formatter
    this.formatter.setControls(controls)
    this.legend.innerHTML = [
      this.formatter.formatControls(converged !== false),
      this.formatter.formatMoments(moments),
    ].join('<br>')

    this.render()
  }

  private render() {
    this.renderer.render(this.scene, this.camera)
  }

  set visible(v: boolean) { this.container.style.display = v ? '' : 'none' }
}
