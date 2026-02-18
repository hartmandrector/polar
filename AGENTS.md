# Polar Visualizer — Agent Instructions

## Project

6DOF flight dynamics visualizer for paragliders, wingsuits, and skydivers.
TypeScript + Three.js + Vite + Chart.js + vitest.

## Key Documents (read these first)

- `WINGSUIT-SEGMENTS.md` — 6-segment wingsuit model: phases, implementation status, tuning notes
- `CONTINUOUS-POLAR.md` — Continuous polar system architecture and segment math
- `POLAR-VISUALIZER.md` — Overall visualizer architecture, coordinate systems, rendering pipeline
- `README.md` — Project overview
- `OPENCLAW-SETUP.md` — OpenClaw setup plan and workflow documentation

## Build & Test

```bash
cd polar-visualizer && npx tsc --noEmit        # type check (zero errors required) — works from WSL
cd polar-visualizer && npx vitest run           # run all tests (141+ must pass) — WINDOWS ONLY, fails from WSL
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
      coefficients.ts      # coefficient types
      kirchhoff.ts         # thin-airfoil Kirchhoff model
      index.ts             # barrel exports
    ui/             # controls, charts, readout
      controls.ts         # FlightState interface, slider wiring, readState()
      polar-charts.ts     # Chart.js polar curve plots
      chart-data.ts       # sweep data generation
      readout.ts          # numeric readout panel
    viewer/         # Three.js scene, model loading, vectors
      scene.ts            # Three.js scene setup and render loop
      model-loader.ts     # GLB model loading
      vectors.ts          # force/moment vector visualization
      curved-arrow.ts     # moment arc arrows
      shaded-arrow.ts     # gradient-shaded force arrows
    tests/          # vitest test files (5 files, 141+ tests)
```

## Coordinate Systems

- **NED** (North-East-Down) — physics frame, all aerodynamic math
- **Three.js** (Y-up) — rendering, converted via `nedToThreeJS()`
- **GLB model** — Z-forward, converted at load time
- **Chord-fraction** — wingsuit segment positions: `a5xc(xc) = (A5_CG_XC - xc) * A5_SYS_CHORD / A5_HEIGHT`

## Key Constants (Wingsuit — Aura 5)

- `A5_CG_XC = 0.40` — center of gravity at 40% chord
- `A5_SYS_CHORD = 1.8 m` — system reference chord
- `A5_HEIGHT = 1.875 m` — pilot height (reference length)
- Segment positions stored as chord fractions (x/c), converted to NED via `a5xc()`

## Conventions

- All tests must pass before committing
- No breaking changes to existing polars (aurafive, ibexul, slicksin, caravan)
- Use chord-fraction position system (`a5xc()`) for wingsuit segment positions
- CP rendering uses negated offset: `-(sf.cp - 0.25) * seg.chord / 1.875`
- Check WINGSUIT-SEGMENTS.md phase checklist before starting wingsuit work
- Mark checklist items ✅ as they are completed

## Current Status

- Phase 1 ✅ — Segment data, factories, types, registry
- Phase 2 ✅ — Symmetric tuning, positions, CG, inner wing shape
- Phase 3 ✅ (mostly) — Throttle controls UI wired, tuning remaining
- Phase 3.5 — Triangular planform refinement (planned)
- Phase 4 — Dirty flying segmented + coupled (planned)
