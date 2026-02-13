/**
 * Aerospace frame transformations — NED body/inertial frames with 3-2-1 Euler angles.
 *
 * Conventions:
 *   Euler angles:  ψ (yaw) → θ (pitch) → φ (roll)  — 3-2-1 / ZYX intrinsic
 *   Inertial frame: NED (North-East-Down)
 *   Body axes:      x-forward, y-right, z-down
 *   Wind axes:      x-along-airspeed, z-in-symmetry-plane (down), y-right
 *
 * Three.js uses a right-handed Y-up system (X-right, Y-up, Z-toward-camera).
 * We keep all aerospace math in NED and convert at the render boundary.
 *
 * References:
 *   academicflight.com — 3-2-1 Euler Angles, Direction Cosine Matrices
 */

import * as THREE from 'three'

const DEG2RAD = Math.PI / 180

// ─── NED ↔ Three.js coordinate mapping ──────────────────────────────────────
//
//   NED        Three.js
//   x (north)  → z  (toward camera / forward)
//   y (east)   → -x (left in Three.js = east on screen from above)
//   z (down)   → -y (up is +Y in Three.js)
//
// This is a proper rotation (det = +1). From above: North = +Z (up on
// screen), East = -X (right on screen). Cross product preserved:
//   +Z × (-X) = -Y  ↔  North × East = Down  ✓

/** Convert a vector from NED (x-fwd, y-right, z-down) to Three.js (X-left, Y-up, Z-fwd). */
export function nedToThreeJS(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(-v.y, -v.z, v.x)
}

/** Convert a Three.js vector back to NED. */
export function threeJSToNed(v: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: v.z, y: -v.x, z: -v.y }
}

// ─── Direction Cosine Matrices ───────────────────────────────────────────────

/**
 * DCM [EB] — rotates a vector FROM body axes TO inertial (NED) axes.
 *
 *    v_ned = dcmBodyToInertial(φ, θ, ψ) · v_body
 *
 * 3-2-1 Euler:  R = Rz(ψ) · Ry(θ) · Rx(φ)   (inertial-to-body is Rx·Ry·Rz)
 * We return its transpose (body-to-inertial).
 *
 * Returns a flat column-major 9-element array [m00,m10,m20, m01,m11,m21, m02,m12,m22]
 * suitable for THREE.Matrix3().fromArray().
 */
export function dcmBodyToInertial(
  phi_rad: number,
  theta_rad: number,
  psi_rad: number
): number[] {
  const cp = Math.cos(phi_rad),   sp = Math.sin(phi_rad)
  const ct = Math.cos(theta_rad), st = Math.sin(theta_rad)
  const cy = Math.cos(psi_rad),   sy = Math.sin(psi_rad)

  // R_BE (body-to-inertial) = transpose of R_EB (inertial-to-body)
  // R_EB = Rx(φ) · Ry(θ) · Rz(ψ)
  //
  // Row-major R_EB:
  //   [ ct*cy,              ct*sy,             -st    ]
  //   [ sp*st*cy - cp*sy,   sp*st*sy + cp*cy,   sp*ct ]
  //   [ cp*st*cy + sp*sy,   cp*st*sy - sp*cy,   cp*ct ]
  //
  // Transpose → R_BE (body-to-inertial), stored column-major for THREE.Matrix3:
  return [
    // column 0
    ct * cy,
    ct * sy,
    -st,
    // column 1
    sp * st * cy - cp * sy,
    sp * st * sy + cp * cy,
    sp * ct,
    // column 2
    cp * st * cy + sp * sy,
    cp * st * sy - sp * cy,
    cp * ct,
  ]
}

/**
 * DCM [BW] — rotates a vector FROM wind axes TO body axes.
 *
 *    v_body = dcmWindToBody(α, β) · v_wind
 *
 * Wind-to-body rotation is: Ry(-β) · Rz(α)
 *   x_wind = along airspeed V∞
 *   After rotation: body x aligns with fuselage forward axis
 *
 * Returned column-major for THREE.Matrix3.
 */
export function dcmWindToBody(alpha_rad: number, beta_rad: number): number[] {
  const ca = Math.cos(alpha_rad), sa = Math.sin(alpha_rad)
  const cb = Math.cos(beta_rad),  sb = Math.sin(beta_rad)

  // Row-major:
  //   [ ca*cb,  sa, -ca*sb ]
  //   [ -sa*cb, ca,  sa*sb ]
  //   [ sb,     0,   cb    ]
  //
  // Column-major for Three.js:
  return [
    ca * cb,  -sa * cb,  sb,
    sa,        ca,        0,
   -ca * sb,   sa * sb,   cb,
  ]
}

// ─── Quaternion for Three.js Object3D ────────────────────────────────────────

/**
 * Compute the Three.js quaternion that orients a model according to
 * NED Euler angles (φ, θ, ψ) in the Three.js Y-up coordinate system.
 *
 * Strategy:
 *   1. Build the NED body-to-inertial DCM  (3×3).
 *   2. Embed it in a 4×4 Three.js Matrix4, remapping NED→Three.js axes.
 *   3. Extract the quaternion.
 *
 * This avoids any THREE.Euler order ambiguity.
 */
export function bodyToInertialQuat(
  phi_rad: number,
  theta_rad: number,
  psi_rad: number
): THREE.Quaternion {
  const dcm = dcmBodyToInertial(phi_rad, theta_rad, psi_rad)

  // dcm is column-major [c0r0,c0r1,c0r2, c1r0,c1r1,c1r2, c2r0,c2r1,c2r2]
  // which maps body NED columns → inertial NED columns.
  //
  // In NED:  body_x (fwd), body_y (right), body_z (down)
  //          are mapped to inertial NED components.
  //
  // We need the equivalent in Three.js coordinates.
  // NED→ThreeJS mapping:  ned(x,y,z) → three(-y, -z, x)
  //   nedToThreeJS: three.x = -ned.y,  three.y = -ned.z,  three.z = ned.x
  //
  // Body axes in Three.js model space:
  //   body_x (fwd)   → Three.js (0, 0, 1)   i.e. +Z
  //   body_y (right)  → Three.js (-1, 0, 0)  i.e. -X
  //   body_z (down)   → Three.js (0, -1, 0)  i.e. -Y
  //
  // For each body axis bj, find the Three.js inertial direction:
  //   inertial_ned = DCM_BE * body_ned
  //   inertial_three = nedToThreeJS(inertial_ned)
  //
  // Column j of DCM_BE (column-major) gives inertial NED for body axis j:
  //   body_x (fwd):   col0 = (dcm[0], dcm[1], dcm[2])
  //   body_y (right):  col1 = (dcm[3], dcm[4], dcm[5])
  //   body_z (down):   col2 = (dcm[6], dcm[7], dcm[8])
  //
  // Convert each to Three.js (using corrected -y, -z, x):
  //   col0_three = nedToThreeJS(col0) = (-dcm[1], -dcm[2], dcm[0])
  //   col1_three = (-dcm[4], -dcm[5], dcm[3])
  //   col2_three = (-dcm[7], -dcm[8], dcm[6])
  //
  // These tell us where body_x, body_y, body_z point in Three.js world.
  // body_x → Three.js +Z,  body_y → Three.js -X,  body_z → Three.js -Y.
  //
  // So the Three.js rotation matrix R_three maps:
  //   R_three * (0,0,1) = col0_three   → column 2 of R_three
  //   R_three * (-1,0,0) = col1_three  → column 0 of R_three is -col1_three
  //   R_three * (0,-1,0) = col2_three  → column 1 of R_three is -col2_three
  //
  // Therefore R_three (column-major for Matrix4):
  //   col0 = -col1_three = (dcm[4], dcm[5], -dcm[3])
  //   col1 = -col2_three = (dcm[7], dcm[8], -dcm[6])
  //   col2 = col0_three = (-dcm[1], -dcm[2], dcm[0])

  const m = new THREE.Matrix4()
  m.set(
    // row-major argument order for THREE.Matrix4.set()
    //    col0         col1          col2         col3
    dcm[4],      dcm[7],     -dcm[1],      0,   // row 0 (x)
    dcm[5],      dcm[8],     -dcm[2],      0,   // row 1 (y)
    -dcm[3],     -dcm[6],      dcm[0],      0,   // row 2 (z)
    0,           0,            0,           1    // row 3
  )

  const q = new THREE.Quaternion()
  q.setFromRotationMatrix(m)
  return q
}

// ─── Derived quantities ──────────────────────────────────────────────────────

/**
 * Compute the wind direction vector in the inertial (Three.js) frame.
 *
 * The wind comes FROM the direction the body is flying toward.
 * In body axes the wind is along body-x (forward).
 * Rotating body→inertial gives the flight-path direction;
 * the wind blows opposite to that.
 *
 * For the visualiser we actually want the direction the air is coming FROM
 * relative to the body, then expressed in the display frame.
 *
 * In body frame (Three.js coords) the relative wind is +Z for aligned flight.
 * We rotate the body axes by α/β only (not full attitude) to get the wind
 * direction in body axes.
 */
export function windDirectionBody(alpha_deg: number, beta_deg: number): THREE.Vector3 {
  const a = alpha_deg * DEG2RAD
  const b = beta_deg * DEG2RAD

  // Matches vectors.ts existing convention:
  // wind comes from +Z at α=0,β=0; positive α tilts wind down, positive β tilts left.
  return new THREE.Vector3(
    Math.sin(b) * Math.cos(a),
    -Math.sin(a),
    Math.cos(b) * Math.cos(a)
  ).normalize()
}

// ─── Wind-attitude mode ──────────────────────────────────────────────────────

/**
 * Compute the body-to-inertial quaternion (Three.js) from:
 *   - Wind Euler angles (φ_w, θ_w, ψ_w) — orientation of the airspeed vector
 *     in the inertial frame, using the same 3-2-1 convention.
 *   - α, β — angle of attack and sideslip, defining the body's orientation
 *     relative to the wind.
 *
 * Composition:
 *   q_body = q_wind · Rx(-α) · Ry(β)
 *
 *   - q_wind sets the wind frame in inertial space (from slider Euler angles)
 *   - Rx(-α) pitches the body nose-up relative to the wind (positive α → nose up)
 *   - Ry(β) yaws the body so wind comes from the right (positive β → sideslip right)
 *
 * This reproduces the windDirectionBody() convention:
 *   wind_body = Ry(-β) · Rx(α) · (0,0,1) = (-sin(β)cos(α), -sin(α), cos(β)cos(α))
 *
 * Behaviour:
 *   - Adjusting wind roll → body rotates around the static wind vector
 *   - Adjusting α/β → body tilts away from the wind direction
 *   - At all sliders zero and α=β=0, body points forward (+Z)
 */
export function bodyQuatFromWindAttitude(
  wind_phi_rad: number,
  wind_theta_rad: number,
  wind_psi_rad: number,
  alpha_rad: number,
  beta_rad: number
): THREE.Quaternion {
  // Wind frame orientation in inertial space
  const qWind = bodyToInertialQuat(wind_phi_rad, wind_theta_rad, wind_psi_rad)

  // Body rotation relative to wind frame:
  //   Pitch by -α about X  (nose up for positive α)
  //   Then yaw by +β about Y  (nose left → wind from right for positive β)
  const qAlpha = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0), -alpha_rad
  )
  const qBeta = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), beta_rad
  )

  // q_body = q_wind · qAlpha · qBeta
  return qWind.multiply(qAlpha).multiply(qBeta)
}
