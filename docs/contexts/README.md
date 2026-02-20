# Context Library — Polar Visualizer

## Purpose

Scoped context packs for AI agents working on the Polar Visualizer.
Each file provides exactly the information an agent needs for a specific
domain — key files, architecture, constraints, common tasks — without
flooding context with irrelevant detail.

## Usage

Tell your AI agent:
> Load `docs/contexts/<name>.md` for context on this task.

For cross-cutting work, load multiple contexts:
> Load `docs/contexts/canopy-system.md` and `docs/contexts/visualization.md`.

## Available Contexts

| Context | File | Scope |
|---------|------|-------|
| **Model Registry** | `model-registry.md` | GLB geometry, scaling, coordinate transforms, assembly rules |
| **Canopy System** | `canopy-system.md` | Ibex UL canopy: cells, brake flaps, lines, deployment, pilot attachment |
| **Wingsuit Aero** | `wingsuit-aero.md` | Aura 5 wingsuit: 6 segments, throttle controls, dirty flying, planform |
| **Physics Engine** | `physics-engine.md` | 6DOF EOM, force summation, inertia, apparent mass, simulation, composite frame |
| **Export System** | `export-system.md` | OUTPUT.md: serializing flight model for CloudBASE (planning stage) |
| **Visualization** | `visualization.md` | Three.js 3D viewer: scene, model loading, force arrows, mass overlay, coordinates |
| **Charts** | `charts.md` | Chart.js panels, coefficient readout, AOA color system, debug panel |

## Maintenance

These files are maintained by Polar Claw (CEO agent). When architectural
changes are made in development sessions:

1. Update the relevant context file(s) with new constraints, file references, or procedures
2. Keep line counts and file ranges approximate (exact lines drift with edits)
3. Add new contexts when a domain grows complex enough to warrant one
4. Remove stale information — these are living docs, not historical records

## Relationship to Reference Docs

The big reference docs (MODEL-GEOMETRY.md, SIMULATION.md, OUTPUT.md, etc.)
are the **ground truth**. Context packs are **indexes into them** — they tell
agents which sections matter for a given task and encode tribal knowledge
(constraints, gotchas, settled decisions) that would otherwise require
human babysitting.
