# KIRCHHOFF.md — Kirchhoff Separation Model & Aerodynamic Blending

> Describes the full-range aerodynamic coefficient model used by every
> lifting segment in the simulator.  Covers the separation function,
> attached-flow and flat-plate sub-models, coefficient blending,
> center-of-pressure travel, control morphing (δ derivatives), deployment
> scaling, and the variable-area brake flap model.

---

## 1  Overview

Real wings don't simply "stall and stop flying."  Flow separation is a
continuous process: at low angle of attack the boundary layer is fully
attached and the wing behaves like a thin airfoil; as α increases past
the stall angle the flow progressively separates and the aerodynamics
transition toward a flat plate broadside to the flow.  The Kirchhoff
separation model captures this transition with a single blending
function f(α) ∈ [0, 1] that smoothly interpolates every aerodynamic
coefficient between the two regimes.

**Source file:** `src/polar/kirchhoff.ts` — separation function & sub-models  
**Blending logic:** `src/polar/coefficients.ts` — `getAllCoefficients()`  
**Control morphing:** `src/polar/coefficients.ts` — `applyControl()`, `applyAllControls()`  
**Segment factories:** `src/polar/segment-factories.ts` — `getCoeffs()` closures  
**Polar definition:** `src/polar/continuous-polar.ts` — `ContinuousPolar` interface

### 1.1  Design Goals

1. **Full 360° α coverage** — valid from −180° to +180°, not just near stall.
2. **Smooth transitions** — sigmoid-based blending avoids discontinuities.
3. **Per-segment evaluation** — each aero segment evaluates independently at its own local (α, β).
4. **Control continuity** — brake, riser, dirty, and deployment inputs morph polar parameters continuously.
5. **Portable** — pure math, no rendering or UI dependencies. Intended for CloudBASE export.

---

## 2  The Separation Function f(α)

The separation function f(α) represents the fraction of attached flow
on the airfoil surface.  f = 1 means fully attached; f = 0 means fully
separated (flat-plate behaviour).

### 2.1  Forward Stall Sigmoid

$$f_{\text{fwd}}(\alpha) = \sigma\!\left(\frac{\alpha - \alpha_{\text{stall,fwd}}}{s_{1,\text{fwd}}}\right)$$

where $\sigma(x) = \frac{1}{1 + e^x}$ is the logistic sigmoid (clamped at ±500 to prevent overflow).

As α exceeds $\alpha_{\text{stall,fwd}}$, $f_{\text{fwd}}$ drops from 1 → 0.  The transition width is controlled by $s_{1,\text{fwd}}$ (degrees): smaller values give a sharper stall break.

**Code:** `f_fwd(alpha_deg, polar)` in `kirchhoff.ts`

### 2.2  Back Stall Sigmoid

$$f_{\text{back}}(\alpha) = \sigma\!\left(\frac{\alpha_{\text{stall,back}} - \alpha}{s_{1,\text{back}}}\right)$$

This mirrors the forward stall for deep negative α (back-stall / reversed flow).  It drops from 1 → 0 as α decreases below $\alpha_{\text{stall,back}}$.

**Code:** `f_back(alpha_deg, polar)` in `kirchhoff.ts`

### 2.3  Combined Separation

$$f(\alpha) = f_{\text{fwd}}(\alpha) \cdot f_{\text{back}}(\alpha) \;\in\; [0, 1]$$

The product ensures that the flow is only "attached" when both the forward and back stall criteria are satisfied.  In the normal flight envelope, $f_{\text{back}} \approx 1$ and f is governed entirely by $f_{\text{fwd}}$.

**Code:** `separation(alpha_deg, polar)` in `kirchhoff.ts`

### 2.4  Polar Parameters

| Parameter | Symbol | Unit | Typical Value (Ibex UL) | Description |
|-----------|--------|------|------------------------|-------------|
| `alpha_stall_fwd` | $\alpha_{\text{stall,fwd}}$ | deg | 22 | Forward stall angle |
| `s1_fwd` | $s_{1,\text{fwd}}$ | deg | 3.5 | Forward stall transition width |
| `alpha_stall_back` | $\alpha_{\text{stall,back}}$ | deg | −15 | Back stall angle |
| `s1_back` | $s_{1,\text{back}}$ | deg | 5 | Back stall transition width |

---

## 3  Sub-Models

### 3.1  Attached-Flow Lift

$$C_{L,\text{att}} = C_{L_\alpha} \cdot \sin(\alpha - \alpha_0)$$

Using $\sin()$ instead of a linear $C_{L_\alpha} \cdot (\alpha - \alpha_0)$ gives better behaviour at large α in the transition zone — the lift curve naturally rolls off toward ±90° rather than growing without bound.

| Parameter | Symbol | Unit | Description |
|-----------|--------|------|-------------|
| `cl_alpha` | $C_{L_\alpha}$ | 1/rad | Lift curve slope |
| `alpha_0` | $\alpha_0$ | deg | Zero-lift angle of attack |

**Code:** `cl_attached(alpha_deg, polar)` in `kirchhoff.ts`

### 3.2  Attached-Flow Drag

$$C_{D,\text{att}} = C_{D_0} + K \cdot C_{L,\text{att}}^2$$

This is the classical drag polar — parasitic drag plus induced drag quadratic in lift.

| Parameter | Symbol | Unit | Description |
|-----------|--------|------|-------------|
| `cd_0` | $C_{D_0}$ | — | Zero-lift (parasitic) drag coefficient |
| `k` | $K$ | — | Induced drag factor |

**Code:** `cd_attached(alpha_deg, polar)` in `kirchhoff.ts`

### 3.3  Flat-Plate Lift

$$C_{L,\text{plate}} = C_{D_n} \cdot \sin\alpha \cdot \cos\alpha = \frac{C_{D_n}}{2}\sin 2\alpha$$

A flat plate at angle of attack $\alpha$ generates a normal force $C_{D_n} \cdot \sin\alpha$; the lift component is the projection perpendicular to the freestream.  Valid for any α including ±90° and ±180°.

| Parameter | Symbol | Unit | Typical Value | Description |
|-----------|--------|------|---------------|-------------|
| `cd_n` | $C_{D_n}$ | — | 1.2–2.0 | Normal (broadside) drag coefficient |

**Code:** `cl_plate(alpha_deg, cd_n)` in `kirchhoff.ts`

### 3.4  Flat-Plate Drag

$$C_{D,\text{plate}} = C_{D_n} \cdot \sin^2\alpha + C_{D_0} \cdot \cos^2\alpha$$

At α = 0° this reduces to $C_{D_0}$ (streamlined); at α = 90° it gives $C_{D_n}$ (broadside).

**Code:** `cd_plate(alpha_deg, cd_n, cd_0)` in `kirchhoff.ts`

### 3.5  Flat-Plate Pitching Moment

$$C_{M,\text{plate}} = -0.1 \cdot \sin 2\alpha$$

An empirical approximation: flat plates produce a nose-down restoring moment proportional to $\sin 2\alpha$.

**Code:** `cm_plate(alpha_deg)` in `kirchhoff.ts`

### 3.6  Flat-Plate Center of Pressure

$$\text{CP}_{\text{plate}} = 0.25 + 0.25 \cdot \sin|\alpha|$$

At small α the CP sits at the quarter-chord (thin-airfoil prediction).  At 90° the CP moves to mid-chord (0.50), consistent with broadside flat-plate aerodynamics.

**Code:** `cp_plate(alpha_deg)` in `kirchhoff.ts`

---

## 4  Coefficient Blending

All aerodynamic coefficients are blended between the attached-flow and flat-plate regimes using the separation function f(α).  The single evaluation point is `getAllCoefficients()` in `coefficients.ts`.

### 4.1  Lift

$$C_L(\alpha, \beta) = \Big[f \cdot C_{L,\text{att}} + (1-f) \cdot C_{L,\text{plate}}\Big] \cdot \cos^2\beta$$

The $\cos^2\beta$ factor accounts for the reduced effective span in sideslip — the wing's projected area perpendicular to the freestream decreases as the flow comes from the side.

### 4.2  Drag

$$C_D(\alpha, \beta) = \Big[f \cdot C_{D,\text{att}} + (1-f) \cdot C_{D,\text{plate}}\Big] \cdot \cos^2\beta + C_{D_{n,\text{lat}}} \cdot \sin^2\beta$$

The lateral broadside drag term $C_{D_{n,\text{lat}}} \cdot \sin^2\beta$ captures the increase in drag when the body is turned broadside to the flow in sideslip.

### 4.3  Side Force

$$C_Y(\beta) = C_{Y_\beta} \cdot \sin\beta \cdot \cos\beta$$

A first-order lateral force model driven by the sideslip angle.

### 4.4  Pitching Moment

$$C_M(\alpha) = f \cdot \big(C_{M_0} + C_{M_\alpha} \cdot (\alpha - \alpha_0)\big) + (1-f) \cdot C_{M,\text{plate}}$$

Attached-flow CM is linear in α (zero-α moment plus slope).  Blended with the flat-plate CM at separation.

### 4.5  Center of Pressure

$$\text{CP}(\alpha) = f \cdot \text{clamp}\!\big(\text{CP}_0 + \text{CP}_\alpha \cdot (\alpha - \alpha_0), 0, 1\big) + (1-f) \cdot \text{CP}_{\text{plate}}$$

The attached CP travels linearly with α (clamped to [0, 1] chord fraction), blended with the flat-plate CP model.  This drives the per-segment force application point and is critical for pitch moment computation.

| Parameter | Symbol | Unit | Description |
|-----------|--------|------|-------------|
| `cp_0` | $\text{CP}_0$ | — | CP at zero alpha (chord fraction from LE) |
| `cp_alpha` | $\text{CP}_\alpha$ | 1/rad | CP shift per radian of α |

### 4.6  Yaw and Roll Moments

$$C_n(\beta) = C_{n_\beta} \cdot \sin\beta \cdot \cos\beta \qquad\qquad C_{l,\text{roll}}(\beta) = C_{l_\beta} \cdot \sin\beta \cdot \cos\beta$$

Independent stability derivatives with crossflow scaling.  These are not blended by f — they operate through the lateral axis only.

---

## 5  Control Morphing (δ Derivatives)

Controls modify the base polar parameters via **SymmetricControl derivatives**.  Each polar can define control blocks for `brake`, `front_riser`, `rear_riser`, and `dirty`.  When a control input δ is applied, the effective polar becomes:

$$P_{\text{eff}} = P_{\text{base}} + \delta \cdot \Delta P$$

### 5.1  SymmetricControl Interface

Defined in `continuous-polar.ts`:

| Derivative | Symbol | Effect |
|-----------|--------|--------|
| `d_alpha_0` | $\Delta\alpha_0$ | Shifts zero-lift angle (camber change) |
| `d_cd_0` | $\Delta C_{D_0}$ | Increases parasitic drag |
| `d_cl_alpha` | $\Delta C_{L_\alpha}$ | Modifies lift curve slope |
| `d_k` | $\Delta K$ | Changes induced drag factor |
| `d_alpha_stall_fwd` | $\Delta\alpha_{\text{stall,fwd}}$ | Shifts stall angle |
| `d_alpha_stall_back` | $\Delta\alpha_{\text{stall,back}}$ | Shifts back-stall angle |
| `d_cd_n` | $\Delta C_{D_n}$ | Changes broadside drag |
| `d_cp_0` | $\Delta \text{CP}_0$ | Direct CP shift |
| `d_cp_alpha` | $\Delta \text{CP}_\alpha$ | Reduces CP travel with α |
| `cm_delta` | $\Delta C_{M_0}$ | Pitch moment from control deflection |

### 5.2  Application Order

In `applyAllControls()`:

1. **Primary control** (brake → rear_riser → front_riser): driven by the `delta` input.
2. **Dirty flying**: driven by the `dirty` input (additive, wingsuit only).

Both are applied via `applyControl(polar, ctrl, amount)` which produces a new polar with shifted parameters.  The Kirchhoff model then evaluates at the morphed polar.

### 5.3  Physical Interpretation

**Brakes on a canopy:**
- Pulling brakes deflects the trailing edge downward, increasing effective camber.
- This shifts $\alpha_0$ negative (more camber = more lift at zero geometric α).
- Drag increases ($\Delta C_{D_0} > 0$) from the exposed fabric and increased profile drag.
- The stall angle can shift ($\Delta\alpha_{\text{stall,fwd}}$) — deep brake may trigger stall earlier.
- A pitch moment is generated ($\text{cm delta}$) from the control force couple.

**Dirty flying on a wingsuit:**
- Body tension decreases, reducing wing efficiency.
- Lift curve slope decreases ($\Delta C_{L_\alpha} < 0$).
- Parasitic drag increases ($\Delta C_{D_0} > 0$).
- Broadside drag increases ($\Delta C_{D_n} > 0$).
- The transition is gradual and reversible.

---

## 6  Canopy Cell Segment `getCoeffs()`

`makeCanopyCellSegment()` in `segment-factories.ts` builds a per-cell AeroSegment that combines all the above systems.  The inner logic of its `getCoeffs()` closure:

### 6.1  Deployment Scaling

At deploy < 1 (line stretch → inflation), the polar parameters are morphed to model uninflated fabric:

| Parameter | deploy = 0 | deploy = 1 | Multiplier |
|-----------|-----------|-----------|------------|
| $C_{D_0}$ | 2× normal | 1× | `DEPLOY_CD0_MULTIPLIER = 2.0` |
| $C_{L_\alpha}$ | 30% normal | 100% | `DEPLOY_CL_ALPHA_FRACTION = 0.3` |
| $C_{D_n}$ | 1.5× normal | 1× | `DEPLOY_CD_N_MULTIPLIER = 1.5` |
| $\alpha_{\text{stall,fwd}}$ | −17° offset | 0° | `DEPLOY_STALL_FWD_OFFSET = -17` |
| $s_{1,\text{fwd}}$ | 4× broader | 1× | `DEPLOY_S1_FWD_MULTIPLIER = 4.0` |

Additionally, the cell's physical geometry scales with deployment:

| Geometry | deploy = 0 | deploy = 1 | Formula |
|----------|-----------|-----------|---------|
| Span | 10% | 100% | `spanScale = 0.1 + 0.9 * d` |
| Chord | 30% | 100% | `chordScale = 0.3 + 0.7 * d` |
| Area (S) | 3% | 100% | `S = fullS * chordScale * spanScale` |
| x-position | shifted forward | calibrated | `DEPLOY_CHORD_OFFSET * (1 - d)` |
| y-position | collapsed | full span | `fullY * spanScale` |

### 6.2  Local Flow Angle Transformation

Each cell sits at an arc angle θ in the canopy.  The freestream (α, β) is rotated into the cell's local frame:

$$\alpha_{\text{local}} = \alpha \cos\theta + \beta \sin\theta$$

$$\beta_{\text{local}} = -\alpha \sin\theta + \beta \cos\theta$$

This captures how a rolled panel sees a reduced effective α and gains a component of sideslip.

### 6.3  Riser → α Offset

Front and rear riser inputs create an angle of attack change:

$$\Delta\alpha_{\text{riser}} = (-\text{frontRiser} + \text{rearRiser}) \cdot \text{ALPHA MAX RISER} \cdot \text{riserSensitivity}$$

Default `ALPHA_MAX_RISER = 10°`.  Front riser decreases α (steeper dive), rear riser increases α (flatter glide).

### 6.4  Brake → δ and α Coupling

Brake input produces two effects:

1. **Camber change (δ):**  `deltaEffective = brakeInput * brakeSensitivity` — fed through the SymmetricControl derivatives (§5).
2. **Cross-coupling to α:**  `deltaAlphaBrake = brakeInput * brakeSensitivity * BRAKE_ALPHA_COUPLING_DEG` — pulling brakes physically rotates the TE downward, slightly increasing effective AoA.  Default `BRAKE_ALPHA_COUPLING_DEG = 2.5°`.

The center cell has zero brake sensitivity — no brake lines reach it.

### 6.5  Final Evaluation

$$\text{coeffs} = \texttt{getAllCoefficients}(\alpha_{\text{local}} + \Delta\alpha_{\text{riser}} + \Delta\alpha_{\text{brake}},\; \beta_{\text{local}},\; \delta_{\text{eff}},\; \text{evalPolar})$$

---

## 7  Lifting Body Segment

`makeLiftingBodySegment()` builds a segment for bodies with non-trivial aerodynamics (wingsuit pilot, slick skydiver, etc.).

### 7.1  Pitch Offset

The segment may be pitched relative to the body frame.  A canopy pilot hanging vertically has `pitchOffset_deg = 90°`.  The freestream α is transformed:

$$\alpha_{\text{local}} = \alpha_{\text{freestream}} - \text{pitchOffset}_{\text{eff}}$$

where `pitchOffset_eff = pitchOffset_deg + controls.pilotPitch`.

### 7.2  Pivot Rotation

When `pilotPitch ≠ 0`, the segment's position is rotated around the riser pivot point (same rotation as `rotatePilotMass()`):

$$\begin{pmatrix} x' \\ z' \end{pmatrix} = \begin{pmatrix}
\cos\delta & -\sin\delta \\
\sin\delta & \cos\delta
\end{pmatrix} \begin{pmatrix} x - x_{\text{pivot}} \\ z - z_{\text{pivot}} \end{pmatrix} + \begin{pmatrix} x_{\text{pivot}} \\ z_{\text{pivot}} \end{pmatrix}$$

The chord rotation is stored in `_chordRotationRad` so that CP rendering also swings rigidly with the body.

### 7.3  Evaluation

The full Kirchhoff model evaluates at the local α with both δ (symmetric control) and dirty (efficiency degradation):

```
getAllCoefficients(localAlpha, beta_deg, controls.delta, polar, controls.dirty)
```

---

## 8  Unzippable Pilot (Polar Blending)

`makeUnzippablePilotSegment()` creates a segment that morphs between two completely different polars based on `controls.unzip`:

| unzip | Polar | Use case |
|-------|-------|----------|
| 0 | zippedPolar | Wingsuit (large S, high CL_α, low CD_0) |
| 1 | unzippedPolar | Slick (small S, low CL_α, high CD_0) |
| 0–1 | `lerpPolar(t, zipped, unzipped)` | Linear interpolation of ALL scalar parameters |

The segment's S and chord are dynamically updated from the blended polar so that `computeSegmentForce()` uses correct force scaling.  All other behaviour (pitch offset, pivot rotation, Kirchhoff evaluation) is identical to the lifting body segment.

### 8.1  lerpPolar

`lerpPolar(t, polarA, polarB)` in `coefficients.ts` linearly interpolates every aerodynamic scalar field:

$$P_{\text{blend}} = P_A + t \cdot (P_B - P_A)$$

Applied to: `cl_alpha`, `alpha_0`, `cd_0`, `k`, `cd_n`, `cd_n_lateral`, stall angles, stall widths, all stability derivatives, `cm_0`, `cm_alpha`, `cp_0`, `cp_alpha`, `cg`, `s`, `m`, `chord`.

Non-scalar fields (name, type, controls, mass segments, aero segments) are taken from polarA.

---

## 9  Variable-Area Brake Flap

`makeBrakeFlapSegment()` models the trailing edge of a canopy cell as a separate lifting surface that deploys when brakes are applied.

### 9.1  Concept

When the pilot pulls brakes, the trailing edge fabric panel deflects downward.  This is the **primary** brake effect — direct force from the deflected surface.  The **secondary** effect (camber change on the remaining cell body) is handled by the cell's SymmetricControl derivatives (§5).

### 9.2  Variable Geometry

| Property | Zero brake | Full brake | Formula |
|----------|-----------|-----------|---------|
| S (area) | 0 | `flapChordFraction * parentCellS` | `effectiveBrake * maxFlapS` |
| chord | 0 | `flapChordFraction * parentCellChord` | `effectiveBrake * maxFlapChord` |
| x-position | Trailing edge | Moves forward | `teX + effectiveBrake * maxCpShift` |
| Roll angle | Base θ | Deepened arc | `θ + effectiveBrake * MAX_FLAP_ROLL_INCREMENT_DEG * sign` |

The forward position shift represents the quarter-chord of the deployed flap section — as more fabric deploys, the effective AC moves forward from the trailing edge.

### 9.3  Flap Deflection

The flap surface sees the parent cell's local α plus a deflection angle:

$$\alpha_{\text{flap}} = \alpha_{\text{local}} + \delta_{\text{brake}} \cdot \text{MAX FLAP DEFLECTION DEG}$$

Default `MAX_FLAP_DEFLECTION_DEG = 50°`.  At full brake on an outer cell, the flap sees 50° more α than the freestream — guaranteeing deep stall of the trailing edge fabric.

### 9.4  Lift-Vector Tilt

A panel rolled at arc angle θ produces lift perpendicular to its surface.  This tilted lift decomposes into:

$$C_{L,\text{stream}} = C_{L,\text{local}} \cdot \cos\theta \qquad C_{Y,\text{tilt}} = C_{L,\text{local}} \cdot \sin\theta$$

For flaps with extreme dynamic roll angles (up to 56° with `MAX_FLAP_ROLL_INCREMENT_DEG = 20°` + base 36° arc), this tilt decomposition is explicit.  Braking deepens the arc, increasing θ and the outward side force — this drives the canopy's turn response to asymmetric braking.

---

## 10  Wingsuit Throttle Controls

`makeWingsuitLiftingSegment()` adds multi-axis throttle response on top of the standard Kirchhoff evaluation.

### 10.1  Pitch Throttle

All lifting segments respond to `pitchThrottle`:
- **α offset:** `deltaAlphaPitch = pitchThrottle * PITCH_ALPHA_MAX_DEG` (default ±1.5°)
- **CP shift:** `cpShift = pitchThrottle * PITCH_CP_SHIFT` (default ±0.05 chord fraction)

### 10.2  Roll Throttle

Differential across left/right wings:
- **α offset:** `deltaAlphaRoll = rollThrottle * ROLL_ALPHA_MAX_DEG * rollSensitivity * sideSign`
- Outer wings (`rollSensitivity = 1.0`) respond more than inner (`0.6`).

### 10.3  Yaw Throttle

- **Body:** lateral position shift `YAW_BODY_Y_SHIFT`
- **Head:** lateral position shift `YAW_HEAD_Y_SHIFT` (acts as rudder effect)
- **Wings:** differential α from body twist `YAW_ROLL_COUPLING_DEG * sideSign`
- **Dirty coupling:** yaw throttle loosens one side `YAW_DIRTY_COUPLING * sideSign`

### 10.4  Dihedral

Wing roll angle varies with `controls.dihedral`:
- Inner wings: up to `DIHEDRAL_INNER_MAX_DEG` (default 16°)
- Outer wings: up to `DIHEDRAL_OUTER_MAX_DEG` (default 30°)

The dihedral roll feeds into the local flow angle transformation (§6.2) and the lift-vector tilt decomposition (§9.4).

### 10.5  Dirty Coupling

The effective dirty parameter for each wingsuit segment combines:

$$\text{dirty}_{\text{eff}} = \text{clamp}\!\Big(\text{dirty}_{\text{base}} + \text{yawT} \cdot \text{YAW DIRTY COUPLING} \cdot \text{sideSign} + |\text{rollT}| \cdot \text{ROLL DIRTY COUPLING},\; 0,\; 1\Big)$$

This is passed to `getAllCoefficients()` as the dirty parameter, which applies the dirty SymmetricControl derivatives to degrade the polar.

---

## 11  Parasitic Segments

`makeParasiticSegment()` builds simple constant-coefficient drag bodies (lines, pilot body under canopy, bridle, pilot chute).

$$C_L = \text{const}, \quad C_D = \text{const}, \quad C_Y = \text{const}, \quad C_M = 0, \quad \text{CP} = 0.25$$

These segments do **not** use the Kirchhoff model.  They produce constant drag regardless of α, β, or controls.

---

## 12  Head Segment (Bluff Body / Rudder)

`makeWingsuitHeadSegment()` builds a parasitic bluff body that also acts as a rudder in sideslip:

$$C_Y = -0.5 \cdot \sin\beta$$

The head sits far forward of the CG, so this side force creates a yaw moment that provides directional stability.  The head shifts laterally with `yawThrottle`, producing an asymmetric moment arm.

---

## 13  Code Map

| File | Key Functions | Role |
|------|---------------|------|
| `kirchhoff.ts` | `sigmoid`, `f_fwd`, `f_back`, `separation`, `cl_attached`, `cd_attached`, `cl_plate`, `cd_plate`, `cm_plate`, `cp_plate` | Core sub-models |
| `coefficients.ts` | `getCL`, `getCD`, `getCY`, `getCM`, `getCP`, `getAllCoefficients`, `applyControl`, `applyAllControls`, `lerpPolar` | Blending, morphing, polar interpolation |
| `continuous-polar.ts` | `ContinuousPolar`, `AeroSegment`, `SegmentControls`, `SymmetricControl`, `MassSegment` | Type definitions |
| `segment-factories.ts` | `makeCanopyCellSegment`, `makeLiftingBodySegment`, `makeUnzippablePilotSegment`, `makeBrakeFlapSegment`, `makeParasiticSegment`, `makeWingsuitHeadSegment`, `makeWingsuitLiftingSegment` | Factory functions |
| `aero-segment.ts` | `computeSegmentForce`, `sumAllSegments`, `evaluateAeroForcesDetailed` | Force computation and summation |

---

## 14  References

- Kirchhoff, G. (1869). *Über die Bewegung eines Rotationskörpers in einer Flüssigkeit.*
- Leishman, J. G. (2006). *Principles of Helicopter Aerodynamics.* Chapter 7 — Kirchhoff/Helmholtz model for dynamic stall.
- Khan, W. & Nahon, M. (2015). *Real-Time Modeling of Agile Fixed-Wing UAV Aerodynamics.* — Sigmoid-based separation model for real-time simulation.
- Hoerner, S. F. (1965). *Fluid-Dynamic Drag.* — Flat-plate drag coefficients and normal force data.
