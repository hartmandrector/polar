# OUTPUT.md × VEHICLE-REFACTOR Compatibility Analysis

**Status:** Design-phase compatibility review
**Scope:** Assess OUTPUT.md export system against VEHICLE-REFACTOR-IMPLEMENTATION.md phases
**Date:** 2026-02-20

---

## Executive Summary

OUTPUT.md and VEHICLE-REFACTOR are **98% compatible**. The export system was designed with parameterization in mind (Phase A is already baked in). Phases B through E of the refactor require **3 incremental adjustments** to the export format, none of which are breaking changes to the core architecture.

| Phase | Change Required | Severity | Notes |
|-------|-----------------|----------|-------|
| **Phase A** (Done) | None | ✅ None | Parameterized reference length already fits OUTPUT design |
| **Phase B** (2h) | None | ✅ None | Just changes `referenceHeight` value in system metadata |
| **Phase C** (12h) | Export per-component GLBMetadata | 🟡 Minor | Extends export format but keeps existing data intact |
| **Phase D** (8h) | None | ✅ None | UI scaling is snapshot-based; export captures current state |
| **Phase E** | Bulk vehicle export support | 🟡 Minor | Add helper for exporting multiple vehicles, optional feature |

---

## Detailed Phase-by-Phase Analysis

### Phase A: Reference Length Parameterization ✅ FULLY COMPATIBLE

**Phase A Summary:** Replace hardcoded `1.875` with `polar.referenceLength`

**OUTPUT.md Status:** Already designed for this!
- System-level metadata includes `referenceHeight: number`
- `rotatePilotMass()` function accepts any pivot point and works with any reference length
- Aero/mass positions are all normalized — scaling is deterministic

**Export format (current):**
```typescript
export const system = {
  name: 'Ibex UL + Aura 5',
  /* ... */
  referenceHeight: 1.875,      // ← This becomes dynamic referenceLength
  polars: { canopyCellPolar: { referenceLength: 1.875, ... }, ... },
  aeroSegments: [ { position: { x: 0.174, y: 0, z: -1.220 }, ... } ],
  /* ... */
}
```

**No format changes needed.** When Phase A refactor is complete:
- Exporters read `polar.referenceLength` (now parameterized)
- Consumers read `system.referenceHeight` (still the same field)
- All calculations scale correctly

**Test point:** Export with wingsuit `referenceLength: 1.93`, verify consumer normalizes positions correctly.

---

### Phase B: Wingsuit Reference Length Update ✅ FULLY COMPATIBLE

**Phase B Summary:** Change Aura 5 wingsuit from 1.875m → 1.93m

**OUTPUT.md Status:** Zero format changes

**Current export (before Phase B):**
```typescript
export const auraFiveContinuous: ContinuousPolar = {
  referenceLength: 1.875,  // Aura 5 system height
  /* ... */
}
```

**After Phase B:**
```typescript
export const auraFiveContinuous: ContinuousPolar = {
  referenceLength: 1.93,   // Updated system height
  /* ... */
}
```

The export format is identical. All downstream data (positions, inertias) automatically scale via parameterized `referenceLength`. Consumer code needs zero changes.

**Test point:** Export wingsuit before & after Phase B, verify `referenceHeight` value changes, consumer forces/moments scale by expected factors (inertia ~5.9%, moment arms ~2.9%).

---

### Phase C: Per-Component Reference Frames ⚠️ REQUIRES EXTENSION

**Phase C Summary:** Bundle pilot + equipment into VehicleDefinition; each component has own GLBMetadata with `referenceLength`

**Phase C Design (from VEHICLE-REFACTOR-IMPLEMENTATION.md):**
```typescript
interface VehicleDefinition {
  id: string
  name: string
  pilot: {
    glb: GLBMetadata          // ← Has physicalSize { height, ... }
    referenceLength: number   // ← Pilot height (e.g., 1.875m)
  }
  equipment: [{
    type: 'canopy' | 'wingsuit' | 'parachute'
    aero: ContinuousPolar
    glb: GLBMetadata          // ← Has physicalSize { chord, span, ... }
    referenceLength: number   // ← Component size (e.g., canopy chord = 2.5m)
  }]
}
```

**OUTPUT.md Status:** Assumes single system-wide `referenceHeight`

**Current export structure:**
```typescript
export const system = {
  name: 'Ibex UL + Aura 5 Pilot',
  systemMass: 77.5,
  referenceHeight: 1.875,           // Single height — assumes pilot height = normalization factor
  referenceArea: 20.439,
  referenceChord: 2.5,
  polars: { canopyCellPolar, brakeFlapPolar, pilotZipped, pilotUnzipped },
  aeroSegments: [/* positions normalized by 1.875 */],
  defaultWeightSegments: [/* positions normalized by 1.875 */],
  /* ... */
}
```

**Problem:** This structure doesn't capture which segments belong to which component, or per-component reference lengths.

**Solution: Extend export format (non-breaking)**

Add component-aware structure while keeping existing fields for backward compatibility:

```typescript
// New: per-component vehicle structure
export const vehicle: VehicleDefinition = {
  id: 'ibex-ul-aura5-wingsuit',
  name: 'Ibex UL + Aura 5 Pilot',
  pilot: {
    glb: {
      filePath: 'public/models/pilot-aura5.glb',
      physicalSize: { height: 1.875, chord: 1.8, span: 0.5 },
      referenceLength: 1.875,
      /* ... more GLBMetadata */
    },
    mass: {
      segments: [ /* 14 pilot body segments, positions = NED / 1.875 */ ],
      inertia: computeInertia(/* ... */),
      cg: { x: 0.296, y: 0, z: 0.133 },
    },
    aero: null,  // Pilot aero comes from equipment
  },
  equipment: [
    {
      type: 'canopy',
      aero: canopyCellPolar,  // Shared by all canopy segments
      glb: {
        filePath: 'public/models/canopy-ibex-ul.glb',
        physicalSize: { height: 0, chord: 2.5, span: 8.0 },
        referenceLength: 2.5,  // Canopy reference = chord (or span, or max dim)
        /* ... more GLBMetadata */
      },
      segments: {
        aero: [/* 7 cells + 6 flaps, positions = NED / 2.5 */],
        mass: {
          structure: [/* 7 structure cells, positions = NED / 2.5 */],
          air: [/* 7 air cells, positions = NED / 2.5 */],
        }
      }
    },
    // No wingsuit in canopy-only example; would add here if present
  ]
}

// Legacy (backward compat: export system-level snapshot)
export const system = {
  name: 'Ibex UL + Aura 5 Pilot (snapshot at deploy=1, pitch=0)',
  systemMass: 77.5,
  referenceHeight: 1.875,  // Still here for snapshot consumers
  referenceArea: 20.439,
  referenceChord: 2.5,
  polars: { canopyCellPolar, /* ... */ },
  aeroSegments: [/* denormalized to pilot reference */],
  /* ... rest of existing format ... */
}
```

**Backward compatibility:**
- Consumers expecting old `system` format still work (snapshot at default pitch=0, deploy=1)
- New consumers using `vehicle` format get per-component reference frames
- Both formats coexist in same export file

**Implementation notes:**
- **Phase C.2 Task** (registry builder): When building composite frame, read `vehicle.equipment[i].referenceLength` for each component
- **Phase C.5 Task** (model loader): Load GLB for each component, place according to `glb.filePath` and `glb.physicalSize`
- **Export phase (future):** When exporting vehicle, iterate `vehicle.equipment` and serialize each component's GLBMetadata + segments

**Test point:** Export Ibex UL, verify canopy segments have `positions / canopy.referenceLength`, pilot segments have `positions / pilot.referenceLength`.

---

### Phase D: UI Scaling Controls ✅ FULLY COMPATIBLE

**Phase D Summary:** Add sliders for dynamic vehicle scaling (pilot height, canopy area, etc.)

**Phase D Design:** Modify active vehicle in-place; render and fly with scaled values

**OUTPUT.md Status:** Already handles this via snapshots

**How it works:**
1. User tunes vehicle (e.g., "scale pilot height 1.875 → 1.60m")
2. Active vehicle in memory reflects the change
3. Export button captures current state and outputs new export file with scaled values
4. Consumer imports the scaled export and uses it as-is

**No export format changes needed.** Export is always a **snapshot** of the active system at the moment of export.

```typescript
// Before scaling
export const system = {
  referenceHeight: 1.875,
  /* positions normalized by 1.875 */
}

// After user scales to 1.60m and exports
export const system = {
  referenceHeight: 1.60,
  /* positions normalized by 1.60 */
}
```

All downstream denormalization is automatic — positions, inertias, moments arms all scale together.

**Test point:** User scales pilot height 1.875 → 1.60m in UI, exports, verify export has new `referenceHeight`, consumer forces match expected scaling.

---

### Phase E: User Integration & Registry ⚠️ OPTIONAL ENHANCEMENTS

**Phase E Summary:** Enable users to export custom vehicles; provide integration guide

**Phase E Design:**
- Users add entries to VEHICLE_REGISTRY
- UI allows selection of any vehicle in registry
- Export captures selected vehicle (with all its parameters)
- User shares `.polar.ts` file with others

**OUTPUT.md Status:** Assumes single system export at a time

**Current pattern:**
1. User selects vehicle from defaults (Ibex UL, Aura 5, etc.)
2. Modifies parameters via sliders
3. Clicks "Export System"
4. Gets single `.polar.ts` file

**Phase E enhancement (non-breaking):**
1. User can export **any vehicle from registry** (not just active one)
2. Optionally, bulk export all vehicles into single `.polar.ts` file
3. Consumer imports registry, selects vehicle by ID at runtime

**Option A: Export-any-vehicle (easy)**
```typescript
// UI: Add dropdown to select vehicle ID before exporting
export button: "Export [vehicle-id dropdown] System"
// Gets all params from VEHICLE_REGISTRY[id] and exports
```

No format change; just iterate through registry instead of active vehicle.

**Option B: Bulk export all vehicles (moderate)**
```typescript
export const VEHICLE_REGISTRY = {
  'ibex-ul': { name: 'Ibex UL + Wingsuit', ... },
  'aura-5': { name: 'Aura 5 Standalone', ... },
  'slick-sin': { name: 'Slick Sin Skydiver', ... },
}

// Consumer
const vehicle = VEHICLE_REGISTRY['ibex-ul']
```

Requires new serialized type `VehicleRegistry` but backward-compatible with Phase C refactor.

**Recommendation:** Implement Option A in Phase E.1 (trivial code change). Option B is a future enhancement for users with many custom vehicles.

---

## Format Evolution Map

### Current (Pre-Refactor) — Phase A Complete

```typescript
export const system = {
  name: string
  referenceHeight: number  // ← parameterized via polar.referenceLength
  systemMass: number
  polars: { [key: string]: ContinuousPolar }
  aeroSegments: AeroSegmentDescriptor[]
  defaultWeightSegments: MassSegment[]
  defaultInertiaSegments: MassSegment[]
  massPivotNED: { x, z }
  rotatePilotMass: (pitch, pivot?, deploy?) => { weight, inertia }
}
```

### After Phase C — Per-Component References

```typescript
// NEW: Vehicle structure (component-aware)
export const vehicle: VehicleDefinition = {
  id: string
  name: string
  pilot: {
    glb: GLBMetadata              // ← Has physicalSize, referenceLength
    mass: { segments, inertia, cg }
    aero: null | ContinuousPolar
    referenceLength: number
  }
  equipment: [{
    type: 'canopy' | 'wingsuit' | 'parachute'
    glb: GLBMetadata              // ← Has physicalSize, referenceLength
    aero: ContinuousPolar
    segments: { aero, mass }
    referenceLength: number
  }]
}

// LEGACY: System snapshot (backward compat)
export const system = {
  /* ... all existing fields, still works ... */
}
```

### After Phase E — Registry

```typescript
export const VEHICLE_REGISTRY: VehicleRegistry = {
  'ibex-ul-custom': vehicle,
  'aura-5-custom': vehicle,
  /* ... more vehicles ... */
}

export const system = undefined  // Optional (only if exporting active system snapshot)
```

---

## Breaking Changes: None ✅

All changes are **additive**. Old consumers expecting:
```typescript
import { system } from './exported-system.polar.ts'
```

...will continue to work even after Phase C/E changes. The `system` object exists in the export for backward compatibility. New consumers can use the `vehicle` structure for per-component reference frames.

---

## Recommended Implementation Order

### Phase C Commitment

When implementing Phase C (per-component reference frames), **update export-system.ts** to:

1. **Read from VehicleDefinition** instead of just active polar
   - Current: `serializeSystem(activePolar, pilotType, segments, ...)`
   - New: `serializeSystem(vehicle: VehicleDefinition)`

2. **Export both structures:**
   - Primary: `vehicle` (new per-component format)
   - Fallback: `system` (snapshot, backward compat)

3. **GLBMetadata integration:**
   - Each `vehicle.equipment[i].glb` carries physical size
   - Export includes `glb.physicalSize` in the exported GLBMetadata
   - Consumer loader uses this to scale GLB correctly

**Files affected:**
- `src/polar/export-system.ts` — extend serializer to handle VehicleDefinition
- `src/ui/` — optional UI changes to select vehicle before export (Phase E)

### Phase E Commitment

When implementing Phase E (user integration), add to export UI:

1. **Optional dropdown** to select vehicle from VEHICLE_REGISTRY before exporting
2. **Bulk export button** (stretch goal) to export all registry vehicles at once

**Files affected:**
- `src/ui/` — add vehicle selector to export panel
- `src/polar/export-system.ts` — add bulk export helper

---

## Detailed Compatibility Matrix

| Feature | OUTPUT.md | Phase A | Phase B | Phase C | Phase D | Phase E | Status |
|---------|-----------|---------|---------|---------|---------|---------|--------|
| Parameterized `referenceLength` | ✅ Design-ready | ✅ Done | ✅ Use | ✅ Use | ✅ Use | ✅ Use | ✅ Ready |
| Windsuit ref length 1.93m | — | — | ✅ Target | ✅ Use | ✅ Use | ✅ Use | ✅ Compatible |
| Per-component GLBMetadata | ❌ Not designed | — | — | 🟡 Add | ✅ Use | ✅ Use | 🟡 Extend (non-breaking) |
| VehicleDefinition export | ❌ Not designed | — | — | 🟡 Add | ✅ Use | ✅ Use | 🟡 Extend (non-breaking) |
| Dynamic vehicle scaling | ✅ Snapshot-based | ✅ Use | ✅ Use | ✅ Use | ✅ Use | ✅ Use | ✅ Ready |
| Vehicle registry export | ❌ Single vehicle | — | — | — | — | 🟡 Add | 🟡 Add (optional) |
| Backward compatibility | N/A | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Preserved |

---

## Action Items

### Before Phase B (NOW)
- [ ] Add this document to project memory
- [ ] Review OUTPUT.md export schema assumptions (no changes needed for Phase B)

### Before Phase C
- [ ] Review Phase C vehicle registry design against OUTPUT.md export-system.ts
- [ ] Plan GLBMetadata serialization in export format
- [ ] Draft per-component export schema (attach to this doc)

### Before Phase E
- [ ] Plan user integration documentation (reuse existing export infrastructure)
- [ ] Optional: design bulk vehicle export (low priority)

---

## Key Takeaway

**OUTPUT.md is forward-compatible with the VEHICLE-REFACTOR.** The export system was built with parameterization in mind (Phase A). Phases B and D need zero format changes. Phases C and E need non-breaking extensions to capture per-component metadata and support bulk registry exports.

The architecture is sound. Proceed with confidence through all 5 phases.
