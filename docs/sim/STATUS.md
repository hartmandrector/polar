# Simulation Status — 2026-03-06

![Wingsuit sim flight with speed polar](../../polar-visualizer/docs/gifs/sim-hero-wingsuit.gif.gif)

## Working

- **SimRunner**: RK4 integration at 200Hz, Start/Stop UI, HUD overlay (speed, altitude, glide ratio)
- **Wingsuit 6-segment**: Flyable with gamepad. Pitch stable, full speed range ~55–115 mph. Roll throttle feels realistic — requires active piloting through turns.
- **Canopy 7-cell**: Flyable with gamepad. Riser and brake controls tuned with force vector tilt, CM trim shifts, and drag bumps. Acro-capable — exaggerated controls for testing. See [CANOPY-CONTROLS.md](CANOPY-CONTROLS.md).
- **3-DOF pilot–canopy coupling**: Implemented and rendering. Three distinct per-axis physics:
  - **Pitch**: Gravity-restoring pendulum — pilot swings freely at riser confluence. Drives `pilotPivot.rotation.x` on GLB model and `controls.pilotPitch` in aero segments.
  - **Lateral**: Stiff spring + critical damping (geometric harness deformation, not a pendulum). Gamepad: left stick X.
  - **Twist**: Sinusoidal restoring torque from line geometry, clamped at ±180°. Gamepad: right stick X.
- **Canopy riser mechanics**: Front risers: α decrease (6°) + nose-up tilt (−0.35 rad) + CM (−0.15). Rear risers: α increase (6°) + nose-up tilt (0.06 rad) + CM (+0.10). Force vector tilt (`cellPitchRad`) is the primary turn mechanism.
- **Canopy brake mechanics**: Parent cell derivatives (d_alpha_0=−16, d_cl_alpha=1.2), geometric cell pitch (0.14 rad), drag bump (0.12), center cell 50% coupling. Brake flaps with low stall angle (18°) for drag-plate behavior at full brake.
- **Vehicle-aware gamepad**: Auto-selects mapping from polar type. Wingsuit: right stick pitch/roll, triggers for yaw, left stick orbit camera. Canopy: triggers for brakes, left stick Y for risers, left stick X for weight shift, right stick X for twist recovery.
- **Sim control panel**: Full panel right of 3D viewport with SVG gamepad visualization. Stick circles with deflection-colored dots, trigger bars with fill, vehicle-aware labels, numeric axis values.
- **Force/moment vectors**: Render in real-time during sim. Vehicle-aware scaling (canopy 4× wingsuit). Rotational vectors properly scaled.
- **Speed polar enhancements**: Glide ratio reference lines (1:1–3:1 ± negative), velocity vector line, live sim velocity blue dot, acceleration white dot (10 mph/g scale).
- **Flight trail**: Fading blue line (400-point ring buffer) showing flight path in inertial frame. Hidden in body frame. Fixed-origin approach with line translation for performance.
- **Debug panel**: Per-segment polar overrides work during sim — enables live tuning while flying.

## Wired but Incomplete

- **Constraint modes**: Architecture designed ([CONSTRAINT-MODES.md](CONSTRAINT-MODES.md)) with per-phase presets planned but not implemented per-DOF. Currently all DOFs simulated with gamepad overlay.
- **Pilot aero torque**: `pilotSwingDampingTorque()` exists in eom.ts but effect is minimal. At speed, drag/lift on pilot body should pitch it slightly forward.
- **Brake flap double-scaling**: Both getCoeffs and renderer apply deploy chordScale/spanScale — double-scaled during deployment transitions.
- **Brake-to-cell coupling direction**: May be inverted at high brake (Kirchhoff post-stall at 58° effective α).

## Planned — Phase Architecture

See [PHASE-ARCHITECTURE.md](PHASE-ARCHITECTURE.md) and [DEPLOYMENT-MECHANICS.md](DEPLOYMENT-MECHANICS.md).

- **Phase FSM**: State machine above SimRunner — prelaunch → freefall → deployment → canopy → landed. UI-driven phase/scenario selection, gamepad for in-phase events (A = PC toss, Start = scenario launch).
- **Nested status panel**: Scenario box → phase box → sub-state box with per-phase telemetry.
- **Deployment visualization**: 4-line-group + slider rigid body (8 lines, slider GLB). Manual slider first, physics-driven later.
- **Pilot chute rigid body**: Position/velocity/drag, throw from hand.
- **Bridle tension chain**: Multi-segment extraction driven by pilot chute drag.
- **Scenario system**: Data-driven initial conditions and phase sequences (BASE, skydive, paraglider, debug).

## Not Started

- **Canopy CP/CM tuning**: Needs pitch stability work (cm_0, cm_alpha, cp_0, cp_alpha per cell).
- **Pilot coupling → canopy feedback**: Lateral weight shift → asymmetric riser loading → turn. Twist → reduced control authority. Not coupled back into aero.
- **Pivot junction slider**: Assembly trim angle control.
- **Pilot height slider**: Coupled GLB + aero scaling.
- **Output/export system**: Phases 1–5 from OUTPUT.md.
- **Line tension model**: Research phase (Slegers & Costello framework).
