# Pilot–Canopy 3-DOF Coupling

Extends the existing 1-DOF pitch pendulum to full 3-DOF relative rotation between pilot and canopy at the riser confluence point.

**Reference:** Slegers & Costello 2003 — two rigid bodies (canopy + payload) connected at confluence point with full relative rotation.

---

## State Variables

Current system: 12 (rigid body) + 2 (pitch pendulum) = 14 total.

| DOF | Angle | Rate | Status |
|-----|-------|------|--------|
| Pitch swing (fore/aft) | `thetaPilot` | `thetaPilotDot` | Exists in SimStateExtended |
| Lateral swing (weight shift) | `pilotRoll` | `pilotRollDot` | New |
| Line twist (relative yaw) | `pilotYaw` | `pilotYawDot` | New |

**New total: 18 state variables** (4 new: 2 angles + 2 rates).

---

## Spring-Damper Parameters

| Parameter | Axis | Notes |
|-----------|------|-------|
| `pitchSpring` | Pitch | Gravity restoring + line geometry |
| `pitchDamp` | Pitch | Line set damping |
| `lateralSpring` | Lateral | Same physics as pitch — gravity pendulum |
| `lateralDamp` | Lateral | Same physics as pitch |
| `twistSpring(θ)` | Twist | **Nonlinear** — weak near 0°, ramps with twist count |
| `twistDamp` | Twist | Line friction during rotation |
| `twistStiffeningAngle` | Twist | Onset of nonlinear ramp (~90°) |

Pitch and lateral are standard gravity-restoring pendulums — nearly identical math. Twist is the only new physics.

---

## Nonlinear Twist Spring

Real line twist behavior:
- **0–90°**: Almost no restoring force — lines twist freely
- **90–360°**: Progressive stiffening — lines bundle, effective riser length shortens
- **360°+**: Very stiff — lines locked, brake authority lost, canopy distortion

Model options:
- Piecewise linear with knee at `twistStiffeningAngle`
- Exponential: `k(θ) = k₀ · exp(|θ| / θ_ref)`
- Polynomial: `torque = k₁θ + k₃θ³` (captures the weak-then-strong behavior)

The shortening effect (twist reduces effective riser length, pulling pilot up toward canopy) is a secondary coupling — implement after basic twist dynamics work.

---

## Vehicle Assembly Parameters

Added to `VehicleDefinition`:

```
pivot: {
  riserLength: number       // meters — affects all 3 pendulum axes
  pitchSpring: number
  pitchDamp: number
  lateralSpring: number
  lateralDamp: number
  twistStiffness: number    // base torsional stiffness
  twistStiffeningAngle: number  // degrees — onset of nonlinear ramp
  twistDamp: number
  pilotTwistInertia: number // moment of inertia about twist axis (arms in vs out)
}
```

---

## Gamepad: Line Twist Recovery

Pilot counter-rotates by spreading risers and kicking.

| Input | Action |
|-------|--------|
| Face button (A/B) held | Direct counter-torque opposing current twist direction |
| Magnitude | Fixed or proportional to button pressure |
| Physics | Torque input in twist DOF — `τ_recovery = -sign(pilotYaw) * KICK_TORQUE` |

Auto-direction (always opposes current twist) is the simplest and most realistic — you always kick against the twist.

---

## Debug Sliders

| Slider | Range | Default |
|--------|-------|---------|
| Lateral spring | 0–50 | TBD |
| Lateral damp | 0–10 | TBD |
| Twist stiffness | 0–20 | TBD |
| Twist stiffening angle | 30–180° | 90° |
| Twist damp | 0–10 | TBD |

Pitch spring/damp already exist (or will when pendulum is wired).

---

## Implementation Phases

1. **Generalize pendulum to pitch + lateral** — copy pitch math to new axis, add `pilotRoll`/`pilotRollDot` to SimStateExtended, wire gravity restoring force
2. **Add twist with linear spring** — `pilotYaw`/`pilotYawDot`, constant spring, get coupling working
3. **Nonlinear twist spring** — tune stiffening curve to match real line twist behavior
4. **Gamepad recovery input** — face button → counter-torque
5. **Secondary effects** — riser shortening from twist, brake authority degradation

Phases 1–2 are mostly copy-paste from existing pendulum code. Phase 3 is the interesting physics. Phase 4 is a single button mapping.
