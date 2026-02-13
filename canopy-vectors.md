# Aerodynamic Segment System — Implementation Plan

## Overview

A **universal aerodynamic segment system** that decomposes any flight vehicle into reusable `AeroSegment` units. Each segment has a position in the body frame, a reference area, coefficient functions, and optionally responds to control inputs. Forces and moments from all segments are summed at the system CG using well-established rigid-body equations.

This system handles:
- **Canopy**: 7 cell segments + line set + pilot body + bridle/PC (10+ segments)
- **Wingsuit**: 1–3 segments (single CP or left/right wing + fuselage)
- **Airplane**: Left wing + right wing + fuselage + elevator + rudder + flaps (6+ segments)

The same `AeroSegment` interface and force-summation math applies to all vehicle types.

---

## Reference Methodology

The approach follows the **component breakdown method** used in paraglider and multi-body flight dynamics.

### Paraglider Longitudinal Model (Reference Fig. 1)

The system is modeled as a rigid body with forces summed at a **system point (SP)**:

$$X_{SP} = X_w + X_p + (m \cdot g)_b$$
$$Z_{SP} = Z_w + Z_p + (m \cdot g)_b$$

Each component has **its own aerodynamic coefficients and reference area**:

$$L_w = C_{L_w} \cdot q \cdot S_w, \quad D_w = C_{D_w} \cdot q \cdot S_w$$
$$L_p = C_{L_p} \cdot q \cdot S_p, \quad D_p = C_{D_p} \cdot q \cdot S_p$$

Moments about the system CG from lever arms:

$$M_{SP} = Z_w \cdot (X_{SP_w} - X_{AC_w}) - X_w \cdot k_w + Z_p \cdot (X_{SP_p} - X_{AC_p}) - X_p \cdot k_p + M_w + M_p$$

Where $k_w$, $k_p$ are lever arm distances from each component's AC to the system CG.

### UAV Component Breakdown (Reference Fig. 2)

A fixed-wing UAV is divided into segments, each experiencing **local velocity and local angle of attack**. Forces are computed per-segment then summed. Each segment sees its own effective α depending on its position, any control surface deflection, and cross-flow effects.

### Paraglider Transversal Model (Reference — turning)

For turning flight, the moment equilibrium about CG includes:
- Centripetal terms from turn radius $R$ and velocity $v$
- Pilot weight arm $k_3$ (distance between pilot CG and body CG)
- Canopy weight arm $k_2$ (distance between canopy CG and body CG)
- Lift force arm $k_1$ (distance between wing lift and CG)

$$-\Delta F_b \cdot k_1 - \frac{G_p \cdot v^2}{g \cdot R} \cdot k_3 \cdot \cos(\gamma) + \frac{G_k \cdot v^2}{g \cdot R} \cdot k_2 \cdot \cos(\gamma) + G_p \cdot \sin(\gamma) \cdot k_3 - G_k \cdot \sin(\gamma) \cdot k_2 = 0$$

This shows why we need **per-cell** canopy segments: asymmetric brake input creates $\Delta F_b$ (differential lift) that generates roll/yaw moments through the lever arm $k_1$.

### Key Principle

**Every aerodynamic segment works the same way:**
1. Has a position (aerodynamic center) in the body frame
2. Has a reference area $S$
3. Has coefficient functions $C_L(\alpha, \beta, \delta)$ and $C_D(\alpha, \beta, \delta)$
4. Optionally responds to one or more control inputs ($\delta$)
5. Computes force = $q \cdot S \cdot C$ at its position
6. All segment forces are summed; moments arise from lever arms about CG

---

## The `AeroSegment` Interface

```typescript
/**
 * A single aerodynamic segment — a surface, body, or sub-wing panel
 * that produces forces at a known position in the body frame.
 *
 * All positions are NED body-frame, normalized by reference height (1.875 m),
 * matching the MassSegment convention.
 *
 * Each canopy cell segment has its own ContinuousPolar and computes
 * its own local α, β, and δ based on cell orientation and control inputs.
 * Parasitic bodies (lines, pilot, bridle) use simple constant coefficients.
 *
 * Forces from all segments are summed at the combined canopy-pilot CG
 * using rigid-body equations.
 */
export interface AeroSegment {
  /** Human-readable name (e.g. 'cell_c', 'cell_r1', 'lines', 'pilot') */
  name: string

  /** Aerodynamic center position in NED body frame (normalized) */
  position: { x: number; y: number; z: number }

  /**
   * Cell orientation from arc geometry.
   * roll_deg: arc angle θ — 0° at center, ±12°/24°/36° at outer cells.
   *           Determines how freestream α, β map to local flow angles.
   * pitch_deg: optional incidence offset (washout, trim tab, etc.)
   *
   * For non-canopy segments (lines, pilot, bridle), orientation is
   * { roll_deg: 0 } — they see freestream directly.
   */
  orientation: { roll_deg: number; pitch_deg?: number }

  /** Reference area [m²] for this segment */
  S: number

  /** Segment chord [m] — for local CM calculation (moment = q·S·c·CM) */
  chord: number

  /**
   * This segment's own ContinuousPolar, if applicable.
   *
   * Canopy cell segments: each cell has its own polar with its own
   * aerodynamic parameters. All 7 cells typically share the same base
   * airfoil profile, but each computes coefficients independently at
   * its own local α, β, δ.
   *
   * Parasitic bodies: undefined — they use constant coefficients.
   */
  polar?: ContinuousPolar

  /**
   * Evaluate coefficients at given FREESTREAM flow conditions.
   *
   * For canopy cells, this function internally:
   * 1. Transforms freestream α, β into local α_local, β_local
   *    based on this cell's orientation (arc angle θ)
   * 2. Applies any riser-induced α offset (Δα from front/rear riser)
   * 3. Determines the local δ (camber change) from brake inputs
   *    and this cell's position in the brake cascade
   * 4. Evaluates cell's own ContinuousPolar at (α_effective, β_local, δ)
   * 5. Returns coefficients + center of pressure for this segment
   *
   * For parasitic bodies, returns constant CD (ignores controls).
   *
   * @param alpha_deg  Freestream angle of attack [deg]
   * @param beta_deg   Freestream sideslip angle [deg]
   * @param controls   Current control inputs
   * @returns coefficients + center of pressure (chord fraction)
   */
  getCoeffs(
    alpha_deg: number,
    beta_deg: number,
    controls: SegmentControls,
  ): {
    cl: number    // lift coefficient
    cd: number    // drag coefficient
    cy: number    // side force coefficient
    cm: number    // pitching moment coefficient (about segment AC)
    cp: number    // center of pressure (chord fraction, for force application)
  }
}
```

### Control Inputs

```typescript
/**
 * All possible control inputs, passed to every segment.
 * Each segment picks the controls it responds to and ignores the rest.
 *
 * Canopy cells respond to brake and riser inputs on their side.
 * Airplane segments respond to elevator, rudder, flap deflections.
 * Pilot body responds to weight shift.
 * Simple drag bodies (lines, bridle) ignore controls entirely.
 *
 * Values are normalized: 0 = neutral, +1 = full deflection.
 * Negative values allowed where meaningful (e.g. speed bar = negative front riser).
 */
export interface SegmentControls {
  // ── Canopy inputs (6 total) ──
  brakeLeft: number       // 0–1, left brake toggle
  brakeRight: number      // 0–1, right brake toggle
  frontRiserLeft: number  // 0–1, left front riser
  frontRiserRight: number // 0–1, right front riser
  rearRiserLeft: number   // 0–1, left rear riser
  rearRiserRight: number  // 0–1, right rear riser

  // ── Pilot body inputs ──
  weightShiftLR: number   // -1 (left) to +1 (right), lateral weight shift

  // ── Airplane inputs ──
  elevator: number        // -1 to +1, elevator deflection
  rudder: number          // -1 to +1, rudder deflection
  aileronLeft: number     // -1 to +1, left aileron
  aileronRight: number    // -1 to +1, right aileron
  flap: number            // 0–1, flap deflection (symmetric)

  // ── Universal ──
  delta: number           // Generic symmetric control (current δ slider — arch, brakes, etc.)
  dirty: number           // Wingsuit dirty-flying factor
}
```

---

## Canopy System — 7 Cell Segments + Parasitic Bodies

### Why 7 Cells?

The canopy already has 7 mass segment positions (center + 3 left + 3 right) forming an arc. Using the same 7 positions for aerodynamic segments gives us:

1. **Asymmetric control**: Pulling left brake increases camber on left cells → differential lift → roll/yaw moment through lever arms. Each cell's `getCoeffs()` responds to the brake input for its side.

2. **Span-wise lift distribution**: Outer cells at higher arc angles produce less effective lift. Cross-flow and local α vary across the span.

3. **Line tension compatibility**: Each cell's aerodynamic center sits between two suspension line attachment points. When we eventually model line tension instead of rigid-wing assumption, we're already set up — each cell produces a force vector that two lines must support.

4. **CP emerges from geometry**: The system CP is not a parameter — it's the resultant of 7 individual cell forces at different positions. This is more physical than a single `cp_0 + cp_alpha · α` expression.

### Cell Segment Layout

Using the existing arc geometry: R = 1.55, 12° angular spacing, z_center = -1.10, 6° forward rotation.

| Cell | Name | θ (roll) | Position (NED normalized) | Orientation | Side |
|------|------|----------|--------------------------|-------------|------|
| C | `cell_c` | 0° | `{ x: 0.165, y: 0, z: -1.089 }` | `{ roll_deg: 0 }` | Center |
| R1 | `cell_r1` | +12° | `{ x: 0.161, y: 0.322, z: -1.055 }` | `{ roll_deg: 12 }` | Right |
| L1 | `cell_l1` | -12° | `{ x: 0.161, y: -0.322, z: -1.055 }` | `{ roll_deg: -12 }` | Left |
| R2 | `cell_r2` | +24° | `{ x: 0.151, y: 0.630, z: -0.955 }` | `{ roll_deg: 24 }` | Right |
| L2 | `cell_l2` | -24° | `{ x: 0.151, y: -0.630, z: -0.955 }` | `{ roll_deg: -24 }` | Left |
| R3 | `cell_r3` | +36° | `{ x: 0.134, y: 0.911, z: -0.794 }` | `{ roll_deg: 36 }` | Right |
| L3 | `cell_l3` | -36° | `{ x: 0.134, y: -0.911, z: -0.794 }` | `{ roll_deg: -36 }` | Left |

Each cell gets:
- **S** = total canopy area / 7 ≈ 20.4 / 7 ≈ 2.92 m²
- **chord** = canopy chord ≈ 2.5 m (cell chord, not span)
- **polar** = its own `ContinuousPolar` — same base airfoil profile shared across cells, but each cell evaluates independently at its own local α, β, δ
- **orientation** = arc angle θ from the cell layout (determines local flow transformation)
- **getCoeffs()**: Transforms freestream to local flow, applies riser Δα and brake δ independently, evaluates Kirchhoff model, returns coefficients + CP

### Cell Orientation and Local Flow

Each cell sits at arc angle θ, so its local normal vector is tilted relative to the freestream. The cell's **local angle of attack** and **local sideslip** differ from the freestream values:

$$\alpha_{local} = \alpha \cos(\theta) + \beta \sin(\theta)$$
$$\beta_{local} = -\alpha \sin(\theta) + \beta \cos(\theta)$$

At θ = 0° (center cell): local = freestream. At θ = ±36° (outer cells): the cell sees a mix of the freestream α and β projected onto its tilted surface.

This means:
- At zero sideslip (β = 0), all cells see the same effective α reduced by cos(θ). The outer cells at 36° produce cos(36°) ≈ 0.81× the lift of the center cell — a natural span-wise lift distribution.
- In sideslip (β ≠ 0), the windward cells see a higher effective α and the leeward cells see a lower effective α. This creates a natural restoring roll moment.
- Each cell may also see **downwash** from center cells reducing its effective α. This can be modeled as a small α offset that decreases from center outward.

The `pitch_deg` offset on the orientation can be used for:
- Built-in trim incidence (reflex profile at center vs. camber at tips)
- Downwash corrections from neighboring cells — center cells create downwash that reduces the effective α seen by outer cells

### Cell Control Response — Two Independent Mechanisms

**Only canopy cell segments respond to control inputs.** Lines, pilot body, and bridle/PC are not affected by brakes or risers — their coefficients are constant.

Canopy cells have **two independent control axes**, each affecting the aerodynamics through a fundamentally different mechanism:

#### 1. Brakes → Camber Change (δ)

Brake toggles deflect the **trailing edge** downward, changing the airfoil's **camber**. This is modeled as a symmetric control deflection δ applied through the existing `SymmetricControl` derivatives:

- Increases camber → shifts $\alpha_0$ negative (more lift at same α)
- Increases drag → raises $C_{D_0}$
- Lowers stall angle → reduces $\alpha_{stall,fwd}$
- Adds nose-down pitching moment → negative $C_{m_\delta}$

On a real canopy, the brake cascade runs along the trailing edge from **tips inward**. The outer cells deflect the most (closest to brake attachment), the inner cells deflect less, and the **center cell gets zero brake deflection** — the brake lines simply don't reach it.

Each cell's effective δ = brake_input × brake_sensitivity:

| Cell | Brake Source | Brake Sensitivity | Effective δ |
|------|-------------|-------------------|-------------|
| C | — | **0** | 0 (no brake lines reach center cell) |
| R1 | brakeRight | 0.4 | brakeRight × 0.4 |
| R2 | brakeRight | 0.7 | brakeRight × 0.7 |
| R3 | brakeRight | 1.0 | brakeRight × 1.0 |
| L1 | brakeLeft | 0.4 | brakeLeft × 0.4 |
| L2 | brakeLeft | 0.7 | brakeLeft × 0.7 |
| L3 | brakeLeft | 1.0 | brakeLeft × 1.0 |

With both brakes pulled, all cells except center get δ, with outer cells deflecting the most. With one brake only, one side deflects while the other sees zero δ — creating differential lift across the span.

#### 2. Risers → Angle of Attack Change (Δα)

Risers change the wing's **geometry/incidence** — they physically tilt the wing relative to the airflow by shortening specific line groups. This is **not** a camber change; it is a direct offset to the cell's effective angle of attack.

- **Front riser**: Shortens A-lines → wing tilts forward → **decreases α** → steeper dive, higher speed
- **Rear riser**: Shortens C/D-lines → wing tilts back → **increases α** → flatter flight, lower speed
- **Asymmetric riser**: Creates differential α between left and right sides → differential lift → turn
  - Front riser on one side → steeper, faster turn on that side
  - Rear riser on one side → flatter, slower turn on that side

The riser-induced Δα is applied as a **direct offset** to the cell's local angle of attack before evaluating the polar:

$$\alpha_{effective} = \alpha_{local} + \Delta\alpha_{riser}$$

Where:

$$\Delta\alpha_{riser} = (-frontRiser + rearRiser) \times \alpha_{max,riser} \times riserSensitivity$$

`ALPHA_MAX_RISER` ≈ 8–12° — the maximum incidence change achievable at full riser input.

| Cell | Riser Source | Riser Sensitivity | Notes |
|------|-------------|-------------------|-------|
| C | avg(L, R) | ~1.0 | Center cell responds to averaged riser input |
| R1 | right | ~1.0 | All cells respond approximately equally |
| R2 | right | ~1.0 | Risers change geometry uniformly |
| R3 | right | ~1.0 | (unlike brakes which cascade from tips) |
| L1 | left | ~1.0 | |
| L2 | left | ~1.0 | |
| L3 | left | ~1.0 | |

Riser sensitivity is approximately uniform across cells because risers change the entire line geometry on their side — they tilt the wing panel as a whole, unlike brakes which pull the trailing edge progressively from the tips.

#### Two Independent Control Axes Per Cell

Each cell's `getCoeffs()` applies both mechanisms independently:

1. **Riser → α offset**: Compute $\alpha_{effective} = \alpha_{local} + \Delta\alpha_{riser}$
2. **Brake → δ camber**: Compute $\delta_{effective} = brakeInput \times brakeSensitivity$
3. **Evaluate polar**: Call Kirchhoff model at $(\alpha_{effective}, \beta_{local}, \delta_{effective})$

This means a pilot can simultaneously:
- Pull front risers (decrease α → dive) + apply brakes (increase camber → more lift/drag)
- These are independent inputs that combine in the polar evaluation
- The resulting flight behavior emerges from the interaction of both effects

### Parasitic Body Segments

In addition to the 7 canopy cells:

| Segment | Position (NED norm.) | S [m²] | CL | CD | Controls |
|---------|---------------------|--------|----|----|----------|
| `lines` | `{ x: 0.23, y: 0, z: -0.40 }` | 0.35 | 0 | ~1.0 | None |
| `pilot` | `{ x: 0.38, y: 0, z: 0.48 }` | 0.50 | minor | ~1.0 | Weight shift |
| `bridle` | `{ x: 0.10, y: 0, z: -1.30 }` | 0.08 | 0 | ~0.9 | None |

**Total: 10 segments** for the canopy system (7 cells + 3 parasitic bodies).

### Weight Shift

The pilot has **two riser attachment points** (left and right) — there is no fore-aft weight shift capability. Weight shift is **lateral only**.

When the pilot shifts weight to the left, the left riser set drops and the right riser set rides higher. This changes the **geometry of the system** — the pilot's CG moves laterally relative to the canopy, changing lever arms.

The pilot body segment's **position** shifts in response to `weightShiftLR`:

```
position.y += weightShiftLR × maxLateralShift   // lean left/right
```

This doesn't change coefficients — it changes the lever arm, which changes the moment about CG. This is physically correct: weight shift turns a paraglider by moving the pilot CG relative to the canopy, not by changing aerodynamic forces.

---

## Wingsuit System — 1 to 3 Segments

For the wingsuit, the simplest approach is **1 segment** at the existing CP:

```typescript
{
  name: 'body',
  position: { x: cp_fraction_to_ned_x, y: 0, z: 0 },
  S: 2.0,        // wingsuit reference area
  chord: 1.8,    // body length
  getCoeffs(alpha_deg, beta_deg, controls) {
    // Full Kirchhoff model — entire body is one surface
    return getAllCoefficients(alpha_deg, beta_deg, controls.delta, polar)
  },
}
```

This reproduces the current single-origin behavior exactly.

**Future (3 segments):** Left wing surface, right wing surface, fuselage. Would allow modeling asymmetric body position and differential arm/leg inputs. Not needed now — just showing the system supports it.

---

## Airplane System — 6+ Segments

The airplane naturally decomposes into:

| Segment | Type | Controls |
|---------|------|----------|
| `wing_left` | Lifting surface | `aileronLeft`, `flap` |
| `wing_right` | Lifting surface | `aileronRight`, `flap` |
| `fuselage` | Parasitic body | None |
| `elevator` | Control surface | `elevator` |
| `rudder` | Control surface | `rudder` |
| `vtail` | Vertical stabilizer | None |

Each wing segment has its own span position, so aileron deflection creates differential lift → roll moment. The elevator at a long moment arm behind the CG controls pitch. This is standard aircraft component buildup.

---

## Coordinate System Reference

### NED Body Frame (all positions stored here)
- `x` = forward (flight direction)
- `y` = right (starboard)
- `z` = down (gravity in level flight)

Everything — mass segments, aerodynamic centers, system CG — is `{ x, y, z }` in NED body frame, normalized by reference height (1.875 m). This is the MassSegment convention.

### Three.js View Frame (rendering only)
```
Three.js X = -NED y      (east → screen-right when viewed from above)
Three.js Y = -NED z      (up = -down)
Three.js Z =  NED x      (forward / north)
```

This is a proper rotation (det = +1). Applied only at render time in `frames.ts` and `mass-overlay.ts`. All physics stays in NED.

---

## Force and Moment Summation

### Per-Segment Force Computation

Every segment computes its own force AND its own center of pressure:

```typescript
interface SegmentForceResult {
  lift: number     // [N] lift force magnitude
  drag: number     // [N] drag force magnitude
  side: number     // [N] side force magnitude
  moment: number   // [N·m] segment's own pitching moment (from CM, about its AC)
  cp: number       // chord fraction where total aero force acts
}

function computeSegmentForce(
  seg: AeroSegment,
  alpha_deg: number,
  beta_deg: number,
  controls: SegmentControls,
  rho: number,
  airspeed: number,
): SegmentForceResult {
  const q = 0.5 * rho * airspeed * airspeed
  const { cl, cd, cy, cm, cp } = seg.getCoeffs(alpha_deg, beta_deg, controls)
  return {
    lift:   q * seg.S * cl,
    drag:   q * seg.S * cd,
    side:   q * seg.S * cy,
    moment: q * seg.S * seg.chord * cm,  // pitching moment about segment's AC
    cp,                                  // center of pressure for force application
  }
}
```

### Two Moment Contributions Per Segment

For each segment, there are **two distinct moment contributions** about the system CG:

1. **$M_0$ from CM (pitching moment coefficient)**:
   $$M_0 = q \cdot S \cdot c \cdot C_M$$
   This is the moment about the segment's own aerodynamic center — it captures the distributed pressure's torque on the surface. Acts primarily around the pitch (y) axis.

2. **$\mathbf{r}_{CP} \times \mathbf{F}$ (force at center of pressure)**:
   The total aerodynamic force vector (from $C_L$, $C_D$, $C_Y$) acts at the segment's **center of pressure**, not its AC. The lever arm from the CP to the system CG creates additional moments around all three axes.

Both are computed for each segment individually, then summed at the combined canopy-pilot CG.

### Summation at Combined Canopy-Pilot CG

The **combined canopy-pilot CG** is the summation reference frame for all forces and moments. It is computed from `computeCenterOfMass()` using both canopy and pilot mass segments. This point is **not an aerodynamic segment** — it's the system's center of gravity where:
- Net aerodynamic force is drawn (resultant of all segments)
- Weight vector acts
- Net force (aero + weight) is shown
- Total moment arcs are rendered

Each segment's force acts at its own **center of pressure** (CP), which is offset from the segment's AC position along the chord. The CP position comes from `getCoeffs()` return value.

```typescript
/**
 * Sum forces and moments from all segments about the combined
 * canopy-pilot center of gravity.
 *
 * Two moment contributions per segment:
 * 1. Lever arm: r_CP × F  (force at segment CP, relative to system CG)
 * 2. Intrinsic: M_0 = q·S·c·CM  (pitching moment about segment AC)
 *
 * F_total = Σ F_i
 * M_total = Σ (r_CP,i × F_i) + Σ M_0,i
 */
function sumAllSegments(
  segments: AeroSegment[],
  segmentForces: SegmentForceResult[],
  cgPositionMeters: { x: number; y: number; z: number },
  height: number,          // reference height for denormalization [m]
  windDir: Vec3NED,        // unit vector, where air comes from
  liftDir: Vec3NED,        // unit vector, perpendicular to wind in vertical plane
  sideDir: Vec3NED,        // unit vector, cross(wind, lift)
): SystemForces {
  let totalFx = 0, totalFy = 0, totalFz = 0
  let totalMx = 0, totalMy = 0, totalMz = 0

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const f = segmentForces[i]

    // Force vector in body frame [N]
    const fx = liftDir.x * f.lift - windDir.x * f.drag + sideDir.x * f.side
    const fy = liftDir.y * f.lift - windDir.y * f.drag + sideDir.y * f.side
    const fz = liftDir.z * f.lift - windDir.z * f.drag + sideDir.z * f.side

    totalFx += fx;  totalFy += fy;  totalFz += fz

    // CP position in meters: segment AC + CP offset along chord
    // CP is a chord fraction — offset from quarter-chord (AC assumed at 0.25c)
    const cpOffsetX = (f.cp - 0.25) * seg.chord / height  // normalized offset
    const cpX = (seg.position.x + cpOffsetX) * height
    const cpY = seg.position.y * height
    const cpZ = seg.position.z * height

    // Lever arm: segment CP position (meters) minus system CG (meters)
    const rx = cpX - cgPositionMeters.x
    const ry = cpY - cgPositionMeters.y
    const rz = cpZ - cgPositionMeters.z

    // Moment contribution 1: r_CP × F  (cross product)
    totalMx += ry * fz - rz * fy
    totalMy += rz * fx - rx * fz
    totalMz += rx * fy - ry * fx

    // Moment contribution 2: segment's own pitching moment (CM-based, about AC)
    totalMy += f.moment
  }

  return {
    force:  { x: totalFx, y: totalFy, z: totalFz },
    moment: { x: totalMx, y: totalMy, z: totalMz },
  }
}
```

### Weight

Weight is **not** a segment. It's a single force:
$$\mathbf{W} = m \cdot g \cdot \hat{z}_{down}$$
Applied at the system CG. Added to the total force after segment summation.

### Net Force

$$\mathbf{F}_{net} = \mathbf{F}_{aero,total} + \mathbf{W}$$

Applied at the system CG for visualization.

---

## Relationship to Existing Code

### What Stays the Same
| Component | Status |
|-----------|--------|
| `MassSegment` interface | Unchanged — aero segments complement mass segments |
| `computeCenterOfMass()` | Used directly for system CG (body-frame 3D vector) |
| `computeInertia()` | Unchanged — angular acceleration mode still works |
| `kirchhoff.ts` | Unchanged — canopy cells delegate to it via `getCoeffs()` |
| NED → Three.js mapping | Same `(-y, -z, x) × pilotScale` for rendering (det=+1) |
| Wingsuit/slick polars | If no `aeroSegments`, existing single-origin path unchanged |

### What Changes
| Component | Change |
|-----------|--------|
| `continuous-polar.ts` | Add `AeroSegment`, `SegmentControls`, `aeroSegments?` field |
| `aero-segment.ts` | **NEW** — shared `computeSegmentForce()`, `sumAllSegments()` |
| `polar-data.ts` | Add 10 aero segments to Ibex UL (7 cells + 3 bodies) |
| `vectors.ts` | Multi-segment rendering path with per-segment arrows |
| `main.ts` | Pass `pilotScale` + build `SegmentControls` from UI state |
| `controls.ts` | Read left/right hand sliders + weight shift + context switch |
| `index.html` | 3 new sliders + 3-way context switch (Brakes/Fronts/Rears) |

### CG: Mass Segments vs. Chord Fraction

For segment-based polars, CG comes from `computeCenterOfMass()` — a proper 3D body-frame vector accounting for canopy-pilot vertical separation. The chord-fraction `polar.cg` is only used as fallback for polars without mass segments.

---

## Per-Segment Coefficients

### Why Per-Segment Polars Eliminate the Coefficient Problem

The current lumped polar (`ibexulContinuous`) has:
- $C_L$, $C_D$ = entire system (canopy + lines + pilot + everything)
- $S = 20.439$ m² = whole canopy
- $C_{D_0} = 0.21$ = includes parasitic drag from lines, pilot, bridle

With per-segment polars, there is **no coefficient split problem**. Each segment has physically meaningful coefficients for its own surface:

- **Canopy cells**: Each cell has its own `ContinuousPolar` with canopy-only $C_{D_0}$ ≈ 0.03–0.04, and evaluates the Kirchhoff model independently at its own local α, β, δ.
- **Parasitic bodies**: Simple constant $C_D$ (lines ≈ 1.0, pilot ≈ 1.0, bridle ≈ 0.9) with their own reference areas.

The total drag automatically equals the sum of all component drags:

$$D_{total} = \sum_i q \cdot S_i \cdot C_{D_i}$$

### Factory Function: `makeCanopyCellSegment()`

```typescript
const ALPHA_MAX_RISER = 10  // [deg] max α change from full riser input

function makeCanopyCellSegment(
  name: string,
  position: { x: number; y: number; z: number },
  rollDeg: number,
  side: 'left' | 'right' | 'center',
  brakeSensitivity: number,   // 0 for center, 0.4→1.0 for inner→outer
  riserSensitivity: number,   // ~1.0 for all cells (uniform geometry change)
  basePolar: ContinuousPolar,
): AeroSegment {
  const cellPolar: ContinuousPolar = {
    ...basePolar,
    S: basePolar.S / 7,
    cd_0: 0.035,  // canopy-only profile drag (parasitic bodies handle the rest)
  }

  return {
    name,
    position,
    orientation: { roll_deg: rollDeg },
    S: cellPolar.S,
    chord: basePolar.chord / 1,  // cell chord ≈ canopy chord
    polar: cellPolar,
    getCoeffs(alpha_deg, beta_deg, controls) {
      const theta = rollDeg * Math.PI / 180

      // ── Local flow from cell orientation ──
      const alphaLocal = alpha_deg * Math.cos(theta) + beta_deg * Math.sin(theta)
      const betaLocal = -alpha_deg * Math.sin(theta) + beta_deg * Math.cos(theta)

      // ── Riser → α offset (geometry/incidence change) ──
      let frontRiser: number, rearRiser: number
      if (side === 'center') {
        frontRiser = (controls.frontRiserLeft + controls.frontRiserRight) / 2
        rearRiser = (controls.rearRiserLeft + controls.rearRiserRight) / 2
      } else if (side === 'right') {
        frontRiser = controls.frontRiserRight
        rearRiser = controls.rearRiserRight
      } else {
        frontRiser = controls.frontRiserLeft
        rearRiser = controls.rearRiserLeft
      }
      // Front riser decreases α (steeper dive), rear riser increases α (flatter)
      const deltaAlphaRiser = (-frontRiser + rearRiser) * ALPHA_MAX_RISER * riserSensitivity
      const alphaEffective = alphaLocal + deltaAlphaRiser

      // ── Brake → δ camber change (trailing edge deflection) ──
      let brakeInput: number
      if (side === 'center') {
        brakeInput = 0  // center cell: no brake lines reach it
      } else if (side === 'right') {
        brakeInput = controls.brakeRight
      } else {
        brakeInput = controls.brakeLeft
      }
      const deltaEffective = brakeInput * brakeSensitivity

      // ── Evaluate Kirchhoff model at (α_effective, β_local, δ_effective) ──
      return getAllCoefficients(alphaEffective, betaLocal, deltaEffective, cellPolar)
    },
  }
}
```

### System-Level Validation

The per-cell + parasitic body forces must sum to approximately match the lumped polar at trim:

| Component | S [m²] | CD_0 | Drag Area [m²] |
|-----------|--------|------|---------|
| 7 × cell (canopy) | 7 × 2.92 | ~0.035 | 7 × 0.102 ≈ 0.714 |
| Lines | 0.35 | 1.0 | 0.35 |
| Pilot | 0.50 | 1.0 | 0.50 |
| Bridle | 0.08 | 0.9 | 0.07 |
| **Total** | — | — | **~1.63** |

The gap vs. the lumped polar's $q \cdot S \cdot C_D = q \cdot 20.4 \cdot 0.21 = q \cdot 4.28$ is expected — interference drag, line-canopy interaction, and induced drag ($K \cdot C_L^2$) account for the difference. These get absorbed into cell $C_{D_0}$ during tuning.

---

## Implementation Order

### Phase 1: Core Infrastructure
1. Define `AeroSegment` and `SegmentControls` interfaces in `continuous-polar.ts`
2. Create `aero-segment.ts` — `computeSegmentForce()`, `sumAllSegments()`, `defaultControls()`
3. Unit test: 1 segment should reproduce `coeffToForces()` results exactly

### Phase 2: Canopy Segments
4. Define 10 canopy aero segments in `polar-data.ts` (7 cells + lines + pilot + bridle)
5. Cell `getCoeffs()` delegates to Kirchhoff via existing coefficient functions
6. Parasitic segments return constant CD
7. Validate: sum of segment forces ≈ lumped polar forces at trim

### Phase 3: Visualization
8. Add per-segment force arrows to `vectors.ts` (distinct colors per segment)
9. Multi-segment code path in `updateForceVectors()` — draw arrows at each segment position
10. Use `computeCenterOfMass()` for system CG; draw weight + net at CG
11. Wire `pilotScale` from `main.ts`

### Phase 4: Asymmetric Controls
12. Add 3 control sliders (left hand, right hand, weight shift) + 3-way context switch (Brakes/Fronts/Rears) to `index.html`
13. Build `SegmentControls` from UI state in `main.ts` — context switch determines which fields the hand sliders map to
14. Each cell's `getCoeffs()` reads its side's controls and morphs accordingly
15. Verify: pulling left brake → left cells increase CL → roll moment visible

### Phase 5: Moments from Lever Arms
16. `sumAllSegments()` computes total moment from $\sum r_i \times F_i$
17. Replace or supplement existing `cm` coefficient for moment arcs
18. Moment arcs at CG show the summed result

### Phase 6: Polish & Extend
19. Tune per-cell `S` and `CD` to match lumped polar
20. Weight shift controls for pilot body
21. Wingsuit as 1-segment `AeroSegment` (reproduces current behavior)
22. Airplane as 6-segment system (future)
23. Optional: UI toggle for per-segment arrow visibility

---

## Visual Design

### Two Arrow Styles

The visualization uses **two distinct arrow styles** to distinguish per-segment detail from system-level results:

1. **ArrowHelper (thin lines)** — lightweight Three.js line arrows for per-segment forces. These are auto-generated from the `AeroSegment` interface, so every segment that produces force gets arrows drawn the same way. Used for:
   - 7 canopy cell segments (lift + drag + side force each)
   - Lines, pilot, bridle parasitic body segments

2. **ShadedArrow (heavyweight)** — the existing custom shaded mesh arrows for system-level vectors. Used for:
   - **Net aerodynamic force** (sum of all segments) — at CG
   - **Weight** — at CG
   - **Net force** (aero + weight) — at CG
   - **Relative wind** — blue reference arrow

The ArrowHelper creation is **generic** — driven entirely by the `AeroSegment` interface. Any segment that returns `cl`, `cd`, `cy` from `getCoeffs()` automatically gets lift, drag, and side force arrows drawn at its position. No per-segment rendering code needed.

### Arrow Colors by Segment Type

| Segment | Style | Lift | Drag | Side | Description |
|---------|-------|------|------|------|-------------|
| Cell C | ArrowHelper | Green | Red | Blue | Center cell |
| Cell R1/L1 | ArrowHelper | Lt Green | Lt Red | Lt Blue | Inner cells |
| Cell R2/L2 | ArrowHelper | Lt Green | Lt Red | Lt Blue | Mid cells |
| Cell R3/L3 | ArrowHelper | Lt Green | Lt Red | Lt Blue | Outer cells |
| Lines | ArrowHelper | — | Orange | — | Drag only |
| Pilot | ArrowHelper | Dim Green | Yellow-Orange | — | Mostly drag |
| Bridle | ArrowHelper | — | Pink | — | Small drag |
| Net Aero | ShadedArrow | — | Magenta | — | At CG |
| Weight | ShadedArrow | — | Gray | — | At CG |
| Net Force | ShadedArrow | — | White | — | At CG |
| Wind | ShadedArrow | — | — | — | Blue reference |

With 7 cells drawing 3 arrows each = 21 ArrowHelper arrows. These are thin lines so visual clutter is manageable — they show the distribution of forces across the span while the bold ShadedArrows show the system-level result.

---

## Net Force → Pseudo-Coefficients & Sustained Speeds

### Closing the Loop

The segment system produces a **net force vector** $\mathbf{F}_{net} = \mathbf{F}_{aero} + \mathbf{W}$ at the system CG. Segment forces are computed in **body frame**, then the caller rotates them to **inertial NED** (North, East, Down) using the attitude DCM before passing them to the projection function below. Velocity must also be in inertial NED. This matches the WSE exactly — it works with GPS velocity and IMU acceleration, both in inertial NED.

The key step: subtract gravity from the Down-component of the total acceleration before projecting. In inertial NED, gravity is exactly $(0, 0, +g)$, so only the D-component needs correction — N and E are already aerodynamic-only. This would **not** be correct in body frame, where gravity has components in all three axes depending on pitch and roll.

### Velocity Projection (exact match to WSE.java `calculateWingsuitParameters`)

Given the total acceleration $\mathbf{a} = \mathbf{F}_{net} / m$ in NED coordinates, and velocity $\mathbf{v}$ also in NED:

**1. Subtract gravity from down-component** — isolate aerodynamic acceleration:

In NED, gravity acts in +z (down). The WSE subtracts it from the down-component only:

$$a_{D,aero} = a_D - g$$

The N and E components have no gravity contribution, so $a_N$ and $a_E$ are already aerodynamic-only.

**2. Drag acceleration** — projection of aerodynamic acceleration onto velocity:

$$a_{proj} = \frac{a_N \cdot v_N + a_E \cdot v_E + a_{D,aero} \cdot v_D}{|\mathbf{v}|}$$

$$\mathbf{a}_{drag} = a_{proj} \cdot \frac{\mathbf{v}}{|\mathbf{v}|}$$

Correct the sign (drag opposes velocity):

$$a_D^{scalar} = -\text{sign}(\mathbf{a}_{drag} \cdot \mathbf{v}) \cdot |\mathbf{a}_{drag}|$$

**3. Lift acceleration** — rejection (perpendicular to velocity):

$$\mathbf{a}_{lift} = (a_N - drag_N, \; a_E - drag_E, \; a_{D,aero} - drag_D)$$

$$a_L = |\mathbf{a}_{lift}|$$

**4. Pseudo-coefficients** — normalize by $g \cdot v^2$:

$$k_L = \frac{a_L}{g \cdot v^2}, \qquad k_D = \frac{a_D^{scalar}}{g \cdot v^2}$$

**5. Roll angle** — uses the **raw** $a_D$ (with gravity, NOT $a_{D,aero}$):

$$\cos(\phi) = \frac{1 - a_D / g - k_D \cdot v \cdot v_D}{k_L \cdot v_{ground} \cdot v}$$

$$\text{sign}(\phi) = \text{sign}(a_{lift,N} \cdot (-v_E) + a_{lift,E} \cdot v_N)$$

### Pseudo Sustained Speeds

At equilibrium, the sustained horizontal and vertical speeds are:

$$\text{denom} = (k_L^2 + k_D^2)^{0.75}$$

$$v_{xs} = \frac{k_L}{\text{denom}}, \qquad v_{ys} = \frac{k_D}{\text{denom}}$$

This is the same formula used in BASEline/CloudBASE. At trim, these match the `coeffToSS()` output from the lumped polar. Away from trim (transient states, asymmetric inputs), they show the **instantaneous** glide performance.

### Implementation

Follows WSE.java `calculateWingsuitParameters()` line-by-line, adapted from ENU to NED.

```typescript
interface PseudoCoefficients {
  kl: number       // pseudo lift coefficient (WSE convention)
  kd: number       // pseudo drag coefficient (WSE convention)
  roll: number     // roll angle [rad]
  vxs: number      // sustained horizontal speed [m/s]
  vys: number      // sustained vertical speed [m/s]
  glideRatio: number // kl / kd
}

/**
 * Decompose the net force (aero + weight) into pseudo kl, kd, roll
 * and sustained speeds — exact match to WSE.java calculateWingsuitParameters().
 *
 * IMPORTANT: Both inputs must be in INERTIAL NED (x=North, y=East, z=Down).
 * The caller must rotate body-frame forces and velocity to inertial using
 * DCM(φ,θ,ψ) before calling. This is required because gravity subtraction
 * assumes gravity = (0, 0, +g), which is only true in inertial frame.
 *
 * WSE.java uses ENU input → converts to NED internally. We start in NED.
 */
function netForceToPseudo(
  netForce: { x: number; y: number; z: number },  // inertial NED [N], includes weight
  velocity: { x: number; y: number; z: number },  // inertial NED [m/s]
  mass: number,
): PseudoCoefficients {
  const g = 9.80665

  // NED velocity components (matching WSE vN, vE, vD)
  const vN = velocity.x
  const vE = velocity.y
  const vD = velocity.z

  const vel = Math.sqrt(vN * vN + vE * vE + vD * vD)
  if (vel < 1.0) return { kl: 0, kd: 0, roll: 0, vxs: 0, vys: 0, glideRatio: 0 }

  // Total acceleration (NED) — includes gravity
  const accelN = netForce.x / mass
  const accelE = netForce.y / mass
  const accelD = netForce.z / mass

  // ── Subtract gravity from down-component (WSE: accelDminusG = accelD - gravity) ──
  // In NED, weight adds +g to accelD. Subtracting isolates aerodynamic acceleration.
  const accelDminusG = accelD - g

  // ── Drag: projection of AERODYNAMIC acceleration onto velocity ──
  // WSE: proj = (accelN * vN + accelE * vE + accelDminusG * vD) / vel
  const proj = (accelN * vN + accelE * vE + accelDminusG * vD) / vel

  const dragN = proj * vN / vel
  const dragE = proj * vE / vel
  const dragD = proj * vD / vel

  // WSE: dragSign = -signum(dragN * vN + dragE * vE + dragD * vD)
  const dragSign = -Math.sign(dragN * vN + dragE * vE + dragD * vD)
  const accelDrag = dragSign * Math.sqrt(dragN * dragN + dragE * dragE + dragD * dragD)

  // ── Lift: rejection of AERODYNAMIC acceleration from velocity ──
  // WSE: liftN = accelN - dragN, liftD = accelDminusG - dragD
  const liftN = accelN - dragN
  const liftE = accelE - dragE
  const liftD = accelDminusG - dragD
  const accelLift = Math.sqrt(liftN * liftN + liftE * liftE + liftD * liftD)

  // ── Pseudo-coefficients: kl, kd = accel / g / v² ──
  const kl = accelLift / g / vel / vel
  const kd = accelDrag / g / vel / vel

  // ── Roll angle — uses raw accelD (WITH gravity, not accelDminusG) ──
  // WSE: rollArg = (1 - accelD / gravity - kd * vel * vD) / (kl * smoothGroundspeed * vel)
  let roll = 0
  const groundSpeed = Math.sqrt(vN * vN + vE * vE)

  if (groundSpeed > 1.0) {
    const rollArg = (1 - accelD / g - kd * vel * vD) / (kl * groundSpeed * vel)
    if (Math.abs(rollArg) <= 1.0) {
      const rollMagnitude = Math.acos(rollArg)
      // WSE: rollSign = signum(liftN * -vE + liftE * vN)
      const rollSign = Math.sign(liftN * (-vE) + liftE * vN)
      roll = rollSign * rollMagnitude
    }
  }

  // ── Sustained speeds ──
  const denom = Math.pow(kl * kl + kd * kd, 0.75)
  const vxs = denom > 1e-10 ? kl / denom : 0
  const vys = denom > 1e-10 ? kd / denom : 0
  const glideRatio = Math.abs(kd) > 1e-10 ? kl / kd : 0

  return { kl, kd, roll, vxs, vys, glideRatio }
}
```

### What This Gives Us

The segment system produces physically correct per-cell forces → sums them → adds weight → projects onto velocity → recovers the same `{kl, kd, vxs, vys}` that BASEline measures from GPS/IMU data. This closes the loop:

| Direction | Path |
|-----------|------|
| **Forward** (prediction) | α, β, controls → per-cell `getCoeffs()` → segment forces → sum + weight → $\mathbf{F}_{net}$ → pseudo `{kl, kd}` → `{vxs, vys}` |
| **Inverse** (measurement) | GPS velocity + IMU acceleration → WSE `calculateWingsuitParameters()` → `{kl, kd}` → `{vxs, vys}` |

At trim, both paths produce the same numbers. The segment system adds the ability to predict how controls (brakes, risers, weight shift) change the sustained speeds — something the inverse WSE path can only measure after the fact.

---

## Open Questions

1. **Downwash modeling**: Center cells produce downwash that reduces the effective α seen by neighboring cells. Use **lifting-line theory** — compute induced downwash at each cell's spanwise station from the bound vortex circulation of all other cells. This gives a physically grounded α reduction that varies with loading (CL) and isn't just a fixed offset. Implementation: after computing each cell's CL at its local α, iterate to find the induced α_i at each station, then re-evaluate. One or two iterations should converge.

2. **Cross-flow between cells**: Spanwise flow from sideslip affects cells differently. Center cells see little cross-flow; outer cells see more. The local flow transformation handles the first-order effect via $\alpha_{local} = \alpha \cos(\theta) + \beta \sin(\theta)$, but secondary effects (interference, vortex shedding) may need additional correction.

3. **Line set position in sideslip**: The line set's effective drag center shifts laterally in sideslip. For now, keep it fixed at the symmetric center.

4. **Serialization for CloudBASE**: `getCoeffs()` is a closure — can't be JSON-serialized. For CloudBASE transfer, we'd need a coefficient model descriptor (enum + parameters) instead of a function. Not a concern for the visualizer.

5. **Control sliders — 3 sliders + context switch**: The pilot has two hands and can weight shift. The UI mirrors this:
   - **Left hand** slider: 0–1 (how much the left hand is pulling)
   - **Right hand** slider: 0–1 (how much the right hand is pulling)
   - **Weight shift** slider: -1 (left) to +1 (right)
   - **3-way context switch**: `Brakes` | `Fronts` | `Rears` — determines what the hand sliders control

   In `Brakes` mode, left/right hand → `brakeLeft`/`brakeRight`. In `Fronts` mode → `frontRiserLeft`/`frontRiserRight`. In `Rears` mode → `rearRiserLeft`/`rearRiserRight`. The context switch sets which `SegmentControls` fields the hand sliders map to; all other canopy inputs stay at 0.

   This keeps the UI to just **3 sliders + 1 toggle** — matching the pilot's actual control authority.

6. **Moment arc rendering**: Show the **net summed moment** only — three arc arrows (Mx, My, Mz) at the system CG, same as the current rendering. Each moment has two contributions per segment (CM-based intrinsic + r×F lever arm), but only the total sum is displayed. Per-segment moment arcs would be too cluttered and hard to interpret.

7. **Back-compatibility**: Polars without `aeroSegments` must work exactly as before. The single-origin code path in `vectors.ts` remains the fallback.

8. **Brake sensitivity tuning**: The sensitivity factors (0→1.0, center=0, inner→outer) are initial estimates. Real values depend on brake cascade geometry and line routing. Should be configurable per canopy model.
