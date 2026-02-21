# VEHICLE-SCALING-PLAN.md — Independent Component Scaling

> **Status:** Planning
> **Prerequisite:** Phases A–C complete (see [reference docs](docs/reference/))

---

## Summary

We have working coupled canopy+aero scaling via a single slider. The next step
is to add the same for the pilot, then a pivot junction control.

**Two new slider systems needed:**

1. **Pilot scaling** — height slider that couples pilot GLB mesh + pilot aero
   (reference length, mass positions, segment areas) — same pattern as the
   existing canopy slider.

2. **Pivot junction** — controls the scaling ratio between pilot and canopy
   at the riser attachment. Adjusts pendulum length and connection geometry
   so incoming GLB models with different proportions assemble correctly.

## What's Done

- ✅ Canopy area slider — scales canopy GLB + aero (`S`, `chord`, positions) together
- ✅ `referenceLength` on every polar (Phase A)
- ✅ Wingsuit aero reference corrected to 1.93m (Phase B)
- ✅ Per-component reference via `getVehicleMassReference()` (Phase C)
- ✅ Debug panel with aero verification readout

## What's Left

- [ ] Pilot height slider (see [SCALING-SLIDERS.md](SCALING-SLIDERS.md))
- [ ] Pivot junction slider (see [SCALING-SLIDERS.md](SCALING-SLIDERS.md))
- [ ] Physics verification for combined scaling (force/moment stability)
- [ ] Loose ends from Phase C: some `Ambiguous` mass-vs-aero sites in vectors.ts
      and mass-overlay.ts ([audit table](docs/reference/VEHICLE-REFACTOR-IMPLEMENTATION.md#reference-audit-pass-phase-b-kickoff))
- [ ] Export compatibility with scaled vehicles
      ([compatibility doc](docs/reference/OUTPUT-REFACTOR-COMPATIBILITY.md))

## Reference Documents

| Doc | Location | What's There |
|-----|----------|-------------|
| Vehicle Refactor (architecture) | [docs/reference/VEHICLE-REFACTOR.md](docs/reference/VEHICLE-REFACTOR.md) | Full decoupling design, VehicleDefinition, registry pattern |
| Vehicle Refactor (implementation) | [docs/reference/VEHICLE-REFACTOR-IMPLEMENTATION.md](docs/reference/VEHICLE-REFACTOR-IMPLEMENTATION.md) | Phase D tasks, code locations, test plan |
| Output Compatibility | [docs/reference/OUTPUT-REFACTOR-COMPATIBILITY.md](docs/reference/OUTPUT-REFACTOR-COMPATIBILITY.md) | How scaling interacts with CloudBASE export |
| Reference Length | [REFERENCE-LENGTH.md](REFERENCE-LENGTH.md) | Normalization history, constants inventory, Phase A–C status |
| Scaling Sliders (detail) | [SCALING-SLIDERS.md](SCALING-SLIDERS.md) | Pilot slider + pivot slider design |
| Pivot Consolidation | [PIVOT-CONSOLIDATION.md](PIVOT-CONSOLIDATION.md) | Move all pivot/assembly values into VehicleDefinition |
