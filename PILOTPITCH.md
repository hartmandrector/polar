# Pilot Pitch — Planning Document

**Status: COMPLETE** ✅

## Overview

Add a **pilot pitch** degree-of-freedom to the canopy visualizer. The pilot body
can rotate on the pitch axis about the riser attachment point, independent of the
canopy. This is the physical pendulum effect — a hanging pilot swings fore/aft
under the wing.

Pilot pitch is a prerequisite for the **deployment project** (next). During
deployment the pilot's body orientation relative to the canopy changes
dramatically (from freefall posture to hanging under an inflating wing), and the
visuals will look wrong unless we can rotate the pilot independently.

**Project order:**
1. ~~Pilot Pitch (this document)~~ **DONE**
2. Deployment (separate planning doc, later)
3. Output / Export (OUTPUT.md, on hold)

---

## Why This Matters

- During steady canopy flight the pilot hangs nearly vertically under the risers.
  But during speed changes, transitions, and deployment, the pilot pendulums
  fore and aft. A front-riser dive can pitch the pilot 20-30° forward; opening
  shock swings the pilot aft.
- The 3D viewer currently has the pilot rigidly attached to the canopy with a
  fixed offset. Visually, you can't show a pilot swinging under the wing.
- Aerodynamically, the pilot pitch changes the pilot body's angle of attack
  relative to the freestream. Today this is handled by a fixed `pitchOffset_deg`
  of 90° (hanging vertically). With pilot pitch as a variable, the effective
  pitch offset becomes `90 + pilotPitch_deg`.
- The force vectors on the pilot segment must stay visually consistent with
  the 3D model.

---

## Design Decisions — Deviations from Original Plan

Several simplifications were made during implementation based on testing and
physical reasoning:

### 1. Mass Segments Do Not Rotate (Changed from Plan)

**Original plan:** Rotate the 14-part pilot mass model about the riser origin
when pilot pitch changes, recompute CG and inertia.

**What was implemented:** Mass segments stay at their pitch=0 positions
regardless of the pilot pitch slider. Only the aero model (coefficient
evaluation) responds to pilot pitch.

**Rationale:** The center of rotation is close enough to the pilot's center of
mass that the CG shift from pilot pitch is negligible. Rotating mass segments
introduced coordinate system mismatches between NED (aero) and Three.js (3D
model) rotation centers that caused the 3D model to drift apart. Keeping mass
fixed avoids these issues with no meaningful accuracy loss.

### 2. Aero Segment Position Does Not Rotate (Changed from Plan)

**Original plan:** Rotate `seg.position` in the NED x-z plane inside
`getCoeffs()` so the pilot segment's application point swings with the body.

**What was implemented:** The segment position stays fixed at its original NED
location. Only `pitchOffset_deg` is updated dynamically.

**Rationale:** The aero position rotation happened about NED origin (canopy
centroid), but the 3D visual rotation is about the riser attachment point (pilot
shoulders). These are different pivot points, so the small per-segment CP arrows
would not track the visual model. Keeping position fixed means the arrows stay
attached to the pilot's base position, which is correct for moment arm
calculations and visually consistent.

### 3. Pivot Point at Shoulders, Not Model Center (Refined from Plan)

**Original plan:** Place the pilot pivot at `PILOT_OFFSET.position` with the
pilot mesh at origin of the pivot group.

**What was implemented:** The pilot mesh is shifted DOWN by 10% of body extent
within the pivot group, and the pivot group is shifted UP by the same amount.
This places the rotation center at the pilot's shoulders (riser attachment)
rather than the GLB model's geometric center (CG/belly button). The net
resting position is unchanged.

**Rationale:** The wingsuit GLB model has its origin at the CG (belly button
area). The riser attachment is at the shoulders, slightly above the CG. Without
this offset, the pilot would rotate about its belly instead of hanging from the
shoulders. The 10% figure was tuned visually.

### 4. `applyCgFromMassSegments` Made Absolute (Bug Fix)

The original function used `-=` (incremental subtraction) to shift model
positions for CG centering. When called multiple times (e.g., on pilot pitch
change), the offset accumulated, causing the model to fly apart. Fixed to
capture base positions on first call and always set absolute positions.

---

## Architecture — Final State

### Aero Segment (Pilot)

| Item | Value | Location |
|------|-------|----------|
| Segment name | `'pilot'` | `polar-data.ts` `makeIbexAeroSegments()` |
| Position (NED norm) | `{ x: 0.38, y: 0, z: 0.48 }` — **static** | `polar-data.ts` `PILOT_POSITION` |
| `pitchOffset_deg` | `90 + pilotPitch` — **dynamic** | `segment-factories.ts` `getCoeffs()` |
| Factory (wingsuit) | `makeUnzippablePilotSegment()` | `segment-factories.ts` |
| Factory (slick) | `makeLiftingBodySegment()` | `segment-factories.ts` |
| α transform | `localAlpha = alpha_deg - (90 + pilotPitch)` | Both factories |
| CP direction | Rotated by dynamic `pitchOffset_deg` in x-z plane | `vectors.ts` |

### 3D Model (Pilot)

| Item | Value | Location |
|------|-------|----------|
| GLB offset | `(0, -0.540, 0)` Three.js coords | `model-loader.ts` `PILOT_OFFSET.position` |
| GLB rotation | `(-π/2, 0, 0)` — prone → hanging | `model-loader.ts` `PILOT_OFFSET.rotation` |
| Pivot group | `pilotPivot` — origin at shoulder level | `model-loader.ts` |
| Pivot position | `PILOT_OFFSET.position.y + 0.10 * bodyExtent` | `model-loader.ts` |
| Pilot mesh offset | `(0, -0.10 * bodyExtent, 0)` within pivot | `model-loader.ts` |
| Per-frame rotation | `pilotPivot.rotation.x = pilotPitch * DEG2RAD` | `main.ts` |
| Storage | `pilotPivot?: THREE.Group` on `LoadedModel` | `model-loader.ts` |

### Mass Segments (Pilot Body)

| Item | Value | Location |
|------|-------|----------|
| 14 body parts | head, torso, arms, legs (mirrored) | `polar-data.ts` |
| Pilot pitch effect | **None** — mass stays at pitch=0 positions | Design decision |
| CG recomputation | Only on polar change, not on pitch change | `main.ts` |

### Controls

| Item | Value | Location |
|------|-------|----------|
| `SegmentControls.pilotPitch` | `number` (degrees) | `continuous-polar.ts` |
| `FlightState.pilotPitch` | `number` (degrees) | `controls.ts` |
| UI slider | `-180° to +180°`, step 1° | `index.html` |
| Default | `0` (hanging vertical) | `aero-segment.ts` `defaultControls()` |
| Event wiring | In `input` event listener array | `controls.ts` |

### Vectors

| Item | Detail | Location |
|------|--------|----------|
| Segment CP position | Uses static `seg.position` + CP offset rotated by dynamic `pitchOffset_deg` | `vectors.ts` |
| Force directions | From wind frame — correct (lift ⊥ wind, drag ∥ wind) | `vectors.ts` |
| Moment arm | Uses CP position vs CG — unchanged | `aero-segment.ts` |

---

## Design

### Scope

Pilot pitch is a **UI control** that:
1. Rotates the 3D pilot model about the riser/shoulder attachment point.
2. Changes the pilot segment's effective `pitchOffset_deg` (aero coefficients).
3. ~~Rotates the pilot's mass segment positions~~ — **removed** (see Design Decisions above).
4. Keeps force/moment vectors visually consistent with the model.

### What Was Implemented

#### 1. Data Model — `SegmentControls` + `FlightState`

- Added `pilotPitch: number` to `SegmentControls` in `continuous-polar.ts`
- Added `pilotPitch: 0` to `defaultControls()` in `aero-segment.ts`
- Added `pilotPitch: number` to `FlightState` in `controls.ts`
- Units: raw degrees, range -180° to +180°

#### 2. UI — Pilot Pitch Slider

- Added slider in `index.html` inside `canopy-controls-group` after weight shift
- Range: -180° to +180°, step 1°, default 0°
- Wired in `readState()` and added to `input` event listener array in `controls.ts`
- Label updates: `pilotPitchLabel.textContent = ${pilotPitch.toFixed(0)}°`

#### 3. Aero — Dynamic Pitch Offset Only

Both `makeLiftingBodySegment()` and `makeUnzippablePilotSegment()` in
`segment-factories.ts`:

```typescript
// In getCoeffs():
const effectivePitchOffset = pitchOffset_deg + controls.pilotPitch
this.pitchOffset_deg = effectivePitchOffset
const localAlpha = alpha_deg - effectivePitchOffset
```

**No position rotation.** The segment position stays fixed. Only the coefficient
evaluation angle changes.

#### 4. 3D Model — Shoulder Pivot

In `model-loader.ts`, the pilot GLB is wrapped in a pivot group:

```typescript
const shoulderOffset = 0.10 * bodyExtentY
pilotPivot.position.set(
  PILOT_OFFSET.position.x,
  PILOT_OFFSET.position.y + shoulderOffset,  // pivot at shoulders
  PILOT_OFFSET.position.z,
)
pilotModel.position.set(0, -shoulderOffset, 0)  // model hangs from pivot
```

Per-frame rotation in `main.ts`:
```typescript
currentModel.pilotPivot.rotation.x = state.pilotPitch * DEG2RAD
```

Positive pitch = feet forward (aft swing), negative = head forward (forward
swing).

#### 5. Mass Segments — Unchanged

Mass segment positions stay fixed regardless of pilot pitch. Only recomputed
on polar change. The `rotatePilotMass()` helper remains in `polar-data.ts` but
is not called.

#### 6. Sweep & Readout

- `sweepKey()` appends `|pp:${s.pilotPitch}` so charts update on slider change
- `buildSegmentControls()` sets `ctrl.pilotPitch = state.pilotPitch` in canopy mode

#### 7. CG Centering — Bug Fix

`applyCgFromMassSegments()` was refactored to use absolute positioning:
- Captures `baseModelPos` and `baseBridlePos` on first call
- Subsequent calls set `position = base - cgOffset` instead of `position -= cgOffset`
- Added `baseModelPos` and `baseBridlePos` fields to `LoadedModel` interface

---

## Implementation — Completed Phases

### Phase 1 — Data Model & UI Slider ✅

Added `pilotPitch` to `SegmentControls`, `FlightState`, `defaultControls()`.
Added slider HTML, wired reading and event listener. Added to `sweepKey()`
and `buildSegmentControls()`. 69/69 tests pass.

### Phase 2 — 3D Model Pivot ✅

Created `pilotPivot` group in `model-loader.ts` with shoulder-level origin.
Added `pilotPivot?: THREE.Group` to `LoadedModel`. Per-frame rotation in
`main.ts`. 69/69 tests pass.

### Phase 3 — Aero Dynamic Pitch Offset ✅

Both factories update `pitchOffset_deg` dynamically from `controls.pilotPitch`.
No position rotation (removed after testing showed coordinate system mismatch).
69/69 tests pass.

### Phase 4 — Mass Segments ✅ (Simplified)

Original plan called for mass rotation + CG recomputation. Removed entirely —
mass stays at pitch=0 configuration. The `rotatePilotMass()` helper exists but
is unused. 69/69 tests pass.

### Phase 5 — Vectors Verification ✅

Confirmed `vectors.ts` already reads `seg.pitchOffset_deg` dynamically. No code
changes needed. Small CP arrows stay at fixed pilot position, which is correct
given no position rotation.

---

## Risks Encountered & Resolved

| Risk | What Happened | Resolution |
|------|---------------|------------|
| Sign convention confusion (Three.js vs NED) | Positive rotation about Three.js X rotates Y→Z, correct for pilot pitch | `pilotPivot.rotation.x = pilotPitch * DEG2RAD` (no sign flip needed) |
| Pilot pivot at wrong point (belly vs shoulders) | Initial attempt placed pivot at model geometric center; pilot rotated about its waist | Offset pilot mesh down 10% of body extent within pivot, compensated pivot position up by same amount |
| CG recomputation broke model positioning | `applyCgFromMassSegments` used `-=` incremental shifts; repeated calls caused model to fly apart | Refactored to absolute positioning with stored base positions |
| Mass rotation coordinate mismatch | NED mass rotation about canopy origin ≠ Three.js visual rotation about riser point | Removed mass rotation entirely — negligible physical effect |
| Aero position rotation mismatch | Same NED vs Three.js pivot point issue caused small arrows to detach from model | Removed position rotation — only pitchOffset_deg changes |
| Slider not triggering updates | `pilotPitchSlider` was missing from the `input` event listener array | Added to the slider event loop |

---

## Non-Goals (This Project)

- **Dynamic pitch simulation** — This project adds a manual slider. Automatic
  pendulum dynamics (solving the ODE for pilot swing) is future work.
- **Lateral body rotation** — Only pitch (fore/aft) is implemented. Roll and
  yaw of the pilot body relative to the canopy are not modeled.
- **Deployment** — Pilot pitch during deployment is a separate project that
  builds on this infrastructure.
- **Wingsuit standalone pitch** — The pitch slider only appears in canopy mode.
  For standalone wingsuit/skydiver polars, the existing body-frame attitude
  sliders already control orientation.

---

## File Change Summary

| File | Changes |
|------|---------|
| `continuous-polar.ts` | Added `pilotPitch: number` to `SegmentControls` |
| `aero-segment.ts` | Added `pilotPitch: 0` to `defaultControls()` |
| `index.html` | Added pilot pitch slider (-180° to +180°) in `canopy-controls-group` |
| `controls.ts` | Added `pilotPitch` to `FlightState`, slider reading, label update, event listener |
| `main.ts` | Wired `pilotPitch` to `SegmentControls`, `sweepKey()`, `pilotPivot.rotation.x` |
| `segment-factories.ts` | Dynamic `pitchOffset_deg` in both pilot factories (no position rotation) |
| `model-loader.ts` | Pilot pivot group with shoulder offset, `pilotPivot` + `baseModelPos` + `baseBridlePos` on `LoadedModel`, absolute CG positioning |
| `polar-data.ts` | Added `rotatePilotMass()` helper (exists but unused — available for future use) |
| `index.ts` | No changes needed (rotatePilotMass export removed after simplification) |
| `vectors.ts` | No changes needed — reads dynamic `pitchOffset_deg` automatically |

---

## Resolved Questions

1. **Slider placement**: Inside `canopy-controls-group` after weight shift.
   Shares the existing show/hide logic. ✅

2. **Slider range**: **-180° to +180°**. Full range needed for deployment and
   dynamic movement — the pilot can be in any orientation relative to the
   canopy during opening and transitions. ✅

3. **Mass segment rotation**: **Not needed.** The CG-to-riser distance is small
   enough that mass redistribution from pilot pitch is negligible. Mass stays
   at pitch=0 configuration. ✅

4. **Trim angle interaction**: Keep the 6° trim baked into mass positions.
   Slider at 0° = current state. The trim angle is a structural property, not
   a flight control. Pilot pitch adds an incremental rotation on top (aero
   only). ✅

5. **Performance**: No CG/inertia recomputation on pitch change — only the aero
   coefficient evaluation changes, which is already in the hot path. ✅

6. **Pivot point**: At the pilot's shoulders, not geometric center. Achieved by
   offsetting the pilot mesh 10% of body extent down within the pivot group,
   with compensating upward shift of the pivot position. ✅

7. **Position rotation**: **Not needed.** Removing NED position rotation
   eliminates coordinate system mismatches between the aero model (NED, rotates
   about canopy centroid) and the visual model (Three.js, rotates about
   shoulder pivot). ✅

---

## Test Results

All 69 tests pass at every phase. No new tests were added — existing tests
exercise `pilotPitch = 0` (default), which reproduces the pre-implementation
behavior exactly.
