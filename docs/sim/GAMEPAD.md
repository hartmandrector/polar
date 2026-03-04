# Gamepad Mapping — Xbox Controller

Standard Xbox controller via browser Gamepad API.

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
| Left front riser | Left stick forward | 0–1 | Push forward = pull fronts |
| Left rear riser | Left stick back | 0–1 | Pull back = pull rears |
| Right front riser | Right stick forward | 0–1 | Push forward = pull fronts |
| Right rear riser | Right stick back | 0–1 | Pull back = pull rears |
| Lateral weight shift | Left stick X | −1 to +1 | Right = shift right |
| Twist recovery | Right stick X | −1 to +1 | Counter-torque for line twists |

**Pilot coupling (3-DOF):**
- **Pitch**: No gamepad input — pendulum swings freely under gravity, coupled to canopy pitch acceleration
- **Lateral**: Left stick X → stiff spring tracks near-instantly (geometric harness deformation)
- **Twist**: Right stick X → weak counter-torque (~10% of line stiffness), effective for recovery from >90° twists

**Key behavior:** Brakes, risers, and pilot coupling inputs are all simultaneous. Stick Y splits into front/rear riser; stick X drives weight shift independently.

---

## Wingsuit Mapping

![Wingsuit yaw control via triggers](../../polar-visualizer/docs/gifs/sim-wingsuit-yaw.gif)

| Control | Input | Range | Direction |
|---------|-------|-------|-----------|
| Pitch throttle | Right stick Y (axis 3) | -1 to +1 | Forward = nose down |
| Roll throttle | Right stick X (axis 2) | -1 to +1 | Right = right roll |
| Yaw throttle | Triggers (LT−RT) | -1 to +1 | LT = yaw left, RT = yaw right |
| Orbit camera | Left stick | Spherical | Azimuthal + polar orbit around model |

![Wingsuit roll — requires active piloting](../../polar-visualizer/docs/gifs/sim-wingsuit-roll.gif)

---

## Button Mapping

| Button | Input | Action |
|--------|-------|--------|
| 9 | Menu (≡) | Start/Stop sim (edge-triggered) |
| 8 | View (☰☰) | Cycle view frame Body↔Inertial |
| 4 | LB | Previous polar |
| 5 | RB | Next polar |

All buttons are edge-triggered via `wasPressed` pattern — no repeat on hold.

---

## Scaling & Inversion

No magnitude scaling applied — raw axis values (post-deadzone) map 1:1 to control range.

| Control | Inverted? | Notes |
|---------|-----------|-------|
| Pitch throttle | TBD | May need sign flip after flight testing |
| Roll throttle | TBD | May need sign flip after flight testing |
| Yaw throttle | TBD | May need sign flip after flight testing |
| Brakes | No | Trigger 0→1 maps directly to brake 0→1 |
| Risers | No | Stick magnitude maps directly to riser 0→1 |

Update this table after testing confirms correct/inverted sense.

---

## Source

Implementation: `polar-visualizer/src/sim/sim-runner.ts`  
Functions: `readCanopyGamepad()`, `readWingsuitGamepad()`
