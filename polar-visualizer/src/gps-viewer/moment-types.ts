/**
 * Shared types for moment decomposition visualization.
 *
 * Extracted from moment-inset.ts so that solvers, overlays, and
 * mode-specific legend formatters can all share a single type source.
 */

// ─── Vehicle Mode ───────────────────────────────────────────────────────────

/** Active vehicle mode for moment inset display */
export type VehicleMode = 'wingsuit' | 'canopy'
// Future: 'deploy' | 'ground' | 'freefall'

// ─── Moment Breakdown ───────────────────────────────────────────────────────

export interface MomentBreakdown {
  /** Aerodynamic moment from segment model [N·m] */
  aero: number
  /** Pilot control input moment [N·m] (Pass 2 — 0 until solved) */
  pilot: number
  /** Gyroscopic coupling moment [N·m] */
  gyro: number
  /** Net / residual [N·m] */
  net: number
}

export interface AxisMoments {
  pitch: MomentBreakdown
  roll: MomentBreakdown
  yaw: MomentBreakdown
}

// ─── Control Display Shapes ─────────────────────────────────────────────────

/** Wingsuit controls — symmetric pitch/roll/yaw throttles [-1, 1] */
export interface WingsuitControls {
  pitch: number
  roll: number
  yaw: number
}

/** Canopy controls — asymmetric brakes [0,1] and front risers [0,1] */
export interface CanopyControls {
  brakeLeft: number
  brakeRight: number
  frontRiserLeft: number
  frontRiserRight: number
}

/** Per-control moment contribution to each axis [N·m] */
export interface ControlMomentContrib {
  roll: number
  pitch: number
  yaw: number
}

/** Mapping of each canopy control to its moment contributions */
export interface CanopyControlMap {
  brakeLeft: ControlMomentContrib
  brakeRight: ControlMomentContrib
  frontRiserLeft: ControlMomentContrib
  frontRiserRight: ControlMomentContrib
}

// ─── Legend Formatter Interface ─────────────────────────────────────────────

/**
 * Mode-specific legend formatter.
 * Each vehicle mode implements this to produce its control + moment legend HTML.
 */
export interface MomentLegendFormatter {
  /** Format the controls section of the legend */
  formatControls(converged: boolean): string
  /** Format the moment breakdown section (shared across modes) */
  formatMoments(moments: AxisMoments): string
  /** Update stored controls from latest solver output */
  setControls(controls: WingsuitControls | CanopyControls): void
  /** Optional: set per-control → axis moment mapping */
  setControlMap?(map: CanopyControlMap | null): void
}

// ─── Shared Helpers ─────────────────────────────────────────────────────────

/** Format a moment value with sign */
export function fmt(v: number): string {
  const s = v.toFixed(1)
  return v >= 0 ? `+${s}` : s
}

/** Color key header lines (shared across all modes) */
export function formatColorKey(): string {
  return [
    `<span style="color:#ff6644">■</span> Aero`,
    `<span style="color:#44ff88">■</span> Pilot`,
    `<span style="color:#ffdd44">■</span> Gyro`,
    `<span style="color:#ffffff">■</span> I·α`,
  ].join('<br>')
}

/** Format moment breakdown for a single axis */
export function formatAxisMoments(label: string, m: MomentBreakdown): string {
  return [
    `<b>${label}</b>`,
    `  A ${fmt(m.aero)} P ${fmt(m.pilot)}`,
    `  G ${fmt(m.gyro)} Iα ${fmt(m.net)}`,
  ].join('<br>')
}
