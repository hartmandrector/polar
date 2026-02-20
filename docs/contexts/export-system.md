# Context: Export System

> **Load this context** when working on the OUTPUT.md export system —
> serializing the flight model into a portable TypeScript module for CloudBASE.

---

## Scope

The export system packages the complete active flight model into a single
self-contained TypeScript file that can be imported by CloudBASE (or any
consumer) without any dependency on the Polar Visualizer.

This is **planning-stage** — the system is designed but not yet implemented.
OUTPUT.md is the authoritative planning document.

---

## Key Files

### Must Read
| File | Lines | What's There |
|------|-------|-------------|
| `OUTPUT.md` | 1101 | **Complete export system design** — schema, serialization format, import helper, test plan |

### Will Be Created (not yet implemented)
| File | Purpose |
|------|---------|
| `src/export/schema.ts` | Export format types |
| `src/export/serializer.ts` | Converts live model → export format |
| `src/export/writer.ts` | Generates TypeScript source file |
| `src/ui/export-panel.ts` | UI: export button, configuration |

### Source Data (what gets exported)
| File | What It Provides |
|------|-----------------|
| `src/polar/polar-data.ts` | ContinuousPolar definitions, segment arrays, mass segments |
| `src/polar/segment-factories.ts` | Factory functions + control constants |
| `src/polar/continuous-polar.ts` | Type definitions (ContinuousPolar, AeroSegment, etc.) |
| `src/polar/eom.ts` + `sim.ts` + `sim-state.ts` | 6DOF engine (copied as-is) |
| `src/polar/apparent-mass.ts` | Apparent mass model |
| `src/polar/composite-frame.ts` | Vehicle assembly |

---

## Architecture (from OUTPUT.md)

### 7 Data Layers to Export

| Layer | What | Source |
|-------|------|--------|
| 1. Polar definitions | ContinuousPolar objects with all coefficients | `polar-data.ts` |
| 2. Aero segment descriptors | Position, S, chord, polar reference, type tag | Built by factories |
| 3. Mass segments | Point masses with NED positions, dynamic rotation | `polar-data.ts` |
| 4. Control constants | Brake/riser coupling, max deflections, deployment multipliers | `segment-factories.ts` |
| 5. 6DOF engine | EOM, integrators, aero force summation | `eom.ts`, `sim.ts`, etc. |
| 6. Apparent mass | Virtual inertia model | `apparent-mass.ts` |
| 7. Composite frame | Vehicle assembly logic | `composite-frame.ts` |

### Export Format

The exported file is a **TypeScript module** containing:
1. Polar definition objects (data)
2. Aero segment descriptors (data — positions, dimensions, type tags)
3. Mass segment arrays (data)
4. Control constants (data)
5. Factory reconstruction functions (code — rebuilds `getCoeffs()` closures from descriptors)
6. Complete 6DOF engine (code — copied from polar/ directory, 11 files)

### Key Design Decision: Descriptors, Not Closures

The `getCoeffs()` closures cannot be serialized. Instead, the export captures
**segment descriptors** — all the data needed to reconstruct the closure:

```typescript
interface AeroSegmentDescriptor {
  name: string
  type: 'canopy-cell' | 'brake-flap' | 'parasitic' | 'lifting-body' | 'unzippable-pilot'
  position: Vec3NED           // base NED-normalized position
  polarRef: string            // key into exported polars
  S: number                   // reference area [m²]
  chord: number               // reference chord [m]
  arcAngle_deg: number        // canopy arc angle
  side: 'center' | 'left' | 'right'
  brakeSensitivity: number
  riserSensitivity: number
  rollSensitivity: number
  // ... type-specific fields
}
```

The consumer calls a `rebuildSegment(descriptor, polars)` function that
creates a live `AeroSegment` with a working `getCoeffs()` closure.

### Portable Engine (11 files)

These files are already UI-independent and copy directly:
```
coefficients.ts, kirchhoff.ts, continuous-polar.ts, aero-segment.ts,
inertia.ts, apparent-mass.ts, eom.ts, sim-state.ts, sim.ts,
composite-frame.ts, segment-factories.ts
```

---

## Implementation Plan (from OUTPUT.md)

| Phase | What | Status |
|-------|------|--------|
| 1 | Export schema + descriptor types | Not started |
| 2 | Serializer (live model → descriptors) | Not started |
| 3 | UI export button | Not started |
| 4 | Import helper (descriptors → live segments) | Not started |
| 5 | Tests (round-trip: serialize → deserialize → compare) | Not started |

---

## Constraints

- **The export must be self-contained** — no imports from the Polar Visualizer.
- **Round-trip fidelity** — exported model must produce identical forces/moments to the live model at all α, β, control inputs.
- **Human-readable** — exported TypeScript should be readable and debuggable, not minified blob.
- **Factory closures are reconstructed, not serialized** — descriptors + `rebuildSegment()` pattern.
- **Control constants are exported explicitly** — consumer can override them without touching factory code.

---

## Related Contexts
- `docs/contexts/physics-engine.md` — The engine that gets exported
- `docs/contexts/canopy-system.md` — The primary system being exported (Ibex UL)
