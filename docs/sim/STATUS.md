# Simulation Status — 2026-03-04

![Wingsuit sim flight with speed polar](../../polar-visualizer/docs/gifs/sim-hero-wingsuit.gif.gif)

## Working

- **SimRunner**: RK4 integration at 200Hz, Start/Stop UI, HUD overlay (speed, altitude, glide ratio)
- **Wingsuit 6-segment**: Flyable with gamepad. Pitch stable, full speed range ~55–115 mph. Roll throttle feels realistic — requires active piloting through turns.
- **Canopy 7-cell**: Flyable with gamepad. Stable flight, brakes and risers functional. Needs CP/CM tuning for proper trim.
- **3-DOF pilot–canopy coupling**: Implemented and rendering. Three distinct per-axis physics:
  - **Pitch**: Gravity-restoring pendulum — pilot swings freely at riser confluence. Drives `pilotPivot.rotation.x` on GLB model and `controls.pilotPitch` in aero segments.
  - **Lateral**: Stiff spring + critical damping (geometric harness deformation, not a pendulum). Gamepad: left stick X.
  - **Twist**: Sinusoidal restoring torque from line geometry, clamped at ±180°. Gamepad: right stick X.
- **Vehicle-aware gamepad**: Auto-selects mapping from polar type. Wingsuit: right stick pitch/roll, triggers for yaw, left stick orbit camera. Canopy: triggers for brakes, left stick Y for risers, left stick X for weight shift, right stick X for twist recovery.
- **Force/moment vectors**: Render in real-time during sim. Vehicle-aware scaling (canopy 4× wingsuit).
- **Debug panel**: Per-segment polar overrides work during sim — enables live tuning while flying.
- **Speed polar enhancements**: Glide ratio reference lines (1:1–3:1 ± negative), velocity vector line, live sim velocity blue dot, acceleration white dot (10 mph/g scale).

## Wired but Incomplete

- **Constraint modes**: Architecture designed (CONSTRAINT-MODES.md) but not implemented. Currently all DOFs are simulated — no per-DOF lock/gamepad toggle.
- **Pilot aero torque**: `pilotSwingDampingTorque()` exists in eom.ts but is not wired into the coupling. At speed, drag/lift on the pilot body should pitch it slightly forward — currently absent.
- **Brake flap double-scaling**: Both getCoeffs and renderer apply deploy chordScale/spanScale — double-scaled during deployment transitions.
- **Brake-to-cell coupling direction**: May be inverted at high brake (Kirchhoff post-stall at 58° effective α).

## Not Started

- **Canopy CP/CM tuning**: Needs pitch stability work (cm_0, cm_alpha, cp_0, cp_alpha per cell). **Active — Hartman tuning now.**
- **Pilot coupling → canopy feedback**: Lateral weight shift should produce asymmetric riser loading → turn. Twist should reduce effective canopy control authority. Not yet coupled back into aero.
- **Pivot junction slider**: Assembly trim angle control.
- **Pilot height slider**: Coupled GLB + aero scaling.
- **Output/export system**: Phases 1–5 from OUTPUT.md.
- **Line tension model**: Research phase.
