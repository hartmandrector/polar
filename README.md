# Polar Visualizer

A standalone web application for visualizing full-range aerodynamic polars using a **continuous polar model** built on Kirchhoff separation theory. Features an interactive 3D viewer with force vectors, moment arcs, and Chart.js polar charts — all running client-side in the browser.

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![Three.js](https://img.shields.io/badge/Three.js-0.170-green)
![Chart.js](https://img.shields.io/badge/Chart.js-4.5-orange)
![Vite](https://img.shields.io/badge/Vite-6-purple)

![Full-range α sweep — Aura 5 wingsuit with CL chart and 3D force vectors](polar-visualizer/docs/gifs/hero-alpha-sweep.gif)

---

## Quick Start

```bash
# Clone and install
cd polar-visualizer
npm install

# Development server (hot reload)
npm run dev

# Production build
npm run build
npm run preview
```

The dev server will open at `http://localhost:5173`.

### Requirements

- Node.js 18+
- npm 9+

---

## Features

- **3D Viewer** — Three.js scene with OrbitControls, body-frame and inertial-frame rendering with independent φ/θ/ψ attitude control

<p align="center"><img src="gifs/body-inertial-frames.gif" width="720" alt="Body vs inertial frame switching with attitude sliders" /></p>

- **Force Vectors** — Lift (blue), drag (red), side force (cyan), weight (yellow), net (white) as shaded 3D arrows originating from the center of pressure (CP) or center of gravity (CG)
- **Moment Arcs** — Pitch (red), yaw (green), roll (purple) curved arrows at CG
- **4 Models** — Aura 5 wingsuit, Ibex UL canopy, Slick Sin skydiver, Caravan airplane
- **Interactive Controls** — α (angle of attack), β (sideslip), δ (control input), dirty flying, airspeed, air density
- **6 Chart Views** — CL vs α, CD vs α, CP vs α, L/D vs α, CL vs CD (polar curve), Vxs vs Vys (speed polar)
- **Legacy Overlay** — Toggle to compare continuous model against legacy table-interpolated polars
- **Full Readout Panel** — All coefficients, forces, and sustained speeds displayed in real time

---

## Project Structure

```
polar-visualizer/
├── index.html              # App shell and layout
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.ts             # Entry point — wires everything together
│   ├── style.css            # Dark theme styling
│   ├── polar/               # Core aerodynamic math (UI-independent)
│   │   ├── continuous-polar.ts   # Type definitions (ContinuousPolar, SymmetricControl)
│   │   ├── kirchhoff.ts         # Separation function & flat-plate models
│   │   ├── coefficients.ts      # Full coefficient evaluation & force conversions
│   │   ├── polar-data.ts        # Legacy polars + continuous polar definitions
│   │   └── index.ts             # Barrel exports
│   ├── viewer/              # Three.js 3D rendering
│   │   ├── scene.ts             # Scene, camera, lights, OrbitControls
│   │   ├── model-loader.ts      # Procedural 3D models (wingsuit, canopy, etc.)
│   │   ├── vectors.ts           # Force vector & moment arc management
│   │   ├── shaded-arrow.ts      # Custom MeshPhongMaterial arrow geometry
│   │   └── curved-arrow.ts      # Moment arc (CurvedArrow) geometry
│   └── ui/                  # DOM controls and charts
│       ├── controls.ts          # Slider/dropdown bindings, FlightState
│       ├── readout.ts           # Coefficient & force readout panel
│       ├── chart-data.ts        # Sweep generators for polar charts
│       └── polar-charts.ts      # Chart.js dual-panel chart system
```

The `src/polar/` module is completely UI-independent and designed to be portable into other projects (e.g. CloudBASE flight simulator).

---

## The Continuous Polar Model

### Why Continuous?

Traditional aerodynamic polars in skydiving simulators use look-up tables with linear interpolation. These tables:
- Only cover a narrow AOA range (typically 0°–90° for wingsuits)
- Have no physics outside the table bounds
- Can't smoothly handle stall transitions
- Don't extend to back-flying, inverted, or tumbling orientations

The **continuous polar model** replaces tables with a parametric system that produces smooth, physically motivated coefficients for **any** angle of attack from -180° to +180° and any sideslip angle from -90° to +90°.

### Architecture Overview

The model works by blending two regimes:

```
Coefficient(α) = f(α) · Attached_Model(α) + (1 - f(α)) · FlatPlate_Model(α)
```

Where **f(α)** is the Kirchhoff separation function — a smooth value between 0 and 1 that describes how "attached" the airflow is:
- **f = 1**: Fully attached flow (normal flight)
- **f = 0**: Fully separated (flat-plate / deep stall)
- **0 < f < 1**: Transitional (stall region)

```
        ┌─────────────────────────────────────────────────────┐
        │  f(α) — Kirchhoff Separation Function               │
   1.0  │  ████████████████████████                            │
        │                        ██                            │
        │                          ██   ← Forward stall        │
        │                            ██   transition            │
   0.5  │                              ██                      │
        │                                ██                    │
        │                                  ██                  │
        │                                    ██████████████    │
   0.0  │                                                      │
        └─────────────────────────────────────────────────────┘
         -180°        -90°         0°         45°        180°
                           Angle of Attack (α)
```

---

## ContinuousPolar Parameters

The `ContinuousPolar` interface defines the complete aerodynamic character of a body. Every parameter below shapes the coefficient curves in a specific, interpretable way.

### Attached-Flow Lift Model

| Parameter | Units | Description |
|-----------|-------|-------------|
| `cl_alpha` | 1/rad | **Lift-curve slope.** How rapidly lift builds with angle of attack in attached flow. Wingsuit ≈ 2.9, canopy ≈ 3.5, airplane ≈ 4.8. Higher = more lift per degree. |
| `alpha_0` | deg | **Zero-lift angle of attack.** The AOA where CL = 0. Symmetric bodies ≈ 0°, cambered airfoils are negative (e.g. -3° for canopies). |

The attached lift model uses:

$$C_{L_{att}} = C_{L_\alpha} \cdot \sin(\alpha - \alpha_0)$$

Using `sin()` rather than a linear function gives better behavior in the transition zone near stall where separation begins but attached-flow math still contributes to the blend.

#### Effect of `cl_alpha`

Increasing `cl_alpha` steepens the lift curve in attached flow. For the Aura 5 wingsuit:

![Effect of cl_alpha on lift curve](polar-visualizer/docs/gifs/effect-cl-alphalift.gif)
![Effect of cl_alpha on polar curve](polar-visualizer/docs/gifs/effect-cl-alpha.gif)

| `cl_alpha` | Peak CL (approx) | Character |
|------------|-------------------|-----------|
| 2.0 | ~0.85 | Low-efficiency body |
| **2.9** | **~1.15** | **Aura 5 baseline** |
| 4.0 | ~1.55 | High-aspect-ratio wing |

#### Effect of `alpha_0`

Shifting `alpha_0` slides the entire lift curve left or right without changing its shape:

| `alpha_0` | Zero-lift crossing | Character |
|-----------|-------------------|-----------|
| 0° | CL=0 at α=0° | Symmetric body (skydiver) |
| **-1°** | **CL=0 at α=-1°** | **Slight camber (wingsuit)** |
| -3° | CL=0 at α=-3° | Cambered airfoil (canopy) |

---

### Drag Model

| Parameter | Units | Description |
|-----------|-------|-------------|
| `cd_0` | — | **Parasitic drag coefficient.** Drag at zero lift. Airplane ≈ 0.029, wingsuit ≈ 0.10, skydiver ≈ 0.47. |
| `k` | — | **Induced drag factor.** How quickly drag grows with lift. Lower = more efficient. |

The attached drag model uses the classical drag polar:

$$C_{D_{att}} = C_{D_0} + K \cdot C_L^2$$

#### Effect of `cd_0`

`cd_0` shifts the entire drag curve up or down. It's the "floor" — the minimum drag the body can ever achieve in attached flow:

![Effect of cd_0 on drag curve](polar-visualizer/docs/gifs/effect-cd-0.gif)

| Body | `cd_0` | Character |
|------|--------|-----------|
| Clean airplane | 0.029 | Very low parasitic drag |
| **Wingsuit** | **0.101** | **Moderate — streamlined human** |
| Canopy | 0.12 | Lines, fabric, suspension |
| Skydiver | 0.467 | High — exposed human body |

#### Effect of `k`

`k` controls how much drag penalty you pay for generating lift:

| `k` | L/D_max (approx) | Character |
|-----|-------------------|-----------|
| 0.15 | ~4.5 | Efficient canopy |
| **0.32** | **~3.2** | **Wingsuit baseline** |
| 0.485 | ~2.8 | Airplane (short field) |
| 0.70 | ~1.0 | Skydiver body |

---

### Flat-Plate / Separated Flow

| Parameter | Units | Description |
|-----------|-------|-------------|
| `cd_n` | — | **Normal-force drag coefficient.** Broadside drag when the body is perpendicular to the airflow (α = 90°). Typically 1.0–1.5. |
| `cd_n_lateral` | — | **Lateral broadside drag.** Same concept but for sideslip (β = 90°). |

When flow is fully separated (f → 0), the body behaves like a flat plate:

$$C_{L_{plate}} = C_{D_n} \cdot \sin(\alpha) \cdot \cos(\alpha)$$

$$C_{D_{plate}} = C_{D_n} \cdot \sin^2(\alpha) + C_{D_0} \cdot \cos^2(\alpha)$$

#### Effect of `cd_n`

`cd_n` controls the "roof" — the maximum drag at broadside orientation and the amplitude of flat-plate lift:

| `cd_n` | Drag at 90° | Flat-plate CL peak |
|--------|-------------|-------------------|
| 1.0 | 1.0 | 0.50 (at 45°) |
| **1.1** | **1.1** | **0.55** |
| 1.5 | 1.5 | 0.75 |

---

### Stall Parameters (Kirchhoff Separation)

| Parameter | Units | Description |
|-----------|-------|-------------|
| `alpha_stall_fwd` | deg | **Forward stall angle.** The AOA where the forward separation sigmoid is centered. Beyond this, flow rapidly detaches. |
| `s1_fwd` | deg | **Forward stall sharpness.** Smaller = sharper stall break. Larger = gradual, gentle stall. |
| `alpha_stall_back` | deg | **Back stall angle.** Where separation occurs for increasingly negative α (back-flying). |
| `s1_back` | deg | **Back stall sharpness.** Controls the transition width for back stall. |

The separation function is the product of two sigmoids:

$$f(\alpha) = f_{fwd}(\alpha) \cdot f_{back}(\alpha)$$

$$f_{fwd}(\alpha) = \frac{1}{1 + \exp\!\left(\frac{\alpha - \alpha_{stall,fwd}}{s_{1,fwd}}\right)}$$

$$f_{back}(\alpha) = \frac{1}{1 + \exp\!\left(\frac{\alpha_{stall,back} - \alpha}{s_{1,back}}\right)}$$

#### Effect of `alpha_stall_fwd`

Controls where CL peaks and starts dropping:

![Effect of alpha_stall_fwd on stall point](polar-visualizer/docs/gifs/effect-alpha-stall-fwd.gif)

| `alpha_stall_fwd` | Stall onset | Character |
|--------------------|-------------|-----------|
| 22° | Early stall | Airplane (Caravan) |
| **34.5°** | **Late stall** | **Wingsuit (flexible surface)** |
| 45° | Very late | Nearly symmetric body (skydiver) |

#### Effect of `s1_fwd` (Stall Sharpness)

This is one of the most powerful parameters. It controls how abrupt the stall transition is:

| `s1_fwd` | Character | Description |
|-----------|-----------|-------------|
| 2° | Very sharp | Hard stall break — CL drops rapidly. Typical of thin airfoils. |
| **4°** | **Moderate** | **Progressive stall with clear break. Aura 5 & Caravan baseline.** |
| 8° | Gradual | Very gentle stall. Skydiver — almost no distinct stall point. |

```
CL vs α — Effect of s1_fwd (stall sharpness)

   CL
   │        ╱╲  s1=2° (sharp)
   │       ╱  ╲ 
   │      ╱ ╱──╲──  s1=4° (moderate)
   │     ╱ ╱     ╲──── 
   │    ╱╱     ╱────────  s1=8° (gradual)
   │   ╱╱    ╱
   │  ╱╱   ╱
   │ ╱╱  ╱
   │╱╱ ╱
   └──────────────────── α
   0°    20°    40°    60°
```

---

### Sideslip Model

| Parameter | Units | Description |
|-----------|-------|-------------|
| `cy_beta` | 1/rad | **Side force derivative.** Side force per radian of sideslip. Negative = force opposes sideslip (stabilizing). |
| `cn_beta` | 1/rad | **Yaw moment derivative.** Yaw moment per radian of sideslip. Positive = weathervane stability (nose into wind). |
| `cl_beta` | 1/rad | **Roll moment derivative.** Roll moment per radian of sideslip. Negative = dihedral effect (rolls away from sideslip). |

Sideslip affects all coefficients through crossflow scaling:

![Effect of sideslip (β) on coefficients](polar-visualizer/docs/gifs/effect-beta-sideslip.gif)

$$C_L(\alpha, \beta) = C_L(\alpha) \cdot \cos^2(\beta)$$

$$C_D(\alpha, \beta) = C_D(\alpha) \cdot \cos^2(\beta) + C_{D_n,lat} \cdot \sin^2(\beta)$$

$$C_Y = C_{Y_\beta} \cdot \sin(\beta) \cdot \cos(\beta)$$

---

### Pitching Moment & Center of Pressure

| Parameter | Units | Description |
|-----------|-------|-------------|
| `cm_0` | — | **Zero-alpha pitching moment.** Baseline nose-down tendency. Negative = nose-down (stable). |
| `cm_alpha` | 1/rad | **Pitch moment slope.** How pitching moment changes with α. Negative = statically stable. |
| `cp_0` | fraction | **CP at zero alpha.** Center of pressure location as a fraction of chord from the leading edge. |
| `cp_alpha` | 1/rad | **CP travel with α.** How CP moves as α increases. Negative = CP moves forward with increasing α. |
| `cg` | fraction | **Center of gravity.** CG location as fraction of chord from leading edge. Forces and moments reference this point. |
| `chord` | m | **Reference chord / body length.** Used for moment arm calculations and 3D model scaling. |

When flow separates, pitching moment and CP blend to flat-plate values:

$$C_M = f \cdot (C_{M_0} + C_{M_\alpha} \cdot \alpha_{eff}) + (1-f) \cdot C_{M_{plate}}$$

$$CP = f \cdot CP_{attached} + (1-f) \cdot CP_{plate}$$

The flat-plate CP moves from 0.25 (thin airfoil center) toward 0.50 (geometric center) as α → 90°.

---

### Physical Properties

| Parameter | Units | Description |
|-----------|-------|-------------|
| `s` | m² | **Reference area.** Wing area or projected body area used in force equations. |
| `m` | kg | **Mass.** Total system mass (body + suit/canopy/aircraft). |
| `chord` | m | **Reference length.** Used for moment non-dimensionalization. Also determines 3D model scale. |
| `cp_lateral` | fraction | **Lateral CP.** Where side forces originate along the chord. |

---

### Symmetric Controls (`SymmetricControl`)

The control system allows any number of control axes (brake, front riser, rear riser, dirty flying) to **morph the base polar parameters** linearly with a control input δ ∈ [-1, +1]:

$$P(\delta) = P_{base} + \delta \cdot \Delta P$$

Each `SymmetricControl` specifies how much each base parameter shifts per unit of δ:

| Derivative | What it morphs | Typical use |
|------------|---------------|-------------|
| `d_alpha_0` | Zero-lift AOA | Brakes add camber → α₀ shifts negative |
| `d_cd_0` | Parasitic drag | Brakes/dirty increase drag |
| `d_cl_alpha` | Lift slope | Dirty flying reduces lift efficiency |
| `d_k` | Induced drag factor | Dirty flying worsens span efficiency |
| `d_alpha_stall_fwd` | Forward stall angle | Brakes lower stall AOA |
| `d_alpha_stall_back` | Back stall angle | Rarely used |
| `d_cd_n` | Broadside drag | Morphs separated-flow drag |
| `d_cp_0` | CP position | Brakes shift CP aft |
| `d_cp_alpha` | CP travel rate | Controls CP sensitivity |
| `cm_delta` | Pitch moment | Direct pitch trim from control input |

#### Example: Wingsuit Dirty Flying

The wingsuit `dirty` control models the effect of a relaxed, non-tensioned body position:

```typescript
dirty: {
  d_cd_0:             0.025,   // +2.5% parasitic drag (loose suit)
  d_cl_alpha:        -0.3,     // Less efficient lift generation
  d_k:                0.08,    // Worse span efficiency
  d_alpha_stall_fwd: -3.0,     // Stalls 3° earlier
  d_cp_0:             0.03,    // CP moves toward CG
  d_cp_alpha:         0.02,    // Less CP travel
}
```

At `dirty = 1.0`, the effective polar becomes:
- `cl_alpha`: 2.9 → 2.6 (less lift per degree)
- `cd_0`: 0.101 → 0.126 (higher drag floor)
- `alpha_stall_fwd`: 34.5° → 31.5° (earlier stall)

---

## Sustained Speed Polar

Given CL and CD at a particular α, the model computes equilibrium glide speeds:

$$V = \sqrt{\frac{2mg}{\rho S \sqrt{C_L^2 + C_D^2}}}$$

$$V_{xs} = V \cdot \frac{C_L}{\sqrt{C_L^2 + C_D^2}} \qquad V_{ys} = V \cdot \frac{C_D}{\sqrt{C_L^2 + C_D^2}}$$

Where Vxs is horizontal speed and Vys is vertical (sink) speed. The speed polar chart plots these across all α, revealing the performance envelope — best glide ratio, minimum sink, and speed range.

---

## Legacy Polar Comparison

The visualizer includes a **legacy overlay** that plots the original table-interpolated polar data (from CloudBASE) on top of the continuous model curves. This allows direct comparison to validate that the continuous model accurately captures the flight characteristics that were empirically measured.

Legacy polars use the `WSEQPolar` format — arrays of CL, CD, and CP values at discrete AOA points with linear interpolation between them. The legacy data only covers a limited AOA range (e.g. 0°–90° for wingsuits), while the continuous model extends to the full ±180°.

Toggle the **Legacy** checkbox on any chart to show/hide the thin-line legacy trace.

---

## Charts

The visualizer includes two chart panels, each with a dropdown selector:

**Chart 1 (α-based):**
- CL vs α — Lift coefficient curve
- CD vs α — Drag coefficient curve
- CP vs α — Center of pressure travel
- L/D vs α — Glide ratio (lift-to-drag)

**Chart 2 (cross-plots):**
- CL vs CD — Polar curve (drag polar)
- Vxs vs Vys — Speed polar (toggle mph/m·s⁻¹)

All charts use AOA-colored points (rainbow mapping from -180° to +180°) with a white cursor dot tracking the current α.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Build | Vite 6 | Dev server & production bundling |
| Language | TypeScript 5.7 | Strict mode, ESNext modules |
| 3D | Three.js 0.170 | WebGL rendering, OrbitControls |
| Charts | Chart.js 4.5 | 2D scatter/line charts |
| Math | Custom | Kirchhoff separation, Kirchhoff blending |

---

## License

MIT License — see [LICENSE](LICENSE) for details.

**Exception:** The 3D model files in `polar-visualizer/public/models/` are All Rights Reserved and not covered by the MIT License.
