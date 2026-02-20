# Meeting Notes — 2026-02-18 — GLB Measurements (Phase 1)

## Participants
- Hartman (founder)
- VS Code Copilot (Claude Opus 4.6)

## Summary
Collected GLB measurements for 3 of 7 model files (tsimwingsuit, tslick, cp2) using a custom console script in the Three.js editor. Filled in Raw GLB Properties, Internal Mesh Structure, Scaling, and Physical Dimensions sections of MODEL-GEOMETRY.md with exact `Box3.setFromObject` values. Major findings: solved the `GLB_TO_NED` mystery (0.2962 matches the slick model, not the wingsuit), and the cp2 canopy model contains rich per-cell/per-line geometry that maps directly to physics segments — but revealed a 3-cell gap where GLB cells 5–7 have no dedicated physics segments.

## Decisions Made
- **Right axis = -X confirmed**: Cross-product of forward (+Z) × down (-Y) gives right = -X. Inherent to the right-handed GLB frame, unaffected by the -180° rotation.
- **Use Three.js/GLB axes for all GLB measurements**: No axis swapping at the measurement stage — read positions directly from the editor.
- **Exact `Box3.setFromObject` values preferred** over the rounded Box geometry shown in the editor UI.
- **Per-model `glbToNED`** rather than a shared constant — each model has different mesh extents.

## Findings

### tsimwingsuit.glb
- BBox size: 2.824 × 0.612 × 3.550 (X × Y × Z), max dim = Z
- Internal: Group → WS_V3 mesh (3833 verts, -179.91° X rotation, 0.050 scale)
- `glbToMeters` = 0.5282, `glbToNED` = 0.2817
- Origin offset from BBox center: {+0.000, -0.022, +0.698} — CG is forward of geometric center

### tslick.glb
- BBox size: 1.699 × 0.612 × 3.384 (X × Y × Z), max dim = Z
- Same mesh structure as wingsuit (WS_V3, same rotation/scale) — derived from same base
- `glbToMeters` = 0.5541, `glbToNED` = 0.2955
- **Solved GLB_TO_NED mystery**: Code uses 0.2962, slick gives 0.2955 (0.2% match). Value was measured from the slick model, not wingsuit. Wingsuit is 5% longer due to fabric overshoot.

### cp2.gltf (canopy — richest model)
- BBox size: 6.266 × 4.738 × 3.528, max dim = X (span)
- 50+ meshes: 7 Top panels, 7 Bottom panels, 8 Ribs, stabilizer, 2 risers, 24 suspension lines
- No transforms on canopy meshes — all at identity (unlike pilot models)
- Cell naming: Top_N_L / Bottom_N_L (N=1–7 center→tip)
- Line naming: {a,b,c,d}{2,4,6,8}_{upper,lower} — row × rib × cascade
- LE air intake gap: 0.34 GLB units between top and bottom skin at LE
- Embedded pilot reference at (0, -5.28, -0.08) rot -96.4° (≈ -90° hang - 6.4° trim)
- **3-cell gap found**: Physics has 7 segments (center + 3 pairs) but GLB has 7 cells center-to-tip. Cells 5–7 have no dedicated physics cell — lumped into cell_r3/l3.
- `glbToMeters` (chord-based) = 0.708

## Files Changed
- `MODEL-GEOMETRY.md` — Filled in measurements for all 3 models:
  - tsimwingsuit: exact BBox, mesh structure, scaling values, GLB_TO_NED discrepancy note
  - tslick: full properties, scaling, mesh comparison to wingsuit
  - cp2: complete rewrite of section — cell geometry table, chord geometry, line naming convention, line attachment positions, riser geometry, physical dimensions, GLB→physics cell mapping with 3-cell gap flag
- `tools/glb-measure.js` — New console script for Three.js editor that auto-extracts scene tree, buffer geometry, world-space BBox, derived scaling, and markdown table snippets

## Open Questions / Blockers
- **3-cell gap**: Should the physics model add cells 5–7 (3 more pairs = 6 more segments)? Or is the current 4-group approximation sufficient?
- GLB_TO_NED: Now understood, but needs to be replaced with per-model values in the registry

## Next Steps
- [ ] Measure remaining models: airplane.glb, bridalandpc.gltf, snivel.gltf, bluecrosshp.gltf
- [ ] Decide whether to add physics cells 5–7 for better canopy span resolution
- [ ] Begin Phase 2: extract anchor/hinge points from measured node trees
- [ ] Build geometry registry TypeScript module from all collected measurements
