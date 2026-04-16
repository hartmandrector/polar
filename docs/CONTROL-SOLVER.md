# Control Solver — GPS Inversion System

Solves for pilot control inputs that explain measured angular accelerations from GPS data. Two vehicle modes (wingsuit, canopy) with mode-specific solvers, constraint systems, and visualization.

## Architecture

```
GPS Pipeline → Body Rates (p,q,r) → Angular Accels (ṗ,q̇,ṙ)
                                          │
                                          ▼
                              ┌─── Euler Rotation Eq ───┐
                              │  M_required = I·α̇ + ω×Iω │
                              └──────────┬──────────────┘
                                         │
                         ┌───────────────┼───────────────┐
                         │               │               │
                    Gravity Torque   Aero Model      Solver
                    (canopy only)    (neutral)     Newton-Raphson
                         │               │               │
                         ▼               ▼               ▼
                    M_gravity        M_aero(0)     Find u such that
                                                   M_aero(u) = M_req - M_grav
```

### Files

| File | Lines | Purpose |
|------|-------|---------|
| `control-solver.ts` | ~460 | Wingsuit + canopy solvers, constraint system |
| `moment-types.ts` | ~110 | Shared types: `VehicleMode`, `AxisMoments`, `CanopyControlMap` |
| `moment-inset.ts` | ~290 | 3D arc visualization, mode-aware with pluggable formatters |
| `moment-wingsuit.ts` | ~65 | Wingsuit legend: ±100% bipolar pitch/roll/yaw bars |
| `moment-canopy.ts` | ~110 | Canopy legend: 0–100% unipolar brake/riser bars + control→axis mapping |
| `gps-aero-overlay.ts` | ~530 | Per-frame aero evaluation + solver dispatch |

### Data Flow

1. `gps-scene.ts` passes canopy orientation (`phi`, `theta` from canopy estimator) to `gps-aero-overlay.ts` via `aeroOverrides`
2. Overlay builds `ControlInversionConfig` with segments, CG, inertia, orientation
3. Dispatches to wingsuit or canopy solver based on `canopyMode` flag
4. Solver returns controls + moment breakdown + control map
5. Results flow through `lastOverlayState` → `gps-main.ts` → `MomentInset`
6. `updateMomentInset()` auto-detects mode from `flightMode` and calls `setMode()` on the inset
7. `updateChartPolar()` passes solved controls to speed polar sweep (also flight-mode-aware)

## Wingsuit Solver

**3 unknowns:** `pitchThrottle`, `rollThrottle`, `yawThrottle` (each ±1)
**3 equations:** Roll (L), Pitch (M), Yaw (N) moment balance

**Method:** Newton-Raphson on 3×3 numerical Jacobian ∂M/∂u.

- Converges in 3–5 iterations typically
- Damping factor 0.7 prevents overshoot
- `rollGain = 2.0` amplifies roll authority for the GPS solver (the sim's gamepad model has lower roll authority than real flight demands)
- Convergence threshold: 0.5 N·m (absolute)

## Canopy Solver

**4 unknowns:** `brakeLeft`, `brakeRight`, `frontRiserLeft`, `frontRiserRight` (each [0, 1])
**3 equations:** Roll (L), Pitch (M), Yaw (N) moment balance
**Underdetermined** — uses damped least-squares (pseudo-inverse) with L2 regularization to prefer minimum total input.

### Auto-Select Constraint

The solver doesn't use all 4 controls simultaneously. Instead:

1. Solves with **brakes only** (risers locked at 0)
2. Solves with **risers only** (brakes locked at 0)
3. Picks the winner: converged preferred; tie-break by lower residual

This avoids the underdetermined 4-control system and naturally separates:
- Brakes → pitch-up, yaw, drag (nose-up turns)
- Front risers → pitch-down, speed (steep dives, front-riser turns)

The `CanopyControlConstraint` type supports `'all' | 'brakes-only' | 'risers-only' | 'auto'` for future manual override or deployment sub-phases.

### Gravity Torque Correction

**Critical for canopy solver accuracy.** The pilot hangs ~6m below the canopy on risers. Gravity creates massive restoring moments that the aero model doesn't produce:

```
τ_roll  = -m · g · L · sin(φ)    // restoring toward wings-level
τ_pitch = -m · g · L · sin(θ)    // restoring toward level flight
τ_yaw   = 0                       // no gravity yaw arm
```

At 50° bank: `τ_roll ≈ -80 × 9.8 × 6 × sin(50°) ≈ -3600 N·m`

This is subtracted from the Euler equation's required moments before solving, so the solver only explains the **aero-control** portion. Without this correction, the solver saturates at 100% trying to explain gravity effects with aerodynamic controls.

**Parameters:**
- `phi`, `theta` — from canopy estimator via `aeroOverrides`
- `riserLength` — default 6.0m (pilot CG to canopy attachment)
- `mass` — total system mass

### Control Gain

`canopyControlGain = 3.0` scales all canopy control inputs in the solver's aero evaluation. This compensates for the segment model having lower control authority than real-world canopies exhibit at the GPS-measured flight states. Without it, controls rail at 100%.

This is a temporary calibration factor — as the segment model gains accuracy, it should approach 1.0.

### Convergence

Canopy moments are much larger than wingsuit (thousands vs tens of N·m). Uses **relative convergence threshold**: `max(0.5, |M_req| × 5%)`. This means the solver converges when the residual is within 5% of the demand magnitude, with a floor of 0.5 N·m for small-moment frames.

## Moment Decomposition View

### Arc Visualization (shared across modes)

Three axis gauges (Pitch, Roll, Yaw) with concentric arcs:
- **Red/orange (inner):** Aero — neutral segment model moment
- **Green:** Pilot — solved control input moment
- **Yellow:** Gyroscopic coupling (ω × Iω)
- **White (outer):** I·α — measured rotational acceleration × inertia (net demand)

Arc angle proportional to moment magnitude, auto-scaled per axis.

### Legend (mode-specific)

**Wingsuit mode:**
- Pitch/Roll/Yaw throttle bars (±100%, bipolar)

**Canopy mode:**
- Brake L/R bars (0–100%, unipolar)
- Front Riser L/R bars (0–100%, unipolar)
- Control → Axis mapping: shows which controls contribute to each axis, sorted by magnitude

### Control → Axis Mapping

After solving, the canopy solver evaluates each control individually at its solved value (others at 0) to compute per-control moment contributions. This shows the **primary effect** of each physical control on each rotational axis:

```
Control → Axis
Pitch: BkL +1200  BkR +1150
Roll:  FrR -900   BkL +200
Yaw:   BkR +300   FrL -250
```

Note: sum of individual contributions may not exactly equal total pilot moment due to cross-coupling nonlinearity.

## Known Limitations

1. **Sideslip (β) = 0** — The body velocity is constructed from GPS airspeed + AOA with zero sideslip. In turns, real sideslip is nonzero and affects yaw/roll moments significantly.

2. **Canopy control gains** — The 3× gain multiplier is a band-aid. The segment model's control authority needs tuning to match real-world moment production at flight-speed dynamic pressures.

3. **Riser length** — Hardcoded at 6.0m. Should be derived from the canopy model's line geometry and pilot harness configuration.

4. **No deployment sub-phases** — During deployment (snivel, line stretch, slider descent), brakes are stowed and control authority changes dramatically. The solver doesn't yet adapt to these phases.

5. **No pendulum coupling** — The gravity correction is first-order (simple sin(φ)/sin(θ) restoring). The sim's full pendulum model includes canopy-pilot coupling, damping, and spring dynamics that aren't captured.

## Future Work

### Deployment Sub-Phases

The solver constraint system (`CanopyControlConstraint`) is designed to support deployment:
- **Line stretch → snivel:** `risers-only` (brakes stowed at ~30%, not pilot-controlled)
- **Slider descent:** Reduced control authority, progressive gain ramp
- **Brakes unstowed:** Transition to `auto` or `all`

### Sideslip Estimation

Beta could be estimated from:
- Differential GPS velocity vs heading
- The canopy estimator's force decomposition
- Coordinated turn assumption: β = f(bank angle, turn rate)

### Per-Segment Diagnostics

The control map could be extended to show per-segment contributions — which cells are producing the most moment for each control input. Useful for understanding planform effects and tuning segment geometry.
