# Wake Downwash: Leg Wing and Canopy Brake Modeling

## Overview

Standard multi-segment aerodynamic models assume each segment sees the undisturbed freestream, modified only by the rigid-body kinematic correction:

$$V_{local,i} = V_{CG} + \omega \times r_i$$

This is the "Reference Velocity" formulation in the attached paper (Eq. 1), and it is exactly what `evaluateAeroForcesDetailed` in `aero-segment.ts` currently implements.

For the **leg wing** and **canopy brake panel**, this assumption breaks down — both segments operate partially or fully in the wake of upstream surfaces. This document describes the physics, how the current model implicitly handles it, and how to implement an explicit wake correction.

---

## 1. The Physical Problem

### 1.1 Leg Wing Wake Environment

The Aura 5 leg wing sits **downstream of the torso and inner wing (L1/R1) segments**:

| Segment | NED x position | Relation to leg |
|---------|----------------|-----------------|
| Torso   | x ≈ +0.119 m   | ~0.29 m ahead of leg |
| L1/R1   | x ≈ −0.038 m   | ~0.13 m ahead of leg, flanking it laterally |
| Leg     | x ≈ −0.171 m   | **downstream of both** |

The torso and inner wings generate lift, which deposits a trailing vortex sheet aft of each surface. The leg wing sits in this combined near-wake and therefore sees:

1. **Downwash angle ε** — the wake tilts the local streamlines, reducing the effective angle of attack seen by the leg surface.
2. **Dynamic pressure deficit** — the wake has slightly lower total velocity (small effect, typically < 5%, usually ignored at preliminary design level).

### 1.2 Sideslip Dependence

At non-zero sideslip (β ≠ 0) the dominant wake source shifts:

| Condition | Primary wake source on leg |
|-----------|---------------------------|
| β ≈ 0° (straight ahead) | Torso downwash — symmetric |
| β > 0° (right slip) | R1 inner wing wake dominates right side of leg |
| β < 0° (left slip) | L1 inner wing wake dominates left side of leg |

A scalar downwash correction handles β = 0 well. For sideslip, a left/right differential correction on the leg would be more accurate but is a higher-order refinement.

---

## 2. Downwash Magnitude

### 2.1 Classical Near-Field Estimate

From Prandtl lifting-line theory, the **asymptotic** (far-field) downwash behind a finite wing is:

$$\varepsilon_\infty = \frac{2 C_L}{\pi \cdot AR}$$

At the leg's axial separation (gap/chord ≈ 0.16 for the torso), the wake has not yet reached its asymptotic value. A near-field correction factor $k_{wake} \in [0.3, 0.5]$ applies:

$$\varepsilon_{local} \approx k_{wake} \cdot \frac{2 C_{L,torso}}{\pi \cdot AR_{torso}}$$

**Example** at typical trim (torso $C_L \approx 0.8$, $AR \approx 4$, $k_{wake} = 0.4$):

$$\varepsilon \approx 0.4 \times \frac{2 \times 0.8}{\pi \times 4} \approx 0.051 \text{ rad} \approx 2.9°$$

So the leg wing currently sees the full freestream α, but physically it should see approximately **α − 3°** at cruise. This is not trivial — it is the same order as the hipCamber α shift authority we use for pitch trim.

The contribution from L1/R1 adds a further ~1–1.5° at typical conditions (inner wings have smaller AR and lower individual CL than the torso, but both panels contribute).

### 2.2 Practical `downwashFactor` Constant

The formula collapses to a single tunable scalar:

```
downwashFactor = k_wake × 2 / (π × AR_source)
```

For the torso-to-leg path: factor ≈ 0.04–0.06.
For the L1/R1-to-leg path: factor ≈ 0.02–0.04 per inner wing.

In the implementation these are per-segment tunable constants, adjusted against GPS trim data.

---

## 3. What the Current Model Gets Implicitly Right

The `A5_LEG_POLAR` (`cm_0 = -0.05`, `cm_alpha = -0.08`) was tuned against GPS flight data. The empirical polar has **absorbed the integrated downwash effect** into its coefficients. The model works, but the coupling is hidden:

- Changing the torso polar (e.g., testing different camber profiles) requires re-tuning the leg polar.
- The downwash is baked in at whatever CL the pilot flew at during GPS data collection — it is not correct at different speeds.

Making the downwash explicit decouples the two polars and makes the physics transparent across the full speed envelope.

### 3.1 Hip Shift as AoA Reduction

The current `hipCamber` control applies an α₀ shift to the leg segment, which effectively **reduces the leg's operating angle of attack** when the pilot arches. This is the primary trim mechanism at the top of the speed range.

What the downwash model clarifies: even before any hipCamber input, the leg is already operating at a lower effective α than freestream (reduced by wake downwash). The hipCamber shift *adds to* this inherent AoA reduction.

**The trim gap at slow speed (49 m/s and below)** is partly a consequence of the current model over-predicting leg-wing CL: the leg polar sees full freestream α, but physically it should see α − 3°. Adding explicit downwash would reduce leg CL at slow speed, which has the same nose-up effect as a negative LEG_FLARE_ALPHA0_DEG shift — precisely the direction needed to close the gap.

---

## 4. Conceptual Anatomy of the Leg Segment

The hip/knee dual-control design reflects real anatomy:

- **Hip shift** (`hipCamber`) — the pelvis and thigh rotate independently from the lower leg. This pitches the **forward/upper portion** of the leg wing panel (hip to knee).
- **Leg bend** (`legBend`) — the knee and ankle angle changes the **aft/lower portion** of the leg wing (knee to feet).

These are physically two separate geometric changes on the same fabric panel. The current model collapses them into a single AeroSegment, which is a simplification.

### 4.1 Future Geometry Refinement

A more accurate leg model would express these as **positional changes** rather than pure α₀ shifts:

- As the pilot arches/tucks, the leg panel's Z-position shifts upward (in body frame) and the panel angle (relative to the torso chord) becomes steeper.
- The effective α seen by the leg drops from both the downwash correction and the geometric reorientation.
- The forward inner wing segments (L1/R1) provide suction on the upper surface of the leg wing as the gap between them closes under arch — a juncture flow effect.

This is equivalent to parameterizing leg geometry by two scalars (hip pitch angle and knee pitch angle) rather than by α₀ shifts, then computing the resulting aerodynamic state geometrically. The `downwashFactor` would then be a property of the gap geometry and could be made a function of hipCamber/legBend inputs rather than a fixed constant.

For now, the Phase O α₀-shift approach captures the first-order effect. The geometric parameterization is a Phase Q+ refinement.

---

## 5. Canopy Brake Panel

The brake panel case is **physically different from wake interference**. The brake panel lives inside the cell, deflecting flow that has already been turned by the cell's ram-air inlet. The current `makeCanopyCellSegment` factory already applies a coordinate transformation (`pitchOffset_deg`, the geometric cell tilt angle) that captures the mean inlet direction. The remaining `makeBrakeFlapSegment` models the variable-area trailing-edge deflection.

What the current model does not capture: the flow arriving at the brake panel has been slightly accelerated through the ram-air cell (pressure recovery), so the local dynamic pressure is marginally higher than freestream. At normal glide angles this is a few percent and is not worth modeling separately. The predominant brake effect is the flap deflection (δ → Δα → Kirchhoff polar shift), which is already implemented.

The brake case **would** matter if modeling deep-stall behavior, where the cell AoA is large and the exit velocity diverges substantially from freestream. This is a future refinement.

---

## 6. Implementation Plan

### 6.1 Single-Pass With Evaluation Order (Preferred)

The user correctly noted that a full two-pass evaluation is not required. Because the leg segment is physically the last segment in the airframe in the flow direction, it can be evaluated **last** in the loop, after the torso and inner wing results are already in hand.

In `evaluateAeroForcesDetailed`, segments are processed in array order. If the `a5segments` assembly defines the leg segment after the torso and inner wings (which it does — the current order is: torso, L1, R1, L2, R2, head, leg), then each upstream segment's CL is available by the time the leg is reached. The correction is applied inline without a second pass.

```typescript
// Accumulator for upstream segment CL, keyed by segment name
const clByName = new Map<string, number>()

for (const seg of segments) {
  // ... compute local velocity, alpha, beta (existing code) ...

  // Apply wake downwash correction from named upstream segments
  let alpha_corrected = alpha_local
  if (seg.wakeFrom) {
    for (const src of seg.wakeFrom) {
      const sourceCL = clByName.get(src.sourceName) ?? 0
      const downwashDeg = sourceCL * src.downwashFactor * (180 / Math.PI)
      alpha_corrected -= downwashDeg   // wake reduces effective AoA
    }
  }

  // Evaluate force at corrected alpha
  const f = computeSegmentForce(seg, alpha_corrected, beta_local, controls, rho, V_local)

  // Store this segment's CL for downstream segments
  const q_local = 0.5 * rho * V_local * V_local
  if (q_local > 0.1 && seg.S > 0) {
    clByName.set(seg.name, f.lift / (q_local * seg.S))
  }

  // ... existing summation code ...
}
```

### 6.2 `AeroSegment` Interface Extension

Add an optional property to `continuous-polar.ts`:

```typescript
export interface AeroSegment {
  // ... existing fields ...

  /** Optional: this segment operates in the wake of one or more upstream segments.
   *  Each entry names a source segment and provides a downwash coupling factor.
   *
   *  downwashFactor absorbs k_wake × 2 / (π × AR_source) and is tuned against GPS data.
   *  Typical values:
   *    torso → leg:   0.04 – 0.06
   *    L1/R1 → leg:   0.02 – 0.04 (per inner wing)
   *
   *  IMPORTANT: the source segment must appear BEFORE this segment in the assembly array
   *  so that its CL is already computed when this segment is evaluated (single-pass ordering).
   */
  wakeFrom?: Array<{
    sourceName: string       // must match `seg.name` of an upstream segment
    downwashFactor: number   // [rad / (N/m²·m²) normalized CL units] — effectively deg/CL after × (180/π)
  }>
}
```

### 6.3 Polar Data Changes

In `polar-data.ts`, the `a5segments` assembly function would add `wakeFrom` to the leg segment definition:

```typescript
// In makeWingsuitLiftingSegment for the 'leg' branch:
// (conceptual — actual wiring TBD in Phase Q)
wakeFrom: [
  { sourceName: 'torso',  downwashFactor: 0.05 },
  { sourceName: 'r1',     downwashFactor: 0.025 },
  { sourceName: 'l1',     downwashFactor: 0.025 },
]
```

Starting values:
- Torso: `0.05` → at CL = 0.8 gives 0.04 rad × 180/π ≈ 2.3°
- Each inner wing: `0.025` → at CL = 0.5 gives 1.4° per side

Total effective α reduction at cruise: ~3–4°. This is consistent with the classical estimate in §2.1.

### 6.4 Interaction With Existing Controls

The downwash correction modifies the **effective freestream α** seen by the leg polar, not any control input. The existing `hipCamber` α₀ shift and `legBend` α₀ shift continue to work as before — they modify the zero-lift line relative to whatever effective α the polar is evaluated at. The two effects add.

The trim consequence:
- At high speed (low α): torso CL is low → small downwash → small correction. HipCamber still covers this range.
- At slow speed (high α): torso CL is high (~0.8–1.0) → large downwash (~3–4°) → leg CL drops → less nose-down moment from leg → more nose-up trim authority. **This is the slow-speed trim gap correction mechanism.**

---

## 7. Relation to Phase O and Phase P

**Phase O** (current): Piecewise flare α₀ shifts activate at `pitchT < -0.5`. `LEG_FLARE_ALPHA0_DEG = -2.0` reduces leg CL at deep back stick.

**Wake downwash** (Phase Q): A physically motivated, speed-dependent α reduction on the leg that is always active (not just at deep back stick). It reduces the amount of flare authority needed and makes the polar tuning more portable across speed envelopes.

**Phase P** (planned): Unified cubic pitch response `f(pitchT) = -pitchT · (1 + k · pitchT²)` replacing piecewise flare constants. Phase Q would ideally be implemented before Phase P tuning so that the leg polar is correct across the full CL range before the pitch curve is finalized.

---

## 8. Summary of Recommended Actions

| Priority | Action |
|----------|--------|
| **Phase Q** | Add `wakeFrom` field to `AeroSegment` interface |
| | Modify `evaluateAeroForcesDetailed` to accumulate CL and apply correction in order |
| | Add `wakeFrom` to leg segment in `a5segments` assembly |
| | Tune `downwashFactor` values against GPS trim data at multiple speeds |
| | Remove or reduce `LEG_FLARE_ALPHA0_DEG` as wake correction absorbs its function |
| **Phase P** | Finalize cubic pitch response curve with corrected leg polar |
| **Later** | Investigate geometric leg parameterization (hip angle + knee angle → segment position + tilt) |
| **Later** | Add differential downwash correction for sideslip (left/right half of leg separately) |
| **Not yet** | Canopy brake inflow acceleration — too small to matter at current fidelity |
