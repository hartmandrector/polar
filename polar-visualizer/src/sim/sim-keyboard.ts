/**
 * Keyboard input — gamepad-absent fallback for the main simulator.
 *
 * When no physical controller is connected, the keyboard drives the same
 * control interfaces the gamepad produces (WingsuitGamepadInput etc.), so the
 * sim runner and input filters downstream are unchanged.
 *
 * Mapping (wingsuit):
 *   ↑ / ↓        pitch steeper / flatter   (right stick Y)
 *   ← / →        roll left / right         (right stick X)
 *   Q / E        yaw left / right          (LT / RT)
 *   W A S D      camera orbit              (left stick)
 *   Z / X        zoom in / out             (L3 / R3 buttons)
 *   Space        start / stop              (Menu button)
 *   V            cycle view frame          (Back/View button)
 *   Enter        pilot chute toss          (A button)
 *   B            unzip                     (B button)
 *
 * Canopy / deploy reuse Q/E for brakes, arrows for risers + weight shift,
 * and B for unzip — enough to fly the scenario keyboard-only.
 */

import { Spherical, Vector3 } from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { WingsuitGamepadInput, CanopyGamepadInput, DeployGamepadInput } from './sim-gamepad.ts'
import { WingsuitInputFilter, WINGSUIT_KEYBOARD_FILTER_DEFAULTS } from './input-filter.ts'

// ─── Key state tracking ─────────────────────────────────────────────────────

/** Keys we own — used to decide when to preventDefault (avoid page scroll). */
const CONTROL_KEYS = new Set<string>([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'KeyV', 'KeyB',
  'Space', 'Enter',
])

const keysDown = new Set<string>()
const justPressed = new Set<string>()

/**
 * True only when focus is on a genuine text-editing control.
 * SELECTs, sliders, and buttons are intentionally excluded: flight keys
 * must take priority over dropdowns changing their selected option or
 * sliders nudging their value.
 */
function isEditingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  if (tag === 'INPUT') {
    // Only real text boxes need arrow-key protection; range/checkbox/radio do not.
    const type = (t as HTMLInputElement).type.toLowerCase()
    return type === 'text' || type === 'email' || type === 'password'
        || type === 'search' || type === 'url'  || type === 'number'
  }
  return tag === 'TEXTAREA' || t.isContentEditable
}

let listenersAttached = false

/** Attach global key listeners once. Safe to call multiple times. */
export function initKeyboard(): void {
  if (listenersAttached) return
  listenersAttached = true

  // Capture phase — our handler fires BEFORE any focused dropdown or slider
  // processes the key, so preventDefault() stops them from stealing arrow keys.
  window.addEventListener('keydown', (e) => {
    if (isEditingTarget(document.activeElement)) return
    if (!CONTROL_KEYS.has(e.code)) return
    e.preventDefault()
    e.stopPropagation()
    if (!keysDown.has(e.code)) justPressed.add(e.code)  // record transition only
    keysDown.add(e.code)
  }, { capture: true })

  window.addEventListener('keyup', (e) => {
    if (!CONTROL_KEYS.has(e.code)) return
    e.preventDefault()
    e.stopPropagation()
    keysDown.delete(e.code)
  }, { capture: true })

  // Clear held state if the window loses focus (prevents stuck keys).
  window.addEventListener('blur', () => {
    keysDown.clear()
  })
}

export function isKeyDown(code: string): boolean {
  return keysDown.has(code)
}

/** Edge-triggered: returns true once per physical press of `code`. */
export function consumeKeyPress(code: string): boolean {
  if (justPressed.has(code)) {
    justPressed.delete(code)
    return true
  }
  return false
}

// ─── Raw control readers ────────────────────────────────────────────────────

const ax = (pos: string, neg: string): number =>
  (isKeyDown(pos) ? 1 : 0) - (isKeyDown(neg) ? 1 : 0)

/**
 * Raw wingsuit flight input from arrows + Q/E.
 * Signs match the gamepad convention so the runner's filter produces
 * identical flight results to the physical stick.
 */
export function readWingsuitKeyboardRaw(): WingsuitGamepadInput {
  return {
    // ↑ = steeper (gamepad: forward stick = +pitchThrottle)
    pitchThrottle: ax('ArrowUp', 'ArrowDown'),
    // gamepad rollThrottle = -rightStickX, and stick-right = "right roll".
    // So roll-right must be NEGATIVE rollThrottle → ArrowLeft − ArrowRight.
    rollThrottle: ax('ArrowLeft', 'ArrowRight'),
    // yawThrottle = LT − RT, LT = left. Q = left (+), E = right (−).
    yawThrottle: ax('KeyQ', 'KeyE'),
  }
}

/** Raw canopy input — Q/E brakes, arrows for risers + weight shift. */
export function readCanopyKeyboardRaw(): CanopyGamepadInput {
  const front = isKeyDown('ArrowUp') ? 1 : 0
  const rear = isKeyDown('ArrowDown') ? 1 : 0
  const shift = ax('ArrowRight', 'ArrowLeft')
  return {
    brakeLeft: isKeyDown('KeyQ') ? 1 : 0,
    brakeRight: isKeyDown('KeyE') ? 1 : 0,
    frontRiserLeft: front,
    frontRiserRight: front,
    rearRiserLeft: rear,
    rearRiserRight: rear,
    lateralShift: shift,
    twistInput: 0,
  }
}

/** Max riser range during deploy (matches sim-gamepad DEPLOY_RISER_RANGE). */
const DEPLOY_RISER_RANGE = 0.25

/** Raw deploy input — limited risers, weight shift, B = unzip. */
export function readDeployKeyboardRaw(): DeployGamepadInput {
  const front = (isKeyDown('ArrowUp') ? 1 : 0) * DEPLOY_RISER_RANGE
  const rear = (isKeyDown('ArrowDown') ? 1 : 0) * DEPLOY_RISER_RANGE
  const shift = ax('ArrowRight', 'ArrowLeft')
  return {
    frontRiserLeft: front,
    frontRiserRight: front,
    rearRiserLeft: rear,
    rearRiserRight: rear,
    lateralShift: shift,
    twistInput: 0,
    unzipPressed: isKeyDown('KeyB'),
  }
}

// ─── Camera orbit + zoom ────────────────────────────────────────────────────

const ORBIT_SPEED = 0.03      // matches gamepad ORBIT_SPEED
const ZOOM_SPEED = 0.02       // fraction of orbital radius per frame
const ZOOM_MIN = 1.5
const ZOOM_MAX = 200

/** Apply WASD camera orbit (wingsuit only — mirrors gamepad left stick). */
export function updateKeyboardOrbit(controls: OrbitControls): void {
  const dx = ax('KeyD', 'KeyA')   // right = +
  const dy = ax('KeyS', 'KeyW')   // down = +
  if (dx === 0 && dy === 0) return

  const offset = controls.object.position.clone().sub(controls.target)
  const spherical = new Spherical().setFromVector3(offset)
  spherical.theta += dx * ORBIT_SPEED
  spherical.phi   -= dy * ORBIT_SPEED
  spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi))
  offset.setFromSpherical(spherical)
  controls.object.position.copy(controls.target).add(offset)
  controls.object.lookAt(controls.target)
}

/**
 * Apply zoom from gamepad L3/R3 (buttons 10/11) and/or Z/X keys.
 * Works in all modes (camera-only, no physics effect).
 */
export function updateZoom(controls: OrbitControls): void {
  const gp = navigator.getGamepads()[0]
  const zoomIn  = (gp?.buttons[10]?.pressed ?? false) || isKeyDown('KeyZ')
  const zoomOut = (gp?.buttons[11]?.pressed ?? false) || isKeyDown('KeyX')
  if (zoomIn === zoomOut) return  // none or both → no change

  const offset = controls.object.position.clone().sub(controls.target)
  const spherical = new Spherical().setFromVector3(offset)
  spherical.radius *= zoomIn ? (1 - ZOOM_SPEED) : (1 + ZOOM_SPEED)
  spherical.radius = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, spherical.radius))
  offset.setFromSpherical(spherical)
  controls.object.position.copy(controls.target).add(new Vector3().copy(offset))
  controls.object.lookAt(controls.target)
}

// ─── Visualization feed ─────────────────────────────────────────────────────

/** Stick/trigger positions to drive the on-screen gamepad viz. */
export interface KeyboardVizAxes {
  lx: number; ly: number   // left stick (camera / risers)
  rx: number; ry: number   // right stick (pitch / roll)
  lt: number; rt: number   // triggers (yaw / brakes)
}

// Viz-only filter — independent of the runner's flight filter, since the viz
// updates even while the sim is stopped.
const vizFilter = new WingsuitInputFilter(WINGSUIT_KEYBOARD_FILTER_DEFAULTS)
let vizLastTime = 0

/**
 * EMA-smoothed wingsuit viz axes. Smoothing makes the dots glide like a real
 * stick. Left stick shows raw WASD deflection (camera is rate-controlled).
 * Computes its own dt so it tolerates variable call rates.
 */
export function getWingsuitKeyboardViz(): KeyboardVizAxes {
  const now = performance.now()
  const dt = vizLastTime === 0 ? 0.1 : Math.min(0.25, (now - vizLastTime) / 1000)
  vizLastTime = now

  const raw = readWingsuitKeyboardRaw()
  const f = vizFilter.apply(raw, dt)
  return {
    // Left stick = camera (raw WASD): D−A right, S−W down.
    lx: ax('KeyD', 'KeyA'),
    ly: ax('KeyS', 'KeyW'),
    // Right stick: invert flight values back to display positions.
    rx: -f.rollThrottle,
    ry: -f.pitchThrottle,
    lt: Math.max(0, f.yawThrottle),
    rt: Math.max(0, -f.yawThrottle),
  }
}

/** Canopy viz axes (raw — brakes/risers are near-binary). */
export function getCanopyKeyboardViz(): KeyboardVizAxes {
  const c = readCanopyKeyboardRaw()
  return {
    lx: c.lateralShift,
    ly: c.rearRiserLeft - c.frontRiserLeft,   // back = +, forward = −
    rx: 0,
    ry: c.rearRiserRight - c.frontRiserRight,
    lt: c.brakeLeft,
    rt: c.brakeRight,
  }
}
