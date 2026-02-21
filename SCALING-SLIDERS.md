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

**Purpose:** Control the riser-to-pilot connection geometry so different
GLB models (with different shoulder positions, harness attachment points)
assemble correctly.

### Input
- Trim angle: −5° to +15° (default: 6° forward)
- Pendulum length offset: −0.1 to +0.1 NED normalized (adjusts vertical
  distance from riser to pilot CG)

### What It Controls
| Parameter | Current Source | What Slider Does |
|-----------|--------------|-----------------|
| `trimAngleDeg` | `CANOPY_WINGSUIT_ASSEMBLY` (6°) | Adjusts pilot forward lean |
| `PILOT_PIVOT_X/Z` | Hardcoded in `polar-data.ts` | Shifts riser attachment point |
| `shoulderOffset` | Derived from GLB in `model-loader.ts` | Override for non-standard pilot GLBs |

### Why This Matters
The pivot point is at the riser convergence (origin). Both pilot and canopy
rotate about this point. If a user's pilot GLB has different proportions
(e.g., harness attachment 10cm higher than our default), the pivot slider
lets them correct the assembly without re-authoring the GLB.

### Interaction with Other Sliders
- Pilot height slider changes mass distribution below pivot → affects pendulum dynamics
- Canopy area slider changes forces above pivot → affects trim angle
- Pivot slider adjusts the junction itself → affects both sides

---

## Implementation Notes

Both sliders follow the same wiring pattern as the existing canopy slider:
1. HTML range input in `index.html`
2. Read in `controls.ts` → `FlightState`
3. Apply in `main.ts` render loop (mesh scale + physics parameters)
4. Verify in debug panel (readout of effective values)

See [Phase D tasks](docs/reference/VEHICLE-REFACTOR-IMPLEMENTATION.md#phase-d-ui-scaling-controls)
for the detailed implementation checklist (Tasks D.1–D.6).
