# GPS Flight Viewer

Post-flight analysis tool that overlays the full aerodynamic segment model onto real FlySight GPS data. Two synchronized 3D scenes — inertial frame and body frame — replay the flight with force vectors, moment arcs, and solved control inputs at every timestep.

## Overview

The GPS viewer bridges the gap between the theoretical aerodynamic model and real-world flight data. It takes raw GPS tracks (position, velocity, altitude at 5–20 Hz), runs them through a processing pipeline, and evaluates the segment model at each point to show what the aerodynamics were doing during the flight.

**Key capabilities:**
- Dual-scene replay: inertial frame (world-fixed camera) and body frame (pilot-fixed camera)
- Per-segment force vectors (lift, drag, side force) with CP-adjusted arrow origins
- Moment arcs (pitch, roll, yaw) from the segment model
- Control inversion solver — estimates pilot inputs from measured angular accelerations
- Head sensor fusion — quaternion overlay from FlySight fused IMU data
- Deployment sequence rendering with slerped transitions
- Keyframe camera editor for video production
- Automated PNG capture with full state serialization for Playwright

## Data Pipeline

### Input

The primary input is a FlySight 2 CSV (`TRACK.CSV`) containing GNSS fixes:
- Latitude, longitude, altitude (WGS84)
- North/east/down velocity components
- Timestamps at 5–20 Hz

Optional: fused sensor CSV (`SENSOR_fused_fusion.csv`) with IMU quaternions for head orientation overlay.

### Processing Stages

```
TRACK.CSV → parse → smooth → derive rates → decompose forces → match AOA → solve controls
```

1. **Parse & smooth.** Raw GPS positions and velocities are parsed and optionally smoothed to reduce GNSS noise.

2. **Derive body rates.** Roll rate (p), pitch rate (q), yaw rate (r) are computed from the attitude time series. Angular accelerations (ṗ, q̇, ṙ) are derived numerically for the control solver.

3. **Force decomposition.** At each point, the measured acceleration is decomposed into aerodynamic and gravitational components. The acceleration ratio yields observed CL and CD:

$$C_L = \frac{k_L \cdot g}{q / (m/S)} \qquad C_D = \frac{k_D \cdot g}{q / (m/S)}$$

where $k_L$ and $k_D$ are the lift and drag load factors from the acceleration decomposition.

4. **AOA matching.** The observed CL is matched against the segment model via binary search (`matchAOABinarySearch` in `wse.ts`). The search evaluates the full segment model at candidate α values until the predicted CL matches the observed CL within tolerance. Search range: −3° to 50° (covers full flight envelope including flare).

5. **Canopy state estimation.** For canopy flight phases, the estimator computes roll method (transversal vs coordinated turn), brake state, and blended roll transitions at deployment boundaries.

### Pipeline Output

Each processed point contains:
- Position and velocity in NED
- Derived angles: AOA, sideslip, flight path angle, heading
- Body rates and angular accelerations
- Observed CL, CD, L/D
- Matched AOA from segment model
- Solved control inputs (when control solver is enabled)

## Dual-Scene Architecture

The viewer renders two independent Three.js scenes side by side:

### Inertial Frame (GPSScene)
- Camera fixed in world space, flight path visible as a trail
- Vehicle model (wingsuit or canopy + pilot) positioned and oriented at each GPS point
- Force vectors rendered in world coordinates
- Useful for seeing the overall flight trajectory and how forces relate to the flight path

### Body Frame (BodyFrameScene)
- Camera fixed relative to the vehicle — the world rotates around the pilot
- Same force vectors and moment arcs, but in the pilot's reference frame
- Useful for seeing what the aerodynamics look like from the pilot's perspective
- Shows how CP positions, differential forces, and moments change with pilot input

Both scenes share the same data pipeline and update synchronously via the transport bar (play/pause/scrub).

## Aerodynamic Overlay

The `GPSAeroOverlay` evaluates the full segment model at each GPS point and renders:

### Force Arrows
Per-segment lift (blue), drag (red), and side force (cyan) arrows. Arrow origins are positioned at the segment's center of pressure, not the geometric center — this means arrows shift along the chord as CP moves with AOA and control inputs.

**CP positioning with solved controls:** When the control solver is active, a second evaluation pass (Pass 2b) re-evaluates the segment model with the solved control inputs. The CP from this controlled evaluation positions the arrows, showing where the forces actually act given the estimated pilot inputs. Segment state is snapshot/restored to prevent mutation between frames.

**Pilot body segments** (pitchOffset > 45°, i.e., hanging under canopy) are excluded from CP offset to prevent arrows rendering at knee level — they stay at the segment geometric center.

### Moment Arcs
Curved arrows at the CG showing pitch (red), yaw (green), and roll (purple) moments from the segment model. Separate arcs show measured body rates (angular velocity) for comparison.

### Last-Converged Fallback
When the control solver fails to converge (typically 1–2 frames during dynamic maneuvers), the arrow positions hold at the last converged CP rather than snapping back to neutral. This prevents visual jitter. The solver readout still shows the true convergence state.

## Control Inversion Solver

The control solver estimates what pilot inputs would produce the measured angular accelerations. It uses Newton-Raphson iteration on Euler's rotation equation:

$$\mathbf{M}_{required} = [I] \cdot \dot{\boldsymbol{\omega}}_{measured} + \boldsymbol{\omega} \times ([I] \cdot \boldsymbol{\omega})$$

The solver adjusts control inputs until the aerodynamic model's predicted moments match the required moments.

### Wingsuit Solver
3×3 Newton: pitchThrottle, rollThrottle, yawThrottle → roll, pitch, yaw moments. Controls clamped to ±1.0 to match the segment model's internal clamp. Roll gain of 2.0 gives the GPS solver more authority than the gamepad model (effective ±6° differential AOA per segment).

### Canopy Solver
4-input damped least-squares: brakeLeft, brakeRight, frontRiserLeft, frontRiserRight → 3 moment equations. Uses pseudo-inverse with L2 regularization (λ=0.1) to handle the underdetermined system, preferring minimum total input. All inputs clamped [0, 1].

### UI Toggle
The "Control Solver" checkbox (default: off) controls whether the solver runs. When off: no solver computation, arrows at neutral CP, solver readout hidden, moment inset hidden. When on: full solver, CP-adjusted arrows, readout with convergence status and solved control values.

## Head Sensor Overlay

When a fused sensor CSV is available, the viewer renders a head model (GLB) oriented by the IMU quaternion at each timestep.

### Quaternion Pipeline
The fused CSV provides scalar-first quaternions (qw, qx, qy, qz) in NWU body-to-earth frame. The pipeline:
1. Slerps between adjacent sensor samples for smooth interpolation
2. Applies a body-frame mount pitch correction (`MOUNT_PITCH_DEG = 10°`) via Hamilton product
3. Remaps NWU → Three.js: `(-qy, qz, -qx, qw)`

### Time Alignment
Auto-alignment uses the `gps_time` column in the fused CSV to compute an offset between sensor time and pipeline time: `offset = sensorT − pipelineT`. The GPS start index is detected from the first valid `gps_time` entry, with a fallback to `gps_lat > 1` when the column is absent.

### Race Condition Handling
Sensor data may arrive before the GLB model finishes loading. A `pendingSensorData` queue stores the data and applies it once the model is ready. The model loader checks `sensorData.length > 0` before setting initial visibility.

## Deployment Rendering

The viewer handles the wingsuit → canopy transition with phase-aware rendering:

### Phases
- **Freefall** — wingsuit model with wingsuit aero overlay
- **PC toss → line stretch** — deployment renderer with bridle/PC/lines segments, raw pipeline angles for orientation
- **Line stretch → full inflation** — canopy scaling up, unified slerp from frozen wingsuit quaternion to canopy hang quaternion
- **Full flight** — canopy model with canopy aero overlay

### Transition Smoothing
- Wingsuit quaternion frozen at PC toss (last clean pose before deployment forces distort pipeline angles)
- Smoothstep slerp over the full pcToss → lineStretch + 2s window
- Roll method blends from full transversal to coordinated turn over 2s after deployment end

## Keyframe Camera Editor

The `KeyframeEditor` supports per-scene camera keyframes for video production:
- Position (spherical interpolation for orbit-aware movement) + zoom (linear)
- Independent keyframes for inertial and body frame scenes
- Smoothstep easing between keyframes
- Save/load as JSON with GPS timestamps
- Capture range (start/end) for trimming output
- Timeline track UI with diamond markers below the transport bar

## Automated PNG Capture

The capture system serializes the complete viewer state into URL parameters for headless Playwright rendering:

### URL Parameters
| Parameter | Example | Description |
|-----------|---------|-------------|
| `track` | `07-29-25/TRACK.CSV` | GPS track file path |
| `sensor` | `07-29-25/SENSOR_fused_fusion.csv` | Fused sensor CSV path |
| `trim` | `10` | Trim offset value |
| `roll` | `blended` | Roll method |
| `overlays` | `0` | Display data overlays (0/1) |
| `solver` | `0` | Control solver enabled (0/1) |
| `axis` | `none` | Axis helper mode |
| `kf` | `1` | Keyframe mode enabled (0/1) |
| `keyframes` | `<base64>` | Full keyframe data as base64 JSON |

### Capture Flow
1. UI click → `buildCaptureSession()` reads all current state
2. `buildCaptureUrl()` constructs a self-configuring URL with all params
3. POST to `localhost:3333/capture-polar` with the URL and session data
4. Playwright navigates to the URL, waits for `window.__sessionReady = true`
5. Renders each frame as PNG via the `renderFrame` callback

### Sensor Auto-Detection
When a track path is provided via URL, the viewer tries to auto-detect the fused sensor CSV in the same folder, checking `SENSOR_fused_fusion.csv`, `fused.csv`, `sensor_fused.csv` in order. A HEAD request with content-type check guards against Vite's SPA fallback returning HTML for missing files.

## Roll Methods

The canopy estimator supports four roll methods:

| Method | Description |
|--------|-------------|
| `aero` | Pure aerodynamic roll from CL decomposition |
| `coordinated` | Coordinated turn — roll derived from turn rate and airspeed |
| `full` | Full transversal — roll from lateral acceleration only |
| `blended` | Phase-based: full transversal during deployment (ΔF_b=0), coordinated after full inflation, 2s smoothstep transition |

Default is `blended`, which gives accurate roll during deployment (when brakes are stowed and there's no differential brake force) and coordinated turn during normal canopy flight.

## Files

| File | Purpose |
|------|---------|
| `gps.html` | GPS viewer HTML shell and UI controls |
| `gps-main.ts` | Entry point — pipeline, UI wiring, URL auto-config |
| `gps-pipeline.ts` | CSV parsing, smoothing, rate derivation |
| `gps-scene.ts` | Inertial frame Three.js scene |
| `body-frame-scene.ts` | Body frame Three.js scene |
| `gps-aero-overlay.ts` | Per-segment force evaluation and arrow rendering |
| `control-solver.ts` | Wingsuit and canopy control inversion solvers |
| `canopy-estimator.ts` | Roll method, brake state, deployment transitions |
| `head-renderer.ts` | Head model quaternion rendering |
| `head-sensor.ts` | Fused sensor CSV parsing and time alignment |
| `deploy-detector.ts` | PC toss / line stretch / inflation detection |
| `gps-deploy-renderer.ts` | Deployment sequence 3D rendering |
| `keyframe-editor.ts` | Camera keyframe system |
| `capture-handler.ts` | PNG capture orchestration and URL builder |
| `capture-session.ts` | Session state type definitions |
| `moment-inset.ts` | Moment breakdown mini-viewer |
| `axis-helper.ts` | NED axis helper rendering |
| `wse.ts` | Wind state estimation, AOA binary search |
