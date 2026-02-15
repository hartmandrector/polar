/**
 * Aerodynamic segment force computation and summation.
 *
 * This module is UI-independent. It will eventually be copied into CloudBASE.
 * No Three.js, DOM, or rendering dependencies allowed here.
 *
 * Each AeroSegment produces forces at its center of pressure (CP).
 * Forces are computed per-segment, then summed at the system CG
 * with two moment contributions per segment:
 *   1. Lever arm: r_CP × F  (force at segment CP, relative to system CG)
 *   2. Intrinsic: M_0 = q·S·c·CM  (pitching moment about segment AC)
 */

import type { AeroSegment, SegmentControls } from './continuous-polar.ts'

// ─── Types ───────────────────────────────────────────────────────────────────

/** NED body-frame 3-vector (not normalized — can be meters, Newtons, etc.) */
export interface Vec3NED {
  x: number  // forward (North in level flight)
  y: number  // right   (East in level flight)
  z: number  // down
}

/** Per-segment force result from coefficient evaluation */
export interface SegmentForceResult {
  lift: number     // [N] lift force magnitude (can be negative)
  drag: number     // [N] drag force magnitude (always ≥ 0)
  side: number     // [N] side force magnitude (can be negative)
  moment: number   // [N·m] segment's own pitching moment (from CM, about its AC)
  cp: number       // chord fraction where total aero force acts
}

/** System-level summed force and moment about CG */
export interface SystemForces {
  force:  Vec3NED  // total aerodynamic force [N] in body NED
  moment: Vec3NED  // total moment about CG [N·m] in body NED
}

// ─── Default Controls ────────────────────────────────────────────────────────

/** All-neutral control state — no inputs applied. */
export function defaultControls(): SegmentControls {
  return {
    brakeLeft: 0,
    brakeRight: 0,
    frontRiserLeft: 0,
    frontRiserRight: 0,
    rearRiserLeft: 0,
    rearRiserRight: 0,
    weightShiftLR: 0,
    elevator: 0,
    rudder: 0,
    aileronLeft: 0,
    aileronRight: 0,
    flap: 0,
    delta: 0,
    dirty: 0,
    unzip: 0,
  }
}

// ─── NED Wind Frame ──────────────────────────────────────────────────────────

/**
 * Wind-frame direction vectors in NED body frame.
 * Pure math — no Three.js dependency.
 */
export interface WindFrameNED {
  windDir: Vec3NED   // unit vector: where air comes FROM
  liftDir: Vec3NED   // unit vector: perpendicular to wind, in x-z (vertical) plane
  sideDir: Vec3NED   // unit vector: cross(wind, lift)
}

/**
 * Compute aerodynamic direction vectors from angle of attack and sideslip
 * in NED body frame. Equivalent to computeWindFrame() in vectors.ts but
 * without Three.js.
 *
 * NED body frame:
 *   x = forward, y = right, z = down
 *
 * At α=0, β=0: wind comes from straight ahead (+x).
 * Positive α: nose up → wind tilts to come from below (+z component).
 * Positive β: sideslip right → wind comes from the right (+y component).
 */
export function computeWindFrameNED(alpha_deg: number, beta_deg: number): WindFrameNED {
  const a = alpha_deg * Math.PI / 180
  const b = beta_deg * Math.PI / 180

  // Wind direction: where air comes FROM in body NED
  // Derived from Three.js windDirectionBody → NED conversion:
  //   Three.js: (sin(β)cos(α), -sin(α), cos(β)cos(α))
  //   NED.x = Three.z = cos(β)cos(α)
  //   NED.y = -Three.x = -sin(β)cos(α)
  //   NED.z = -Three.y = sin(α)
  const windDir: Vec3NED = {
    x: Math.cos(b) * Math.cos(a),
    y: -Math.sin(b) * Math.cos(a),
    z: Math.sin(a),
  }

  // Lift direction: perpendicular to wind in x-z vertical plane, pointing "up"
  // In NED, "up" reference is (0, 0, -1). Lift = cross(wind, up_ref) × wind,
  // but simpler: rotate wind 90° in x-z plane toward -z.
  // liftDir = (-sin(α)cos(β), sin(β)sin(α) [≈0 at small β], -cos(α))
  // But to match Three.js exactly: use the double-cross formula.
  //
  // up_NED = (0, 0, -1)  [Three.js (0,1,0) → NED]
  // temp = cross(wind, up) = (wind.y·(-1) - wind.z·0, wind.z·0 - wind.x·(-1), wind.x·0 - wind.y·0)
  //      = (-wind.y, wind.x, 0) = (sin(β)cos(α), cos(β)cos(α), 0)
  // lift = cross(temp, wind)
  const tx = Math.sin(b) * Math.cos(a)
  const ty = Math.cos(b) * Math.cos(a)
  const tz = 0
  let lx = ty * windDir.z - tz * windDir.y
  let ly = tz * windDir.x - tx * windDir.z
  let lz = tx * windDir.y - ty * windDir.x
  const lLen = Math.sqrt(lx * lx + ly * ly + lz * lz)
  if (lLen > 1e-10) {
    lx /= lLen; ly /= lLen; lz /= lLen
  } else {
    // Degenerate (α ≈ ±90°): lift along -x in NED (= -z in Three.js)
    lx = -1; ly = 0; lz = 0
  }
  const liftDir: Vec3NED = { x: lx, y: ly, z: lz }

  // Side direction: cross(wind, lift)
  const sideDir: Vec3NED = {
    x: windDir.y * lz - windDir.z * ly,
    y: windDir.z * lx - windDir.x * lz,
    z: windDir.x * ly - windDir.y * lx,
  }

  return { windDir, liftDir, sideDir }
}

// ─── Per-Segment Force ──────────────────────────────────────────────────────

/**
 * Compute forces for a single segment at given flight conditions.
 *
 * The segment's getCoeffs() handles all internal logic:
 * - Local flow angle transformation (cell orientation)
 * - Control response (brakes → δ, risers → Δα)
 * - Kirchhoff polar evaluation
 *
 * @returns force magnitudes [N], pitching moment [N·m], and CP fraction
 */
export function computeSegmentForce(
  seg: AeroSegment,
  alpha_deg: number,
  beta_deg: number,
  controls: SegmentControls,
  rho: number,
  airspeed: number,
): SegmentForceResult {
  const q = 0.5 * rho * airspeed * airspeed
  const { cl, cd, cy, cm, cp } = seg.getCoeffs(alpha_deg, beta_deg, controls)
  return {
    lift:   q * seg.S * cl,
    drag:   q * seg.S * cd,
    side:   q * seg.S * cy,
    moment: q * seg.S * seg.chord * cm,
    cp,
  }
}

// ─── System Summation ────────────────────────────────────────────────────────

/**
 * Sum forces and moments from all segments about the combined
 * canopy-pilot center of gravity.
 *
 * Two moment contributions per segment:
 *   1. Lever arm: r_CP × F  (force at segment CP, relative to system CG)
 *   2. Intrinsic: M_0 = q·S·c·CM  (pitching moment about segment AC)
 *
 * F_total = Σ F_i
 * M_total = Σ (r_CP,i × F_i) + Σ M_0,i
 *
 * @param segments      Array of AeroSegments
 * @param segmentForces Matching array of per-segment force results
 * @param cgMeters      System CG position in meters (NED body frame)
 * @param height        Reference height for denormalization [m] (e.g. 1.875)
 * @param windDir       Unit vector — where air comes FROM (NED body frame)
 * @param liftDir       Unit vector — perpendicular to wind in vertical plane
 * @param sideDir       Unit vector — cross(wind, lift)
 */
export function sumAllSegments(
  segments: AeroSegment[],
  segmentForces: SegmentForceResult[],
  cgMeters: Vec3NED,
  height: number,
  windDir: Vec3NED,
  liftDir: Vec3NED,
  sideDir: Vec3NED,
): SystemForces {
  let totalFx = 0, totalFy = 0, totalFz = 0
  let totalMx = 0, totalMy = 0, totalMz = 0

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const f = segmentForces[i]

    // Force vector in body NED frame [N]
    // lift along liftDir, drag opposes wind (= -windDir), side along sideDir
    const fx = liftDir.x * f.lift - windDir.x * f.drag + sideDir.x * f.side
    const fy = liftDir.y * f.lift - windDir.y * f.drag + sideDir.y * f.side
    const fz = liftDir.z * f.lift - windDir.z * f.drag + sideDir.z * f.side

    totalFx += fx
    totalFy += fy
    totalFz += fz

    // CP position in meters: segment AC + CP offset along chord direction.
    // CP is a chord fraction — offset from quarter-chord (AC assumed at 0.25c).
    // The chord direction rotates with pitchOffset_deg in the x-z plane:
    //   0° → chord along x (canopy cell, prone body)
    //  90° → chord along z (upright pilot hanging under canopy)
    const cpOffsetNorm = (f.cp - 0.25) * seg.chord / height
    const pitchRad = (seg.pitchOffset_deg ?? 0) * Math.PI / 180
    const cpX = (seg.position.x + cpOffsetNorm * Math.cos(pitchRad)) * height
    const cpY = seg.position.y * height
    const cpZ = (seg.position.z + cpOffsetNorm * Math.sin(pitchRad)) * height

    // Lever arm: segment CP (meters) minus system CG (meters)
    const rx = cpX - cgMeters.x
    const ry = cpY - cgMeters.y
    const rz = cpZ - cgMeters.z

    // Moment contribution 1: r_CP × F  (cross product)
    totalMx += ry * fz - rz * fy
    totalMy += rz * fx - rx * fz
    totalMz += rx * fy - ry * fx

    // Moment contribution 2: segment's own pitching moment (CM-based, about AC)
    // Acts around the pitch axis (y in NED = starboard)
    totalMy += f.moment
  }

  return {
    force:  { x: totalFx, y: totalFy, z: totalFz },
    moment: { x: totalMx, y: totalMy, z: totalMz },
  }
}
