# Keyboard + Gamepad Controls — Planning Document

Scope: **Polar Visualizer (main sim, `/`)** — wingsuit-specific controls only.
This does not cover the GPS viewer.

---

## 1. Full Gamepad Inventory

### Axes (Xbox standard mapping)

| Axis | Physical control | Wingsuit | Canopy / Deploy |
|------|-----------------|----------|----------------|
| 0 | Left Stick X | Camera orbit azimuth | Lateral weight shift |
| 1 | Left Stick Y | Camera orbit elevation | Left riser (front/rear) |
| 2 | Right Stick X | Roll throttle (inverted) | Right riser twist |
| 3 | Right Stick Y | Pitch throttle (inverted) | Right riser (front/rear) |

### Buttons (Xbox standard mapping, all 17)

| # | Xbox label | Wingsuit | Canopy | Deploy | Available? |
|---|-----------|----------|--------|--------|-----------|
| 0 | A | Pilot chute toss (scenario) | — | — | ✅ partial |
| 1 | B | — | — | Unzip command | ✅ partial |
| 2 | X | — | — | — | ✅ **free** |
| 3 | Y | — | — | — | ✅ **free** |
| 4 | LB | — | — | — | ✅ **free** |
| 5 | RB | — | — | — | ✅ **free** |
| 6 | LT (analog) | Yaw left | Left brake | — (stowed) |  |
| 7 | RT (analog) | Yaw right | Right brake | — (stowed) |  |
| 8 | Back/View | Cycle view frame (all modes) | ← | ← | |
| 9 | Menu/Start | Toggle sim start/stop (all modes) | ← | ← | |
| 10 | L3 (left stick click) | — | — | — | ✅ **free** |
| 11 | R3 (right stick click) | — | — | — | ✅ **free** |
| 12 | D-Pad Up | — | — | — | ✅ **free** |
| 13 | D-Pad Down | — | — | — | ✅ **free** |
| 14 | D-Pad Left | — | — | — | ✅ **free** |
| 15 | D-Pad Right | — | — | — | ✅ **free** |
| 16 | Guide (Xbox) | (browser intercepts) | | | |

### Free buttons summary
**Definitively free for wingsuit:** 2 (X), 3 (Y), 4 (LB), 5 (RB), 10 (L3), 11 (R3), 12–15 (D-Pad)

---

## 2. Proposed New Gamepad Control: Zoom

Hold **L3 (button 10)** → zoom in (decrease orbital radius)
Hold **R3 (button 11)** → zoom out (increase orbital radius)

These are digital (pressed/not), so zoom is applied at a constant rate per frame while held, clamped to `[minDistance, maxDistance]` of OrbitControls.

**Wingsuit-only.** Canopy does not use left stick for camera, so L3/R3 would be dead there anyway — we could still allow zoom for canopy if desired, but it is lower priority.

### Possible D-Pad uses (future / optional)
The D-Pad being free opens up options (e.g., reset camera, step through scenario phases). Left for a later pass.

---

## 3. Keyboard Equivalent System

### Design principles
1. **EMA smoothing** on all flight-axis keys — same `emaStep()` already in `input-filter.ts`. Keys generate raw ±1 (held = 1, released = 0). EMA gives a "tapping to trim" feel.
2. **Camera orbit keys** (WASD) are NOT EMA-smoothed — orbit is a rate control already (additive delta per frame, same as gamepad).
3. **Zoom keys** (Z/X) are also rate control like gamepad.
4. Key state tracked in a `Set<string>` updated on `keydown`/`keyup` events.
5. The keyboard module feeds the **same `WingsuitGamepadInput` interface** as the gamepad reader, so the downstream EMA filter and sim runner are unchanged.

### Proposed keyboard mapping

#### Flight controls (EMA-smoothed, wingsuit only)

| Key | Gamepad equivalent | Action |
|-----|--------------------|--------|
| `↑` (ArrowUp) | Right Stick Y (−) | Pitch **steeper** (nose down / deeper glide) |
| `↓` (ArrowDown) | Right Stick Y (+) | Pitch **flatter** (nose up / shallower glide) |
| `←` (ArrowLeft) | Right Stick X (−) | Roll **left** |
| `→` (ArrowRight) | Right Stick X (+) | Roll **right** |
| `Q` | LT (button 6) | Yaw **left** |
| `E` | RT (button 7) | Yaw **right** |

#### Camera orbit (rate control, wingsuit only — mirrors left stick)

| Key | Gamepad equivalent | Action |
|-----|--------------------|--------|
| `W` | Left Stick Y (−) | Orbit camera **up** |
| `S` | Left Stick Y (+) | Orbit camera **down** |
| `A` | Left Stick X (−) | Orbit camera **left** |
| `D` | Left Stick X (+) | Orbit camera **right** |

#### Zoom (rate control)

| Key | Gamepad equivalent | Action |
|-----|--------------------|--------|
| `Z` | L3 (button 10) | **Zoom in** |
| `X` | R3 (button 11) | **Zoom out** |

#### Global / meta controls (DECIDED)

| Key | Gamepad equivalent | Action |
|-----|--------------------|--------|
| `Space` | Menu (button 9) | **Toggle sim start/stop** |
| `V` | Back/View (button 8) | **Cycle view frame** (Body ↔ Inertial) |
| `Enter` | A (button 0) | **Pilot chute toss** (scenario freefall only) |
| `B` | B (button 1) | **Unzip** (deploy/canopy phase) |

`Enter` chosen for pilot chute (matches user's other projects / muscle memory).
`B` chosen for unzip (the on-screen prompt reads "unzip with B").
No conflict with WASD camera orbit since neither `Enter` nor `B` is an orbit key.

---

## 4. EMA Time Constants for Keyboard

Keyboard inputs are binary — the EMA makes them feel like a stick being pushed gradually. Proposed τ values (seconds):

| Axis | τ (gamepad) | τ (keyboard, proposed) | Notes |
|------|-------------|----------------------|-------|
| Pitch | 0.12 s | 0.18 s | Slightly longer — tap-to-trim |
| Roll | 0.05 s | 0.10 s | Roll is fast even with keys |
| Yaw | 0.08 s | 0.12 s | Q/E held → smooth yaw |

These can be tuned after testing. Gamepad τ values unchanged.

---

## 5. Implementation Plan

### Files to create/modify

| File | Change |
|------|--------|
| `src/sim/sim-keyboard.ts` | **New** — `KeyboardInputState`, key set management, `readWingsuitKeyboard()` returning `WingsuitGamepadInput`, `readCameraKeyboard()`, `updateKeyboardOrbit()`, `updateKeyboardZoom()` |
| `src/sim/sim-ui.ts` | Add zoom loop (buttons 10/11 + Z/X), import keyboard module, merge keyboard + gamepad in the per-frame tick |
| `src/sim/sim-gamepad.ts` | No change to existing logic; possibly add `ZOOM_IN_BUTTON = 10`, `ZOOM_OUT_BUTTON = 11` constants |

### `sim-keyboard.ts` sketch

```typescript
// Key state
const keysDown = new Set<string>()
window.addEventListener('keydown', e => keysDown.add(e.code))
window.addEventListener('keyup',   e => keysDown.delete(e.code))

export function isKeyDown(code: string): boolean {
  return keysDown.has(code)
}

// Returns raw [-1,+1] inputs (before EMA); callers feed to WingsuitInputFilter
export function readWingsuitKeyboard(): WingsuitGamepadInput {
  return {
    pitchThrottle: (isKeyDown('ArrowUp') ? 1 : 0) - (isKeyDown('ArrowDown') ? 1 : 0),
    rollThrottle:  (isKeyDown('ArrowRight') ? 1 : 0) - (isKeyDown('ArrowLeft') ? 1 : 0),
    yawThrottle:   (isKeyDown('KeyQ') ? 1 : 0) - (isKeyDown('KeyE') ? -1 : 0),
    // Note: yaw is LT=left, RT=right → Q=left=+1, E=right=-1
  }
}

export function updateKeyboardOrbit(controls: OrbitControls): void {
  // same logic as updateGamepadOrbit but reads WASD keys
}

export function updateKeyboardZoom(controls: OrbitControls): void {
  // Z = zoom in (radius −), X = zoom out (radius +)
}
```

### Merging gamepad + keyboard in the tick

```typescript
// In the per-frame tick (or in readWingsuitGamepad callers):
const gpInput = readWingsuitGamepad()
const kbInput = getGamepad() ? null : readWingsuitKeyboard()  // keyboard fallback when no gamepad
const rawInput = gpInput ?? kbInput ?? { pitchThrottle: 0, rollThrottle: 0, yawThrottle: 0 }
// then feed rawInput through WingsuitInputFilter as before
```

Alternatively, always combine both (additive, clamped ±1) so gamepad and keyboard can be used simultaneously.

### Zoom in `updateGamepadOrbit` (or a separate `updateZoom`)

```typescript
// Add to updateGamepadOrbit (or call separately):
const ZOOM_IN_BUTTON  = 10
const ZOOM_OUT_BUTTON = 11
const ZOOM_SPEED = 0.02  // fraction of radius per frame

const zoomIn  = gp?.buttons[ZOOM_IN_BUTTON]?.pressed  || isKeyDown('KeyZ')
const zoomOut = gp?.buttons[ZOOM_OUT_BUTTON]?.pressed || isKeyDown('KeyX')

if (zoomIn || zoomOut) {
  const sph = new Spherical().setFromVector3(
    controls.object.position.clone().sub(controls.target)
  )
  sph.radius *= zoomIn ? (1 - ZOOM_SPEED) : (1 + ZOOM_SPEED)
  sph.radius = Math.max(controls.minDistance, Math.min(controls.maxDistance, sph.radius))
  controls.object.position.copy(controls.target).add(
    new Vector3().setFromSpherical(sph)
  )
  controls.object.lookAt(controls.target)
}
```

---

## 6. Resolved Decisions

1. **Pilot chute = `Enter`**, **Unzip = `B`** (decided). No `F`/`G`.
2. **Canopy keyboard:** added so scenario is fully playable keyboard-only:
   `Q`/`E` = L/R brakes (matches "unstow brakes with Q and E"),
   `←`/`→` = weight shift, `↑`/`↓` = front/rear risers (symmetric), `B` = unzip.
3. **Keyboard τ values:** 0.18 / 0.10 / 0.12 (pitch/roll/yaw). Liked.
4. **WASD camera orbit** (wingsuit) — confirmed.
5. **Zoom speed:** ZOOM_SPEED = 0.02. Clamp radius to `[1.5, 200]`
   (OrbitControls had no explicit min/max set; defaults were 0 / ∞).
6. **Keyboard is gamepad-absent fallback** — when a gamepad is connected it
   takes priority; keyboard activates only when `getGamepad()` is null. This
   avoids double-input. (Can switch to additive later if desired.)

## 6b. Gamepad Visualization Feeding (DECIDED)

The sim overlay's stick/trigger dots+bars stay visually identical. When no
gamepad is present, the **EMA-smoothed keyboard values** are injected into the
same `updateStick()` / `updateTrigger()` calls so the dots glide like a real
stick (tap-to-trim visible). A dedicated viz-only EMA filter lives in
`sim-keyboard.ts` (independent of the runner's flight filter, since the viz
runs even when the sim is stopped). Display mapping:

| Viz element | Keyboard source (smoothed) |
|-------------|---------------------------|
| Right stick X | roll throttle |
| Right stick Y | −pitch throttle |
| Triggers L/R | yaw throttle split (LT=left, RT=right) |
| Left stick (wingsuit) | raw WASD camera deflection (rate control, not smoothed) |
| Left stick / triggers (canopy) | riser / brake equivalents |

---

## 7. Summary Table — Final Proposed Mapping

| Gamepad | Xbox label | Keyboard | Wingsuit action |
|---------|-----------|----------|----------------|
| Axis 0 (L stick X) | ← → | `A` / `D` | Camera orbit azimuth |
| Axis 1 (L stick Y) | ↑ ↓ | `W` / `S` | Camera orbit elevation |
| Axis 2 (R stick X) | ← → | `←` / `→` | Roll left / right |
| Axis 3 (R stick Y) | ↑ ↓ | `↑` / `↓` | Pitch steeper / flatter |
| Button 6 (LT) | LT | `Q` | Yaw left |
| Button 7 (RT) | RT | `E` | Yaw right |
| Button 8 | Back/View | `V` | Cycle view frame |
| Button 9 | Menu/Start | `Space` | Toggle sim start/stop |
| Button 0 | A | `Enter` | Pilot chute toss |
| Button 1 | B | `B` | Unzip (deploy/canopy) |
| Button 10 | L3 | `Z` | Zoom in |
| Button 11 | R3 | `X` | Zoom out |
| Buttons 2–5 | X, Y, LB, RB | — | Unassigned |
| Buttons 12–15 | D-Pad | — | Unassigned |
