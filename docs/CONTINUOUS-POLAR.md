# Continuous Aerodynamic Polar Model — Mathematical Specification

## Project Overview

**Goal**: Define continuous mathematical equations that take angle of attack (α), sideslip angle (β), and a camber/control parameter (δ) as inputs and output CL, CD, CM, CP, and CY as continuous functions — covering the **full sphere** of possible flight orientations.

**Implementation context**: This math will first be implemented in a **standalone web-based visualizer** (see [`POLAR-VISUALIZER.md`](POLAR-VISUALIZER.md)) for evaluation and testing. Once validated, it will be integrated back into CloudBASE for simulation, Kalman filtering, real-time data analysis, and VR.

**Motivation**: The existing system uses discrete lookup tables with linear interpolation and piecewise quadratic curves. It has no native sideslip (β) handling, discrete control dimension switching (arch/dearch polars are separate objects, not a continuous parameter), and requires manual table construction for each aircraft type. A continuous model enables:
- Smooth derivatives for stability analysis
- Sideslip modeling for turn aerodynamics and asymmetric flight
- Continuous control dimension (not discrete switching between sub-polars)
- Self-consistent stall behavior without piecewise patching
- Easier fitting from GPS/sensor data
- Unified treatment of all flight modes: wingsuits, parachutes, paragliders, speed wings, tracking suits, slick skydiving, and airplanes

---

## Aircraft Types to Support

**All types require full-sphere coverage**: α ∈ [-180°, +180°], β ∈ [-90°, +90°]

| Type | Control (δ) | Normal α | Full Range Needed? | Notes |
|------|-------------|----------|-------------------|-------|
| **Wingsuit** | Arch/de-arch | +5° to +30° | **Yes** — deployment can force α to +150°, back-flying at -3° to -45° | Flexible wing, body-drag dominant |
| **Tracking Suit** | Body position | -10° to +20° | **Yes** — backsliding, deployment transients | High speed, low CL |
| **Slick (belly)** | Body position | 0° to +90° | **Yes** — back-flying, sidesliding, all orientations possible | Subsonic bluff body |
| **Parachute (RAM-air)** | Brake toggles / front risers | +3° to +25° | **Yes** — negative lift → collapse, front-riser dives can exceed normal range | Inflated canopy, collapse at CL < 0 |
| **Paraglider** | Brake toggles / speedbar | +5° to +30° | **Yes** — SIV maneuvers, collapses, full stalls | Higher aspect ratio, slower |
| **Speed Wing** | Brake toggles | +3° to +20° | **Yes** — aggressive piloting, proximity flight transients | Small canopy, fast descent |
| **Airplane** | Elevator / flaps | -5° to +20° | **Yes** — aerobatics: spins, hammerheads, Pugachev's cobra | Rigid wing, standard aero |

### Flight Regimes (Full α Range)

The model must produce physically reasonable coefficients across all these regimes, even though most flight time is spent in the "normal" region:

```
 α (degrees)
 ─180° ──── -90° ──── -45° ──── -3° ──── 0° ──── +15° ──── +30° ──── +90° ──── +150° ──── +180°
  │          │          │          │       │        │          │          │          │          │
  │ REVERSED │  REVERSE │  BACK    │ NORM  │ NORMAL │  STALL   │  DEEP    │ BROADSIDE│ REVERSED │
  │ FLAT     │  DEEP    │  FLYING  │ SPEED │ FLIGHT │  REGION  │  STALL   │ TO FLOW  │ FLIGHT   │
  │ FLIGHT   │  STALL   │          │       │        │          │          │          │ (deploy- │
  │          │          │          │       │        │          │          │          │  ment)   │
  └──────────┴──────────┴──────────┴───────┴────────┴──────────┴──────────┴──────────┴──────────┘
```

| Regime | α Range | Physical Situation | CL Behavior | CD Behavior |
|--------|---------|-------------------|-------------|-------------|
| **Normal flight** | ~-3° to +15° | Attached flow, efficient flight | Linear: CL ≈ CL_α·α | Parabolic: CD_0 + K·CL² |
| **Stall / post-stall** | ~+15° to +45° | Progressive separation | CL drops, follows Kirchhoff | CD rises sharply |
| **Deep stall** | ~+45° to +90° | Fully separated, flat-plate | CL ≈ CD_n·sin(α)·cos(α) | CD ≈ CD_n·sin²(α) |
| **Broadside** | ~+90° | Body perpendicular to flow | CL ≈ 0 | CD = maximum |
| **Reversed** | ~+90° to +180° | Flow hitting "back" of body | CL reverses sign | CD follows sin² |
| **Deployment zone** | ~+120° to +150° | Wingsuit mechanical deployment | Transient, high drag | Very high CD |
| **Back flying** | ~-3° to -45° | Inverted effective flight | CL reverses (inverted lift) | Moderate CD |
| **Reverse deep stall** | ~-45° to -90° | Fully separated, inverted | Flat-plate, reversed | Flat-plate |
| **Reverse broadside** | ~-90° | Body perpendicular, inverted | CL ≈ 0 | CD = maximum |
| **Reversed flight** | ~-90° to -180° | Traveling backward through air | Mirror of +90° to +180° | Mirror |

**β regimes**:
| β Range | Physical Situation |
|---------|-------------------|
| 0° | Symmetric flow — standard flight |
| ±5° to ±15° | Normal sideslip in turns, crosswind |
| ±15° to ±45° | Aggressive sideslip — sidesliding, uncoordinated flight |
| ±45° to ±90° | Extreme lateral — knife-edge flight, lateral backslide |

---

## Current System Architecture

### Key Files
- **`app/assets/javascripts/types.ts`** (L320–403): `WSEQPolar` interface, `Coefficients`, `SustainedSpeeds`
- **`app/assets/javascripts/util/polar-library.ts`** (3,616 lines): All named polar data (27+ aircraft) + interpolation functions
- **`app/assets/javascripts/util/wse.ts`** (2,349 lines): Physics engine — `generatew3d()`, `getcoefficients()`, `getspeed()`, `fitpolar*()`
- **`app/assets/javascripts/maps/integrator.ts`** (296 lines): Simulator loop — `csmakedata()` calls `generatew3d()`
- **`app/assets/javascripts/maps/aero.ts`** (468 lines): Alpha/beta calculation, wind-to-body DCM (experimental, not in main sim path)
- **`app/assets/javascripts/maps/aerorotation.ts`** (304 lines): 6DOF rotation class with alpha/beta (experimental, not in main sim path)

### Current Polar Representation — `WSEQPolar`
```typescript
interface WSEQPolar {
  polarslope: number        // CD = polarslope * (CL - polarclo)² + polarmindrag
  polarclo: number          // CL at minimum drag
  polarmindrag: number      // Minimum CD
  rangemincl: number        // Min CL (max speed end)
  rangemaxcl: number        // Max CL (stall end)
  s: number                 // Reference area [m²]
  m: number                 // Mass [kg]
  table?: Coefficients[]    // Optional: discrete {cl,cd} lookup (overrides equation)
  stallpoint?: Coefficients[] // Separate stall-region table (negative index)
  aoas?: number[]           // AOA values (degrees, descending order)
  aoaindexes?: number[]     // Nonlinear polar-index-to-AOA mapping
  cp?: number[]             // Center of pressure array
  cm?: number[]             // Pitching moment array
  cg?: number               // Center of gravity
  archpolar?: WSEQPolar     // Discrete alternate polar (wingsuit arch / canopy brakes)
  dearchpolar?: WSEQPolar   // Discrete alternate polar (de-arch)
  deploypolar?: WSEQPolar   // Pilot chute deployed
  // ... stall/speed separation points for piecewise regions
}
```

### How the Physics Engine Works

1. **Polar Index**: A scalar `speed ∈ [0, 1]` maps the flight envelope. 0 = max CL (stall), 1 = max speed (min CL). Negative values = deep stall.

2. **`getcoefficients(speed, polar)`**: Converts polar index → `{cl, cd}`:
   - If `polar.table` exists: linear interpolation between table entries
   - Otherwise: `cl = rangemaxcl - speed * (rangemaxcl - rangemincl)`, `cd = slope*(cl-clo)² + mindrag`
   - Piecewise override for speed-separation region (separate quadratic)
   - Stall region is separate stallpoint table or stallmaxdrag-based quadratic

3. **`coefftoss(cl, cd, s, m, rho)`**: Converts CL/CD → sustained equilibrium speeds:
   ```
   k = 0.5 * rho * s / m
   kl = cl * k / g,  kd = cd * k / g
   denom = (kl² + kd²)^0.75
   vxs = kl / denom,  vys = kd / denom
   ```

4. **`generatew3d(dt, state, wind, inverted)`**: The core integrator:
   - Computes airspeed = ground_velocity - wind
   - Derives `kl`, `kd` from sustained speeds (inverse of coefftoss)
   - Computes 3D acceleration with roll:
     ```
     ax = vas * (kl * avy * cos(roll) - kd * avx)
     ay = 1 - vas * (kl * avx * cos(roll) + kd * avy)
     az = -kl * vas² * sin(roll)
     ```
   - Euler integrates velocity and position over `dt`

5. **Control dimension**: Discrete switching between `polar`, `archpolar`, `dearchpolar`, `deploypolar` — no interpolation between them.

6. **No β handling**: `generatew3d()` uses a 2D equilibrium model. The experimental `aero.ts` / `aerorotation.ts` compute α/β from 3D airspeed but are not wired into the main sim.

### Current Polar Fitting (from GPS data)
- `fitpolar(points)`: Symmetric quadratic `cd = a*cl² + c` (assumes clo=0)
- `fitpolarc(coefficients[], s, m)`: Same symmetric fit from CL/CD pairs
- `fitpolarc2(coefficients[], s, m)`: Cambered fit `cd = a*cl² + b*cl + c`, extracts vertex
- `fitpolarc6(coefficients[], s, m, rho, length)`: 6th-order polynomial in speed-space

### Existing Named Polars (27+)
Wingsuit: glider, a4, sa4, corvid, corvidtwo, aurafive, aurathree, mutation, sausage, miragersskis
Canopy: basecanopy, basecanopydeploy, ibexul, ibexdeploy, jumpcr+, cr+, cr+aoa, cr40, cr34, cr28, cr24, cr20, cracepolar28, baselinecrace
Other: slick, slicksin
Data arrays: baselinecrace*, genericwingsuit*, icarus10*, slipstream*, slick*, onepiece*, twopiece*, corvidtwo*

---

## Mathematical Foundation for Continuous Model

### Full-Sphere Coverage Requirement

**The model must be defined and continuous for all α ∈ [-π, +π] and β ∈ [-π/2, +π/2].**

This is critical because:
- Wingsuit deployment can mechanically force α to +150° momentarily
- Back-flying (wingsuits, tracking, slick) operates at α ≈ -3° to -45°
- Slick belly jumping with backsliding or sidesliding can reach any orientation
- Canopy collapses produce brief negative-lift / extreme-α events
- Aerobatic flight can visit any point on the sphere
- Even in "normal" flight, a simulation must not crash if α/β drift outside the expected range

The key insight is that **outside the normal flight envelope, all bodies asymptotically approach flat-plate aerodynamics**. The Kirchhoff model naturally handles this: as the separation function f → 0 (fully separated), the remaining forces are those of a flat plate at angle α to the flow.

### Core Equation Forms

The continuous polar model expresses:
```
CL(α, β, δ) → scalar      α ∈ [-π, +π],  β ∈ [-π/2, +π/2],  δ ∈ [0, 1]
CD(α, β, δ) → scalar
CM(α, β, δ) → scalar
CP(α, β, δ) → scalar
CY(α, β, δ) → scalar      [side force — new]
```

Where:
- **α** = angle of attack [rad], full range [-π, +π]
- **β** = sideslip angle [rad], full range [-π/2, +π/2]
- **δ** = control parameter ∈ [0, 1] (arch/deach for wingsuits, brakes/fronts for canopies, elevator for airplanes)

### Approach 1: Full-Range Kirchhoff + Flat-Plate Blending ⭐ RECOMMENDED

The core idea: **blend between attached-flow aerodynamics and flat-plate aerodynamics using the Kirchhoff separation function**. Near α = 0, the flow is attached and we get classical thin-airfoil behavior. As α increases past stall, the separation function f → 0, and the model converges to flat-plate theory — which is correct for any α from 0° to 180°.

#### Separation Function (Dual-Stall, Full Range)

`f(α) ∈ [0, 1]`: f = 1 means attached, f = 0 means fully separated.

The body has TWO stall boundaries — **forward stall** (positive α) and **back-flight stall** (negative α):

```
f_fwd(α) = (1 + exp((α - α_stall_fwd) / S1_fwd))⁻¹     [forward stall sigmoid]
f_back(α) = (1 + exp((α_stall_back - α) / S1_back))⁻¹    [back-stall sigmoid]
f(α) = f_fwd(α) · f_back(α)                               [product = attached only between both stalls]
```

For a wingsuit: `α_stall_fwd ≈ +20°`, `α_stall_back ≈ -5°`. Flow is attached when α is between -5° and +20°.
For slick belly: `α_stall_fwd ≈ +15°`, `α_stall_back ≈ -15°` (roughly symmetric bluff body).

This dual-sigmoid naturally produces:
- f ≈ 1 in normal flight range
- f → 0 smoothly for α beyond either stall
- f ≈ 0 for all extreme angles (deep stall, broadside, back-flight post-stall)

#### Attached-Flow Model (f ≈ 1 region)

Classical thin-airfoil:
```
CL_attached(α) = CL_α · sin(α - α_0)
CD_attached(α) = CD_0 + K · CL_attached(α)²
```

#### Flat-Plate Model (f ≈ 0 region)

Valid for ANY α — the forces on a flat plate at angle α to the flow:
```
CL_plate(α) = CD_n · sin(α) · cos(α)       = (CD_n / 2) · sin(2α)
CD_plate(α) = CD_n · sin²(α) + CD_0 · cos²(α)
```

Where `CD_n ≈ 1.2 to 2.0` is the normal-force drag coefficient (flat plate broadside to flow). For a wingsuit body, CD_n ≈ 1.2; for a flat plate, CD_n = 2.0.

Key properties of the flat-plate model:
- At α = 0°: CL = 0, CD = CD_0 ✓
- At α = 45°: CL = CD_n/2, CD = CD_n/2 + CD_0/2 ✓
- At α = 90°: CL = 0, CD = CD_n (broadside, maximum drag) ✓
- At α = 180°: CL = 0, CD = CD_0 (reversed, same as 0°) ✓
- Smooth and continuous everywhere ✓

#### Blended Full-Range Model

```
CL(α) = f(α) · CL_attached(α) + (1 - f(α)) · CL_plate(α)
CD(α) = f(α) · CD_attached(α) + (1 - f(α)) · CD_plate(α)
```

This gives us:
- **Normal flight** (f ≈ 1): Standard `CL_α · sin(α)` and parabolic drag
- **Through stall** (f transitioning): Smooth blend, lift drops, drag rises
- **Deep stall / broadside / back** (f ≈ 0): Pure flat-plate behavior
- **Continuous and smooth everywhere** — no piecewise patching
- **Physically correct at every angle** — flat-plate is the correct asymptotic model

#### Back-Flying Region (α ≈ -3° to -45°)

When α goes negative past the back-stall:
- f → 0, so the model transitions to flat plate
- `CL_plate(α) = CD_n · sin(α) · cos(α)` — naturally negative for negative α → **inverted lift** ✓
- The body is now generating downward aerodynamic force + drag
- This correctly models back-flying in wingsuits/tracking/slick

#### Deployment Zone (α ≈ +120° to +150°)

When a wingsuit pilot deploys, mechanical forces push α far beyond stall:
- f ≈ 0, pure flat-plate applies
- At α = 150°: CL_plate = CD_n · sin(150°) · cos(150°) = -CD_n·√3/4 (negative lift — body being pushed down) ✓
- CD_plate = CD_n · sin²(150°) + CD_0·cos²(150°) = CD_n/4 + 3·CD_0/4 (high drag) ✓
- This naturally decelerates the flyer during deployment

#### Canopy Collapse (CL going negative)

When a parachute's effective α exceeds stall or goes negative, CL drops to zero and can go negative:
- The model handles this naturally — CL_plate goes negative for α < 0 or α > 90°
- A canopy in collapse is essentially a flat-plate bluff body
- Recovery as α returns to normal range is smooth

#### Parameters (~12 for full range)

| Parameter | Symbol | Description |
|-----------|--------|-------------|
| Lift curve slope | CL_α | Attached-flow lift effectiveness [1/rad] |
| Zero-lift AOA | α_0 | Where CL = 0 in attached flow [rad] |
| Parasitic drag | CD_0 | Minimum drag coefficient |
| Induced drag factor | K | CL²-dependent drag |
| Normal-force drag | CD_n | Flat-plate broadside drag coefficient |
| Forward stall α | α_stall_fwd | Forward stall angle [rad] |
| Forward stall sharpness | S1_fwd | Sigmoid rate for forward stall [rad] |
| Post-fwd-stall sharpness | S2_fwd | (optional: asymmetric post-stall) [rad] |
| Back stall α | α_stall_back | Back-stall angle [rad] |
| Back stall sharpness | S1_back | Sigmoid rate for back stall [rad] |
| Camber/offset | — | Encoded in α_0 and CL_α asymmetry |
| Reference area | S | [m²] |
| Mass | m | [kg] |

### Approach 2: β Dependency (Full-Range Cross-Flow)

Standard flight-dynamics approximation (Stengel, "Flight Dynamics"), extended for the full β range [-90°, +90°]:

```
CL(α, β) = CL(α) · cos²(β)                               [lift drops with sideslip²]
CD(α, β) = CD(α) · cos²(β) + CD_n_lateral · sin²(β)       [blended: longitudinal drag + lateral cross-flow]
CY(α, β) = CY_β · sin(β) · cos(β)                         [side force]
```

At the extremes:
- **β = 0°**: Pure longitudinal flow → CL(α), CD(α), CY = 0 ✓
- **β = ±90°**: Knife-edge / pure lateral flow → CL = 0, CD = CD_n_lateral (broadside lateral drag), CY = 0 ✓
- **β = ±45°**: Mixed → CL reduced by half, drag is average of longitudinal and lateral

The lateral normal-force coefficient `CD_n_lateral` is the drag of the body broadside in the lateral direction. For a wingsuit this is different from `CD_n` in the longitudinal plane (body is not symmetric front-to-back vs left-to-right). For slick belly, lateral and longitudinal broadside drag may be similar.

This model correctly handles:
- Normal sideslip in turns (small β)
- Aggressive sideslipping / crabbing (moderate β)
- Knife-edge flight and pure lateral backslide (β → ±90°)
- Full β range is smooth and continuous

**Side force `CY`** is critical for modeling:
- Coordinated vs uncoordinated turns
- Lateral drift in crosswind
- Sideslip-induced yaw moments

### Approach 3: Control Morphing (Continuous δ)

Instead of switching between discrete sub-polars, interpolate parameters:
```
For each parameter P ∈ {CL_α, α_0, CD_0, K, CD_fs, α_stall, S1, S2}:
  P(δ) = P_base + δ · (P_control - P_base)
```

Or with nonlinear blending through a polynomial or spline in δ:
```
P(δ) = P_base + w₁(δ)·ΔP₁ + w₂(δ)·ΔP₂ + ...
```

Where the weight functions `w_i(δ)` are B-spline basis functions for multi-point control.

For wingsuits: δ = arch amount. Arch increases effective camber (shifts α_0 down), increases area (increases CL_α), and increases parasitic drag (increases CD_0).

For canopies: δ = brake input. Brakes deflect trailing edge, adding camber (shifts α_0 down, increases CL at given α) and increasing CD.

### Approach 4: Neural Network Augmentation (Future)

Small NN (2-3 hidden layers, ReLU, 16-32 nodes) for residual correction:
```
CL(α, β, δ) = CL_kirchhoff(α, β, δ) + NN_CL(α, β, δ)
```

Trained on GPS-derived data to capture effects the parametric model misses. Keep the physics-based model as the backbone for extrapolation safety.

---

## Recommended Architecture

### Target Interface

```typescript
interface ContinuousPolar {
  // Identity
  type: string
  name: string
  public: boolean

  // Physical properties
  s: number              // Reference area [m²]
  m: number              // Mass [kg]
  cg: number             // CG position
  i: number              // Moment of inertia

  // === ATTACHED-FLOW MODEL (active when f ≈ 1) ===

  // Lift model
  cl_alpha: number       // Lift curve slope [1/rad]
  alpha_0: number        // Zero-lift AOA [rad]

  // Drag model
  cd_0: number           // Parasitic drag coefficient (min drag at α_0)
  K: number              // Induced drag factor (CL² dependent)

  // === SEPARATED-FLOW / FLAT-PLATE MODEL (active when f ≈ 0) ===

  cd_n: number           // Normal-force drag: broadside-to-flow drag coefficient (~1.2–2.0)
  cd_n_lateral: number   // Lateral broadside drag (for β = ±90°)

  // === STALL MODEL (Kirchhoff dual-sigmoid) ===

  // Forward stall (positive α)
  alpha_stall_fwd: number    // Forward stall angle [rad] (typically +15° to +25°)
  S1_fwd: number             // Pre-stall separation sharpness [rad]
  S2_fwd: number             // Post-stall separation sharpness [rad] (can differ from S1)

  // Back stall (negative α)
  alpha_stall_back: number   // Back-stall angle [rad] (typically -3° to -15°)
  S1_back: number            // Pre-back-stall separation sharpness [rad]
  S2_back: number            // Post-back-stall separation sharpness [rad]

  // === SIDESLIP ===

  cy_beta: number        // Side force derivative [1/rad]

  // === CONTROL DIMENSION (δ) ===

  control: {
    d_cl_alpha: number      // ΔCL_α per unit δ
    d_alpha_0: number       // Δα_0 per unit δ [rad]
    d_cd_0: number          // ΔCD_0 per unit δ
    d_K: number             // ΔK per unit δ
    d_alpha_stall_fwd: number  // Δα_stall_fwd per unit δ [rad]
    d_alpha_stall_back: number // Δα_stall_back per unit δ [rad]
    d_cd_n: number          // ΔCD_n per unit δ (deployment changes bluff-body drag)
  }

  // === PITCHING MOMENT ===

  cm_0: number           // CM at zero lift
  cm_alpha: number       // CM slope [1/rad]
  cm_delta: number       // CM change with control [1/unit δ]

  // === CENTER OF PRESSURE ===

  cp_0: number           // CP at zero lift
  cp_alpha: number       // CP movement [per rad]

  // === DYNAMIC EFFECTS (optional) ===

  tau_f?: number         // Separation lag time constant [s] (0 = static, >0 = dynamic stall)
}
```

### Core Module API

```typescript
// continuous-polar.ts — New module

// Kirchhoff dual-sigmoid separation function (full-range)
function separation(alpha: number, polar: ContinuousPolar, delta: number): number

// Flat-plate model (valid for any α)
function getCL_plate(alpha: number, cd_n: number): number
function getCD_plate(alpha: number, cd_n: number, cd_0: number): number

// Full-range blended coefficient functions
function getCL(alpha: number, beta: number, delta: number, polar: ContinuousPolar): number
function getCD(alpha: number, beta: number, delta: number, polar: ContinuousPolar): number
function getCY(alpha: number, beta: number, delta: number, polar: ContinuousPolar): number
function getCM(alpha: number, delta: number, polar: ContinuousPolar): number
function getCP(alpha: number, delta: number, polar: ContinuousPolar): number

// Bundle: returns all coefficients at once (efficient — single f(α) evaluation)
interface FullCoefficients { cl: number, cd: number, cy: number, cm: number, cp: number, f: number }
function getAllCoefficients(alpha: number, beta: number, delta: number, polar: ContinuousPolar): FullCoefficients

// Conversion from sustained speeds
function coeffToSS(cl: number, cd: number, s: number, m: number, rho: number): SustainedSpeeds
function ssToCoeff(vxs: number, vys: number, s: number, m: number, rho: number): Coefficients

// Conversion from legacy polar
function convertFromWSEQPolar(legacy: WSEQPolar): ContinuousPolar

// Fitting from data
function fitContinuousPolar(data: Coefficients[], s: number, m: number): { polar: ContinuousPolar, error: number }
function fitFromGPS(trajectory: GPSPoint[], wind: WindModel, rho: number, s: number, m: number): { polar: ContinuousPolar, error: number }

// Sampling for visualization (matches existing API expectations)
function samplePolarContinuous(polar: ContinuousPolar, delta: number, nPoints: number): Coefficients[]
function sampleSpeedPolar(polar: ContinuousPolar, delta: number, rho: number, nPoints: number): SustainedSpeeds[]
```

---

## Implementation Phases

### Phase 1: Core Full-Range Model (α + β)
- Implement `ContinuousPolar` interface and dual-sigmoid Kirchhoff math
- Implement flat-plate blending for full α ∈ [-π, +π]
- Implement cos²(β) / sin²(β) sideslip factors for full β ∈ [-π/2, +π/2]
- Implement `convertFromWSEQPolar()` to translate existing 27+ polars
- Unit tests: verify converted polars match original `getcoefficients()` in normal flight range
- Unit tests: verify flat-plate behavior at extreme angles (α = ±90°, ±180°)
- **Visualizer**: CL/CD vs α curves from -180° to +180°, force vectors on placeholder model

### Phase 2: Full Visualization + Validation
- Load real 3D models (wingsuit, canopy, skydiver, airplane) in Three.js
- Force and moment vector rendering
- Body frame vs inertial frame views
- Side-by-side comparison: WSEQPolar (table) vs ContinuousPolar (equation)
- Validate against all 27+ existing CloudBASE polars in normal flight range

### Phase 3: Continuous Control (δ)
- Replace discrete arch/dearch/deploy switching with continuous δ ∈ [0, 1]
- Implement parameter morphing (linear + optional spline blending)
- Fit δ effects from multi-configuration flight data
- **Visualizer**: δ slider smoothly morphs force vectors and 2D curves
- Validate: smooth transition between arch/neutral/dearch

### Phase 4: Fitting Pipeline
- Implement `fitContinuousPolar()` nonlinear parameter estimation (Levenberg-Marquardt)
- Fit all ~12 parameters from GPS-derived coefficient data
- Compare with existing `fitpolar*()` accuracy in normal range
- Validate extreme-angle parameters against known flat-plate behavior
- GPS trajectory → polar parameter extraction including stall data

### Phase 5: CloudBASE Integration
- Copy `src/polar/` into CloudBASE's `util/`
- Add `getcoefficients()` adapter for `ContinuousPolar`
- Wire `aero.ts` → `getAlphaBeta()` into simulation path
- Update `generatew3d()` or create `generatew6d()` for full 3-axis forces
- Validate in simulator: same trajectories as table polars in normal flight
- Validate: back-flying and deployment transients produce reasonable physics

### Phase 6: Advanced Extensions
- Implement `fitContinuousPolar()` nonlinear parameter estimation
- Compare with existing `fitpolar*()` accuracy
- Bayesian parameter estimation for uncertainty quantification
- GPS trajectory → polar parameter extraction
- Dynamic stall lag (`tau_f` parameter)
- Aerodynamic sections (arm/leg/body for wingsuits)
- Neural network residual correction
- Ground effect model
- Asymmetric control (left/right brake, roll coupling)

---

## Compatibility & Migration

### Backward Compatibility Requirements
1. All 27+ existing named polars must be convertible to `ContinuousPolar`
2. Existing `WSEQPolar` JSON data stored in the database must remain loadable
3. `getcoefficients(speed, polar)` must work with both polar types
4. Sustained speed conversion (`coefftoss`/`sstocoeff`) is type-agnostic — no changes needed
5. All visualization/sampling functions must have continuous-polar equivalents

### Adapter Pattern
```typescript
function getcoefficients(speed: number, polar: WSEQPolar | ContinuousPolar): Coefficients {
  if (isContinuousPolar(polar)) {
    const alpha = speedIndexToAlpha(speed, polar)
    return { cl: getCL(alpha, 0, 0, polar), cd: getCD(alpha, 0, 0, polar) }
  }
  // ... existing logic
}
```

---

## Build & Development

The polar math is developed in the **Polar Visualizer** project (see [`POLAR-VISUALIZER.md`](POLAR-VISUALIZER.md)).

The `src/polar/` directory in the visualizer contains pure TypeScript math with no UI dependencies — this is the code that will eventually be imported into CloudBASE.

### CloudBASE (for reference / data source)
```bash
npm run build            # Vite 7.2.6 production build
npm run dev              # Vite dev server
sbt run                  # Play Framework backend
```

**Key constraint**: Pure TypeScript math, no external numerical libraries (must run in browser).

---

## Reference Literature

1. **Kirchhoff-Helmholtz flow separation**: Leishman, "Principles of Helicopter Aerodynamics" — dynamic stall models using separation function
2. **Beddoes-Leishman model**: Beddoes, "A Synthesis of Unsteady Aerodynamic Effects" — `CL = CL_α·sin(α)·((1+√f)/2)²`
3. **Standard drag polar**: Anderson, "Aircraft Performance and Design" — `CD = CD0 + K·(CL - CL0)²`
4. **Sideslip aerodynamics**: Stengel, "Flight Dynamics" (Princeton, 2004) — separable cross-flow model `CD(β) = CD(α)·cos²(β) + CD_n·sin²(β)`
5. **6DOF simulation**: Stevens & Lewis, "Aircraft Control and Simulation" — full equations of motion
6. **UAV real-time modeling**: Grauer & Morelli, "A Generic Nonlinear Aerodynamic Model for Flight Dynamics Simulation" — multivariate polynomial for agile flight
7. **Lifting-line theory**: Prandtl (1918) — `CD_induced = CL²/(π·e·AR)`
8. **Nonlinear parameter estimation**: Jategaonkar, "Flight Vehicle System Identification" — Levenberg-Marquardt for aero model fitting
9. **USAF DATCOM**: Engineering methods for estimating stability and control derivatives
10. **Flat-plate aerodynamics at high α**: Hoerner, "Fluid-Dynamic Drag" — `CL = CD_n·sin(α)·cos(α)`, `CD = CD_n·sin²(α)` — **critical for full-range model**, provides correct behavior from 0° to 180°
11. **Wind turbine full-range models**: Viterna & Janetzke (1982), "Theoretical and Experimental Power from Large Horizontal-Axis Wind Turbines" — flat-plate extrapolation for post-stall airfoil data, same mathematical approach used here
12. **Post-stall flight dynamics**: Nguyen et al., "Simulator Study of Stall/Post-Stall Characteristics of a Fighter Airplane" (NASA TP-1538) — validated full-range CL/CD models for simulation

---

## Open Questions

1. **Aerodynamic sections vs single polar**: Should wingsuits be modeled as a single body or as sections (arm wings, leg wing, body)? Sections allow differential control and turn modeling but multiply complexity. **Recommendation**: Start single-body; add sections in Phase 6 if needed.

2. **Dynamic stall**: At high dα/dt (wingsuit deployment, canopy opening), static polar is inaccurate. Kirchhoff model extends with first-order lag: `df/dt = (f_static - f) / τ`. **Recommendation**: Include as optional `tau_f` parameter, default 0 (static). Especially important for the deployment transient (α = 0° → 150° → back to 20° in ~2 seconds).

3. **Reynolds number effects**: Human flight spans Re ~10⁵ (wingsuits) to ~10⁶ (canopies). Per-polar fitting absorbs Re effects. Add explicit Re correction in Phase 6 if needed.

4. **Compressibility**: Not relevant — all modes are deeply subsonic (M < 0.3).

5. **Ground effect for canopy landings**: Add as multiplicative correction in Phase 6: `CL_ground = CL · (1 + Δ_ground(h/b))`.

6. **Parameter identifiability from GPS**: With only position/velocity observations, the extreme-angle parameters (CD_n, back-stall) are hard to fit from normal-flight GPS data. **Strategy**: Use physical defaults (CD_n ≈ 1.2 for streamlined body, 2.0 for bluff; α_stall_back ≈ -0.5 · α_stall_fwd) and refine only from flights that visit those regimes.

7. **Back-flying polar asymmetry**: A wingsuit flying backwards has different aerodynamics than flying forwards at the same ABS(α) because the body is not fore-aft symmetric. The flat-plate model handles this implicitly (sin/cos don't care about asymmetry at high α). For more accuracy near back-stall, consider a separate `cl_alpha_back` parameter. **Recommendation**: Defer to Phase 6.

8. **Canopy collapse modeling**: When CL goes negative on a RAM-air canopy, the wing deflates. This is a structural change, not just an aerodynamic one — the reference area S changes dramatically. **Recommendation**: Model the collapse as a rapid increase in CD_n and decrease in CL_α, triggered when integrated CL drops below a threshold. Phase 6.

9. **δ range for deployment**: When a wingsuit pilot deploys a parachute, the transition from "wingsuit polar" to "canopy polar" is not a δ sweep — it's a polar swap. The deployment phase (0-3 seconds) with the pilot chute out is already modeled as `deploypolar`. **Recommendation**: Keep deploy as a polar swap (not δ); use δ only for within-polar-type control variation (arch/brakes).
