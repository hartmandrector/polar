# SCALING-SLIDERS.md — Pilot & Pivot Slider Design

> **Status:** Planning
> **Parent:** [VEHICLE-SCALING-PLAN.md](VEHICLE-SCALING-PLAN.md)

---

## 1. Pilot Height Slider

**Pattern:** Same as the existing canopy area slider — one control that
couples GLB mesh scaling with aerodynamic/mass parameter scaling.

### Input
- Slider range: 1.50 – 2.10 m
- Default: 1.875 m (current pilot)

### What Scales
| System | Parameter | How It Scales |
|--------|-----------|--------------|
| GLB mesh | Uniform scale | `k = newHeight / baseHeight` |
| Mass positions | All NED normalized positions | Unchanged (normalized); denormalization uses new height |
| `referenceLength` | Polar field | Updated to `newHeight` for standalone pilot polars |
| `massReference` | Via `getVehicleMassReference()` | Updated to `newHeight` |
| Segment areas | `S` per segment | `S *= k²` (body cross-sections scale quadratically) |
| Inertia | Computed from mass segments | Automatic — reads `massReference` |
| Moment arms | CG-to-segment distances | Automatic — reads `referenceLength` |

### Key Constraint
When pilot is under canopy, the riser attachment is the fixed point.
Pilot mesh scales below the riser. Canopy is unaffected.

---

## 2. Pivot Junction Slider

**Purpose:** Abstract control (0.0 – 1.0) that adjusts the scaling ratio
between pilot and canopy at their connection point (riser convergence / origin).

### Why It Exists

The canopy and pilot GLBs are authored independently at arbitrary scales.
The assembly system uses `parentScale` and `childScale` to make them fit
together — `deriveAssemblyOffsets()` computes `childScale` from the ratio
of their `glbToMeters` values. But if a user brings a custom GLB with
different proportions, the derived ratio may not produce the right visual
or physical junction. This slider lets them correct it.

### Input
- Slider range: 0.0 – 1.0 (default: 0.5 = current derived ratio)
- 0.0 = pilot scaled smallest relative to canopy
- 1.0 = pilot scaled largest relative to canopy

### What It Controls

The slider interpolates `childScale / parentScale` — the ratio that
determines how big the pilot renders relative to the canopy mesh:

```
effectiveChildScale = lerp(minRatio, maxRatio, sliderValue) × parentScale
```

Where `minRatio` and `maxRatio` define a reasonable range around the
derived default (e.g., ±30% of `deriveAssemblyOffsets().childScale`).

This single abstract value adjusts:
| Parameter | Effect |
|-----------|--------|
| `childScale` | Pilot mesh size relative to canopy |
| `shoulderOffsetFraction` | Shoulder-to-riser distance (scales with child) |
| `pilotPivot.position` | 3D pivot placement (derived from shoulder offset) |
| Pendulum length | Visual + physics distance from riser to pilot CG |

### What It Does NOT Control
- Canopy size (that's the canopy area slider)
- Pilot height in meters (that's the pilot height slider)
- Trim angle (separate parameter, could be its own control later)
- Aerodynamic coefficients (those scale with the pilot/canopy sliders)

### Current Implementation Scatter

These related values are currently spread across multiple files:

| Value | Current Location |
|-------|-----------------|
| `parentScale` | `model-registry.ts` → `VehicleAssembly` |
| `childScale` | `model-registry.ts` → `VehicleAssembly` / `deriveAssemblyOffsets()` |
| `shoulderOffsetFraction` | `model-registry.ts` → `VehicleAssembly` |
| `trimAngleDeg` | `model-registry.ts` → `VehicleAssembly` |
| `PILOT_PIVOT_X/Z` | `polar-data.ts` (physics pivot) |
| Pivot group creation | `model-loader.ts` (rendering pivot) |

**Goal:** Consolidate into `VehicleDefinition` in the vehicle registry so
the slider has one place to read/write.

---

## Implementation Notes

Both sliders follow the same wiring pattern as the existing canopy slider:
1. HTML range input in `index.html`
2. Read in `controls.ts` → `FlightState`
3. Apply in `main.ts` render loop (mesh scale + physics parameters)
4. Verify in debug panel (readout of effective values)

See [Phase D tasks](docs/reference/VEHICLE-REFACTOR-IMPLEMENTATION.md#phase-d-ui-scaling-controls)
for the detailed implementation checklist (Tasks D.1–D.6).
