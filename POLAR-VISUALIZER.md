# Polar Visualizer — Project Overview

## What Is This?

A **standalone web application** for evaluating, testing, and visualizing continuous aerodynamic polar models for human flight. No simulation — purely static force/moment visualization at user-controlled flight conditions.

This is the development and validation tool for the continuous polar math defined in [`CONTINUOUS-POLAR.md`](CONTINUOUS-POLAR.md). Once the polar model is validated here, it will be integrated back into CloudBASE for simulation, Kalman filtering, real-time GPS analysis, VR, and other applications.

---

## Why a Separate Project?

CloudBASE is great for collecting real flight data, fitting polars, and running simulations with the existing table-based system. But to develop and validate a **new** continuous polar model, we need:

- A clean environment focused on the math, not the simulation loop
- Interactive visualization of forces at any α, β, δ — not just along a simulated trajectory
- Side-by-side comparison of old (table) vs new (continuous) polars
- The ability to inspect edge cases (back-flying, deployment, extreme sideslip) without running a full sim
- A tool that's useful beyond simulation — for Kalman filtering, real-time analysis, VR force rendering

---

## Core Features

### 1. 3D Model Viewer (Three.js)

Render the flight body in 3D:
- **Wingsuit** — existing 3D model from CloudBASE
- **Canopy (RAM-air)** — parachute model
- **Skydiver (slick/tracking)** — body model
- **Airplane** — aircraft model

Dropdown selector to switch between models.

### 2. Interactive Controls

| Control | Type | Range | Purpose |
|---------|------|-------|---------|
| **α (AOA)** | Slider | -180° to +180° | Angle of attack |
| **β (sideslip)** | Slider | -90° to +90° | Sideslip angle |
| **δ (control)** | Slider | -1 to +1 | Arch/de-arch/brakes/elevator |
| **Airspeed** | Slider | 0 to 80 m/s | Relative wind magnitude |
| **Polar** | Dropdown | All named polars | Which polar to evaluate |
| **ρ (density)** | Slider | 0.4 to 1.225 kg/m³ | Air density (altitude) |

### 3. Force Visualization

Draw 3D vectors on the model showing:

| Vector | Color | Description |
|--------|-------|-------------|
| **Relative wind** | White/gray | Incoming airflow direction |
| **Lift** | Green | Perpendicular to airflow, in the lift plane |
| **Drag** | Red | Parallel to airflow, opposing motion |
| **Side force (CY)** | Blue | Lateral force from sideslip |
| **Total aerodynamic force** | Yellow | Vector sum of L + D + CY |
| **Weight** | Gray (down) | mg, always points down in inertial frame |
| **Net force** | Magenta | Aero + weight = what actually accelerates the body |

Vector lengths scale with force magnitude. Numeric readouts alongside.

### 4. Moment / Torque Visualization

Draw rotational vectors:

| Moment | Color | Description |
|--------|-------|-------------|
| **Pitching moment (CM)** | Orange | Nose-up/down torque about lateral axis |
| **Yaw moment** | Cyan | Torque about vertical axis (from CY / asymmetric drag) |
| **Roll moment** | Pink | Torque about longitudinal axis (future: asymmetric δ) |

Show the center of pressure (CP) location on the model — the point where aerodynamic forces effectively act.

### 5. Dual Frame Display

Two viewports (or toggle):

#### Body Frame
- Model is fixed, wind vector rotates with α and β
- Forces shown in body-fixed coordinates
- This is how the equations are evaluated — forces decompose naturally in body frame
- Useful for understanding pilot input → force response

#### Inertial Frame (Wind Frame)
- Wind comes from a fixed direction (e.g., left-to-right)
- Model rotates to show the current α and β
- Forces shown in world coordinates
- Useful for understanding actual flight path forces — what the GPS would see

### 6. Polar Curve Display (2D Panels)

Alongside the 3D view, show 2D plots:

| Plot | X-axis | Y-axis | Description |
|------|--------|--------|-------------|
| **CL vs α** | α (-180° to +180°) | CL | Full-range lift curve with current α marked |
| **CD vs α** | α (-180° to +180°) | CD | Full-range drag curve |
| **CL vs CD** | CD | CL | Traditional drag polar |
| **CM vs α** | α | CM | Pitching moment curve |
| **f(α) vs α** | α | f | Kirchhoff separation function |
| **CL vs β** (at current α) | β | CL | Sideslip effect on lift |

Current operating point highlighted on all curves. δ value affects the curves in real-time.

### 7. Coefficient Readout Panel

Numeric display of all current values:

```
α = 12.3°   β = -2.1°   δ = 0.35   V = 45.2 m/s   ρ = 1.095 kg/m³

CL = 0.847   CD = 0.142   CY = -0.031   CM = -0.054   CP = 0.31
f(α) = 0.97  (97% attached)

Lift = 482 N   Drag = 81 N   Side = -18 N   Weight = 834 N
L/D = 5.96   Glide angle = 9.5°   Vx_sustained = 38.2 m/s   Vy_sustained = 6.4 m/s
```

---

## Tech Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| **3D rendering** | Three.js | WebGL, model loading (GLTF/OBJ from CloudBASE) |
| **UI framework** | Vanilla JS or lightweight (Svelte/Preact) | Keep it simple |
| **Charts** | Canvas 2D or lightweight chart lib | For 2D polar plots |
| **Polar math** | TypeScript | Same code that will eventually go into CloudBASE |
| **Build** | Vite | Consistent with CloudBASE toolchain |
| **Hosting** | Static site (GitHub Pages / Vercel / local) | No backend needed |

### 3D Models

Reuse existing models from CloudBASE:
- Models are already available in the CloudBASE project
- Load via Three.js GLTF/OBJ loader
- Position the model at origin, apply α/β rotation to either the model (inertial frame view) or the wind vector (body frame view)

---

## Architecture

```
polar-visualizer/
├── index.html              # Main page
├── package.json            # Dependencies: three, vite, typescript
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.ts             # Entry point, setup Three.js scene
│   ├── ui/
│   │   ├── controls.ts     # Sliders, dropdowns, event handlers
│   │   ├── readout.ts      # Numeric coefficient display
│   │   └── charts.ts       # 2D polar curve plots
│   ├── polar/
│   │   ├── continuous-polar.ts    # ContinuousPolar interface + math ⭐ THE CORE
│   │   ├── kirchhoff.ts          # Separation function, flat-plate blending
│   │   ├── coefficients.ts       # getCL, getCD, getCY, getCM, getCP
│   │   ├── convert.ts            # convertFromWSEQPolar()
│   │   └── polar-data.ts         # Exported polar definitions (from CloudBASE)
│   ├── viewer/
│   │   ├── scene.ts        # Three.js scene setup, camera, lights
│   │   ├── model-loader.ts # Load wingsuit/canopy/skydiver/airplane models
│   │   ├── vectors.ts      # Force vector arrows (lift, drag, side, weight, net)
│   │   ├── moments.ts      # Torque vector visualization
│   │   ├── frames.ts       # Body frame vs inertial frame transforms
│   │   └── cp-marker.ts    # Center of pressure indicator on model
│   └── math/
│       ├── rotation.ts     # Alpha/beta rotation matrices, DCM
│       ├── wind.ts         # Wind vector from α, β, airspeed
│       └── forces.ts       # Coefficient → force conversion (CL,CD → Newtons)
├── models/                 # 3D model files (GLTF/OBJ)
│   ├── wingsuit.glb
│   ├── canopy.glb
│   ├── skydiver.glb
│   └── airplane.glb
├── test/
│   ├── kirchhoff.test.ts   # Unit tests for separation function
│   ├── coefficients.test.ts # Unit tests for full-range CL/CD/CM
│   ├── convert.test.ts      # Tests for WSEQPolar → ContinuousPolar conversion
│   └── flat-plate.test.ts   # Verify flat-plate behavior at extreme angles
└── README.md
```

### Key Design Principle

**The `src/polar/` directory contains the exact same TypeScript code that will eventually be copied/imported into CloudBASE.** The visualizer is a testbed — the polar math is the deliverable. Keep `src/polar/` free of any Three.js or UI dependencies.

---

## Workflow

1. **Select a polar** from the dropdown (e.g., "Corvid Two Wingsuit")
2. **Adjust α, β, δ** with sliders — 3D model and vectors update in real-time
3. **Observe**:
   - Force vectors change magnitude and direction
   - 2D plots update with the operating point
   - Coefficient readout shows exact numbers
   - Separation function f(α) shows how much flow is attached
4. **Explore edge cases**:
   - Crank α to +90° → broadside, see CL → 0, CD → max
   - Crank α to +150° → deployment zone, see reversed lift direction
   - Set α negative → back-flying, see inverted lift
   - Crank β to ±45° → sideslip, see lift reduction and side force
   - Sweep δ from -1 to +1 → see smooth morph between control configurations
5. **Compare**: Toggle between old (WSEQPolar table) and new (ContinuousPolar) to validate

---

## Future Integration Path

Once the continuous polar is validated in this visualizer:

1. **CloudBASE Simulation** — Copy `src/polar/` into CloudBASE's `util/`, wire into `generatew3d()` or successor
2. **Kalman Filtering** — Use continuous polar as the state-transition model for real-time flight state estimation from GPS/IMU/baro data
3. **Real-Time Data Analysis** — Live coefficient estimation from streaming sensor data
4. **VR** — Force visualization overlaid on immersive flight replay
5. **Polar Fitting** — Use the visualizer's charting to interactively validate fitted polars against GPS data
6. **Education** — Teach aerodynamics concepts with interactive force visualization

---

## Development Phases

### Phase 1: Polar Math + Basic Visualization
- Implement `ContinuousPolar` interface and full-range Kirchhoff model
- Basic Three.js scene with a simple box/placeholder model
- Sliders for α, β, δ
- Force vectors (lift, drag, weight)
- CL vs α and CD vs α plots
- Coefficient readout panel

### Phase 2: Full 3D Models + Moments
- Load real wingsuit/canopy/skydiver models
- Moment vectors (CM → pitching torque)
- CP marker on model
- Body frame vs inertial frame toggle
- Side force vector

### Phase 3: Polish + Comparison
- WSEQPolar import and side-by-side comparison
- All 2D plot types
- Model dropdown selector
- Export/save polar configurations
- URL-encoded state (shareable links)

### Phase 4: Advanced
- Animated sweep (auto-vary α to show full polar behavior)
- Multiple simultaneous polars overlaid
- Dark/light theme
- Responsive layout for different screen sizes
- Import polar data from CloudBASE API
