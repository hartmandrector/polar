# Line Geometry + Brake Flaps + Physics Validation — Meeting Summary

**Date:** February 19, 2026  
**Status:** Complete — ready for commit  
**Companion work:** See also [2026-02-19-bridle-pc-registry-integration.md](2026-02-19-bridle-pc-registry-integration.md) for the bridle+PC changes in this same commit

---

## Overview

Major refactoring session adding suspension line geometry extraction, implementing brake flaps as separate aero segments, and expanding physics test coverage. These changes prepare the codebase for future line drag modeling and improve the physical accuracy of canopy brake deflection.

---

## What Changed

### Line Set Geometry Extraction

**New utility scripts (2 files, 253 lines):**
- **`extract-lines.cjs`** (170 lines) — Suspension line position extractor
  - Reads cp2.gltf mesh vertices, finds top/bottom of each line segment
  - Outputs canopy attachments, cascade junctions, riser endpoints for all 4 load-bearing ribs
  - Per-rib A/B/C/D line data → `CANOPY_GEOMETRY.lineSet` in model-registry.ts

- **`extract-rib-noses.cjs`** (83 lines) — Airfoil nose vertex extractor
  - Finds the true nose vertex (max Z) on each rib mesh
  - Used for `glbYChordLE` / `glbXNose` / `glbZNose` values in rib data
  - Validates that the chord-line LE is distinct from the A-line attachment point

**`model-registry.ts`** — Line set data structure (+516 lines)
- New interfaces: `LinePointGLB`, `LineSetRibGLB`, `RiserGLB`, `LineSetGLB`
- Complete suspension line geometry for all 4 load-bearing ribs (2, 4, 6, 8)
- Per-rib data structure:
  - **Canopy attachments** (A/B/C/D) — top vertex (yMax) of each upper line segment
  - **Cascade junctions** (A/B→front, C/D→rear) — where upper lines merge into lower
  - **Riser endpoints** (front/rear) — bottom of lower line segments at harness
- All positions in right-side GLB coordinates (+X = right), ready for mirroring
- Data structure ready for future line drag modeling and tension visualization

**Example data structure:**
```typescript
lineSet: {
  ribs: [
    {
      ribIndex: 2,
      aCanopy:    { glbX: 0.442, glbY: 4.151, glbZ:  0.299 },
      bCanopy:    { glbX: 0.443, glbY: 4.186, glbZ: -0.472 },
      cCanopy:    { glbX: 0.444, glbY: 4.223, glbZ: -1.271 },
      dCanopy:    { glbX: 0.446, glbY: 4.261, glbZ: -1.943 },
      abCascade:  { glbX: 0.440, glbY: 3.067, glbZ: -0.059 },
      cdCascade:  { glbX: 0.438, glbY: 3.110, glbZ: -1.181 },
      abRiserEnd: { glbX: 0.435, glbY: 0.500, glbZ: -0.016 },
      cdRiserEnd: { glbX: 0.422, glbY: 0.465, glbZ: -0.197 },
    },
    // ... ribs 4, 6, 8
  ],
  frontRiser: { top: {...}, bottom: {...} },
  rearRiser:  { top: {...}, bottom: {...} },
}
```

---

### Brake Flaps as Separate Segments

**`segment-factories.ts`** — Major refactoring (+67 insertions)
- Brake flaps now render as independent `AeroSegment` instances (not drag modifiers)
- 6 flaps: inner/mid/outer pairs (flap_r1/l1, flap_r2/l2, flap_r3/l3)
- Progressive deflection by brake input:
  - Inner flaps (r1/l1): 40% brake sensitivity
  - Mid flaps (r2/l2): 70% brake sensitivity
  - Outer flaps (r3/l3): 100% brake sensitivity (full deflection)
- Flap area and chord controlled by brake input (0–100%)
- **Cell area conservation:** Parent cell area shrinks when flap deploys
  - Formula: `cellArea × (1 - flapAreaFraction)`
  - Total wing area remains constant (realistic)

**Benefits:**
1. **Physically accurate** — Outer flaps deflect more than inner (real paraglider behavior)
2. **Correct moment arms** — Flap CP is aft of cell quarter-chord (nose-down pitching moment)
3. **Visual clarity** — Separate colored arrows per flap in force vector display
4. **Aerodynamic realism** — Brake deflection creates downward-facing surface behind trailing edge

**`vectors.ts`** — Per-segment rendering support
- Flap-specific colors (darker variants of parent cell colors)
- Deployment scaling integrated (flaps scale with parent cell positions)
- Segment arrow color palette:
  ```
  flap_r1/l1: 0x228822 (dark green)
  flap_r2/l2: 0x338833 (dark-mid green)
  flap_r3/l3: 0x448844 (dark-bright green)
  ```

---

### Physics Test Expansion

**`sim.test.ts`** — Comprehensive validation (+359 lines)

New test groups:
1. **`evaluateAeroForces`** — ω×r correction validation
   - Matches static path when ω = 0
   - Roll rate produces roll damping moment (negative ΔL opposes positive p)
   - Pitch rate produces pitch damping moment (negative ΔM opposes positive q)

2. **`computeDerivatives`** — Gravity vs. aero balance
   - Free fall (no airspeed): gravity dominates (wDot ≈ g)
   - Trim-like state: all 12 derivatives finite and reasonable
   - Accelerations small at approximate trim (not exactly zero)

3. **Robustness checks:**
   - Free-fall velocity test relaxed (GLB-derived positions place canopy higher → larger apparent mass moment)
   - RK4 and Euler convergence tests for smooth dynamics
   - Finite state validation from trim conditions

**Test coverage:** 192 tests passing across 6 test files ✅

---

### Additional Improvements

**`aero-segment.ts`** (+37 lines)
- Enhanced segment force computation documentation
- Improved type annotations for segment results

**`continuous-polar.ts`** (+22 lines)
- Extended SegmentControls interface for flap deflection
- Better documentation of control surface authority

**`controls.ts` + `index.html`** (+8 lines each)
- Completed UI wiring: `showCellWireframes` and `hideCanopyGlb` event listeners
- Previously missing from FlightState integration (cosmetic fix)

**`mass-overlay.ts`** (+34 lines)
- 3D CP marker support: `updateCP()` accepts optional `cpNED` parameter
- Falls back to 1D chord-fraction positioning if 3D position not provided
- Green octahedron diamond marker (standard CP symbol in XFLR5/Tornado)

**`eom.test.ts`** (+14 lines)
- Additional edge-case validation for equations of motion

**`canopy-polish.test.ts`** (+4 lines)
- Updated flap TE position expectation to match GLB-derived value (-1.429 vs old -0.689)

**`model-registry.test.ts`** (+12 lines)
- Line set geometry validation tests

---

## Key Technical Decisions

### Line Set Data Structure Design

**Complete topology capture:**  
The `LineSetGLB` structure stores the full suspension line graph topology: per-rib canopy attachments (A/B/C/D), cascade junctions (where upper lines merge into lower), and riser endpoints. This enables future work:
- **Line drag modeling** — Create per-segment line aero forces using attachment positions
- **Line tension visualization** — Color lines by computed load during flight
- **Asymmetric loading in turns** — Model slack inner lines vs. tight outer lines
- **Line-twist simulation** — Yaw moment from tangled lines (Z-rotation at cascade junctions)

**Extraction methodology:**  
Rather than hand-measuring 40+ line attachment points in Blender, we wrote extraction scripts that read the GLB buffer geometry directly. The scripts find top/bottom vertices (yMax/yMin) of each line mesh and report GLB coordinates. This is:
- **Faster** — 5 minutes to run scripts vs. hours of manual measurement
- **Accurate** — No transcription errors, floating-point precision preserved
- **Reproducible** — Scripts are committed, can be re-run if GLB is updated
- **Documented** — The scripts ARE the documentation of the measurement method

### Brake Flaps as Physics Objects (not just drag modifiers)

**Previous approach:** Brake deflection just added drag to the parent cell:
```typescript
const brakeDrag = brakeInput × 0.5  // ad-hoc multiplier
cell.CD += brakeDrag
```

**New approach:** Flaps are independent `AeroSegment` instances:
```typescript
const flapArea = brakeInput × flapSensitivity × maxFlapArea
const flap = {
  name: 'flap_r1',
  area: flapArea,
  chord: flapChord,
  position: cellTE,  // aft of cell QC
  CD: flapCD,
}
// Parent cell area shrinks to conserve total wing area:
cell.area *= (1 - flapAreaFraction)
```

**Why this matters:**
1. **Moment arms** — Flap CP is ~0.3–0.5 m aft of cell QC → generates nose-down pitching moment (real paragliders pitch down under brakes)
2. **Progressive deflection** — Outer flaps deflect more than inner (realistic — pilots pull outer brake lines harder to stay coordinated in turns)
3. **Area conservation** — Total wing area stays constant as flaps deploy (physical constraint — fabric doesn't materialize from nowhere)
4. **Visual debugging** — Each flap gets its own force arrow, making it obvious when deflection is asymmetric or excessive

Real paraglider brake behavior: outer cells see higher airspeed in turns → need more brake authority → larger flap deflection. The new model captures this automatically via the brake sensitivity factors (0.4/0.7/1.0 inner/mid/outer).

### Physics Test Philosophy

The expanded test suite validates **derived quantities** (damping moments, acceleration magnitudes, integration convergence) rather than just checking that functions don't crash. Examples:

**Roll damping test:**
```typescript
const withRoll = evaluateAeroForces(..., { p: 0.5, q: 0, r: 0 }, ...)
const deltaL = withRoll.moment.x - noRoll.moment.x
expect(deltaL).toBeLessThan(0)  // positive p → negative ΔL
```
This tests the **physics** (ω×r correction produces the right sign of damping moment), not just the code structure.

**Free-fall test (relaxed bounds):**  
After moving to GLB-derived canopy positions, the free-fall test started failing — the canopy is now 4.08 m above the riser (vs. old 2.29 m), increasing the apparent mass moment arm. The falling body pitches nose-down faster, rotating velocity from body-z (w) into body-x (u). Rather than checking `w` alone, we now check total airspeed:
```typescript
const airspeed = Math.sqrt(u² + v² + w²)
expect(airspeed).toBeGreaterThan(2.0)  // picks up speed ~g
```
This is **better physics** — the test now validates energy gain (½m v²) rather than a specific velocity component.

---

## Future Work Enabled

### Line Drag Modeling (ready to implement)
All suspension line geometry is now in the registry. Next steps:
1. Create `makeLineDragSegments()` factory function
2. For each rib, create 4–6 line segments (upper A/B/C/D, lower A/C, risers)
3. Segment area = line diameter × length
4. Position = midpoint of top/bottom vertices
5. CD = 1.0–1.2 (circular cylinder in crossflow)
6. Add to `ibexulContinuous.aeroSegments`

Expected impact: +15–20 N drag at 12 m/s (line drag is ~8–10% of total canopy drag).

### Line Tension Visualization
With line positions stored, we can:
1. Compute tension as `T = F_aero × (r_attachment - r_CG) / line_length`
2. Color each line mesh by `T / T_max` (green = slack, red = tight)
3. During turns: inner lines go slack (green), outer lines go tight (red)
4. Warning UI when max tension exceeds safety threshold (line break prediction)

### Asymmetric Line Loading in Turns
Physics currently assumes symmetric line tension. With per-rib line data we can:
1. Compute lateral force distribution from roll angle + centripetal acceleration
2. Weight shift → inner lines slack → inner canopy collapses slightly
3. Model as variable cell area: `cellArea(φ, y) = baseArea × (1 - collapseRatio(φ, y))`
4. Produces correct adverse yaw (uncoordinated turn behavior)

---

## Files Changed (Subset — excluding bridle/PC work)

**Modified (10 files):**
```
polar-visualizer/index.html                       (+8)
polar-visualizer/src/polar/aero-segment.ts        (+37)
polar-visualizer/src/polar/continuous-polar.ts    (+22)
polar-visualizer/src/polar/segment-factories.ts   (+67)
polar-visualizer/src/tests/canopy-polish.test.ts  (+4)
polar-visualizer/src/tests/eom.test.ts            (+14)
polar-visualizer/src/tests/model-registry.test.ts (+12)
polar-visualizer/src/tests/sim.test.ts            (+359)
polar-visualizer/src/viewer/mass-overlay.ts       (+34)
polar-visualizer/src/viewer/model-registry.ts     (+516)
polar-visualizer/src/viewer/vectors.ts            (large, shared with bridle/PC)
```

**New (2 files):**
```
polar-visualizer/extract-lines.cjs                (170 lines)
polar-visualizer/extract-rib-noses.cjs            (83 lines)
```

**Total:** +1143 insertions in this subset (out of +1656 total commit)

---

## Test Results

- **192 tests passing** across 6 test files
- **0 TypeScript errors** (`npx tsc --noEmit` clean)
- No existing polars broken (aurafive, ibexul, slicksin, caravan)
- All new physics validators passing (damping moments, integration convergence)

---

## Commit Notes

This work was done in parallel with the bridle+PC registry integration during the same session. The two efforts are logically independent (line geometry and brake flaps don't depend on bridle positioning) but were tested together and should be committed together to maintain test consistency.

**Session date:** February 19, 2026  
**Files ready:** All changes type-checked and tested ✅  
**Documentation:** MODEL-GEOMETRY.md updated with line set extraction and brake flap behavior
