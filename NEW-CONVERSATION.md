# NEW-CONVERSATION.md — Context Bootstrap for AI Agents

_Hand this to any new AI session working on the Polar Project._

## What This Project Is

The **Polar Visualizer** is a full-range aerodynamic modeling system for human flight — wingsuits, paragliders/canopies, skydivers, and aircraft. It runs entirely client-side in the browser. There are two main modes:

1. **Interactive Visualizer / Simulator** — Real-time 6DOF simulation with Xbox gamepad control. Fly wingsuits through deployment to canopy flight. Adjust aerodynamic parameters with sliders, see force vectors and moment arcs update live. Multiple vehicle models (Aura 5 wingsuit, Ibex UL canopy, Slick Sin skydiver, Caravan airplane).

2. **GPS Flight Viewer** — Post-flight analysis tool. Loads FlySight GPS data, runs it through a processing pipeline, and overlays the segment aero model onto real flight data. Dual synchronized 3D scenes (inertial + body frame), control inversion solver, speed polar with live solved inputs, moment decomposition visualization.

## The Math (what makes this project tick)

Everything is built on two foundations:

- **Kirchhoff separation model** — Blends attached-flow and flat-plate aerodynamics through a smooth sigmoid. Gives physically motivated coefficients at ANY angle of attack (-180° to +180°), not just a lookup table.
- **Rotating reference frames** — Five coordinate systems (NED inertial, NED body, wind, Three.js Y-up, GLB Z-forward) with explicit transforms. The ω×r correction on each segment creates automatic rate damping.

Each vehicle is a collection of `AeroSegment`s — each with its own Kirchhoff polar, reference area, chord, and position. Forces and moments are summed across all segments to get system-level aerodynamics. This is NOT a single-polar system — it's a multi-body segment model.

## Project Structure

```
polar-visualizer/
  src/
    polar/           # Core aero math (UI-independent, portable)
    ui/              # Sliders, charts, readout panel
    viewer/          # Three.js 3D rendering
    sim/             # Real-time simulation (deployment, input filtering)
    gps/             # GPS data processing pipeline
    gps-viewer/      # GPS flight analysis UI (dual scene, solver, charts)
    kalman/          # Orientation EKF
```

## Key Documents — Read Before Working

| Priority | Document | What it tells you |
|----------|----------|-------------------|
| 🔴 Must | `README.md` | Full project overview, every parameter explained, how segments work |
| 🔴 Must | `AGENTS.md` | Build commands, code structure map, coordinate systems, conventions |
| 🟡 Read if relevant | `docs/CONTROL-SOLVER.md` | GPS control inversion — wingsuit/canopy solvers, gravity correction |
| 🟡 Read if relevant | `docs/GPS-VIEWER.md` | GPS flight viewer architecture, data pipeline |
| 🟡 Read if relevant | `docs/FRAMES.md` | Reference frame math, transforms, EOM |
| 🟡 Read if relevant | `docs/KIRCHHOFF.md` | Separation function math |
| 🟡 Read if relevant | `docs/sim/STATUS.md` | What's working/broken in the sim |
| 🟡 Read if relevant | `docs/sim/CANOPY-CONTROLS.md` | How brakes, risers, weight shift work |
| 🟡 Read if relevant | `docs/WINGSUIT-SEGMENTS.md` | 6-segment wingsuit model phases |

## Memory System

- **`MEMORY.md`** — Persistent facts and protocols. Rarely updated.
- **`memory/YYYY-MM-DD.md`** — Daily session notes. Read the last 2-3 entries to catch up on recent work.
- **`memory/meetings/`** — Detailed meeting notes for specific design sessions.

**On session start:** Read MEMORY.md, then the most recent daily entries, then any relevant docs for today's planned work.

**On session end:** Write a daily entry summarizing work, decisions, findings, and next steps.

## Build & Test

```bash
cd polar-visualizer && npx tsc --noEmit        # type check (works from WSL)
cd polar-visualizer && npx vitest run           # tests (WINDOWS ONLY — native binaries)
cd polar-visualizer && npm run dev              # dev server localhost:5173
```

⚠️ `node_modules` installed on Windows. `vitest` requires Windows terminal. Always type-check with `tsc` at minimum.

## Conventions That Matter

- **NED everywhere** for physics. Y-up only in Three.js rendering.
- **Chord-fraction positions** via `a5xc()` for wingsuit segments.
- **All tests must pass** before committing.
- **Don't break existing polars** (aurafive, ibexul, slicksin, caravan).
- **Files under ~500 lines** — split if bigger.
- **Read the docs before coding** — the architecture is deliberate and interconnected. Don't rebuild things that already exist.

## About Hartman

Professional skydiver, wingsuit BASE jumper, computer engineer. He's the domain expert — when he says something about flight dynamics, listen. He provides architectural vision and physical intuition; the AI provides coding rigor and mathematical precision.

He thinks on walks, not at the terminal. He'll come back with ideas and domain insights. Capture them, organize them, turn them into working code.

## Current State (as of 2026-04-16)

- **Sim:** Wingsuit + canopy fully flyable with gamepad. Full deployment chain working. Line twist, weight shift, pilot pitch coupling.
- **GPS Viewer:** Dual-scene replay, per-segment force vectors, moment arcs, control inversion solver (wingsuit + canopy), speed polar with live solved inputs, deployment rendering.
- **Control Solver:** Wingsuit solver working well. Canopy solver recently added gravity torque correction — working but control gains need tuning. Auto-select constraint (brakes-only vs risers-only). See `docs/CONTROL-SOLVER.md`.
- **Known issues:** Canopy solver `canopyControlGain = 3.0` is a temporary band-aid. Sideslip = 0 in solver. Debug console.logs still in `control-solver.ts`.

_Update this "Current State" section when major milestones are reached._
