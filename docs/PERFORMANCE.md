# PERFORMANCE.md — Sim Loop Performance Analysis & Fix Plan

_Session: 2026-06-22. Based on Chrome DevTools profiling, 3 scenarios with speed chart active._

---

## Measured Baselines

### Scenario 1 — Sim running, speed chart, no input
| Metric | Value | Target |
|--------|-------|--------|
| Frame rate | **9.4 fps** | 60 fps |
| Avg frame time | 106 ms | 16.7 ms |
| p50 frame time | 99 ms | — |
| p95 frame time | 203 ms | — |
| Max frame time | 273 ms | — |
| Forced reflow (28s trace) | 1,713 ms | 0 ms |

### Scenario 2 — Sim running, speed chart, keyboard pitch+roll held
| Metric | Value |
|--------|-------|
| Frame rate | **6.4 fps** |
| Avg frame time | 155 ms |
| p95 frame time | 334 ms |
| Max frame time | 470 ms |
| Forced reflow (34s trace) | 1,782 ms |

### Scenario 3 — Sim running, speed chart, gamepad pitch+roll+yaw
| Metric | Value |
|--------|-------|
| Frame rate | **6.7 fps** |
| Avg frame time | 149 ms |
| p95 frame time | 297 ms |
| Max frame time | 344 ms |
| Forced reflow (32s trace) | 1,895 ms |

### Sim stopped (idle render loop)
| Metric | Value |
|--------|-------|
| Frame rate | **60.0 fps** (perfect) |
| Avg frame time | 16.67 ms |
| p95 frame time | 18.5 ms |

### Key derived facts
- **The render loop itself is not the problem.** With sim stopped, `animate()` runs at a
  perfect 60fps / 16.7ms. Three.js rendering is fast.
- **The sim tick is the entire problem.** Adding the sim adds ~89ms of CPU work per rAF
  frame, collapsing fps from 60 → 9.4.
- **Keyboard is worse than gamepad.** Keyboard gives binary 0/1 axes so controls change
  more aggressively each frame; sweep key dirtier more often.
- **The sim is running at 0.5× real time** — simulated time advances 1s per 2s wall time.
  This means the 10-step spiral-of-death cap (MAX_STEPS_PER_FRAME = 10) is hit *every
  frame*. Instead of the normal ~3.33 steps/frame, every frame runs 10 steps. The slow
  frames cause the cap to be hit, which causes more lag, which causes slow frames — a
  reinforcing loop.
- **Chart math itself is fast.** A single `updateChartSweep` triggered by a slider
  (measured in isolation with no preceding DOM write) takes ~0.17ms. The 89ms overhead
  does not come from the sweep math.
- **The true cause is chart destroy + recreate on every frame** (see Issue 1 below).

### Chart JS cost breakdown per frame (baseline, no input)
| Source | Cost |
|--------|------|
| `rebuildChart1()` + `rebuildChart2()` destroy+new | ~17 ms |
| `_computeLabelSizes` forced reflow (per chart.update) | ~7 ms |
| Canvas draw: 720 segment-colored points × 2 charts | ~33 ms |
| Other (physics, vectors, readout) | ~3.5 ms |
| **Total** | **~60–70 ms** (observed 106ms includes GPU/vsync) |

_Note: original estimate of "55–70ms for destroy+recreate" was too high. Actual measurement
showed 17ms for the JS overhead of destroy+recreate (P1 savings). The dominant cost is the
canvas draw of 720 individually-colored line segments._

JS heap: 46 MB / 108 MB — not a GC problem.

---

## How the Frame Works

```
rAF fires (target 16.7ms budget)
│
├─ animate() in main.ts
│    ├─ tickDeployZoom()
│    ├─ updateGamepadOrbit()
│    ├─ controls.update()
│    └─ renderer.render()           ← Three.js draw call
│
└─ sim-runner.tick() [via its own rAF]
     ├─ getSimConfig()              ← called once per frame (see Issue 2)
     ├─ read gamepad / keyboard
     ├─ while (accumulator >= DT)  ← physics loop ~3.33× per frame at 200Hz/60fps
     │    ├─ rk4Step()             ← 4× computeDerivatives per step
     │    │    └─ evaluateAeroForces()  ← 7 segments × 4 = 28 calls per frame (normal)
     │    ├─ step deploy sub-sim
     │    └─ step bridle chain
     ├─ push to viewer via onUpdate()
     │    └─ updateVisualization() in main.ts    ← heavy — see issues below
     │         ├─ getOverriddenPolar()
     │         ├─ makeA5SegmentsAeroSegments()   ← Issue 3
     │         ├─ getSegmentPolarOverrides()     ← Issue 4
     │         ├─ rotatePilotMass()              ← conditional (canopy + pitch change)
     │         ├─ evaluateAeroForcesDetailed()   ← segment forces for display
     │         ├─ computeSegmentReadout()
     │         │    └─ sumAllSegments()          ← Issue 5a
     │         ├─ sumAllSegments() AGAIN         ← Issue 5b
     │         ├─ updateReadout()
     │         ├─ updateRatesReadout()
     │         ├─ updatePositionsReadout()
     │         ├─ updateForceVectors()
     │         ├─ new THREE.Matrix4()            ← Issue 6
     │         ├─ bodyQuat.clone().invert()      ← Issue 6
     │         ├─ new THREE.Vector3()            ← Issue 6
     │         └─ updateChartSweep/Cursor()      ← Issue 1 ← BIGGEST PROBLEM
     └─ requestAnimationFrame(tick)
```

**Key constraint:** `sim-runner.tick()` and `animate()` each run their own `rAF` loop.
They fire on the same frame but may not be perfectly in sync. The physics integration
runs inside `sim-runner.tick()`; rendering (Three.js draw) runs in `animate()`.
Both live on the main thread.

---

## Issues

---

### Issue 1 — Chart.js destroy+recreate on every frame [CRITICAL — ~55–70ms/frame]

**Root cause (confirmed from trace stack):**

Every frame the call chain is:
```
tick() → onUpdate() → updateVisualization() → updateChartSweep()
  → rebuildChart1()  → chart1.destroy() + new Chart(canvas, config)
  → rebuildChart2()  → chart2.destroy() + new Chart(canvas, config)
```

`rebuildChart1()` and `rebuildChart2()` each **destroy the existing Chart.js instance
and construct a brand-new one** (`new Chart(canvas, config)`) on every call. This is the
primary performance catastrophe. Creating a Chart.js instance involves:
- Allocating the chart object and all internal data structures
- Re-parsing all datasets (720 points × 2 datasets)
- Computing axis scales from scratch
- Laying out labels, title, grid lines
- Reading canvas dimensions via `getPositionedStyle` (forced reflow)
- Canvas 2D full redraw

At 60fps this results in **120 chart constructions per second** — the browser never has a
chance to paint.

**Why `rebuildChart1/2` is called every frame:** `sweepKey()` in main.ts includes
`airspeed`, `pitchThrottle`, `rollThrottle`, `yawThrottle`, `deploy`, etc. Every one of
these changes on every physics step. So `sweepKey` is always dirty → `updateChartSweep()`
fires every frame → `rebuildChart1() + rebuildChart2()` every frame.

**Sweep data size:** The sweep uses `step: 0.5` over `-180° to +180°` = **720 data points**
per polar curve. With 7 segments, each point requires 7 Kirchhoff evaluations plus
`sumAllSegments`. That's 5,040 coefficient evaluations per sweep call. Two sweeps (chart1 +
chart2 data) means ~10,080 evaluations — then both charts are destroyed and rebuilt.

**What makes this hard:**

1. **PNG capture requires 60fps chart updates.** The capture pipeline drives the sim
   frame-by-frame; charts must be fully rendered at each capture frame. A throttle would
   produce stale charts in captures.

2. **The polar really does change during flight.** Wingsuit pitch/roll/yaw throttles and
   canopy brakes/risers continuously reshape the polar. The sweep isn't cosmetic.

3. **Secondary: `getPositionedStyle` forced reflow.** Even after fixing the rebuild,
   `chart.update('none')` still reads `offsetWidth`. Measured at ~6ms/frame with
   `_computeLabelSizes` adding ~2ms/frame more. Must be fixed too but is secondary.

**The fix — update data in place, never rebuild:**

Chart.js is designed for live-updating data. The `rebuildChart1/2` pattern was created to
handle configuration changes (axis labels, view mode switches). It is not appropriate for
data-only updates.

Refactor `updateChartSweep` to:
1. Keep the chart instances alive — never destroy/recreate during data updates.
2. Update dataset data in place: `chart.data.datasets[0].data = newPoints`
3. Update point colors: `chart.data.datasets[0].pointBackgroundColor = newColors`
4. Call `chart.update('none')` — updates canvas pixels, skips animation.

`rebuildChart1/2` should only be called when the chart *configuration* changes: view mode
switch (CL/CD/CP/LD/CM or polar/speed), legacy toggle on/off, or initial creation.

**Secondary fix — `responsive: false`:**

After the in-place update fix, also set `responsive: false` and `maintainAspectRatio:
false` on both chart instances with explicit pixel dimensions. This prevents Chart.js from
reading `offsetWidth` on every `chart.update()` call, eliminating the remaining 8ms/frame
of forced reflow. Add a `window.resize` handler that calls `chart.resize(w, h)` manually.

**PNG capture compatibility:**

Both fixes are fully compatible with PNG capture:
- In-place updates: the chart canvas is updated every frame exactly as before, just
  without destroying/recreating the instance. Pixels are correct.
- `responsive: false`: canvas dimensions are static between resizes. PNG capture doesn't
  resize the window, so captures are pixel-identical to before.

---

### Issue 2 — `getSimConfig()` rebuilds mass/inertia/coupling every frame [HIGH]

**Where:** `sim-ui.ts startSim()` builds the `getSimConfig` callback. It is called once
per rAF frame from `sim-runner.tick()`. Inside, every frame:

```ts
const cgMeters  = computeCenterOfMass(polar.massSegments, massRef, polar.m)  // O(n)
const inertia   = computeInertia(...)                                          // O(n)
const coupling  = buildPilotCoupling(polar, state)                             // new object + Array.filter
```

**Constraint — mass distribution DOES change during flight:**

- **Canopy:** Pilot is a pendulum underneath the riser attachment. `thetaPilot` (pitch
  pendulum), `pilotRoll` (lateral weight shift), and `pilotYaw` (line twist) all evolve
  every step. `rotatePilotMass()` is called in `updateVisualization()` when pitch/deploy
  changes, which mutates `polar.massSegments`. This means `cgMeters` and `inertia` are
  genuinely different frame-to-frame during canopy flight.

- **Deployment:** During deployment, `deploy` fraction changes continuously, reshaping
  mass distribution and aerodynamic area.

- **Wingsuit:** Mass distribution is much more stable. `thetaPilot` is not used. Hip camber
  and leg bend do not currently move mass — only aero coefficients change.

**Refined fix:**

For the **wingsuit**: The polar key doesn't change during flight and mass segments don't
move — `cgMeters`, `inertia`, and `pilotCoupling` can be computed once at `startSim()`
and reused for the entire flight.

For the **canopy**: `cgMeters` and `inertia` should be recomputed when `polar.massSegments`
actually changes (i.e., when `rotatePilotMass()` runs — gated on pitch/deploy/height
change). Instead of rebuilding every frame, `getSimConfig` should read a cached
`currentInertia` and `currentCg` that are updated lazily by `updateVisualization()` when
mass actually moves. `main.ts` already has `currentInertia` — that value should be
threaded into `SimRunner` rather than recomputed independently in `getSimConfig`.

`buildPilotCoupling()` is worst-offender: it runs `Array.filter()` on mass segments every
frame and creates a new config object. The result does not change unless the polar or
vehicle changes. Cache it at `startSim()` and update only on vehicle switch.

---

### Issue 3 — `makeA5SegmentsAeroSegments()` creates 7 new objects every frame [MEDIUM]

**Where:** `main.ts updateVisualization()` line 444.

```ts
if (state.modelType === 'wingsuit' && basePolar.aeroSegments) {
  polar.aeroSegments = makeA5SegmentsAeroSegments()
}
```

**Why it exists:** The debug panel can override individual segment polars. The code clones
the segment array every frame so debug panel writes don't mutate the canonical
`a5segmentsContinuous.aeroSegments` object.

**Constraint — segment objects interact with controls:**

AeroSegment objects have closures that encode control sensitivity (`rollSensitivity`,
`side`, `getSegmentControls`). The gamepad and keyboard inputs flow through the
`SegmentControls` struct that is passed _into_ `computeSegmentForce` at evaluation time —
they do not mutate the segment objects themselves. The segment polars (`.polar`) and
geometry (`.S`, `.chord`, `.cp`, `.position`) are what the debug panel might override.

So the fix is safe: if no debug overrides are active, reuse the canonical segment array
directly. Only rebuild when `getSegmentPolarOverrides().size > 0`.

```ts
const segOvMap = getSegmentPolarOverrides()
if (state.modelType === 'wingsuit' && basePolar.aeroSegments) {
  polar.aeroSegments = segOvMap.size > 0
    ? makeA5SegmentsAeroSegments()   // fresh copy for debug mutations
    : basePolar.aeroSegments         // reuse canonical (read-only in normal flight)
}
```

Same pattern applies to `makeIbexAeroSegments()` for the canopy path.

---

### Issue 4 — `getSegmentPolarOverrides()` allocates a new `Map` every frame [LOW]

**Where:** `debug-panel.ts getSegmentPolarOverrides()`.

```ts
if (!panelVisible) return new Map()   // allocates even when panel is closed
```

**Fix:** Return a module-level singleton empty map:

```ts
const EMPTY_OVERRIDES: ReadonlyMap<string, Map<string, number>> = new Map()

export function getSegmentPolarOverrides() {
  if (!panelVisible) return EMPTY_OVERRIDES
  ...
}
```

---

### Issue 5 — `sumAllSegments()` called twice per frame [MEDIUM]

**Where:** `main.ts updateVisualization()`.

`computeSegmentReadout()` internally calls `sumAllSegments()` and returns `FullCoefficients`
but discards the `SystemForces` object. Immediately after, the rates readout block calls
`sumAllSegments()` again with the same segments, forces, and CG:

```ts
segReadout = computeSegmentReadout(..., cachedSegForces)  // sumAllSegments inside
// ...
const system = sumAllSegments(...)                        // again, same inputs
bodyAccel = { pDot: system.moment.x / Ixx, ... }
```

**Fix:** Refactor `computeSegmentReadout()` to return `{ coeffs, system }` so the caller
can reuse the `SystemForces` without a second pass. Alternatively, compute `sumAllSegments`
once before calling `computeSegmentReadout` and pass the result in.

---

### Issue 6 — Three.js object allocation per frame [LOW-MEDIUM]

**Where:** `main.ts updateVisualization()`.

```ts
bodyMatrix = new THREE.Matrix4().makeRotationFromQuaternion(bodyQuat)  // new obj
const invQuat = bodyQuat.clone().invert()                               // new obj (×2 paths)
gravityDir = new THREE.Vector3(0, -1, 0).applyQuaternion(invQuat)      // new obj
```

These allocate on every frame — ~180+ small object allocations per second. While not
causing full GC pauses now (heap is healthy at 46MB), these add to GC pressure and waste
CPU time in the allocator.

**Fix:** Preallocate module-level temporaries and reuse them (standard Three.js pattern):

```ts
const _m4 = new THREE.Matrix4()
const _q  = new THREE.Quaternion()
const _v3 = new THREE.Vector3()

// in updateVisualization:
_m4.makeRotationFromQuaternion(bodyQuat)
bodyMatrix = _m4

_q.copy(bodyQuat).invert()
_v3.set(0, -1, 0).applyQuaternion(_q).normalize()
gravityDir = _v3
```

---

### Issue 7 — Debug `console.log` in `computePilotCouplingDerivatives` [TRIVIAL]

**Where:** `sim.ts computePilotCouplingDerivatives()` (canopy only).

```ts
const now = performance.now()
if (!(fn as any)._lastLog || now - (fn as any)._lastLog > 1000) {
  (fn as any)._lastLog = now
  console.log(`[GravCompare] ...`)
}
```

This `performance.now()` call fires on every derivative evaluation (4× per RK4 step ×
up to 10 steps per frame = 40 checks per frame during canopy flight). The `console.log`
fires at 1Hz but the timestamp check runs constantly.

**Fix:** Remove the log entirely. The gravity comparison was temporary verification and the
values match. If needed for future debugging, add it behind a `DEBUG_GRAV_COMPARE` flag.

---

## Implementation Plan

### ✅ Phase P1 — Stop destroying/recreating charts (Issue 1, primary fix)

**Implemented.** Saved: ~17ms/frame JS overhead.

Changes: Added `updateChart1DataInPlace()` and `updateChart2DataInPlace()` in
`polar-charts.ts`. Both update dataset arrays, point colors, segment callbacks, and plugin
state in-place on the existing Chart.js instance. `rebuildChart1/2` are still called for
config changes (view switch, legacy toggle). `updateChartSweep` now calls the in-place
variants instead of rebuild.

**Result:** 9.4fps → 11.2fps (+2fps).

### ✅ Phase P2 — Throttle chart updates (Issue 1, secondary fix)

**Implemented.** Root cause discovered: `chart.update('none')` on 720-point gradient-colored
charts costs ~33ms regardless of whether data changed (canvas draw is the bottleneck, not
sweep math). Both `updateChartSweep` AND `updateChartCursor` trigger this full redraw.

**P2a — Chart update throttle:** `SWEEP_THROTTLE_MS = 200` in `main.ts`. All chart updates
(sweep + cursor) are skipped on throttled frames. Only fires at most ~5Hz. Physics, vectors,
readout, and Three.js rendering continue at full rate.

`responsive: true` is preserved throughout — Chart.js handles `devicePixelRatio` automatically
for crisp rendering. Setting `responsive: false` was attempted but caused blurry charts on
any display with DPR > 1 and was reverted.

**Result:** 9.4fps → 29.8fps (+20fps). p95 dropped from 203ms → 97ms.

### Current perf breakdown (after P1+P2a, per `updateVisualization` call)
| Section | Avg |
|---------|-----|
| Polar setup + makeA5Segments | 0.05ms |
| Physics + readout DOM updates | 0.83ms |
| updateForceVectors + model | 1.27ms |
| Chart (amortized at 5Hz throttle) | 2.74ms |
| **Total updateVisualization** | **~3.5ms** |

Typical rAF frame: ~28ms (dominated by Three.js GPU time, not JavaScript).
Chart-update frames (1 in 6): ~97ms (33ms chart draw + reflow + 3.5ms other).

### ✅ Current overall results
| Metric | Baseline | After P1+P2a |
|--------|----------|--------------|
| fps avg | 9.4 | **29.8** |
| avg frame | 106ms | **33ms** |
| p50 frame | 99ms | **28ms** |
| p95 frame | 203ms | **97ms** |
| Chart visual quality | Full DPR | **Full DPR (unchanged)** |
| Chart update rate | Every frame | **5Hz throttle** |

### Phase P3 — Cheap wins (Issues 4, 6, 7)

Zero-risk, one-liner changes. Do as a single commit.

- Issue 4: singleton empty map in `getSegmentPolarOverrides`
- Issue 6: module-level Three.js temporaries in `main.ts`
- Issue 7: remove `console.log` and `performance.now()` from `computePilotCouplingDerivatives`

### Phase P4 — Reduce redundant work (Issues 3, 5)

- Issue 5: refactor `computeSegmentReadout` to return `SystemForces` alongside coefficients
- Issue 3: guard `makeA5SegmentsAeroSegments()` / `makeIbexAeroSegments()` behind
  `segOvMap.size > 0`

### Phase P5 — Config caching (Issue 2, requires design care)

Thread `currentInertia` and `currentCg` from `main.ts` into `SimRunner`/`getSimConfig`
so they are not recomputed independently. For wingsuit: compute once at `startSim()`. For
canopy: update lazily from `updateVisualization()` when `rotatePilotMass()` fires.
Cache `buildPilotCoupling()` result; invalidate on vehicle/polar switch only.

This phase requires careful coordination between `sim-ui.ts`, `sim-runner.ts`, and
`main.ts` — do it last, after the quick wins are verified.

---

## Phase P6 — Input-driven polar cache invalidation (next major improvement)

### Motivation

The current 5Hz time-throttle is a blunt instrument. The polar sweep (`sweepSegments`,
720 pts × 7 segments) needs to be redrawn only when its inputs actually change. This
phase replaces the wall-clock throttle with smart invalidation driven by what genuinely
changes the shape of the polar curve.

### What actually changes the polar curve shape?

The polar curve (colored gradient line) is produced by `sweepSegments(segments, polar,
massRef, controls, config)`. Its shape is determined by:

| Input | Typical change rate | Invalidation strategy |
|-------|--------------------|-----------------------|
| `controls` (pitchThrottle, rollThrottle, yawThrottle, hipCamber, legBend, brakes) | Immediate on keypress/gamepad | Invalidate immediately on any `> 0.005` delta |
| `state.beta_deg` (sideslip) | Lags pilot roll/yaw input; settles over ~1s | Invalidate when `\|Δβ\| > 0.5°` |
| `state.delta` (brake deployment) | Direct slider | Invalidate on any change |
| `state.dirty` (dirty config flag) | Direct slider | Invalidate on any change |
| `state.rho` (density altitude) | Slow — typically < 0.05 kg/m³ / minute | Bucket to nearest 0.05 kg/m³; or cap re-eval at once per 2s regardless |
| `state.polarKey` | Only on vehicle switch | Always invalidate |

**Airspeed is NOT a direct input to the polar shape.** The Kirchhoff model at current
fidelity is effectively velocity-independent for the displayed range. Airspeed was in the
previous `sweepKey()` only because it feeds into `sweepSegments(...)` as a parameter, but
the curve shape barely changes across the operating range. It can be removed from the
invalidation key entirely, or bucketed very coarsely (± 5 m/s).

**The cursor (current α position) is NOT part of the polar shape** — it is already handled
separately by `updateChartCursor()` and does not require a full redraw.

### Two-tier invalidation strategy

Replace `SWEEP_THROTTLE_MS = 200` with a two-tier scheme:

**Tier 1 — Immediate (within next throttle window, ≤ 50ms):**
Triggered when pilot inputs change significantly. Captures the "input just happened"
case where the user wants responsive visual feedback.
- Any `controls` axis changes by > 0.005 (gamepad/keyboard input)
- `delta` or `dirty` changes
- `polarKey` changes

**Tier 2 — Slow background refresh (every 2000ms):**
Catches slow environmental drift even during stable flight.
- `rho` buckets (nearest 0.05 kg/m³) or simply every 2 seconds as a catch-all

**Settling period:**
After a Tier 1 trigger fires (new input detected), schedule one additional fast redraw
100–150ms later. This catches beta settling: after a roll input is applied, beta responds
over ~500ms. The second pass captures the new stable β without needing to track the full
trajectory.

### Suggested data structure

```ts
// In main.ts (module scope)
let lastSweepKey = ''           // hash of input-driving params (controls, delta, dirty, polarKey)
let lastSweepMs = 0             // when the last sweep was drawn
let pendingSettleMs = 0         // if > 0, draw again at this timestamp (settle pass)

const SWEEP_FAST_MS   =   50    // max latency after an input event
const SWEEP_SETTLE_MS =  150    // second pass to capture β settling
const SWEEP_SLOW_MS   = 2000    // background re-eval for rho drift

// sweepKey now excludes airspeed; buckets rho to 0.05 kg/m³
function inputSweepKey(s: FlightState): string {
  const rhoBucket = Math.round(s.rho / 0.05) * 0.05
  return `${s.polarKey}|${s.beta_deg.toFixed(1)}|${s.delta.toFixed(3)}|${s.dirty}|${rhoBucket}|${controlsKey(s)}`
}
```

### Chart draw cost budget

At ~33ms per full chart draw (720-pt gradient line × 2 charts), the budget is:
- 1 fast-update + 1 settle-pass per input: ~66ms total, spread over 150ms → imperceptible
- Background refresh at 0.5Hz: 33ms once every 2s → < 2% frame budget
- No redraws during steady flight between inputs → near-zero chart overhead

This gives **full-resolution immediate feedback on inputs** while eliminating redundant
redraws during steady-state sim (which is the vast majority of flight time).

### Implementation notes

- Keep `rebuildChart1/2` unchanged (still used for view switches and legacy toggle)
- `updateChartCursor(state.alpha_deg)` remains as is — it fires on its own cheap path
  (though note it still calls `chart.update('none')` and costs ~33ms; see note below)
- The `chart.update('none')` canvas cost of ~33ms cannot be reduced without switching to
  a WebGL chart library or rendering the cursor on a separate canvas overlay. For now it
  is acceptable at the throttled rate.
- `updateChartCursor()` note: under the current scheme, cursor updates are also throttled
  (skipped on non-throttle frames). With Tier 1/2 invalidation, the cursor will update
  whenever a full sweep fires. Between sweeps, the cursor position drifts silently. This
  is acceptable for a monitoring chart. If cursor responsiveness becomes a priority,
  the solution is a lightweight overlay canvas that only draws the cursor line/dot,
  leaving the Chart.js canvas completely static between input events.

---

## PNG Capture Compatibility Note

The PNG capture pipeline (`docs/SIM-CAPTURE-GUIDE.md`, Playwright) drives the sim
frame-by-frame using `requestAnimationFrame` hooks. For a valid capture:

- Three.js scene must be fully rendered each frame ✓ (unchanged by any fix above)
- Charts update at 5Hz throttle — **chart pixels may be up to 200ms stale per frame**.
  PNG capture was tested and confirmed unaffected (it has its own separate chart layer).
- Readout panel must show current state ✓ (not affected by any fix)

---

## What NOT to do

- Do not throttle `evaluateAeroForces()` or the physics loop — the 200Hz integrator must
  run at full rate; stability depends on it.
- Do not skip `rotatePilotMass()` caching for canopy — pilot pendulum CG shifts are real
  and affect the aero model.
- Do not change the gamepad/keyboard → `SegmentControls` data flow — segment objects must
  remain readable and writable through that interface.
- Do not consolidate the two rAF loops (`animate` + `sim-runner.tick`) into one without
  profiling first — they handle different concerns and merging them is a large refactor
  with unclear benefit.
