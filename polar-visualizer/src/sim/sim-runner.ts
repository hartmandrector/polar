/**
 * Real-time simulation runner.
 *
 * Bridges the 6DOF integrator (sim.ts) with the viewer.
 * Takes the current viewer state as initial conditions,
 * runs the physics loop at fixed timestep, and feeds
 * results back to updateVisualization().
 *
 * No Three.js dependency — communicates via FlightState.
 */

import type { SimState, SimConfig, SimStateExtended, PilotCouplingConfig } from '../polar/sim-state.ts'
import type { FlightState } from '../ui/controls.ts'
import { rk4Step } from '../polar/sim.ts'

// ─── Constants ──────────────────────────────────────────────────────────────

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

/** Physics timestep [s] — 200 Hz for stability */
const DT = 1 / 200

/** Max physics steps per frame to prevent spiral of death */
const MAX_STEPS_PER_FRAME = 10

// ─── Pilot Coupling Input Scaling ───────────────────────────────────────────

/** Lateral weight shift input torque scale [N·m] — stiff, tracks instantly */
const LATERAL_INPUT_SCALE = 50

/** Twist recovery input torque scale [N·m] — weak in normal flight, effective in twists */
const TWIST_INPUT_SCALE = 2

// ─── Gamepad Input ──────────────────────────────────────────────────────────

/**
 * Xbox controller axis/button indices (standard gamepad mapping):
 *   Axis 0: Left stick X    Axis 1: Left stick Y
 *   Axis 2: Right stick X   Axis 3: Right stick Y
 *   Button 6: Left trigger (analog 0–1)
 *   Button 7: Right trigger (analog 0–1)
 */

/** Deadzone — axes below this magnitude read as zero */
const DEADZONE = 0.08

function applyDeadzone(value: number, deadzone: number): number {
  if (Math.abs(value) < deadzone) return 0
  const sign = Math.sign(value)
  return sign * (Math.abs(value) - deadzone) / (1 - deadzone)
}

function getGamepad(): Gamepad | null {
  const gamepads = navigator.getGamepads()
  return gamepads[0] ?? gamepads[1] ?? gamepads[2] ?? gamepads[3] ?? null
}

/**
 * Wingsuit gamepad mapping:
 *   Right stick Y → pitch throttle (forward = nose down)
 *   Right stick X → roll throttle (right = right roll)
 *   Left stick X  → yaw throttle (right = yaw right)
 */
export interface WingsuitGamepadInput {
  pitchThrottle: number   // [-1, +1]
  yawThrottle: number     // [-1, +1]
  rollThrottle: number    // [-1, +1]
}

export function readWingsuitGamepad(): WingsuitGamepadInput | null {
  const gp = getGamepad()
  if (!gp) return null

  // Triggers: LT (button 6) = yaw left, RT (button 7) = yaw right
  const lt = gp.buttons[6]?.value ?? 0
  const rt = gp.buttons[7]?.value ?? 0

  return {
    pitchThrottle: -applyDeadzone(gp.axes[3] ?? 0, DEADZONE),  // right stick Y (inverted: forward = steeper)
    rollThrottle:  -applyDeadzone(gp.axes[2] ?? 0, DEADZONE),  // right stick X (inverted: right = right roll)
    yawThrottle:   lt - rt,                                     // triggers (inverted: LT=left, RT=right)
  }
}

/**
 * Canopy gamepad mapping:
 *   Left trigger  → left brake (0–1)
 *   Right trigger → right brake (0–1)
 *   Left stick Y  → left riser: forward = front, back = rear (0–1 each)
 *   Right stick Y → right riser: forward = front, back = rear (0–1 each)
 */
export interface CanopyGamepadInput {
  brakeLeft: number       // [0, 1]
  brakeRight: number      // [0, 1]
  frontRiserLeft: number  // [0, 1]
  frontRiserRight: number // [0, 1]
  rearRiserLeft: number   // [0, 1]
  rearRiserRight: number  // [0, 1]
  lateralShift: number    // [-1, +1] — left stick X: weight shift
  twistInput: number      // [-1, +1] — right stick X: twist recovery
}

export function readCanopyGamepad(): CanopyGamepadInput | null {
  const gp = getGamepad()
  if (!gp) return null

  // Triggers: button 6 (LT), button 7 (RT) — analog value 0–1
  const brakeLeft  = gp.buttons[6]?.value ?? 0
  const brakeRight = gp.buttons[7]?.value ?? 0

  // Sticks: Y axis negative = forward (pushed away from you)
  const leftY  = applyDeadzone(gp.axes[1] ?? 0, DEADZONE)
  const rightY = applyDeadzone(gp.axes[3] ?? 0, DEADZONE)

  // Lateral weight shift: left stick X
  const leftX  = applyDeadzone(gp.axes[0] ?? 0, DEADZONE)
  // Twist recovery: right stick X
  const rightX = applyDeadzone(gp.axes[2] ?? 0, DEADZONE)

  // Pull back (positive Y) = front risers (reach forward, pull A-lines down)
  // Push forward (negative Y) = rear risers (reach back, pull D-lines down)
  return {
    brakeLeft,
    brakeRight,
    frontRiserLeft:  Math.max(0, -leftY),   // push forward = front riser
    frontRiserRight: Math.max(0, -rightY),
    rearRiserLeft:   Math.max(0,  leftY),   // pull back = rear riser
    rearRiserRight:  Math.max(0,  rightY),
    lateralShift:    leftX,                   // left stick X: weight shift
    twistInput:      rightX,                  // right stick X: twist recovery
  }
}

// ─── State Initialization ───────────────────────────────────────────────────

/**
 * Build SimState from current FlightState (slider values).
 *
 * Maps α/β/airspeed/attitude into the 12-state body velocity + orientation.
 */
export function flightStateToSimState(fs: FlightState): SimStateExtended {
  const alpha = fs.alpha_deg * DEG
  const beta  = fs.beta_deg * DEG
  const V     = fs.airspeed

  // Body-axis velocities from airspeed + α + β
  // V_body = V * [cos α cos β, sin β, sin α cos β]
  const u = V * Math.cos(alpha) * Math.cos(beta)
  const v = V * Math.sin(beta)
  const w = V * Math.sin(alpha) * Math.cos(beta)

  return {
    x: 0, y: 0, z: -2000,  // Start at 2000m AGL (NED: z is negative for altitude)
    u, v, w,
    phi:   fs.roll_deg  * DEG,
    theta: fs.pitch_deg * DEG,
    psi:   fs.yaw_deg   * DEG,
    p: fs.phiDot_degps   * DEG,
    q: fs.thetaDot_degps * DEG,
    r: fs.psiDot_degps   * DEG,
    // Pilot coupling — start at equilibrium
    thetaPilot: 0,
    thetaPilotDot: 0,
    pilotRoll: 0,
    pilotRollDot: 0,
    pilotYaw: 0,
    pilotYawDot: 0,
  }
}

/**
 * Extract FlightState-compatible values from SimState for viewer update.
 *
 * The viewer reads α, β, airspeed, attitude, and rates from FlightState.
 * We compute those from the body velocity and Euler angles.
 */
export function simStateToFlightState(
  sim: SimState,
  base: FlightState,
): FlightState {
  const V = Math.sqrt(sim.u * sim.u + sim.v * sim.v + sim.w * sim.w)
  const alpha = V > 0.1 ? Math.atan2(sim.w, sim.u) : 0
  const beta  = V > 0.1 ? Math.asin(Math.max(-1, Math.min(1, sim.v / V))) : 0

  // Extract pilot coupling angles if present (SimStateExtended)
  const ext = sim as Partial<SimStateExtended>

  return {
    ...base,
    alpha_deg: alpha * RAD,
    beta_deg:  beta * RAD,
    airspeed:  V,
    roll_deg:  sim.phi   * RAD,
    pitch_deg: sim.theta * RAD,
    yaw_deg:   sim.psi   * RAD,
    phiDot_degps:   sim.p * RAD,
    thetaDot_degps: sim.q * RAD,
    psiDot_degps:   sim.r * RAD,
    // Pilot coupling → drives 3D model rotation via pilotPivot
    pilotPitch: (ext.thetaPilot ?? 0) * RAD,
  }
}

// ─── Sim Runner ─────────────────────────────────────────────────────────────

export interface SimRunnerCallbacks {
  /** Called each frame with the updated FlightState for the viewer */
  onUpdate: (state: FlightState) => void
  /** Called to get the current SimConfig (segments, inertia, mass, etc.) */
  getSimConfig: () => SimConfig
  /** Called to get the base FlightState (for non-physics fields like polarKey, modelType) */
  getBaseState: () => FlightState
}

export class SimRunner {
  private simState: SimState
  private running = false
  private animFrameId = 0
  private lastTime = 0
  private simTime = 0
  private modelType: 'wingsuit' | 'canopy' | 'skydiver' | 'airplane'
  private callbacks: SimRunnerCallbacks
  // Acceleration tracking (finite difference on inertial velocity)
  private prevGS = 0   // previous ground speed [m/s]
  private prevVS = 0   // previous vertical speed [m/s]
  private accH = 0     // horizontal acceleration [m/s²]
  private accV = 0     // vertical acceleration [m/s²]

  constructor(
    initialFlightState: FlightState,
    callbacks: SimRunnerCallbacks,
  ) {
    this.simState = flightStateToSimState(initialFlightState)
    this.callbacks = callbacks
    this.modelType = initialFlightState.modelType
  }

  /** Start the simulation loop */
  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.simTime = 0
    this.tick()
  }

  /** Stop the simulation loop */
  stop(): void {
    this.running = false
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = 0
    }
  }

  /** Is the simulation running? */
  get isRunning(): boolean { return this.running }

  /** Current simulation time [s] */
  get time(): number { return this.simTime }

  /** Current altitude AGL [m] (positive up) */
  get altitude(): number { return -this.simState.z }

  /** Current speed [m/s] */
  get speed(): number {
    return Math.sqrt(
      this.simState.u ** 2 +
      this.simState.v ** 2 +
      this.simState.w ** 2,
    )
  }

  /** Inertial velocity components [m/s] — NED Earth frame */
  get inertialVelocity(): { vn: number, ve: number, vd: number } {
    const { u, v, w, phi, theta, psi } = this.simState
    const cp = Math.cos(phi),   sp = Math.sin(phi)
    const ct = Math.cos(theta), st = Math.sin(theta)
    const cy = Math.cos(psi),   sy = Math.sin(psi)
    // DCM [EB] body → inertial (3-2-1 Euler)
    const vn = (ct*cy)*u + (sp*st*cy - cp*sy)*v + (cp*st*cy + sp*sy)*w
    const ve = (ct*sy)*u + (sp*st*sy + cp*cy)*v + (cp*st*sy - sp*cy)*w
    const vd = (-st)*u   + (sp*ct)*v             + (cp*ct)*w
    return { vn, ve, vd }
  }

  /** Horizontal ground speed [m/s] */
  get groundSpeed(): number {
    const { vn, ve } = this.inertialVelocity
    return Math.sqrt(vn * vn + ve * ve)
  }

  /** Vertical speed [m/s] (positive = descending) */
  get verticalSpeed(): number {
    return this.inertialVelocity.vd
  }

  /** Horizontal acceleration [m/s²] */
  get horizontalAccel(): number { return this.accH }

  /** Vertical acceleration [m/s²] (positive = increasing sink) */
  get verticalAccel(): number { return this.accV }

  /** Current SimState (read-only access for telemetry) */
  get state(): Readonly<SimState> { return this.simState }

  private tick = (): void => {
    if (!this.running) return

    const now = performance.now()
    let elapsed = (now - this.lastTime) / 1000  // seconds
    this.lastTime = now

    // Clamp to prevent spiral of death on tab switch / lag
    const maxElapsed = MAX_STEPS_PER_FRAME * DT
    if (elapsed > maxElapsed) elapsed = maxElapsed

    // Read gamepad input and inject into controls (vehicle-aware)
    const config = this.callbacks.getSimConfig()
    let gamepadFlightOverrides: Partial<FlightState> = {}

    if (this.modelType === 'canopy') {
      const gp = readCanopyGamepad()
      if (gp) {
        config.controls = {
          ...config.controls,
          brakeLeft: gp.brakeLeft,
          brakeRight: gp.brakeRight,
          frontRiserLeft: gp.frontRiserLeft,
          frontRiserRight: gp.frontRiserRight,
          rearRiserLeft: gp.rearRiserLeft,
          rearRiserRight: gp.rearRiserRight,
        }
        // Pass gamepad values through to FlightState so viewer renders brake flaps.
        // Use 'brakes' mode with brake values as the primary visible control.
        // Riser forces are computed correctly in the sim physics regardless.
        gamepadFlightOverrides = {
          canopyControlMode: 'brakes' as const,
          canopyLeftHand: gp.brakeLeft,
          canopyRightHand: gp.brakeRight,
        }
        // Inject pilot coupling gamepad inputs
        if (config.pilotCoupling) {
          config.pilotCoupling.lateralInputTorque =
            gp.lateralShift * LATERAL_INPUT_SCALE
          config.pilotCoupling.twistInputTorque =
            gp.twistInput * TWIST_INPUT_SCALE
        }
      }
    } else {
      // Wingsuit / skydiver / airplane — throttle controls
      const gp = readWingsuitGamepad()
      if (gp) {
        config.controls = {
          ...config.controls,
          pitchThrottle: gp.pitchThrottle,
          yawThrottle: gp.yawThrottle,
          rollThrottle: gp.rollThrottle,
        }
        gamepadFlightOverrides = {
          pitchThrottle: gp.pitchThrottle,
          yawThrottle: gp.yawThrottle,
          rollThrottle: gp.rollThrottle,
        }
      }
    }

    // Inject pilot coupling state into aero controls so segment factories
    // see the physics-computed pilot pitch (not the slider value)
    if (config.pilotCoupling) {
      const ext = this.simState as Partial<SimStateExtended>
      config.controls = {
        ...config.controls,
        pilotPitch: (ext.thetaPilot ?? 0) * RAD,
      }
    }

    // Fixed-timestep integration
    let accumulator = elapsed
    while (accumulator >= DT) {
      this.simState = rk4Step(this.simState, config, DT)
      accumulator -= DT
      this.simTime += DT
    }

    // Update acceleration (finite difference on inertial velocity)
    const gs = this.groundSpeed
    const vs = this.verticalSpeed
    if (elapsed > 0) {
      this.accH = (gs - this.prevGS) / elapsed
      this.accV = (vs - this.prevVS) / elapsed
    }
    this.prevGS = gs
    this.prevVS = vs

    // Push updated state to viewer — merge gamepad overrides so
    // updateVisualization sees the control inputs for rendering
    const base = this.callbacks.getBaseState()
    const updatedFlight = {
      ...simStateToFlightState(this.simState, base),
      ...gamepadFlightOverrides,
    }
    this.callbacks.onUpdate(updatedFlight)

    this.animFrameId = requestAnimationFrame(this.tick)
  }
}
