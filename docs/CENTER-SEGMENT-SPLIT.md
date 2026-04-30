# Center Segment Split — Torso + Leg-Wing Refactor

**Status:** ✅ **Implemented** on `split` branch (Phases A–E complete; ready to merge to `master`).
**Last updated:** 2026-04-30
**Affects:** [polar-visualizer/src/polar/polar-data.ts](../polar-visualizer/src/polar/polar-data.ts), [polar-visualizer/src/polar/segment-factories.ts](../polar-visualizer/src/polar/segment-factories.ts), [polar-visualizer/src/viewer/wingsuit-wireframes.ts](../polar-visualizer/src/viewer/wingsuit-wireframes.ts), [polar-visualizer/src/ui/controls.ts](../polar-visualizer/src/ui/controls.ts), [polar-visualizer/index.html](../polar-visualizer/index.html), the GPS control solver (Phase E), and most wingsuit segment tests.

---

## 0. As-Built Summary (read this first)

The 6-segment wingsuit is now **7 segments**: head + torso + leg + L/R inner + L/R outer. Pitch and yaw both got new mechanisms; the leg segment is now fully decoupled from the pitch throttle and is driven entirely by the new `hipCamber` + `legBend` controls.

### Pitch control chain

```
gamepad pitch stick ──┐
                       ├─→ pitchThrottle ─┬─→ α/CP shift on torso + arms (small LE adjustment)
slider hipCamber ──────┼──────────────────┴─→ hipCamber + legBend offsets ─→ leg α₀, leg cm₀, torso α₀, torso cm₀
slider legBend  ──────┘                                                       (the trim-baseline mechanism)
```

The leg segment receives **no** direct pitch-throttle input — `α` and `CP` shifts are gated for `wingType==='leg'` in `segment-factories.ts`. Leg pitch behavior comes from:

1. Geometric lift × lever arm (leg AC at −0.32 m aft of CG → pitch-down with α)
2. Leg `cm_alpha = +0.60` (positive = "destabilizing alone", but combined with #1 gives the user enough flare authority to access the stall point)
3. `HIP_CAMBER_CM0_DELTA` and `LEG_BEND_CM0_DELTA` direct nose-up couples (no polar-shape distortion)
4. Small `HIP_CAMBER_ALPHA0_DEG` and `LEG_BEND_ALPHA0_DEG` α₀ shifts (cosmetic — lets the polar reflect "the wing is cambered")

### Yaw control chain (Phase C)

Layered, additive to existing mechanisms:

- `YAW_BODY_Y_SHIFT` (existing) — lateral CP shift on body/torso/leg
- `YAW_HEAD_Y_SHIFT` (existing) — head lateral shift
- `YAW_ROLL_COUPLING_DEG` (existing) — small Δα differential on inner/outer
- **`YAW_LEG_ROLL_DEG`** (new) — rolls leg segment; tilted lift × x_arm gives strong yaw moment
- **`YAW_TORSO_ROLL_DEG`** (new) — rolls torso opposite-sign → additive yaw moment (torso fwd of CG)

### Slider defaults & calibration

| Slider | Default | Range | What 0.30 means at gamepad neutral |
|--------|--------:|------:|------------------------------------|
| Hip Camber (Arch) | **30** | −100..+100 → −1..+1 | hip arch = 0.30 (mild belly-down) |
| Leg Bend          | **30** | 0..100   → 0..1     | knees slightly bent |

With both sliders at **30** and pitch stick neutral → wingsuit trims at ~100 mph cruise. Pitch stick full forward → effective hip=0.06, leg=0 → dive (~150 mph). Pitch stick full back → effective hip=1.00, leg=1.00 → flare/stall (~75 mph).

### Tunable constants (current values)

In [polar-visualizer/src/polar/segment-factories.ts](../polar-visualizer/src/polar/segment-factories.ts) `DEFAULT_WINGSUIT_CONSTANTS`:

```ts
HIP_CAMBER_ALPHA0_DEG: 3        // ±3° α₀ shift on torso/leg at full hip
HIP_CAMBER_CM0_DELTA:  0.10     // ±0.10 cm₀ on torso/leg at full hip
LEG_BEND_ALPHA0_DEG:   3        // −3° α₀ shift on leg at full bend
LEG_BEND_CM0_DELTA:    0.13     // +0.13 cm₀ on leg at full bend (nose-up)

PITCH_HIP_CAMBER_FWD:  0.24     // pitch stick fwd reduces hipCamber by up to 0.24
PITCH_HIP_CAMBER_BACK: 0.70     // pitch stick back increases hipCamber by up to 0.70
PITCH_LEG_BEND_FWD:    0.30     // (asymmetric — flare needs more authority than dive)
PITCH_LEG_BEND_BACK:   0.70

YAW_LEG_ROLL_DEG:      12       // leg rolls 12° at full yaw input
YAW_TORSO_ROLL_DEG:    -6       // torso rolls -6° at full yaw input (opposite sign, additive)
```

In [polar-visualizer/src/polar/polar-data.ts](../polar-visualizer/src/polar/polar-data.ts):

```ts
A5_TORSO_POLAR.cm_0 = 0,    cm_alpha = 0      // pure geometric pitch
A5_LEG_POLAR.cm_0   = 0,    cm_alpha = 0.60   // strong α-dependent nose-up; needed for stall access
```

---

## 1. Original Motivation (kept for reference)

The current 6-segment Aura 5 model uses a single `center` segment for everything between the head and the feet. The wireframe in the viewer already renders the center as **two distinct shapes** — a torso box from shoulders to hips, and a triangular leg-wing from hips out past the feet — but aerodynamically the two volumes share a single `ContinuousPolar`, a single position, and a single Kirchhoff blend.

Treating the center as one segment papers over four distinct effects that pilots use directly:

1. **Yaw via leg-vs-arm roll differential** — the leg-wing rolls relative to the upper body. Two pilot modes produce this same geometry: *leg-led* (feet/hips initiate, arms stay level — dominant in fast flight) and *upper-body-led* (head/torso initiate; spine reaction counter-rolls the legs — dominant in slow flight). A single `center` segment can only fudge this with an artificial `Δα` coupling; with two segments the side-force at fore-and-aft CPs produces a *direct* yaw moment with negligible roll/pitch coupling.
2. **Knee-bend chord shortening** — flexing the knees during a flare physically shortens the leg-wing without affecting the torso. Currently impossible to model.
3. **Hip camber** — the spine/hip joint sets the de-camber/camber of the entire suit at the boundary between the two wing models. With two segments this is a single control parameter that simultaneously shifts `α_0` in opposite directions on torso vs leg.
4. **Independent dirty / control responses** — torso and leg-wing have different stall characters and different responses to dirty flying; collapsing them loses fidelity.

The split also fixes a latent measurement convention issue (§3 below).

---

## 2. Geometry — Mass-Position Derivation

### 2.1 Why mass positions and not the wireframe / GLB mesh

The GLB model was built from a 3D scan of the pilot standing on the ground with arms held up and out. That pose tensions the suit fabric similarly to flight, but the **leading-edge sweep ends up at roughly 14° instead of the in-flight ~27°**, and the GLB shoulder position drifts a few centimeters from where the bone actually sits. Wireframe boxes in [wingsuit-wireframes.ts](../polar-visualizer/src/viewer/wingsuit-wireframes.ts) were drawn around that GLB mesh, so they inherit both errors.

The `WINGSUIT_MASS_SEGMENTS` array in [polar-data.ts:485](../polar-visualizer/src/polar/polar-data.ts#L485) was hand-tuned by the user to match the **flight-shape skeleton**, not the static-scan skeleton. Treat it as the authoritative geometry source. Anything the GLB or wireframe says is decorative.

### 2.2 Mass positions used as anatomical landmarks

Values from `WINGSUIT_MASS_SEGMENTS` converted to physical NED meters (multiply normalized position by `A5_HEIGHT = 1.875 m`). Right side only; left mirrors.

| Mass               | x_fwd of CG (m) | y_right (m) | Anatomical landmark               |
|--------------------|-----------------|-------------|-----------------------------------|
| `head`             | +0.566          | 0           | Skull center (top of head ~+0.62) |
| `torso`            | +0.147          | 0           | Sternum / chest center            |
| `right_upper_arm`  | +0.327          | +0.297      | **Shoulder joint**                |
| `right_forearm`    | +0.265          | +0.464      | Mid-forearm                       |
| `right_hand`       | +0.171          | +0.660      | **Wrist / wingtip**               |
| `right_thigh`      | −0.371          | +0.151      | Mid-thigh                         |
| `right_shin`       | −0.746          | +0.273      | Mid-shin                          |
| `right_foot`       | −0.994          | +0.377      | **Foot / wing tail**              |

### 2.3 Leading-edge fit from arm masses

The arm bone chain `shoulder → forearm → hand` traces the underlying skeleton; the fabric LE sits a few cm forward of it. Sweep angles between adjacent masses (measured from the spanwise direction):

| Segment of LE        | Δx (m) | Δy (m) | Sweep |
|----------------------|---------|---------|-------|
| shoulder → forearm   | 0.063   | 0.167   | 20.7° |
| forearm  → hand      | 0.094   | 0.197   | 25.5° |
| **shoulder → hand**  | 0.157   | 0.363   | **23.3°** |

The end-to-end fit gives **~23°**. The user's target is **~27°** (matches CloudBASE planform). The 4° gap is explained by the LE fabric being more forward of the shoulder than of the wrist (more LE camber at the root than at the tip). A simple correction: take the mass chain as the LE *baseline* and add a span-dependent forward shift so the final shoulder-to-hand sweep lands at 27°.

**Recommended LE definition (per side, in NED meters relative to CG):**

```
LE_root  (shoulder fabric) = (+0.327 + Δx_root,  ±0.297)   Δx_root ≈ +0.05 m
LE_tip   (wrist fabric)    = (+0.171 + Δx_tip,   ±0.660)   Δx_tip  ≈ +0.00 m
```

With those offsets the wing LE runs from `(+0.377, ±0.297)` at the shoulder to `(+0.171, ±0.660)` at the wrist, giving sweep = atan(0.206/0.363) = **29.6°** (slightly over target; tune Δx to taste). One tunable parameter — `A5_LE_ROOT_FWD_OFFSET = 0.05 m` — falls out of this and can be calibrated by visually overlaying the LE line on the GLB mesh in the viewer.

### 2.4 Body landmarks in system chord fraction

NED-x converted to system x/c via `xc = A5_CG_XC − NED_x × (A5_HEIGHT / A5_SYS_CHORD) = 0.40 − NED_x × 1.0417`:

| Landmark        | Mass-derived x/c | CloudBASE x/c (mm/1940) | Notes                                |
|-----------------|------------------|-------------------------|--------------------------------------|
| Top of head     | ~0.02            | 0.000                   | mass head center +5 cm fwd correction |
| Sternum         | 0.247            | 0.268                   | matches well                         |
| **Shoulder**    | **0.219**        | (—)                     | **mass-derived; new authoritative source** |
| Belly button    | (—)              | 0.380                    | reference only                       |
| **Hip line**    | ~0.46            | **0.445**               | both close; keep `A5_HIP_XC = 0.445` |
| Knee            | ~0.83            | 0.668                   | discrepancy — mass shin center is mid-shin, not knee joint |
| Foot            | ~0.95            | 0.930                   | matches well                         |

### 2.5 Derived split geometry (use these for implementation)

**Torso segment** (shoulder → hip):

| Quantity                    | Value          | Derivation                                        |
|-----------------------------|----------------|---------------------------------------------------|
| LE in system x/c            | 0.219          | mass-derived shoulder                             |
| TE in system x/c            | 0.445          | hip line (matches existing `A5_HIP_XC`)           |
| Own chord                   | (0.445−0.219) × 1.8 = **0.407 m** | length of chord segment           |
| Own AC at 25% own chord     | 0.219 + 0.25×0.226 = **0.276 system x/c** | quarter-chord of torso        |
| AC NED-x (m fwd of CG)      | (0.40−0.276) × 1.8 = **+0.223 m** | use as `A5_TORSO_POS.x`           |
| Mean width (y-extent)       | shoulder span ~0.30 m → fabric extends to inner-wing root ≈ ±0.25 m ≈ **0.50 m wide** | from inner-wing inboard face |
| Reference area S            | ~0.41 × 0.50 = **0.20 m²** (rectangular est.)  | calibrate against current 1.03 × split-fraction |

**Leg-wing segment** (hip → feet):

| Quantity                    | Value          | Derivation                                        |
|-----------------------------|----------------|---------------------------------------------------|
| LE in system x/c            | 0.445          | hip line                                          |
| TE in system x/c            | 0.95–1.00      | foot mass / fabric overshoot                      |
| Own chord                   | (0.975−0.445) × 1.8 = **0.954 m** | takes TE midway between feet and overshoot |
| Own AC at 25% own chord     | 0.445 + 0.25×0.530 = **0.578 system x/c** | quarter-chord of leg          |
| AC NED-x (m fwd of CG)      | (0.40−0.578) × 1.8 = **−0.320 m** | use as `A5_LEG_POS.x`             |
| Width at hip                | 0.30 m (matches torso TE width) | continuity                              |
| Width at feet               | 2 × 0.377 m ≈ 0.75 m (foot-to-foot, slight outboard flare) | mass-derived |
| Mean width                  | (0.30 + 0.75) / 2 = **0.525 m**  | trapezoidal mean                  |
| Reference area S            | 0.954 × 0.525 ≈ **0.50 m²** (trapezoidal est.) | calibrate so torso+leg = 1.03 |

**Calibration constraint:** `S_torso + S_leg = A5_CENTER_POLAR.s = 1.03 m²`. Geometric estimates above (0.20 + 0.50 = 0.70) under-shoot, because the rectangular/trapezoidal fits don't capture all the body fabric. Scale both by 1.03/0.70 = 1.47 → **`S_torso ≈ 0.30 m²`, `S_leg ≈ 0.73 m²`** (final values; ~30/70 split as in the previous estimate, but now with *physically* derived AC positions instead of wireframe ones).

**Headline AC offsets** (the numbers that make the split valuable for yaw):
- Torso AC: **+0.223 m forward of CG** (was +0.158 from wireframe)
- Leg AC:   **−0.320 m aft of CG**     (was −0.177 from wireframe)
- Total fore-aft AC separation = **0.543 m** (was 0.335 m) — **62% larger yaw arm than the wireframe estimate**.

This is why mass-position derivation matters: it nearly doubles the available yaw moment arm compared to the wireframe-derived numbers, which directly determines `YAW_LEG_ROLL_DEG` in Phase C.

---

## 3. The Per-Segment Leading-Edge Convention Question

### 3.1 The confusion

The Aura 5 system convention measures all chord fractions from the **top of the head**: `x/c = 0` at the head, `x/c = 1.0` at the feet, with system chord `A5_SYS_CHORD = 1.8 m`. This is encoded in [`a5xc()`](../polar-visualizer/src/polar/polar-data.ts#L1424):

```ts
function a5xc(xc: number): number {
  return (A5_CG_XC - xc) * A5_SYS_CHORD / A5_HEIGHT
}
```

But the head is **its own segment** — a parasitic Kirchhoff-bypassing sphere modeled by `makeWingsuitHeadSegment`. Every other segment's Kirchhoff polar should describe the segment's *own* lifting surface, with its *own* leading edge and its *own* chord. The 25% chord (quarter-chord = aerodynamic center for thin airfoils) ought to be measured from each segment's own LE, not from the top of the head.

### 3.2 What the code does today

For the **inner wings**, the comments at [polar-data.ts:1431–1460](../polar-visualizer/src/polar/polar-data.ts#L1431) explicitly compute:

> `Effective QC = LE − 0.25 × mean_chord` → x/c shift from 0.48 (rectangle) to 0.44 (composite shape).

So the inner-wing AC is correctly placed at 25% of the inner-wing's *own* chord (1.34 m) measured from the inner-wing's *own* LE (shoulder line). The conversion through `a5xc(0.44)` is just the final NED translation. **This segment is correct.**

For the **outer wings**, position is `a5xc(0.37)` with `chord = 0.39 m`. Outer-wing LE is the wrist, ~30 cm below top of head → x/c ≈ 0.167. AC at 25% of own 0.39 m chord = LE + 0.054 m → x/c ≈ 0.197. But the code uses 0.37, which would imply the LE is much further aft. **Possible audit issue.** The 0.37 may reflect a swept-back tip-panel AC rather than a wrist-anchored panel; needs review with the actual GLB measurement.

For the **center segment**, position is `a5xc(0.42)` with `chord` taken from the system polar. Since the center spans roughly `x/c = 0.16` (shoulder) to `x/c = 1.00` (feet), its mean chord is ~0.84 × 1.8 = 1.51 m. AC at LE + 25% × 1.51 = 0.16 + 0.21 = 0.37, not 0.42. **Possible audit issue** — but moot once we split, because `center` ceases to exist.

### 3.3 Proposed convention (post-split)

Each lifting segment carries its own `(LE_xc, chord_m)` pair, and AC is always placed at:

$$\text{AC}_\text{system\,x/c} = \text{LE}_\text{system\,x/c} + 0.25 \cdot \frac{\text{chord}_\text{m}}{A5\_SYS\_CHORD}$$

with the head segment treated as a separate non-lifting bluff body that does **not** contribute to any other segment's chord. The system-level polar (`aurafiveContinuous`) keeps using `A5_SYS_CHORD` for non-dimensionalization since it's the reference for whole-system moment coefficients.

This makes the per-segment AC computation explicit and audit-able — the same formula for torso, leg-wing, inner, and outer.

### 3.4 Audit follow-up (post-split)

- [ ] Recompute outer-wing LE from the mass-derived hand position. With the new convention `LE_outer = hand_x + Δx_tip` (≈0 m), so `LE_outer NED-x = +0.171 m`, x/c = 0.305. AC at LE + 0.25×0.39 = 0.171 − 0.098 = +0.073 m, x/c ≈ 0.36. Current code uses 0.37 — turns out **the existing outer-wing AC is already very close to the mass-derived value**. False alarm; leave as-is.
- [ ] Verify inner-wing composite mean chord matches the mass-derived shoulder → foot trapezoid.
- [ ] Document the per-segment LE in a table in [docs/MODEL-GEOMETRY.md](MODEL-GEOMETRY.md) so future tuning has a single source.
- [ ] Decide whether to fix the GLB wireframe (move shoulder line back to mass position, increase LE sweep to 27°) or leave the visual as-is. **Recommendation:** fix it after the aero split lands so users don't lose the mental anchor while the math is changing.

---

## 4. New Polars and Controls

### 4.1 Two new `ContinuousPolar` records

`A5_TORSO_POLAR` — short, fuselage-like, head-shadow drag:

| Param          | Value         | Reasoning                                          |
|----------------|---------------|----------------------------------------------------|
| `cl_alpha`     | ~2.2          | Stubby tapered fuselage; low AR                    |
| `alpha_0`      | ~0°           | Roughly symmetric (chest cavity) at neutral hip    |
| `cd_0`         | ~0.13         | Inherits some head-wake parasitic drag             |
| `k`            | ~0.35         | Moderate induced drag for low-AR shape             |
| `alpha_stall_fwd` | ~28°       | Earlier stall than full center (less flexible)     |
| `s1_fwd`       | ~5°           | Gentle stall (bluff body)                          |
| `cm_0`         | ~−0.005       | Slight nose-down trim (chest geometry)             |
| `cp_0`         | 0.30          | CP somewhat fwd of geometric center                |
| `chord`        | ~0.51 m       | Shoulder-to-hip                                    |
| `s`            | ~0.31 m²      | ~30% of current center area                        |

`A5_LEG_POLAR` — clean trailing edge, flexible cambered panel:

| Param          | Value         | Reasoning                                          |
|----------------|---------------|----------------------------------------------------|
| `cl_alpha`     | ~3.2          | Higher than torso — flat cambered panel            |
| `alpha_0`      | ~−2°          | Cambered (knees-down arch)                         |
| `cd_0`         | ~0.08         | Cleaner TE, no head wake                           |
| `k`            | ~0.25         | Better span efficiency than torso                  |
| `alpha_stall_fwd` | ~38°       | Late stall (flexible, post-stall lift retention)   |
| `s1_fwd`       | ~3.5°         | Sharper stall break than torso                     |
| `cm_0`         | ~−0.02        | More nose-down (large TE area)                     |
| `cm_alpha`     | ~−0.30        | Strong pitch authority — drives the flare          |
| `cp_0`         | 0.40          | Aft CP (wide trailing flare)                       |
| `chord`        | ~1.00 m       | Hip-to-feet                                        |
| `s`            | ~0.72 m²      | ~70% of current center area                        |

> All numbers above are **starting points**. The tuning constraint is that the *summed* forces and moments at neutral α/β/control match `aurafiveContinuous` to within ~1%. A short calibration pass (sweep α, compare CL/CD/CM totals) lands the final values.

### 4.2 New control axes

| Control      | Range  | Acts on             | Effect                                                           |
|--------------|--------|---------------------|------------------------------------------------------------------|
| `legBend`    | 0..1   | leg polar only      | Shrinks `s` and `chord` by up to ~20%; small `Δα_0` (knees-down) |
| `hipCamber`  | -1..+1 | torso & leg polars  | `Δα_0` opposite sign on each — articulates camber at hip line    |
| `yawThrottle`| -1..+1 | torso & leg roll    | Roll-differential (Phase C of this plan)                         |

`legBend` and `hipCamber` are **new** gamepad/UI bindings. They ship with default 0 (no behaviour change) and can be wired up in a later phase without breaking anything.

---

## 5. Implementation Plan & As-Built Log

### Phase A — Geometric split, shared polar ✅ (commit `2d49218`)
*Goal:* land a 7-segment topology with no aero behavior change.

1. Add `A5_HIP_XC = 0.445` (already exists) usage to compute `A5_TORSO_POS` and `A5_LEG_POS` from the user's measured AC values (fall back to §2.3 estimates).
2. In [polar-data.ts](../polar-visualizer/src/polar/polar-data.ts), allocate `A5_CENTER_POLAR.s` between two **shared-polar references** in proportion to wireframe area (provisionally 30/70).
3. In [polar-data.ts:1660](../polar-visualizer/src/polar/polar-data.ts#L1660) `makeA5SegmentsAeroSegments()`: replace the single `center` line with `torso` + `leg`, both consuming the same shared polar.
4. Update [wingsuit-wireframes.ts](../polar-visualizer/src/viewer/wingsuit-wireframes.ts) — the two wireframe pieces become the visualizations for `torso` and `leg` instead of both being attached to `center`.
5. Verify with `npx tsc --noEmit` + `npx vitest run` + visual neutral comparison: at α=0, β=0, all controls neutral, total system force should match the pre-split single-center result to within rounding.

### Phase B — Distinct polars ✅ (commits `9908a6c`, `eebabcb`)
*Goal:* give torso and leg their own `ContinuousPolar`, calibrated so the sum still matches `aurafiveContinuous` at symmetric flight.

**Phase B.1 hot-fix:** initial distinct polars carried `cm_0` and `cm_alpha` from the old single-center polar, which double-counted with the new geometric lift×lever-arm pitch moment. Zeroed both on torso and leg; pitch stability now produced entirely by geometry. Flare authority was reintroduced later (Phase D.2 + leg `cm_alpha=0.6`) once the baseline was clean.

6. Add `A5_TORSO_POLAR` and `A5_LEG_POLAR` per §4.1.
7. Sweep α from −10° to +50° at β=0 in the visualizer; compare summed CL/CD/CM against `aurafiveContinuous`. Adjust the two polars' parameters until the sum matches within 1–2%.
8. Re-run tests; loosen or update any wingsuit-segment assertions that were keyed to the old single-segment behaviour. The user has indicated the test suite was loosened during prior work and may not be fully meaningful — treat per-test failures as opportunities to either fix the test or fix a real bug that the split exposes.

### Phase C — Yaw refactor ✅ (commit `20b8cbc`)
*Goal:* implement leg-vs-arm roll differential as the yaw mechanism.

**Built additively, not as a replacement.** The existing `YAW_BODY_Y_SHIFT` and `YAW_ROLL_COUPLING_DEG` mechanisms still work and provide a baseline yaw moment. New `YAW_LEG_ROLL_DEG = 12` and `YAW_TORSO_ROLL_DEG = -6` add roll-differential lift tilt that produces yaw moment via `CY × x_arm` — leg aft of CG, torso fwd of CG, opposite roll signs make both contributions yaw in the same direction. Carving feel matches real wingsuit flat-turn flying.

9. In [`segment-factories.ts`](../polar-visualizer/src/polar/segment-factories.ts):
    - Add `YAW_LEG_ROLL_DEG` (was `YAW_CENTER_ROLL_DEG` in the older plan; rename for clarity post-split). Default ~6°.
    - Add `YAW_TORSO_ROLL_DEG`. Default ~−1.5° (small counter-roll of the upper body; set to 0 if pilot-feel testing shows the leg-led mode is sufficient on its own).
    - Drop `YAW_INNER_ROLL_DEG` (or keep at 0): with proper torso/leg fore-aft CPs, inner wings no longer need to do yaw work.
    - Drop `YAW_ROLL_COUPLING_DEG`.
    - Keep `YAW_HEAD_Y_SHIFT` and `YAW_DIRTY_COUPLING`.
10. In `makeWingsuitLiftingSegment`, compute `yawRollDeg` per segment (`leg`, `torso`, `inner`, `outer`) and add into `rollDeg` before the existing `theta = rollDeg × DEG2RAD` step. Reuses the dihedral lift-vector decomposition that already produces `cl·cos θ` and `cy + cl·sin θ`.
11. Sign-validation step: sweep `yawThrottle = +1` in the viewer and confirm the yaw arc points right; pick the sign of `YAW_LEG_ROLL_DEG` that produces N>0 empirically.
12. Browser smoke test: yaw input produces clear yaw moment, small-or-zero roll/pitch coupling.

### Phase D — Hip camber & leg bend ✅ (commits `6765200`, `2650dca`, `3069613`)
*Goal:* expose new pilot controls.

**Phase D (initial):** added `hipCamber` (−1..+1) and `legBend` (0..1) to `SegmentControls`; UI sliders, FlightState plumbing, gamepad wiring through `ws-hip-camber-slider` and `ws-leg-bend-slider`. Initial implementation used α₀ shifts (`HIP_CAMBER_ALPHA0_DEG=15`) and S/chord scaling on legBend.

**Phase D.1 (commit `2650dca`):** S/chord scaling on legBend turned out to have **zero aero effect** — lift/drag don't depend on chord, and per-segment `cm_*` were zero. Replaced with `cm₀` modulation: `HIP_CAMBER_CM0_DELTA = 0.10` and `LEG_BEND_CM0_DELTA = 0.13`. Direct nose-up moment couple, no polar-shape distortion. α₀ shifts retained at small magnitudes (3°) for cosmetic camber.

**Phase D.2 (commit `3069613`):** wired `pitchThrottle` directly into `hipCamber`/`legBend` offsets so the gamepad drives the trim mechanism. Asymmetric per direction (more authority back for flare than forward for dive). Also **fully decoupled the leg segment from pitch throttle** — leg no longer receives `PITCH_ALPHA_MAX_DEG` or `PITCH_CP_SHIFT`. Bumped leg `cm_alpha` to **+0.60** (α-dependent nose-up couple) so full back-stick + full sliders reaches the stall point.

13. Extend `WingsuitControlConstants` with `HIP_CAMBER_ALPHA0_DEG` and `LEG_BEND_S_FRACTION`, `LEG_BEND_CHORD_FRACTION`.
14. In `makeWingsuitLiftingSegment` `getCoeffs`:
    - For wingType `'leg'`: read `controls.legBend` ∈ [0,1] and scale `this.S` and `this.chord` proportionally each tick (same pattern as the canopy `unzip` blend at [segment-factories.ts:436](../polar-visualizer/src/polar/segment-factories.ts#L436)).
    - For `'torso'` and `'leg'`: apply `controls.hipCamber × HIP_CAMBER_ALPHA0_DEG × hipSign` to `alphaEffective`. `hipSign = +1` for leg, `−1` for torso.
15. Add UI sliders to the debug panel; gamepad binding deferred.
16. Documentation pass — update [README.md](../README.md) wingsuit-controls section.

### Phase E — Solver retune & polish ✅ (complete)
17. Joint α/dirty solver shipped in [control-solver.ts](../polar-visualizer/src/gps-viewer/control-solver.ts) (commits `dd7d211`, `6991d88`, `432a8c8`, `c270825`): outer fixed-point on α around the Newton 3×3 throttle solve, with a 1D bisection on `dirty` to match measured L/D, then `matchAOABinarySearch` re-extracts α from the converged controls. Validated against the 05-02-2025-1 GPS track: 1815 wingsuit points, 98.9% converged, mean |Δα| = 1.0°, dirty correctly elevated through the 540° turn (peak 0.66 at t=231 s) and the dirty-flying section before deployment (peak 0.78 at t=274 s). Cruise samples land on the swept polar curve in the chart cursor view.
18. 6→7 rename pass through `polar-data.ts`, `docs/CONTROL-SOLVER.md`, `docs/contexts/wingsuit-aero.md`, `docs/contexts/README.md`, and `docs/sim/STABILITY-ANALYSIS.md` (commits `c9e3561`, `df6e4bb`).
19. Stability analysis re-run on 7-segment topology and tables in [docs/sim/STABILITY-ANALYSIS.md](sim/STABILITY-ANALYSIS.md) refreshed: short-period ζ rises from ~0.095 to ~0.15, qDot stays uniformly nose-down across the trimmed envelope (legacy 6-segment had a sign flip near 40 m/s), phugoid damping increases. Lateral divergence behavior near 35–50 m/s is essentially unchanged.
20. Audit follow-up from §3.4 (segment LE / chord / AC table into [docs/MODEL-GEOMETRY.md](MODEL-GEOMETRY.md)) deferred — not a merge blocker.

---

## 6. Risks & Mitigations

| Risk                                                              | Mitigation                                                                                      |
|-------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Symmetric-flight calibration drift (sum of two polars ≠ old single) | Phase A uses *shared* polar (zero drift); Phase B calibrates explicitly against `aurafiveContinuous` sweep. |
| Inertia tensor change (mass redistribution)                       | `computeInertia` re-runs on next sim init; verify with [`inertia` tests in src/tests/](../polar-visualizer/src/tests/).             |
| GPS solver Jacobian condition change                              | Phase E retunes; Phase C empirical sign-validation prevents direction errors.                    |
| Test failures from loosened-but-meaningful assertions             | User has flagged the existing wingsuit suite as partially loose; re-tighten where the split exposes truth, loosen further only with comment-justified reason. |
| Per-segment chord/LE audit reveals deeper issues                  | §3.4 follow-up captures findings into MODEL-GEOMETRY.md; standalone fixes can ship as separate small PRs after the split. |
| Pilot feel regression in real-time sim                            | Adverse-yaw-into-roll from the new mechanism is *physically realistic*; do not damp it out.      |

---

## 7. Rollback

Phase A is a single-file pair revert (polar-data.ts + wingsuit-wireframes.ts). Phase B/C/D are additive — disable by reverting their commits independently. The 6-segment topology and original `YAW_ROLL_COUPLING_DEG` mechanism remain in git history.

---

## 8. Open Questions for the User

1. ~~**Real-world AC measurements**~~ — **Resolved** in §2.5 by deriving everything from `WINGSUIT_MASS_SEGMENTS`. Torso AC = +0.223 m fwd of CG, leg AC = −0.320 m aft.
2. **LE forward offset** (§2.3) — confirm `A5_LE_ROOT_FWD_OFFSET ≈ 0.05 m` is reasonable, or pick a different number. This is the only free parameter in the LE fit; everything else is locked to mass positions.
3. **Outer-wing audit** (§3.4) — current `chord = 0.39 m, x/c = 0.37` matches mass-derived 0.36 within 1%; recommend leaving alone unless you want to retune.
4. **Hip-camber sign convention** — does positive `hipCamber` mean *more arch* (de-camber torso, camber leg → α_0 negative on leg, positive on torso) or the other direction? Pilot mental model TBD.
5. **Leg-bend max shrink** — typical knees-bent flare reduces effective leg-wing area by ~15–25%? Need user's flight experience to set the maximum.
6. **Wireframe fix** — fix the GLB visual to match the mass-derived shoulder line + 27° sweep, or leave it cosmetic-only? Recommend fixing *after* aero split lands so the wireframe and aero math go through one big visual change together.
