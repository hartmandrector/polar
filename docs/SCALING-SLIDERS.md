# SCALING-SLIDERS.md — Pilot & Pivot Slider Design

> **Status:** Pilot Height Slider ✅ implemented, Pivot Junction planned
> **Parent:** [VEHICLE-SCALING-PLAN.md](VEHICLE-SCALING-PLAN.md)
> **Updated:** 2026-02-22

---

## 0. Pilot Size Compensation (Static Calibration)

Before understanding the dynamic sliders, it's important to understand the
**static compensation** that corrects for inherent GLB model scale issues.

### The Problem
GLB models are authored at arbitrary scales. Even after applying
`childScale` (computed from GLB-to-meters ratios), the pilot mesh may not
match the expected physical proportions of the mass/aero overlays. This is
because `childScale` corrects for the *documented* GLB scale, but not for
any *modeling errors* in the original GLB.

### The Solution: `pilotSizeCompensation`

A per-assembly constant in `VehicleAssembly` that applies an additional
scale factor to correct for inherent GLB model scale differences.

```typescript
// model-registry.ts
interface VehicleAssembly {
  // ... other fields
  readonly pilotSizeCompensation?: number  // default 1.0
}

CANOPY_WINGSUIT_ASSEMBLY = {
  // ...
  pilotSizeCompensation: 0.5,  // e.g., GLB model is 2× too large
}
```

### What It Scales (Atomically)

| System | Effect |
|--------|--------|
| GLB mesh | `childSc = childScale × pilotSizeCompensation` |
| Pivot position | `offset.y` scaled by compensation |
| Mass overlays | Pilot segment positions scaled by compensation |
| Aero arrows | Pilot segment CP positions scaled by compensation |
| Shoulder offset | Computed using compensated `childSc` |

### What It Does NOT Scale
- **Canopy** — unaffected (compensation is pilot-only)
- **Physics values** — mass, inertia, reference lengths stay the same
- **pilotScale** — the NED→scene conversion factor is independent

### Where It Lives
- **Definition:** [model-registry.ts#VehicleAssembly](../polar-visualizer/src/viewer/model-registry.ts)
- **Mesh scaling:** [model-loader.ts#childSc](../polar-visualizer/src/viewer/model-loader.ts)
- **Mass overlay:** [mass-overlay.ts#update()](../polar-visualizer/src/viewer/mass-overlay.ts)
- **Aero vectors:** [vectors.ts#updateForceVectors()](../polar-visualizer/src/viewer/vectors.ts)

### How to Tune
1. Set pilot height slider to 187.5 cm (default)
2. Enable mass overlay (cyan spheres) and pilot segment force vectors
3. Adjust `pilotSizeCompensation` until overlays align with GLB mesh
4. Values < 1.0 shrink the pilot; values > 1.0 enlarge it

---

## 1. Pilot Height Slider (Dynamic)

**Pattern:** Same as the existing canopy area slider — one control that
couples GLB mesh scaling with aerodynamic/mass parameter scaling.

**Implementation:** ✅ Complete (2026-02-22)

### Input
- Slider range: 75 – 230 cm
- Default: 187.5 cm (1.875 m)

### What Scales
| System | Parameter | How It Scales |
|--------|-----------|--------------|
| GLB mesh | Uniform scale | `newChildScale = baseChildScale × ratio` |
| Pivot position | Full initial position | Scales by `ratio` to maintain riser attachment |
| Shoulder offset | Within-pivot offset | Scales by `ratio` |
| Mass positions | Pilot segments | Scale by `ratio` via `pilotHeightRatio` |
| Aero positions | Pilot segment CP | Scale by `ratio` via `pilotHeightRatio` |
| `massReference` | Via `getVehicleMassReference()` | Unchanged (still 1.875) |
| `referenceLength` | Polar field | Unchanged (aero is normalized) |

Where `ratio = heightCm / 187.5`.

### Key Constraint
When pilot is under canopy, the riser attachment is the fixed point.
Pilot mesh scales below the riser. Canopy is unaffected.

### Interaction with pilotSizeCompensation
The compensation is applied to the **base** values that the slider then scales:
```
effectiveScale = baseChildScale × pilotSizeCompensation × heightRatio
```
So the slider works correctly regardless of the compensation value.

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
- Aerodynamic coefficients (those scale with the pilot/canopy sliders)

### Current Implementation Scatter

These related values are currently spread across multiple files:

| Value | Current Location |
|-------|-----------------|
| `parentScale` | `model-registry.ts` → `VehicleAssembly` |
| `childScale` | `model-registry.ts` → `VehicleAssembly` / `deriveAssemblyOffsets()` |
| `shoulderOffsetFraction` | `model-registry.ts` → `VehicleAssembly` |
| `PILOT_PIVOT_X/Z` | `polar-data.ts` (physics pivot) |
| Pivot group creation | `model-loader.ts` (rendering pivot) |

Note: `trimAngleDeg` is implicitly captured by the assembly system and
does not need independent control.

**Goal:** Consolidate into `VehicleDefinition` in the vehicle registry so
the slider has one place to read/write.

---

## 3. The Complete Pilot Scaling Chain

The pilot scaling system involves multiple layers that work together.
Understanding the full chain is essential for making changes.

### Layer 1: Static Assembly (load-time)
```
childScale = derived from GLB-to-meters ratios
  └── pilotSizeCompensation applied → childSc = childScale × compensation
        └── pilotModel.scale.setScalar(childSc)
```

### Layer 2: Pivot Positioning (load-time)
```
offset.position.y = assembly.childOffset.y
  └── scaledOffsetY = offset.y × pilotSizeCompensation
        └── shoulderOffset = fraction × bodyExtent × childSc
              └── pivotPos.y = scaledOffsetY + shoulderOffset
```

### Layer 3: Stored Values for Closure
The `setPilotHeight` closure captures these **base values**:
```typescript
_basePilotChildScale = childSc           // includes compensation
_pilotBodyExtentY = pilotSize.z          // raw GLB body length
_pilotShoulderFrac = assembly.fraction   // shoulder offset fraction
_baseShoulderOffset = shoulderOffset     // computed at load time
_pilotOffsetPos.y = scaledOffsetY + shoulderOffset  // FULL initial pivot position
```

### Layer 4: Dynamic Slider (runtime)
```
ratio = heightCm / 187.5
newChildScale = _basePilotChildScale × ratio
newShoulderOffset = _baseShoulderOffset × ratio
newPivotPos.y = _pilotOffsetPos.y × ratio
```

### Layer 5: Physics Overlays (runtime)
```
mass-overlay.ts:  posScale = isCanopy ? canopyScaleRatio : pilotSizeCompensation
vectors.ts:       posScale = seg.name !== 'pilot' ? canopyScaleRatio : pilotSizeCompensation
```

**Key Insight:** The slider scales the *entire* initial position (including
shoulder offset) by ratio. If we stored offsetY and shoulderOffset separately,
their nearly-canceling values would produce positions close to zero at small
ratios.

---

## 4. Guidance for Future Changes

### Adding a New Scaling Parameter
1. **Define the field** in `VehicleAssembly` (model-registry.ts)
2. **Extract at load time** in the assembly composition code (model-loader.ts)
3. **Store for closures** if it needs dynamic runtime adjustment
4. **Pass to overlays** via LoadedModel and update call signatures
5. **Update tests** if scaling affects physics values

### Common Pitfalls

| Issue | Symptom | Fix |
|-------|---------|-----|
| Mesh scales, overlays don't | Mass points / arrows at wrong positions | Pass compensation to mass-overlay and vectors |
| Pivot detaches when scaling | Pilot floats away from risers | Scale the *full* initial pivot position, not just offset |
| Canopy affected by pilot changes | Canopy scales when it shouldn't | Check posScale logic — canopy uses canopyScaleRatio |
| Slider works at ratio=1.0 only | Breaks at other values | Ensure stored base values include all compensation |

### Testing Checklist
- ✓ Set pilotSizeCompensation to 0.5, verify mesh/overlays align
- ✓ Set pilot height slider to 75cm, verify pilot stays on risers
- ✓ Set pilot height slider to 230cm, verify overlays still align
- ✓ Change canopy area slider, verify pilot unchanged
- ✓ Return to defaults, verify alignment restored

### Known Quirk
Mass overlay updates may not appear immediately after changing the pilot height slider alone. Adjusting another slider (e.g., pilot pitch) forces a full refresh. This is a minor debug-tooling edge case, not a physics issue.

---

## Implementation Notes

Both sliders follow the same wiring pattern as the existing canopy slider:
1. HTML range input in `index.html` or `debug-panel.ts`
2. Read via getter (e.g., `getPilotHeightCm()`)
3. Apply in `main.ts` render loop (mesh scale + physics parameters)
4. Verify in debug panel (readout of effective values)

The pilot height slider is currently implemented in `debug-panel.ts` (Debug Overrides section).

See [Phase D tasks](reference/VEHICLE-REFACTOR-IMPLEMENTATION.md#phase-d-ui-scaling-controls)
for the detailed implementation checklist (Tasks D.1–D.6).
