# Real-Time Simulation — Overview

The simulator runs **6DOF rigid-body physics at 200Hz** driven by the same Kirchhoff aerodynamic model used for static analysis. An Xbox gamepad provides real-time control with vehicle-aware mappings — the system auto-detects whether you're flying a canopy or wingsuit and assigns controls accordingly. Force and moment vectors render live during flight.

→ Detail docs: [Status](STATUS.md) · [Gamepad](GAMEPAD.md) · [Constraint Modes](CONSTRAINT-MODES.md)

---

- **[SimRunner](../../polar-visualizer/src/sim/sim-runner.ts)** — RK4 integration at 200Hz with spiral-of-death clamping (max 10 substeps/frame). Reads slider state as initial conditions, converts to body-frame SimState, integrates forces, feeds results back to the 3D viewer
- **[Vehicle-aware gamepad](GAMEPAD.md)** — Auto-selects mapping from polar type. Canopy: triggers for L/R brakes, sticks for front/rear risers. Wingsuit: right stick pitch/roll, left stick yaw. All inputs simultaneous, no mode switching
- **[HUD overlay](../../polar-visualizer/src/sim/sim-ui.ts)** — Start/Stop button, real-time readout of airspeed (mph), altitude (ft AGL), and glide ratio. Force vectors render at 10× scale for low-airspeed visibility
- **[Per-segment aero in the loop](../../polar-visualizer/src/polar/aero-segment.ts)** — Each segment evaluates Kirchhoff coefficients independently at its local flow conditions (including ω×r velocity correction), producing differential forces that drive asymmetric flight
- **[Pitch stability tuning](STATUS.md#working)** — Wingsuit center cell tuned for trim ~90 mph, full range ~55–115 mph. Key parameters: cm_alpha (restoring moment strength), cp_0 (trim CP position), PITCH_CP_SHIFT (steady-state control authority)
- **[Constraint mode architecture](CONSTRAINT-MODES.md)** — Each DOF can be simulated (physics), locked (slider), or gamepad-driven. Priority: gamepad > slider > physics. Designed but not yet implemented per-DOF — currently all DOFs simulated with gamepad overlay
- **[Debug panel integration](STATUS.md#working)** — Per-segment polar overrides work during sim, enabling live tuning of any aerodynamic parameter while flying with the gamepad
