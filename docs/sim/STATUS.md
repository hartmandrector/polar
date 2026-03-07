# Simulation Status — 2026-03-07

![Wingsuit sim flight with speed polar](../../polar-visualizer/docs/gifs/sim-hero-wingsuit.gif.gif)

## Working

- **SimRunner**: RK4 integration at 200Hz, Start/Stop UI, HUD overlay (speed, altitude, glide ratio)
- **Wingsuit 6-segment**: Flyable with gamepad. Pitch stable, full speed range ~55–115 mph. Roll throttle feels realistic — requires active piloting through turns.
- **Canopy 7-cell**: Flyable with gamepad. Riser and brake controls tuned with force vector tilt, CM trim shifts, and drag bumps. Acro-capable — exaggerated controls for testing. See [CANOPY-CONTROLS.md](CANOPY-CONTROLS.md).
- **3-DOF pilot–canopy coupling**: Implemented and rendering. Three distinct per-axis physics:
  - **Pitch**: Gravity-restoring pendulum — pilot swings freely at riser confluence. Drives `pilotPivot.rotation.x` on GLB model and `controls.pilotPitch` in aero segments.
  - **Lateral**: Stiff spring + critical damping (geometric harness deformation, not a pendulum). Gamepad: left stick X.
  - **Twist**: Sinusoidal restoring torque from line geometry, clamped at ±180°. Gamepad: right stick X.
- **Canopy riser mechanics**: Front risers: α decrease (6°) + nose-up tilt (−0.35 rad) + CM (−0.15). Rear risers: α increase (6°) + nose-up tilt (0.06 rad) + CM (+0.10). Force vector tilt (`cellPitchRad`) is the primary turn mechanism.
- **Canopy brake mechanics**: Parent cell derivatives (d_alpha_0=−16, d_cl_alpha=1.2), geometric cell pitch (0.14 rad), drag bump (0.12), center cell 50% coupling. Brake flaps with low stall angle (18°) for drag-plate behavior at full brake.
- **Vehicle-aware gamepad**: Auto-selects mapping from polar type. Wingsuit: right stick pitch/roll, triggers for yaw, left stick orbit camera. Canopy: triggers for brakes, left stick Y for risers, left stick X for weight shift, right stick X for twist recovery.
- **Sim control panel**: Full panel right of 3D viewport with SVG gamepad visualization. Stick circles with deflection-colored dots, trigger bars with fill, vehicle-aware labels, numeric axis values.
- **Force/moment vectors**: Render in real-time during sim. Vehicle-aware scaling (canopy 4× wingsuit). Rotational vectors properly scaled.
- **Speed polar enhancements**: Glide ratio reference lines (1:1–3:1 ± negative), velocity vector line, live sim velocity blue dot, acceleration white dot (10 mph/g scale).
- **Flight trail**: Fading blue line (400-point ring buffer) showing flight path in inertial frame. Hidden in body frame. Fixed-origin approach with line translation for performance.
- **Debug panel**: Per-segment polar overrides work during sim — enables live tuning while flying.

### Phase FSM & Scenarios

- **Phase state machine**: idle → freefall → deployment → canopy → landed. Color-coded phase box in HUD (cyan/yellow/green/gray). Phase timer, per-phase telemetry, auto-transitions.
- **Scenario system**: Two-dropdown selection (scenario + polar). Wingsuit BASE pre-selects wingsuit + canopy polars. Polar dropdown locked during running scenario.
- **Nested status display**: Scenario box → phase box with per-phase telemetry and gamepad visualization.

### Wingsuit Deployment (full chain working)

- **Pilot chute**: A button spawns PC rigid body at wingtip (0.9m body-right, 5 m/s throw). Tension-dependent drag CD 0.3→0.9 (continuous positive feedback). Stays in freefall phase.
- **10-segment bridle**: Sequential unstow at 8N tension threshold. 0.33m segments with per-segment drag. Pin release at 20N triggers remaining segments + canopy bag.
- **Canopy bag**: Bluff body drag (CD=1.0), 3-axis tumbling with pitch/roll ±90° clamp, free yaw (line twist seed). Spawns at pin release.
- **Suspension line**: 1.93m line from body to bag. Line stretch at 98% triggers state snapshot.
- **DeployRenderer**: 10 orange segment spheres, orange chain line, white suspension line, blue bag mesh, red PC tension ring. Inertial NED frame (not body-attached).
- **HUD telemetry**: PC distance, tension, CD, chain distance, bag orientation angles.

### Wingsuit → Canopy Transition

- **Line stretch snapshot**: Full body state (12 vars), PC position/velocity, canopy bag state, tension axis (body + inertial).
- **Canopy IC computation**: Heading from inertial tension axis (faces into wind), pitch from line angle, velocity rotated via full 3-2-1 DCM body→inertial→canopy body. Bag yaw → initial line twist.
- **Snatch damping**: Angular rates reduced 70% at line stretch.
- **GLB preloading**: Canopy model loads in background at scenario start. Instant swap at line stretch (no loading delay).
- **Deploy inflation**: Ramps 0.05 → 1.0 over 3s (ease-out curve). Initial brakes 30%.
- **FSM auto-transition**: Freefall → canopy phase at line stretch. Deploy visuals cleaned up. Controls switch to canopy mapping.

## Wired but Incomplete

- **Constraint modes**: Architecture designed ([CONSTRAINT-MODES.md](CONSTRAINT-MODES.md)) with per-phase presets planned but not implemented per-DOF. Currently all DOFs simulated with gamepad overlay.
- **Pilot aero torque**: `pilotSwingDampingTorque()` exists in eom.ts but effect is minimal. At speed, drag/lift on pilot body should pitch it slightly forward.
- **Brake flap double-scaling**: Both getCoeffs and renderer apply deploy chordScale/spanScale — double-scaled during deployment transitions.
- **Brake-to-cell coupling direction**: May be inverted at high brake (Kirchhoff post-stall at 58° effective α).
- **PC persistence into canopy flight**: PC should continue bouncing behind canopy with tension-drag interplay. Not yet wired post-transition.

## Planned

- **Deploy as simulated DOF**: Integrate deploy value from aero forces during canopy deployment (currently time-based ramp).
- **Slider rendering**: Position slider.glb along lines based on deploy value.
- **Camera transitions**: Per-phase zoom/tracking (zoom-out on deployment trigger).
- **Constraint mode presets**: Auto-switch per phase from CONSTRAINT-MODES.md.
- **Canopy CP/CM tuning**: Needs pitch stability work (cm_0, cm_alpha, cp_0, cp_alpha per cell).
- **Pilot coupling → canopy feedback**: Lateral weight shift → asymmetric riser loading → turn. Twist → reduced control authority.
- **Pivot junction slider**: Assembly trim angle control.
- **Pilot height slider**: Coupled GLB + aero scaling.
- **Output/export system**: Phases 1–5 from OUTPUT.md.
- **Line tension model**: Research phase (Slegers & Costello framework).

## Source Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/sim/sim-runner.ts` | ~320 | RK4 loop, gamepad reading, deploy orchestration, canopy handoff |
| `src/sim/sim-ui.ts` | ~720 | Control panel, HUD, phase FSM, scenario system, gamepad SVG |
| `src/sim/sim-gamepad.ts` | ~100 | Vehicle-aware gamepad axis/button reading |
| `src/sim/deploy-wingsuit.ts` | ~450 | WingsuitDeploySim: 10-segment tension chain, PC drag, bag physics |
| `src/sim/deploy-canopy.ts` | ~200 | Canopy IC computation + CanopyDeployManager inflation ramp |
| `src/sim/deploy-types.ts` | ~75 | Vec3, deploy phases, render state, line stretch snapshot |
| `src/viewer/deploy-render.ts` | ~250 | DeployRenderer: segment spheres, chain, bag, PC ring |
| `src/viewer/trail.ts` | ~100 | TrailRenderer: flight path ring buffer |
