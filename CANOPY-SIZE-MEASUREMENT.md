# Ibex UL Canopy Size — Conventional Parachute Measurement

## Current System Dimensions

From `src/polar/polar-data.ts` line 1147 (`ibexulContinuous`):

```typescript
s: 20.439,        // Planform area [m²]
chord: 3.29,      // Reference chord [m]
referenceLength: 1.875  // Pilot height [m]
```

## Parachute Industry Convention

**Parachute surface area = Span × Chord**

This is the standard way parachute manufacturers measure canopy size (analogous to wing area in aviation).

## Calculation

### Step 1: Calculate Span from Area

Using $S = \text{span} \times \text{chord}$:

$$\text{span} = \frac{S}{\text{chord}} = \frac{20.439 \text{ m}^2}{3.29 \text{ m}} = 6.212 \text{ m}$$

### Step 2: Convert to Conventional Units

**Span:**
$$6.212 \text{ m} \times 3.28084 \frac{\text{ft}}{\text{m}} = 20.37 \text{ ft}$$

**Chord:**
$$3.29 \text{ m} \times 3.28084 \frac{\text{ft}}{\text{m}} = 10.79 \text{ ft}$$

**Area (square feet):**
$$20.439 \text{ m}^2 \times 10.764 \frac{\text{sqft}}{\text{m}^2} = \boxed{220.0 \text{ sqft}}$$

### Verification

Check: $20.37 \text{ ft} \times 10.79 \text{ ft} = 219.9 \text{ sqft}$ ✓ (matches within rounding)

---

## Summary

| Dimension | SI Units | Imperial Units |
|-----------|----------|-----------------|
| **Span** | 6.21 m | 20.4 ft |
| **Chord** | 3.29 m | 10.8 ft |
| **Area** | 20.4 m² | **220 sqft** |

---

## Parachute Classification Context

A **220 sqft canopy** is a mid-range recreational paraglider:

| Size Category | Area Range | Typical Use |
|---------------|-----------|-------------|
| Very small | 150–180 sqft | Sport acro, advanced pilots |
| **Small** | **180–200 sqft** | **Intermediate XC** |
| **Medium** | **200–230 sqft** | **Recreation / XC (Ibex UL here)** |
| Large | 230–270 sqft | Thermaling, light pilot |
| Very large | 270+ sqft | Heavy pilot, strong wind |

The Ibex UL at 220 sqft is solidly in the recreational cross-country range — consistent with a ~77.5 kg system mass.

---

---

## Actual GLB Geometry Measurements

From the canopy GLB model (`cp2.gltf`), buffer geometry analysis:

### Measured Dimensions (GLB Units)

| Component | Min | Max | Extent (Units) |
|-----------|-----|-----|-----------------|
| **Span (x)** | -3.133 | +3.133 | **6.266 units** |
| **Chord (z)** | -2.874 | +0.654 | **3.528 units** |

**Source:** Rib_8_L and cell mesh data (Top_1_L through Top_7_L, Bottom meshes, etc.)

### GLB Area Calculation

Using the parachute convention (Area = Span × Chord):

$$\text{GLB Area} = 6.266 \text{ units} \times 3.528 \text{ units} = 22.10 \text{ unit}^2$$

### Scaling to Match Measured 120 sqft

If the actual canopy is **120 sqft** (as previously measured):

$$\text{Scale factor} = \sqrt{\frac{120 \text{ sqft}}{22.10 \text{ unit}^2}} = \boxed{2.334 \text{ ft/unit} = 0.711 \text{ m/unit}}$$

**At this scale:**
- **Span:** 6.266 units × 0.711 m/unit = **4.45 m** (14.6 ft)
- **Chord:** 3.528 units × 0.711 m/unit = **2.51 m** (8.23 ft)
- **Area:** 4.45 m × 2.51 m = **11.2 m²** = **120 sqft** ✓

---

## Size Discrepancy: Why 120 vs 220?

| Source | Span | Chord | Area |
|--------|------|-------|------|
| **GLB measured** | 6.266 u | 3.528 u | 22.10 u² |
| **At 0.711 m/u scale** | 4.45 m | 2.51 m | **120 sqft** |
| **Coded system** | 6.21 m | 3.29 m | **220 sqft** |
| **Scale factor (coded)** | 0.991 m/u | 0.932 m/u | — |

**Analysis:**
- The GLB model dimensions (6.266 × 3.528 units) are consistent with a "small" canopy when scaled at 0.71 m/unit
- The coded system values assume a different scale (0.93 m/unit), resulting in a larger **220 sqft** canopy
- **The two don't match because the GLB was possibly modeled at a different target size than the physics system**

---

## Which is Correct?

**For the current system:** Use **220 sqft** (current coded values: 3.29 m chord, 6.21 m span, 20.439 m² area)

**For the GLB render:** If the model was built for a 120 sqft canopy, the GLB dimensions are correct at their native scale, but they're being rendered larger in the 3D view due to scaling applied in `model-loader.ts`

**Recommendation for Phase C/D:**
- Keep the physics system at **220 sqft** (currently validated and tuned)
- Document that the GLB model represents a **smaller reference geometry** that's scaled up for rendering
- When decoupling components (Phase C), capture both:
  - Physics reference size (220 sqft via 3.29 m chord)
  - GLB model dimensions (22.10 unit² = reference for 3D geometry)
  - Rendering scale factor (how much to inflate the GLB to match physics)

---

## Reference Information

**Wingsuit reference (pilot height):** 187.5 cm = 1.875 m
- This is the reference length used for normalizing segment positions in the physics engine
- Independent of canopy dimensions (Aura 5 is worn by the same 1.875 m reference pilot)

**Canopy reference:** 3.29 m chord (physics system)
- Currently the system uses pilot height (1.875 m) as universal `referenceLength`
- Could be changed to 3.29 m (chord) or 4.45 m (GLB-measured chord) with refactoring

---

## Notes for Refactoring (Phase C/D)

With **VEHICLE-REFACTOR Phase C**, we'll record per-component references:
- **Pilot reference:** `1.875 m` (Aura 5 height)
- **Canopy physics reference:** `3.29 m` (chord), giving 220 sqft area
- **Canopy GLB reference:** `3.528 GLB units` (chord), native model size
- **Rendering scale:** computed from GLB bounding box → physics size ratio

This architecture will:
- Keep physics tuning stable (220 sqft baseline)
- Allow GLB updates without affecting flight model
- Enable independent scaling of physics vs. rendering
- Document the transformation pipeline clearly
