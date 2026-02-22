# VERIFICATION-FUTURE-WORK.md — Deferred Items

> Collected from completed planning docs (DEPLOYMENT, PILOTPITCH, CP-RENDERING-SCALING, WINGSUIT-SEGMENTS). Do alongside the simulation system / export overhaul.

---

## Physics Verification

- [ ] CP arrows render at correct positions relative to visible canopy mesh
- [ ] CP offsets are proportional across all segments
- [ ] No visual discontinuities when switching between segments
- [ ] Bridle attachment point aligns with riser-to-canopy geometry
- [ ] Verify damping moment arcs during roll rate
- [ ] Mass segment rework for deployment and pilot pitch (positions currently static)

## Tuning

- [ ] Cross-coupling strengths (yaw↔roll) at various dihedral settings
- [ ] Authority magnitudes vs reference data / pilot feel

## Visualization

- [ ] Per-segment velocity arrows (ω×r pipeline supports this)
- [ ] Per-segment force vectors
- [ ] Segment outline debug overlay on wingsuit GLB
