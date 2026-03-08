# Gamepad Mapping — Xbox Controller

Standard Xbox controller via browser Gamepad API. Vehicle-aware: auto-selects mapping from polar type.

## Axis / Button Reference

| Index | Input | Type |
|-------|-------|------|
| Axis 0 | Left stick X | -1 (left) to +1 (right) |
| Axis 1 | Left stick Y | -1 (up/forward) to +1 (down/back) |
| Axis 2 | Right stick X | -1 (left) to +1 (right) |
| Axis 3 | Right stick Y | -1 (up/forward) to +1 (down/back) |
| Button 6 | Left trigger | 0 (released) to 1 (full pull) |
| Button 7 | Right trigger | 0 (released) to 1 (full pull) |

Deadzone: 0.08 (values below this magnitude → 0)

---

## Canopy Mapping

| Control | Input | Range | Direction |
|---------|-------|-------|-----------|
| Left brake | Left trigger (btn 6) | 0–1 | Pull = brake |
| Right brake | Right trigger (btn 7) | 0–1 | Pull = brake |
| Front riser | Left stick forward | 0–1 | Push forward = pull fronts |
| Rear riser | Left stick back | 0–1 | Pull back = pull rears |
| Lateral weight shift | Left stick X | −1 to +1 | Right = shift right |
| Twist recovery | Right stick X | −1 to +1 | Counter-torque for line twists |

**Pilot coupling (3-DOF):**
- **Pitch**: No gamepad input — pendulum swings freely under gravity, coupled to canopy pitch acceleration
- **Lateral**: Left stick X → stiff spring tracks near-instantly (geometric harness deformation)
- **Twist**: Right stick X → weak counter-torque (~10% of line stiffness), effective for recovery from >90° twists

**Key behavior:** Brakes, risers, and pilot coupling inputs are all simultaneous. Stick Y splits into front/rear riser; stick X drives weight shift independently.

**Riser mapping note:** Forward=fronts, back=rears was initially coded backwards (left stick Y sign). Fixed — `Math.max(0, -leftY)` = fronts, `Math.max(0, leftY)` = rears.

---

## Wingsuit Mapping

![Wingsuit yaw control via triggers](../../polar-visualizer/docs/gifs/sim-wingsuit-yaw.gif)

| Control | Input | Range | Direction |
|---------|-------|-------|-----------|
| Pitch throttle | Right stick Y (axis 3) | -1 to +1 | Forward (push) = steeper/nose-down |
| Roll throttle | Right stick X (axis 2) | -1 to +1 | Right = right roll |
| Yaw throttle | Triggers (RT−LT) | -1 to +1 | RT = yaw right, LT = yaw left |
| Orbit camera | Left stick | Spherical | Azimuthal + polar orbit around model |

![Wingsuit roll](../../polar-visualizer/docs/gifs/sim-wingsuit-roll.gif)

**Pitch inversion:** Raw gamepad Y is inverted — forward (negative raw) maps to nose-down (positive pitch input). This matches flight intuition: push stick forward to dive.

---

## Button Mapping

| Button | Input | Action | Context |
|--------|-------|--------|---------|
| 9 | Start (≡) | Start/Stop sim | Edge-triggered, all phases |
| 8 | Back (☰☰) | Cycle view frame Body↔Inertial | Edge-triggered |
| 0 | A | Pilot chute toss | Freefall phase only — spawns PC sub-sim |

All buttons are edge-triggered via `wasPressed` pattern — no repeat on hold.

**Reserved (not yet implemented):** X = cutaway, Y/B = admin/mode selection.

---

## SVG Gamepad Visualization

The sim panel includes an SVG gamepad overlay that shows:
- **Stick circles**: deflection-colored dots (green center → red edge)
- **Trigger bars**: fill level with color gradient
- **Vehicle-aware labels**: auto-switch between wingsuit and canopy control names
- **Numeric axis values**: raw values below each stick

The visualization lives inside the phase box and auto-switches layout when vehicle type changes (e.g., at deployment transition). ModelType is read dynamically each HUD tick to prevent stale labels.

---

## Source

Implementation: `polar-visualizer/src/sim/sim-gamepad.ts`
Functions: `readCanopyGamepad()`, `readWingsuitGamepad()`
SVG visualization: `polar-visualizer/src/sim/sim-ui.ts`
