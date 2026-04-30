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
| `control-solver.ts` | ~530 | Wingsuit + canopy solvers, joint α/dirty solve, constraint system |
| `moment-types.ts` | ~110 | Shared types: `VehicleMode`, `AxisMoments`, `CanopyControlMap` |
| `moment-inset.ts` | ~290 | 3D arc visualization, mode-aware with pluggable formatters |
| `moment-wingsuit.ts` | ~75 | Wingsuit legend: ±100% bipolar pitch/roll/yaw bars + unipolar dirty bar |
| `moment-canopy.ts` | ~110 | Canopy legend: 0–100% unipolar brake/riser bars + control→axis mapping |
| `gps-aero-overlay.ts` | ~530 | Per-frame aero evaluation + solver dispatch |

### Data Flow

1. `gps-scene.ts` passes canopy orientation (`phi`, `theta` from canopy estimator) to `gps-aero-overlay.ts` via `aeroOverrides`
2. Overlay builds `ControlInversionConfig` with segments, CG, inertia, orientation, and `sRef = polar.s` (for the joint α solve)
3. Dispatches to wingsuit or canopy solver based on `canopyMode` flag
4. Solver returns controls + dirty + solved α + moment breakdown + control map
5. Results flow through `lastOverlayState` → `gps-main.ts` → `MomentInset`
6. `updateMomentInset()` auto-detects mode from `flightMode` and calls `setMode()` on the inset
7. `updateChartPolar()` passes solved controls to speed polar sweep (also flight-mode-aware)
8. `gps-charts.ts` cursor uses `pt.solvedControls.alpha` (when present) so the yellow cursor lands on the swept polar curve

## Wingsuit Solver

**Free variables (per frame):** `pitchThrottle`, `rollThrottle`, `yawThrottle` (each ±1), `dirty` ([0,1]), and `α` (rad).

**Equations:** 3 moment equations (roll, pitch, yaw) + 1 L/D match + 1 CL/CD match.

**Method:** Three-tier nested solve, wrapped in an outer fixed-point iteration on α.

```
outer α loop (≤4 iters, 0.05° tolerance)
├── refresh body velocity from current α
├── Newton-Raphson on (pitch, roll, yaw) ──── 3×3 numerical Jacobian, damping 0.7
├── 1D bisection on dirty ─────────────────── match measured L/D = pt.aero.cl / pt.aero.cd
└── re-extract α via matchAOABinarySearch ── using a polar evaluator built with the
                                              just-solved controls + dirty + trim baseline
```

### Trim Baseline (hipCamber, legBend)

The wingsuit cruises at hip arch ≈ 0.30 and leg bend ≈ 0.30 (matches gamepad slider neutral; see [CENTER-SEGMENT-SPLIT.md §0](CENTER-SEGMENT-SPLIT.md)). The solver applies these as a fixed baseline:

- `ControlInversionConfig.trimHipCamber` (default `0.30`)
- `ControlInversionConfig.trimLegBend` (default `0.30`)

The same baseline is applied in `gps-polar-table.ts buildPolarEvaluatorFactory` so the GPS pipeline's initial α extraction (`extractAero` → `matchAOABinarySearch`) and the chart's swept polar curve are all anchored to the same wing shape the solver assumes.

### Dirty Solve via L/D Match

Dirty (`[0, 1]`) is a single drag-augmentation knob applied per-segment in `aero-segment.ts`. Because it primarily increases CD with little CL change, **system L/D is monotonically decreasing in dirty**, making bisection robust.

L/D is computed from the aero force projected on velocity:
```
drag = -F·v̂
lift = |F − (-drag)·v̂|  (perpendicular component)
L/D  = lift / drag
```

L/D is **V- and ρ-independent** (the dynamic-pressure factor cancels), so it's directly comparable to the polar-extracted `pt.aero.cl / pt.aero.cd` (which is itself V/ρ-normalized). Bisecting on L/D is much more robust than bisecting on instantaneous drag — instantaneous drag mixes the sustained polar character with transient acceleration.

If the clean polar's L/D at the solved (pitch, roll, yaw) is already ≤ measured L/D, dirty stays at 0. If even fully dirty (1.0) can't drag the model below the measured L/D, dirty caps at 1.

### Joint α Re-Extraction

The GPS pipeline's first-pass α (`pt.aero.aoa`) was extracted from measured CL/CD using a polar evaluator built with **default** controls. After solving for (pitch, roll, yaw, dirty), the polar's CL/CD curve has shifted — the α at which the model matches the measured CL/CD is no longer the same α the pipeline computed.

The outer fixed-point loop closes this gap:

1. Build a `PolarEvaluator` closure that, given α, evaluates `evaluateAeroForcesDetailed` at the solved controls and returns `{cl, cd}` via `liftDir`/`windDir` projection on `qS`.
2. Call `matchAOABinarySearch(cl_meas, cd_meas, evaluator)` to get the α at which model-CL/CD matches measured-CL/CD.
3. Update `bodyVel = (V·cos α, 0, V·sin α)` and re-run Newton + dirty bisection.

Converges in 2–3 outer iterations because moment residuals and L/D are weakly coupled to α shifts of ~1°. Disable by setting `sRef = 0` in the config (back-compat: prior behavior).

### Other Wingsuit Solver Details

- Converges in 3–5 inner Newton iterations typically
- Damping factor 0.7 prevents overshoot
- `rollGain = 1.0` (was historically `2.0` — the split-segment topology has higher native roll authority)
- Convergence threshold: 0.5 N·m (absolute)
- Warm-start from previous timestep's converged solution (skipped on non-convergence to avoid drift)

## Canopy Solver

**4 unknowns:** `brakeLeft`, `brakeRight`, `frontRiserLeft`, `frontRiserRight` (each [0, 1])
**3 equations:** Roll (L), Pitch (M), Yaw (N) moment balance
**Underdetermined** — uses damped least-squares (pseudo-inverse) with L2 regularization to prefer minimum total input.

The canopy solver does **not** use the joint α/dirty loop — it solves at the pipeline's pre-extracted α and assumes dirty = 0 (canopy-mode dirty is not yet meaningful for the segment model).

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
- Pitch/Roll/Yaw throttle bars (±100%, bipolar, 16 cells)
- Dirty bar (0–100%, unipolar, 16 cells)

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

2. **Fixed wingsuit trim baseline** — `trimHipCamber` and `trimLegBend` are hardcoded at 0.30 (matches gamepad neutral / ~100 mph cruise). A real pilot's neutral baseline likely varies with flight phase (faster = more arch, flare = more bend). Future: expose as GPS-viewer sliders.

3. **Canopy control gains** — The 3× gain multiplier is a band-aid. The segment model's control authority needs tuning to match real-world moment production at flight-speed dynamic pressures.

4. **Riser length** — Hardcoded at 6.0m. Should be derived from the canopy model's line geometry and pilot harness configuration.

5. **No deployment sub-phases** — During deployment (snivel, line stretch, slider descent), brakes are stowed and control authority changes dramatically. The solver doesn't yet adapt to these phases.

6. **No pendulum coupling** — The gravity correction is first-order (simple sin(φ)/sin(θ) restoring). The sim's full pendulum model includes canopy-pilot coupling, damping, and spring dynamics that aren't captured.

7. **Joint α loop not yet applied to canopy** — Canopy α stays at the pipeline's first-pass extraction. Once canopy gains a meaningful `dirty` channel, extending the joint loop is straightforward (it's gated on `sRef > 0` in the wingsuit solver).

## Future Work

### Trim Baseline Sliders

The GPS viewer should expose `trimHipCamber` and `trimLegBend` sliders so the analyst can tune the assumed pilot baseline to a specific flight or pilot. Default 0.30 / 0.30 is a starting point, not a universal truth.

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
