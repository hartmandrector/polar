# Simulation Status — 2026-03-01

## Working

- **SimRunner**: RK4 integration at 200Hz, Start/Stop UI, HUD overlay (speed, altitude, glide ratio)
- **Wingsuit 6-segment**: Flyable with gamepad. Pitch stable, full speed range ~55–115 mph. Roll throttle feels realistic — requires active piloting through turns.
- **Canopy 7-cell**: Flyable with gamepad. Stable flight, brakes and risers functional. Needs CP/CM tuning for proper trim (currently flies but pitch range is limited).
- **Vehicle-aware gamepad**: Auto-selects mapping from polar type. Wingsuit: right stick pitch/roll, left stick yaw. Canopy: triggers for brakes, sticks for front/rear risers.
- **Force/moment vectors**: Render in real-time during sim at 10× scale for visibility.
- **Debug panel**: Per-segment polar overrides work during sim — enables live tuning while flying.

## Wired but Incomplete

- **Constraint modes**: Architecture designed (docs/sim/CONSTRAINT-MODES.md) but not implemented. Currently all DOFs are simulated — no per-DOF lock/gamepad toggle.
- **Pilot pitch pendulum**: SimStateExtended has thetaPilot/thetaPilotDot fields defined but not integrated into sim loop. Pilot is rigid body.
- **Brake flap double-scaling**: Both getCoeffs and renderer apply deploy chordScale/spanScale to position — technically double-scaled during deployment transitions.
- **Brake-to-cell coupling direction**: May be inverted at high brake (Kirchhoff post-stall at 58° effective α).

## Not Started

- **Canopy CP/CM tuning**: Needs the same pitch stability work we did for the wingsuit (cm_0, cm_alpha, cp_0, cp_alpha per cell).
- **Pivot junction slider**: Assembly trim angle control.
- **Pilot height slider**: Coupled GLB + aero scaling (pattern exists from canopy area slider).
- **Output/export system**: Phases 1–5 from OUTPUT.md.
- **Line tension model**: Research phase — reference papers acquired, not implementation-ready.
