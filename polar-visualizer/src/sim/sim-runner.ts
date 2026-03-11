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
import { readWingsuitGamepad, readCanopyGamepad, readDeployGamepad } from './sim-gamepad.ts'
import { WingsuitDeploySim } from './deploy-wingsuit.ts'
import { CanopyDeployManager, computeCanopyIC } from './deploy-canopy.ts'
import type { WingsuitDeployRenderState, Vec3 } from './deploy-types.ts'
import { BridleChainSim } from './bridle-sim.ts'
import { bodyToInertial, v3add } from './vec3-util.ts'
import { getCanopyBridleAttachNED } from '../polar/polar-data.ts'

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

  const u = V * Math.cos(alpha) * Math.cos(beta)
  const v = V * Math.sin(beta)
  const w = V * Math.sin(alpha) * Math.cos(beta)

  return {
    x: 0, y: 0, z: -2000,
    u, v, w,
    phi:   fs.roll_deg  * DEG,
    theta: fs.pitch_deg * DEG,
    psi:   fs.yaw_deg   * DEG,
    p: fs.phiDot_degps   * DEG,
    q: fs.thetaDot_degps * DEG,
    r: fs.psiDot_degps   * DEG,
    thetaPilot: 0,
    thetaPilotDot: 0,
    pilotRoll: 0,
    pilotRollDot: 0,
    pilotYaw: 0,
    pilotYawDot: 0,
    gravBodyX: -Math.sin(fs.pitch_deg * DEG),
    gravBodyY: Math.cos(fs.pitch_deg * DEG) * Math.sin(fs.roll_deg * DEG),
    gravBodyZ: Math.cos(fs.pitch_deg * DEG) * Math.cos(fs.roll_deg * DEG),
  }
}

/**
 * Extract FlightState-compatible values from SimState for viewer update.
 */
export function simStateToFlightState(
  sim: SimState,
  base: FlightState,
): FlightState {
  const V = Math.sqrt(sim.u * sim.u + sim.v * sim.v + sim.w * sim.w)
  const alpha = V > 0.1 ? Math.atan2(sim.w, sim.u) : 0
  const beta  = V > 0.1 ? Math.asin(Math.max(-1, Math.min(1, sim.v / V))) : 0

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
    pilotPitch: (ext.thetaPilot ?? 0) * RAD,
    lineTwist: (ext.pilotYaw ?? 0) * RAD,
  }
}

// ─── Sim Runner ─────────────────────────────────────────────────────────────

export interface SimRunnerCallbacks {
  onUpdate: (state: FlightState) => void
  getSimConfig: () => SimConfig
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
  private prevGS = 0
  private prevVS = 0
  private accH = 0
  private accV = 0

  /** Wingsuit deployment sub-sim — active after PC toss */
  private wsDeploy: WingsuitDeploySim | null = null
  /** Cached render state from deploy sub-sim (updated each frame) */
  private wsDeployRender: WingsuitDeployRenderState | null = null
  /** Canopy deploy manager — active after line stretch */
  private canopyDeploy: CanopyDeployManager | null = null

  /** Standalone bridle chain — persists from deploy through canopy flight */
  private bridleChain: BridleChainSim | null = null

  /** Canopy polar key to switch to at line stretch (set from scenario) */
  private canopyPolarKey: string | null = null

  constructor(
    initialFlightState: FlightState,
    callbacks: SimRunnerCallbacks,
  ) {
    this.simState = flightStateToSimState(initialFlightState)
    this.callbacks = callbacks
    this.modelType = initialFlightState.modelType
    // Store canopy polar key from scenario for transition
    this.canopyPolarKey = (initialFlightState as any).scenarioCanopyPolar ?? null
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.simTime = 0
    this.tick()
  }

  stop(): void {
    this.running = false
    this.wsDeploy = null
    this.bridleChain = null
    this.wsDeployRender = null
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = 0
    }
  }

  get isRunning(): boolean { return this.running }
  get time(): number { return this.simTime }
  get altitude(): number { return -this.simState.z }

  get speed(): number {
    return Math.sqrt(
      this.simState.u ** 2 +
      this.simState.v ** 2 +
      this.simState.w ** 2,
    )
  }

  get inertialVelocity(): { vn: number, ve: number, vd: number } {
    const { u, v, w, phi, theta, psi } = this.simState
    const cp = Math.cos(phi),   sp = Math.sin(phi)
    const ct = Math.cos(theta), st = Math.sin(theta)
    const cy = Math.cos(psi),   sy = Math.sin(psi)
    const vn = (ct*cy)*u + (sp*st*cy - cp*sy)*v + (cp*st*cy + sp*sy)*w
    const ve = (ct*sy)*u + (sp*st*sy + cp*cy)*v + (cp*st*sy - sp*cy)*w
    const vd = (-st)*u   + (sp*ct)*v             + (cp*ct)*w
    return { vn, ve, vd }
  }

  get groundSpeed(): number {
    const { vn, ve } = this.inertialVelocity
    return Math.sqrt(vn * vn + ve * ve)
  }

  get verticalSpeed(): number { return this.inertialVelocity.vd }
  get horizontalAccel(): number { return this.accH }
  get verticalAccel(): number { return this.accV }
  get state(): Readonly<SimState> { return this.simState }

  /** Wingsuit deployment render state (read-only, for HUD + renderer) */
  get deployRenderState(): Readonly<WingsuitDeployRenderState> | null { return this.wsDeployRender }

  /** Line twist angle [deg] — pilot yaw relative to canopy */
  get lineTwist(): number {
    const ext = this.simState as Partial<SimStateExtended>
    return (ext.pilotYaw ?? 0) * RAD
  }

  /** Line twist rate [deg/s] */
  get lineTwistRate(): number {
    const ext = this.simState as Partial<SimStateExtended>
    return (ext.pilotYawDot ?? 0) * RAD
  }

  /** Spawn the PC — called on A button during freefall */
  tossPilotChute(): void {
    if (this.wsDeploy) return
    this.wsDeploy = new WingsuitDeploySim(this.simState)
    console.log(`[SimRunner] PC tossed at t=${this.simTime.toFixed(2)}s`)
  }

  get isDeploying(): boolean { return this.wsDeploy !== null && this.wsDeploy.phase !== 'line_stretch' }
  get hasLineStretched(): boolean { return this.wsDeploy?.phase === 'line_stretch' }
  get canopyDeployState() { return this.canopyDeploy?.state ?? null }

  private tick = (): void => {
    if (!this.running) return

    const now = performance.now()
    let elapsed = (now - this.lastTime) / 1000
    this.lastTime = now

    const maxElapsed = MAX_STEPS_PER_FRAME * DT
    if (elapsed > maxElapsed) elapsed = maxElapsed

    // Read gamepad + inject controls
    const config = this.callbacks.getSimConfig()
    let gamepadFlightOverrides: Partial<FlightState> = {}

    if (this.modelType === 'canopy') {
      const isDeployPhase = this.canopyDeploy && !this.canopyDeploy.hasFullControls

      if (isDeployPhase) {
        // ── Deploy gamepad: limited controls, brakes stowed ──
        const gp = readDeployGamepad()
        if (gp) {
          // B button → trigger unzip
          if (gp.unzipPressed) {
            this.canopyDeploy!.triggerUnzip()
          }

          // Riser range expands during unzip (25% → 100%)
          const riserMul = this.canopyDeploy!.riserRange
          // Brake access unlocks during unzip (0% → 100%)
          const brakeAccess = this.canopyDeploy!.brakeAccess

          // Read full canopy gamepad for brake triggers during unzip transition
          const fullGp = readCanopyGamepad()
          const brakeL = (fullGp?.brakeLeft ?? 0) * brakeAccess
          const brakeR = (fullGp?.brakeRight ?? 0) * brakeAccess

          config.controls = {
            ...config.controls,
            brakeLeft: brakeL,
            brakeRight: brakeR,
            frontRiserLeft: gp.frontRiserLeft * (riserMul / 0.25),  // scale up from 25% base
            frontRiserRight: gp.frontRiserRight * (riserMul / 0.25),
            rearRiserLeft: gp.rearRiserLeft * (riserMul / 0.25),
            rearRiserRight: gp.rearRiserRight * (riserMul / 0.25),
            weightShiftLR: gp.lateralShift,
          }
          gamepadFlightOverrides = {
            canopyControlMode: 'brakes' as const,
            canopyLeftHand: brakeL,
            canopyRightHand: brakeR,
          }
          if (config.pilotCoupling) {
            config.pilotCoupling.lateralInputTorque = gp.lateralShift * LATERAL_INPUT_SCALE
            config.pilotCoupling.twistInputTorque = gp.twistInput * TWIST_INPUT_SCALE
          }
        }
      } else {
        // ── Full canopy gamepad: all controls available ──
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
            weightShiftLR: gp.lateralShift,
          }
          gamepadFlightOverrides = {
            canopyControlMode: 'brakes' as const,
            canopyLeftHand: gp.brakeLeft,
            canopyRightHand: gp.brakeRight,
          }
          if (config.pilotCoupling) {
            config.pilotCoupling.lateralInputTorque = gp.lateralShift * LATERAL_INPUT_SCALE
            config.pilotCoupling.twistInputTorque = gp.twistInput * TWIST_INPUT_SCALE
          }
        }
      }
    } else {
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

    if (config.pilotCoupling) {
      // Pilot pendulum is cosmetic — do NOT feed thetaPilot back into
      // the canopy aero model. This avoids a feedback loop where pilot
      // drag changes destabilize the canopy during turns.
      // const ext = this.simState as Partial<SimStateExtended>
      // config.controls = { ...config.controls, pilotPitch: (ext.thetaPilot ?? 0) * RAD }
    }

    // Wire unzip progress into aero controls (wingsuit → slick drag morph)
    if (this.canopyDeploy) {
      config.controls = {
        ...config.controls,
        unzip: this.canopyDeploy.state.unzipProgress,
      }
    }

    // Fixed-timestep integration
    let accumulator = elapsed
    while (accumulator >= DT) {
      this.simState = rk4Step(this.simState, config, DT)

      // Step wingsuit deployment sub-sim
      if (this.wsDeploy && this.wsDeploy.phase !== 'line_stretch') {
        const hitLineStretch = this.wsDeploy.step(DT, this.simState, config.rho)
        if (hitLineStretch) {
          console.log(`[SimRunner] Line stretch at t=${this.simTime.toFixed(2)}s`)
          if (this.wsDeploy.snapshot) {
            this.wsDeploy.snapshot.time = this.simTime

            // ── Create standalone bridle for PC persistence ──
            const chain = this.wsDeploy.getChainState()
            this.bridleChain = new BridleChainSim(chain.pcPos, chain.pcVel, chain.segments)

            // ── Canopy handoff ──────────────────────────────────────
            const canopyIC = computeCanopyIC(this.wsDeploy.snapshot)
            console.log(`[SimRunner] Canopy IC: θ=${(canopyIC.theta * RAD).toFixed(1)}° ψ=${(canopyIC.psi * RAD).toFixed(1)}° twist=${(canopyIC.pilotYaw * RAD).toFixed(0)}°`)

            // Inject canopy state
            this.simState = { ...canopyIC }

            // Switch to canopy model
            this.modelType = 'canopy'
            this.canopyDeploy = new CanopyDeployManager()

            console.log(`[SimRunner] Switched to canopy — deploy=${this.canopyDeploy.state.deploy.toFixed(2)}, brakes=${(this.canopyDeploy.state.brakeLeft * 100).toFixed(0)}%`)
          }
        }
      }

      // Step bridle chain during canopy flight (PC persistence)
      if (this.bridleChain && this.modelType === 'canopy') {
        const { x, y, z, u, v, w, phi, theta, psi } = this.simState
        const bodyVel: Vec3 = { x: u, y: v, z: w }
        const inertialVel = bodyToInertial(bodyVel, phi, theta, psi)
        // Bridle attaches at canopy top (bridleTop landmark) — body frame offset
        const attachBody = getCanopyBridleAttachNED()
        const attachInertial = v3add(
          { x, y, z },
          bodyToInertial(attachBody, phi, theta, psi),
        )
        this.bridleChain.step(attachInertial, inertialVel, config.rho, DT)
      }

      // Step canopy deployment inflation (airspeed-driven)
      if (this.canopyDeploy && !this.canopyDeploy.state.fullyInflated) {
        const { u, v, w } = this.simState
        const airspeed = Math.sqrt(u * u + v * v + w * w)
        this.canopyDeploy.step(DT, airspeed)
      }

      // Step unzip progress
      if (this.canopyDeploy) {
        this.canopyDeploy.stepUnzip(DT)
      }

      accumulator -= DT
      this.simTime += DT
    }

    // Update deploy render state (from wrapper during wingsuit, from chain during canopy)
    if (this.wsDeploy && this.modelType !== 'canopy') {
      this.wsDeployRender = this.wsDeploy.getRenderState(this.simState)
    } else if (this.bridleChain && this.modelType === 'canopy') {
      const bodyPos: Vec3 = { x: this.simState.x, y: this.simState.y, z: this.simState.z }
      const br = this.bridleChain.getRenderState(bodyPos)
      this.wsDeployRender = {
        phase: br.phase,
        pcPosition: br.pcPosition,
        pcCD: br.pcCD,
        segments: br.segments,
        canopyBag: br.canopyBag,
        bridleTension: br.bridleTension,
        pinTension: br.pinTension,
        bagTension: br.bagTension,
        chainDistance: br.chainDistance,
        bagDistance: br.bagDistance,
      }
    }

    // Acceleration tracking
    const gs = this.groundSpeed
    const vs = this.verticalSpeed
    if (elapsed > 0) {
      this.accH = (gs - this.prevGS) / elapsed
      this.accV = (vs - this.prevVS) / elapsed
    }
    this.prevGS = gs
    this.prevVS = vs

    // Push to viewer
    const base = this.callbacks.getBaseState()
    const deployRender = this.wsDeployRender
    const updatedFlight = {
      ...simStateToFlightState(this.simState, base),
      ...gamepadFlightOverrides,
      // Deploy state for rendering
      ...(deployRender ? {
        deployPCPosition: deployRender.pcPosition,
        deployPCDistance: deployRender.chainDistance,
        deployPhase: deployRender.phase,
        deployBridleStretched: deployRender.bridleTension > 5,
        deployLineStretched: deployRender.phase === 'line_stretch',
        deployRenderState: deployRender,
      } : {}),
      // Canopy deploy state (overrides deploy slider, model, and polar)
      ...(this.canopyDeploy ? {
        deploy: this.canopyDeploy.state.deploy,
        delta: this.canopyDeploy.state.unzipProgress,  // drives ctrl.unzip via buildSegmentControls
        modelType: 'canopy' as const,
        canopyDeployState: this.canopyDeploy.state,
        ...(this.canopyPolarKey ? { polarKey: this.canopyPolarKey } : {}),
      } : {}),
    }
    this.callbacks.onUpdate(updatedFlight)

    this.animFrameId = requestAnimationFrame(this.tick)
  }
}
