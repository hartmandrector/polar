# CloudBASE ↔ Polar Project Integration Plan

## Overview

Bring the polar-visualizer's segmented aerodynamic model, deployment sequence, and canopy flight into CloudBASE's Cesium-based 3D replay. The goal is a full wingsuit BASE jump visualization: exit → freefall → deployment → canopy → landing, with accurate body orientation derived from GPS data enhanced by the segment model.

## Current State

### CloudBASE 3D Architecture

**Two Cesium-based 3D viewers:**

1. **`csmap.ts` — GPS Track 3D Replay** (the screenshot you showed me)
   - Loads a `Track` from the database
   - `WingsuitLayer` renders a GLB model oriented by `heading`, `pitch`, `roll` from GPS
   - `player3d.ts` provides play/pause/scrub via Cesium timeline
   - Camera: POV, outside follow, or user-controlled
   - Orientation is simple: heading from velocity, pitch from climb/groundspeed, roll from acceleration
   - No deployment, no canopy model, no phase transitions
   - No AOA-based orientation (just flight path angles)

2. **`csmapsim.ts` — Simulator** (fly-with-yourself mode)
   - Full simulator with gamepad controls
   - `SimulatorPlayer` manages play/pause, sim data, camera blending
   - `KeypadFlightControler` handles flight control inputs
   - `SimulatorSequencer` manages deployment timing sequence
   - `SimulatorDeployment` does PC/bridle physics in Cesium Cartesian3
   - `SimCanopyLayer` with snivel model, slider, lines
   - `SimWingsuitLayer` with heading/pitch/AOA decomposition
   - Aero model: WSE polar library (single-segment), not the new segment model
   - Has `Rotation` class (`aerorotation.ts`) with full body rates / Euler / DKE
   - Has inertia model (`inertia.ts`)
   - Has `aerotranslation.ts` for force computation

**Key types:**
- `Point` — GPS data point with lat/lng/alt, velocities, roll, wsaoa, cpaoa, cl, cd, rho
- `HeadingPitchRoll` — orientation for Cesium entities
- `Orientation` — millis + x/y/z for replay animation frames
- `AllOrientations` — precomputed orientation arrays for the Three.js body position replay

**Flight mode detection** (`flight-mode.ts`):
- Simple velocity-based classifier: Plane, Freefall, Wingsuit, Canopy, Ground
- Thresholds on groundSpeed vs climb
- Used for display/classification, not flight dynamics switching

**Replay infrastructure (`replay.ts`):**
- 3225 lines of Three.js replay code
- Pre-computes all orientations into arrays (`AllOrientations`)
- Has deployment animation: reach → grab → pitch → bridle stretch → line stretch → slider → transition → full flight
- Force/velocity/lift/drag vector visualization
- Separate AOA rotation objects for wingsuit (`wsaoaobj`) and canopy (`canopyaoa`, `canopypilott`)

### Polar Project Assets Ready for Export

| Asset | File | What it provides |
|-------|------|-----------------|
| Segment factories | `segment-factories.ts` | Kirchhoff cells, throttle response, canopy cells |
| Polar data | `polar-data.ts` | All segment definitions, positions, coefficients |
| Aero segment | `aero-segment.ts` | Force computation, system summation, wind frame |
| EOM | `eom.ts` | Equations of motion, angular acceleration |
| Sim | `sim.ts` | `computeDerivatives()` — the full 6DOF state derivative |
| Continuous polar | `continuous-polar.ts` | `AeroSegment`, `SegmentControls`, `ContinuousPolar` interfaces |
| Inertia | `inertia.ts` | Inertia tensor computation from mass segments |
| Deploy canopy | `deploy-canopy.ts` | Unzip state machine, deployment sequence |
| Deploy wingsuit | `deploy-wingsuit.ts` | Wingsuit deploy logic |
| Sim runner | `sim-runner.ts` | Phase management, gamepad integration |
| Beta equilibrium | `scripts/beta-equilibrium.ts` | Lateral force equilibrium → β estimate |

### GPS Enhancement Pipeline (just built)

```
GPS raw → CloudBASE (wind correction, SG filter, coefficient matching)
       → stability CSV (V, α, γ, φ, θ, ψ, p, q, r, CL, CD)
       → polar-visualizer β enhancement
       → enhanced CSV (+ beta, θ_corr, ψ_corr, p/q/r_corr)
```

## Integration Options

### Option A: Enhanced CSV Import (Quick Win)

Add a loader to `csmap.ts` that reads the enhanced CSV and overrides orientation.

**Pros:** Fast, no segment factory porting, validates the data quality.
**Cons:** Requires round-trip through CSV, no live computation, debug-only feel.

**Implementation:**
1. File input button on the 3D page
2. Parse enhanced CSV → array of `{t, lat, lng, alt, heading_corr, pitch_corr, roll, beta}` keyed by time
3. In `update()`, if enhanced data exists, use corrected orientation instead of GPS-derived
4. Add canopy model switch at detected deployment time

### Option B: Port Segment Factories to CloudBASE (Full Integration)

Copy the polar-visualizer's aero modules into CloudBASE and wire them into both the simulator and the GPS replay.

**Pros:** Single source of truth for aero model (eventually), enables live sim + replay comparison, enables real-time β computation.
**Cons:** Segment factories are actively being tuned — premature to freeze. Creates maintenance burden until coefficients stabilize.

**Implementation:**
1. Create `app/assets/javascripts/polar/` directory in CloudBASE
2. Copy core modules: `continuous-polar.ts`, `aero-segment.ts`, `segment-factories.ts`, `polar-data.ts`, `eom.ts`, `sim.ts`, `inertia.ts`
3. These are already UI-independent (no Three.js dependencies) — clean copy
4. Wire into `Rotation.update()` for enhanced moment computation
5. Wire into `aerotranslation.ts` for segmented force computation
6. Replace WSE polar library calls with segment model calls

### Option C: Hybrid — NPM Package (Cleanest Long-term)

Publish polar-visualizer's `src/polar/` as an npm package that CloudBASE imports.

**Pros:** Single source of truth, version-controlled, no copy/paste.
**Cons:** Requires package infrastructure, still has the "coefficients are changing" problem.

## Recommended Path

**Phase 1 (Now): Option A — Enhanced CSV Import**
- Validates the data quality and visualization improvement
- Low risk, fast turnaround
- Doesn't commit to segment factory export while coefficients are in flux

**Phase 2 (After coefficient tuning stabilizes): Option B**
- Port the finalized segment factories
- Replace the existing WSE single-segment model
- Full deployment sequence in Cesium (using deploy-canopy.ts logic)
- Enable sim-vs-GPS replay comparison

**Phase 3 (Eventually): Option C**
- Extract `src/polar/` into shared npm package
- Both projects import from the same source
- Version-pinned so CloudBASE can lag behind experimental polar changes

## 3D Replay Enhancement Plan (for Phase 2)

### New Flight Phase System

Replace the simple `flight-mode.ts` classifier with a proper phase state machine:

```
Exit → Freefall/Wingsuit → Deploy Trigger → Bridle → Line Stretch → Inflation → Slider → Canopy → Flare → Landing
```

The polar-visualizer already has this in `WINGSUIT-BASE-FLOW.md` and `deploy-canopy.ts`.

### What Changes in the 3D Viewer

1. **Wingsuit phase**: Use segment model for orientation (α from coefficient matching, β from equilibrium, φ from acceleration). Current `WingsuitLayer` orientation logic replaced with enhanced data.

2. **Deployment phase**: Port `SimulatorSequencer` timing + `deploy-canopy.ts` state machine. Show:
   - PC extraction + bridle stretch (existing `simulatordeployment.ts` already does this)
   - Line stretch + snivel (existing `SimCanopyLayer` has snivel model)
   - Slider descent
   - Pilot pitch rotation (existing `wsaoaobj` → `canopyaoa` transition)

3. **Canopy phase**: Switch to canopy model, use canopy segment model for orientation. Pilot hangs below on pendulum (existing `canopypilott` object).

4. **Model switching**: `WingsuitLayer.update()` → detect phase → swap GLB model + orientation logic. OR use two layers (wingsuit + canopy) and show/hide at the transition.

### Cesium Orientation Notes

Cesium uses `HeadingPitchRoll` → quaternion → ECEF orientation:
- `heading`: clockwise from north (like ψ but opposite sign convention from NED)
- `pitch`: nose up positive (like θ)
- `roll`: right wing down positive (like φ)
- All in radians
- `Transforms.headingPitchRollQuaternion(position, hpr)` handles the Earth-surface rotation

The wingsuit layer already does the heading-π/2 offset + AOA composition via quaternion multiply:
```ts
const aoaq = Quaternion.fromHeadingPitchRoll(new HPR(0, wsaoa, 0))
const hprq = Quaternion.fromHeadingPitchRoll(new HPR(heading - π/2, pitch, roll))
const combined = Quaternion.multiply(hprq, aoaq, new Quaternion())
```

This is the same decomposition as the polar project's body-frame rotation, just in Cesium's convention.

## Files to Watch

| CloudBASE File | Purpose | Integration Point |
|---------------|---------|-------------------|
| `csmap.ts` | GPS 3D replay entry point | Add enhanced CSV loader |
| `csmapsim.ts` | Simulator entry point | Replace aero model |
| `simwingsuitlayer.ts` | Wingsuit GLB + orientation | Enhanced orientation |
| `simcanopylayer.ts` | Canopy GLB + deploy visuals | Phase transition |
| `simulatorsequencer.ts` | Deploy timing | Port deploy-canopy.ts |
| `simulatordeployment.ts` | PC/bridle physics | Already similar to bridle-sim.ts |
| `aerorotation.ts` | Euler/body rate transforms | Already has DKE, needs segment model |
| `aerotranslation.ts` | Force computation | Replace with segment summation |
| `integrator.ts` | Sim loop | Wire in computeDerivatives |
| `flight-mode.ts` | Phase detection | Expand to full state machine |
| `types.ts` | Point, HPR interfaces | Add beta, corrected angles |
| `speedpage-gps-export.ts` | Stability CSV export | Already done (committed) |
| `replay.ts` | Three.js body replay (3225 lines) | Reference for deploy animation |

## Open Questions

1. **When are coefficients "stable enough" for Phase 2?** — After Hartman finishes CP/cm_alpha tuning and GPS overlay shows good agreement at multiple speeds.

2. **Should the canopy model also use the segment model in replay?** — The canopy phase has different orientation dynamics (pendulum). The polar project's canopy model is well-developed but the GPS data during canopy flight may not have good α estimates.

3. **Back-flying and barrel roll visualization** — The polar project is working toward back-flying profiles (Y button transition). When those are ready, the replay should be able to show inverted flight segments.

4. **Multiple track overlay** — CloudBASE already supports multiple tracks on the same map. The sim-vs-GPS comparison could use this: one track = GPS replay, another = sim output.

---

*Created: 2026-03-16*
*Related: WINGSUIT-BASE-FLOW.md, STABILITY-ANALYSIS.md, GPS-STABILITY-SCHEMA.md*
