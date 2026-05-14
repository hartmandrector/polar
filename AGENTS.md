# Polar Visualizer — Agent Instructions

## Project

6DOF flight dynamics visualizer for paragliders, wingsuits, and skydivers.
TypeScript + Three.js + Vite + Chart.js + vitest.

## Skills

- **`.github/skills/browser-dev/SKILL.md`** — Running, inspecting, and iterating on the Polar Visualizer and GPS Flight Viewer in a real browser. Read this before attempting any visual debugging, screenshot capture, slider manipulation, or GPS-track replay. Update it when you discover new URL params, slider indices, or gotchas.

## Key Documents (read these first)

**Architecture & Refactoring:**
- `docs/reference/VEHICLE-REFACTOR.md` — Vehicle decoupling architecture: modular system for custom user data (Phases A–C complete, D in progress)
- `docs/REFERENCE-LENGTH.md` — Reference length parameterization (Phases A–C complete): per-vehicle aero vs mass reference lengths
- `docs/SCALING-SLIDERS.md` — Pilot height slider, pilotSizeCompensation, scaling chain documentation

**Integration Guides (for users):**
- `docs/USER-MY-DATA.md` — Three-tier guide for users integrating their own vehicle data (Beginner / Intermediate / Advanced)

**Technical Details:**
- `docs/CENTER-SEGMENT-SPLIT.md` — **7-segment wingsuit (current)**: torso/leg split, hip-camber + leg-bend controls, pitch-throttle coupling, yaw via roll differential. Phases A–D.2 complete on `split` branch.
- `docs/WINGSUIT-SEGMENTS.md` — Legacy 6-segment phase notes (superseded by CENTER-SEGMENT-SPLIT.md for current architecture)
- `docs/CONTINUOUS-POLAR.md` — Continuous polar system architecture and segment math
- `docs/POLAR-VISUALIZER.md` — Overall visualizer architecture, coordinate systems, rendering pipeline
- `docs/CONTROL-SOLVER.md` — GPS control inversion: wingsuit/canopy solvers, gravity correction, moment decomposition view
- `docs/GPS-VIEWER.md` — GPS flight viewer architecture, data pipeline, dual-scene replay
- `README.md` — Project overview
- `OPENCLAW-SETUP.md` — OpenClaw setup plan and workflow documentation

## Build & Test

```powershell
# Always run before committing:
cd c:\dev\polar\polar-visualizer ; npx tsc --noEmit

# Run tests only when explicitly requested (slow; by-request only):
cd c:\dev\polar\polar-visualizer ; npx vitest run

# Dev server (start if not already running):
cd c:\dev\polar\polar-visualizer ; npm run dev
```

**PowerShell** is the standard shell. Use `;` to chain commands on one line.

**tsc** must pass with zero errors before every commit. Run it from `c:\dev\polar\polar-visualizer` (not the repo root — that will fail).

**vitest** is by request only — do not run it automatically after every change. When asked, run from `c:\dev\polar\polar-visualizer`. Tests require Windows (native rollup/esbuild binaries).

**Dev server / browser**: The dev server is often already running at `localhost:5173` during active development. If port 5173 is busy, Vite auto-bumps to 5174, 5175, etc. — check terminal output for the actual port. The browser is typically already open pointing at the visualizer; reuse the existing page rather than opening a new one unless necessary. Read the `browser-dev` skill before doing any browser-based work.

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

- Always `tsc --noEmit` before committing (zero errors required)
- `vitest run` by request only — do not run automatically after every change
- No breaking changes to existing polars (aurafive, ibexul, slicksin, caravan)
- Use chord-fraction position system (`a5xc()`) for wingsuit segment positions
- `A5_CG_XC = 0.40` is the base CG chord fraction. Some assemblies have dynamic CG (mass distribution changes); label base position and note what drives shifts.
- CP rendering uses negated offset with massReference: `-(sf.cp - 0.25) * seg.chord / massReference_m`
- Check CENTER-SEGMENT-SPLIT.md (current) and WINGSUIT-SEGMENTS.md (legacy) before starting wingsuit work
- Mark checklist items ✅ as they are completed

## Current Status

**Wingsuit Segments (7-segment, `split` branch — see `docs/CENTER-SEGMENT-SPLIT.md`):**
- Phase A ✅ — Geometric split: 1 center → torso + leg, shared polar (parity)
- Phase B ✅ — Distinct `A5_TORSO_POLAR` + `A5_LEG_POLAR` (B.1: zeroed double-counted cm)
- Phase C ✅ — Yaw via leg/torso roll differential (additive to lateral shift)
- Phase D ✅ — `hipCamber` + `legBend` controls (D.1: cm₀ modulation; D.2: pitch throttle drives them, leg fully decoupled from pitch α/CP)
- Phase E ✅ — Joint α/dirty solver, 6→7 rename pass, stability analysis refresh; GPS smoke test on 05-02-2025-1: 98.9% wingsuit convergence, mean |Δα|=1.0°
- Phase L ✅ — Posture-driven pitch: `PITCH_ALPHA_MAX_DEG=0`, all pitch authority via hipCamber+legBend α_0+cm_0 shifts. Stable gamepad baseline 65–165 mph committed.
- Phase N ✅ — Roll via shoulder-camber α_0 shifts: `ROLL_ALPHA_MAX_DEG=0`, `ROLL_ALPHA0_DEG=3.0`, `INNER_ROLL_ALPHA0_DEG=1.5`.
- Phase O 🔄 — Deep-flare α_0 shifts to close slow-speed trim gap (below ~90 mph). Trim solver reaches 49–80 m/s; 25–41 m/s gap remains. Design pivot to Phase P (unified smooth pitch response curve) in progress.
  - `TORSO_FLARE_ALPHA0_DEG`, `INNER_FLARE_ALPHA0_DEG`, `OUTER_FLARE_ALPHA0_DEG`, `LEG_FLARE_ALPHA0_DEG` — all wired; currently zeroed/tuned during active testing
  - Trim sweep HTML report with qDot surface + cubic response family charts added to `scripts/trim-sweep.ts`
- Phase P ⏳ — Planned: replace piecewise flare constants with unified cubic pitch response `f(pitchT) = −pitchT·(1+k·pitchT²)` per segment, smooth across full stick range

**Wingsuit Segments (legacy 6-segment notes):**
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
  - ⏳ Canopy referenceLength should eventually reflect canopy chord, not pilot height (planned, not yet done)
  - ⬜ Pivot junction slider (planned)
