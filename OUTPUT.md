# OUTPUT — System Export Planning Document

## Goal

Design and implement an **export system** that serializes the complete active flight system — polar definitions, aero segments, mass distributions, control mappings, and physical constants — into a single self-contained TypeScript file that can be dropped into any project (e.g. CloudBASE) and used immediately via a simple import.

---

## Current Architecture Audit

### Data Layers

The polar visualizer's flight model is organized in four distinct layers. The export must capture all of them.

| Layer | What it contains | Where it lives today |
|-------|------------------|---------------------|
| **1. Polar definitions** | `ContinuousPolar` objects — aerodynamic coefficients, stall, drag, moment, CP parameters | `polar-data.ts` (top-level consts like `aurafiveContinuous`, `CANOPY_CELL_POLAR`, `BRAKE_FLAP_POLAR`) |
| **2. Aero segments** | `AeroSegment[]` — per-panel positions, orientations, S, chord, polar reference, `getCoeffs()` closures | Built by factory functions in `segment-factories.ts`, assembled in `polar-data.ts` (`IBEX_CANOPY_SEGMENTS`, `makeIbexAeroSegments()`) |
| **3. Mass segments** | `MassSegment[]` — point masses with normalized NED positions, mass ratios | `polar-data.ts` (`WINGSUIT_MASS_SEGMENTS`, `CANOPY_PILOT_SEGMENTS`, `CANOPY_STRUCTURE_SEGMENTS`, `CANOPY_AIR_SEGMENTS`) |
| **4. Controls** | `SegmentControls` interface + `SymmetricControl` derivatives on each polar, brake/riser routing logic in factories | `continuous-polar.ts` (types), `segment-factories.ts` (routing), `polar-data.ts` (derivative values) |

### Normalization Convention

All positions (both mass and aero) use a **height-normalized NED body frame**:
- Divide physical coordinates by a reference height (currently 1.875 m for canopy system)
- `x` = forward (North), `y` = right (East), `z` = down
- Mass ratios are fractions of `polar.m` (total system mass)
- Aero segment `S` and `chord` are in physical units (m², m)

This convention is already consistent across the codebase — no changes needed.

### Segment Types

The system uses **5 factory functions** to create aero segments:

| Factory | Segment Type | Count (Ibex) | Description |
|---------|-------------|--------------|-------------|
| `makeCanopyCellSegment()` | Canopy cell | 7 | Kirchhoff polar with local flow transform, brake→δ, riser→Δα |
| `makeBrakeFlapSegment()` | Brake flap | 6 | Variable-area trailing edge with dynamic roll, lift-vector tilt |
| `makeParasiticSegment()` | Parasitic body | 2 | Constant CD (lines, pilot chute) |
| `makeLiftingBodySegment()` | Lifting body | 0–1 | Full Kirchhoff polar (slick pilot) |
| `makeUnzippablePilotSegment()` | Unzippable pilot | 0–1 | Blends between two polars via `controls.unzip` |

### What Gets Computed at Runtime (NOT exported)

- `getCoeffs()` closures — these are **behavior**, created by factories from data
- `getAllCoefficients()` — the Kirchhoff evaluation engine
- `computeSegmentForce()` / `sumAllSegments()` — force summation
- Wind frame computation, inertia tensor
- UI state (`FlightState`)

---

## The Active System — What to Export

When a user has "Ibex UL + Wingsuit Pilot" selected, the active system consists of:

### 1. System-Level Metadata

```typescript
{
  name: "Ibex UL + Aura 5 Pilot",
  type: "Canopy",
  systemMass: 77.5,          // kg — total
  referenceHeight: 1.875,    // m — normalization factor
  referenceArea: 20.439,     // m² — system-level S
  referenceChord: 2.5,       // m — system-level chord (cell chord)
}
```

### 2. Polar Definitions (Pure Data)

Every unique `ContinuousPolar` used by the system. For the canopy system this is:

| Polar | Used by | Scope |
|-------|---------|-------|
| `CANOPY_CELL_POLAR` | 7 cell segments | Shared reference — all cells use the same base polar |
| `BRAKE_FLAP_POLAR` | 6 flap segments | Shared reference |
| `aurafiveContinuous` | Pilot (zipped state) | Standalone polar |
| `slicksinContinuous` | Pilot (unzipped state) | Standalone polar |

The polars include their `controls` (SymmetricControl derivatives), so brake/riser morphing is fully captured.

### 3. Aero Segment Descriptors (Data Only — No Closures)

Each segment needs enough data for a factory to reconstruct its `getCoeffs()`:

```typescript
interface AeroSegmentDescriptor {
  name: string
  type: 'canopy-cell' | 'brake-flap' | 'parasitic' | 'lifting-body' | 'unzippable-pilot'
  position: { x: number; y: number; z: number }  // NED normalized

  // Type-specific parameters
  // canopy-cell:
  rollDeg?: number
  side?: 'left' | 'right' | 'center'
  brakeSensitivity?: number
  riserSensitivity?: number
  polarRef?: string  // key into the polars dict (e.g. 'canopyCellPolar')

  // brake-flap:
  flapChordFraction?: number
  parentCellS?: number
  parentCellChord?: number

  // parasitic:
  S?: number
  chord?: number
  cd?: number
  cl?: number
  cy?: number

  // lifting-body / unzippable-pilot:
  pitchOffset_deg?: number
  zippedPolarRef?: string
  unzippedPolarRef?: string
}
```

### 4. Mass Segment Arrays

Three mass arrays, each as `MassSegment[]`:

| Array | Purpose | Segments |
|-------|---------|----------|
| **Weight segments** | Gravitational force (m·g) | Pilot body (14) + canopy structure (7) = 21 |
| **Inertia segments** | Rotational inertia (I·α) | Weight segments + canopy air (7) = 28 |
| **Pilot body only** | For standalone pilot export | 14 body segments |

### 5. Control Mapping

How UI inputs route to segment controls:

```typescript
interface ControlMapping {
  // Which SegmentControls fields the system uses
  activeControls: string[]   // e.g. ['brakeLeft', 'brakeRight', 'frontRiserLeft', ...]

  // Constants that govern control routing
  constants: {
    MAX_FLAP_DEFLECTION_DEG: number     // 50
    MAX_FLAP_ROLL_INCREMENT_DEG: number // 20
    BRAKE_ALPHA_COUPLING_DEG: number    // 2.5
    ALPHA_MAX_RISER: number             // 10
  }
}
```

### 6. System Polar (Lumped Summary)

The `ibexulContinuous` object — the system-level lumped polar used for chart overlays and quick single-body evaluation. This is what the legacy comparison runs against.

---

## Export Format: TypeScript Module

### Why TypeScript (not JSON or CSV)

| Format | Pros | Cons |
|--------|------|------|
| **JSON** | Universal, parseable anywhere | No types, no comments, can't embed formulas |
| **CSV** | Simple for tabular data | Can't represent nested structures, no types |
| **.ts module** | **Types built-in, self-documenting, directly importable, IDE support, can include doc comments** | **Requires TS/JS consumer** |

Since the primary consumer is CloudBASE (TypeScript), and the data is deeply nested with rich type information, a **TypeScript module** is the clear winner.

### Proposed File Structure

```typescript
/**
 * Auto-generated system export from Polar Visualizer
 * 
 * System: Ibex UL + Aura 5 Pilot (Wingsuit)
 * Generated: 2026-02-15T12:00:00Z
 * 
 * This file is self-contained. Import and pass to the flight model:
 *   import { system } from './ibex-ul-wingsuit.polar.ts'
 */

import type { ContinuousPolar, MassSegment, SymmetricControl } from './continuous-polar'

// ═══════════════════════════════════════════════════════════════════════════
// 1. POLAR DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export const canopyCellPolar: ContinuousPolar = {
  name: 'Ibex UL Cell',
  type: 'Canopy',
  cl_alpha: 3.0,
  alpha_0: -3,
  // ... all fields
}

export const brakeFlapPolar: ContinuousPolar = { /* ... */ }
export const pilotZippedPolar: ContinuousPolar = { /* ... */ }
export const pilotUnzippedPolar: ContinuousPolar = { /* ... */ }
export const systemPolar: ContinuousPolar = { /* ... lumped ibexulContinuous ... */ }

// ═══════════════════════════════════════════════════════════════════════════
// 2. AERO SEGMENT DESCRIPTORS
// ═══════════════════════════════════════════════════════════════════════════

export interface AeroSegmentDescriptor { /* ... */ }

export const aeroSegments: AeroSegmentDescriptor[] = [
  // 7 canopy cells
  { name: 'cell_c',  type: 'canopy-cell', position: { x: 0.174, y: 0, z: -1.220 }, rollDeg: 0,  side: 'center', brakeSensitivity: 0,   riserSensitivity: 1.0, polarRef: 'canopyCellPolar' },
  { name: 'cell_r1', type: 'canopy-cell', position: { x: 0.170, y: 0.358, z: -1.182 }, rollDeg: 12, side: 'right', brakeSensitivity: 0.4, riserSensitivity: 1.0, polarRef: 'canopyCellPolar' },
  // ... etc
  
  // 6 brake flaps
  { name: 'flap_r1', type: 'brake-flap', position: { x: -0.664, y: 0.358, z: -1.162 }, rollDeg: 12, side: 'right', brakeSensitivity: 0.4, flapChordFraction: 0.10, parentCellS: 2.92, parentCellChord: 2.5, polarRef: 'brakeFlapPolar' },
  // ... etc
  
  // 2 parasitic
  { name: 'lines', type: 'parasitic', position: { x: 0.23, y: 0, z: -0.40 }, S: 0.35, chord: 0.01, cd: 1.0 },
  { name: 'pc',    type: 'parasitic', position: { x: 0.10, y: 0, z: -1.30 }, S: 0.732, chord: 0.01, cd: 1.0 },
  
  // 1 pilot
  { name: 'pilot', type: 'unzippable-pilot', position: { x: 0.38, y: 0, z: 0.48 }, pitchOffset_deg: 90, zippedPolarRef: 'pilotZippedPolar', unzippedPolarRef: 'pilotUnzippedPolar' },
]

// ═══════════════════════════════════════════════════════════════════════════
// 3. MASS SEGMENTS
// ═══════════════════════════════════════════════════════════════════════════

export const weightSegments: MassSegment[] = [ /* pilot body + canopy structure */ ]
export const inertiaSegments: MassSegment[] = [ /* weight + canopy air */ ]

// ═══════════════════════════════════════════════════════════════════════════
// 4. CONTROL CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const controlConstants = {
  MAX_FLAP_DEFLECTION_DEG: 50,
  MAX_FLAP_ROLL_INCREMENT_DEG: 20,
  BRAKE_ALPHA_COUPLING_DEG: 2.5,
  ALPHA_MAX_RISER: 10,
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. SYSTEM BUNDLE
// ═══════════════════════════════════════════════════════════════════════════

export const system = {
  name: 'Ibex UL + Aura 5 Pilot (Wingsuit)',
  type: 'Canopy' as const,
  generatedAt: '2026-02-15T12:00:00Z',
  systemMass: 77.5,
  referenceHeight: 1.875,

  polars: {
    canopyCellPolar,
    brakeFlapPolar,
    pilotZippedPolar,
    pilotUnzippedPolar,
    systemPolar,
  },

  aeroSegments,
  weightSegments,
  inertiaSegments,
  controlConstants,
}
```

---

## Import-Side Reconstruction

The consumer project needs the **factory functions** and the **Kirchhoff engine** to bring the exported data back to life. These are small, UI-independent modules that are already designed for portability:

### Files to Copy into Consumer Project

| File | Size | Purpose |
|------|------|---------|
| `continuous-polar.ts` | ~275 lines | Type definitions (`ContinuousPolar`, `AeroSegment`, `SegmentControls`, `MassSegment`) |
| `kirchhoff.ts` | ~100 lines | Separation function, flat-plate models |
| `coefficients.ts` | ~370 lines | `getAllCoefficients()`, delta morphing, `lerpPolar()` |
| `aero-segment.ts` | ~250 lines | `computeSegmentForce()`, `sumAllSegments()`, wind frame |
| `segment-factories.ts` | ~440 lines | Factory functions to rebuild `getCoeffs()` closures |
| `inertia.ts` | ~120 lines | Inertia tensor, center of mass |

These 6 files form the **polar engine** — already marked "UI-independent" in their headers.

### Reconstruction Flow

```
Exported .ts file (pure data)
       │
       ▼
Consumer imports `system` object
       │
       ▼
For each AeroSegmentDescriptor:
  → Look up polarRef in system.polars
  → Call appropriate factory (makeCanopyCellSegment, etc.)
  → Returns live AeroSegment with getCoeffs() closure
       │
       ▼
Pass AeroSegment[] to sumAllSegments()
  → Full per-segment force computation
  → System-level forces and moments at CG
```

A helper function `rebuildSegments(system)` would automate this:

```typescript
function rebuildSegments(system: ExportedSystem): AeroSegment[] {
  return system.aeroSegments.map(desc => {
    const polar = system.polars[desc.polarRef!]
    switch (desc.type) {
      case 'canopy-cell':
        return makeCanopyCellSegment(desc.name, desc.position, desc.rollDeg!, desc.side!, desc.brakeSensitivity!, desc.riserSensitivity!, polar)
      case 'brake-flap':
        return makeBrakeFlapSegment(desc.name, desc.position, desc.rollDeg!, desc.side! as 'left'|'right', desc.brakeSensitivity!, desc.flapChordFraction!, desc.parentCellS!, desc.parentCellChord!, polar)
      case 'parasitic':
        return makeParasiticSegment(desc.name, desc.position, desc.S!, desc.chord!, desc.cd!, desc.cl, desc.cy)
      case 'lifting-body':
        return makeLiftingBodySegment(desc.name, desc.position, polar, desc.pitchOffset_deg)
      case 'unzippable-pilot':
        return makeUnzippablePilotSegment(desc.name, desc.position, system.polars[desc.zippedPolarRef!], system.polars[desc.unzippedPolarRef!], desc.pitchOffset_deg)
    }
  })
}
```

---

## UI Integration — Where the Export Button Goes

### Location

Below the debug overrides panel, or in a new **Export** section at the bottom of the sidebar:

```
┌──────────────────────────────┐
│  [Model: Ibex UL]            │
│  [Pilot: Wingsuit]           │
│  ────────────────────────    │
│  AOA  ═══════●═══════ 12°   │
│  Beta ═══════●═══════  0°   │
│  ...                         │
│  ────────────────────────    │
│  Debug Overrides             │
│  ...                         │
│  ════════════════════════    │
│  Export System                │
│  ┌────────────────────────┐  │
│  │  📋 Copy to Clipboard  │  │
│  │  💾 Download .ts File  │  │
│  └────────────────────────┘  │
│  Filename: ibex-ul-wingsuit  │
└──────────────────────────────┘
```

### Export Actions

1. **Copy to Clipboard** — Generates the TS source and copies to clipboard
2. **Download .ts File** — Triggers a browser download of the file

### Filename Convention

`{polar-key}-{pilot-type}.polar.ts`

Examples:
- `ibex-ul-wingsuit.polar.ts`
- `ibex-ul-slick.polar.ts`
- `aura-5.polar.ts` (standalone wingsuit, no canopy segments)

---

## Implementation Plan

### Phase 1: Define the Export Schema

- [ ] Create `src/polar/export-schema.ts` with serializable interfaces:
  - `ExportedSystem` — the top-level bundle
  - `AeroSegmentDescriptor` — data-only segment representation
  - `ExportedControlConstants` — routing constants
- [ ] Add `polarRef` string keys to link segments to their polars
- [ ] Add a `rebuildSegments()` function that reconstructs live `AeroSegment[]` from descriptors

### Phase 2: Build the Serializer

- [ ] Create `src/polar/export-system.ts`:
  - `serializeSystem(polar, pilotType, segments, massWeights, massInertia)` → `ExportedSystem`
  - Walks the active polar + segments, extracts all unique polars, assigns ref keys
  - Serializes positions, orientations, sensitivities — everything the factory needs
  - Outputs a clean `ExportedSystem` object (JSON-serializable)
- [ ] Create `generateTypeScriptSource(system: ExportedSystem)` → `string`:
  - Renders the system as a formatted TypeScript module
  - Includes JSDoc header with system name, generation timestamp
  - Organizes into labeled sections (polars, segments, mass, controls, bundle)
  - Uses the `ContinuousPolar` and `MassSegment` type imports

### Phase 3: UI Integration

- [ ] Add "Export System" section to `index.html` (below debug overrides)
- [ ] Add "Copy to Clipboard" button → calls serializer, copies TS source
- [ ] Add "Download .ts File" button → triggers browser download
- [ ] Auto-generate filename from active polar key + pilot type
- [ ] Show brief "Copied!" / "Downloaded!" feedback toast

### Phase 4: Import-Side Helper

- [ ] Create `src/polar/import-system.ts`:
  - `rebuildSegments(system: ExportedSystem)` → `AeroSegment[]`
  - Maps each `AeroSegmentDescriptor` back through the correct factory
  - Resolves `polarRef` strings to actual `ContinuousPolar` objects from the bundle
- [ ] Add round-trip test: export → import → compare forces at several α/β/δ points

### Phase 5: Testing

- [ ] Unit test: serialize the Ibex UL system, verify all 16 segments present
- [ ] Unit test: generated TS source is syntactically valid (parse with TS compiler API or regex check)
- [ ] Round-trip test: export → `rebuildSegments()` → `sumAllSegments()` → compare forces with original
- [ ] Verify mass segment totals: weight ratios sum correctly, positions match

---

## Resolved Questions

### Q1: Legacy polar data — EXCLUDED

Legacy `WSEQPolar` tables are only for chart overlay comparison, not part of the flight model. The consumer project already has them if needed. **Do not include in export.**

### Q2: Polars inlined vs referenced — OPTION B (Reference)

Polars are defined once at the top of the export file, segments reference them by string key via `polarRef`. No redundant copies. The canopy system needs 4 unique polars: `canopyCellPolar`, `brakeFlapPolar`, `pilotZippedPolar`, `pilotUnzippedPolar`. Both pilot polars must be exported for the unzip system to work.

### Q3: System-level lumped polar — INCLUDED

Include as `systemPolar` for convenience. Useful for simplified single-body calculations or chart overlays without running the full segment loop.

### Q4: Control constants — EXPORTED (requires code change)

Control constants (`MAX_FLAP_DEFLECTION_DEG`, `MAX_FLAP_ROLL_INCREMENT_DEG`, `BRAKE_ALPHA_COUPLING_DEG`, `ALPHA_MAX_RISER`) must be exported with the system data so different vehicles can have different values.

**This requires a code change:** the factory functions in `segment-factories.ts` currently use module-level `const` values. They need to be refactored to accept these as parameters instead. See [Q4 Code Changes](#q4-code-changes---factory-parameter-refactor) below.

### Q5: `getCoeffs()` closures — DESCRIPTOR + FACTORY

Already solved by the `AeroSegmentDescriptor` + factory approach. The descriptor stores data; the factory creates behavior. No closures in the export file.

### Q6: Type imports — OPTION A (relative import)

The generated `.ts` file includes an import statement for types from the polar engine. The consumer already needs the engine files (kirchhoff, coefficients, segment-factories), so one type import is trivial.

### Q7: Debug overrides — YES, export effective values

Export the **effective** (post-override) values, not the base values. The export is a snapshot of the active system state.

---

## Q4 Code Changes — Factory Parameter Refactor

Currently 4 constants are hardcoded as module-level `const` values in `segment-factories.ts`:

```typescript
// segment-factories.ts — CURRENT (module-level constants)
const ALPHA_MAX_RISER = 10
const BRAKE_ALPHA_COUPLING_DEG = 2.5
const MAX_FLAP_DEFLECTION_DEG = 50
const MAX_FLAP_ROLL_INCREMENT_DEG = 20
```

These are used inside `getCoeffs()` closures, so they're captured at factory-call time.

### What needs to change

**1. Define a `ControlConstants` interface** (in `continuous-polar.ts` or `segment-factories.ts`):

```typescript
export interface ControlConstants {
  ALPHA_MAX_RISER: number              // Max α change from full riser input [deg]
  BRAKE_ALPHA_COUPLING_DEG: number     // Brake → α cross-coupling [deg per unit]
  MAX_FLAP_DEFLECTION_DEG: number      // Max TE deflection at full brake [deg]
  MAX_FLAP_ROLL_INCREMENT_DEG: number  // Max additional arc roll at full brake [deg]
}
```

**2. Add `constants` parameter to factory functions:**

```typescript
// BEFORE:
export function makeCanopyCellSegment(
  name, position, rollDeg, side, brakeSensitivity, riserSensitivity, cellPolar
)

// AFTER:
export function makeCanopyCellSegment(
  name, position, rollDeg, side, brakeSensitivity, riserSensitivity, cellPolar,
  constants?: ControlConstants  // optional — defaults to current values
)
```

Same for `makeBrakeFlapSegment()`.

**3. Default values for backward compatibility:**

```typescript
const DEFAULT_CONSTANTS: ControlConstants = {
  ALPHA_MAX_RISER: 10,
  BRAKE_ALPHA_COUPLING_DEG: 2.5,
  MAX_FLAP_DEFLECTION_DEG: 50,
  MAX_FLAP_ROLL_INCREMENT_DEG: 20,
}
```

Existing call sites (in `polar-data.ts`) don't pass `constants`, so they get the defaults — **zero breaking changes**.

**4. Closures use the parameter:**

Inside `getCoeffs()`, replace `ALPHA_MAX_RISER` with `c.ALPHA_MAX_RISER` (where `c = constants ?? DEFAULT_CONSTANTS`).

### Affected files

| File | Change |
|------|--------|
| `segment-factories.ts` | Add `constants` param to `makeCanopyCellSegment()` and `makeBrakeFlapSegment()`, use inside closures |
| `continuous-polar.ts` or `segment-factories.ts` | Define `ControlConstants` interface |
| `polar-data.ts` | No changes needed (existing calls use defaults) |
| `export-system.ts` (new) | Passes `controlConstants` when calling `rebuildSegments()` |

---

## Generic Export — All Polar Types

The export system must work for **any loaded polar**, not just the Ibex UL canopy. Each polar type has a different level of complexity:

### Export by Polar Type

| Polar | Segments | Mass | Controls | Pilot Sub-polars | Complexity |
|-------|----------|------|----------|-----------------|------------|
| **Ibex UL (Canopy)** | 16 (7 cells + 6 flaps + 2 parasitic + 1 pilot) | Weight + Inertia arrays | Brakes, risers, unzip | `aurafiveContinuous` + `slicksinContinuous` | High |
| **Aura 5 (Wingsuit)** | 0 (single body) | 14 body segments | δ (arch), dirty | None | Low |
| **Slick Sin (Skydiver)** | 0 (single body) | None defined | δ only | None | Minimal |
| **Caravan (Airplane)** | 0 (single body) | None defined | δ only | None | Minimal |

### How generic export works

The serializer detects what's present and exports accordingly:

```typescript
function serializeSystem(polar: ContinuousPolar, pilotType?: string): ExportedSystem {
  const system: ExportedSystem = {
    name: polar.name,
    type: polar.type,
    systemMass: polar.m,
    referenceArea: polar.s,
    referenceChord: polar.chord,
    polars: { systemPolar: polar },  // always include the main polar
    aeroSegments: [],
    weightSegments: polar.massSegments ?? [],
    inertiaSegments: polar.inertiaMassSegments ?? [],
  }

  // If polar has aeroSegments, serialize them + extract sub-polars
  if (polar.aeroSegments?.length) {
    // Walk segments, extract unique polars, build descriptors
    // ... (full canopy path)
  }

  // If no segments, it's a single-body polar (wingsuit, slick, caravan)
  // Just export the polar + mass segments — consumer uses getAllCoefficients() directly

  return system
}
```

For **simple polars** (wingsuit, slick, caravan), the export is just:
- The `ContinuousPolar` object with controls
- Mass segments (if any)
- No aero segment descriptors needed — consumer calls `getAllCoefficients()` directly

For the **canopy system**, the full segment machinery is exported.

---

## Re-Import Workflow — Making an Export the Default

Scenario: You tune parameters in the visualizer, export a system, use it in CloudBASE for a while, refine it further, and eventually want to make it the **default model** back in the polar visualizer.

### Step-by-step

1. **Export** from visualizer → `ibex-ul-wingsuit.polar.ts`
2. **Use** in CloudBASE — the file is a standalone TS module
3. **Iterate** — maybe hand-edit some parameters in the `.polar.ts` file
4. **Re-import** — bring the tuned file back into the visualizer

### How re-import works

The exported `.polar.ts` file is structurally identical to what's already in `polar-data.ts` — it's the same types (`ContinuousPolar`, `MassSegment`, `AeroSegmentDescriptor`). To make it the default:

**Option A — Copy and paste (simple):**

Open the exported file, copy the polar definitions back into `polar-data.ts`, replacing the existing `CANOPY_CELL_POLAR`, `ibexulContinuous`, etc. This is a manual process but straightforward since the data format is identical.

**Option B — Import and alias (clean):**

```typescript
// polar-data.ts
import { system } from './exports/ibex-ul-wingsuit.polar.ts'

// Use the exported polars as the new defaults
const CANOPY_CELL_POLAR = system.polars.canopyCellPolar
const BRAKE_FLAP_POLAR = system.polars.brakeFlapPolar
// ... rebuild segments from descriptors
```

This keeps the exported file as the single source of truth. Changes there automatically become the default.

**Option C — Drop-in loader (most flexible):**

Add a "Load System" feature to the visualizer that reads an exported `.polar.ts` file (or its JSON equivalent) and replaces the active system at runtime. This allows hot-swapping tuned configurations without touching source code.

### Recommended approach

**Start with Option A** (copy/paste) — it requires zero new infrastructure. The format is designed so that the exported polar values can be directly substituted into `polar-data.ts`.

**Graduate to Option B** once the export system is stable — keep tuned configs as separate files in an `exports/` directory, import them as defaults.

**Option C** (runtime loading) is a future enhancement — useful once you have multiple vehicle configurations you want to switch between without recompiling.

---

## Appendix: Complete Field Inventory

### ContinuousPolar (30 fields)

| Field | Type | Serializable | Notes |
|-------|------|:---:|-------|
| `name` | string | ✅ | |
| `type` | string | ✅ | |
| `cl_alpha` | number | ✅ | |
| `alpha_0` | number | ✅ | |
| `cd_0` | number | ✅ | |
| `k` | number | ✅ | |
| `cd_n` | number | ✅ | |
| `cd_n_lateral` | number | ✅ | |
| `alpha_stall_fwd` | number | ✅ | |
| `s1_fwd` | number | ✅ | |
| `alpha_stall_back` | number | ✅ | |
| `s1_back` | number | ✅ | |
| `cy_beta` | number | ✅ | |
| `cn_beta` | number | ✅ | |
| `cl_beta` | number | ✅ | |
| `cm_0` | number | ✅ | |
| `cm_alpha` | number | ✅ | |
| `cp_0` | number | ✅ | |
| `cp_alpha` | number | ✅ | |
| `cg` | number | ✅ | |
| `cp_lateral` | number | ✅ | |
| `s` | number | ✅ | |
| `m` | number | ✅ | |
| `chord` | number | ✅ | |
| `controls` | object | ✅ | Nested SymmetricControl — all numbers |
| `massSegments` | array | ✅ | Exported separately at system level |
| `inertiaMassSegments` | array | ✅ | Exported separately at system level |
| `cgOffsetFraction` | number | ✅ | 3D model alignment — maybe exclude from flight model export |
| `aeroSegments` | array | ❌ | Contains closures — exported as descriptors instead |

### AeroSegment → AeroSegmentDescriptor Mapping

| AeroSegment field | Descriptor field | Notes |
|-------------------|-----------------|-------|
| `name` | `name` | Direct copy |
| `position` | `position` | Direct copy (NED normalized) |
| `orientation` | `rollDeg` | Extract roll_deg (pitch_deg rarely used) |
| `S` | `S` (parasitic) or computed from polar/factory | Canopy cells use polar.s; flaps compute from fraction |
| `chord` | `chord` (parasitic) or computed | Same pattern |
| `pitchOffset_deg` | `pitchOffset_deg` | Direct copy |
| `polar` | `polarRef` | String key into polars dict |
| `getCoeffs()` | *(not serialized)* | Recreated by factory from descriptor data |

### MassSegment (3 fields)

| Field | Type | Serializable |
|-------|------|:---:|
| `name` | string | ✅ |
| `massRatio` | number | ✅ |
| `normalizedPosition` | `{x,y,z}` | ✅ |

All mass data is fully serializable. No transformations needed.

---

## Naming Convention Summary

| Concept | Convention | Example |
|---------|-----------|---------|
| Export filename | `{model}-{pilot}.polar.ts` | `ibex-ul-wingsuit.polar.ts` |
| Polar keys | camelCase descriptive | `canopyCellPolar`, `brakeFlapPolar` |
| Segment names | snake_case with position suffix | `cell_r2`, `flap_l3`, `lines`, `pc` |
| Mass segment names | snake_case body part | `right_thigh`, `canopy_air_r2` |
| Positions | NED normalized `{x, y, z}` | `{ x: 0.174, y: 0, z: -1.220 }` |
