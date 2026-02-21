# PIVOT-CONSOLIDATION.md — Registry Cleanup

> Consolidate pivot/assembly values into `VehicleDefinition`.

Currently `parentScale`, `childScale`, `shoulderOffsetFraction`, and
`trimAngleDeg` live in `VehicleAssembly` (model-registry.ts), while
`PILOT_PIVOT_X/Z` live in `polar-data.ts` and the pivot group is
created in `model-loader.ts`. Three files, one concept.

**Plan:** Move all pivot-related values into `VehicleDefinition` in
`vehicle-registry.ts` so the assembly junction is defined in one place:

```typescript
interface VehicleDefinition {
  // ... existing fields ...
  pivot: {
    trimAngleDeg: number          // forward lean (currently 6°)
    shoulderOffsetFraction: number // riser-to-shoulder distance (normalized)
    pivotX: number                // NED x of riser attachment
    pivotZ: number                // NED z of riser attachment
    childParentRatio: number      // childScale / parentScale (slider default)
  }
}
```

Physics (`polar-data.ts`) and rendering (`model-loader.ts`) both read
from this single source. The pivot junction slider writes to it.
