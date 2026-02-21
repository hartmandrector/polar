# MODEL-GEOMETRY.md — 3D Model Geometry Registry

## Purpose

Single source of truth for all GLB model geometry: bounding boxes, landmarks,
pivot points, attachment points, aero segment anchors, and assembly rules.
Replaces ad-hoc magic numbers scattered across `model-loader.ts`, `vectors.ts`,
and `polar-data.ts`.

**Every spatial constant in the codebase should trace back to a measurement
recorded in this document.**

---

## Coordinate Systems

### GLB Space (per-model, as authored)
Each GLB file has its own coordinate system determined by the authoring tool.
Axes are documented per-model below. All GLB measurements are in **GLB units**
(arbitrary scale — see `glbToMeters` for physical scaling).

### NED Body Frame (physics)
- **x** = forward (North) — head/nose direction
- **y** = right (East)
- **z** = down

All physics, segment positions, mass positions, and force computations use NED.
Positions are **height-normalized** (divided by reference height, typically 1.875 m).

### Three.js Scene Frame (rendering)
- **X** = right
- **Y** = up
- **Z** = toward camera (forward in body frame)

Conversion from NED: `three.x = -ned.y`, `three.y = -ned.z`, `three.z = ned.x`

**Canonical implementation:** `nedToThreeJS()` and `windDirectionBody()` in
`src/viewer/frames.ts`. All NED↔Three.js conversions must go through this
module — do not re-derive the axis swap elsewhere.

### Chord-Fraction Frame (wingsuit segments)
Position along the body axis expressed as fraction of system chord (0 = leading
edge/head, 1 = trailing edge/feet). Converted to NED via `a5xc()`:
```
NED_x = (CG_xc - xc) × chord / height
```

---

## Normalization Strategy

### Two parallel systems

Positions need to exist in **two independent systems**:

1. **Three.js scene** — for rendering, model composition, bounding box
   measurement, pivot group hierarchies. Managed by `model-loader.ts`.
2. **NED physics** — for aerodynamic forces, mass distribution, CG/CP
   computation, moment arms. Managed by `polar-data.ts` and `aero-segment.ts`.

Three.js scene composition (groups, pivots, rotations) is powerful for
rendering but **insufficient for physics**. The physics system must replicate
all rotations and offsets mathematically to produce correct NED positions for:
- Mass segment positions (for CG and inertia computation)
- Aero segment positions (for moment arms and CP)
- Pivot points (for articulated components like pilot pitch)

### Normalization conventions

| Domain | Convention | Reference | Where |
|--------|-----------|-----------|-------|
| **Aerodynamic segments** | Chord-fraction (x/c), 0 = LE/head | Segment chord length | `polar-data.ts`, `a5xc()` |
| **Mass segments** | NED-normalized, relative to system CG | `A5_HEIGHT` (1.875 m) | `polar-data.ts` |
| **Three.js rendering** | Scene units, `TARGET_SIZE` (2.0) | Pilot body max dimension | `model-loader.ts` |
| **GLB raw** | Arbitrary GLB units | Per-model authoring tool | Measured in Blender/editor |

### Conversion pipeline: GLB → meters → NED → Three.js

1. **Measure** each GLB's raw bounding box (GLB units)
2. **Record** the real-world physical size of the object (meters)
3. **Compute** `glbToMeters = physicalDimension / rawBBoxDimension`
4. **All landmarks** are recorded in GLB units, converted to meters via `glbToMeters`
5. **NED normalized** = meters / referenceHeight (1.875 m for pilot-based vehicles)
6. **Three.js scene** scales from meters to scene units via `targetSize / referenceDim`

### Pilot height vs. aerodynamic chord

These are **two different lengths** and must not be conflated:

| Quantity | Value | What it is |
|----------|-------|------------|
| `A5_HEIGHT` | 1.875 m | Pilot physical height (head to toe, standing) — **normalization divisor** for all NED positions |
| `A5_SYS_CHORD` | 1.8 m | Wingsuit aerodynamic chord (LE to TE in flight) — **shorter** than pilot height because the body arches |
| GLB max dimension | ~2.16 m (TBD) | Raw GLB bounding box longest axis — **longer** than pilot height because wingsuit fabric extends past feet/hands |
| `FABRIC_OVERSHOOT` | 1.15 | Ratio: GLB max dim / pilot physical height — accounts for fabric extending beyond limb tips |

The `1.15` factor (currently in `model-loader.ts` line 243) compensates for the
GLB mesh being ~15% larger than the actual body. This is a measured observation,
not a fudge — the wingsuit fabric genuinely extends past the feet and hands.

### Current system (bbox-relative) vs. target system (physics-derived)

**Current:** The code measures the composite bounding box (canopy + pilot) and
normalizes to `TARGET_SIZE`. The `pilotScale` factor converts back to physical
meters. `CANOPY_SCALE` (1.5) is applied *before* normalization. All positions
were hand-tuned in the assembled vehicle frame.

**Problem:** Changing the canopy to a different size breaks all the hand-tuned
positions. The CG offset, mass segment positions, and aero segment positions
are all baked for one specific assembly.

**Target:** Each model has its own `glbToMeters` and physical dimensions.
Assembly is done in meters, then converted to NED and Three.js independently.
`CANOPY_SCALE` should emerge from `canopyPhysicalChord / canopyGLBChord` rather
than being a magic number. Positions are computed from local-frame data +
rotations + offsets, not hand-tuned in the assembled frame.

This means:
- Model data is measured once in GLB space (stable across re-exports)
- Physical dimensions are recorded separately (changeable without re-measuring)
- Assembly is done in meters (intuitive, checkable)
- Physics gets NED-normalized values (consistent with existing code)
- Swapping a canopy model only requires updating that model's geometry data

---

## Per-Model Geometry

---

### tsimwingsuit.glb — Wingsuit Pilot (Aura 5)

**Used as:** Standalone wingsuit flyer AND canopy pilot sub-model.
Two separate model geometry configs because the contexts differ significantly.

#### Raw GLB Properties

| Property | Value | Notes |
|----------|-------|-------|
| File | `/models/tsimwingsuit.glb` | |
| GLB origin | { x: 0, y: 0, z: 0 } | Approximately at belly/CG |
| Forward axis | + Z | Which GLB axis is head direction |
| Up axis | +Y | Which GLB axis is dorsal |
| Right axis | - X | Which GLB axis is right hand |
| BBox min | { x: -1.412, y: -0.284, z: -2.473 } | World-space (measured via `Box3.setFromObject`) |
| BBox max | { x: +1.412, y: +0.328, z: +1.077 } | World-space (measured via `Box3.setFromObject`) |
| BBox size | { x: 2.824, y: 0.612, z: 3.550 } | World-space |
| Max dimension | Z (3.550) | Longest axis (used for normalization reference) |

#### Internal Mesh Structure

The GLB contains a group with two child meshes:

| Node | Type | Position | Rotation | Scale | Notes |
|------|------|----------|----------|-------|-------|
| `tsimwingsuit.glb` | Group | (0, 0, 0) | (0, 0, 0) | 1.0 | Root container |
| `WS_V3` | Mesh (3833 verts) | (0, 0, 0) | (−179.91°, 0, 0) | 0.050 | Main wingsuit mesh |
| `WS_v2` | Unknown | — | — | — | Not found by mesh traversal — may be empty or non-Mesh node |

**Key observations:**
- The **−180° X rotation** flips the mesh from belly-up (as authored) to belly-down
  (flying position). This affects Y and Z (both negate) but leaves X unchanged.
- The **0.050 uniform scale** converts raw buffer geometry to effective GLB units:
  raw bounds (56.478 × 12.129 × 70.982) × 0.050 → effective (2.824 × 0.612 × 3.550).
- The **GLB origin** is NOT at the geometric center — it's offset {+0.000, −0.022, +0.698}
  from the BBox center, placing it closer to the head and slightly below mid-thickness
  (consistent with the CG being forward of center along the body axis).
- The editor's Box geometry (2.800 × 0.600 × 3.500) is a rounded approximation.
  Use the exact `Box3.setFromObject` values above for computation.

#### Physical Dimensions

| Dimension | Value | Source |
|-----------|-------|--------|
| Pilot height (head to toe) | 1.875 m | A5_HEIGHT constant |
| System chord (head to toe in flight) | 1.8 m | A5_SYS_CHORD |
| Wingspan (fingertip to fingertip) | ~1.49 m | BBox X (2.824) × glbToMeters (0.5282) |
| Body depth (chest to back) | ~0.32 m | BBox Y (0.612) × glbToMeters (0.5282) |

#### Scaling

| Parameter | Value | Formula | Notes |
|-----------|-------|---------|-------|
| `glbToMeters` | 0.5282 | `1.875 / 3.550` | Physical height / GLB Z extent |
| `glbToNED` | 0.2817 | `0.5282 / 1.875 = 1 / 3.550` | Converts GLB units → NED-normalized |
| `GLB_TO_NED` | 0.2962 | Currently used for span (y-axis) | ⚠️ **5% above** computed 0.2817 — investigate |
| `FABRIC_OVERSHOOT` | 1.15 | `rawBBox.maxDim × glbToMeters / 1.875` | GLB mesh extends ~15% past limb tips (fabric) |

> **GLB_TO_NED discrepancy:** The code uses 0.2962 for spanwise positions
> (`polar-data.ts` line 1181), but computing `1 / maxDim` from the measured
> wingsuit BBox gives 0.2817. However, the **slick skydiver** gives `glbToNED`
> = 0.2955 — within 0.2% of the code value. This strongly suggests `GLB_TO_NED`
> was originally measured from the slick model (or an earlier wingsuit version
> with the same Z extent). The wingsuit mesh is ~5% longer due to fabric
> extending past the feet. For the registry, each model should get its own
> `glbToNED` rather than sharing a single constant.

---

### Config A: Wingsuit Flyer (standalone)

When the wingsuit is the primary vehicle (not under a canopy).

#### Landmarks (GLB units)

| Landmark | GLB Position | Physical (m) | NED Normalized | Notes |
|----------|-------------|--------------|----------------|-------|
| CG | { x: 0, y: 0, z: 0 } | ~belly button | `{ x: 0, y: 0, z: 0 }` by definition | At GLB origin |
| Quarter-chord (AC) | { x: 0, y: 0, z: +0.511 } | 0.45 m fwd of CG | `{ x: +0.144, y: 0, z: 0 }` | `a5xc(0.25)` — back-computed |
| Head (LE) | *(virtual, z: +1.363)* | 0.72 m fwd of CG | `{ x: +0.384, y: 0, z: ~0 }` | `a5xc(0.00)` — **outside BBox** (max z=1.077) |
| Feet (TE) | { x: 0, y: 0, z: −1.022 } | 0.54 m aft of CG | `{ x: -0.288, y: 0, z: ~0 }` | `a5xc(0.70)` — inside BBox |
| BBox center | { x: 0, y: +0.022, z: −0.698 } | geometric center | varies from CG | CG is 0.698 GLB fwd of center (≈ 13.7%) |

#### Aero Segment Anchors (GLB → NED normalized)

| Segment | x/c | NED x | NED y | NED z | GLB Position | Chord (m) | S (m²) |
|---------|-----|-------|-------|-------|-------------|-----------|--------|
| head | 0.13 | +0.259 | 0 | 0 | { 0, 0, +0.919 } | 0.13 | 0.07 |
| center (body) | 0.42 | −0.019 | 0 | 0 | { 0, 0, −0.067 } | 1.93 | 1.03 |
| r1 (inner R) | 0.44 | −0.038 | +0.213 | 0 | { −0.756, 0, −0.135 } | 1.34 | 0.30 |
| l1 (inner L) | 0.44 | −0.038 | −0.213 | 0 | { +0.756, 0, −0.135 } | 1.34 | 0.30 |
| r2 (outer R) | 0.37 | +0.029 | +0.326 | 0 | { −1.157, 0, +0.103 } | 0.39 | 0.15 |
| l2 (outer L) | 0.37 | +0.029 | −0.326 | 0 | { +1.157, 0, +0.103 } | 0.39 | 0.15 |

*GLB positions back-computed from NED via `glbToNED = 0.2817`. Not measured from mesh vertices.*

**Total S check:** 0.07 + 1.03 + 2×0.30 + 2×0.15 = 2.00 m² ✅

#### Pivots

None for standalone wingsuit — the whole body is rigid in the current model.

#### Attachments

| Name | GLB Position | Physical (m) | Purpose |
|------|-------------|--------------|---------|
| container_back | { x: 0, y: +0.320, z: −0.128 } | mid-back, 0.07 m aft of CG | Deployment: PC/bridle attachment point |
| shoulder_left | { x: +0.240, y: 0, z: +0.560 } | 0.30 m fwd, 0.13 m left | Wing LE anchor, riser attachment |
| shoulder_right | { x: −0.240, y: 0, z: +0.560 } | 0.30 m fwd, 0.13 m right | Wing LE anchor, riser attachment |

#### Mass Distribution

14-segment body model — positions already recorded in `polar-data.ts` as
`WINGSUIT_MASS_SEGMENTS`. All positions are NED-normalized relative to CG.

| Segment | massRatio | NED x | NED y | NED z |
|---------|-----------|-------|-------|-------|
| head | 0.14 | +0.302 | 0 | −0.018 |
| torso | 0.435 | +0.078 | 0 | 0 |
| right_upper_arm | 0.0275 | +0.174 | +0.158 | 0 |
| right_forearm | 0.016 | +0.141 | +0.247 | 0 |
| right_hand | 0.008 | +0.091 | +0.352 | 0 |
| right_thigh | 0.1 | −0.198 | +0.080 | 0 |
| right_shin | 0.0465 | −0.398 | +0.146 | 0 |
| right_foot | 0.0145 | −0.530 | +0.201 | −0.005 |
| left_upper_arm | 0.0275 | +0.174 | −0.158 | 0 |
| left_forearm | 0.016 | +0.141 | −0.247 | 0 |
| left_hand | 0.008 | +0.091 | −0.352 | 0 |
| left_thigh | 0.1 | −0.198 | −0.080 | 0 |
| left_shin | 0.0465 | −0.398 | −0.146 | 0 |
| left_foot | 0.0145 | −0.530 | −0.201 | −0.005 |

**Total massRatio:** 1.000 ✅

---

### Config B: Canopy Pilot (sub-model under Ibex UL)

When the wingsuit model is hanging under a canopy. Same GLB, completely
different orientation and purpose.

#### Pre-Rotation

The pilot goes from **prone (flying)** to **hanging (feet down)**:

| Transform | Value | Description |
|-----------|-------|-------------|
| Pre-rotation | −90° about X | Turns pilot from prone to hanging vertical |
| Forward shift | +0.28 (NED norm) | Positions pilot body forward of riser line |
| Down shift | +0.163 (NED norm) | Positions pilot below riser attachment |
| Trim rotation | +6° about Y | Pilot pendulums forward at canopy trim angle |

#### Landmarks (in assembled canopy NED frame, post-rotation)

| Landmark | NED Normalized | Notes |
|----------|---------------|-------|
| Riser pivot | `{ x: 0.2951, z: 0.1332 }` | `PILOT_PIVOT_X`, `PILOT_PIVOT_Z` (post-trim) |
| Pilot CG | computed from mass segments | Shifts with pilotPitch |
| Shoulder (GLB) | `{ x: 0, y: -0.540, z: 0 }` Three.js | `PILOT_OFFSET` — before normalization |

#### Pivots

| Pivot | Position (NED norm) | Axis | Control | Range | Sensitivity |
|-------|-------------------|------|---------|-------|-------------|
| riser_pitch | `{ x: 0.2951, z: 0.1332 }` | Y (pitch) | `pilotPitch` | −30° to +30° | 1:1 deg |

#### Aero Segment

Single segment — the pilot body as a lifting/parasitic body:

| Segment | Type | NED Position | Pitch Offset | S | Notes |
|---------|------|-------------|-------------|---|-------|
| pilot (wingsuit) | unzippable-pilot | `{ x: 0.38, y: 0, z: 0.48 }` | 90° | 2.0 m² | Blends A5↔Slick via `unzip` |
| pilot (slick) | lifting-body | `{ x: 0.38, y: 0, z: 0.48 }` | 90° | 0.5 m² | Pure slick polar |

#### Mass Distribution

14 segments, same body parts as wingsuit but rotated 90° + trimmed 6° + shifted.
Stored as `CANOPY_PILOT_SEGMENTS` in `polar-data.ts` (computed from `CANOPY_PILOT_RAW`).

---

### cp2.gltf — Ibex UL Canopy

#### Raw GLB Properties

| Property | Value | Notes |
|----------|-------|-------|
| File | `/models/cp2.gltf` | |
| GLB origin | { x: 0, y: 0, z: 0 } | At riser convergence point (bottom of line set) |
| Forward axis | +Z | LE direction (Z=+0.655 is LE) |
| Up axis | +Y | Canopy above, pilot below |
| Right axis | +X | Looking forward from pilot perspective |
| BBox min | { x: -3.133, y: -0.002, z: -2.874 } | World-space (`Box3.setFromObject`) |
| BBox max | { x: +3.133, y: +4.735, z: +0.655 } | World-space |
| BBox size | { x: 6.266, y: 4.738, z: 3.528 } | World-space |
| Max dimension | X (6.266) | Span is longest axis |

#### Internal Mesh Structure

**Scene hierarchy** (3 levels of nesting before geometry):
```
cp2.gltf (Group)
  └─ cp1glb (Object3D)
       ├─ DirectionalLight (baked — ignore)
       ├─ canopy1glb (Object3D)
       │    ├─ DirectionalLight_2 (baked — ignore)
       │    ├─ hartmanparachute2glb (Object3D)  ← canopy meshes live here
       │    │    ├─ Empty (Object3D, scale 0.206) — Blender size reference
       │    │    ├─ Top_1_L … Top_7_L (7 Mesh) — upper skin panels
       │    │    ├─ Bottom_1_L … Bottom_7_L (7 Mesh) — lower skin panels
       │    │    ├─ Rib_1 … Rib_8_L (8 Mesh) — inter-cell ribs
       │    │    ├─ Stabilizer_L (Mesh) — stabilizer panel
       │    │    ├─ Front_Riser, Rear_Riser (2 Mesh) — riser geometry
       │    │    └─ {a,b,c,d}{2,4,6,8}_{upper,lower} — suspension lines
       │    └─ wingsuit4glb (Object3D)  ← embedded pilot reference
       │         pos(0, -5.280, -0.080)  rot(-96.4°, 0, 0)
```

**Key observations:**
- **No transforms on canopy meshes** — all cells/ribs/lines at identity position/rotation/scale
  (unlike pilot models which have a −180° flip and 0.050 scale).
- **All mesh geometry is in final GLB units** — positions read directly from buffer bounds.
- **LE air intake gap**: Top skin starts at Z=+0.655, Bottom skin at Z=+0.313.
  The 0.34 GLB-unit gap at the LE is the RAM-air inlet opening.
- **Embedded pilot** `wingsuit4glb` at (0, −5.280, −0.080) with −96.4° X rotation is a
  positioning reference for the pilot-under-canopy assembly. The −96.4° ≈ −90° (prone→hanging)
  plus −6.4° forward tilt (close to the 6° trim angle in physics).
- **2 baked DirectionalLights** embedded in the GLTF (Blender export artifact). The code's
  `loadRawGltf()` may need to skip these when traversing for meshes.

#### Cell Geometry — 7 Cells, 8 Ribs

Ribs define the cell boundaries. All meshes span ±X (symmetric left/right):

| Rib | X position (GLB) | Y center (GLB) | Z chord (GLB) | Vertices |
|-----|------------------|-----------------|----------------|----------|
| Rib_1 (center) | 0.000 | 4.418 | 3.501 | 73 |
| Rib_2 | ±0.459 | 4.412 | 3.500 | 146 |
| Rib_3 | ±0.928 | 4.385 | 3.500 | 146 |
| Rib_4 | ±1.412 | 4.315 | 3.499 | 146 |
| Rib_5 | ±1.882 | 4.182 | 3.499 | 146 |
| Rib_6 | ±2.329 | 4.000 | 3.500 | 146 |
| Rib_7 | ±2.749 | 3.766 | 3.500 | 146 |
| Rib_8 (tip) | ±3.133 | 3.489 | 3.501 | 550 |

**Rib Y centers trace the canopy arc** — dropping from Y=4.42 at center to Y=3.49 at tips.
Arc drop: 4.418 − 3.489 = 0.929 GLB units.

Per-cell metrics derived from rib boundaries:

| Cell | Inner rib X | Outer rib X | Center X | Width (GLB) | Top Y center | Bot Y center | Airfoil Y center |
|------|------------|------------|----------|-------------|-------------|-------------|------------------|
| 1 (center) | 0.000 | 0.459 | 0.230 | 0.459 | 4.533 | 4.221 | 4.377 |
| 2 | 0.459 | 0.928 | 0.694 | 0.469 | 4.512 | 4.211 | 4.362 |
| 3 | 0.928 | 1.412 | 1.170 | 0.484 | 4.455 | 4.174 | 4.315 |
| 4 | 1.412 | 1.882 | 1.647 | 0.470 | 4.344 | 4.086 | 4.215 |
| 5 | 1.882 | 2.329 | 2.106 | 0.447 | 4.178 | 3.936 | 4.057 |
| 6 | 2.329 | 2.749 | 2.539 | 0.420 | 3.966 | 3.738 | 3.852 |
| 7 (tip) | 2.749 | 3.133 | 2.941 | 0.384 | 3.705 | 3.494 | 3.600 |

Cell widths taper from 0.484 (widest near cell 3) to 0.384 at the tip.
Top-bottom separation (airfoil thickness): ≈ 0.21–0.31 GLB units, thickest at center.

#### Chord Geometry

All cells share the same Z range (constant chord across span):

| Feature | Z (GLB) | Chord fraction | Notes |
|---------|---------|----------------|-------|
| LE (top skin) | +0.655 | 0.00 | Leading edge (furthest forward) |
| LE (bottom skin) | +0.313 | 0.10 | Bottom skin stops short → **air intake gap** |
| LE (rib) | +0.627 | 0.01 | Rib extends nearly to top LE |
| TE (all) | −2.874 | 1.00 | Trailing edge (all panels align) |
| **Total top chord** | — | — | 3.529 GLB units (LE top to TE) |
| **Total bottom chord** | — | — | 3.187 GLB units (LE bottom to TE, shorter) |

#### Line Geometry — Suspension Line Naming Convention

Lines use a **{row}{rib-number}_{cascade}** naming pattern:
- **Row** = `a` (LE), `b`, `c`, `d` (TE) — 4 line rows front-to-back
- **Rib number** = `2`, `4`, `6`, `8` — lines attach at even-numbered ribs
- **Cascade** = `_upper` (canopy → cascade point) or `_lower` (cascade → riser)

Not all rows cascade: **A and C lines have upper+lower** (two-stage cascade),
while **B and D lines only have upper** (single stage, direct to riser).

**✅ LineSetGLB extraction (Feb 2026):**  
Complete suspension line geometry extracted from cp2.gltf mesh vertices using `extract-lines.cjs` and stored in `CANOPY_GEOMETRY.lineSet`. Per-rib data structure captures:
- **Canopy attachments** (A/B/C/D) — top vertex (yMax) of each upper line segment
- **Cascade junctions** (A/B→front, C/D→rear) — where upper lines merge into lower
- **Riser endpoints** (front/rear) — bottom of lower line segments at harness attachment

All positions in right-side GLB coordinates (+X = right). Ready for future line drag modeling, tension visualization, and asymmetric loading in turns.

Line attachment Z positions (chordwise, as fraction of chord from LE):

| Line row | Z (GLB, upper center) | Chord fraction | Physical meaning |
|----------|----------------------|----------------|-----------------|
| A (front) | +0.120 | 0.152 (15%) | Canopy LE support |
| B | −0.270 | 0.262 (26%) | Near quarter-chord |
| C | −1.231 | 0.534 (53%) | Mid-chord |
| D (rear) | −1.567 | 0.630 (63%) | Rear, not at TE |

Line vertical extents (Y positions):

| Feature | Y (GLB) | Notes |
|---------|---------|-------|
| Riser top | ≈ 0.50 | A/C lower lines start here |
| Cascade junction | ≈ 3.07 | Where upper and lower line segments meet |
| Canopy attachment | ≈ 4.15–4.26 | Upper lines reach canopy underside |

Line attachment at even ribs with progressive span narrowing:

| Rib position | GLB X | Lines attached | Total line sets |
|-------------|-------|---------------|----------------|
| Rib 2 | ±0.459 | a2, b2, c2, d2 | 4 rows × upper (+ a2,c2 lower) |
| Rib 4 | ±1.412 | a4, b4, c4, d4 | 4 rows × upper (+ a4,c4 lower) |
| Rib 6 | ±2.329 | a6, b6, c6, d6 | 4 rows × upper (+ a6,c6 lower) |
| Rib 8 | ±3.133 | a8, b8, c8, d8 | 4 rows × upper (+ a8,c8 lower) |

#### Riser Geometry

| Riser | Z center (GLB) | Y center (GLB) | Chord fraction | Notes |
|-------|---------------|---------------|----------------|-------|
| Front_Riser | −0.006 | 0.250 | 19% from LE | 32 vertices |
| Rear_Riser | −0.096 | 0.233 | 21% from LE | 32 vertices |

Risers are very close together (9 cm apart in GLB Z) at the bottom of the line set.
Both near Y≈0.24 — essentially at the GLB origin, confirming the origin is
at the riser convergence point.

#### Physical Dimensions

| Dimension | Value | Source |
|-----------|-------|--------|
| GLB chord (LE→TE) | 3.529 GLB units | Z range of top skin |
| Physical chord | 3.29 m | `CANOPY_CELL_POLAR.chord` — 220 ft² canopy, area/arc-span |
| GLB half-span | 3.133 GLB units | Rib_8 X position |
| Physical projected half-span | 2.92 m | 3.133 × `glbToMeters` (0.932) |
| Physical projected span | 5.84 m | 2 × 2.92 (flat projection, not arc) |
| Arc radius | R = 1.55 (NED normalized) | From mass segment arc geometry |
| Total area (rated) | 20.439 m² | `ibexulpolar.s` — measured along arc, not projected |
| Cell area (each) | 20.439/7 = 2.92 m² | Physics assumes evenly divided |

> **Projected vs. arc span:** The rated area (20.439 m²) divided by chord (3.29 m)
> gives an arc span of 6.21 m. But the projected (flat) span from the GLB is only
> 4.44 m. The ratio (6.21 / 4.44 ≈ 1.40) reflects how much the canopy arc stretches
> the effective span. The `CANOPY_SCALE = 1.5` factor is applied to the visual mesh
> to bring it into reasonable proportions relative to the pilot.

#### Scaling

| Parameter | Value | Formula | Notes |
|-----------|-------|---------|-------|
| `glbToMeters` (chord-based) | 0.932 | `3.29 / 3.529` | Maps GLB chord to physical 3.29 m |
| `CANOPY_SCALE` | 1.5 | Applied in `model-loader.ts` | Visual scale-up before compositing |
| `Empty` node scale | 0.206 | Embedded in GLB | Original Blender size reference |

#### Landmarks (GLB units → NED normalized)

| Landmark | GLB Position | NED Normalized | Notes |
|----------|-------------|---------------|-------|
| Canopy BBox center | { x: 0, y: 2.37, z: -1.11 } | roughly `{ x: 0.16, y: 0, z: -1.1 }` | GLB Y → NED z |
| LE center cell | { x: 0, y: ~4.5, z: +0.655 } | ≈ `{ x: +0.83, y: 0, z: −1.22 }` | Forward edge, NED z from arc model |
| TE center cell | { x: 0, y: ~4.2, z: -2.874 } | ≈ `{ x: −0.50, y: 0, z: −1.22 }` | Aft edge, chord_NED = 1.333 |
| Riser convergence | { x: 0, y: ~0.24, z: ~-0.05 } | near `{ x: 0.28, y: 0, z: 0 }` | Near GLB origin |
| Embedded pilot ref | { x: 0, y: -5.28, z: -0.08 } | — | `wingsuit4glb` placeholder, rot −96.4° |

#### Cell Quarter-Chords & Trailing Edges (GLB units)

All cells share the same chord, so Z positions are constant across span:
- **Quarter-chord Z** = LE (+0.655) − 0.25 × 3.529 = **−0.227**
- **Trailing edge Z** = **−2.874**

X and Y vary per cell (from cell geometry table above):

| Cell | Center X (GLB) | Airfoil Y (GLB) | QC Position (GLB) | TE Position (GLB) |
|------|---------------|----------------|-------------------|-------------------|
| 1 (center) | 0.230 | 4.377 | { 0.230, 4.377, −0.227 } | { 0.230, 4.377, −2.874 } |
| 2 | 0.694 | 4.362 | { 0.694, 4.362, −0.227 } | { 0.694, 4.362, −2.874 } |
| 3 | 1.170 | 4.315 | { 1.170, 4.315, −0.227 } | { 1.170, 4.315, −2.874 } |
| 4 | 1.647 | 4.215 | { 1.647, 4.215, −0.227 } | { 1.647, 4.215, −2.874 } |
| 5 | 2.106 | 4.057 | { 2.106, 4.057, −0.227 } | { 2.106, 4.057, −2.874 } |
| 6 | 2.539 | 3.852 | { 2.539, 3.852, −0.227 } | { 2.539, 3.852, −2.874 } |
| 7 (tip) | 2.941 | 3.600 | { 2.941, 3.600, −0.227 } | { 2.941, 3.600, −2.874 } |

*Positions are for the right half ( +X). Left half mirrors at −X.*
*Flap segments attach at cell TEs (Z = −2.874) for non-center cells (2–7).*

#### GLB → NED Conversion Pipeline (Vehicle-Independent)

The goal: derive physics segment positions **directly from GLB cell geometry**,
with no arc model, no hand-tuning, and no vehicle-specific scaling. The model
registry handles the conversion; the physics just consumes NED positions.

**Scale factor** (from physical chord):
- `glbToMeters = physicalChord / glbChord = 3.29 / 3.529 = 0.9322`
- `glbToNED = glbToMeters / height = 0.9322 / 1.875 = 0.4972`

**Axis mapping** (GLB → NED body frame):
- NED x (north/fwd) = GLB z × glbToNED
- NED y (east/right) = GLB x × glbToNED
- NED z (down) = −GLB y × glbToNED

**Reference point:** GLB origin = riser convergence (bottom of line set).
All GLB-derived NED positions are relative to this point.

**Cell QC positions — raw GLB → NED-normalized** (relative to riser convergence):

| Cell | GLB x | GLB y | GLB z (QC) | NED x | NED y | NED z |
|------|-------|-------|-----------|-------|-------|-------|
| 1 (center) | 0 | 4.377 | −0.227 | −0.113 | 0 | −2.176 |
| 2 (inner) | 0.694 | 4.362 | −0.227 | −0.113 | 0.345 | −2.169 |
| 3 (mid) | 1.170 | 4.315 | −0.227 | −0.113 | 0.582 | −2.146 |
| 4 | 1.647 | 4.215 | −0.227 | −0.113 | 0.819 | −2.096 |
| 5 | 2.106 | 4.057 | −0.227 | −0.113 | 1.047 | −2.017 |
| 6 | 2.539 | 3.852 | −0.227 | −0.113 | 1.262 | −1.915 |
| 7 (tip) | 2.941 | 3.600 | −0.227 | −0.113 | 1.462 | −1.790 |

*Center cell uses X=0 (symmetry plane), not half-cell center 0.230.*
*NED x is constant because all cells share the same QC Z (−0.227).*
*Left-side cells mirror at −NED y.*

**Comparison with current code positions** (arc formula + hand-tuning):

| Cell | GLB NED y | Code y | Δy | GLB NED z | Code z | Δz |
|------|-----------|--------|----|-----------|--------|----|
| center | 0 | 0 | 0 | −2.176 | −1.220 | +0.956 |
| r1 | 0.345 | 0.358 | +0.013 | −2.169 | −1.182 | +0.987 |
| r2 | 0.582 | 0.735 | +0.153 | −2.146 | −1.114 | +1.032 |
| r3 | 0.819 | 1.052 | +0.233 | −2.096 | −0.954 | +1.142 |

Key observations:
- **NED z offset (~0.96–1.14):** The current NED origin is not at the riser
  convergence — it's ~1.0 NED-norm (1.87 m) closer to the canopy, near the
  system CG. This is a consistent translation that the model registry can apply.
- **NED z offset inconsistency** (0.96 at center vs 1.14 at tip): The arc model
  uses a tighter curve than the actual GLB geometry. The real canopy droops
  more at the tips than the R=1.55 arc predicts.
- **NED y divergence** (0.013 at r1 → 0.233 at r3): The arc formula + hand-tuning
  pushes outer cells to wider span than the GLB geometry shows. GLB half-span
  at cell 4 is 0.819 NED but code uses 1.052. This means the current physics
  overpredicts roll moment arms by ~28% for the outer cells.
- **NED x** (fore-aft): GLB gives −0.113 (slightly aft of riser convergence).
  Current code uses +0.145 to +0.174 (forward). The ~0.27 offset is the
  fore-aft distance from riser convergence to the NED origin.

**What's needed for model-registry conversion:**
1. Raw GLB cell QC positions (this table)
2. `glbToMeters` scale factor (from physical chord)
3. GLB→NED axis mapping (model-specific)
4. Assembly offset: GLB origin (riser convergence) → NED origin (system CG)
5. Pilot position in the same reference frame

The assembly offset (item 4) needs to be consistent with the pilot position.
The embedded `wingsuit4glb` at GLB (0, −5.280, −0.080) → NED (−0.040, 0, +2.626)
gives the pilot's position relative to riser convergence. Once the model registry
knows both canopy cell and pilot positions in the same frame, the system CG is
computable and all moment arms follow.

#### Aero Segment Anchors — 7 Canopy Cells (Current Code)

Positions are NED-normalized, using an arc model (R=1.55, 12° spacing) + hand-tuning.

These are the **current values in `polar-data.ts`**, pending migration to GLB-derived
positions via the model registry.

**GLB → Physics cell mapping:** The GLB has 7 cells (center→tip, each spanning ±X).
Physics has 7 segments (center + 3 left/right pairs). The 3 outermost GLB cells
have no dedicated physics cell.

| Physics cell | GLB Cell | GLB Center X | GLB Airfoil Y | θ (deg) | NED y | NED z | Notes |
|-------------|----------|-------------|--------------|---------|-------|-------|-------|
| cell_c | Cell 1 | 0.230 | 4.377 | 0 | 0 | −1.220 | Center cell |
| cell_r1 / cell_l1 | Cell 2 | 0.694 | 4.362 | ±12 | ±0.358 | −1.182 | Inner pair |
| cell_r2 / cell_l2 | Cell 3 | 1.170 | 4.315 | ±24 | ±0.735 | −1.114 | Mid pair |
| cell_r3 / cell_l3 | Cell 4 | 1.647 | 4.215 | ±36 | ±1.052 | −0.954 | Outer pair |
| — | Cell 5 | 2.106 | 4.057 | — | — | — | ⚠️ No physics cell |
| — | Cell 6 | 2.539 | 3.852 | — | — | — | ⚠️ No physics cell |
| — | Cell 7 | 2.941 | 3.600 | — | — | — | ⚠️ No physics cell |

> **3-cell gap:** The physics model uses only 4 cell groups (c + 3 pairs = 7 segments)
> to represent 7 GLB cells. Cells 5–7 (the outer three) are effectively lumped into
> cell_r3/cell_l3. The physics area-per-cell (20.439/7 = 2.92 m²) is correct as a
> total-area split, but the outer physics cell actually represents roughly 4 GLB cells
> worth of geometry. This works at low sideslip but under-resolves the outer span.

#### Aero Segment Anchors — 6 Brake Flaps

Trailing edge of each non-center cell. Position = TE of parent cell.

**✅ Brake flaps as separate segments (Feb 2026):**  
Flaps are now independent `AeroSegment` instances (not just drag modifiers on parent cells). Benefits:
- Physically accurate progressive braking (outer flaps deflect more: inner 0.4, mid 0.7, outer 1.0 brake sensitivity)
- Correct moment arms (flap CP is aft of cell quarter-chord)
- Cell area conservation (parent cell shrinks when flap deploys: `cellArea × (1 - flapAreaFraction)`)
- Visual clarity (separate colored arrows per flap in `vectors.ts`)

Flap area and chord controlled by brake input (0–100%). Outer flaps deflect more than inner (realistic progressive braking).

| Segment | θ (deg) | NED x | NED y | NED z | Side | Brake Sens. | Chord Frac. | Parent Cell S | Parent Cell Chord | Parent Cell X |
|---------|---------|-------|-------|-------|------|-------------|-------------|---------------|-------------------|---------------|
| flap_r1 | +12 | −0.664 | +0.358 | −1.162 | right | 0.4 | 0.10 | 2.92 | 3.29 | 0.170 |
| flap_l1 | −12 | −0.664 | −0.358 | −1.162 | left | 0.4 | 0.10 | 2.92 | 3.29 | 0.170 |
| flap_r2 | +24 | −0.672 | +0.735 | −1.062 | right | 0.7 | 0.20 | 2.92 | 3.29 | 0.162 |
| flap_l2 | −24 | −0.672 | −0.735 | −1.062 | left | 0.7 | 0.20 | 2.92 | 3.29 | 0.162 |
| flap_r3 | +36 | −0.689 | +1.052 | −0.901 | right | 1.0 | 0.30 | 2.92 | 3.29 | 0.145 |
| flap_l3 | −36 | −0.689 | −1.052 | −0.901 | left | 1.0 | 0.30 | 2.92 | 3.29 | 0.145 |

#### Aero Segment Anchors — 2 Parasitic Bodies

| Segment | NED x | NED y | NED z | S (m²) | Chord (m) | CD | Description |
|---------|-------|-------|-------|--------|-----------|-----|-------------|
| lines | +0.23 | 0 | −0.40 | 0.35 | 0.01 | 1.0 | Suspension lines (midpoint between canopy and pilot) |
| pc | ✅ `_bridleTop()` | ✅ `_bridleTop()` | ✅ `_bridleTop()` | 0.732 | 0.01 | 1.0 | **Pilot chute** — position from `CANOPY_GEOMETRY.attachments.bridleTop` |

**✅ PC registry integration (Feb 2026):**  
PC aero segment position now sourced from `_bridleTop()` helper in `polar-data.ts`, which extracts the `bridleTop` attachment from `CANOPY_GEOMETRY` and converts GLB → NED normalized. Automatically synchronizes with the bridle GLB model attachment point. When the deployment slider changes, the PC position scales by `(x × chordScale, y × spanScale, z)` before CP offset calculation in `vectors.ts`, keeping the drag arrow glued to the bridle tip throughout the inflation sequence.

**Old positioning (pre-registry):**  
PC used hardcoded position `{ x: +0.10, y: 0, z: −1.30 }` (manually tuned above canopy, trailing). Required re-tuning whenever canopy position changed.

#### Mass Segments — Canopy Structure (7)

| Segment | massRatio | NED x | NED y | NED z |
|---------|-----------|-------|-------|-------|
| canopy_structure_c | 0.00643 | +0.165 | 0 | −1.196 |
| canopy_structure_r1 | 0.00643 | +0.161 | +0.322 | −1.162 |
| canopy_structure_l1 | 0.00643 | +0.161 | −0.322 | −1.162 |
| canopy_structure_r2 | 0.00643 | +0.151 | +0.630 | −1.062 |
| canopy_structure_l2 | 0.00643 | +0.151 | −0.630 | −1.062 |
| canopy_structure_r3 | 0.00643 | +0.134 | +0.911 | −0.901 |
| canopy_structure_l3 | 0.00643 | +0.134 | −0.911 | −0.901 |

**Total structure mass:** 7 × 0.00643 = 0.045 of system mass (~3.5 kg) ✅

#### Mass Segments — Canopy Air (7)

Same positions as structure, different mass ratios:

| Segment | massRatio | Notes |
|---------|-----------|-------|
| canopy_air_* | 0.011 each | Trapped air — contributes to inertia only, not weight |

**Total air mass:** 7 × 0.011 = 0.077 of system mass (~6 kg)

#### Pivots

None — canopy is rigid. Deployment changes span scaling and chord offset but
not rotation.

#### Attachments

| Name | GLB Position | NED Normalized | Notes |
|------|-------------|---------------|-------|
| riser_bottom_R | { x: +0.256, y: 0, z: 0 } | `{ x: ~0.28, y: +0.10, z: ~0 }` | Right riser at harness |
| riser_bottom_L | { x: −0.256, y: 0, z: 0 } | `{ x: ~0.28, y: −0.10, z: ~0 }` | Left riser at harness |
| bridle_top | { x: 0, y: +4.672, z: −0.848 } | TBD | Top of canopy, 76% chord from LE (near apex, 0.06 below BBox top) |

---

### tslick.glb — Slick Skydiver

#### Raw GLB Properties

| Property | Value | Notes |
|----------|-------|-------|
| File | `/models/tslick.glb` | |
| GLB origin | { x: 0, y: 0, z: 0 } | Same convention as wingsuit — near belly/CG |
| Forward axis | +Z | Head direction (same as wingsuit) |
| Up axis | +Y | Dorsal |
| Right axis | -X | Right hand |
| BBox min | { x: -0.850, y: -0.284, z: -2.307 } | World-space (`Box3.setFromObject`) |
| BBox max | { x: +0.850, y: +0.328, z: +1.077 } | World-space (`Box3.setFromObject`) |
| BBox size | { x: 1.699, y: 0.612, z: 3.384 } | World-space |
| Max dimension | Z (3.384) | Longest axis |

#### Internal Mesh Structure

| Node | Type | Position | Rotation | Scale | Notes |
|------|------|----------|----------|-------|-------|
| `tslick.glb` | Group | (0, 0, 0) | (0, 0, 0) | 1.0 | Root container |
| `WS_V3` | Mesh (3698 verts) | (0, 0, 0) | (−179.91°, 0, 0) | 0.050 | Same name/structure as wingsuit |

**Key observations:**
- Derived from the wingsuit mesh (same node name `WS_V3`, same rotation, same scale).
- Buffer Y range identical to wingsuit (-6.488 to 5.641) — same body core thickness.
- Narrower X (±17.0 vs ±28.2) — no wing fabric, just arms at sides.
- Slightly shorter Z (67.7 vs 71.0) — no leg wing fabric extending past feet.
- Origin offset from BBox center: {0.000, -0.022, +0.615} — same pattern as wingsuit,
  CG is forward of geometric center.

#### Physical Dimensions

| Dimension | Value | Source |
|-----------|-------|--------|
| Pilot height (head to toe) | 1.875 m | Same pilot, same `A5_HEIGHT` |
| Body width (shoulder to shoulder) | ~0.45 m | `1.699 × 0.5541` = 0.94 m BBox width, but arms spread; torso ~0.45 m |
| Body depth (chest to back) | ~0.34 m | `0.612 × 0.5541` |
| Reference area | 0.5 m² | Frontal area estimate |
| Chord | ~1.80 m (body length) | Same as wingsuit system chord |

#### Scaling

| Parameter | Value | Formula | Notes |
|-----------|-------|---------|-------|
| `glbToMeters` | 0.5541 | `1.875 / 3.384` | Physical height / GLB Z extent |
| `glbToNED` | 0.2955 | `0.5541 / 1.875 = 1 / 3.384` | ≈ `GLB_TO_NED` (0.2962) — see note below |

#### Landmarks

| Landmark | GLB Position | NED Normalized |
|----------|-------------|---------------|
| CG | { x: 0, y: 0, z: 0 } | `{ x: 0, y: 0, z: 0 }` by definition |
| Quarter-chord | { x: 0, y: 0, z: +0.487 } | `{ x: +0.144, y: 0, z: 0 }` — back-computed via glbToNED 0.2955 |

#### Pivots / Attachments

None — single rigid body.

---

### airplane.glb — Jump Plane (Visual Placeholder)

> **Note:** This GLB is a **Dornier Do 228-200** (`do228-200glb`), used as a visual stand-in.
> The aerodynamic model uses Cessna Caravan parameters. Control-surface geometry in this
> GLB does **not** correspond to the aero model — do not extract wing/flap dimensions for physics.

#### Raw GLB Properties

| Property | Value | Notes |
|----------|-------|-------|
| File | `/models/airplane.glb` | 843 KB |
| Actual model | Dornier Do 228-200 | **Not** the Cessna Caravan used in aero |
| Root | `airplane.glb` (Group) → `do228-200glb` (Object3D) | Single Object3D child |
| Root rotation | Y = −90° on `do228-200glb` | Rotates model so GLB +X → scene +Z |
| Mesh count | ~50 meshes | Fuselage, wings, control surfaces, gear |
| Notable children | `elevator`, `rudder`, `left_aileron`, `right_aileron`, `flapLeft1`, `flapRight1`, `frontGear`, `gear_left`, `propcone_R`, `door_2` | Named control surfaces & assemblies |

#### Landmarks

Minimal — single-body polar, no segments. CG placed at GLB origin (normalized).

| Landmark | GLB Position | NED Normalized |
|----------|-------------|---------------|
| CG | origin (0, 0, 0) | `{ x: 0, y: 0, z: 0 }` |

---

### bridalandpc.gltf — Bridle + Pilot Chute (Canopy Deployment)

> Pure drag elements — no aerodynamic surfaces. Attachment position sourced
> from `CANOPY_GEOMETRY.attachments.bridleTop` (76% chord, center span, top skin).

#### Raw GLB Properties

| Property | Value | Notes |
|----------|-------|-------|
| File | `/models/bridalandpc.gltf` | |
| GLB origin | { x: 0, y: 0, z: 0 } | Forward end of bridle (canopy attachment) |
| Forward axis | +Z | Bridle extends rearward along −Z |
| Up axis | +Y | |
| BBox min | { x: -0.240, y: -0.240, z: -3.660 } | World-space (`Box3.setFromObject`) |
| BBox max | { x: 0.240, y: 0.240, z: 0.030 } | World-space |
| BBox size | { x: 0.480, y: 0.480, z: 3.690 } | World-space |
| Max dimension | Z (3.690) | Bridle length dominates |
| **Attachment** | `CANOPY_GEOMETRY.attachments.bridleTop` | ✅ **Registry-based positioning** (replaces old bbox-derived +TE shift) |

#### Internal Mesh Structure

```
bridalandpc.gltf (Group)
  └─ bridalandpcglb (Object3D)
       ├─ bridalglb (Object3D)  pos(0, −0.001, −1.620)
       │    └─ Box (Mesh, 24 verts)  — bridle line: 0.020 × 0.002 × 3.300
       └─ pcglb (Object3D)  pos(0, 0, −3.600)
            └─ (Object3D)  rot(90°, 0, −180°)
                 └─ mesh_1 (289 verts) — main canopy disc: ∅ 0.480
                      └─ mesh_2 (34 verts) — skirt: ∅ 0.480 × 0.300 tall
                           └─ mesh_3 (34 verts) — vent disc: ∅ 0.320
                                ├─ mesh_4 (96 verts) — vent ring: ∅ 0.470 (flat)
                                └─ mesh_5 (100 verts) — swivel: 0.040 cube

```

**Key observations:**
- **Bridle** (`bridalglb`): A thin box (0.020 × 0.002 × 3.300) centered at Z = −1.620. 
  It's essentially a line from Z = +0.03 (near origin) to Z = −3.27.
- **Pilot chute** (`pcglb`): Positioned at Z = −3.600 (aft of bridle). The 90° X rotation
  orients the disc mesh from XZ-plane to XY-plane (facing the airflow). Disc diameter ≈ 0.480 GLB units.
- All meshes have identity scale — transforms are positional/rotational only.
- The PC is nested 5 levels deep (mesh_1→mesh_5), each child adding a structural detail
  (canopy → skirt → vent → ring → swivel).

#### Physical Dimensions

| Dimension | Estimate | Notes |
|-----------|----------|-------|
| Bridle length | ~1.7 m | 3.300 GLB × 0.508 glbToMeters (but scaling depends on assembly context) |
| PC diameter | ~0.5 m | 0.480 GLB × assembly scale ≈ standard 24-inch PC |
| Total assembly length | ~1.9 m | BBox Z extent × glbToMeters |

> Scaling is context-dependent — this model is scaled by `1.5 × normalizationScale`
> when assembled under the canopy, so raw `glbToMeters` based on pilot height (0.508)
> is not directly meaningful. Physical dimensions above are rough estimates.

#### Assembly (under canopy)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Scale | `1.5 × normalizationScale` | Matches canopy scale (`assembly.deployScales.bridle`) |
| Position | `CANOPY_GEOMETRY.attachments.bridleTop` | ✅ **Registry landmark** (76% chord, GLB coords → Three.js transform) |
| Rotation | Aligned to wind direction via quaternion | Updated per-frame (`updateBridleOrientation()`) |
| Deployment scaling | `(x × spanScale, y, z × chordScale)` | ✅ **Scales with canopy mesh** during deploy slider (0–100%) |

**Registry integration (Feb 2026):**  
Bridle position is now sourced from `CANOPY_GEOMETRY.attachments` (measured in GLB coords, transformed through the same pipeline as the canopy mesh including X-flip). The `bridleTop` landmark sits at 76% chord from leading edge, on the centerline, at the top skin surface. When the deployment slider changes, the bridle position scales horizontally (spanScale = 0.1→1.0×, chordScale = 0.3→1.0×) matching the canopy mesh deformation, automatically maintaining correct attachment throughout the inflation sequence.

**Old positioning (pre-registry):**  
Previously used canopy bbox top Y + manual trailing-edge shift (−0.30 Z in normalized coords). Required re-tuning whenever canopy mesh changed.

---

### pc.glb — Pilot Chute (Wingsuit Deployment)

> Same geometry as the `pcglb` sub-assembly inside `bridalandpc.gltf`, exported standalone.
> Made from Three.js primitives (disc, skirt, vent, ring, swivel).

| Property | Value | Notes |
|----------|-------|-------|
| File | `/models/pc.glb` | |
| Root | `pc.glb` (Group) → `pcglb` (Object3D) → unnamed Object3D (rot 90° X, −180° Z) | |
| Mesh count | 5 nested meshes | mesh_1 (canopy disc) → mesh_2 (skirt) → mesh_3 (vent) → mesh_4 (ring) → mesh_5 (swivel) |
| BBox min | { x: -0.240, y: -0.240, z: -0.060 } | World-space |
| BBox max | { x: 0.240, y: 0.240, z: 0.350 } | World-space |
| BBox size | { x: 0.480, y: 0.480, z: 0.410 } | Disc ∅ = 0.480, height ~0.41 with skirt |
| Disc diameter | 0.480 GLB units | mesh_1 buffer: 0.480 × 0.119 × 0.480 |
| Physical diameter | ~0.5 m | Standard 24-inch pilot chute |
| Scale | `0.4 × normalizationScale` | Applied in code |
| Role | Trails behind wingsuit during deployment sequence |

---

### snivel.glb — Canopy in Bag (Wingsuit Deployment)

> Simple Three.js primitives representing the packed canopy during deployment.
> Three octahedrons: main body (scale 0.6) + two line attachment points (scale 0.2) at ±X.

| Property | Value | Notes |
|----------|-------|-------|
| File | `/models/snivel.glb` | |
| Root | `snivel.glb` (Group) → Group (Object3D) + 3 Octahedron meshes | Flat hierarchy |
| Main body | `Octahedron` at origin, scale 0.600 | Packed canopy — effective radius 0.6 |
| Line attach R | `Octahedron_1` at { x: +0.600, y: 0, z: 0 }, scale 0.200 | Right line set attachment |
| Line attach L | `Octahedron_2` at { x: −0.600, y: 0, z: 0 }, scale 0.200 | Left line set attachment |
| BBox min | { x: -0.800, y: -0.600, z: -0.600 } | World-space |
| BBox max | { x: +0.800, y: +0.600, z: +0.600 } | World-space |
| BBox size | { x: 1.600, y: 1.200, z: 1.200 } | Wider in X due to line attachments |
| Scale | `0.6 × normalizationScale` | Applied in code — slightly larger than PC |
| Role | Appears at deploy ≈ 0.5, moves aft from container |

---

## Vehicle Assemblies

---

### Assembly: Ibex UL + Wingsuit Pilot (Canopy System)

The most complex assembly — canopy + pilot as separate GLBs with articulation.

#### Components

| Component | Model | Pre-Rotation | Offset (meters) | Origin Point | Scale |
|-----------|-------|-------------|-----------------|--------------|-------|
| canopy | cp2.gltf | none | TODO | cg | `CANOPY_SCALE` (1.5) |
| pilot | tsimwingsuit.glb | −90° X | `(0, -0.540, 0)` Three.js | shoulder | 1.0 |
| bridle | bridalandpc.gltf | wind-aligned | canopy top + TE shift | attachment | `1.5 × s` |

#### System Properties

| Property | Value | Source |
|----------|-------|--------|
| System mass | 77.5 kg | `polar.m` |
| Reference height | 1.875 m | Pilot height (normalization divisor) |
| Reference area | 20.439 m² | Total canopy area |
| Reference chord | 3.29 m | Cell chord (220 ft² canopy) |
| System CG | Computed from mass segments | `computeCenterOfMass()` — dynamic with pilotPitch/deploy |

#### Assembly Procedure

1. Load canopy GLB, apply `CANOPY_SCALE` (1.5×)
2. Load pilot GLB
3. Measure pilot raw bounding box → capture `pilotRawHeight`
4. Create `pilotPivot` group at riser attachment point:
   - Position: `PILOT_OFFSET.position` + shoulder offset (10% of body extent)
   - Pilot model positioned inside pivot, offset down by `shoulderOffset`
   - Pilot model rotated −90° X (prone → hanging)
5. Add both to composite root
6. Normalize: scale so pilot body maps to `TARGET_SIZE` (2.0)
7. Center at composite bounding box center
8. Apply CG offset via `applyCgFromMassSegments()` → shifts model so CG at origin

#### Articulations

| Articulation | Component | Pivot | Control | Sensitivity | Range |
|-------------|-----------|-------|---------|-------------|-------|
| Pilot pitch | pilot | riser_pitch | `pilotPitch` | 1°/unit | ±30° |
| Deploy span | canopy | — | `deploy` | y × (0.1 + 0.9 × deploy) | 0–1 |
| Deploy chord | canopy | — | `deploy` | z × (0.3 + 0.7 × deploy) | 0–1 |
| **✅ Deploy bridle** | **bridle** | — | **`deploy`** | **`(x × spanScale, y, z × chordScale)`** | **0–1** |
| **✅ Deploy PC/cells** | **aero segments** | — | **`deploy`** | **segment positions scaled before CP offset** | **0–1** |
| Bridle wind align | bridle | canopy_top | α, β | quaternion | continuous |

**✅ Deployment scaling (Feb 2026):**  
Three systems now scale together during the deployment slider (0–100%):
1. **Canopy GLB mesh** — horizontal deformation (`canopyModel.scale.set(-CANOPY_SCALE × spanScale, CANOPY_SCALE, CANOPY_SCALE × chordScale)`)
2. **Bridle position** — `baseBridlePos` scaled by spanScale/chordScale, then CG-adjusted (`main.ts` lines 596–604)
3. **Aero segment positions** — PC, cells, flaps scaled before CP offset calculation (`vectors.ts` deploy parameter)

All three use identical scale formulas (spanScale = 0.1→1.0×, chordScale = 0.3→1.0×), so the PC drag arrow stays attached to the bridle tip and cell arrows stay centered on their respective cell volumes throughout the entire deployment range. Minimum scale factors prevent extreme mesh thinning at low deployment.

#### Rendering Pipeline

```
1. Normalize (pilot body → TARGET_SIZE)
2. Center at bbox center
3. Apply CG offset (shifts model so physics CG at scene origin)
4. Per-frame: rotate pilotPivot for pilotPitch
5. Per-frame: scale canopy Y for deploy (and shift X for chord offset)
6. Per-frame: align bridle to wind direction
7. Force vectors: subtract cgOffsetThree from all positions
8. Mass overlay: position at -cgOffsetThree
```

#### Physics Transform Chain

The physics system must replicate the same spatial transforms as the rendering
pipeline, but independently in NED coordinates. Three.js scene-graph transforms
(parent–child inheritance, `Object3D.scale`, pivot rotations) are only available
to the renderer — the physics code needs its own equivalent chain.

**Reference frames and constants:**

| Symbol | Value | Meaning |
|--------|-------|---------|
| `height` | 1.875 m | Pilot height — normalisation divisor for all NED positions |
| `chord` | 3.29 m | Cell chord length |
| `PILOT_FWD_SHIFT` | 0.28 | Pilot forward shift in normalized NED x |
| `PILOT_DOWN_SHIFT` | 0.163 | Pilot downward shift in normalized NED z |
| `TRIM_ANGLE` | 6° | Static trim pitch (body relative to canopy) |
| `PILOT_PIVOT_X/Z` | 0.2951 / 0.1332 | Post-trim riser attachment in NED norm |
| `DEPLOY_CHORD_OFFSET` | (see code) | Forward shift at deploy=0 |

##### Mass Transform Chain (working ✅)

Mass segment positions go through the full assembly correctly:

```
1. Define pilot body segments in local prone frame
     (head at +x, symmetric about y=0, torso at z=0)
     → WINGSUIT_MASS_SEGMENTS (14 segments)

2. Translate: apply body-depth offsets + PILOT_FWD_SHIFT/DOWN_SHIFT
     p.x += depth_fwd + 0.28
     p.z += depth_down + 0.163
     → CANOPY_PILOT_RAW

3. Rotate by TRIM_ANGLE (6°) about origin
     x' = x·cos(6°) − z·sin(6°)
     z' = x·sin(6°) + z·cos(6°)
     → CANOPY_PILOT_SEGMENTS (static, pre-computed)

4. Per-frame: rotate about (PILOT_PIVOT_X, PILOT_PIVOT_Z) by pilotPitch
     dx = x − pivot_x,  dz = z − pivot_z
     x' = dx·cos(δ) − dz·sin(δ) + pivot_x
     z' = dx·sin(δ) + dz·cos(δ) + pivot_z
     → rotatePilotMass()

5. Per-frame: scale canopy mass segments for deployment
     y' = y × (0.1 + 0.9 × deploy)          // span scaling
     x' = x + DEPLOY_CHORD_OFFSET × (1−deploy)  // chord-wise shift
     → applied to CANOPY_STRUCTURE_SEGMENTS and CANOPY_AIR_SEGMENTS

6. Combine all → computeCenterOfMass() → system CG in meters (NED)
     CG = Σ(mᵢ · posᵢ · height) / Σ(mᵢ)
```

##### Aero Segment Transform Chain (working ✅ — minor rendering issues)

Unlike the mass chain, aero segment transforms are handled **inside each
segment factory's `getCoeffs()` closure** in `segment-factories.ts`.
Each factory captures its base position at construction time, then **mutates
`this.position`, `this.S`, `this.chord`, and `this.pitchOffset_deg`** every
frame before coefficients are evaluated. This means `sumAllSegments()` and
`evaluateAeroForcesDetailed()` read already-transformed positions when
computing moment arms.

```
1. Cell positions defined from arc formula (R=1.55, 12° spacing)
     Base positions captured by factory closures as fullX, fullY, fullS, fullChord
     → IBEX_CANOPY_SEGMENTS (7 cells + 6 flaps + 2 parasitic + 1 pilot)

2. Per-frame inside getCoeffs(): canopy cell & flap factories apply deploy scaling
     this.S     = fullS × chordScale × spanScale
     this.chord = fullChord × chordScale
     this.position.x = fullX + DEPLOY_CHORD_OFFSET × (1 − deploy)
     this.position.y = fullY × spanScale
     (position.z stays fixed — line length is constant)
     Also morphs polar: cd_0, cl_alpha, cd_n, alpha_stall_fwd, s1_fwd

3. Per-frame inside getCoeffs(): pilot lifting body factory applies pilotPitch
     this.pitchOffset_deg = basePitchOffset + controls.pilotPitch
     This rotates the CP offset direction from NED x-axis toward z-axis,
     so the hanging pilot's CP moves along the vertical body (correct).

4. Per-segment CP offset from quarter-chord along chord direction:
     cpOffset = -(cp − 0.25) × seg.chord / height
     With pitchOffset rotation in x-z plane:
       cpX = (seg.position.x + cpOffset·cos(pitchRad)) × height
       cpZ = (seg.position.z + cpOffset·sin(pitchRad)) × height
     → sumAllSegments() and evaluateAeroForcesDetailed() in aero-segment.ts

5. Moment arm from CG:
     r = CP_meters − CG_meters
     M += r × F  (cross product)
     M_pitch += q·S·c·CM  (intrinsic segment pitching moment)
     → correct math, correct positions (from mutated seg fields)
```

**Minor structural issues (rendering only, not physics):**

- The deployment position scaling (`position.x`, `position.y`) uses the
  assembled-frame base position. This is slightly inconsistent with how
  Three.js scales the GLB mesh (which scales around the canopy origin).
  The `DEPLOY_CHORD_OFFSET` constant bridges the gap but was hand-tuned.
  Arrows may drift slightly off the mesh at partial deployment.

- The pilot segment's **position** `{ x: 0.38, y: 0, z: 0.48 }` stays
  fixed even as pilotPitch changes. The `pitchOffset_deg` correctly rotates
  the CP offset direction, which is the dominant effect, but the AC origin
  itself doesn't swing like the mass segments do. The error in moment arms
  is small at typical pitch angles (~centimeters) because the CP offset
  rotation handles most of the spatial shift.

- Parasitic body positions (lines, PC) are fixed constants — they don't
  scale with deployment. This is a minor rendering issue only; their force
  contributions are small relative to canopy cells.

##### System CP Diamond (rendering limitation)

The system center of pressure **diamond marker** is computed as a 1D chord
fraction, which cannot fully represent the 3D nature of the canopy system's CP.
This is a **rendering/visualization limitation only** — it does not affect the
physics, which correctly uses 3D per-segment CP positions for moment arms.

```
1. Compute system CM from sumAllSegments() moment sum.
2. Compute normal force: CN = CL·cos(α) + CD·sin(α)
3. CP fraction = CG_fraction − CM / CN
     → 1D chord fraction (0 = LE, 1 = TE)

4. Render: place CP diamond along NED x-axis from computed CG:
     cpOffset = (cg − cp) × chord / height
     cpNED = { x: CG.x + cpOffset, y: CG.y, z: CG.z }
     → mass-overlay.ts updateCP()

5. ⚠️ CP diamond placed at CG height (z = CG.z), but the canopy system's
     aerodynamic CP is physically above the pilot (at the canopy).
     The green diamond appears lower than the true system CP location.
     This is a visualization issue — the per-segment force vectors
     (drawn at each segment's 3D CP) show the correct positions.
```

##### Remaining Improvements

| Issue | Severity | Description |
|-------|----------|-------------|
| CP diamond height | Visual only | Diamond uses 1D chord fraction at CG height; could use 3D weighted CP |
| Pilot AC doesn't swing with pitch | Minor physics | Position fixed, only pitchOffset rotates CP direction; ~cm error at ±10° |
| Parasitic positions don't deploy-scale | Minor visual | Lines/PC arrows stay put while canopy mesh scales; small force contribution |
| DEPLOY_CHORD_OFFSET is hand-tuned | Fragile | Bridges GLB mesh scaling vs. NED position offset; breaks if canopy changes |

##### Architecture Note: Factories as the Physics Transform

The segment factory closures in `segment-factories.ts` **are** the physics
transform chain for aero segments. There is no need for a separate
`transformAeroSegments()` function — the factories mutate segment properties
inside `getCoeffs()` before coefficients are evaluated, and `sumAllSegments()`
reads the already-transformed values.

This architecture means the model geometry registry refactor only affects
**segment construction** (the initial NED-normalized positions passed to
factories), not the per-frame evaluation pipeline. Switching from hand-coded
constants to GLB-derived positions is a one-time data change — the factories
continue to handle deploy/pitch/brake transforms internally.

---

### Assembly: Wingsuit (Standalone)

Single GLB, simpler pipeline.

#### Components

| Component | Model | Pre-Rotation | Offset | Scale |
|-----------|-------|-------------|--------|-------|
| wingsuit | tsimwingsuit.glb | none | 0 | normalized to TARGET_SIZE |

#### System Properties

| Property | Value |
|----------|-------|
| System mass | 77.5 kg |
| Reference height | 1.875 m |
| Reference area | 2.0 m² |
| Reference chord | 1.8 m |
| CG offset fraction | 0.197 (forward of bbox center) |

#### Articulations

None currently. Future: deployment sequence (PC, bridle, snivel, lines).

#### Deployment Sub-Assembly (visual only — no aero effect)

**This is purely a rendering feature.** The wingsuit deployment visualization
does not affect aerodynamics, mass distribution, or any physics calculations.
Positions are approximate and do not need to conform to the normalization
conventions used elsewhere. Do not invest effort making these positions
physically accurate.

| Component | Model | Scale | Visibility |
|-----------|-------|-------|------------|
| pc | pc.glb | 0.4 × s | deploy > 0 |
| snivel | snivel.glb | 0.6 × s | deploy ≥ 0.45 |
| bridle line | generated geometry | — | deploy > 0 |
| shoulder lines (×2) | generated geometry | — | deploy ≥ 0.45 |

Deployment positions trail along the **negated wind direction** in body frame.

| Parameter | Value (fraction of bodyLength) |
|-----------|-------------------------------|
| Container Z (mid-back) | −0.15 |
| Container Y (back surface) | +0.05 |
| Shoulder X (lateral) | ±0.20 |
| Shoulder Z (forward) | +0.10 |
| Max bridle length | 0.80 |
| Max line length | 1.50 |

---

### Assembly: Slick Skydiver / Caravan (Standalone)

Minimal — single GLB, no segments, no articulation.

| Component | Model | Pre-Rotation | Notes |
|-----------|-------|-------------|-------|
| skydiver | tslick.glb | none | Normalized to own bounding box |
| airplane | airplane.glb | none | Normalized to own bounding box |

---

## Measurement Checklist

### Phase 1: Raw GLB Measurements
For each GLB file, open in Three.js editor or Blender and record:

- [x] **tsimwingsuit.glb**: BBox min/max, origin location, axis mapping
- [x] **cp2.gltf**: BBox min/max, origin location, axis mapping
- [x] **tslick.glb**: BBox min/max, origin location, axis mapping
- [x] **airplane.glb**: Scene tree, root transform, mesh inventory (visual placeholder — no BBox needed)
- [x] **bridalandpc.gltf**: Scene tree, mesh structure, BBox (drag element — light-touch)
- [x] **pc.glb**: BBox, mesh structure (same PC geometry as bridalandpc.gltf)
- [x] **snivel.glb**: BBox, mesh structure (3 octahedrons — body + 2 line attachments)

### Phase 2: Physical Landmarks
With GLBs open, identify and mark positions of:

- [x] **Wingsuit**: CG, quarter-chord, head (LE), feet (TE), shoulder joints, container back — all filled in. Wing panel ACs back-computed from NED.
- [x] **Canopy**: cell quarter-chords (×7), cell TEs for flap positions (×6), LE/TE center cell — computed from constant-chord geometry. Riser bottom & bridle top need assembled vehicle.
- [x] **Slick**: CG, quarter-chord — back-computed from NED via glbToNED
- [x] **Airplane**: CG — at origin (visual placeholder, see airplane.glb section)

### Phase 3: Cross-Reference with Code
Verify that landmarks match existing magic numbers:

- [x] `PILOT_OFFSET.position` (0, −0.540, 0) — **verified**: applied pre-rotation in Three.js Y (= GLB space), positions pilot forward so harness meets risers. Captures the trim angle of the line set for this specific canopy (Ibex UL). Will differ for other canopies with different trim angles, line lengths, or line geometry center vs. trimmed pilot position.
- [x] `CANOPY_SCALE` (1.5) — **visual fit, kept as-is.** Physical chord is 3.29 m (220 ft², matching `s = 20.44 m²`). Physically correct scale would be 1.765, but 1.5 looks right on screen. The GLB chord (3.528) × 1.5 × normalization renders at ~2.80 m — 85% of true chord but visually proportionate to the pilot body.
- [x] `GLB_TO_NED` (0.2962) — **resolved**: matches slick model (0.2955, within 0.2%), not wingsuit (0.2817)
- [x] Shoulder offset (10% of body extent) — **visual-only pivot for pilotPitch rotation.** Shifts rotation center from CG (belly) up toward shoulders so pilot swings like a pendulum from riser attachment. Actual shoulder z=0.560 / body 3.550 = 15.8%, so 10% underestimates slightly. No physics impact — only affects pilotPitch visual swing center.
- [x] `cgOffsetFraction` (0.137 for wingsuit) — **visual-only model shift for standalone view.** Shifts the wingsuit mesh backward so the aerodynamic CG (not bbox center) sits at the scene origin, aligning force vector origins. Only used for standalone wingsuit/slick (canopy view uses `applyCgFromMassSegments` instead). Measured CG offset from bbox center = 0.698 GLB / 3.550 body = 0.197, but code uses 0.137 — likely tuned visually so force arrows land correctly on the mesh. Not related to pilot rotation or physics.

### Phase 4: Assembly Verification
With correct per-model data, verify assembled vehicle:

- [x] Cell aero segment positions land on canopy mesh surface — **approximately correct.** Positions were hand-tuned to the visual mesh and correspond to ~37% chord (between QC and mid-chord). The fundamental issue is a **visual-physics scaling mismatch**: the mesh renders at effective scale 0.8451 (CANOPY_SCALE × normScale) while force arrows render at 2.300 (pilotScale × height). Ratio = 0.368, meaning the visual chord spans only 0.972 NED-equivalent units vs the physics chord of 1.755 NED units (3.29/1.875). CP offsets computed from `chord/height` therefore extend past the mesh TE by ~35%. This is an inherent consequence of CANOPY_SCALE=1.5 (visual fit) vs the physically correct 1.765.
- [x] Flap positions land at trailing edges — **approximately correct, cellChord fixed to 3.29.** Flap TE positions use a hand-tuned offset of 0.834 NED-norm from the cell QC, while the rendering-correct offset is 0.972 (= 2.647 GLB × 0.3674 factor). Same visual-physics mismatch as cells. The `parentCellChord` parameter was updated from 2.5 to 3.29 to match the cell chord change.
- [x] Pilot riser pivot matches visual shoulder position — works correctly (10% estimate is close enough for visual swing)
- [x] CP arrows originate from correct chord fraction on each segment — **confirmed**, arrows use chord fraction correctly
- [x] CG (mass overlay) aligns with physical CG expectations — **works nicely**, mass overlay positions look correct
- [x] Force vector origins consistent after CG offset applied — **confirmed**, force vectors stay at scene origin regardless of CG offset. The offset shifts the mesh, not the vectors.

---

## Constants Cross-Reference

All spatial constants in the codebase and their source:

| Constant | File | Value | Source |
|----------|------|-------|--------|
| `A5_HEIGHT` | polar-data.ts | 1.875 m | Pilot physical height |
| `A5_SYS_CHORD` | polar-data.ts | 1.8 m | Wingsuit system chord |
| `A5_CG_XC` | polar-data.ts | 0.40 | CG at 40% chord from LE |
| `GLB_TO_NED` | polar-data.ts | 0.2962 | GLB → NED scale for span |
| `PILOT_FWD_SHIFT` | polar-data.ts | 0.28 | Pilot forward of riser (NED norm) |
| `PILOT_DOWN_SHIFT` | polar-data.ts | 0.163 | Pilot below riser (NED norm) |
| `TRIM_ANGLE_RAD` | polar-data.ts | 6° | Canopy trim angle |
| `PILOT_PIVOT_X` | polar-data.ts | 0.2951 | Riser pivot x (NED norm, post-trim) |
| `PILOT_PIVOT_Z` | polar-data.ts | 0.1332 | Riser pivot z (NED norm, post-trim) |
| `DEPLOY_CHORD_OFFSET` | segment-factories.ts | 0.15 | Canopy chord shift during deployment |
| `CANOPY_SCALE` | model-loader.ts | 1.5 | Raw GLB → realistic canopy size |
| `PILOT_OFFSET.position` | model-loader.ts | (0, −0.540, 0) | Three.js pilot offset under canopy |
| `PILOT_OFFSET.rotation` | model-loader.ts | (−π/2, 0, 0) | Prone → hanging rotation |
| `TARGET_SIZE` | model-loader.ts | 2.0 | Three.js scene normalization target |
| `cgOffsetFraction` | polar-data.ts | 0.197 | Wingsuit CG forward of bbox center (updated from 0.137 to match measured BBox offset) |
| `FABRIC_OVERSHOOT` | model-loader.ts | 1.15 | GLB mesh / pilot physical height ratio (fabric past limbs) |
| `shoulderOffset` | model-loader.ts | 0.10 × bodyExtentY | Pivot at shoulders, not CG (10% of raw body length) |
| `trailingEdgeShift` | model-loader.ts | −0.30 | Bridle attachment: shift toward canopy TE (norm coords) |

### Known Approximations

These are values that work *well enough* but are not derived from first
principles. They should be replaced with proper measurements over time.

| Constant | Current Value | What It Approximates | How To Fix |
|----------|---------------|---------------------|------------|
| `CANOPY_SCALE` (1.5) | Magic number | Physical canopy size / GLB canopy size | Measure GLB bbox chord → derive from physical chord |
| `PILOT_OFFSET.position` (0, −0.540, 0) | Hand-tuned | Pilot shoulder position relative to canopy in Three.js | Measure actual shoulder Y in GLB units |
| `shoulderOffset` (10% body) | Approximation | Distance from CG to shoulder along body axis | Measure in GLB: shoulder joint Y / body extent |
| `cgOffsetFraction` (0.197) | Measured | CG forward of bbox center | ✅ Updated to match GLB measurement: 0.698 / 3.550 = 0.197 |
| `PILOT_DOWN_SHIFT` (0.163) | Hand-tuned | Pilot position below riser in assembled NED | Derive from shoulder-to-riser distance in physical units |
| `1.15 fabric factor` | Observed | GLB envelope vs physical body | Measure GLB bbox max dim and divide by 1.875 m |

---

## Implementation Plan

### Step 1: Extract measurements (Hartman, in 3D editor) — COMPLETE ✅
All 7 GLB files measured. Raw bounding boxes, axis mappings, physical dimensions,
cell geometry, line positions, landmarks, and attachment points recorded above.

### Step 2: Create `model-registry.ts` — COMPLETE ✅
TypeScript module at `src/viewer/model-registry.ts` with:
- **7 types**: `Vec3`, `BBox`, `AxisMapping`, `Landmark`, `Attachment`, `CanopyCellGLB`, `ModelGeometry`, `VehicleAssembly`
- **4 conversion helpers**: `glbToNED()`, `glbToMeters()`, `getCellPositionsNED()`, `relativeToCG()`
- **7 model geometries**: `WINGSUIT_GEOMETRY`, `SLICK_GEOMETRY`, `CANOPY_GEOMETRY`, `AIRPLANE_GEOMETRY`, `BRIDLE_PC_GEOMETRY`, `PC_GEOMETRY`, `SNIVEL_GEOMETRY`
- **2 vehicle assemblies**: `CANOPY_WINGSUIT_ASSEMBLY` (ibex + wingsuit), `CANOPY_SLICK_ASSEMBLY` (ibex + slick)
- **Lookup tables**: `MODEL_REGISTRY` (by id), `ASSEMBLY_REGISTRY` (by id), `TARGET_SIZE`
- **37 unit tests** in `src/tests/model-registry.test.ts` — all passing

Every spatial constant from `model-loader.ts` and `polar-data.ts` is now
codified in the registry with provenance (GLB measurement → physical dimension → derived scale).

### Step 3: Refactor `model-loader.ts` — NEXT
Replace hardcoded offsets, scales, and positions with registry lookups.
Assembly procedure becomes data-driven instead of ad-hoc.

### Step 4: Refactor `vectors.ts` / `polar-data.ts`
Segment positions derived from registry cell positions instead of arc formula.
CP rendering uses registry chord directions.

### Step 5: Verify
Load each vehicle, confirm force vectors, mass overlay, and segment arrows
all land in the correct positions on the GLB mesh.

---

## Design Decisions (resolved)

These were originally open questions — now resolved.

### 1. Segment positions: GLB measurement vs. physical specs

**Decision: Hybrid — x from physics, y from GLB.**

- **Chordwise (x/c):** Computed from physical specs via chord-fraction math
  (e.g. `a5xc()` for wingsuit, arc formula for canopy cells). This is the
  aerodynamically meaningful axis and must match the polar model.
- **Spanwise (y):** Measured from the GLB model and scaled via `GLB_TO_NED`.
  Span positions depend on the physical wing geometry which is most accurately
  captured by the 3D model.
- **Vertical (z):** Usually zero for symmetric bodies; non-zero only for
  assembled vehicles (canopy above pilot) where it comes from assembly offsets.

The registry records **both** GLB positions and computed NED positions.
The GLB positions are the ground truth for verification; the NED positions
are what the physics system actually uses.

### 2. Canopy cell positions: arc formula vs. GLB mesh

**Decision: GLB mesh positions are the target source of truth.**
The current arc formula (R=1.55, 12° spacing) was a deliberate
aerodynamic model, but analysis shows it diverges significantly from the
actual GLB cell geometry — especially at the outer cells where the arc
model over-predicts spanwise position by ~28%. The GLB mesh represents
the actual canopy shape from the manufacturer's geometry.

The model registry will store raw GLB cell QC positions and convert them
to NED via a clean, vehicle-independent pipeline:
1. Scale: `glbToMeters = physicalChord / glbChord` (canopy-specific)
2. Axis mapping: GLB {X,Y,Z} → NED {y, -z, x} (model-specific)
3. Assembly offset: GLB origin (riser convergence) → NED origin

See the **GLB → NED Conversion Pipeline** section under cp2.gltf for
the full conversion table and comparison with current code positions.

> **Migration path:** The model registry (`model-registry.ts`) is now
> implemented with GLB-derived cell positions. Next step: wire the registry
> into `polar-data.ts` segment construction to replace arc-based positions,
> then verify physics (moments, trim, roll response) are correct or improved.

### 3. `CANOPY_SCALE` — eliminate or derive?

**Decision: Derive from physical dimensions.** Raw GLB chord is measured
(3.529 GLB units), physical chord is 3.29 m. The physically correct scale
would be 1.765, but the current value (1.5) provides better visual
proportions. Both values are now recorded in `CANOPY_GEOMETRY.physicalReference`
in `model-registry.ts`. Swapping to a different canopy GLB only requires
updating that model's geometry data.

### 4. Wingsuit deployment visualization

**Decision: Visual only — exempt from normalization.** The wingsuit deployment
(PC, bridle, snivel, lines) is purely a rendering effect. It does not affect
aerodynamics or mass distribution. Positions are in Three.js scene units as
fractions of `bodyLength` and do not need to convert to NED or meters.

**Canopy deployment** (span/chord scaling, pilot pitch) **does** affect
aerodynamics significantly and must use the proper normalization pipeline.

### 5. Pilot height vs. GLB bounding box

**Decision: Physical pilot height (1.875m) is the normalization reference.**
The GLB bounding box is larger (~1.15× pilot height) because fabric extends
past limbs. The `FABRIC_OVERSHOOT` factor (1.15) accounts for this.
In the target system, `glbToMeters` will be computed from the GLB bbox and
the known physical height, making this factor derivable rather than magic.

### 6. Pivot points: shoulder vs. CG vs. riser attachment

These are **three distinct physical points** in the canopy system:

| Point | What | NED (approx) | Current Constant |
|-------|------|-------------|------------------|
| System CG | Weighted center of all mass segments | Computed dynamically | `computeCenterOfMass()` |
| Shoulder pivot | Where pilot body rotates under risers | Near CG but ~10% body-length above | `shoulderOffset` (0.10 × bodyExtent) |
| Riser attachment | Where risers connect to harness | At or near shoulder | `PILOT_OFFSET.position` |

All three are close together but **pilot pitch rotation** occurs about the
shoulder/riser point, not the CG. As pilot pitches, the CG moves relative
to the riser attachment, which affects the moment arm for pendulum stability.
The mass physics must rotate mass segments about the shoulder pivot point
(via `rotatePilotMass()`) to get this right.
