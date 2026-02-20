# Context: Wingsuit Aerodynamics

> **Load this context** when working on the Aura 5 wingsuit model: 6-segment
> aerodynamics, throttle controls, dirty flying, planform geometry, or
> wingsuit-specific tuning.

---

## Scope

The wingsuit aero model covers the Aura 5 as a standalone flying body —
6 aerodynamic segments (head + center + 2 inner wings + 2 outer wings),
throttle-based control inputs (pitch/yaw/roll/dihedral/dirty), and the
chord-fraction position system.

This does NOT cover the wingsuit pilot hanging under a canopy (that's the
canopy system context — the pilot becomes a single aero segment there).

---

## Key Files

### Must Read
| File | What's There |
|------|-------------|
| `src/polar/polar-data.ts` lines 1150–1530 | Wingsuit constants (`A5_HEIGHT`, `A5_SYS_CHORD`, `A5_CG_XC`, `a5xc()`), per-segment polars, positions, `makeA5SegmentsAeroSegments()`, mass segments |
| `src/polar/segment-factories.ts` lines 500+ | `makeWingsuitLiftingSegment()`, `makeWingsuitHeadSegment()`, throttle response closures |
| `WINGSUIT-SEGMENTS.md` | Phase checklist, tuning notes, cross-coupling design |

### Also Relevant
| File | What's There |
|------|-------------|
| `src/polar/polar-data.ts` lines 920–1150 | `aurafiveContinuous` system-level polar (the envelope the segments must match) |
| `src/polar/coefficients.ts` | Kirchhoff blended coefficients, `getAllCoefficients()` |
| `src/polar/kirchhoff.ts` | Thin-airfoil separation model |

### Reference Docs
| Doc | What's There |
|-----|-------------|
| `CONTINUOUS-POLAR.md` | Continuous polar architecture, segment math, Kirchhoff model |
| `WINGSUIT-DELTA.md` | Dirty-flying coefficient deltas |

---

## Architecture

### 6 Segments

| Segment | Type | x/c | NED x | NED y | S (m²) | Chord (m) |
|---------|------|-----|-------|-------|--------|-----------|
| head | parasitic sphere | 0.13 | +0.259 | 0 | 0.07 | 0.13 |
| center | lifting body | 0.42 | −0.019 | 0 | 1.03 | 1.93 |
| r1 (inner R) | lifting wing | 0.44 | −0.038 | +0.213 | 0.30 | 1.34 |
| l1 (inner L) | mirror of r1 | 0.44 | −0.038 | −0.213 | 0.30 | 1.34 |
| r2 (outer R) | lifting wing | 0.37 | +0.029 | +0.326 | 0.15 | 0.39 |
| l2 (outer L) | mirror of r2 | 0.37 | +0.029 | −0.326 | 0.15 | 0.39 |

**Total S = 2.00 m²** (must equal `aurafiveContinuous.s`)

### Chord-Fraction Position System

Wingsuit segment positions use chord fractions (x/c) converted to NED via:
```
a5xc(xc) = (A5_CG_XC - xc) × A5_SYS_CHORD / A5_HEIGHT
         = (0.40 - xc) × 1.8 / 1.875
```
- x/c = 0.00 (head/LE): NED x = +0.384 (forward of CG)
- x/c = 0.40 (CG): NED x = 0 (at origin)
- x/c = 0.70 (feet/TE): NED x = −0.288 (behind CG)

Span positions use GLB measurements scaled by `GLB_TO_NED = 0.2962`.

### Throttle Controls

The wingsuit responds to 5 control inputs via factory closures:

| Control | Input Range | What It Does |
|---------|-------------|-------------|
| `pitchThrottle` | −1 to +1 | Shifts CG and segment pitch (arch/de-arch) |
| `yawThrottle` | −1 to +1 | Lateral body shift (lean left/right) |
| `rollThrottle` | −1 to +1 | Differential wing sweep (asymmetric drag) |
| `dihedral` | 0 to 1 | Wing dihedral angle (arms up/down) |
| `dirty` | 0 to 1 | Fabric tension — loose suit degrades all aero coefficients |

Each segment has a `rollSensitivity` that determines how strongly it responds
to `rollThrottle`:
- center: 0.3 (constrained by torso)
- inner wings: 0.6 (constrained by body)
- outer wings: 1.0 (hands/wrists have full freedom)

### Dirty Flying

Each segment polar has a `controls.dirty` object with delta coefficients:
```typescript
dirty: {
  d_cd_0: 0.035,         // more parasitic drag
  d_cl_alpha: -0.15,     // reduced lift slope
  d_k: 0.10,             // worse span efficiency
  d_cd_n: 0.15,          // higher broadside drag
  d_alpha_stall_fwd: -2, // earlier stall
}
```
These are applied linearly: `cd_0_effective = cd_0 + dirty × d_cd_0`.
Outer wings are most affected (highest deltas), center body least.

### Triangular Planform (Phase 3.5)

The inner wing is not a pure rectangle — it has a trapezoidal trailing edge
where the body flares at the hips:
- Rectangle (LE → hip): full span
- Trapezoid (hip → TE): span tapers to 30% at tail
- Area ratio: 0.772 → inner wing S reduced from 0.39 to 0.30 m²
- Mean chord: 1.34 m (down from 1.74)
- Hip line at x/c = 0.445

### Key Aerodynamic Properties

| Property | Value | Notes |
|----------|-------|-------|
| System CL_α | 2.9 /rad | Linear region ~5°–18° |
| System CD_0 | 0.097 | Minimum drag |
| L/D max | ~2.87 | At optimal α |
| Stall | 31.5° forward, −34.5° back | Kirchhoff s1_fwd = 3.7 |
| CG | 40% chord | `A5_CG_XC = 0.40` |
| System chord | 1.8 m | Head to toe in flight |
| Pilot height | 1.875 m | Reference for NED normalization |
| Mass | 77.5 kg | Pilot + suit + rig |

---

## Constraints & Invariants

### Critical
- **Segment areas must sum to system S** (2.00 m²). If you change one segment's area, adjust others to compensate.
- **`a5xc()` is the only way to compute wingsuit NED x positions** — do not hardcode NED values. If the CG or chord changes, all positions update automatically.
- **System-level polar must match segment-summed behavior at symmetric conditions** — `a5segmentsContinuous` CL/CD/CM at zero sideslip/throttle must match `aurafiveContinuous`. Tests verify this.
- **Factory closures capture base state** — the position, S, chord passed to `makeWingsuitLiftingSegment()` are the zero-throttle values. The closure modifies them per-frame based on control inputs.

### Architecture Rules
1. Wingsuit factories are **UI-independent** — portable to CloudBASE.
2. The head segment is purely parasitic (constant CD) — it only contributes directionally via sideslip (lateral force for rudder effect).
3. Inner wing cn_beta (0.12) is the primary weathervane source — trailing edge camber behind CG creates restoring yaw moment.
4. Outer wing cl_beta (−0.10) is the primary dihedral source — far outboard position amplifies roll-from-sideslip.

---

## Current Status

- Phase 1 ✅ — Segment data, factories, types, registry
- Phase 2 ✅ — Symmetric tuning, positions, CG, inner wing shape
- Phase 3 ✅ (mostly) — Throttle controls UI wired, 2 tuning items remain
- Phase 3.5 — Triangular planform refinement (done in polar-data, not yet verified visually)
- Phase 4 — Dirty flying segmented + coupled (planned)

---

## Related Contexts
- `docs/contexts/physics-engine.md` — EOM, forces, moments (wingsuit uses same engine)
- `docs/contexts/canopy-system.md` — Wingsuit pilot as a sub-model under canopy
- `docs/contexts/visualization.md` — Force arrow rendering
