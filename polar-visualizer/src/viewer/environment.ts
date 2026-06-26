/**
 * Environment layer — ground reference grid and GPU particle debris field.
 *
 * Ground grid: a large quad with a GLSL grid shader. Zero CPU cost after init;
 * the shader computes analytic grid lines from world-space position with fwidth()
 * anti-aliasing. Minor lines every 5 scene units (10 m real), major every 25 (50 m).
 *
 * Particle debris: ~4000 Points with a wrapping vertex shader. Each particle
 * starts at a random position inside a fixed-size box. The vertex shader wraps
 * particle positions into the box centred on the camera so the field appears
 * infinite. Only one vec3 uniform update per frame (camera position).
 */

import * as THREE from 'three'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnvironmentLayer {
  groundGrid: THREE.Mesh
  particles: THREE.Points
  /** Accumulated world-drift offset in particles' local space — passed to shader each frame. */
  _flowOffset: THREE.Vector3
  /** Flow velocity in particles' local space (scene-units/s) — set by setEnvironmentFrame. */
  _flowVelocityLocal: THREE.Vector3
  /** elapsed ms at last updateEnvironment call, for dt integration. */
  _prevElapsedMs: number
}
// Quaternion that lays a default XY PlaneGeometry flat (horizontal in Three.js Y-up space).
// Stored once at module level so frame updates don't allocate.
const LAY_FLAT_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
// ─── Ground Grid ──────────────────────────────────────────────────────────────

/** Scene-unit size of the ground plane (1 scene unit ≈ 2 m real). */
const GRID_SIZE = 400
/** Y position of the plane in scene units — below the model at origin. */
const GRID_Y = -6

const gridVert = /* glsl */`
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const gridFrag = /* glsl */`
  varying vec3 vWorldPos;
  void main() {
    vec2 p = vWorldPos.xz;

    // Minor grid — one line every 5 scene units (≈10 m)
    vec2 mf = fwidth(p / 5.0);
    vec2 mg = abs(fract(p / 5.0 - 0.5) - 0.5) / max(mf, vec2(0.0001));
    float minor = 1.0 - min(min(mg.x, mg.y), 1.0);

    // Major grid — one line every 25 scene units (≈50 m)
    vec2 Mf = fwidth(p / 25.0);
    vec2 Mg = abs(fract(p / 25.0 - 0.5) - 0.5) / max(Mf, vec2(0.0001));
    float major = 1.0 - min(min(Mg.x, Mg.y), 1.0);

    float line = max(minor * 0.35, major * 0.85);

    // Radial fade from origin — grid disappears at the horizon
    float dist = length(p);
    float fade = 1.0 - smoothstep(80.0, 160.0, dist);

    if (line * fade < 0.01) discard;
    gl_FragColor = vec4(0.22, 0.42, 0.72, line * fade * 0.55);
  }
`

function createGroundGrid(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE)
  const mat = new THREE.ShaderMaterial({
    vertexShader: gridVert,
    fragmentShader: gridFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.quaternion.copy(LAY_FLAT_QUAT)   // lay flat; updated each frame via setEnvironmentFrame
  mesh.position.y = GRID_Y
  mesh.visible = false
  return mesh
}

// ─── Particle Debris ──────────────────────────────────────────────────────────

/** 1 real metre = 0.5 scene units (matches TrailRenderer SCENE_SCALE). */
const SCENE_SCALE = 0.5

const PARTICLE_COUNT = 4000
/** Side length of the wrapping box in scene units. */
const WRAP_BOX = 40

const particleVert = /* glsl */`
  uniform vec3  uCameraPos;
  uniform vec3  uFlowOffset;
  uniform float uBoxSize;
  uniform float uTime;

  void main() {
    // Apply accumulated flow drift (relative wind streaming particles past the aircraft),
    // then wrap into the box centred on the camera for the infinite-field illusion.
    vec3 drifted = position + uFlowOffset;
    vec3 offset  = drifted - uCameraPos;
    offset = mod(offset + uBoxSize * 0.5, uBoxSize) - uBoxSize * 0.5;
    vec3 wp = uCameraPos + offset;

    // Gentle vertical float — each particle drifts at a slightly different rate.
    wp.y += sin(uTime * 0.18 + position.x * 1.37 + position.z * 0.93) * 0.14;

    vec4 mv = modelViewMatrix * vec4(wp, 1.0);

    // Perspective-correct point size: larger when close, fade in at distance.
    gl_PointSize = clamp(3.5 * (6.0 / max(-mv.z, 0.5)), 0.5, 5.0);
    gl_Position  = projectionMatrix * mv;
  }
`

const particleFrag = /* glsl */`
  void main() {
    // Soft circular disc per point.
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c);
    if (r > 0.25) discard;
    float alpha = (0.25 - r) * 4.0 * 0.5;
    gl_FragColor = vec4(0.78, 0.88, 1.0, alpha);
  }
`

function createParticleField(): THREE.Points {
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * WRAP_BOX
    positions[i * 3 + 1] = (Math.random() - 0.5) * WRAP_BOX
    positions[i * 3 + 2] = (Math.random() - 0.5) * WRAP_BOX
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const mat = new THREE.ShaderMaterial({
    vertexShader: particleVert,
    fragmentShader: particleFrag,
    uniforms: {
      uCameraPos:  { value: new THREE.Vector3() },
      uFlowOffset: { value: new THREE.Vector3() },
      uBoxSize:    { value: WRAP_BOX },
      uTime:       { value: 0 },
    },
    transparent: true,
    depthWrite: false,
  })

  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false   // wrapping puts particles anywhere — don't cull
  points.visible = false
  return points
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createEnvironment(scene: THREE.Scene): EnvironmentLayer {
  const groundGrid = createGroundGrid()
  const particles  = createParticleField()
  scene.add(groundGrid)
  scene.add(particles)
  return {
    groundGrid,
    particles,
    _flowOffset:        new THREE.Vector3(),
    _flowVelocityLocal: new THREE.Vector3(),
    _prevElapsedMs:     -1,
  }
}

/**
 * Apply the correct orientation to the environment objects for the active display frame,
 * and compute the particle flow velocity (relative wind) in the particles' local space.
 *
 * Flow velocity:
 *   Body mode   — local space IS body space. Flow = −V_body_threejs (relative wind
 *                 streams particles from nose to tail past the fixed aircraft).
 *   Inertial    — local space IS world space. Flow = −V_inertial_threejs (particles
 *                 drift opposite to the aircraft's inertial velocity).
 *
 * Call this from updateVisualization() alongside the compassLabels quaternion update.
 */
export function setEnvironmentFrame(
  env: EnvironmentLayer,
  frameMode: 'body' | 'inertial',
  bodyQuat: THREE.Quaternion,
  alpha_deg: number,
  beta_deg: number,
  airspeed: number,
): void {
  const DEG2RAD = Math.PI / 180
  const a = alpha_deg * DEG2RAD
  const b = beta_deg  * DEG2RAD

  // Body-frame velocity in NED, converted inline to Three.js (NED x→Z, y→-X, z→-Y).
  // Scale from real m/s to scene-units/s.
  const s = airspeed * SCENE_SCALE
  const V_body_threejs = new THREE.Vector3(
    -Math.sin(b)              * s,   // Three.js X = −NED east
    -Math.sin(a) * Math.cos(b) * s,   // Three.js Y = −NED down
     Math.cos(a) * Math.cos(b) * s,   // Three.js Z =  NED north
  )

  if (frameMode === 'inertial') {
    env.groundGrid.quaternion.copy(LAY_FLAT_QUAT)
    env.particles.quaternion.identity()
    // Flow in world space = rotate body velocity to inertial, then negate
    env._flowVelocityLocal.copy(V_body_threejs).applyQuaternion(bodyQuat).negate()
  } else {
    const invQuat = bodyQuat.clone().invert()
    env.groundGrid.quaternion.multiplyQuaternions(invQuat, LAY_FLAT_QUAT)
    env.particles.quaternion.copy(invQuat)
    // Flow in body space = negate body velocity directly (relative wind)
    env._flowVelocityLocal.copy(V_body_threejs).negate()
  }
}

/**
 * Call once per rAF frame. Integrates flow velocity into the offset accumulator
 * and updates particle shader uniforms.
 */
export function updateEnvironment(
  env: EnvironmentLayer,
  camera: THREE.Camera,
  elapsedMs: number,
): void {
  if (!env.particles.visible) return

  // ── dt integration ──
  const dt = env._prevElapsedMs < 0 ? 0 : (elapsedMs - env._prevElapsedMs) / 1000
  env._prevElapsedMs = elapsedMs

  // Accumulate flow offset, then wrap each axis to [0, WRAP_BOX) to prevent
  // float precision drift over long flights.
  if (dt > 0 && dt < 0.5) {   // guard against tab-hidden stalls
    env._flowOffset.addScaledVector(env._flowVelocityLocal, dt)
    env._flowOffset.x = ((env._flowOffset.x % WRAP_BOX) + WRAP_BOX) % WRAP_BOX
    env._flowOffset.y = ((env._flowOffset.y % WRAP_BOX) + WRAP_BOX) % WRAP_BOX
    env._flowOffset.z = ((env._flowOffset.z % WRAP_BOX) + WRAP_BOX) % WRAP_BOX
  }

  // ── Shader uniforms ──
  const mat = env.particles.material as THREE.ShaderMaterial

  // Camera position in the particles' local space (rotated coordinate system).
  const localCam = camera.position.clone()
    .applyQuaternion(env.particles.quaternion.clone().invert())
  mat.uniforms.uCameraPos.value.copy(localCam)
  mat.uniforms.uFlowOffset.value.copy(env._flowOffset)
  mat.uniforms.uTime.value = elapsedMs / 1000
}
