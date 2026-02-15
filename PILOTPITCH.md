# Pilot Pitch — Planning Document

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
1. Pilot Pitch (this document)
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
- The force vectors on the pilot segment must rotate with the pilot body so
  they remain visually attached to the 3D model.
- Mass segment positions should rotate with the pilot body about the riser
  attachment point, which shifts the system CG and changes moments of inertia.

---

## Architecture Audit — Current State

### Aero Segment (Pilot)

| Item | Value | Location |
|------|-------|----------|
| Segment name | `'pilot'` | `polar-data.ts` `makeIbexAeroSegments()` |
| Position (NED norm) | `{ x: 0.38, y: 0, z: 0.48 }` | `polar-data.ts` `PILOT_POSITION` |
| `pitchOffset_deg` | `90` | `polar-data.ts` `PILOT_PITCH_OFFSET` |
| Factory (wingsuit) | `makeUnzippablePilotSegment()` | `segment-factories.ts` L207–243 |
| Factory (slick) | `makeLiftingBodySegment()` | `segment-factories.ts` L140–186 |
| α transform | `localAlpha = alpha_deg - pitchOffset_deg` | Both factories |
| CP direction | Rotated by `pitchOffset_deg` in x-z plane | `aero-segment.ts` L220, `vectors.ts` L340 |

### 3D Model (Pilot)

| Item | Value | Location |
|------|-------|----------|
| GLB offset | `(0, -0.540, 0)` Three.js coords | `model-loader.ts` `PILOT_OFFSET.position` |
| GLB rotation | `(-π/2, 0, 0)` — prone → hanging | `model-loader.ts` `PILOT_OFFSET.rotation` |
| Scene parent | Direct child of `compositeRoot` | `model-loader.ts` L133 |
| Pivot group | **None** — no intermediate group exists | — |
| Storage | Not stored on `LoadedModel` | — |

### Mass Segments (Pilot Body)

| Item | Value | Location |
|------|-------|----------|
| 14 body parts | head, torso, arms, legs (mirrored) | `polar-data.ts` L521–560 |
| Base offsets | `PILOT_FWD_SHIFT = 0.28`, `PILOT_DOWN_SHIFT = 0.163` | `polar-data.ts` L528–529 |
| Trim rotation | 6° forward about riser origin | `polar-data.ts` L550–558 |
| Riser origin | NED (0, 0, 0) — pilot hangs below (+z) | By convention |

### Controls

| Item | Current | Location |
|------|---------|----------|
| `SegmentControls.pilotPitch` | **Does not exist** | `continuous-polar.ts` |
| `FlightState.pilotPitch` | **Does not exist** | `controls.ts` |
| UI slider | **Does not exist** | `index.html` |

### Vectors

| Item | Detail | Location |
|------|--------|----------|
| Segment CP position | Rotated by `seg.pitchOffset_deg` in x-z plane | `vectors.ts` L340, `aero-segment.ts` L220 |
| Force directions | From wind frame — NOT rotated by pitch offset | `vectors.ts` L350+ |
| Moment arm cross product | Uses CP position (includes pitch offset) vs CG | `aero-segment.ts` L225–240 |

---

## Design

### Scope

Pilot pitch is a **UI control** that:
1. Rotates the 3D pilot model about the riser attachment point.
2. Changes the pilot segment's effective `pitchOffset_deg` (aero).
3. Rotates the pilot's mass segment positions about the riser origin (shifts CG).
4. Keeps force/moment vectors visually consistent with the rotated model.

### What Changes

#### 1. Data Model — `SegmentControls` + `FlightState`

Add `pilotPitch` field to `SegmentControls` (in `continuous-polar.ts`):
```typescript
export interface SegmentControls {
  // ... existing fields ...
  pilotPitch: number  // pilot pitch angle [0–1 normalized], 0 = hanging vertical
}
```

Add to `FlightState` (in `controls.ts`):
```typescript
export interface FlightState {
  // ... existing fields ...
  pilotPitch: number  // degrees, raw slider value
}
```

Add to `defaultControls()` (in `aero-segment.ts`):
```typescript
pilotPitch: 0,
```

**Decision: Units and range.**
- The slider should show degrees (intuitive for the user).
- Range: **-30° to +30°**. Negative = pilot pitched forward (nose down
  relative to canopy), positive = pilot pitched aft (nose up / feet forward).
- Zero = hanging vertically (current default).
- `SegmentControls.pilotPitch` carries the raw degree value (not 0–1).
  This is consistent with how `weightShiftLR` is already carried as a raw
  slider value, and avoids a unit conversion in every consumer.

#### 2. UI — Pilot Pitch Slider

Add a new slider in `index.html` inside the `canopy-controls-group`, after the
weight shift slider:

```html
<div class="control-group" id="pilot-pitch-group">
  <label>Pilot Pitch: <span id="pilot-pitch-value">0°</span></label>
  <input type="range" id="pilot-pitch-slider" min="-30" max="30" value="0" step="1" />
</div>
```

Show/hide logic in `controls.ts`:
- Visible when `modelType === 'canopy'` (both wingsuit and slick pilots).
- Hidden for wingsuit, skydiver, airplane polars.
- Same show/hide pattern as the canopy controls group.

Wire in `buildSegmentControls()` in `main.ts`:
```typescript
if (state.modelType === 'canopy') {
  ctrl.pilotPitch = state.pilotPitch
}
```

#### 3. Aero — Dynamic Pitch Offset

Both `makeLiftingBodySegment()` and `makeUnzippablePilotSegment()` currently
apply a fixed `pitchOffset_deg`:

```typescript
const localAlpha = alpha_deg - pitchOffset_deg
```

With pilot pitch control, these factories need to read `controls.pilotPitch`
and add it to the pitch offset:

```typescript
const effectivePitchOffset = pitchOffset_deg + controls.pilotPitch
const localAlpha = alpha_deg - effectivePitchOffset
```

They must also update `this.pitchOffset_deg` dynamically so that downstream
consumers (vectors.ts, aero-segment.ts) see the correct pitch offset for CP
position and moment arm calculations:

```typescript
this.pitchOffset_deg = pitchOffset_deg + controls.pilotPitch
```

**No new factory parameters needed** — the `pilotPitch` comes through the
existing `controls: SegmentControls` argument that `getCoeffs()` already
receives.

#### 4. Aero Segment Position — Dynamic Pivot

The pilot segment's NED position is currently static:
```typescript
PILOT_POSITION = { x: 0.38, y: 0, z: 0.48 }
```

When the pilot pitches, the body swings about the riser attachment point
(NED origin). The position should rotate in the x-z plane:

```typescript
// Inside getCoeffs(), after computing effectivePitchOffset:
const pitchDelta = controls.pilotPitch * DEG2RAD
const cos_p = Math.cos(pitchDelta)
const sin_p = Math.sin(pitchDelta)
// Rotate the base position about the riser origin (0,0,0) in the x-z plane
this.position.x = baseX * cos_p - baseZ * sin_p
this.position.z = baseX * sin_p + baseZ * cos_p
```

Where `baseX` and `baseZ` are the original (un-rotated) position values,
captured in the factory closure.

This dynamically moves the pilot segment's application point as the pilot
swings, correctly shifting the moment arm in `sumAllSegments()`.

#### 5. 3D Model — Pilot Pivot Group

**Current problem:** The pilot GLB is a direct child of `compositeRoot` with no
intermediate group. We can't rotate just the pilot without rotating the canopy.

**Solution:** Insert a `THREE.Group` (the "pilot pivot") between `compositeRoot`
and the pilot GLB. This group's origin is at the riser attachment point, so
rotating it about the Three.js X-axis (which corresponds to NED pitch) swings
the pilot body.

In `model-loader.ts`:

```typescript
// Create pilot pivot at riser attachment point
const pilotPivot = new THREE.Group()
pilotPivot.name = 'pilot-pitch-pivot'
// Pivot is at the riser attachment Y position
pilotPivot.position.copy(PILOT_OFFSET.position)

const pilotModel = await loadRawGltf(PILOT_PATHS[pilotType])
// Pilot position is now relative to pivot (which is already at riser point)
// So the pilot mesh sits at origin of the pivot group
pilotModel.position.set(0, 0, 0)
pilotModel.rotation.copy(PILOT_OFFSET.rotation)
pilotPivot.add(pilotModel)

compositeRoot.add(pilotPivot)
```

Store the pivot on `LoadedModel`:
```typescript
export interface LoadedModel {
  // ... existing fields ...
  /** Pivot group for pilot body pitch rotation (only for canopy) */
  pilotPivot?: THREE.Group
}
```

Per-frame rotation in `main.ts`:
```typescript
if (currentModel?.pilotPivot && state.modelType === 'canopy') {
  // Three.js X rotation = NED pitch (nose down = negative X = positive pitch angle)
  currentModel.pilotPivot.rotation.x = -state.pilotPitch * DEG2RAD
}
```

**Note:** The sign convention must be verified visually. The Three.js coordinate
system has Y-up, and the pilot's `-π/2` X rotation already turns the model from
prone to hanging. An additional X rotation will pitch the hanging body fore/aft.
Positive `pilotPitch` (aft) should rotate the feet forward — this corresponds to
a **negative** X rotation in Three.js (right-hand rule around +X points the
pilot's feet toward -Z, which is forward in the canopy frame).

#### 6. Mass Segments — Dynamic CG Shift

The 14-part pilot mass model has positions relative to the riser origin. When the
pilot pitches, these positions should rotate in the NED x-z plane by the same
angle as the aero segment position.

**Two approaches:**

**A. Recompute on every frame** — Rotate the raw `CANOPY_PILOT_RAW` positions by
`(TRIM_ANGLE + pilotPitch)` instead of just `TRIM_ANGLE`, rebuild the mass
segment array, recompute CG + inertia. Clean but expensive per-frame.

**B. Apply a delta rotation to the existing segments** — The current mass
segments are already rotated by 6° trim. The pilot pitch adds an incremental
rotation. We can apply the incremental rotation to the existing mass positions:

```typescript
const delta = pilotPitch * DEG2RAD
const cos_d = Math.cos(delta)
const sin_d = Math.sin(delta)
const rotated = CANOPY_PILOT_SEGMENTS.map(seg => ({
  ...seg,
  normalizedPosition: {
    x: seg.normalizedPosition.x * cos_d - seg.normalizedPosition.z * sin_d,
    y: seg.normalizedPosition.y,
    z: seg.normalizedPosition.x * sin_d + seg.normalizedPosition.z * cos_d,
  }
}))
```

This incremental rotation happens about the origin (riser point), which is
correct since the trim rotation was already applied about the same point.

**Recommendation: Approach B.** The rotation is cheap (14 multiplies/adds) and
can be done in `buildSegmentControls()` or a helper called alongside it. Only
recompute CG + inertia when `pilotPitch` actually changes (cache the last value).

**When the CG shifts:**
- `applyCgFromMassSegments()` must be called again (shifts the 3D model).
- `cgOffsetThree` updates, which vectors.ts already reads.
- The `massOverlay.group.position` must update (already wired in main.ts).

---

## Implementation Plan

### Phase 1 — Data Model & UI Slider

**Files:** `continuous-polar.ts`, `aero-segment.ts`, `controls.ts`, `index.html`

1. Add `pilotPitch: number` to `SegmentControls` interface.
2. Add `pilotPitch: 0` to `defaultControls()`.
3. Add `pilotPitch: number` to `FlightState` interface.
4. Add pilot pitch slider HTML inside `canopy-controls-group`.
5. Wire slider reading in `readState()` — `pilotPitch: parseFloat(pilotPitchSlider.value)`.
6. Show/hide the slider group: visible when `modelType === 'canopy'`, hidden otherwise.
7. Wire `buildSegmentControls()` in `main.ts`: `ctrl.pilotPitch = state.pilotPitch`.
8. Add `pilotPitch` to `sweepKey()` so chart/readout updates on slider change.

**Tests:** Existing tests should still pass (default `pilotPitch = 0`).

### Phase 2 — 3D Model Pivot

**Files:** `model-loader.ts`, `main.ts`

1. In `loadModel()`, wrap the pilot GLB in a `pilotPivot` group positioned at
   `PILOT_OFFSET.position`.
2. Add `pilotPivot?: THREE.Group` to `LoadedModel` interface.
3. Return `pilotPivot` from `loadModel()`.
4. In `main.ts` render loop, rotate `pilotPivot.rotation.x` based on
   `state.pilotPitch`.
5. Verify sign convention visually — positive pilotPitch should swing feet forward.

**Tests:** Visual verification. No aero changes yet.

### Phase 3 — Aero: Dynamic Pitch Offset

**Files:** `segment-factories.ts`

1. In `makeLiftingBodySegment()` `getCoeffs()`:
   - Read `controls.pilotPitch`.
   - Compute `effectivePitchOffset = pitchOffset_deg + controls.pilotPitch`.
   - Use `alpha_deg - effectivePitchOffset` for `localAlpha`.
   - Update `this.pitchOffset_deg = effectivePitchOffset`.
2. Same changes in `makeUnzippablePilotSegment()` `getCoeffs()`.
3. Rotate `this.position` in x-z plane by `controls.pilotPitch` about the
   riser origin (NED 0,0,0).
4. Capture base position in factory closure for per-frame rotation.

**Tests:** Add test cases:
- `pilotPitch = 0` → same results as before.
- `pilotPitch = 10` → α_local shifts by 10°, position rotates.
- Verify moment arm changes appropriately.

### Phase 4 — Mass Segments: Dynamic CG

**Files:** `polar-data.ts`, `main.ts`

1. Export `CANOPY_PILOT_SEGMENTS` (or a helper) so main.ts can rotate them.
2. Create `rotatePilotMass(pilotPitch_deg)` → returns rotated mass array.
3. In `main.ts`, when `pilotPitch` changes:
   - Build rotated mass segments.
   - Rebuild combined weight/inertia segment arrays.
   - Recompute CG via `computeCenterOfMass()`.
   - Call `applyCgFromMassSegments()` to shift model.
   - Recompute inertia via `computeInertia()` / `calculateInertiaComponents()`.
4. Cache the last `pilotPitch` value to avoid redundant recomputation.

**Tests:** Verify CG shifts correctly with pitch. At 0° pitch, results unchanged.

### Phase 5 — Force Vectors Consistency

**Files:** `vectors.ts` (probably no changes needed)

The vector system already reads `seg.pitchOffset_deg` and `seg.position`
dynamically from the segment objects. If Phase 3 correctly updates these
properties in `getCoeffs()`, the vectors should follow automatically.

**Verify:**
1. Per-segment arrows (lift/drag/side on pilot) move with the rotated model.
2. CP offset direction tracks `pitchOffset_deg` changes.
3. System-level moment arcs reflect the shifted CG and changed moment arms.
4. Mass overlay points rotate with the pilot model (via updated mass segments).

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Sign convention confusion (Three.js vs NED) | Medium | Medium | Verify each axis mapping visually; add comments |
| CG recomputation per-frame is expensive | Low | Low | Cache + only recompute when slider changes |
| Pilot pivot breaks CG centering offsets | Medium | High | Test CG centering with pitch at 0°, ±30° |
| Moment arms wrong after position rotation | Medium | High | Unit test: r × F for known positions/angles |
| Force vector arrows detach from model | Low | Medium | Already dynamic — just verify visually |
| Mass overlay points don't rotate with model | Low | Medium | Rebuild mass arrays when pitch changes |

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
| `continuous-polar.ts` | Add `pilotPitch` to `SegmentControls` |
| `aero-segment.ts` | Add `pilotPitch: 0` to `defaultControls()` |
| `index.html` | Add pilot pitch slider in `canopy-controls-group` |
| `controls.ts` | Add `pilotPitch` to `FlightState`, read slider, show/hide |
| `main.ts` | Wire `pilotPitch` to `SegmentControls`, rotate pivot, handle mass rotation |
| `segment-factories.ts` | Dynamic `pitchOffset_deg` and position rotation in both pilot factories |
| `model-loader.ts` | Pilot pivot group, `pilotPivot` on `LoadedModel` |
| `polar-data.ts` | Export pilot mass data, add rotation helper |
| `vectors.ts` | Probably no changes (verify only) |
| `index.ts` | Export any new types/helpers |

---

## Open Questions

1. **Slider placement**: Inside `canopy-controls-group` after weight shift, or
   in a separate group? Placing it inside canopy controls keeps it near related
   inputs and shares the show/hide logic. **Proposed: inside canopy-controls-group.**

2. **Slider range**: -30° to +30° seems reasonable for normal flight. During
   deployment the swing could be larger (±60°?). Should we use the wider range
   now, or expand it for the deployment project? **Proposed: ±30° now, widen later.**

3. **Mass segment rotation**: Should the canopy structure mass segments (the 7
   cells) also be affected by pilot pitch? **Proposed: No.** Only the pilot body
   segments rotate. The canopy stays fixed — it's the pilot swinging relative to
   the canopy, not the other way around.

4. **Trim angle interaction**: The current 6° trim rotation is baked into the
   mass positions. Pilot pitch adds an incremental rotation on top. Should we
   remove the baked-in trim and make it part of the pilotPitch default value
   (i.e. default slider = 6° instead of 0°)? **Proposed: Keep trim baked in,
   slider at 0° = current state.** The trim angle is a structural property, not
   a flight control.

5. **Performance**: Recomputing CG + inertia on every pitch slider change
   involves ~20 mass segments and some trig. Is this fast enough for real-time
   slider dragging? **Likely yes** — the same computation already runs on model
   load. Cache the result and only recompute when the slider value changes.
