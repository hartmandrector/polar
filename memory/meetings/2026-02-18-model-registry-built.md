# Meeting Notes — 2026-02-18 — Model Registry Built

## Participants
- Hartman (founder)
- VS Code Copilot (Claude Opus 4.6)

## Summary
Built the complete model geometry registry (`model-registry.ts`) — the TypeScript codification of all GLB measurements, physical dimensions, axis mappings, and assembly rules documented in MODEL-GEOMETRY.md. This is Step 2 of the 5-step implementation plan. The registry defines 7 model geometries and 2 vehicle assemblies with full type safety, conversion helpers, and 37 unit tests. Also derived GLB-based canopy cell positions via a vehicle-independent conversion pipeline, revealing that the current arc-formula physics overpredicts outer cell roll moment arms by ~28%. All 178 tests pass (141 existing + 37 new).

## Decisions Made
- **GLB mesh positions are the target source of truth** for canopy cell positions (replacing arc formula R=1.55, 12° spacing). The GLB→NED conversion pipeline is now codified in the registry with `glbToNED()`, `getCellPositionsNED()`, and per-model axis mappings.
- **Vehicle-independent scaling pipeline**: Each model has its own `glbToMeters` derived from its physical reference dimension (pilot height for body models, physical chord for canopy), making the system independent of assembly context.
- **Registry is data-only, no runtime coupling yet**: The registry exists as a standalone module with no imports from or into the existing codebase. Steps 3–4 (refactoring model-loader.ts and polar-data.ts to use registry lookups) are next.

## Key Findings
- **28% roll moment divergence at outer cells**: GLB-derived NED y position for cell 4 is 0.819 vs code's 1.052 (arc formula). The arc model pushes outer cells to wider span than the real geometry. This will change roll damping and sideslip response when we migrate to GLB positions.
- **~1.0 NED z offset**: GLB positions are relative to riser convergence (GLB origin), while current code positions are relative to system CG. The offset (0.96–1.14 NED-normalized) is consistent and handled by the `relativeToCG()` helper.
- **Canopy glbToMeters = 0.932** (from physical chord 3.29 / GLB chord 3.529), distinct from pilot models (0.528 wingsuit, 0.554 slick).

## Files Created
- `src/viewer/model-registry.ts` — **New file** (~480 lines):
  - 7 TypeScript interfaces: `Vec3`, `BBox`, `AxisMapping`, `Landmark`, `Attachment`, `CanopyCellGLB`, `ModelGeometry`, `VehicleAssembly`
  - 4 conversion helpers: `glbToNED()`, `glbToMeters()`, `getCellPositionsNED()`, `relativeToCG()`
  - 7 model geometry objects: wingsuit, slick, canopy (cp2), airplane, bridle+pc, pc, snivel
  - 2 vehicle assembly configs: ibex-wingsuit, ibex-slick
  - Lookup tables: `MODEL_REGISTRY`, `ASSEMBLY_REGISTRY`, `TARGET_SIZE`
- `src/tests/model-registry.test.ts` — **New file** (~250 lines):
  - 37 tests: scale consistency, bbox validation, axis mapping, conversion helpers, cell position extraction, assembly reference validity, registry completeness

## Files Changed
- `MODEL-GEOMETRY.md` — Updated:
  - Implementation Plan: Steps 1–2 marked COMPLETE ✅ with registry details
  - Design Decision #2: Migration path updated (registry is now implemented)
  - Design Decision #3: CANOPY_SCALE now has measured GLB chord recorded

## Open Questions / Blockers
- **Roll moment impact**: When we switch from arc-based to GLB-based cell positions, the 28% narrower outer span will reduce roll damping. Need to verify trim, roll response, and sideslip behavior after migration.
- **3-cell gap persists**: The physics model still uses only 4 cell groups (7 segments) to represent 7 GLB cells. Cells 5–7 are lumped into cell_r3/l3. The registry has all 7 cell positions ready if we decide to add more physics segments.

## Next Steps
- [ ] Step 3: Refactor `model-loader.ts` to use registry lookups (replace CANOPY_SCALE, PILOT_OFFSET, TARGET_SIZE, shoulderOffset, deployment scales with registry references)
- [ ] Step 4: Refactor `polar-data.ts` to derive canopy segment positions from `getCellPositionsNED()` instead of arc formula
- [ ] Verify physics after position migration (Step 5)
- [ ] Consider adding physics cells 5–7 for better outer-span resolution
