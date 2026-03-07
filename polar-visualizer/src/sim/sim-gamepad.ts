/**
 * Vehicle-aware gamepad input reading.
 *
 * Xbox controller mapping with deadzone. Separated from sim-runner
 * to keep input logic isolated and reusable.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/** Deadzone — axes below this magnitude read as zero */
const DEADZONE = 0.08

// ─── Helpers ────────────────────────────────────────────────────────────────

function applyDeadzone(value: number, deadzone: number): number {
  if (Math.abs(value) < deadzone) return 0
  const sign = Math.sign(value)
  return sign * (Math.abs(value) - deadzone) / (1 - deadzone)
}

export function getGamepad(): Gamepad | null {
  const gamepads = navigator.getGamepads()
  return gamepads[0] ?? gamepads[1] ?? gamepads[2] ?? gamepads[3] ?? null
}

// ─── Wingsuit Gamepad ───────────────────────────────────────────────────────

/**
 * Wingsuit gamepad mapping:
 *   Right stick Y → pitch throttle (forward = nose down)
 *   Right stick X → roll throttle (right = right roll)
 *   Triggers → yaw throttle (LT = left, RT = right)
 *   Left stick → orbit camera (freed for wingsuit)
 */
export interface WingsuitGamepadInput {
  pitchThrottle: number   // [-1, +1]
  yawThrottle: number     // [-1, +1]
  rollThrottle: number    // [-1, +1]
}

export function readWingsuitGamepad(): WingsuitGamepadInput | null {
  const gp = getGamepad()
  if (!gp) return null

  const lt = gp.buttons[6]?.value ?? 0
  const rt = gp.buttons[7]?.value ?? 0

  return {
    pitchThrottle: -applyDeadzone(gp.axes[3] ?? 0, DEADZONE),  // right stick Y (inverted: forward = steeper)
    rollThrottle:  -applyDeadzone(gp.axes[2] ?? 0, DEADZONE),  // right stick X (inverted: right = right roll)
    yawThrottle:   lt - rt,                                     // triggers (LT=left, RT=right)
  }
}

// ─── Canopy Gamepad ─────────────────────────────────────────────────────────

/**
 * Canopy gamepad mapping:
 *   Left trigger  → left brake (0–1)
 *   Right trigger → right brake (0–1)
 *   Left stick Y  → left riser: forward = front, back = rear (0–1 each)
 *   Right stick Y → right riser: forward = front, back = rear (0–1 each)
 *   Left stick X  → lateral weight shift
 *   Right stick X → twist recovery
 */
export interface CanopyGamepadInput {
  brakeLeft: number       // [0, 1]
  brakeRight: number      // [0, 1]
  frontRiserLeft: number  // [0, 1]
  frontRiserRight: number // [0, 1]
  rearRiserLeft: number   // [0, 1]
  rearRiserRight: number  // [0, 1]
  lateralShift: number    // [-1, +1]
  twistInput: number      // [-1, +1]
}

export function readCanopyGamepad(): CanopyGamepadInput | null {
  const gp = getGamepad()
  if (!gp) return null

  const brakeLeft  = gp.buttons[6]?.value ?? 0
  const brakeRight = gp.buttons[7]?.value ?? 0

  const leftY  = applyDeadzone(gp.axes[1] ?? 0, DEADZONE)
  const rightY = applyDeadzone(gp.axes[3] ?? 0, DEADZONE)
  const leftX  = applyDeadzone(gp.axes[0] ?? 0, DEADZONE)
  const rightX = applyDeadzone(gp.axes[2] ?? 0, DEADZONE)

  return {
    brakeLeft,
    brakeRight,
    frontRiserLeft:  Math.max(0, -leftY),   // push forward = front riser
    frontRiserRight: Math.max(0, -rightY),
    rearRiserLeft:   Math.max(0,  leftY),   // pull back = rear riser
    rearRiserRight:  Math.max(0,  rightY),
    lateralShift:    leftX,
    twistInput:      rightX,
  }
}
