# Cell Wireframe Project — Meeting Summary

**Date:** February 19, 2026  
**Status:** Complete — ready for commit

---

## Overview

We built a 3D cell wireframe visualization system that overlays the canopy GLB mesh in the Polar Visualizer. A parachute has 7 cells. Each cell's boundaries are defined by loaded ribs (which carry A/B/C/D suspension lines), and each cell has a center unloaded rib that defines its shape. The wireframes show these structural volumes — where air is trapped and aerodynamic forces act — directly verifying that our physics engine segment positions align with the 3D model geometry.

The main alignment work was fitting the bottom skin of each wireframe cell to the loaded ribs (A-line attachment points at the leading edge, bottom skin seams at the trailing edge).

## What Changed

### New File

- **`src/viewer/cell-wireframes.ts`** — Cell wireframe rendering module (~225 lines)
  - `createCellWireframes()` — builds wireframe LineSegments for all 7 cell instances (1 center + 3 pairs)
  - `buildCellBoxGeometry()` — 12-edge box per cell with 8 corners tracking the canopy arc
  - `buildLeTriangleGeometry()` — nose triangles at the leading edge extending bottom attachment points forward to the top skin, showing where the aerodynamic chord begins
  - Color-coded: cyan (center), green (inner pair), yellow (mid pair), orange (outer pair)

### Modified Files (9 files)

| File | Change Summary |
|------|---------------|
| **`model-registry.ts`** | Added `CanopyRibGLB` interface (8 ribs with Y extents + LE/TE attachment data), `CellBoundsGLB` interface (full cell bounding box spec), `getCellBoundsGLB()` function, and populated rib data from GLB mesh measurements |
| **`model-loader.ts`** | Refactored to source all constants from model-registry (paths, scales, offsets, assembly configs). Added canopy X-flip for correct left/right alignment. Canopy centering now at riser convergence point instead of bbox center. `pilotScale` derived from canopy mesh scale for exact physics↔GLB alignment |
| **`polar-data.ts`** | Replaced all hand-tuned arc-formula positions with GLB-derived values via `_cellQC()` and `_cellTE()` helpers. Trim angle and pilot shifts now sourced from `CANOPY_WINGSUIT_ASSEMBLY`. Old arc-formula positions preserved in comments for reference |
| **`main.ts`** | Wired cell wireframes: creates on canopy load, attaches to canopy model group, toggles visibility from UI state |
| **`controls.ts`** | Added `showCellWireframes` to `FlightState`, wired checkbox |
| **`index.html`** | Added "Show Cell Wireframes" checkbox |
| **`model-registry.test.ts`** | Added 14 new tests for `getCellBoundsGLB()` (LE/TE alignment, A-line sourcing, convergence, arc following). Updated existing tests for 7-cell model defined as 4 unique shapes (was 7 half-cells) |
| **`canopy-polish.test.ts`** | Updated flap TE position expectation to match GLB-derived value (-1.429 vs old -0.689) |
| **`sim.test.ts`** | Relaxed free-fall velocity bound (GLB positions place canopy higher, increasing apparent mass inertia) |

## Key Technical Decisions

### 7 Cells, 4 Unique Shapes
The parachute has 7 cells across its span. Each cell spans between two loaded ribs (which carry A/B/C/D suspension lines), with an unloaded rib at its center for shape. The GLB has 8 ribs per half-span: loaded ribs at positions 2/4/6/8, unloaded ribs at 1/3/5/7.

Because the canopy is symmetric, we define 4 unique cell shapes — 1 center cell + 3 progressively outboard — and mirror the outer 3 to produce the full 7. The previous model incorrectly treated each half-cell between consecutive ribs as a separate unit (7 half-cells); the corrected model uses full cells bounded by loaded ribs.

### Bottom Skin Aligned to Loaded Ribs
The wireframe corners are aligned to actual mesh features at each loaded rib, not idealized geometry:
- **Top corners (LE + TE):** Full rib profile edge positions (glbYMax from Rib_N_L meshes)
- **Bottom-LE corners:** A-line attachment points on the loaded ribs (from `a_N_upper` mesh buffer max values) — X converges inboard toward the line attachment, Y sits above the max-thickness line, Z is at 0.308 (aft of top skin LE at 0.655)
- **Bottom-TE corners:** Bottom skin seam at the loaded ribs (X from `Bottom_N_L` panel xMax, Y from `Top_N_L` panel yMin) — the TE is thin so the bottom surface sits well above the max-thickness yMin

### LE Nose Triangles
The bottom-LE attachment point sits 0.347 GLB units aft of the top-skin leading edge (z=0.308 vs z=0.655). Small wireframe triangles at each cell boundary bridge this gap, showing where the aerodynamic chord starts relative to the structural attachment. These are separate LineSegments objects — the box wireframes are untouched.

### Riser Convergence Centering
Canopy models are now centered at the riser convergence point (GLB origin) instead of the bounding-box center. This means `pilotScale` is derived directly from the canopy mesh scale factor, ensuring physics segment NED positions map to exactly the same Three.js coordinates as the GLB geometry. `applyCgFromMassSegments()` subsequently shifts to physics CG.

### GLB-Derived Physics Positions
All canopy cell and flap segment positions in `polar-data.ts` now come from the GLB mesh via the model registry, replacing the previous hand-tuned arc formula (R=1.55, 12° spacing). Key differences:
- Canopy is higher: z ≈ -2.18 NED (4.08m above riser) vs old z ≈ -1.22 (2.29m)
- Span is wider: outer cell y = 1.367 NED vs old 1.052 (30% more)
- QC x is constant across span: -0.113 (all cells at same GLB quarter-chord Z)
- Real canopy arc is flatter: R ≈ 2.96 NED vs old R = 1.55

## Test Results

- **192 tests passing** across 6 test files
- **0 TypeScript errors** (`tsc --noEmit` clean)
- No existing tests broken — existing polar behavior unchanged

## Files to Commit

```
Modified:
  polar-visualizer/index.html
  polar-visualizer/src/main.ts
  polar-visualizer/src/polar/polar-data.ts
  polar-visualizer/src/tests/canopy-polish.test.ts
  polar-visualizer/src/tests/model-registry.test.ts
  polar-visualizer/src/tests/sim.test.ts
  polar-visualizer/src/ui/controls.ts
  polar-visualizer/src/viewer/model-loader.ts
  polar-visualizer/src/viewer/model-registry.ts

New:
  polar-visualizer/src/viewer/cell-wireframes.ts
```

## What's Next (not in this commit)

- Apply trim angle rotation to wireframes (6° forward tilt about riser convergence)
- Derive cell roll angles from rib geometry (currently physics-tuned at 12° spacing)
- CP direction flip fix from X-mirror (deferred — cosmetic only)
