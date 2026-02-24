# Constraint Modes — Per-DOF Simulation Control

Each degree of freedom in the simulation can operate in one of three modes:

| Mode | Driver | Example |
|------|--------|---------|
| **Simulated** | Physics integration (EOM) | Pilot pitch as pendulum |
| **Locked** | Slider value held constant | Fixed pilot pitch at 5° |
| **Gamepad** | Real-time controller input | Brake toggles via triggers |

## DOF Table

| DOF | Current Mode | Target Modes | Notes |
|-----|-------------|--------------|-------|
| Translational (u,v,w) | Simulated | Simulated | Always integrated |
| Rotational (p,q,r) | Simulated | Simulated | Always integrated |
| Euler angles (φ,θ,ψ) | Simulated | Simulated | Always integrated |
| Pilot pitch | **Locked** | Locked / Simulated | Pendulum via `SimStateExtended.thetaPilot` |
| Deploy fraction | **Locked** | Locked / Simulated | Future: deployment sequence |
| Brake L/R | **Gamepad** | Gamepad / Locked | Canopy: triggers |
| Front riser L/R | **Gamepad** | Gamepad / Locked | Canopy: stick forward |
| Rear riser L/R | **Gamepad** | Gamepad / Locked | Canopy: stick back |
| Pitch throttle | **Gamepad** | Gamepad / Locked | Wingsuit: right stick Y |
| Roll throttle | **Gamepad** | Gamepad / Locked | Wingsuit: right stick X |
| Yaw throttle | **Gamepad** | Gamepad / Locked | Wingsuit: left stick X |
| Weight shift | **Locked** | Locked / Gamepad | Not wired yet |
| Dihedral | **Locked** | Locked / Gamepad | Wingsuit wing sweep |

## Priority

When multiple sources provide input for the same DOF:

```
Gamepad (if connected + above deadzone)  →  wins
Slider (if locked mode)                  →  wins when no gamepad
Simulated (if enabled)                   →  physics drives it
```

Gamepad always overrides slider. Simulated mode ignores both — the integrator owns the value. A DOF can't be both simulated and gamepad-driven.

## Implementation

Each DOF mode is a simple enum stored in the sim runner:

```typescript
type ConstraintMode = 'simulated' | 'locked' | 'gamepad'
```

The sim loop checks mode per-DOF before each integration step:
- **Simulated**: integrate normally, write result to state
- **Locked**: read slider value, inject into config, skip integration for this DOF
- **Gamepad**: read controller, inject into config, skip integration

## Pilot Pitch Pendulum (First Simulated DOF)

`SimStateExtended` already defines `thetaPilot` + `thetaPilotDot`. When pilot pitch mode = simulated:

1. Compute gravity torque on pilot mass about pivot point
2. Compute aerodynamic torque from pilot-attached segments
3. Integrate `thetaPilotDot` → `thetaPilot`
4. Feed `thetaPilot` into mass segment rotation (existing `rotatePilotMass()`)
5. Recompute CG + inertia each step (already supported)

When locked: `thetaPilot` = slider value, no integration.

## Adding New Constrained DOFs

1. Add entry to DOF table above
2. Add `ConstraintMode` field to sim runner config
3. Wire the three-way check into the integration loop
4. Document gamepad mapping in [GAMEPAD.md](GAMEPAD.md) if applicable
5. Update this doc
