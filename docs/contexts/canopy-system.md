# Context: Canopy System

> **Load this context** when working on the Ibex UL canopy: cell aerodynamics,
> brake flaps, suspension lines, deployment animation, pilot attachment,
> or canopy-related mass segments.

---

## Scope

The canopy system covers everything about the Ibex UL paraglider as an
assembled vehicle: canopy cells, brake flaps, parasitic bodies (lines, PC),
pilot body hanging below, deployment sequence, and the articulation between
canopy and pilot.

This crosses physics, rendering, and registry boundaries — which is why it
needs its own context.

---

## Key Files

### Must Read
| File | What's There |
|------|-------------|
| `src/polar/polar-data.ts` lines 580–920 | Canopy mass segments, pivot, `rotatePilotMass()`, cell/flap polars, `IBEX_CANOPY_SEGMENTS`, `makeIbexAeroSegments()` |
| `src/polar/segment-factories.ts` | `makeCanopyCellSegment()`, `makeBrakeFlapSegment()`, `makeParasiticSegment()`, `makeLiftingBodySegment()`, `makeUnzippablePilotSegment()`, control constants |
| `src/viewer/model-registry.ts` | `CANOPY_GEOMETRY` (cells, ribs, lineSet, attachments), `CANOPY_WINGSUIT_ASSEMBLY` |

### Also Relevant
| File | What's There |
|------|-------------|
| `src/viewer/model-loader.ts` | Canopy+pilot assembly pipeline, deployment scaling, bridle positioning |
| `src/viewer/vectors.ts` | Per-segment force arrows, deployment scaling of positions |
| `src/viewer/cell-wireframes.ts` | 3D cell volume wireframes (debugging/alignment) |
| `src/main.ts` | Wiring: deployment slider, bridle scaling, wireframe toggle |
| `src/polar/aero-segment.ts` | `computeSegmentForce()`, `sumAllSegments()`, wind frame |

### Reference Docs
| Doc | What's There |
|-----|-------------|
| `MODEL-GEOMETRY.md` | Canopy measurements, assembly procedure, constants |
| `WIREFRAME-SUMMARY.md` | Cell wireframe implementation and rib geometry |
| `DEPLOYMENT.md` | Deployment sequence design |

---

## Architecture

### 16 Aero Segments

The canopy system has 16 aerodynamic segments (plus 1 pilot = 17 total):

| Type | Count | Names | Factory |
|------|-------|-------|---------|
| Canopy cells | 7 | cell_c, cell_r1/l1, cell_r2/l2, cell_r3/l3 | `makeCanopyCellSegment()` |
| Brake flaps | 6 | flap_r1/l1, flap_r2/l2, flap_r3/l3 | `makeBrakeFlapSegment()` |
| Parasitic | 2 | lines, pc | `makeParasiticSegment()` |
| Pilot body | 1 | pilot | `makeUnzippablePilotSegment()` or `makeLiftingBodySegment()` |

### Cell Positions (NED Normalized, CG-Relative)

All positions are GLB-derived via `_cellQC()` and `_cellTE()` helpers in
`polar-data.ts`. These read from `CANOPY_GEOMETRY.cells` in the registry.

The canopy sits ~4.08 m above the riser (z ≈ −2.18 NED normalized).

### Brake Flap Model

Flaps are **separate AeroSegment instances**, not drag modifiers on parent cells.

Key behaviors:
- Progressive deflection: inner 0.4, mid 0.7, outer 1.0 sensitivity
- Flap area scales with brake input (0 = retracted, full = max chord fraction)
- **Cell area conservation**: parent cell shrinks when flap deploys
- Flap CP is aft of cell QC → nose-down pitching moment under brakes
- Chord fractions: inner 10%, mid 20%, outer 30% of cell chord

### Pilot Attachment

The pilot hangs below the canopy, rotated 90° from prone to vertical:

| Parameter | Value | Source |
|-----------|-------|--------|
| Pre-rotation | −90° X | Prone → hanging |
| Trim angle | 6° forward | `CANOPY_WINGSUIT_ASSEMBLY.trimAngleDeg` |
| Pivot point | `PILOT_PIVOT_X = 0.2951`, `PILOT_PIVOT_Z = 0.1332` | Post-trim riser attachment |
| Pitch range | ±30° about riser pivot | `rotatePilotMass()` |
| Pitch offset | 90° | Rotates freestream α by −90° for upright pilot polar evaluation |

`rotatePilotMass()` is the key function — it:
1. Rotates all 14 pilot mass segments about the riser pivot by `pilotPitch`
2. Scales canopy structure/air segments by deployment fraction
3. Returns combined weight + inertia segment arrays

### Deployment Scaling

Three systems scale together during deployment (0 = packed, 1 = full):

| System | Span Scale | Chord Scale | Formula |
|--------|-----------|-------------|---------|
| Canopy GLB mesh | 0.1 → 1.0 | 0.3 → 1.0 | `0.1 + 0.9 × deploy`, `0.3 + 0.7 × deploy` |
| Bridle position | same | same | `baseBridlePos × scale - cgOffset` |
| Aero segments (PC, cells, flaps) | same | same | Positions scaled before CP offset |

Deployment also affects aerodynamic coefficients via deployment multipliers in
`segment-factories.ts` (cd_0 ×3, cl_alpha ×0.3, etc. at deploy=0).

### Mass Distribution

| Group | Count | Total massRatio | Role |
|-------|-------|----------------|------|
| Pilot body | 14 segments | 1.000 of pilot mass | Weight + inertia, rotates with pilotPitch |
| Canopy structure | 7 segments | 0.045 (~3.5 kg) | Weight + inertia |
| Canopy air | 7 segments | 0.077 (~6 kg) | Inertia only (buoyant, no weight) |

Weight segments = pilot + structure (used for gravity force).
Inertia segments = pilot + structure + air (used for moment of inertia).

---

## Constraints & Invariants

### Critical
- **All cell/flap positions are GLB-derived** — do not hardcode NED positions. Use `_cellQC()` / `_cellTE()` helpers that read from registry.
- **Cell area conservation** — when flaps deploy, parent cell area must shrink by the same amount. Total wing area stays constant.
- **Three-way deployment sync** — mesh, bridle, and aero segment positions must use identical scale formulas. Breaking this puts force arrows in wrong positions.
- **Pilot pitch rotates mass segments** — `rotatePilotMass()` must be called whenever `pilotPitch` or `deploy` changes. It returns new segment arrays; the old ones are stale.
- **Factory closures are the transform chain** — `getCoeffs()` inside each segment captures the base position at construction time and mutates `this.position/S/chord` per-frame. There is no separate `transformAeroSegments()` function.

### Architecture Rules
1. Segment factories are **UI-independent** — no Three.js or DOM. Portable to CloudBASE.
2. `polar-data.ts` is the **assembly point** — it imports factories + registry data and builds segment arrays.
3. The registry provides **construction data only** — positions, dimensions. Runtime behavior lives in factory closures.
4. Parasitic segments (lines, PC) use constant CD — they don't respond to brake/riser inputs.
5. The pilot segment delegates to the system-level polar (aurafiveContinuous or slicksinContinuous) for coefficient evaluation, with a 90° pitch offset.

---

## Common Tasks

### Changing brake behavior
1. Modify `DEFAULT_CONSTANTS` in `segment-factories.ts` (BRAKE_ALPHA_COUPLING_DEG, MAX_FLAP_DEFLECTION_DEG, etc.)
2. Or change per-cell sensitivity in `IBEX_CANOPY_SEGMENTS` array in `polar-data.ts`
3. Run tests — brake changes affect trim, speed polar, and moment balance

### Adding physics cells 5–7 (the 3-cell gap)
Currently 7 GLB cells map to 4 physics groups (center + 3 pairs). To add finer resolution:
1. Add cell 5/6/7 entries to `CANOPY_GEOMETRY.cells` in registry
2. Add corresponding segments in `IBEX_CANOPY_SEGMENTS`
3. Add flap segments for the new cells
4. Redistribute area (total must still = 20.439 m²)
5. Update mass segments if needed

### Implementing line drag
Line set geometry is already in `CANOPY_GEOMETRY.lineSet`. Next steps:
1. Create `makeLineDragSegments()` factory in `segment-factories.ts`
2. Per-rib: 4–6 line segments (A/B/C/D upper, A/C lower, risers)
3. Area = line diameter × length, CD = 1.0–1.2
4. Add to `IBEX_CANOPY_SEGMENTS`
5. Expected: +15–20 N drag at 12 m/s (~8–10% of total)

---

## Related Contexts
- `docs/contexts/model-registry.md` — GLB data, coordinate transforms, assembly rules
- `docs/contexts/physics-engine.md` — EOM, forces, moments, integration
- `docs/contexts/visualization.md` — Three.js rendering, force arrows
