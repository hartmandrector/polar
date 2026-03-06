# Real-Time Simulation — Overview

The simulator runs **6DOF rigid-body physics at 200Hz** driven by the same Kirchhoff aerodynamic model used for static analysis. An Xbox gamepad provides real-time control with vehicle-aware mappings — the system auto-detects whether you're flying a canopy or wingsuit and assigns controls accordingly. Force and moment vectors render live during flight.

→ Detail docs: [Status](STATUS.md) · [Gamepad](GAMEPAD.md) · [Constraint Modes](CONSTRAINT-MODES.md) · [Canopy Controls](CANOPY-CONTROLS.md) · [Pilot Coupling](PILOT-COUPLING.md) · [Phase Architecture](PHASE-ARCHITECTURE.md) · [Deployment Mechanics](DEPLOYMENT-MECHANICS.md)

![Body↔Inertial frame toggle during flight](../../polar-visualizer/docs/gifs/sim-frame-toggle.gif)

---

## Core

- **[SimRunner](../../polar-visualizer/src/sim/sim-runner.ts)** — RK4 integration at 200Hz with spiral-of-death clamping (max 10 substeps/frame). Reads slider state as initial conditions, converts to body-frame SimState, integrates forces, feeds results back to the 3D viewer
- **[Vehicle-aware gamepad](GAMEPAD.md)** — Auto-selects mapping from polar type. Canopy: triggers for L/R brakes, sticks for front/rear risers + weight shift + twist. Wingsuit: right stick pitch/roll, triggers for yaw, left stick orbit camera
- **[Sim control panel](../../polar-visualizer/src/sim/sim-ui.ts)** — Full panel right of 3D viewport. SVG gamepad visualization (stick circles, trigger bars, vehicle-aware labels), HUD with airspeed (mph), altitude (ft AGL), glide ratio. Start/Stop via button or gamepad Start
- **[Per-segment aero in the loop](../../polar-visualizer/src/polar/aero-segment.ts)** — Each segment evaluates Kirchhoff coefficients independently at its local flow conditions (including ω×r velocity correction), producing differential forces that drive asymmetric flight

## Vehicle Systems

- **[Canopy controls](CANOPY-CONTROLS.md)** — Front/rear risers with force vector tilt (cellPitchRad), α offset, CM trim, drag bumps. Brakes with camber derivatives, cell pitch, drag bump, center cell 50% coupling. Brake flaps as separate AeroSegments with low stall angle
- **[Pilot coupling](PILOT-COUPLING.md)** — 3-DOF relative rotation (pitch pendulum, lateral weight shift, line twist). 18-state vector. Opt-in via SimConfig. Canopy only
- **[Wingsuit pitch stability](STATUS.md#working)** — Center cell tuned: cm_alpha=−0.255, cp_0=0.36, cp_alpha=0.025. Gradient strongest center → weakest tips. Full range ~55–115 mph

## Visualization

- **Force/moment vectors** — Real-time during sim. Vehicle-aware scaling (canopy 4× wingsuit). Rotational vectors properly scaled
- **[Speed polar](../../polar-visualizer/src/ui/polar-charts.ts)** — Glide ratio reference lines, velocity vector line, live sim velocity blue dot, acceleration white dot (10 mph/g scale)
- **[Flight trail](../../polar-visualizer/src/viewer/trail.ts)** — Fading blue line (400-point ring buffer) in inertial frame. Fixed-origin rendering with line translation for performance. Hidden in body frame
- **Debug panel** — Per-segment polar overrides work during sim for live tuning while flying

## Architecture (planned)

- **[Phase FSM](PHASE-ARCHITECTURE.md)** — Continuous simulation across flight phases (prelaunch → freefall → deployment → canopy → landed). UI-driven scenario/phase selection, gamepad events within phases. Nested status display with per-phase telemetry
- **[Deployment model](DEPLOYMENT-MECHANICS.md)** — 4-line-group + slider rigid body abstraction. Bridle segments with drag and tension. Physics-driven or manual slider control
- **[Constraint mode presets](CONSTRAINT-MODES.md#phase-integration)** — Each phase defines which DOFs are simulated, locked, or gamepad-controlled. Debug mode can override any DOF regardless of phase
