# Bridle + PC Registry Integration — Meeting Summary

**Date:** February 19, 2026  
**Status:** Complete — ready for commit  
**Companion work:** See also [2026-02-19-line-geometry-brake-flaps-physics.md](2026-02-19-line-geometry-brake-flaps-physics.md) for other changes in this same commit

---

## Overview

Completed the model registry integration by adding the bridle + pilot chute (PC) system, which was the last major component still using hardcoded positions. The bridle GLB model and PC aerodynamic segment now source their attachment point from the model registry's `bridleTop` landmark, automatically staying synchronized with the canopy mesh.

Additionally implemented **deployment scaling** for both the bridle position and PC drag vector, so they deform along with the canopy mesh during the deployment slider (0–100%) animation, maintaining correct visual and physical alignment throughout the inflation sequence.

This completes the model registry project started in commit f2261f8. All GLB-derived spatial data now traces back to measurements in `model-registry.ts`, and all visual/physics synchronization happens automatically through the registry.

## What Changed

### Core Integration (Bridle + PC)

**`polar-data.ts`** — Added `_bridleTop()` helper function (lines 619–629)
- Extracts `bridleTop` attachment from `CANOPY_GEOMETRY` (GLB coords → NED normalized)
- PC aero segment position now calls `_bridleTop()` instead of using hardcoded value
- Automatic synchronization: if the canopy attachment point moves in the GLB, both the visual bridle and physics PC segment update together
- Old hardcoded position: `{ x: +0.10, y: 0, z: −1.30 }` (manually tuned above canopy)
- ✅ New registry-based position: extracted from GLB mesh, auto-converts to NED

**`model-loader.ts`** — Bridle GLB positioning from registry (lines 327–350)
- Removed old bbox-based attachment (measured canopy top Y, then shifted -0.30 toward trailing edge)
- Now reads `bridleTop` from `CANOPY_GEOMETRY.attachments`
- Transforms through the same GLB → Three.js pipeline as the canopy mesh (including X-flip)
- Position formula: `(-glb.x × cs × s, glb.y × cs × s, glb.z × cs × s)` where:
  - `cs` = parentScale (1.5) from `CANOPY_WINGSUIT_ASSEMBLY`
  - `s` = normalization scale (TARGET_SIZE / referenceDim)
  - X negated to match canopy mesh X-flip (right-left correction)

**`main.ts`** — Bridle deployment scaling (lines 579–600)
- Added `baseBridlePos` field to `LoadedModel` interface
- Stores the full-deployment position (set during model load)
- During deployment slider changes, scales bridle position: `(x × spanScale, y, z × chordScale)`
- Automatically subtracts CG offset after scaling so the bridle stays centered relative to the model origin
- Scale formulas match canopy mesh:
  - `spanScale = 0.1 + 0.9 × deploy` (min 10% span at deploy=0)
  - `chordScale = 0.3 + 0.7 × deploy` (min 30% chord at deploy=0)

**`vectors.ts`** — PC drag vector deployment scaling (lines 279–368)
- Added `deploy` parameter to `updateForceVectors()` (default 1.0 for full deployment)
- PC, cell, and flap segment positions are scaled before CP offset calculation
- Scaling applied to canopy-attached segments only (pilot body segments unaffected)
- Formula: `segPosX *= chordScale`, `segPosY *= spanScale`, z unchanged (vertical not scaled)
- Ensures the PC drag arrow stays attached to the bridle tip throughout deployment
- Side benefit: cell and flap arrows also scale correctly (discovered during testing)

---

## Key Technical Decisions

### Registry as Single Source of Truth
All GLB-derived data (attachment points, rib geometry, line positions) now lives in `model-registry.ts`. Visual models and physics segments both query the same source, eliminating manual synchronization and measurement drift. The `bridleTop` landmark (76% chord, center span, top skin surface) defines both where the bridle GLB attaches and where the PC aero segment sits.

### Deployment Scaling Consistency
Three systems scale together during deployment:
1. **Canopy GLB mesh** — horizontal deformation (span 10–100%, chord 30–100%)
2. **Bridle position** — `baseBridlePos` scaled by spanScale/chordScale, then CG-adjusted
3. **Aero segment positions** — PC, cells, flaps scaled before CP offset calculation in `updateForceVectors()`

All three use identical scale formulas, so the PC drag arrow stays glued to the bridle tip and cell arrows stay centered on their respective cell volumes throughout the entire deployment range.

### Brake Flaps as Separate Segments
Previously brake deflection just added drag to the parent cell. Now flaps are independent `AeroSegment` instances with their own area, chord, and coefficients. Benefits:
- Physically accurate progressive braking (outer flaps deflect more)
- Visual clarity (separate colored arrows per flap)
- Correct moment arms (flap CP is aft of cell QC)
- Cell area conservation (parent cell shrinks when flap deploys)

Matches real paraglider aerodynamics where brake deflection creates a downward-facing surface behind the trailing edge, generating both drag and a nose-down pitching moment.

### Line Set Geometry for Future Line Modeling
The `lineSet` data structure stores complete suspension line topology: per-rib canopy attachments (A/B/C/D), cascade junctions (where upper lines merge), and riser endpoints. This enables future work:
- Line drag modeling (parasitic drag from 40+ individual line segments)
- Line tension visualization (color-coded by load)
- Asymmetric line loading during turns (inner lines slack, outer lines tight)
- Line-twist simulation (yaw moment from tangled lines)

Data is already in the registry; just needs a rendering + physics layer.

---

## Files Changed (Bridle+PC subset)

**Core files (4):**
```
polar-visualizer/src/polar/polar-data.ts          (_bridleTop() helper, PC segment)
polar-visualizer/src/viewer/model-loader.ts       (bridle GLB positioning, baseBridlePos)
polar-visualizer/src/main.ts                      (bridle deployment scaling)
polar-visualizer/src/viewer/vectors.ts            (deploy parameter, PC position scaling)
```

**Supporting changes:**
```
polar-visualizer/src/viewer/model-registry.ts     (bridleTop attachment data)
```

**Note:** This commit also includes substantial parallel work (line geometry extraction, brake flaps, physics tests). See [2026-02-19-line-geometry-brake-flaps-physics.md](2026-02-19-line-geometry-brake-flaps-physics.md) for details on those changes.

**Total commit size:** 15 files changed (+1656 insertions)

Because both paths start from the same source data, they stay synchronized automatically. Changing the attachment point in the GLB (or in the registry) updates both systems together — no manual re-tuning required.

**Old approach (pre-registry):**  
Visual bridle positioned at `canopy.bbox.max.y + (−0.30)` in normalized coords. Physics PC positioned at hardcoded `{ x: +0.10, y: 0, z: −1.30 }` in NED. These were measured/tuned once, then diverged whenever the canopy mesh changed. Required periodic re-alignment.

### Deployment Scaling Consistency
Three systems scale together during deployment:

1. **Canopy GLB mesh** — horizontal deformation  
   ```typescript
   canopyModel.scale.set(
     -CANOPY_SCALE × spanScale,  // X (lateral/span), negated for X-flip
     CANOPY_SCALE,                // Y (vertical), always full height
     CANOPY_SCALE × chordScale,   // Z (fore-aft/chord)
   )
   ```

2. **Bridle position** — scaled from base position, then CG-adjusted  
   ```typescript
   bridleGroup.position.set(
     baseBridlePos.x × spanScale  - cgOffset.x,
     baseBridlePos.y              - cgOffset.y,  // no vertical scaling
     baseBridlePos.z × chordScale - cgOffset.z,
   )
   ```

3. **Aero segment positions** — PC, cells, flaps scaled before CP offset  
   ```typescript
   if (seg.name === 'pc' || seg.name.startsWith('cell_') || ...) {
     segPosX *= chordScale
     segPosY *= spanScale
     // z (vertical) not scaled
   }
   ```

All three use identical scale formulas (`spanScale = 0.1 + 0.9 × deploy`, `chordScale = 0.3 + 0.7 × deploy`), ensuring:
- The PC drag arrow stays attached to the bridle tip
- Cell arrows stay centered on their respective cell volumes
- Force vectors move with the mesh surface throughout inflation (0–100%)

**Why minimum scale factors?**  
At deploy=0, the canopy shrinks to 10% span and 30% chord (not 0%) to prevent extreme mesh thinning and avoid GPU artifacts. The minimums were chosen empirically — at 10%/30% the mesh is recognizably "packed" but still visible and render-stable. Below ~5%/20% the mesh inverts or flickers
---

## Session Notes

**Why bridle + PC was deferred until now:**  
The bridle attachment point (76% chord on canopy top skin) is outside the cell bounding boxes — it's on the continuous fabric between cells, not at a load-bearing rib. We needed the full `CANOPY_GEOMETRY` data (including non-cell attachments) before we could properly locate it. Adding it during the cell wireframes session would have created circular dependencies (bridle needs canopy geometry, canopy geometry was being refactored).

**Why deployment scaling matters:**  
The canopy GLB mesh deforms horizontally during deployment to simulate inflation. Without scaling the bridle and PC positions, the bridle would appear to float in mid-air during the 0–30% deployment phase (canopy shrinks, bridle stays full-size), and the PC drag arrow would point offset from the bridle tip. Now all three systems move together — the bridle tip, PC segment position, and drag arrow stay aligned at all deployment fractions.

**Unexpected benefit:**  
Adding the `deploy` parameter to `updateForceVectors()` revealed that cell and flap segments also needed deployment scaling. The cell positions are on the canopy surface, so when the mesh shrinks, the arrows were rendering inside the mesh volume. Now cells and flaps scale correctly too — a side effect of making the PC work properly.

**Implementation time:**  
Bridle+PC integration: ~2 hours (helper function, GLB positioning, deployment scaling, vectors update)  
Other work (line geometry, brake flaps, physics tests): ~6 hours (see companion meeting summary)  
Total session: ~8 hours over one day (Feb 19, 2026)

---

## Test Results

- **192 tests passing** across 6 test files (no regressions)
- **0 TypeScript errors** (`npx tsc --noEmit` clean)
- All existing polars unchanged (aurafive, ibexul, slicksin, caravan)
- Bridle+PC visual alignment verified at deploy = 0%, 50%, 100%

---

## Commit Message (Draft)

```
Bridle + PC registry integration + line geometry + brake flaps

Complete model registry integration by moving bridle+PC to registry-based
positioning. Add suspension line set geometry extraction. Implement brake
flaps as separate aero segments. Add deployment scaling for bridle, PC,
cells, and flaps.

BRIDLE + PC INTEGRATION:
- polar-data.ts: Add _bridleTop() helper, PC segment uses registry
- model-loader.ts: Bridle GLB positioning from CANOPY_GEOMETRY.attachments
- main.ts: Bridle position scales during deployment (baseBridlePos field)
- vectors.ts: PC drag vector scales during deployment (deploy parameter)

LINE SET GEOMETRY:
- model-registry.ts: Add LineSetGLB data structure (516 lines)
- extract-lines.cjs: New utility to extract line vertices from cp2.gltf
- Per-rib canopy attachments (A/B/C/D), cascades, riser endpoints
- Ready for future line drag modeling + tension visualization

BRAKE FLAPS:
- segment-factories.ts: Flaps as separate AeroSegment instances
- Progressive deflection (outer flaps > inner flaps)
- Cell area conservation (parent shrinks when flap deploys)
- Correct moment arms (flap CP aft of cell QC)

PHYSICS VALIDATION:
- sim.test.ts: +359 lines (apparent mass, ω×r, RK4, damping tests)
- All 192 tests passing, 0 TypeScript errors

DEPLOYMENT SCALING:
- Canopy mesh, bridle position, aero segments scale together
- Span: 0.1→1.0×, Chord: 0.3→1.0× (min values prevent extreme thinning)
- PC, cells, flaps: segment positions scaled before CP offset

FILES: 15 changed (+1656), 2 new scripts
SEE: memory/meetings/2026-02-19-bridle-pc-registry-integration.md
SEE: memory/meetings/2026-02-19-line-geometry-brake-flaps-physics.md
```
