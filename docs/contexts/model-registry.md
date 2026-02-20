# Context: Model Registry

> **Load this context** when working on GLB model geometry, scaling,
> coordinate transforms, assembly rules, or any code that converts between
> GLB ↔ meters ↔ NED ↔ Three.js coordinate spaces.

---

## Scope

The model registry (`model-registry.ts`) is the **single source of truth**
for all spatial data extracted from GLB model files. It owns:

- Per-model bounding boxes, axis mappings, physical dimensions, scale factors
- Canopy cell geometry (positions, chord, ribs, line attachments)
- Vehicle assembly rules (how canopy + pilot compose into a system)
- Coordinate conversion helpers (`glbToNED()`, `glbToMeters()`, `getCellPositionsNED()`, `relativeToCG()`, `getCellBoundsGLB()`)

It does **not** own:
- Aerodynamic coefficients (those live in `polar-data.ts`)
- Runtime physics evaluation (factory closures in `segment-factories.ts`)
- Rendering logic (model-loader.ts, vectors.ts, scene.ts)

The registry is a **data-only module** — no imports from the physics or rendering layer. Other modules import from it, never the reverse.

---

## Key Files

### Must Read
| File | Lines | What's There |
|------|-------|--------------|
| `src/viewer/model-registry.ts` | ~1170 | **The registry itself** — all types, data, conversion helpers |
| `MODEL-GEOMETRY.md` | ~1400 | Reference doc — measurement methodology, assembly procedures, constants cross-reference |

### Consumers (read before modifying registry)
| File | What It Uses |
|------|-------------|
| `src/viewer/model-loader.ts` | `WINGSUIT_GEOMETRY`, `CANOPY_GEOMETRY`, `CANOPY_WINGSUIT_ASSEMBLY`, `TARGET_SIZE`, attachment lookups, scaling constants |
| `src/polar/polar-data.ts` | `CANOPY_GEOMETRY` (cell positions via `_cellQC()` / `_cellTE()` / `_bridleTop()` helpers), `CANOPY_WINGSUIT_ASSEMBLY` (trim angle, pilot shifts) |
| `src/viewer/vectors.ts` | Deployment scaling (span/chord factors applied to segment positions) |
| `src/main.ts` | `baseBridlePos` for deployment scaling, wireframe creation |
| `src/viewer/cell-wireframes.ts` | `getCellBoundsGLB()`, rib data, chord geometry |

### Measurement Tools
| File | Purpose |
|------|---------|
| `tools/glb-measure.js` | Console script for Three.js editor — extracts scene tree, BBox, scaling |
| `polar-visualizer/extract-lines.cjs` | Extracts suspension line vertices from cp2.gltf |
| `polar-visualizer/extract-rib-noses.cjs` | Extracts airfoil nose vertices from rib meshes |

---

## Coordinate Systems

Four coordinate spaces exist. Every position in the codebase lives in exactly one.

### 1. GLB Space (per-model, as authored)
- Arbitrary units, arbitrary axes per model
- Axis conventions vary — **always check `model.axes`**
- Common pattern: `+Z = forward, -Y = down, -X = right` (pilot models)
- Canopy: `+Z = forward (LE), +Y = up, +X = right (span)`

### 2. Physical Meters
- SI units, NED orientation
- Converted via `glbToMeters(glb, model)` or `model.glbToMeters` scalar
- Used for: physical dimensions, chord lengths, areas

### 3. NED Normalized
- Meters divided by `referenceHeight` (1.875 m for all current models)
- This is the **physics frame** — all segment positions, mass positions, forces
- Converted via `glbToNED(glb, model)` or `model.glbToNED` scalar
- **x** = forward (head/nose), **y** = right, **z** = down

### 4. Three.js Scene
- Rendering frame: **X** = right, **Y** = up, **Z** = toward camera
- From NED: `three.x = -ned.y`, `three.y = -ned.z`, `three.z = ned.x`
- Scene units = meters × (`TARGET_SIZE` / `referenceHeight`)

### Scaling Chain
```
GLB units → × glbToMeters → meters → ÷ referenceHeight → NED normalized
                                    → × (TARGET_SIZE / referenceDim) → Three.js scene units
```

---

## Model Inventory

| ID | File | Physical Ref | glbToMeters | Purpose |
|----|------|-------------|-------------|---------|
| `tsimwingsuit` | tsimwingsuit.glb | height 1.875m | 0.5282 | Wingsuit pilot (standalone + canopy sub-model) |
| `tslick` | tslick.glb | height 1.875m | 0.5541 | Slick skydiver |
| `cp2` | cp2.gltf | chord 3.29m | 0.9322 | Ibex UL canopy (7-cell, 50+ meshes) |
| `airplane` | airplane.glb | wingspan 16.97m | 1.0211 | Exit aircraft (visual only) |
| `bridalandpc` | bridalandpc.gltf | length 3.0m | 0.8130 | Bridle + PC (canopy deployment) |
| `pc` | pc.glb | diameter 0.46m | 0.9583 | Pilot chute (wingsuit deployment) |
| `snivel` | snivel.glb | width 0.40m | 0.2500 | Canopy in bag (wingsuit deployment) |

**Each model has its own `glbToMeters`** — there is no shared constant.
The old `GLB_TO_NED = 0.2962` was measured from the slick model only and is deprecated.

---

## Vehicle Assemblies

### `ibex-wingsuit` — Canopy + Wingsuit Pilot

| Parameter | Value | Derivation |
|-----------|-------|-----------|
| `parentScale` | 1.5 | Canopy visual fit (raw GLB is undersized) |
| `childScale` | 0.850 | `1.5 × (1.875/3.550) / (3.29/3.529)` — corrects cross-model scaling |
| `childOffset` | `(0, -0.476, 0)` | `-(shoulder_glbZ × childScale)` — shoulder at harness Y=0 |
| `childRotationDeg` | `(-90, 0, 0)` | Prone → hanging |
| `shoulderOffsetFraction` | 0.158 | `shoulder_glbZ / maxDim = 0.560/3.550` |
| `trimAngleDeg` | 6 | Canopy trim angle |

### `ibex-slick` — Canopy + Slick Skydiver

Same structure, `childScale = 0.891`, `childOffset.y = -0.499`.

### Assembly Pipeline (model-loader.ts)
```
1. Load canopy GLB, apply parentScale (1.5) with X-flip (-1.5, 1.5, 1.5)
2. Load pilot GLB
3. Create pilotPivot group at riser attachment point
4. Position pilot inside pivot (shoulder offset + childScale)
5. Rotate pilot -90° X (prone → hanging)
6. Apply childScale to pilot model
7. Composite both into root group
8. Normalize: scale so pilot raw maxDim maps to TARGET_SIZE (2.0)
9. Center at riser convergence (not bbox center)
10. Apply CG offset via applyCgFromMassSegments()
```

---

## Canopy Cell Architecture

The Ibex UL has **7 cells** defined as **4 unique shapes** (center + 3 pairs, mirrored):

| Cell | GLB X (span) | GLB Y (height) | GLB QC Z | Physics Segments |
|------|-------------|----------------|----------|-----------------|
| 1 (center) | 0 | 4.337 | -0.248 | cell_c |
| 2 (inner) | ±0.895 | 4.305 | -0.249 | cell_r1/l1, flap_r1/l1 |
| 3 (mid) | ±1.763 | 4.107 | -0.249 | cell_r2/l2, flap_r2/l2 |
| 4 (outer) | ±2.555 | 3.699 | -0.249 | cell_r3/l3, flap_r3/l3 |

Cell positions use the **non-load-bearing center rib's nose vertex** (glbXNose, glbYChordLE, glbZNose) for the chord-plane aerodynamic center.

### Rib Structure
- 8 ribs per half-span, alternating load-bearing (2, 4, 6, 8) and non-load-bearing (1, 3, 5, 7)
- Load-bearing ribs carry A/B/C/D suspension lines and form cell boundaries
- Non-load-bearing ribs sit at cell centers for shape
- Cell boundaries: Rib 2↔4 (cell 2), Rib 4↔6 (cell 3), Rib 6↔8 (cell 4)
- Center cell: -Rib 2 to +Rib 2 (mirrored)

### Line Set Topology
Per load-bearing rib (2, 4, 6, 8):
- 4 canopy attachment points: A (LE), B (fwd of QC), C (aft of QC), D (rear)
- 2 cascade junctions: AB → front riser, CD → rear riser
- 2 riser endpoints: front, rear
- All positions right-side GLB; left side mirrors at -X

---

## Constraints & Invariants

### DO NOT change without reading full context
- **Axis mappings** — changing `model.axes` breaks every coordinate conversion downstream. Verify with `tools/glb-measure.js` before modifying.
- **`glbToMeters` / `glbToNED`** — these are derived from physical dimensions. If you change `physicalReference`, recompute both.
- **Cell positions** — consumed by `polar-data.ts` via `_cellQC()` / `_cellTE()`. Changing cell data changes physics behavior (forces, moments, trim).
- **Assembly childScale** — derived from cross-model scaling ratios. If either model's `glbToMeters` changes, `childScale` must be recomputed.
- **Assembly childOffset** — derived from shoulder attachment position × childScale. If shoulder moves or childScale changes, offset must update.

### Architecture Rules
1. **Registry is data-only** — no imports from physics or rendering. Dependency flows one way: registry → consumers.
2. **One `glbToMeters` per model** — no shared scaling constants across models.
3. **GLB measurements are the source of truth** — physical dimensions are recorded separately and may be updated independently.
4. **Positions are GLB-origin-relative** — use `relativeToCG()` to convert to CG-relative when needed for physics.
5. **All spatial constants trace to registry** — no magic numbers in consuming modules. If you see a hardcoded position in model-loader.ts or polar-data.ts, it should come from the registry.
6. **Cell data uses nose vertex, not top skin LE** — QC Z is computed from rib mesh nose vertex Z (0.626–0.627), not top skin LE Z (0.655). The difference is ~19mm and affects moment arms.

### Test Coverage
- `src/tests/model-registry.test.ts` — validates scale consistency, bbox, axis mapping, conversion helpers, cell bounds, assembly references, registry completeness
- Currently **192 tests total** across 6 test files, 0 TypeScript errors

---

## Common Tasks

### Adding a new GLB model
1. Measure with `tools/glb-measure.js` in Three.js editor (or Blender)
2. Record BBox, axis mapping, physical reference dimension
3. Add `ModelGeometry` object to `model-registry.ts`
4. Add to `MODEL_REGISTRY` lookup table
5. Add tests in `model-registry.test.ts`
6. Update `MODEL-GEOMETRY.md` with measurements
7. Update this context file

### Changing a model's physical dimensions
1. Update `physicalReference.meters` in the model's geometry object
2. Recompute `glbToMeters` and `glbToNED`
3. If the model is used in an assembly, recompute `childScale` and `childOffset`
4. Run tests — physics will shift due to new scaling

### Adding cell positions for a new canopy
1. Extract rib positions using `extract-rib-noses.cjs`
2. Define cells as pairs of load-bearing rib boundaries
3. Populate `cells`, `ribs`, `glbChord`, `glbLeZ`, `glbTeZ`
4. `getCellPositionsNED()` and `getCellBoundsGLB()` work automatically from the data

### Debugging position misalignment
1. Check which coordinate space the position is in (GLB? NED? Three.js?)
2. Verify the model's axis mapping matches the GLB file
3. Check whether CG offset has been applied (positions relative to GLB origin vs. CG)
4. For canopy: remember the X-flip in model-loader.ts (canopy scale.x is negated)
5. Use cell wireframes (`showCellWireframes` checkbox) to visualize cell volumes against GLB mesh

---

## Related Context Files
- `docs/contexts/canopy-system.md` — Canopy physics, brake flaps, deployment (TODO)
- `docs/contexts/visualization.md` — Three.js rendering pipeline (TODO)

## Reference Docs
- `MODEL-GEOMETRY.md` — Full measurement documentation and assembly procedures
- `WIREFRAME-SUMMARY.md` — Cell wireframe implementation details
