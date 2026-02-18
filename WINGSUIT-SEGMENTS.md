# Wingsuit Segments — Planning Document

## Goal

Replace the single-body Kirchhoff polar for the Aura 5 wingsuit with a **6-segment aerodynamic model** that captures asymmetric control, differential lift across the span, and realistic turning dynamics. Add a **wingsuit deployment slider** for the pilot-chute-throw through line-stretch phase.

---

## Why Segments?

The current wingsuit model uses a single `ContinuousPolar` evaluated at one α and β. This works well for symmetric flight — the speed polar, glide ratio, and stall behavior are already well-tuned. But it cannot produce:

- **Differential lift in a turn** — the advancing and retreating wings see different airspeeds via ω×r, but a single body has no span to distribute this across.
- **Asymmetric control** — a pilot shifts shoulders/spine laterally (yaw), raises/lowers one shoulder (roll), or rocks weight fore/aft (pitch). The current `delta` control morphs the entire polar symmetrically and cannot produce these coupled motions.
- **Heading stability from the head** — the head acts as a rudder/bluff body that creates yaw moments, especially in sideslip. A single polar lumps this into `cn_beta`.
- **Realistic dirty flying** — a loose suit affects the arm wings and leg wing differently. The body's fuselage section stays relatively rigid.

The segment model distributes the aerodynamics across the body, letting the ω×r pipeline (already implemented for the canopy) produce natural damping derivatives and turn coupling.

---

## Current Wingsuit Data

From `aurafiveContinuous` in `polar-data.ts`:

| Parameter | Value | Notes |
|-----------|-------|-------|
| `S` | 2.0 m² | Total reference area |
| `chord` | 1.8 m | Reference chord (body length) |
| `m` | 77.5 kg | Total mass |
| `cl_alpha` | 2.9 /rad | Lift-curve slope |
| `alpha_0` | −2° | Zero-lift AOA |
| `cd_0` | 0.097 | Parasitic drag |
| `k` | 0.360 | Induced drag factor |
| `cd_n` | 1.1 | Broadside drag |
| `cy_beta` | −0.3 /rad | Side force derivative |
| `cn_beta` | 0.08 /rad | Yaw moment derivative |
| `cl_beta` | −0.08 /rad | Roll moment derivative (dihedral effect) |

### Mass Segments (14, existing)

Body extends from x_norm = −0.530 (feet) to +0.302 (head), span y = ±0.352 (hands). Height normalization factor = 1.875 m, giving physical dimensions:

| Dimension | Normalized | Physical |
|-----------|-----------|----------|
| Body length (head to feet) | 0.832 | ~1.56 m |
| Arm span (hand to hand) | 0.704 | ~1.32 m |
| Chord (reference) | — | 1.8 m |

The physical chord (1.8 m reference / 1.94 m physical) is larger than the head-to-feet distance because it includes the tail wing extending past the feet and the helmet extending past the crown. The wingsuit's effective aerodynamic length is the full chord value. The physical measurement of 1.94 m comes from the CloudBASE simulator body station data (see [Reference: CloudBASE Simulator Wingsuit Control](#reference-cloudbase-simulator-wingsuit-control)).

### Existing Controls (Single-Polar Model)

| Control | Range | Effect |
|---------|-------|--------|
| `brake` (δ) | [−1, +1] | Body arch: CP shift, camber, drag, stall |
| `dirty` | [0, 1] | Loose suit: +drag, −lift slope, −stall angle |

These will be replaced by the new throttle controls in the segment model (see [Wingsuit Control Inputs](#wingsuit-control-inputs)).

---

## Proposed 6-Segment Layout

The segment layout was designed in the Three.js editor by placing scaled unit cubes over the `tsimwingsuit.glb` model. Reference files:
- `wssegments3jsproject.json` — Three.js editor project with all 6 segment boxes
- `polar-visualizer/public/models/tsimwingsuit.glb` — wingsuit GLB model (unscaled reference)

The boxes were positioned and scaled to match the GLB at identity scale (1.0). All positions are box centers; all scales are applied to a unit cube (1×1×1).

```
           1: HEAD (sphere)
           ┌─────┐
           │  1  │
           └──┬──┘
           ┌──┴──┐
           │  2  │ 2: Body/fuselage (torso + tail wing — primary lift)
       ┌───│     │───┌     3: inner wing
    ┌──│   │     │   │──┐     
     4 │3  │     │ 3 │ 4│   4:Outer wing: hand area only (wingtips)
    └──┤   ┤     ┤   ┤──┘   
       │   │     │   │
       │   │     │   │
       │   │     │   │     
   ────────────────────────
   
   Inner wing: shoulder → elbow + hip → feet 
   
    
```

### Segment Definitions

| # | Name | Type | Description |
|---|------|------|-------------|
| 1 | `head` | Parasitic (sphere) | Bluff body — primarily drag, acts as rudder in sideslip |
| 2 | `center` | Canopy-cell-like | Fuselage + tail wing — largest lifting surface, carries most of CL |
| 3 | `r1` / `l1` | Canopy-cell-like | Inner wings: shoulder→elbow + hip→feet — the large fabric panels |
| 4 | `r2` / `l2` | Canopy-cell-like | Outer wings: hand area only — small wingtip control surfaces |

**Total: 6 segments** (1 head + 1 body + 2 inner wings + 2 outer wings)

---

## Three.js Reference Geometry

### Raw GLB Coordinates (from Three.js Editor)

All values are in the wingsuit GLB's native coordinate system (unscaled). The Three.js editor uses x = lateral, y = vertical (thickness), z = longitudinal (head at +z).

| Segment | Position (x, y, z) | Scale (x, y, z) | Notes |
|---------|-------------------|-----------------|-------|
| `head` | (0.000, 0.000, 0.880) | (0.200, 0.200, 0.200) | Sphere — 0.2 m diameter |
| `center` | (0.000, 0.020, −1.000) | (1.000, 0.360, 3.000) | Main body — widest and longest |
| `r1` | (−0.720, 0.000, −1.029) | (0.440, 0.240, 2.700) | Right inner wing |
| `l1` | (+0.720, 0.000, −1.029) | (0.440, 0.240, 2.700) | Left inner wing (mirror) |
| `r2` | (−1.100, 0.000, −0.074) | (0.380, 0.160, 0.600) | Right outer wing (wingtip) |
| `l2` | (+1.100, 0.000, −0.074) | (0.380, 0.160, 0.600) | Left outer wing (mirror) |

### Coordinate System Mapping (GLB → NED)

| GLB Axis | Direction | NED Axis |
|----------|-----------|----------|
| +z | Forward (toward head) | +x (North/forward) |
| −x | Right (pilot's right) | +y (East/right) |
| −y | Down | +z (Down) |

So: `NED_x = GLB_z`, `NED_y = −GLB_x`, `NED_z = −GLB_y`.

### GLB-to-Physical Scale

The GLB-to-NED-normalized conversion factor can be computed from the head mass segment position:

$$k_{\text{GLB\to NED}} = \frac{x_{\text{norm,head}}}{z_{\text{GLB,head}}} = \frac{0.302}{0.88} = 0.3432$$

This factor converts any GLB coordinate to the NED-normalized frame used by the mass segments (normalization height = 1.875 m):

| Reference Point | GLB_z | NED_x (= GLB_z × 0.3432) | Mass Segment x_norm | Match |
|----------------|-------|--------------------------|--------------------|---------|
| Head | +0.88 | +0.302 | +0.302 | Exact |
| Center body | −1.00 | −0.343 | — | Mid-torso |
| Body TE (tail wing tip) | −2.50 | −0.858 | — | Past feet (−0.530) — tail wing |
| Inner wing center | −1.029 | −0.353 | — | Near hip level |
| Outer wing center | −0.074 | −0.025 | — | Near shoulder level |

The tail wing tip at NED_x = −0.858 extends well past the feet (x_norm = −0.530). This is correct — the entire tail wing past the feet is aerodynamically active fabric.

Physical dimensions from GLB via this factor:

$$\text{physical (m)} = \text{GLB} \times k_{\text{GLB\to NED}} \times 1.875$$

| Segment | GLB Chord | Physical Chord (m) | GLB Span | Physical Span (m) |
|---------|-----------|-------------------|----------|-------------------|
| `center` | 3.00 | 1.93 | 1.00 | 0.64 |
| `r1`/`l1` | 2.70 | 1.74 | 0.44 | 0.28 |
| `r2`/`l2` | 0.60 | 0.39 | 0.38 | 0.24 |
| `head` | 0.20 | 0.13 | 0.20 | 0.13 |

### Box Geometry Notes

- The rectangular boxes are a Phase 1 approximation. Phase 2 will use **triangular planforms** for the body and inner wing segments (see [Triangular Planform Refinement](#triangular-planform-refinement) below).
- The inner wings (r1/l1) have nearly the same chord as the center body (2.7 vs 3.0 GLB units) because the inner wing fabric runs from shoulder height all the way to the feet. The outer wings (r2/l2) are much shorter-chord (0.6) — just the hand area (wingtips).
- The scale.y component (thickness) has no aerodynamic meaning — it's only for visual representation.
- The tail wing extends well past the feet — the entire extension is aerodynamically active fabric, not dead space.

### Triangular Planform Refinement

The rectangular boxes cut across functional boundaries. In reality, the body segment narrows toward the head while the inner wing segments fill the corresponding space aft. A more accurate representation uses **rectangle + triangle** composite shapes:
The **hip line** marks the transition point. From CloudBASE body station data, hips are at x/c = 0.445 from the head, which maps to GLB_z ≈ −0.62 (NED_x ≈ −0.213).
**Body segment (center):**
```
     ┌───┐  ← head end: narrow (shoulders only)
     │   │
    ╱    ╲     Rectangle at top (head → shoulders)
   ╱      ╲    Triangle widens toward hips
  ┌────────┐  ← hip level: full torso width
  │        │
  │        │  Rectangle continues to tail wing tip
  └────────┘  ← tail wing tip (past feet)
```

The body is a rectangle from hips to tail wing tip, topped by a triangle that narrows from hip width to shoulder width.

**Inner wing segments (r1/l1):**
```
  ┌────────┐  ← shoulder end: full chord
  │        │
  │        │  Rectangle from shoulder to hip
  │        │
  │     ┌──┘  ← hip level: inner wing chord starts to narrow
  │    ╱       Triangle tapers aft (TE retreats toward body)
  │   ╱
  └──┘        ← feet/tail: LE continues, TE meets body segment
```

The inner wing is a rectangle from shoulder to hip, with a triangle aft of the hip where the chord narrows as the leg wing fabric merges into the body's tail wing.

The body triangle and inner wing triangle are **complementary** — the body widens where the inner wing narrows, so the combined planform has consistent total chord across the span.

For the segment model, the triangular shapes affect:
- **Effective chord** — average chord of a triangle+rectangle composite is shorter than the full box chord
- **CP position** — the centroid of a triangle+rectangle is further aft than the box center
- **Area** — triangle+rectangle area is less than the full box planform

Implementation approach: the aerodynamic model still uses point-segment Kirchhoff polars (no distributed spanwise integration). The triangular refinement adjusts the **effective S, chord, and CP position** for each segment rather than changing the evaluation method. The Three.js visualization could draw the triangular outlines as a debug overlay.

---

## Segment Geometry & Area Distribution

The total reference area (S = 2.0 m²) must be distributed across the 6 segments. The body (fuselage + tail wing) carries the largest share because it includes the entire torso planform area plus the leg wing between the thighs.

The raw box planform areas (scale.x × scale.z in GLB coords) are much larger than the aerodynamic S values because the boxes are rough visual envelopes, not wetted surfaces. The aerodynamic S for each segment is tuned to sum to 2.0 m² and match the system polar at symmetric conditions.

### Box Planform vs Aerodynamic Area

| Segment | Box Planform (m²) | Aero S (m²) | Fraction | Rationale |
|---------|------------------|-------------|----------|-----------|
| `head` | 0.04 | 0.07 | 3.5% | ~25 cm diameter sphere equivalent |
| `center` | 3.00 | 0.85 | 42.5% | Only the torso section generates lift; box extends into wing area |
| `r1` / `l1` | 1.19 each | 0.39 each | 19.5% | Shoulder→elbow + hip→feet — main fabric panels |
| `r2` / `l2` | 0.23 each | 0.15 each | 7.5% | Hand area only (wingtips) — small but high control authority |
| **Total** | **5.87** | **2.00** | **100%** | |

### Chord and Span (from GLB Scale)

The GLB scale values give relative chord (z-axis) and span (x-axis) for each segment:

| Segment | GLB Chord (z) | GLB Span (x) | Physical Chord (m) | Physical Span (m) |
|---------|--------------|--------------|--------------------|-----------|
| `head` | 0.20 | 0.20 | 0.13 | 0.13 |
| `center` | 3.00 | 1.00 | 1.93 | 0.64 |
| `r1` / `l1` | 2.70 | 0.44 | 1.74 | 0.28 |
| `r2` / `l2` | 0.60 | 0.38 | 0.39 | 0.24 |

> Physical dimensions computed via $\text{GLB} \times 0.3432 \times 1.875$. The inner wings have nearly the same chord as the body because the fabric runs from shoulder height to the feet. The outer wingtips (hand area only) are short-chord, low-AR surfaces.

### Position Estimates (NED Normalized)

Converted from GLB coordinates using `NED_x = GLB_z`, `NED_y = −GLB_x`, `NED_z = −GLB_y`. These are raw GLB values — final NED-normalized positions require applying the GLB-to-NED conversion factor (TBD during calibration).

| Segment | GLB (x, y, z) | NED (x, y, z) | Roll (°) |
|---------|--------------|---------------|----------|
| `head` | (0, 0, 0.88) | (0.88, 0, 0) | 0 |
| `center` | (0, 0.02, −1.0) | (−1.0, 0, −0.02) | 0 |
| `r1` | (−0.72, 0, −1.029) | (−1.029, 0.72, 0) | +8 |
| `l1` | (+0.72, 0, −1.029) | (−1.029, −0.72, 0) | −8 |
| `r2` | (−1.10, 0, −0.074) | (−0.074, 1.10, 0) | +15 |
| `l2` | (+1.10, 0, −0.074) | (−0.074, −1.10, 0) | −15 |

> Roll angles are initial estimates, not from the Three.js model (boxes have no rotation). The outer wing panels have more dihedral (wings angled upward away from the belly), creating the dihedral effect that currently lives in `cl_beta`. The wingsuit has **dihedral only** — no anhedral. **Roll angles will be tuned during Phase 2.**

### Wing Geometry: Sweep vs Dihedral

For a wingsuit, **sweep** and **dihedral** are rotations in different planes. They must be kept distinct because the wingsuit has both simultaneously.

**Picture the pilot standing upright, arms spread:**

- **Leading edge sweep** — the leading edge of the wing at the hands is *lower* (closer to the feet) than at the shoulders. The wing chord is longer at the center body than at the wingtips, and this taper comes entirely from the leading edge retreating downward — the trailing edge (back of the legs/body) stays at roughly the same height. In flight (prone, belly-down), "lower when standing" maps to "further aft" (toward the feet = −x NED). Sweep is a rotation in the **planform plane** (top-down view of the pilot's back).

- **Dihedral** — the hands are pushed *backward* (toward the pilot's back, away from the belly). The wing surface curves from the torso toward the dorsal side as you move outboard. In flight (prone), "toward the back" maps to "upward" (away from the ground = −z NED). Dihedral is a rotation in the **front-view plane** (looking at the pilot head-on).

```
  Standing pilot, front view          Standing pilot, top view (planform)

       head                                  back
        │                                     │
   ─────┼─────  shoulder height          ─────┼─────  shoulder line
  ╱     │     ╲  ← dihedral             ╱     │     ╲  ← chest/LE
 ╱      │      ╲   (hands behind        ╱      │      ╲
hand    │    hand    belly plane)    hand       │     hand
        │                                     │
      feet                                  belly

   Dihedral plane: y-z                  Sweep plane: x-y
   (hands go BACK from belly)           (LE drops DOWN toward feet)
```

| Property | Plane | Standing description | In-flight (NED) description | Segment parameter |
|----------|-------|---------------------|----------------------------|-------------------|
| **LE sweep** | x-y (planform) | LE at hands lower than at shoulders | Wingtip LE further aft (−x) than root LE | Captured by segment x-position |
| **Dihedral** | y-z (front view) | Hands behind belly plane (toward back) | Wingtips above body plane (−z) | Captured by segment `rollDeg` |

These are independent — a wing can have sweep without dihedral, or dihedral without sweep. The wingsuit has both: **27° of LE sweep** (steeper at root, gentler at tips) and **8–15° of dihedral**.

### Leading Edge Sweep (27°)

The leading edge of the wingsuit has **27° of sweep** from root to wingtip. The original box-based analysis from the GLB model measured 14°, but this underestimated the true sweep because the rectangular boxes neglected surface area at the leading edge — particularly at the root, where the shoulders and upper chest extend well forward of the box center.

The outboard LE positions (inner wing at GLB_z = +0.321, outer wing at +0.226) are well-determined from the model geometry. Working backward from 27° sweep, the root LE is further forward than the original +0.500:

$$z_{LE,root} = z_{LE,inner} + \text{span}_{inner} \cdot \tan(27°) = 0.321 + 0.72 \times 0.5095 = +0.688$$

This places the body's leading edge between the shoulders and head, consistent with the actual fabric geometry where the upper chest catches air forward of where the rectangular box centered its area.

| Segment | Span |x| | LE (GLB_z) | Source | Sweep from root |
|---------|---------|------------|--------|----------------|
| `center` | 0.00 | +0.688 | Extended LE (27° from inner) | — |
| `r1` / `l1` | 0.72 | +0.321 | GLB model (unchanged) | 27.0° |
| `r2` / `l2` | 1.10 | +0.226 | GLB model (unchanged) | 22.8° |

The sweep is steeper in the inner wing (27°, shoulder→hip) than the outer wing (~15°, elbow→hand), creating a kinked sweep line. This is physically correct — the arm anatomy forces a change in sweep angle at the elbow/hand junction.

The trailing edge tells the opposite story — the body TE is at GLB_z = −2.50, the inner wing TE at −2.379, and the outer wing TE at −0.374. The trailing edge sweeps *forward* dramatically going outboard, confirming that the taper is entirely LE-driven.

### Quarter-Chord Center of Pressure (c/4)

The aerodynamic center of pressure for thin airfoils sits near the quarter-chord point. For each segment, the CP is at the LE minus one quarter of the chord:

$$z_{CP} = z_{LE} - \tfrac{1}{4} \cdot \text{chord}$$

| Segment | LE (GLB_z) | Chord | c/4 | CP (GLB_z) | CP (NED_x) | Span (NED_y) |
|---------|-----------|-------|-----|-----------|-----------|-------------|
| `head` | +0.880 | 0.20 | 0.05 | +0.880 | +0.880 | 0.00 |
| `center` | +0.688 | 3.19 | 0.80 | −0.109 | −0.109 | 0.00 |
| `r1` / `l1` | +0.321 | 2.70 | 0.675 | −0.354 | −0.354 | ±0.72 |
| `r2` / `l2` | +0.226 | 0.60 | 0.15 | +0.076 | +0.076 | ±1.10 |

> The center body LE extends from the shoulder line (+0.688) to the feet (−2.50), giving a longer GLB chord (3.19) than the original box measurement (3.00). This extra LE area captures the upper chest and shoulder fabric that catches airflow forward of the rectangular box center. The code position uses x/c = 0.42 (adjusted from 0.46) to account for the forward-shifted aerodynamic center.

> The head CP is at the sphere center (drag acts there). The outer wingtip CP sits well forward of the body CP because its short chord means c/4 is small. This forward CP placement gives the outer wing a long pitch moment arm — relevant for pitch coupling during asymmetric control.

Sweep affects:
- **Center of pressure** — CP of each wing panel shifts aft with sweep
- **Pitch coupling** — swept wings produce a nose-up pitch contribution at high α
- **Roll-yaw coupling** — sweep increases adverse yaw in differential-lift turns

For the segment model, sweep is captured implicitly through the segment x-positions (set by the Three.js boxes) and the per-segment `cp_0` values. No explicit sweep parameter is needed at the segment level.

---

## Per-Segment Polar Parameters

### Head (Parasitic)

The head is modeled as a sphere — roughly `cd = 0.47` (sphere drag coefficient), no meaningful lift. It produces yaw moments in sideslip because it sits far forward of the CG. GLB position z = +0.88, well ahead of the CG origin.

```
{ name: 'head', type: 'parasitic', S: 0.07, chord: 0.20, cd: 0.47 }
```

### Body / Center (Kirchhoff Lifting Body)

The center segment carries most of the lift. Its polar should closely match the system-level `aurafiveContinuous` values since it's the dominant contributor. The tail wing (between the legs) adds effective chord length. GLB scale z = 3.0 gives the longest chord of any segment.

| Parameter | Segment Value | Rationale |
|-----------|--------------|-----------|
| `cl_alpha` | 3.2 /rad | Slightly higher than system (2.9) because wing segments dilute the average |
| `alpha_0` | −2° | Same camber as system |
| `cd_0` | 0.10 | Torso frontal area |
| `k` | 0.40 | Higher than system (0.36) — shorter aspect ratio than full span |
| `cd_n` | 1.2 | Torso broadside |
| `cm_0` | −0.02 | Baseline pitch moment |
| `cm_alpha` | −0.10 | Pitch stability |
| `cp_0` | 0.40 | Same as system |

### Wing Segments (Kirchhoff Lifting Body)

The 4 wing panels share a common base polar, differentiated by position and roll angle. The inner wings (r1/l1) have nearly the same chord as the body (GLB scale z = 2.7 vs 3.0), reflecting the fabric panels running from shoulder height to the feet. The outer wingtips (r2/l2) are much shorter-chord (GLB scale z = 0.6) — just the hand area.

| Parameter | Inner Wing (r1/l1) | Outer Wing (r2/l2) | Rationale |
|-----------|-----------|------------|-----------|
| `cl_alpha` | 3.0 /rad | 2.6 /rad | Outer wing has lower effective AR (tapered, tip losses) |
| `alpha_0` | −1° | −1° | Less camber than body |
| `cd_0` | 0.06 | 0.07 | Fabric drag — outer slightly higher (exposed edge) |
| `k` | 0.30 | 0.35 | Inner has better span efficiency |
| `cd_n` | 1.0 | 1.0 | Fabric broadside |
| `cm_0` | 0 | 0 | Wings don't have inherent pitch moment |
| `cm_alpha` | −0.05 | −0.05 | Mild pitch stability |
| `cp_0` | 0.45 | 0.45 | Near mid-chord |

---

## Wingsuit Control Inputs

The wingsuit is controlled by three throttle axes, a dirty slider, and a deployment slider. The throttle inputs represent **whole-body adjustments** — subtle shifts in shoulder position, spine alignment, and weight distribution. The wingsuit is balanced like a body on a beach ball; small weight shifts and shoulder adjustments change where the center of pressure sits, and this is the primary control mechanism.

### Control Summary

| Control | Range | Physical Action | Primary Effect |
|---------|-------|----------------|----------------|
| `pitchThrottle` | [−1, +1] | Shoulders change LE angle of attack; weight shifts fore/aft | CP shifts fore/aft → pitch |
| `yawThrottle` | [−1, +1] | Spine + shoulders + head shift laterally (left/right in flight) | CP shifts left/right → yaw (+ coupled roll) |
| `rollThrottle` | [−1, +1] | Shoulders shift up/down (in flight); one side rises, other drops | Differential α across span → roll (+ coupled yaw) |
| `dihedral` | [0, 1] | Arm/wing sweep angle behind belly plane | Sets baseline dihedral → affects roll/yaw coupling strength |
| `dirty` | [0, 1] | Loose suit / reduced fabric tension | +drag, −lift slope, −stall angle (per-segment) |
| `wingsuitDeploy` | [0, 1] | PC throw → line stretch | Deployment sequence (see below) |

### Dihedral Slider

The dihedral slider sets the baseline wing dihedral angle — how far the hands are pushed behind the belly plane (toward the pilot's back). In flight (prone), this maps to how far the wingtips sit above the body plane.

- **dihedral = 0** → flat wings (hands in the belly plane) → no geometric dihedral
- **dihedral = 1** → maximum dihedral (~20°) → hands well behind belly plane

The default flying position has dihedral ≈ 0.5 (inner wings ~8°, outer wings ~15°).

| Effect | Inner Wings (r1/l1) | Outer Wings (r2/l2) |
|--------|---------------------|---------------------|
| **Roll angle at dihedral = 0** | 0° | 0° |
| **Roll angle at dihedral = 0.5** | +8° / −8° | +15° / −15° |
| **Roll angle at dihedral = 1.0** | +16° / −16° | +30° / −30° |

Dihedral affects how the other throttle inputs work:

- **Roll authority increases with dihedral** — dihedral creates a geometric coupling between sideslip and roll. More dihedral means the ω×r velocity difference across the span produces more differential lift, amplifying roll moments from any source.
- **Yaw→roll coupling increases with dihedral** — lateral CP shift (yaw throttle) produces more roll when wings have dihedral because the sideslip component sees different projected α on each side.
- **Pitch throttle is weakly affected** — dihedral slightly reduces the effective lift-curve slope (projected area decreases as cos(Γ)), but this is a small effect at typical angles.
- **Dirty coupling changes with dihedral** — at high dihedral, the tension distribution across the suit changes, making the outer wing fabric more susceptible to flutter.

The segment model applies dihedral by setting each wing segment's `rollDeg` as a function of the slider:

$$\text{rollDeg}_{\text{inner}} = \pm\ 16° \times \text{dihedral}$$
$$\text{rollDeg}_{\text{outer}} = \pm\ 30° \times \text{dihedral}$$

The outer wings have approximately twice the dihedral angle of the inner wings because the hands can reach further behind the belly plane than the elbows.

### Pitch Throttle

The pilot shifts weight slightly forward or backward, like rocking on a balance point. The shoulders change the leading edge angle of attack — a physical change in the LE incidence angle. The rest of the body position (hand positions, wing shape) stays the same.

- **Positive pitchThrottle** → de-arch slightly → steeper descent, higher speed
- **Negative pitchThrottle** → arch slightly → flatter glide, slower speed

| Effect | Parameter | Sensitivity | Segments |
|--------|-----------|-------------|----------|
| **LE angle of attack** | `d_alpha_0` | ±1.5° at full deflection | All lifting segments |
| **CP fore/aft shift** | `d_cp_0` | ±0.05 (weight shift forward = CP forward) | `center`, `r1`/`l1` |
| **Slight camber change** | `d_cl_alpha` | ±0.1 /rad | All lifting segments |
| **Drag change** | `d_cd_0` | +0.005 at extremes (suboptimal body position) | `center` |

The key distinction from the old `brake`/`delta` control: pitch throttle changes the LE angle of attack directly via shoulder position, with a coupled weight shift. It maintains suit tension and body symmetry.

### Yaw Throttle

The pilot shifts the spine and shoulders laterally — in flying position (prone), this means the shoulders and head move to the right or left. The head movement is part of this input — turning/shifting the head contributes yaw moment because of its large forward moment arm.

- **Positive yawThrottle** → shift right → yaw right
- **Negative yawThrottle** → shift left → yaw left

| Effect | Parameter | Sensitivity | Segments |
|--------|-----------|-------------|----------|
| **Lateral CP shift** | Segment y-position bias | ±0.03 (NED) at full deflection | `center` |
| **Head lateral offset** | Head y-position bias | ±0.02 — head shifts with shoulders | `head` |
| **Differential suit tension** | Per-side dirty coupling | See below — one side tightens, other loosens | `r1`, `l1`, `r2`, `l2` |
| **Slight roll coupling** | Differential `d_alpha_0` | ±0.3° — body twist induces roll | `r1`/`r2` vs `l1`/`l2` |

**Yaw → roll coupling**: a yaw input naturally induces some roll because shifting laterally changes the effective angle of attack on each side slightly. This is inherent — not an additional control input. The coupling makes the wingsuit coordinate turns naturally.

**Head contribution**: the head is part of the yaw throttle response. Its large moment arm (GLB_z = +0.88, well forward of CG) means even a small lateral shift creates a significant yaw moment. The head's drag force in the offset position acts like a rudder.

### Roll Throttle

The pilot raises one shoulder and drops the other — in flying position (prone), one shoulder moves up (away from ground) and the other moves down. This changes the local angle of attack across the span: the dropping side sees a lower α, the rising side sees a higher α.

- **Positive rollThrottle** → right shoulder down (in flight) → roll right
- **Negative rollThrottle** → left shoulder down (in flight) → roll left

| Effect | Parameter | Sensitivity | Segments |
|--------|-----------|-------------|----------|
| **Differential α** | `d_alpha_0` | ±0.8° — outer wings see more change than inner | R-wings vs L-wings (opposite sign) |
| **Differential camber** | `d_cl_alpha` | ±0.15 /rad — spanning wing camber change | Outer > inner sensitivity |
| **Slight yaw coupling** | Differential `d_cd_0` | ±0.005 — side with more lift has more induced drag | Adverse yaw (natural) |

The outer wing segments (r2/l2) have **higher roll sensitivity** than the inner wings (r1/l1) because the shoulder motion has more effect on the hand-area wingtips:

| Segment | Roll sensitivity | Rationale |
|---------|-----------------|-----------|  
| `r1` / `l1` (inner wing) | 0.6 | Fabric panel constrained by body |
| `r2` / `l2` (outer wing) | 1.0 | Hands/wrists have most freedom |

**Roll → yaw coupling**: roll inputs produce slight adverse yaw from differential induced drag (the higher-lift side has more drag). This is a natural aerodynamic coupling, not an artificial cross-connection.

### Cross-Coupling Summary

All three throttle axes produce coupled responses because the wingsuit is a single flexible surface. The dihedral slider modulates coupling strengths:

| Input | Primary Effect | Coupled Effect | Dihedral Influence |
|-------|---------------|----------------|-------------------|
| `pitchThrottle` | Pitch (CP fore/aft) | Slight speed change | Weak — slight effective area reduction |
| `yawThrottle` | Yaw (CP lateral) | Roll (body twist) | **Strong** — more dihedral = more roll per yaw |
| `rollThrottle` | Roll (differential α) | Adverse yaw | Moderate — dihedral amplifies differential lift |
| `dihedral` | Roll/yaw coupling gain | Stability vs agility tradeoff | Sets the baseline for all coupling |

The coupling strengths will be tuned during Phase 3. At low dihedral the wingsuit is more agile (less coupling, less stability). At high dihedral the wingsuit is more stable (strong sideslip→roll coupling, coordinated turns) but harder to initiate maneuvers.

---

## Dirty Flying with Segments

The `dirty` slider controls overall suit tension. With segments, it affects each one differently:

| Segment | Dirty Effect | Rationale |
|---------|-------------|----------|
| `head` | None | Head shape doesn't change |
| `center` | Moderate: `d_cd_0` +0.035, `d_cl_alpha` −0.15, `d_k` +0.10, `d_cd_n` +0.15, `d_alpha_stall_fwd` −2° | Torso relaxes but stays relatively stiff |
| `r1` / `l1` (inner) | Strong: `d_cd_0` +0.06, `d_cl_alpha` −0.4, `d_k` +0.12, `d_cd_n` +0.15, `d_alpha_stall_fwd` −4° | Inner wing fabric loses tension first |
| `r2` / `l2` (outer) | Strongest: `d_cd_0` +0.08, `d_cl_alpha` −0.5, `d_k` +0.15, `d_cd_n` +0.15, `d_alpha_stall_fwd` −5° | Outer wing (hands) flaps most |

The total dirty effect should aggregate to match the current system-level dirty control when all segments are combined at symmetric conditions.

### Dirty Coupling with Throttle Inputs

The wingsuit is a flexible surface, so throttle inputs change fabric tension and produce dirty-like effects even when the `dirty` slider is at 0:

- **Yaw throttle → differential dirty**: shifting the spine right tightens the left side of the suit and loosens the right side. This is the same physical effect as `dirty`, but applied asymmetrically. The loosened side sees increased `cd_0`, decreased `cl_alpha`, and reduced stall angle — exactly the per-segment dirty effects above, but applied to one side only.

- **Roll throttle → differential camber/tension**: dropping one shoulder changes the camber and tension of the cells across the span. The side with the lowered shoulder (lower α) also has slightly looser fabric, contributing a small dirty effect on that side.

- **Pitch throttle → symmetric tension change**: extreme pitch inputs (full arch or full de-arch) can reduce overall suit tension slightly, producing a small symmetric dirty increment.

The effective per-segment dirty value is:

$$\text{dirty}_{\text{eff}}(\text{segment}) = \text{dirty}_{\text{slider}} + k_{\text{yaw}} \cdot \text{yawThrottle} \cdot \text{sign}(\text{side}) + k_{\text{roll}} \cdot |\text{rollThrottle}| \cdot \text{sign}(\text{side})$$

where `sign(side)` is +1 for the loosened side and −1 for the tightened side. The coupling constants $k_{\text{yaw}}$ and $k_{\text{roll}}$ are small (≈ 0.1–0.2) — throttle inputs produce subtle tension changes, not full dirty flying.

---

## Wingsuit Deployment Model

### What Happens Physically

| Phase | Time | Description |
|-------|------|-------------|
| 0. Normal flight | — | Flying the wingsuit, container closed |
| 1. Reach back | ~1 s | Pilot reaches for pilot chute — one arm breaks flying position |
| 2. Throw PC | ~0.5 s | Pilot chute thrown into relative wind |
| 3. PC inflation | ~1 s | PC inflates, bridle tension begins |
| 4. Container opens | ~0.5 s | Pin pull, container opens, canopy begins extraction |
| 5. Bag strip | ~1.5 s | Lines deploy from bag, canopy starts to unfurl |
| 6. Line stretch | instant | Lines reach full extension — **handoff to canopy model** |

### Deployment Slider (0 → 1)

| Value | Phase | Aerodynamic State |
|-------|-------|-------------------|
| 0.0 | Normal flight | Full wingsuit polar, no deployment hardware |
| 0.0–0.2 | Reach + throw | Right arm breaks position → right wing segments lose area/lift |
| 0.2–0.5 | PC inflating + bridle | Drag body appears behind pilot (PC = parasitic drag) |
| 0.5–0.8 | Container open + bag strip | Additional drag from exposed canopy bag, lines paying out |
| 0.8–1.0 | Lines deploying | Point-mass canopy at end of growing line, significant drag |
| 1.0 | Line stretch | **Simulation handoff** → switch to canopy model |

### Deployment Effects on Wingsuit Segments

| Deploy | Right arm wings | Body | Added drag bodies |
|--------|----------------|------|-------------------|
| 0.0 | Full area, full polar | Normal | None |
| 0.1 | Area × 0.7 (arm reaching back) | Normal | None |
| 0.2 | Area × 0.4 (arm extended behind) | `cd_0` +0.02 (open container) | PC: parasitic, S = 0.7 m² |
| 0.5 | Area × 0.3 (arm still back) | `cd_0` +0.03 | PC + bridle drag |
| 1.0 | Area recovery (arm returns) | `cd_0` +0.01 (closing up) | Canopy bundle: point mass + drag |

### Deployment 3D Model

**Assets:**
- `snivel.glb` — canopy fabric in snivel (extracted, not yet inflated)
- `pc.glb` — pilot chute (existing PC model, reuse from canopy viewer)
- `THREE.ArrowHelper` — lines from pilot shoulders → snivel, and bridle from container → PC (scalable to fit dynamic distances)

**Slider sequence (deploy 0 → 1):**

| deploy | What appears | Behavior |
|--------|-------------|----------|
| 0.0 | Nothing | Snivel, lines, PC all hidden |
| >0.0 | PC appears | PC spawns at container (mid-back), moves straight back along **airspeed vector** |
| — | Bridle grows | `ArrowHelper` from container → PC, stretches as PC moves aft |
| ~0.5 (bridle length) | Snivel appears | `snivel.glb` spawns at container position (use CP / quarter-chord location) |
| 0.5→1.0 | Snivel moves back | Snivel pulled aft along airspeed vector toward line-length distance |
| — | Lines grow | `ArrowHelper` from pilot shoulders → snivel, stretch as snivel moves aft |
| 1.0 | Full extension | Snivel at full line length from shoulders — **handoff to canopy model** |

All moving parts travel along the **airspeed (relative wind) line** behind the pilot. Distances are simple linear interpolation within each sub-range. No inflation physics — this is a kinematic visualization only.

### Handoff to Canopy Model

At `deploy = 1.0` (line stretch), the simulation transitions from the wingsuit segment model to the canopy segment model. The handoff requires:

1. **State transfer** — current velocity (u, v, w), attitude (φ, θ, ψ), angular rates (p, q, r), position (x, y, z)
2. **Segment swap** — replace wingsuit 6 segments with canopy 16 segments (7 cells + 6 flaps + 2 parasitic + 1 pilot)
3. **Mass model swap** — replace wingsuit 14-part mass model with canopy mass model (pilot + structure + air)
4. **Pilot pitch = initial** — the pilot's body orientation at line stretch becomes the initial `pilotPitch` in the canopy model
5. **Canopy deploy = 0** — the canopy model starts at `deploy = 0` and begins inflation from there

The wingsuit `deploy = 1.0` and canopy `deploy = 0.0` represent the same physical instant — line stretch.

---

## Factory Function

A new factory function assembles the wingsuit segment model:

```typescript
export function makeWingsuitAeroSegments(
  wingsuitPolar: ContinuousPolar,  // base Aura 5 polar (for system-level ref)
): AeroSegment[]
```

This function:
1. Defines the 6 segment polars (head, body, inner wing, outer wing)
2. Creates each segment with appropriate position, roll angle, and area
3. Wires `pitchThrottle`/`yawThrottle`/`rollThrottle` controls with per-segment sensitivity and coupling
4. Wires dirty coupling (yaw/roll → differential tension)
5. Returns the segment array

The factory is analogous to `makeIbexAeroSegments()` for the canopy.

### New SegmentControls Fields

```typescript
// Add to SegmentControls interface:
pitchThrottle: number    // [-1, +1] symmetric pitch — LE angle + weight shift
yawThrottle: number      // [-1, +1] lateral spine/head shift → yaw (+ coupled roll)
rollThrottle: number     // [-1, +1] differential shoulder height → roll (+ coupled yaw)
dihedral: number         // [0, 1] wing dihedral angle (0 = flat, 1 = max ~20°)
wingsuitDeploy: number   // [0, 1] wingsuit deployment phase (0 = flight, 1 = line stretch)
```

The existing `dirty` field remains as the explicit tension slider. The throttle inputs produce additional dirty coupling internally (see [Dirty Coupling with Throttle Inputs](#dirty-coupling-with-throttle-inputs)).

---

## Tuning Strategy

### Constraint: Match System Polar

At symmetric conditions (δ = 0, dirty = 0, β = 0), the 6-segment model must produce the same total forces as the single-body `aurafiveContinuous` across the full α range. The tuning process:

1. Sweep α from −180° to +180° with the segment model
2. Sum all segment forces → system CL, CD, CY, CM
3. Compare against `aurafiveContinuous` single-body evaluation
4. Adjust per-segment parameters until the system curves match

The segment model should produce **identical** CL vs α, CD vs α, and CM vs α curves. The new capability is in the asymmetric/dynamic behavior, not the symmetric baseline.

### What's New (Not Constrained)

- Roll moment from `rollThrottle` → tune roll authority magnitude (differential α sensitivity)
- Yaw moment from `yawThrottle` (including head lateral shift) → tune yaw authority and roll coupling
- Pitch authority from `pitchThrottle` → tune LE angle range and CP shift magnitude
- Cross-coupling strengths (yaw→roll, roll→yaw) → tune against pilot feel
- Dirty coupling from throttle inputs → tune $k_{\text{yaw}}$ and $k_{\text{roll}}$
- Damping derivatives from ω×r across span → emerges naturally from segment spacing
- Dirty flying per-segment differentiation → tune against pilot subjective feel

---

## SegmentControls Additions Summary

| Field | Type | Range | Used By |
|-------|------|-------|---------|
| `pitchThrottle` | number | [−1, +1] | All lifting segments — LE angle, CP shift, camber |
| `yawThrottle` | number | [−1, +1] | Body + head lateral shift, differential wing tension |
| `rollThrottle` | number | [−1, +1] | Differential α/camber across L/R wing segments || `dihedral` | number | [0, 1] | Wing segment roll angles — modulates roll/yaw coupling || `wingsuitDeploy` | number | [0, 1] | Wingsuit deployment phase |

The existing `dirty` field applies per-segment with differentiated sensitivity and is coupled into the throttle inputs via fabric tension effects.

---

## Implementation Plan

### Phase 1: Segment Data & Factory ✅

- [x] Define per-segment polars (head parasitic, body, inner wing, outer wing) in `polar-data.ts`
- [x] Create `makeWingsuitAeroSegments()` factory in `segment-factories.ts`
- [x] Add `pitchThrottle`, `yawThrottle`, `rollThrottle`, `dihedral`, `wingsuitDeploy` to `SegmentControls`
- [x] Wire segment `getCoeffs()` closures for throttle response (pitch, yaw, roll)
- [x] Position segments using Three.js overlay (14° LE sweep positions)

### Phase 2: Symmetric Tuning ✅

- [x] Sweep α and compare 6-segment total vs `aurafiveContinuous`
- [x] Adjust S, cl_alpha, cd_0, k per segment until system CL/CD/CM match
- [x] Verify speed polar matches at all α
- [x] Verify CP travel matches
- [x] Tune segment positions using chord-fraction system (matched to GLB model bbox)
- [x] System CG set to x/c = 0.40 (from CloudBASE reference data)
- [x] Inner wing shape refined: tapered TE, forward CP, strong weathervane cn_beta
- [x] Debug overrides wired for wingsuit segments
- [x] L/D tuned to ~2.87 (drag coefficient reduction)

### Phase 3: Throttle Controls

- [x] Add `pitchThrottle`, `yawThrottle`, `rollThrottle`, `dihedral` UI sliders
- [x] Implement dihedral slider: wing segment rollDeg as function of slider position
- [x] Implement pitch throttle: LE angle change + CP shift on all lifting segments
- [x] Implement yaw throttle: lateral body/head shift + differential tension
- [x] Implement roll throttle: differential α across span + adverse yaw coupling
- [x] Wire head yaw contribution into yaw throttle response
- [x] Implement dihedral-dependent coupling strengths (yaw→roll, roll gain)
- [x] Add `FlightState` fields (`pitchThrottle`, `yawThrottle`, `rollThrottle`, `wsDihedral`)
- [x] Add wingsuit-controls-group HTML with visibility toggle (shown when `modelType === 'wingsuit'`)
- [x] Wire `readState()` parsing, label updates, and event listeners for all 4 sliders
- [x] Wire `buildSegmentControls()` mapping from `FlightState` → `SegmentControls`
- [x] Reset wingsuit sliders on polar change (0/0/0/50)
- [ ] Tune cross-coupling strengths (yaw→roll, roll→yaw) at various dihedral settings — *deferred, good enough*
- [ ] Tune authority magnitudes against reference data / pilot feel — *deferred, good enough*

### Phase 3.5: Triangular Planform Refinement ✅

- [x] Compute effective S, chord, and CP for triangle+rectangle composite shapes
- [x] Update body segment: rectangle (hips→tail) + triangle (hips→shoulders)
- [x] Update inner wing segments: rectangle (shoulder→hip) + triangle (hip→tail, TE retreats)
- [x] Adjust per-segment polars to reflect corrected effective chord/area
- [x] Re-verify symmetric tuning with corrected planforms
- [x] ~~Add triangular outline debug overlay~~ — not needed, CP arrows + GLB model are sufficient

### Phase 4: Dirty Flying (Segmented + Coupled) ✅

- [x] Implement per-segment dirty sensitivity from dirty slider
- [x] Implement dirty coupling from yawThrottle (differential tension)
- [x] Implement dirty coupling from rollThrottle (differential tension)
- [x] Verify total dirty effect matches current system-level behavior at symmetric conditions
- [x] Tune outer wing → inner wing → body dirty gradient
- [x] Tune coupling constants $k_{\text{yaw}}$ and $k_{\text{roll}}$

### Phase 5: Deployment Model ✅

- [x] Add `wingsuitDeploy` slider to UI
- [x] Create deployment 3D model (PC, bridle, lines, canopy bundle)
- [x] Implement handoff logic: wingsuit `deploy = 1` → canopy `deploy = 0`

### Phase 6: Visualization

- [ ] Draw per-segment velocity arrows (already supported by ω×r pipeline)
- [ ] Draw per-segment force vectors (already supported)
- [ ] Add segment outlines to Three.js wingsuit model for debug overlay
- [ ] Verify damping moment arcs during roll rate

---

## Relationship to Export System

The export system (OUTPUT.md) already handles multi-segment configurations via `AeroSegmentDescriptor`. The wingsuit segment model will export identically to the canopy model — 6 descriptors instead of 16, referencing 3 polars (head parasitic, body, wing) instead of 4.

The `rotatePilotMass()` function and mass segment arrays remain unchanged since the 14 mass segments already model the wingsuit body correctly in flying position.

New `ControlConstants` for the wingsuit (if any differ from the canopy defaults) would be exported alongside. The deployment slide data (arm area scaling, PC drag addition) would be captured in the factory closure descriptors, similar to how canopy deployment morphing works.

---

## Resolved Questions

1. **GLB-to-NED scale factor** — **Resolved.** $k = 0.302 / 0.88 = 0.3432$. Head GLB_z = +0.88 maps to head mass segment x_norm = +0.302. Physical dimensions via $\text{physical} = \text{GLB} \times 0.3432 \times 1.875$.
2. **Dihedral angles** — **Now a slider.** Dihedral is a runtime control input [0, 1] rather than a fixed parameter. Default position ~0.5 gives inner ≈8°, outer ≈15°. Full range: 0° (flat) to 16°/30° (inner/outer).
3. **Triangular refinement** — **Planned for Phase 3.5.** Body = rectangle (hips→tail) + triangle (hips→shoulders). Inner wing = rectangle (shoulder→hip) + triangle (hip→tail, TE retreats). Complementary shapes maintain consistent total chord.
4. **Tail wing extent** — **Resolved.** The tail wing extends past the feet to GLB_z = −2.50 (NED_x = −0.858). The entire extension is aerodynamically active fabric.
5. **Wing taper** — **Resolved.** Inner wings are full-length fabric (shoulder to feet). Outer wings (r2/l2) are hand area only — small control surfaces, not primary lift panels. Taper is entirely LE-driven (14° sweep).
6. **Wingsuit GLB scaling** — Segment boxes will be drawn procedurally as a debug overlay rather than embedded in the GLB. The GLB is the visual model; the boxes are the aerodynamic model.

---

## Reference: CloudBASE Simulator Wingsuit Control

The existing CloudBASE simulator (`simulatorwingsuitcontrol.ts`) implements a single-body wingsuit pitch dynamics model. It lacks yaw, body-frame rotation, and multi-segment aerodynamics, but provides validated reference values for geometry, inertia, and control scaling.

### Validated Physical Dimensions

The class comments and hardcoded values give precise body stations (measured from top of head):

| Station | Distance from Head (mm) | x/c Fraction |
|---------|------------------------|--------------|
| Top of head | 0 | 0.000 |
| Sternum | 520 | 0.268 |
| Belly button | 736.6 | 0.380 |
| Hips | 863.6 | 0.445 |
| Knees | 1295 | 0.668 |
| Feet | 1803.4 | 0.929 |
| **Total chord** | **1940** | **1.000** |

Key derived values:
- **Total chord: 1.940 m** — our document uses 1.8 m (from `aurafiveContinuous`). The 1.94 m value is the physical measurement including the full tail wing. This confirms the tail wing extends ~137 mm past the feet.
- **Quarter chord: 485 mm → x/c = 0.25** — standard aerodynamic center location
- **Center of mass: 766.3 mm → x/c = 0.395** — CG sits just forward of the belly button (736.6 mm). This matches our `cp_0 = 0.40` for the center segment.
- **Span: grippers 67 cm, hips 43 cm, shin 42 cm** — confirms the span narrows significantly from hands to body, consistent with our inner/outer wing segmentation.

### Hip Line Position

The hips at 863.6 mm = **x/c = 0.445** from the head. In GLB coordinates, this is:

$$z_{\text{hip}} = z_{\text{head}} - 0.445 \times \text{chord}_{\text{GLB}} = 0.88 - 0.445 \times (0.88 - (-2.50)) = 0.88 - 0.445 \times 3.38 \approx -0.62$$

This gives the **triangular split point** at GLB_z ≈ −0.62 (NED_x ≈ −0.213). The body segment transitions from triangle (head→hips) to rectangle (hips→tail) at this line, and the inner wing chord begins tapering aft of hips.

### Pitch Dynamics Parameters

| Parameter | CloudBASE Value | Notes |
|-----------|----------------|-------|
| `totalchordlength` | 1.940 m | Physical chord |
| `centerofmassxc` | 0.395 (x/c) | CG at ~belly button |
| `momentInertia` | 0.01 (fractional) | Pitch inertia tuning factor — not physical I_yy |
| `dampingcoefficient` | 24 | Pitch rate damping |
| `dt` | 0.1 s | Integration time step |
| CP input scalar | 0.062 × pitchInput | CP shift per unit pitch input (x/c fraction) |
| Lateral CP shift | −0.006 × rollDifferential | Very small — confirms CP shift is the primary mechanism, not large position changes |
| Input smoothing | `α = 0.25` (1st-order filter) | `deckanglepush += 0.25 * (input - deckanglepush)` |
| Density correction | $\sqrt{\rho_{\text{ref}} / \rho_{\text{local}}}$ | Applied to pitch input for altitude-invariant behavior |

### Moment Calculation Approach

The CloudBASE `getmoment()` function computes pitching moment from first principles — no cm coefficient:

1. Compute CG-to-CP lever arm: `cgtocp = (cp_xc - cg_xc) × chord`
2. Resolve lever arm through deck angle into x/y components
3. Compute lift and drag forces: `L = CL × q × S`, `D = CD × q × S`
4. Resolve forces through flight path angle (α)
5. Moment = cross product: `M = lever_x × F_y + lever_y × F_x`

This is equivalent to our segment model's `evaluateAeroForcesDetailed()` approach where moments emerge from force × position rather than explicit cm coefficients. The key insight: **the CP shift from pitch input (0.062/unit) is the primary control mechanism**, consistent with our `pitchThrottle → d_cp_0` model.

### Control Input Architecture

The CloudBASE simulator combines three input sources (keyboard, gamepad, pointer) into pitch and roll:

| Axis | Keyboard | Gamepad | Pointer | Combined |
|------|----------|---------|---------|----------|
| Pitch | ±1 (±2 hard) | stick × pitchThrottle | ±2 (normalized) | Sum → smoothed |
| Roll | ±4 | stick×4 + triggers×12 | ±6 | Sum → deg/s |

Roll differential is applied as angular rate (`rolldifferential × π/180 × 2 × v`) scaled by airspeed, then added directly to the roll angle. There is no aerodynamic roll moment — roll is purely kinematic. Our segment model will produce aerodynamic roll moments from the differential lift across the span, which is the key improvement.

### What CloudBASE Lacks (Our Improvements)

| Feature | CloudBASE | Our Segment Model |
|---------|-----------|-------------------|
| Yaw dynamics | None — β clamped to 0 | Full yaw from `yawThrottle` + head + `cn_beta` |
| Body frame | Inertial frame only (commented-out DCM code) | Full body-frame 6DOF via `eom.ts` |
| Roll moment | Kinematic (rate applied directly) | Aerodynamic (differential lift from ω×r + throttle) |
| Multi-segment | Single polar evaluation | 6-segment Kirchhoff with per-segment coefficients |
| Lateral CP | Tiny scalar (−0.006) | Emerges from segment positions + yaw throttle |
| Dirty coupling | Not modeled | Per-segment tension × throttle coupling |
| Dihedral | Not modeled | Runtime slider affecting roll/yaw coupling |

### Values to Adopt

Several CloudBASE values should be carried forward as starting points for tuning:

1. **CG at x/c = 0.395** — use as the reference CG for moment calculations. Our center segment `cp_0 = 0.40` is very close (intentionally — CG near CP gives neutral pitch).
2. **CP shift of 0.062/unit** — maps to our `pitchThrottle → d_cp_0 = ±0.05`. CloudBASE uses ±0.062 at full stick; our ±0.05 is slightly more conservative. Consider increasing to 0.06.
3. **Chord = 1.940 m** — our `aurafiveContinuous` uses 1.8 m as the reference chord. The physical measurement is 1.94 m. The difference (140 mm) is within the tail wing overhang. We should use **1.94 m** as the physical chord for segment geometry and moment arms, while keeping 1.8 m as the aerodynamic reference chord in the polar.
4. **Body station map** — the head/sternum/belly/hips/knees/feet stations give precise anchor points for the triangular planform split (hips at x/c = 0.445) and for validating the GLB-to-NED conversion.
5. **Input smoothing (α = 0.25)** — the first-order filter on pitch input gives responsive but not twitchy control. Apply the same smoothing to all three throttle axes.
6. **Density altitude correction** — $\sqrt{\rho_{\text{ref}}/\rho_{\text{local}}}$ on control inputs ensures consistent authority across altitudes. Adopt for all throttle axes.

## Remaining Open Questions

All major design questions have been resolved. The following items are **tuning parameters** that will be calibrated during implementation:

1. **Dihedral range calibration** — The max dihedral angles (16° inner, 30° outer at slider = 1.0) are reasonable estimates. Final values will be tuned during Phase 3 against pilot feel and reference video.
2. **Triangular split point** — **Resolved.** Hips at x/c = 0.445 (GLB_z ≈ −0.62) from CloudBASE body station data. The triangular refinement is an **internal model adjustment** only — the rectangular Three.js boxes stay as the visual overlay. The triangle math computes effective S, chord, and CP for each segment without needing triangular geometry in the editor.
3. **Throttle coupling constants** — $k_{\text{yaw}}$, $k_{\text{roll}}$, and cross-coupling strengths start conservative (CloudBASE lateral CP scalar −0.006 suggests small values). Will be tuned during Phase 3.
4. **Physical vs reference chord** — **Resolved.** Use **1.94 m** (CloudBASE physical measurement) for segment geometry, moment arms, and CG-to-CP calculations. Keep **1.8 m** as the aerodynamic reference chord in `aurafiveContinuous` for non-dimensional coefficients (CL, CD, CM).
