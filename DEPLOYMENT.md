# DEPLOYMENT — Canopy Deployment Sequence Planning Document

## Goal

Add a single **deployment slider** (0 → 1) that controls the state of canopy deployment from **line stretch** to **full flight**. At `deploy = 0` the canopy is a collapsed bundle with minimal surface area and 1/10th horizontal scale. At `deploy = 1` the canopy is fully inflated — identical to current normal flight.

The slider drives coordinated changes across three systems:
1. **3D model** — canopy mesh horizontal scale
2. **Aerodynamics** — surface area, chord length, cell coefficients, segment positions
3. **Vector rendering** — arrows track the dynamically-scaled segments

---

## Reference: CloudBASE Deployment System

The existing CloudBASE deployment (`simulatorcanopycontrol.ts`) uses a complex time-sequenced deployment with stages (reach, grab, pitch, bridal stretch, line stretch, inflation, etc.) and two independent interpolants:

| Parameter | CloudBASE name | What it controls |
|-----------|---------------|-----------------|
| Surface area fraction | `deploysurfacearea` (0.147 → 1) | Scales `polar.s` — total canopy area |
| Inflation fraction | `deployinflation` (0 → 1) | Blends deploy-polar → flight-polar coefficients (CL, CD, CP, CM) |

The CloudBASE system also tracks a separate **deploy chord** that shrinks with surface area:
```
deploychord = deploysa / √(deploysa × AR)
```
where `AR = fullspan / totalchordlength`.

### What we borrow

- Surface area ramps from a small fraction (~0.147) to 1.0
- Aerodynamic coefficients morph from a "deploy polar" (more drag, less lift) to the full-flight polar
- Chord length shortens proportionally with the horizontal scale
- The concept that deployment can be captured with two primary fractions (area + inflation)

### What we do differently

- **Single slider** instead of time-sequenced stages — the visualizer is a static analyzer, not a time-domain sim
- **Per-segment deployment** — our multi-segment model automatically captures effects that CloudBASE computes manually (individual cell forces, CP distribution, moments)
- **No separate deploy-polar needed** — we'll morph the existing cell polar's properties (cd_0, cl_alpha, etc.) rather than maintaining a parallel polar table
- **3D model scales visually** — CloudBASE has no 3D canopy model

---

## The Deployment Slider

### Range and semantics

| Value | State | Description |
|-------|-------|-------------|
| `0.0` | Line stretch | Canopy is a collapsed bundle. Minimal surface area (~15% of full). Horizontal model scale = 0.1×. |
| `0.5` | Mid-inflation | Canopy is partially inflated. ~58% surface area. Drag-heavy polar. |
| `1.0` | Full flight | Normal canopy flight. Full surface area. Full horizontal scale. Current behavior. |

### Control name

`deploy` — added to `SegmentControls`:

```typescript
export interface SegmentControls {
  // ... existing fields ...
  deploy: number   // 0 = line stretch, 1 = fully deployed
}
```

### Slider UI

Added to the canopy controls group (above or below pilot pitch):

```
Deploy  ═══════════●══  0.85
```

Range: 0 to 1, step 0.01, default 1.0 (fully deployed — preserves current behavior).

---

## System 1: 3D Model Scaling

### What changes

At `deploy = 0` (line stretch), the canopy model is scaled to **0.1× horizontal** and **1.0× vertical** relative to normal. The screenshot from the Three.js editor shows this configuration:

```
Scale:  X = 0.100,  Y = 1.000,  Z = 0.100
```

In the Three.js coordinate system (where Y is up), this means:
- **X** (lateral / span) → 0.1× at line stretch
- **Y** (vertical / up-down) → 1.0× always
- **Z** (fore-aft / flight direction) → 0.1× at line stretch

### How it's applied

The canopy GLB mesh (`mainModel` inside `compositeRoot`) already has a `CANOPY_SCALE = 1.5` applied. The deployment scaling is an **additional** transform on top:

```typescript
// In the render/update path:
const hScale = lerp(0.1, 1.0, deploy)  // horizontal scale factor
mainModel.scale.set(
  CANOPY_SCALE * hScale,   // X (lateral)
  CANOPY_SCALE * 1.0,      // Y (vertical) — always full height
  CANOPY_SCALE * hScale,   // Z (fore-aft)
)
```

Linear interpolation is intentional — the simulation consumer needs a predictable mapping from `deploy` to scale. Real-world inflation dynamics (pressure curves, exponential fill) are captured by choosing appropriate `deploy` values at each timestep.

### What doesn't scale

- **Pilot model** — stays at full size (the pilot doesn't shrink)
- **Bridle and PC** — stays at full size (lines don't get shorter)
- **Pilot pivot / attachment point** — stays fixed

### Scene graph recap

```
group (attitude rotation)
  └─ compositeRoot (CG offset)
       ├─ mainModel (canopy GLB) ← deployment scale applied here
       └─ pilotPivot
            └─ pilotModel
  └─ bridleGroup (sibling)
```

---

## System 2: Aerodynamic Scaling

The deployment slider affects aerodynamics through several coupled channels. All effects are applied inside the segment factories' `getCoeffs()` closures and in the segment construction, so the existing `computeSegmentForce()` / `sumAllSegments()` pipeline works unchanged.

### 2.1 Surface Area — `S`

Each canopy cell's reference area scales with `deploy`:

```
S_cell(deploy) = S_cell_full × areaFraction(deploy)
```

The area fraction maps `deploy` to a physical area ratio. Since horizontal scale is squared for area:

```
areaFraction(deploy) = hScale² = lerp(0.1, 1.0, deploy)²
```

At `deploy = 0`: `areaFraction = 0.01` (1% of full area)
At `deploy = 1`: `areaFraction = 1.0` (100%)

**Wait** — the CloudBASE system starts at `0.147` surface area fraction at line stretch, not `0.01`. This is because even the collapsed bundle has some frontal area. The `0.1` horizontal scale gives a geometric area of `0.01`, but the aerodynamic surface area should likely be higher than that because the fabric forms a streamer-like shape.

**Decision needed**: Should `areaFraction` follow geometric scaling (`hScale²`) or use an independent mapping? The geometric approach is physically consistent — the model *looks* like its area at any deployment point. A higher aerodynamic area would mean the model is visually smaller than its aerodynamic footprint.

**Proposed**: Use geometric scaling (`hScale²`) for simplicity and visual consistency. The `cd_0` inflation penalty (§2.3) compensates for the lost drag at low deployment by boosting the drag coefficient.

### 2.2 Chord Length — `chord`

Cell chord scales linearly with horizontal scale:

```
chord(deploy) = chord_full × hScale = chord_full × lerp(0.1, 1.0, deploy)
```

At `deploy = 0`: `chord = 2.5 × 0.1 = 0.25 m`
At `deploy = 1`: `chord = 2.5 m`

This chord change affects:
- Pitching moment computation: `M = q × S × chord × CM`
- CP position offset: `cpOffset = (cp - 0.25) × chord / REFERENCE_HEIGHT`
- In `sumAllSegments()`: lever arm for intrinsic moments

### 2.3 Aerodynamic Coefficients During Deployment

During deployment, the canopy isn't a proper airfoil — it's a collapsed fabric bundle that gradually takes shape. This requires morphing the aerodynamic coefficients:

| Coefficient | At `deploy = 0` (line stretch) | At `deploy = 1` (full flight) | Behavior |
|-------------|-------------------------------|-------------------------------|----------|
| `cd_0` | Elevated (~2× to 3×) | Normal (`0.035`) | High parasitic drag from flapping fabric |
| `cl_alpha` | Reduced (~30% of normal) | Normal (`3.0 /rad`) | Poor lift generation when uninflated |
| `alpha_0` | May shift | Normal (`-3°`) | Airfoil zero-lift angle changes with shape |
| `cd_n` | Elevated | Normal | More frontal drag from flat plate behavior |
| `alpha_stall_*` | Narrower range | Normal | Stalls earlier when uninflated |
| `cm_alpha` | Reduced | Normal | Less pitch stability |
| `cp_0`, `cp_alpha` | Different | Normal | CP moves as wing takes shape |

**Implementation approach**: Rather than maintaining a separate "deploy polar," we'll morph the cell polar parameters directly inside `getCoeffs()`:

```typescript
// Inside makeCanopyCellSegment getCoeffs():
const deploy = controls.deploy
const d = Math.max(0, Math.min(1, deploy))

// Morph polar parameters
const effectivePolar = {
  ...cellPolar,
  cd_0:    cellPolar.cd_0 * lerp(DEPLOY_CD0_MULT, 1, d),
  cl_alpha: cellPolar.cl_alpha * lerp(DEPLOY_CL_ALPHA_MULT, 1, d),
  // ... etc
}
```

Where `DEPLOY_CD0_MULT`, `DEPLOY_CL_ALPHA_MULT`, etc. are tuning constants.

### 2.4 Segment Positions

Cell positions in NED normalized coordinates must scale horizontally with deployment:

| Axis | At `deploy = 0` | At `deploy = 1` | Notes |
|------|-----------------|-----------------|-------|
| `x` (fwd) | `x_full × hScale` | `x_full` | Fore-aft chord collapses |
| `y` (right) | `y_full × hScale` | `y_full` | Span collapses |
| `z` (down) | `z_full` | `z_full` | Vertical position unchanged (lines keep height) |

This is consistent with the 3D model scaling (X and Z in Three.js → x and y in NED).

The segments are currently created once at segment-build time with fixed positions. With deployment, positions must be **dynamic** — updated per-frame based on `deploy`. Two approaches:

**Option A — Dynamic in `getCoeffs()`**: Each cell's `getCoeffs()` writes `this.position.x` and `this.position.y` based on `controls.deploy`. Brake flaps already do this for `this.position.x` (CP shift with brake), so the pattern exists.

**Option B — Rebuild segments**: Call `makeIbexAeroSegments()` with a deploy parameter. Simpler but allocates every frame.

**Proposed**: Option A — dynamic position update inside `getCoeffs()`. Store the full-flight position at factory call time, scale it per frame. This is zero-allocation and consistent with how brake flaps already work.

### 2.5 Brake Flap Geometry

Brake flaps derive their geometry from parent cell parameters:

```
maxFlapS = flapChordFraction × parentCellS
maxFlapChord = flapChordFraction × parentCellChord
maxCpShift = 0.25 × maxFlapChord / REFERENCE_HEIGHT
```

With deployment, `parentCellS` and `parentCellChord` are smaller, so flaps naturally shrink. Flap area and chord should scale with `deploy` just like the parent cells.

The flap trailing-edge positions also need horizontal scaling (same as cell positions — `x` and `y` scale by `hScale`, `z` stays fixed).

### 2.6 Parasitic Segments

Lines and pilot chute are physical objects that don't change size during deployment. Their `S`, `chord`, and positions are **unaffected** by the deploy slider.

The pilot segment (`lifting-body` or `unzippable-pilot`) is also unaffected — the pilot's body doesn't change during canopy deployment.

---

## System 3: Vector Rendering

Force arrows (`vectors.ts`) read `seg.position`, `seg.S`, `seg.chord`, `seg.pitchOffset_deg` and the computed force coefficients. Since all of these are updated dynamically by the factories (§2.4, §2.1, §2.2), the arrows will automatically:

- **Move inward** as cells collapse toward the center line
- **Shrink in magnitude** as `S` decreases and lift/drag forces reduce
- **Shift CP** as chord shortens

No changes needed in `vectors.ts` — it's already fully dynamic.

---

## Detailed Scaling Summary

For a deploy value `d` (0 → 1):

| Property | Formula | d=0 | d=0.5 | d=1 |
|----------|---------|-----|-------|-----|
| `hScale` | `lerp(0.1, 1.0, d)` | 0.10 | 0.55 | 1.00 |
| 3D model X,Z scale | `CANOPY_SCALE × hScale` | 0.15 | 0.825 | 1.50 |
| 3D model Y scale | `CANOPY_SCALE` | 1.50 | 1.50 | 1.50 |
| Cell `S` | `S_full × hScale²` | 0.029 m² | 0.88 m² | 2.92 m² |
| Cell `chord` | `chord_full × hScale` | 0.25 m | 1.375 m | 2.50 m |
| Cell `pos.x` | `x_full × hScale` | 0.017 | 0.096 | 0.174 |
| Cell `pos.y` | `y_full × hScale` | varies | varies | varies |
| Cell `pos.z` | `z_full` | −1.220 | −1.220 | −1.220 |
| Flap `maxFlapS` | `fraction × S_cell(d)` | tiny | mid | full |
| Flap `maxFlapChord` | `fraction × chord(d)` | tiny | mid | full |
| Parasitic `S` | unchanged | 0.35 | 0.35 | 0.35 |
| Pilot `S` | unchanged | 2.0 | 2.0 | 2.0 |

---

## Implementation Plan

### Phase 1: Data Model & UI Slider — COMPLETE

- [x] Add `deploy: number` to `SegmentControls` interface in `continuous-polar.ts`
- [x] Add `deploy: 1` to `defaultControls()` in `aero-segment.ts`
- [x] Add deployment slider HTML in `index.html` (canopy controls group, range 0–100%, step 1%, default 100%)
- [x] Wire slider reading in `controls.ts` — add to `FlightState`, label, event listener
- [x] Add to `sweepKey()` and `buildSegmentControls()` in `main.ts`
- [x] Add `deploy: 1` to `dummyControls()` in `debug-panel.ts`
- [x] Slider visible only in canopy mode (inside `canopy-controls-group`)

### Phase 2: 3D Model Scaling — COMPLETE

- [x] In `main.ts` update loop, apply horizontal scale to canopy mesh via `canopyModel` ref
- [x] Export `CANOPY_SCALE` from `model-loader.ts`, import in `main.ts`
- [x] Add `canopyModel?: THREE.Group` to `LoadedModel` interface
- [x] Pilot model and bridle are unaffected (separate scene graph nodes)

### Phase 3: Cell Segment Deployment Scaling — COMPLETE

- [x] In `makeCanopyCellSegment()`, store full-flight `S`, `chord`, `position.x`, `position.y` at factory time
- [x] Each frame: `this.S = fullS × hScale²`, `this.chord = fullChord × hScale`
- [x] Scale `this.position.x = fullX × hScale`, `this.position.y = fullY × hScale`
- [x] `position.z` unchanged — line length is constant

### Phase 4: Brake Flap Deployment Scaling — COMPLETE

- [x] In `makeBrakeFlapSegment()`, store full-flight flap geometry at factory time
- [x] Per-frame: `maxFlapS`, `maxFlapChord`, `maxCpShift` all scale with `hScale` / `hScale²`
- [x] Flap trailing-edge position scales horizontally (`x` and `y`)

### Phase 5: Coefficient Morphing (Inflation Effects) — COMPLETE

- [x] Define deployment tuning constants as exported module-level consts:
  - `DEPLOY_CD0_MULTIPLIER = 3.0` — cd_0 at deploy=0 is 3× normal
  - `DEPLOY_CL_ALPHA_FRACTION = 0.3` — cl_alpha at deploy=0 is 30% of normal  
  - `DEPLOY_CD_N_MULTIPLIER = 2.0` — cd_n at deploy=0 is 2× normal
- [x] Morph cell polar parameters in `getCoeffs()` via spread + lerp
- [x] Morph flap polar parameters identically
- [x] Both skip morphing when `deploy = 1` (no allocation, no perf cost)

### Phase 6: Testing & Validation — COMPLETE

- [x] `deploy = 1.0` produces identical results (69/69 tests pass, no regression)
- [x] All existing `defaultControls()` includes `deploy: 1`, all test code inherits it
- [x] No TS compile errors across workspace

---

## Resolved Questions

### Q1: Area fraction — GEOMETRIC (`hScale²`)

The 3D model already shows the visual area. Using an independent (higher) aerodynamic area would create a visual mismatch where the model looks small but flies big. The `cd_0` inflation penalty compensates for the drag difference.

### Q2: Deployment coefficient morphing — START MINIMAL

Start with `cd_0`, `cl_alpha`, and `cd_n` as the primary deployment effects. Add more only if validation against CloudBASE shows gaps.

### Q3: Mass segments — DEFERRED

Mass segments may be reworked for both deployment and pilot pitch in a future pass. For now, mass segments are static and unaffected by deployment.

### Q4: Trim angle — NOT NEEDED

The steeper trim during deployment is a natural consequence of chord compression along the horizontal axis — the 6° trim angle gets steeper because the geometry compresses. This is handled automatically by the segment positions aligning with the 3D model. No explicit trim parameter needed.

### Q5: Canopy structure mass positions — DEFERRED

Same as Q3 — deferred to a future mass segment rework.

### Q6: Deploy slider visibility — CANOPY ONLY

The deploy slider only appears for canopy mode, hidden when `modelType !== 'canopy'`, just like brakes/risers.

---

## Affected Files

| File | Changes |
|------|---------|
| `continuous-polar.ts` | Add `deploy: number` to `SegmentControls` |
| `aero-segment.ts` | Add `deploy: 1` to `defaultControls()` |
| `index.html` | Add deployment slider (canopy controls group) |
| `controls.ts` | Add `deploy` to `FlightState`, slider wiring, label |
| `main.ts` | Wire deploy to controls, sweep key, 3D model scaling |
| `model-loader.ts` | Possibly expose `mainModel` reference for scaling (or handle in main.ts) |
| `segment-factories.ts` | Dynamic S, chord, position in `makeCanopyCellSegment()` and `makeBrakeFlapSegment()` based on `controls.deploy` |
| `polar-data.ts` | No changes expected (segment construction unchanged) |
| `vectors.ts` | No changes expected (already reads dynamic seg properties) |
| `debug-panel.ts` | Add `deploy: 1` to `dummyControls()` |
| `chart-data.ts` | No changes expected |

---

## Export Considerations

The `deploy` control is a **runtime input** — not exported as system data. The export system (OUTPUT.md) captures the fully-deployed state. Consumers that want deployment behavior need:

1. The segment factories (which read `controls.deploy`)
2. Knowledge of the deployment scaling rules (this document)

The `deploy` field will be added to `SegmentControls`, so the export schema's `activeControls` list will include it. The `AeroSegmentDescriptor` and polar data are unchanged — they describe the fully-deployed configuration.
