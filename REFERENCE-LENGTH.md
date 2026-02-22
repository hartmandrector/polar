# REFERENCE-LENGTH.md — Scaling & Normalization Overhaul

> **Status:** Phase A + B + C complete. Phase D (UI scaling controls) planned.
> **Created:** 2026-02-20
> **Author:** Polar Claw + Hartman

---

## Problem Statement

The entire codebase normalizes positions by a single hardcoded constant
`1.875` — the pilot's height without shoes. This value appears in **3 named
constants** and **~25 bare literals** across 15+ files.

### Why 1.875 Is Wrong

| Issue | Detail |
|-------|--------|
| **Historical accident** | Original body scan was 2× scaled from a different-height pilot. The 1.875 value stuck. |
| **Not the flight chord** | Pilot height without shoes ≠ reference chord in flight. True head-to-tail (with inflated wingsuit tail fabric) is ~1.93m, possibly more with helmet. |
| **Global when it should be per-component** | Canopy, pilot, and wingsuit all normalize by 1.875 even though they have different natural reference dimensions. |
| **Blocks independent scaling** | Can't say "same wingsuit, shorter pilot" or "same pilot, 300 sqft canopy" without everything breaking. |

### The Scaling Chain Problem

The model-loader pipeline applies scaling in a sequence that's hard to
reason about:

```
1. Load raw GLB
2. Apply parentScale (canopy: 1.5) with X-flip → scale(-1.5, 1.5, 1.5)
3. Apply childScale (pilot: 0.850) → pilotModel.scale.setScalar(0.850)
4. Compute referenceDim from pilot bounding box
5. Normalize: s = TARGET_SIZE / referenceDim → compositeRoot.scale *= s
6. Derive pilotScale = canopyMeshScale / (glbToNED × 1.875)
7. Apply CG offset (shift to physics origin)
8. Bridle: bridleScale × |s|
9. Deployment: scale canopy mesh per-axis (span × chord)
```

Some of these scales are necessary (GLB units → physical meters → scene units).
Some are compensating for earlier scales that could be simplified. The X-flip
is required (canopy GLB has mirrored convention). But `parentScale = 1.5` and
`childScale = 0.850` exist because the canopy and pilot GLBs have different
GLB-to-meters ratios, and the composite needs them to match.

**The ideal end state**: each scale factor has a clear physical meaning and a
name that explains what it does. Redundant scale-then-unscale chains are
collapsed. The number of magic constants approaches zero.

---

## Current Constants Inventory

### Named Constants
```typescript
// model-registry.ts — render-only, do not use for aero reference
const REF_HEIGHT = 1.875

// polar-data.ts — wingsuit aero reference (head-to-tail flight chord)
const A5_REF_LENGTH = 1.93
const A5_HEIGHT = 1.875    // pilot height (mass normalization)

// polar-data.ts — canopy aero reference (= pilot height for now)
const IBEX_REF_LENGTH = 1.875
```

### GLB Scaling Chain (model-registry.ts)
```typescript
// Per model:
glbToMeters = REF_HEIGHT / maxGlbDim        // GLB units → meters
glbToNED    = glbToMeters / REF_HEIGHT       // GLB units → NED normalized
//          = 1 / maxGlbDim                  // (simplifies — REF_HEIGHT cancels!)
referenceHeight = REF_HEIGHT                 // stored on every model
```

Note: `glbToNED` simplifies to `1/maxGlbDim` — the REF_HEIGHT cancels out.
This means GLB-to-normalized is independent of pilot height. The reference
height only matters when denormalizing (NED normalized → meters).

### Composite Assembly Scaling (model-loader.ts)
```typescript
parentScale = 1.5                            // canopy mesh relative to pilot
childScale  = 0.850                          // pilot mesh relative to canopy
// childScale = parentScale × (pilotGlbToMeters / canopyGlbToMeters)
//            = 1.5 × (1.875/3.384) / (3.29/3.529)
```

### Scene Normalization (model-loader.ts)
```typescript
TARGET_SIZE = 2.0                            // desired screen size in Three.js units
s = TARGET_SIZE / referenceDim               // normalize so pilot body = 2.0 units
pilotScale = canopyMeshScale / glbToMeters   // NED meters → scene units
```

### Denormalization in Physics
```typescript
// Mass functions use massReference (from vehicle registry):
computeInertia(segments, massReference, mass)    // massReference = 1.875 (all vehicles)
computeCenterOfMass(segments, massReference, mass)

// Aero functions use polar.referenceLength:
sumAllSegments(segments, forces, cg, polar.referenceLength, ...)  // 1.93 wingsuits, 1.875 canopies
evaluateAeroForcesDetailed(segments, cg, polar.referenceLength, vel, omega, controls, rho)

// Vehicle registry provides both:
const massReference = getVehicleMassReference(vehicle, polar)  // always 1.875 currently
const aeroRef = polar.referenceLength                          // 1.93 or 1.875
```

---

## Proposal

### Phase A: Name and Centralize (zero behavioral change)

**Goal:** Every `1.875` in the codebase traces to a named field on the polar
it belongs to. No computed results change.

1. Add `referenceLength: number` to `ContinuousPolar` interface
2. Set `referenceLength: 1.875` on every polar definition in `polar-data.ts`
3. Replace all ~25 bare `1.875` literals with `polar.referenceLength`
4. Consolidate `A5_HEIGHT`, `REFERENCE_HEIGHT` → read from their polars
5. Keep `REF_HEIGHT` in model-registry for now (it's the GLB scaling anchor)

**What this unlocks:** Every denormalization call is traceable to its polar.
Changing a polar's `referenceLength` automatically propagates to all its
physics. Tests can verify behavior with different reference lengths.

### Phase B: Correct the Wingsuit Reference

**Goal:** Fix the wingsuit chord to its true value (~1.93m).

1. Change `aurafiveContinuous.referenceLength` from 1.875 to 1.93
2. All wingsuit segment positions stay the same (they're normalized)
3. Moment arms increase by 1.93/1.875 = 2.9%
4. Inertia increases by (1.93/1.875)² = 5.9%
5. Update test expected values
6. Verify trim doesn't shift significantly

**Risk:** Low — the wingsuit operates standalone. No coupling to canopy.

**Phase B Status:** ✅ Completed (2026-02-20)
- `aurafiveContinuous.referenceLength` updated to 1.93m (aero reference).
- Tests pass: 220/220.
- Expected scaling confirmed: moment arms +2.9%, inertia +5.9%.

### Phase C: Per-Component Reference Frames ✅

**Status:** Completed (2026-02-20). Chose option 4 (keep canopy normalized by pilot height).

**Decision:** Canopy positions remain normalized by pilot height (1.875m) since
the canopy-pilot composite is always assembled together. The canopy's physical
dimensions (`s`, `chord`, `span`) scale independently of position normalization.

**What was implemented:**
- `VehicleDefinition` registry with per-component reference lengths
- `getVehicleMassReference()` returns mass reference per vehicle type
- `polar.referenceLength` carries aero reference per polar (1.93 wingsuits, 1.875 canopies)
- Mixed normalization: CG uses mass reference, positions use aero reference
  - For wingsuits: ~2.9% lever-arm discrepancy (1.875 vs 1.93) — acceptable
  - For canopies: both are 1.875, no discrepancy
- Debug panel with aero verification readout (Physics S vs Visual S)
- All TODO(ref-audit) comments resolved

For true independent scaling (different pilot under same canopy), we'd need
to store canopy positions in canopy-relative coordinates and transform them
at assembly time. That's Phase D territory.

### Phase D: Scaling Controls

**Goal:** UI sliders for canopy area and pilot height. Visual and physics
scale together.

1. Canopy area slider (e.g., 150–350 sqft)
   - Scale factor: `k = √(newArea / baseArea)`
   - Apply to: `S *= k²`, `chord *= k`, `span *= k`, positions × k
   - GLB mesh: scale X and Z by k

2. Pilot height slider (e.g., 1.50–2.00m)
   - Scale factor: `k = newHeight / baseHeight`
   - Apply to: `referenceLength = newHeight`, mass positions × k, body areas × k²
   - GLB mesh: uniform scale by k

3. Riser connection stays at canopy attachment point
   - Pilot hangs from riser regardless of pilot scale
   - Canopy scale changes riser-to-canopy distance

---

## The Scaling Simplification Opportunity

Looking at the model-loader scaling chain, several factors exist only to
compensate for other factors:

```
parentScale (1.5) × childScale (0.850) × normalization (s) × pilotScale
```

If we could define each GLB's physical size directly (pilot = 1.875m,
canopy chord = 2.8m), then:

```
pilotMeshScale = desiredMeters / glbDim          // one step
canopyMeshScale = desiredMeters / glbDim         // one step
sceneScale = TARGET_SIZE / pilotMeshScale         // scene normalization
```

The `parentScale/childScale` dance exists because the canopy GLB was
visually sized to "look right" relative to the pilot, rather than being
scaled to a known physical dimension. If we anchor both to physical
measurements, the intermediate compensations collapse.

**This is the key insight:** every unnecessary scale factor exists because
something upstream wasn't anchored to a physical measurement. Push the
physical dimensions back to the source (registry), and intermediate scales
cancel out.

---

## Files Affected (by phase)

### Phase A (centralize constant)
| File | Changes |
|------|---------|
| `continuous-polar.ts` | Add `referenceLength` to interface |
| `polar-data.ts` | Add field to all polar definitions, remove `A5_HEIGHT` |
| `segment-factories.ts` | Remove `REFERENCE_HEIGHT`, read from polar |
| `main.ts` | Replace ~14 bare `1.875` with `polar.referenceLength` |
| `vectors.ts` | Replace ~5 bare `1.875` |
| `chart-data.ts` | Replace 2 bare `1.875` |
| `inertia.ts` | Remove default `= 1.875` from signatures |
| `eom.ts` | Remove default `= 1.875` from signatures |
| `model-loader.ts` | Replace 2 bare `1.875` |
| Tests (5 files) | Replace ~15 bare `1.875` |

### Phase B (correct wingsuit)
Mostly `polar-data.ts` + test expected values.

### Phase C (per-component)
`composite-frame.ts`, `model-loader.ts`, `polar-data.ts`, `model-registry.ts`

### Phase D (UI controls)
`controls.ts`, `main.ts`, `index.html`, `model-loader.ts`

---

## Open Questions

1. ~~**What is the true wingsuit flight chord?**~~ **Answered:** 1.93m (A5_REF_LENGTH).

2. **What is the canopy's true planform area?** The GLB is a ~120 sqft design
   scaled to ~220 sqft via physics. Hartman's actual canopy is 210 sqft.
   Physics uses S=20.439 m² (220 ft²). Visual mesh shows ~46 m² (495 ft²)
   due to assembly `overlayPositionScale` (0.5631). Accepted as visual alignment.

3. **Should we collapse parentScale/childScale?** If we anchor both GLBs to
   physical dimensions via the registry, these intermediate factors become
   redundant. But the X-flip (canopy mirroring) still needs to happen somewhere.

4. ~~**Default `= 1.875` in function signatures**~~ **Resolved:** callers pass
   explicit values from `getVehicleMassReference()` or `polar.referenceLength`.
