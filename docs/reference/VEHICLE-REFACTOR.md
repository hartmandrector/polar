# VEHICLE-REFACTOR — Decoupled Vehicle Architecture

> **Status:** Phases A–C complete. Phase D (UI scaling controls) in progress — pilot height slider ✅.
> **Scope:** Blueprint for decoupling GLB models, aerodynamic polars, and mass systems
> **Related:** [REFERENCE-LENGTH.md](../REFERENCE-LENGTH.md) (Phases A–C complete), [USER-MY-DATA.md](../USER-MY-DATA.md) (integration guide), [SCALING-SLIDERS.md](../SCALING-SLIDERS.md) (slider implementation)

---

## Problem Statement

The current codebase couples three independent inputs (GLB geometry, aerodynamic polar, physical mass) through hardcoded assumptions, making it brittle when users want to integrate their own data.

---

## Reference Height Definitions (Glossary)

These terms are easy to conflate. The refactor will treat them as **distinct**
values with explicit names in the registry and physics pipeline.

| Term | Meaning | Used For |
|------|---------|----------|
| **pilotHeight_m** | Pilot height without shoes (head-to-heel) | Mass distribution and inertia normalization |
| **wingsuitChord_m** | Chord length including fabric, shoes, helmet (top of head to fabric tail) | Aero chord, CP/CG offsets, single-body wingsuit aero |
| **segmentChord_m** | Per-segment chord for multi-segment wingsuit models | Segment aero forces and CP locations |
| **referenceLength_m** | Generic reference length — must be qualified (pilot vs chord) | Any normalization step that currently uses a single `referenceLength` |

**Rule:** If a value affects mass, use `pilotHeight_m`. If it affects aero,
use `wingsuitChord_m` (or `segmentChord_m` for segments).

### Coupling Examples

**Example 1: Position Normalization Hardcoded in Code**
```typescript
// segment-factories.ts
const REFERENCE_HEIGHT = 1.875  // What if pilot is 1.60m or 2.00m?

// main.ts
computeCenterOfMass(segments, 1.875, mass)  // Hard to change globally
```
**Impact:** To change pilot height, you edit ~25 locations across 8 files.

**Example 2: GLB Scale Compensation**
```typescript
// model-loader.ts
const parentScale = 1.5           // Canopy relative to pilot
const childScale = 0.850          // Pilot relative to canopy
// These exist only to compensate for upstream scale decisions
```
**Impact:** Adding a new vehicle variant requires understanding a complex scale chain with magical numbers.

**Example 3: Segment Positions Tied to A5 Geometry**
```typescript
// polar-data.ts — Wingsuit segments
const A5_PILOT_HEIGHT_M = 1.875
const A5_WINGSUIT_CHORD_M = 1.8
const a5xc = (xc) => (A5_CG_XC - xc) * A5_WINGSUIT_CHORD_M / A5_PILOT_HEIGHT_M
```
**Impact:** Can't reuse segment logic for a different wingsuit without copy-pasting and modifying.

**Example 4: Mass Distribution Hard to Override**
```typescript
// polar-data.ts
WINGSUIT_MASS_SEGMENTS  // Aura 5 specific
CANOPY_WEIGHT_SEGMENTS  // Ibex UL specific; can't mix + match
```
**Impact:** Integrating your own mass model means forking large data structures.

---

## Real-World Impact: What Users Experience

The coupling issues above manifest as friction when advanced users try to integrate their own data. Here are concrete scenarios:

### Scenario 1: "I Flew a Different Pilot Height"

**Today (coupled system):**
You want to simulate a 1.60m pilot instead of 1.875m. You'd edit:
1. `continuous-polar.ts` — change the `pilotHeight_m` (currently `referenceLength`) field in each of 5 polars (5 edits)
2. `segment-factories.ts` — change the `REFERENCE_HEIGHT` constant (1 edit)
3. `main.ts` — find all ~17 denormalization calls and adjust (17 edits)
4. `vectors.ts` — find ~5 rendering scale calculations (5 edits)
5. Test files — update expected values in ~15 places (15 edits)

**Total:** 25+ locations across 8 files. One parameter change cascades everywhere.

**Tomorrow (decoupled):**
You'd change `vehicle.pilot.pilotHeight_m = 1.60` in one place. Physics and rendering both read from that single source. Done.

### Scenario 2: "I Built a Custom GLB Model"

**Today (coupled system):**
Your GLB is modeled at a different scale than the built-in ones. To make it fit, you juggle:

```typescript
const parentScale = 1.5           // Canopy relative to pilot
const childScale = 0.850          // Pilot relative to canopy
// These compensate for the fact that canopy and pilot GLBs were modeled separately
// They're magic numbers with no relation to physical dimensions
```

**Why?** The canopy GLB was authored at one size, the pilot at another. To make them look right together, you apply compensation scales. But:
- Adding a new vehicle requires reverse-engineering these scale chains
- Change one GLB and everything breaks
- No single source of truth ("how big *should* the canopy be relative to the pilot?")

**Tomorrow (decoupled):**
```typescript
const canopyMetadata: GLBMetadata = {
  filePath: 'public/models/my-canopy.glb',
  physicalSize: { height: 0, chord: 3.29, span: 8.0 },  // component chord/span
}

const pilotMetadata: GLBMetadata = {
  filePath: 'public/models/my-pilot.glb',
  physicalSize: { height: 1.875, chord: 1.8, span: 0.5 },  // pilotHeight_m
}
// Load canopy to 3.29m chord, pilot to 1.875m height
// No compensation scales; just render each at its specified size
```

### Scenario 3: "I Have a Second Wingsuit"

**Today (coupled system):**
The segment position formula is hardcoded for Aura 5:

```typescript
const A5_HEIGHT = 1.875
const A5_SYS_CHORD = 1.8
const a5xc = (xc) => (A5_CG_XC - xc) * A5_SYS_CHORD / A5_HEIGHT
```

To use this logic for your custom wingsuit:
- Copy the entire `a5xc` function
- Rename it (`myWingsuitXc`)
- Replace the constants with your wingsuit's dimensions
- Register it separately
- You've just duplicated code that should be reusable

**Tomorrow (decoupled):**
```typescript
// Generic segment positioning logic
interface SegmentTemplate {
  name: string
  chordFraction: number        // Where on the chord? (e.g., 0.40 = 40%)
}

// Vehicle provides context
interface Vehicle {
  pilotHeight_m: number
  wingsuitChord_m: number
  cgChordFraction: number
  segments: SegmentTemplate[]
}

// Physics evaluates at deploy time:
// position = (cg_xc - segment_xc) * wingsuitChord_m / pilotHeight_m
// Same logic, different vehicles, no copy-paste
```

### Scenario 4: "I Have Custom Mass Segments"

**Today (coupled system):**
Mass distributions are system-specific:

```typescript
const WINGSUIT_MASS_SEGMENTS   // Aura 5 only
const CANOPY_WEIGHT_SEGMENTS   // Ibex UL only
// Want to use canopy on a different wingsuit? Fork the definition.
```

**Tomorrow (decoupled):**
Mass segments live in a central registry. A vehicle definition references them:

```typescript
const myVehicle = {
  pilot: { mass: {
    segments: [
      { name: 'head', massRatio: 0.052, normalizedPosition: {...} },
      { name: 'torso', massRatio: 0.258, normalizedPosition: {...} },
      // ...
    ],
    cg: { x, y, z },
    inertia: { Ixx, Iyy, Izz, ... }
  }},
  canopy: { mass: { segments: [...] }, ... }
}
// Add canopy to any pilot; pilot to any canopy; no duplication
```

---

## Architectural Goals

### 1. **Clean Input Boundaries**
- **Aero input** (polar): Dimensionless aerodynamic coefficients (CL_α, CD_0, etc.) + aero reference length (e.g., `wingsuitChord_m` or `segmentChord_m`)
- **Geometry input** (GLB): Physical dimensions baked into the model itself (pilotHeight_m = 1.875m, canopy chord = 3.29m as component referenceLength_m)
- **Mass input** (registry): CG position, inertia tensor, segment distribution — all in physical coordinates

No leakage. No compensation scales between layers.

### 2. **Vehicle Registry = Single Source of Truth**
```typescript
interface VehicleDefinition {
  id: string
  name: string
  pilot: {
    glb: GLBMetadata          // Height, scale, geometry
    mass: MassModel           // CG, inertia, segments
    pilotHeight_m: number     // Mass reference (no shoes)
  }
  equipment: {  // Canopy, wingsuit, parachute
    aero: ContinuousPolar
    glb: GLBMetadata
    referenceLength_m: number // Component reference (e.g., canopy chord)
  }[]
}
```
- Every vehicle entry is self-contained
- Adding a new user's vehicle = add one entry to registry, no code changes
- Physics consumes vehicles; doesn't care if they're built-in or user-provided

### 3. **Decouple Position Normalization from Code**
All position/scale computations read the correct reference length from the vehicle definition, not hardcoded:

**Before:**
```typescript
computeInertia(segments, 1.875, mass)  // Magic number
```

**After:**
```typescript
computeInertia(segments, vehicle.pilot.pilotHeight_m, mass)
// or
computeInertia(segments, polar.referenceLength_m, mass)
```

### 4. **GLB Metadata Captures Physical Intent**
Instead of scale compensation chains, each GLB carries its physical meaning:

```typescript
interface GLBMetadata {
  filePath: string
  physicalSize: {         // What dimension does the GLB represent?
    height: number        // Pilot GLB: pilotHeight_m (1.875m)
    chord: number         // Canopy GLB: component chord (3.29m)
    span: number          // etc.
  }
  glbMaxDim: number       // Bounding box for scale factor
  needsFlip: boolean      // Canopy GLB is mirrored
}
```

When loading: `sceneScale = TARGET_SCENE_SIZE / (glbMaxDim × glbToMeters)`

No `parentScale * childScale * compensation` chains. Just:
1. GLB max dimension in units
2. Multiply by reference dimension
3. Divide by target scene size
Done.

---

## Current GLB Scaling Reality (Ibex UL Canopy)

The current canopy GLB was authored at a specific physical size and then scaled
through several steps (some of which include rotations and position offsets). We
must document the raw measurements and every scale/transform step so the refactor
can decouple physics size from rendering size.

### Raw GLB Measurements (cp2.gltf)

Measured from rib and cell meshes (e.g., Rib_8_L, Top_1_L...Top_7_L, Bottom_*):

| Dimension | GLB Min | GLB Max | Extent (units) |
|-----------|---------|---------|----------------|
| Span (X)  | -3.133  | +3.133  | **6.266** |
| Chord (Z) | -2.874  | +0.654  | **3.528** |

Raw planform area (GLB units):

$$\text{Area}_{glb} = 6.266 \times 3.528 = 22.10 \text{ units}^2$$

**Note:** Depending on whether you measure bottom skin, top skin, or inflated
surface, the derived area can vary slightly. The 22.10 value is the canonical
mesh-based area used for scaling decisions.

### Scaling / Transform Pipeline (Pre-Refactor)

These are the steps that currently affect the canopy scale, position, and
rotation in rendering. Each step must be made explicit and moved into registry
metadata during the refactor.

1. **GLB internal node scale** (model-authored)
   - The canopy GLB includes internal Object3D scales (e.g., `Empty` scale 0.2060).
   - These affect raw mesh size before any runtime scaling.

2. **Canopy parent scale** (runtime)
   - `parentScale` applied in model-loader (currently **1.5**).
   - Includes **negative X scale** to flip handedness so canopy right-side
     matches NED +y/right (Three.js uses −X for right after NED conversion).

3. **Pilot child scale** (runtime)
   - `childScale` applied to the pilot GLB so pilot proportions match canopy
     (corrects for different GLB-to-meters ratios).

4. **Pilot offset + rotation** (runtime)
   - `childOffset` (position) and `childRotationDeg` (rotation) place the pilot
     under the canopy in raw GLB coordinates.
   - Shoulder offset is applied so pilot pitch pivots around the riser attachment.

5. **Normalization scale** (runtime)
   - `TARGET_SIZE / referenceDim` applied to the composite root.
   - For canopy assemblies, `referenceDim` is the **pilot raw max dimension** so
     the pilot appears the same size standalone vs under canopy.

6. **PilotScale conversion** (runtime)
  - `pilotScale = canopyMeshScale / (glbToNED * pilotHeight_m)` (currently 1.875).
   - Ensures NED-normalized physics positions land on the canopy GLB mesh.

7. **CG offset translation** (runtime)
   - `applyCgFromMassSegments()` shifts the model so physics CG aligns with
     Three.js origin. Force vectors use the same offset.

### Why this matters

This pipeline mixes **model-authored scale**, **runtime render scale**, and
**physics normalization**. The refactor must:

- Make the raw GLB extents (22.10 units^2) explicit in `GLBMetadata`.
- Separate *physics size* (e.g., 220 sqft) from *render size*.
- Preserve rotation/offset steps (pilot pivot, child offsets) as explicit
  assembly metadata rather than magic numbers in code.

---

## Wingsuit Reference Length Conventions (Mass vs Aero)

We must explicitly track two different reference measurements for wingsuit
systems. They are **not** the same, and they affect different subsystems.

### 1) Pilot Height (Mass Reference)

- **Definition:** Pilot height *without shoes*, measured head-to-heel.
- **Current canonical value:** **1.875 m** (slick skydiver reference).
- **Use:** Mass distribution normalization and inertia calculations.
- **Reason:** Extra wingsuit fabric does not significantly change mass height.

### 2) Wingsuit Chord Length (Aero Reference)

- **Definition:** Chord length **including wingsuit fabric**, shoes, and usually
  a helmet. Measured along the chord line from the top of the pilot’s head to
  the fabric tail.
- **Use:** Aerodynamic chord, segment placement, and CP/CG offsets for aero.

### Why both must be tracked

- Changing **pilot height** affects **mass distribution** and inertia.
- Changing **chord length** affects **aerodynamic forces**, segment positions,
  and CP offsets.
- In multi-segment wingsuit models, **each segment has its own chord**, and
  segment reference positions must remain tied to the *original* chord geometry
  even when the pilot height changes.

### Naming conventions (required for refactor)

Use explicit, unambiguous names throughout code and registry:

- `pilotHeight_m` — mass reference, no shoes
- `wingsuitChord_m` — aero reference, includes fabric/shoes/helmet
- `segmentChord_m` — per-segment aero chord (multi-segment only)
- `referenceLength_m` — always specify *which* reference (pilot vs chord)

This avoids hidden coupling when the pilot height changes while aerodynamic
chord length remains constant (or vice versa).

### 5. **Polars + Segments Decouple from Geometry**
Segments (break forces into parts) can be reused across similar vehicles:

**Today (brittle):**
```typescript
const A5_CENTER_POLAR = { ... }  // Aura 5 specific
const A5_INNER_WING_POLAR = { ... }
// To use these on a different wingsuit, copy + rename
```

**Refactored (flexible):**
```typescript
// Generic segment template — position comes from vehicle at deploy time
interface SegmentTemplate {
  name: string
  relativePosition: { x: number; y: number; z: number }  // Normalized NED
  polar: ContinuousPolar
}

// Vehicle says: "I want center + inner wings + outer wings"
vehicle.wingsuit = {
  segmentTemplates: ['center', 'innerWing', 'outerWing'],
  pairWithPolar: [A5_CENTER_POLAR, A5_INNER_WING_POLAR, A5_OUTER_WING_POLAR]
}

// Physics evaluates: each segment at its registered template position
// Scales positions by pilotHeight_m (mass) and segmentChord_m (aero) at runtime
```

### 6. **Mass + Aero Scale Together**
If a user scales a canopy area (150 → 250 sqft) or pilot height (1.75 → 1.90m), both aero and inertia automatically propagate the change:

```typescript
// Physics call signature (pseudocode)
evaluateForces(vehicle, flightState, weatherState)
  // Mass denormalization reads vehicle.pilot.pilotHeight_m
  // Aero denormalization reads wingsuitChord_m / segmentChord_m
  // All areas / inertias read from vehicle definition or computed from polar
  // Result: changing vehicle scales both aero and mass consistently
```

---

## Data Input Boundaries

### Aero Entry Point
- **Source:** `polar-data.ts` or user-provided polar definition
- **Structure:** `ContinuousPolar` interface (coefficients + referenceLength_m)
- **Ownership:** Physics engine (read-only when evaluating forces)
- **Contract:** Coefficients are dimensionless; `referenceLength_m` anchors aero normalization

### Geometry Entry Point
- **Source:** `model-registry.ts` + referenced GLB files in `public/models/`
- **Structure:** `GLBMetadata` (file path, physical size, orientation flags)
- **Ownership:** Model loader (read at GLB load time) + renderer (reads for scene placement)
- **Contract:** Physical size (height, chord, span) is authoritative; scale factors derived *from it*, not imposed on it

### Mass Entry Point
- **Source:** `model-registry.ts` (mass segments) or user-provided mass model
- **Structure:** `MassSegment[]` + inertia tensor + CG position
- **Ownership:** Physics engine (denormalized by `vehicle.pilot.pilotHeight_m`)
- **Contract:** Mass positions normalized by `pilotHeight_m`; when scaled, all positions and inertias scale together

### Example: User Integrates Custom Wingsuit
User has:
- GLB file: `my-wingsuit.glb` (modeled at true 1.95m)
- Polar table from wind tunnel (5 polars: head, center, L wing, R wing, leg)
- Mass measurements: pilot + suit components, CG, inertia

Steps (no code changes):
1. Create entry in `model-registry.ts`:
   ```typescript
   const MY_WINGSUIT_PILOT: GLBMetadata = {
     filePath: 'public/models/my-wingsuit.glb',
     physicalSize: { height: 1.95, chord: 1.95, span: 1.0 },
     glbMaxDim: 3.6,
     needsFlip: false
   }
   ```
2. Create 5 polars in `polar-data.ts` (coefficients + `referenceLength_m: 1.95` for `wingsuitChord_m`)
3. Create mass segments in `model-registry.ts` (positions normalized by `pilotHeight_m = 1.95`)
4. Register vehicle in registry
5. Done — sim can fly with it immediately

---

## Core Design Pattern: Registry

Every vehicle is registered once; physics consumes it by ID.

```
┌─────────────────────────────────────┐
│  User Input (GLB, Polar, Mass)      │
├─────────────────────────────────────┤
│  Model Registry                     │
│  - GLB metadata + load functions    │
│  - Mass segment templates           │
│  - Aero polar references            │
├─────────────────────────────────────┤
│  Vehicle Definition (assembled)     │
│  - { pilot: {...}, equipment: [...] │
├─────────────────────────────────────┤
│  Physics Engine                     │
│  - Takes vehicle ID                 │
│  - Reads reference lengths          │
│  - Denormalizes all positions       │
│  - No hardcoded scales              │
└─────────────────────────────────────┘
```

### Registry Pattern Benefits
- **Locality:** Adding a new vehicle doesn't scatter changes across 8 files
- **Testability:** New vehicle is just a registry entry; can verify in unit tests
- **Flexibility:** Physics doesn't care if vehicle came from defaults or user; same codepath
- **Discoverability:** User sees all available vehicles in one place

---

## Changes Needed (What, Not Timeline)

### 1. Polar-Based Constants
✅ **DONE (Phase A):** All `1.875` literals replaced with `polar.referenceLength_m`
- Consequence: changing an aero reference length propagates everywhere

### 2. GLB Metadata Registry
Store physical dimensions explicitly for every GLB:
- pilotHeight_m, canopy chord, wingsuit span
- Derived: `glbToMeters = physicalSize / glbMaxDim`
- Eliminate `parentScale / childScale` compensation

### 3. VehicleDefinition Type
Bundle pilot + equipment + aero + mass into one atomic unit:
```typescript
type VehicleDefinition = {
  id: string
  pilot: { glb: GLBMetadata; mass: MassModel; ... }
  equipment: Array<{ aero: ContinuousPolar; glb: GLBMetadata; ... }>
}
```

### 4. Model Loader Refactor
Accept `VehicleDefinition` instead of hardcoded scale chains:
- Load pilot GLB, scale to `physicalSize.height` (pilotHeight_m)
- Load canopy GLB, scale to `physicalSize.chord` (component chord)
- Assemble composite, no intermediate compensation scales

### 5. Physics Engine Refactor
All denormalization calls pass `vehicle` or `polar`:
```typescript
// Current
evaluateAeroForces(segments, cg, 1.875, vel, omega, controls, rho)

// Refactored
evaluateAeroForces(segments, cg, vehicle.pilot.pilotHeight_m, vel, omega, ...)
```

### 6. Registry Access Pattern
Add helper function:
```typescript
function getVehicle(id: string): VehicleDefinition | null {
  return VEHICLE_REGISTRY[id]
}
```

---

## High-Level Data Flow

```
                          ┌──────────────────────────┐
                          │  User (external)         │
                          │  - GLB file (3D geometry)│
                          │  - Polar data (aero)     │
                          │  - Mass measurements     │
                          └──────────────────────────┘
                                      │
                                      ▼
                          ┌──────────────────────────┐
                          │  VEHICLE REGISTRY        │
                          │  (single source of truth)│
                          │                          │
                          │  Entry = VehicleDefn     │
                          │  - Aero (polar)          │
                          │  - Geometry (GLB meta)   │
                          │  - Mass (segments)       │
                          │  - Params (pilotHeight_m / chord refs) │
                          └──────────────────────────┘
                                      │
                        ┌─────────────┼─────────────┐
                        │             │             │
                        ▼             ▼             ▼
                    ┌────────┐   ┌─────────┐   ┌──────────┐
                    │ Physics│   │Rendering│   │UI Controls
                    │ Engine │   │ (scene) │   │(select ve
                    │        │   │         │   │hicle)
                    │ Reads: │   │ Reads:  │   │
                    │- Polar │   │- GLB    │   │ Allow user
                    │- Mass  │   │- Scales │   │ to switch
                    │- Ref   │   │- CG     │   │ vehicle
                    │  Len   │   │  offset │   │ or modify
                    │        │   │         │   │ scale
                    └────────┘   └─────────┘   └──────────┘
                        │             │
                        └─────────────┼─────────────┘
                                      │
                                      ▼
                            ┌──────────────────────┐
                            │  Simulation Output   │
                            │  - Forces, moments   │
                            │  - Trajectory        │
                            │  - Stability metrics │
                            └──────────────────────┘
```

---

## Key Decoupling Principles

1. **Aero ≠ Geometry**
  - Same aero (polar) can fly with different pilot heights by decoupling `pilotHeight_m` (mass) from `referenceLength_m` (aero)
   - Same geometry (GLB) can use different polars

2. **Mass ≠ Aero**
   - A heavy pilot + light gear = different inertia, same aero
   - Registry entries for common combinations; users can mix + match

3. **Position Normalization ≠ Hardcoded**
  - All denormalization code reads the correct reference length from source of truth (pilotHeight_m for mass, referenceLength_m for aero)
   - Change once, propagates everywhere

4. **No Compensation Scales**
   - If two GLBs need different scales, it's because they were modeled at different sizes
   - Store the sizes explicitly; compute scale *from* them, don't compensate with magic numbers

5. **Registry Owns the Vehicle**
   - Instead of "modify this function for your setup," users add a registry entry
   - Physics consumes vehicles by ID; doesn't care about their origin

---

## Relationship to Phase A (REFERENCE-LENGTH.md)

**Phase A** (just completed):
- Parameterized the reference-length constant
- All ~40 hardcoded `1.875` values now read from `polar.referenceLength_m`
- Zero behavioral changes; test coverage preserved

**Phase A Impact:**
- Enables Phase B (correct wingsuit to 1.93m) — change one number
- Enables Phase C (per-component reference frames) — infrastructure ready
- Enables Phase D (UI scaling controls) — aero reference length now live and traceable

**This Document (Architecture):**
- Shows how Phases B/C/D build on Phase A
- Explains the *why* behind decoupling (user can integrate anything)
- No timeline (separate roadmap document when ready)
- Focuses on design principles, not implementation order

---

## Success Criteria

When vehicle refactoring is complete:

✅ User can integrate a new wingsuit by:
  - Creating a GLBMetadata entry (3 lines)
  - Adding 1–5 polars to polar-data (copy + paste + tweak)
  - Creating mass segments in registry (1 entry)
  - No code changes outside registry/definitions

✅ Physics engine is unaware of vehicle identity:
  - All denormalization reads `getVehicleMassReference()` or `polar.referenceLength`
  - No hardcoded constants in physics path
  - Same physics codepath for default vehicles + user vehicles

✅ GLB loading is deterministic:
  - Scales derived from registry-based `glbToMeters` and assembly offsets
  - `deriveAssemblyOffsets()` computes parent/child scales from physical measurements
  - Test: change physical size, GLB loads at correct scale

☐ Aero + mass scale together (Phase D):
  - User changes pilot height → inertia + moment arms scale together
  - User changes canopy area → both aero (area, chord) and mass (inertia) scale together

✅ Documentation enables onboarding:
  - Beginner: modify a polar (15 min)
  - Intermediate: integrate CloudBase data (45 min)
  - Advanced: full custom vehicle (2–4h)
  - No requirement to understand internals; just follow the checklist

---

## Next Steps

See [USER-MY-DATA.md](../USER-MY-DATA.md) for onboarding guidance at three skill levels.

See AGENTS.md for architectural principles and team conventions.
