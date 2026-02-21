# CP Rendering & Scaling — Audit Trail

**Status:** Verified and stable with current assembly scaling (vehicle registry + `CANOPY_AERO_CALIBRATION`).
CP offset formula uses `massReference_m` from `getVehicleMassReference()` (not hardcoded).

---

## 1. Aerodynamic Center Position (**scale-independent**)

### Source
Aerodynamic centers come from the GLB canopy model (`cp2.gltf`):
- **[`_cellQC()`](src/polar/polar-data.ts#L606)** — Cell quarter-chord position from rib mesh
- **[`_cellTE()`](src/polar/polar-data.ts#L614)** — Cell trailing-edge position from rib mesh
- **[`_bridleTop()`](src/polar/polar-data.ts#L627)** — Bridle attachment point from `attachments`

### Conversion Pipeline
```typescript
GLB mesh coordinates (cp2.gltf)
    ↓ (axis mapping: glbZ→nedX, glbX→nedY, -glbY→nedZ)
    ↓ (× glbToNED scale factor = 0.4972)
→ NED-normalized positions (relative to riser convergence)
    ↓ (× pilotScale × referenceLength when rendering)
→ Three.js world coordinates
```

### Scale Independence
The `glbToNED` factor is **fixed and independent of parentScale**:
```typescript
glbToNED = (canopyPhysicalChord / canopyGLBChord) / REF_HEIGHT
         = (3.29 / 3.529) / 1.875
         = 0.4972
```

- **Canopy physical chord (3.29 m):** Physical specification, not affected by visual scale
- **Canopy GLB chord (3.529 GLB units):** Baked into the model geometry, constant
- **REF_HEIGHT (1.875 m):** Pilot height reference, constant

**Conclusion:** Aero center POSITIONS scale correctly automatically via `pilotScale` (which is derived from parentScale).

---

## 2. Center of Pressure Offset Calculation

### Formula
```typescript
cpOffsetNorm = -(sf.cp - 0.25) * seg.chord / massReference_m
```

**Found in:** [vectors.ts:380](src/viewer/vectors.ts#L380)

Where:
- `sf.cp` — CP fraction from 0 (LE) to 1 (TE)
- `0.25` — Quarter-chord (aerodynamic center reference)
- `seg.chord` — **Segment chord value in meters**
- `massReference_m` — Reference length (1.875 m pilot height)

### Chord Values Used
- **Canopy cell:** `chord: 3.29 m` ([polar-data.ts:847](src/polar/polar-data.ts#L847))
  - Comment: "cell chord [m] — 220 ft² canopy, derived from GLB arc span × glbToMeters"
  - Derived from physical spec, not dependent on visual scale
- **Wingsuit:** `chord: 1.8 m` ([polar-data.ts:1108](src/polar/polar-data.ts#L1108))
  - System chord [m]
- **Brake flap:** `chord: 0` initially, set dynamically by [makeBrakeFlapSegment()](src/polar/segment-factories.ts#L356)

### Potential Issue: Chord Tuning Assumption
**Question:** Were these chord values (3.29, 1.8) tuned visually with the assumption that:
- Canopy would scale by 1.5×?
- CP arrows should point to certain visual positions on the mesh?

**If yes:** Changing parentScale to 3.0 might require retuning chord values to keep CP arrows aligned with visual mesh positions.

**If no (values are physically measured):** No change needed.

---

## 3. Scaling Path for CP Rendering

### Step 1: Compute CP position in NED normalized coords
```typescript
cpOffsetNorm = -(sf.cp - 0.25) * seg.chord / massReference_m   // NED units
cpNED = {
  x: segPosX + cpOffsetNorm * cos(pitchRad),
  y: segPosY,
  z: segPosZ + cpOffsetNorm * sin(pitchRad),
}
```

### Step 2: Convert NED to Three.js coords
```typescript
cpThree = nedToThreeJS(cpNED)  // Axis flip: NED→Three.js convention
```

### Step 3: Scale by scene factors
```typescript
posWorld = cpThree.multiplyScalar(pilotScale * massReference_m)
         = cpThree.multiplyScalar(pilotScale * 1.875)
```

**Key:** `pilotScale` is derived from the assembly's **baseParentScale**:
```typescript
pilotScale = (physicsParentScale × s) / CANOPY_GEOMETRY.glbToMeters
```

When parentScale changes from 1.5 → 3.0:
- `canopyMeshScale` increases 2×
- `pilotScale` increases 2×
- CP rendering scales 2×  ✓

---

## 4. Updated Values (parentScale: 3.0)

**Scaling factor:** 3.0 / 1.5 = 2.0

### Deployment Scales (Updated ✅)
| Model | Old (1.5×) | New (3.0×) | File |
|-------|-----------|-----------|------|
| PC | 0.4 | **0.8** | [model-registry.ts:1172](src/viewer/model-registry.ts#L1172) |
| Snivel | 0.6 | **1.2** | [model-registry.ts:1172](src/viewer/model-registry.ts#L1172) |
| Bridle | 1.5 | **3.0** | [model-registry.ts:1172](src/viewer/model-registry.ts#L1172) |
| Fallback bridle | 1.5 | **3.0** | [model-loader.ts:380](src/viewer/model-loader.ts#L380) |

### Chord Values (Check if retuning needed)
| Segment | Value | Physical<br/>or Visual? | Needs<br/>Adjustment? |
|---------|-------|-------------------------|----------------------|
| Canopy cell | 3.29 m | Physical (220 ft² spec) | ❓ Test visually |
| Wingsuit | 1.8 m | Physical (system chord) | ❓ Test visually |
| Parasitic (lines, PC) | 0.01 m | Nominal (drag only) | ✓ No |

---

## 5. Testing Checklist

- [ ] CP arrows render at correct positions relative to visible canopy mesh
- [ ] CP offsets are proportional across all segments
- [ ] No visual discontinuities when switching between segments
- [ ] Bridle attachment point aligns with riser-to-canopy geometry

---

## 6. Reference

- **Aerodynamic center derivation:** [polar-data.ts § "Canopy Cell Positions"](src/polar/polar-data.ts#L580-L596)
- **CP offset formula:** [vectors.ts § updateForceVectors()](src/viewer/vectors.ts#L370-L410)
- **Scaling calculations:** [model-loader.ts § loadVehicleModel()](src/viewer/model-loader.ts#L320-L365)
- **Assembly scaling:** [model-registry.ts § deployScales](src/viewer/model-registry.ts#L1170-L1174)
