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

import type { SimState, SimConfig } from '../polar/sim-state.ts'
import type { FlightState } from '../ui/controls.ts'
import type { AeroSegment, SegmentControls } from '../polar/continuous-polar.ts'
import type { InertiaComponents } from '../polar/inertia.ts'
import type { Vec3NED } from '../polar/aero-segment.ts'
import { rk4Step } from '../polar/sim.ts'

// ─── Constants ──────────────────────────────────────────────────────────────

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

/** Physics timestep [s] — 200 Hz for stability */
const DT = 1 / 200

/** Max physics steps per frame to prevent spiral of death */
const MAX_STEPS_PER_FRAME = 10

// ─── Gamepad Input ──────────────────────────────────────────────────────────

export interface GamepadMapping {
  /** Axis index for pitch throttle (forward/back body) */
  pitchAxis: number
  /** Axis index for yaw throttle (lateral) */
  yawAxis: number
  /** Axis index for roll throttle (differential) */
  rollAxis: number
  /** Axis deadzone (0–1) */
  deadzone: number
}

const DEFAULT_GAMEPAD: GamepadMapping = {
  pitchAxis: 1,   // left stick Y
  yawAxis: 0,     // left stick X
  rollAxis: 2,    // right stick X
  deadzone: 0.08,
}

function applyDeadzone(value: number, deadzone: number): number {
  if (Math.abs(value) < deadzone) return 0
  const sign = Math.sign(value)
  return sign * (Math.abs(value) - deadzone) / (1 - deadzone)
}

function readGamepad(mapping: GamepadMapping): { pitch: number; yaw: number; roll: number } | null {
  const gamepads = navigator.getGamepads()
  const gp = gamepads[0] ?? gamepads[1] ?? gamepads[2] ?? gamepads[3]
  if (!gp) return null

  return {
    pitch: applyDeadzone(gp.axes[mapping.pitchAxis] ?? 0, mapping.deadzone),
    yaw: applyDeadzone(gp.axes[mapping.yawAxis] ?? 0, mapping.deadzone),
    roll: applyDeadzone(gp.axes[mapping.rollAxis] ?? 0, mapping.deadzone),
  }
}

// ─── State Initialization ───────────────────────────────────────────────────

/**
 * Build SimState from current FlightState (slider values).
 *
 * Maps α/β/airspeed/attitude into the 12-state body velocity + orientation.
 */
export function flightStateToSimState(fs: FlightState): SimState {
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
  private gamepadMapping: GamepadMapping
  private callbacks: SimRunnerCallbacks

  constructor(
    initialFlightState: FlightState,
    callbacks: SimRunnerCallbacks,
    gamepadMapping?: GamepadMapping,
  ) {
    this.simState = flightStateToSimState(initialFlightState)
    this.callbacks = callbacks
    this.gamepadMapping = gamepadMapping ?? DEFAULT_GAMEPAD
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

    // Read gamepad input and inject into controls
    const gamepadInput = readGamepad(this.gamepadMapping)
    const config = this.callbacks.getSimConfig()
    if (gamepadInput) {
      config.controls = {
        ...config.controls,
        pitchThrottle: gamepadInput.pitch,
        yawThrottle: gamepadInput.yaw,
        rollThrottle: gamepadInput.roll,
      }
    }

    // Fixed-timestep integration
    let accumulator = elapsed
    while (accumulator >= DT) {
      this.simState = rk4Step(this.simState, config, DT)
      accumulator -= DT
      this.simTime += DT
    }

    // Push updated state to viewer
    const base = this.callbacks.getBaseState()
    const updatedFlight = simStateToFlightState(this.simState, base)
    this.callbacks.onUpdate(updatedFlight)

    this.animFrameId = requestAnimationFrame(this.tick)
  }
}
