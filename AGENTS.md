# Polar Visualizer — Agent Instructions

## Project

6DOF flight dynamics visualizer for paragliders, wingsuits, and skydivers.
TypeScript + Three.js + Vite + Chart.js + vitest.

## Key Documents (read these first)

**Architecture & Refactoring:**
- `docs/reference/VEHICLE-REFACTOR.md` — Vehicle decoupling architecture: modular system for custom user data (Phases A–C complete, D in progress)
- `docs/REFERENCE-LENGTH.md` — Reference length parameterization (Phases A–C complete): per-vehicle aero vs mass reference lengths
- `docs/SCALING-SLIDERS.md` — Pilot height slider, pilotSizeCompensation, scaling chain documentation

**Integration Guides (for users):**
- `docs/USER-MY-DATA.md` — Three-tier guide for users integrating their own vehicle data (Beginner / Intermediate / Advanced)

**Technical Details:**
- `docs/WINGSUIT-SEGMENTS.md` — 6-segment wingsuit model: phases, implementation status, tuning notes
- `docs/CONTINUOUS-POLAR.md` — Continuous polar system architecture and segment math
- `docs/POLAR-VISUALIZER.md` — Overall visualizer architecture, coordinate systems, rendering pipeline
- `README.md` — Project overview
- `OPENCLAW-SETUP.md` — OpenClaw setup plan and workflow documentation

## Build & Test

```bash
cd polar-visualizer && npx tsc --noEmit        # type check (zero errors required) — works from WSL
cd polar-visualizer && npx vitest run           # run all tests (254+ must pass) — WINDOWS ONLY, fails from WSL
cd polar-visualizer && npm run dev              # dev server on localhost:5173
```

⚠️ `node_modules` was installed on Windows. Native binaries (rollup, esbuild) don't work cross-platform from WSL.
- `tsc --noEmit` works from WSL (pure JS).
- `vitest run` requires a Windows terminal (`cd c:\dev\polar\polar-visualizer && npx vitest run`).
- If you can't run tests, at minimum type-check with `tsc`.

Always run both `tsc --noEmit` and `vitest run` after any code change.
Do not commit if either fails.

## Code Structure

```
polar-visualizer/
  src/
    polar/          # aerodynamic models, segment factories, polar data
      polar-data.ts       # all polar definitions, segment positions, a5xc() helper
      segment-factories.ts # factory functions with throttle response
      continuous-polar.ts  # SegmentControls interface, AeroSegment, ContinuousPolar
      aero-segment.ts      # segment force computation, NED physics
      apparent-mass.ts     # apparent mass model
      coefficients.ts      # coefficient types
      composite-frame.ts   # composite reference frame transforms
      eom.ts               # equations of motion integration
      inertia.ts           # inertia tensor computation
      kirchhoff.ts         # thin-airfoil Kirchhoff model
      sim-state.ts         # simulation state types
      sim.ts               # simulation loop
      index.ts             # barrel exports
    ui/             # controls, charts, readout
      controls.ts         # FlightState interface, slider wiring, readState()
      polar-charts.ts     # Chart.js polar curve plots
      chart-data.ts       # sweep data generation
      readout.ts          # numeric readout panel
      debug-panel.ts      # debug overlay with verification readouts
    viewer/         # Three.js scene, model loading, vectors
      scene.ts            # Three.js scene setup and render loop
      model-loader.ts     # GLB model loading and assembly
      model-registry.ts   # ModelGeometry definitions, assembly offsets
      vehicle-registry.ts # VehicleDefinition registry, mass/aero references
      vectors.ts          # force/moment vector visualization
      mass-overlay.ts     # mass point spheres and CP diamond
      cell-wireframes.ts  # canopy cell wireframe rendering
      frames.ts           # wind frame and body frame transforms
      curved-arrow.ts     # moment arc arrows
      shaded-arrow.ts     # gradient-shaded force arrows
    tests/          # vitest test files (7 files, 254+ tests)
      aero-segment.test.ts
      apparent-mass.test.ts
      canopy-polish.test.ts
      eom.test.ts
      model-registry.test.ts
      sim.test.ts
      vehicle-registry.test.ts
```

## Coordinate Systems

- **NED** (North-East-Down) — physics frame, all aerodynamic math
- **Three.js** (Y-up) — rendering, converted via `nedToThreeJS()`
- **GLB model** — Z-forward, converted at load time
- **Chord-fraction** — wingsuit segment positions: `a5xc(xc) = (A5_CG_XC - xc) * A5_SYS_CHORD / A5_HEIGHT`

## Key Constants

**Wingsuit (Aura 5):**
- `A5_CG_XC = 0.40` — center of gravity at 40% chord
- `A5_SYS_CHORD = 1.8 m` — system reference chord
- `A5_HEIGHT = 1.875 m` — pilot height (mass normalization reference)
- `A5_REF_LENGTH = 1.93 m` — aero reference length (head-to-tail flight chord)
- Segment positions stored as chord fractions (x/c), converted to NED via `a5xc()`

**Canopy (Ibex UL):**
- `IBEX_REF_LENGTH = 1.875 m` — reference length (= pilot height)
- `S = 20.439 m² (220 ft²)` — total canopy area
- `chord = 3.29 m` — canopy chord

**Reference Length Architecture:**
- `polar.referenceLength` — aero reference for position denormalization (1.93 wingsuits, 1.875 canopies)
- `getVehicleMassReference()` — mass reference for CG/inertia (1.875 for all current vehicles)
- Mixed normalization creates ~2.9% wingsuit lever-arm offset — intentional per Phase B

## Conventions

- All tests must pass before committing
- No breaking changes to existing polars (aurafive, ibexul, slicksin, caravan)
- Use chord-fraction position system (`a5xc()`) for wingsuit segment positions
- CP rendering uses negated offset with massReference: `-(sf.cp - 0.25) * seg.chord / massReference_m`
- Check WINGSUIT-SEGMENTS.md phase checklist before starting wingsuit work
- Mark checklist items ✅ as they are completed

## Current Status

**Wingsuit Segments:**
- Phase 1 ✅ — Segment data, factories, types, registry
- Phase 2 ✅ — Symmetric tuning, positions, CG, inner wing shape
- Phase 3 ✅ (mostly) — Throttle controls UI wired, tuning remaining
- Phase 3.5 — Triangular planform refinement (planned)
- Phase 4 — Dirty flying segmented + coupled (planned)

**Vehicle Refactor & Reference Length:**
- Phase A ✅ — Per-polar `referenceLength` field, A5_REF_LENGTH constant
- Phase B ✅ — Vehicle registry, `getVehicleMassReference()`, mass vs aero split
- Phase C ✅ — Canopy/pilot decoupling, debug panel, verification readouts
- Phase D ✅ (partial) — UI scaling controls:
  - ✅ Canopy area slider (debug panel)
  - ✅ Pilot height slider + `pilotSizeCompensation` (see `docs/SCALING-SLIDERS.md`)
  - ⬜ Pivot junction slider (planned)
