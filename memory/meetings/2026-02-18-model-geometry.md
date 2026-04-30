# Meeting Notes — 2026-02-18 — Model Geometry Registry

## Participants
- Hartman (founder)
- VS Code Copilot (Claude Opus 4.6)

## Summary
Reviewed and iteratively refined MODEL-GEOMETRY.md — the "3D Model Geometry Registry" specification written by a prior agent. The document went through three major revision cycles: (1) initial gap analysis identifying 8 issues, (2) resolving 6 open design questions with Hartman's decisions, and (3) a deep-dive physics analysis that revealed the aero segment transform chain is already working correctly via factory closures, requiring a major correction to the document's bug claims. The document is now accurate and ready for Phase 1 GLB measurements. Also rewrote OPENCLAW-SETUP.md with correct manual gateway startup instructions.

## Decisions Made
- **Two parallel normalization systems**: Pilot-height system (wingsuit, `A5_HEIGHT = 1.875 m`) and chord-based system (paraglider/skydiver, per-cell chord). No refactor needed — they coexist.
- **FABRIC_OVERSHOOT (1.08)** added to scaling constants table — applies to canopy visual mesh only, not physics.
- **Wingsuit deployment is visual-only**: Canopy deploy slider doesn't affect wingsuit segments (they have no canopy).
- **glbToMeters is visual scaling only**: Not used for physics constants. Physics constants are authored directly in meters.
- **Segment factory closures ARE the physics transform chain**: No separate `transformAeroSegments()` function is needed. Factories capture base positions at construction, mutate `this.position/S/chord/pitchOffset_deg` inside `getCoeffs()` each frame.
- **Registry refactor scope**: Only affects segment construction data (initial positions, areas, chords). Does not touch the per-frame `getCoeffs()` pipeline or physics evaluation.
- **Aero transform chain reclassified**: Changed from "❌ broken — needs fixing" to "✅ working — minor rendering issues". The physics is correct; only the CP diamond marker and some vector rendering have minor visual issues.
- **CP diamond is a rendering limitation**: Physics uses correct per-segment 3D CP positions for moment arms. The single diamond marker is just an area-weighted average for display.

## Files Changed
- `MODEL-GEOMETRY.md` — Three revision cycles:
  - Added `frames.ts` as canonical coordinate reference
  - Rewrote Normalization Strategy with "two parallel systems" explanation
  - Added FABRIC_OVERSHOOT to scaling table
  - Marked wingsuit deployment as visual-only
  - Added constants cross-reference and known approximations table
  - Replaced "Open Questions" with "Design Decisions (resolved)"
  - Wrote Physics Transform Chain subsection (mass chain, aero chain, system CP)
  - Major correction: aero chain ❌→✅, CP chain ❌→rendering-only, removed unnecessary refactor proposal
  - Added architecture note explaining factory closures serve as the transform chain
  - Added section on registry refactor scope (construction data only)
- `OPENCLAW-SETUP.md` — Rewrote for correct manual gateway startup and token requirements

## Open Questions / Blockers
- None blocking. Document is ready for GLB measurement collection.

## Next Steps
- [ ] Phase 1: Measure GLB bounding boxes for all 7 model files (Blender or Three.js Box3)
- [ ] Phase 2: Extract anchor/hinge points from GLB node trees
- [ ] Phase 3: Build geometry registry TypeScript module from measurements
- [ ] Phase 4: Wire registry into segment factories, replacing hardcoded constants
