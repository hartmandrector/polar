# Simulation Status — 2026-03-11

## Working

### Core Flight
- **SimRunner**: RK4 integration at 200Hz, Start/Stop UI, HUD overlay (speed, altitude, glide ratio, phase timer)
- **Wingsuit 6-segment**: Flyable with gamepad. Pitch stable, full speed range ~55–115 mph. Roll throttle feels realistic.
- **Canopy 7-cell**: Flyable with gamepad. Riser and brake controls tuned with force vector tilt, CM trim shifts, and drag bumps. Acro-capable.
- **Vehicle-aware gamepad**: Auto-selects mapping from polar type. Wingsuit: right stick pitch/roll, triggers yaw. Canopy: triggers brakes, sticks risers/weight shift/twist.
- **Force/moment vectors**: Real-time rendering during sim. Vehicle-aware scaling.
- **Speed polar**: Glide ratio lines, velocity vector, live sim dot, acceleration dot.
- **Flight trail**: Fading blue line (400-point ring buffer) in inertial frame.
- **Debug panel**: Per-segment polar overrides during sim for live tuning.
- **Sim control panel**: SVG gamepad visualization with deflection-colored dots, trigger bars, vehicle-aware labels.

### Canopy Controls
- **Front risers**: α decrease (6°) + nose-up tilt (−0.35 rad) + CM (−0.15). Primary turn via drag asymmetry.
- **Rear risers**: α increase (6°) + nose-up tilt (0.06 rad) + CM (+0.10). Primary flare via AoA shift.
- **Brakes**: Full Kirchhoff δ derivatives, geometric cell pitch (0.14 rad), drag bump (0.12), center cell 50% coupling. Low stall angle (18°) brake flaps for drag-plate behavior.
- **Weight shift**: Slider and gamepad input exist, `SegmentControls.weightShiftLR` field wired, but **no segment responds yet**. Needs Kirchhoff blending (same pattern as brakes/risers). See [CANOPY-CONTROLS.md](CANOPY-CONTROLS.md).

### Pilot-Canopy Coupling
- **Pitch pendulum**: Gravity-restoring swing at riser confluence (0.5m). Body-frame gravity vector tracking bypasses Euler singularity during deployment. Rendered as `pilotPivot.rotation.x`. **Cosmetic only** — does not feed back into canopy aero (feedback loop disabled to prevent oscillation).
- **Line twist (yaw)**: Sinusoidal restoring torque from line geometry, clamped ±180°. Gamepad right stick X for recovery torque. Seeded from bag tumble at deployment. **Not yet rendered** in 3D — needs pilot yaw rotation + line spiral visualization + static slider.
- **Lateral (weight shift)**: `pilotLateralEOM()` exists with stiff spring model, but this is **wrong physics** — weight shift is a pure aero control (Kirchhoff blending), not a mass/inertial rotation. Needs reclassification. See [WINGSUIT-BASE-FLOW.md](WINGSUIT-BASE-FLOW.md) §Pilot-Canopy Control Inputs.

### Phase FSM & Scenarios
- **Phase state machine**: idle → freefall → canopy → landed. Color-coded HUD. Auto-transitions.
- **Scenario system**: Two-dropdown (scenario + polar). Wingsuit BASE pre-selects wingsuit + canopy polars.

### Wingsuit Deployment (full chain)
- **Pilot chute**: A button spawns PC at wingtip. Tension-dependent drag CD 0.3→0.9.
- **10-segment bridle**: Sequential unstow at 8N, pin release at 20N.
- **Canopy bag**: Bluff body drag, 3-axis tumbling, free yaw (line twist seed).
- **Suspension line**: 1.93m, line stretch at 98%.
- **DeployRenderer**: Segment spheres, chain lines, bag mesh, PC tension ring.

### Wingsuit → Canopy Transition
- **Canopy IC**: Heading from tension axis, pitch from line angle, velocity via DCM. Bag yaw → line twist.
- **Gravity vector**: Body-frame gravity unit vector (gx, gy, gz) tracked as auxiliary state for pendulum. Avoids Euler singularity corruption during steep-climb deployment. Used ONLY for pendulum — canopy translational EOM uses standard `gravityBody(phi, theta)`.
- **Deploy inflation**: S-curve 0.05 → 1.0 over 3s. Initial brakes 30%.
- **GLB preloading**: Canopy model loads at scenario start, instant swap at line stretch.

## Planned — Near Term

### Weight Shift Kirchhoff (next)
Weight shift is a pure aero control, same category as brakes/risers. Pilot shifts hips → changes riser loading → warps canopy. No mass/CG change. Needs:
- Canopy segments to respond to `weightShiftLR` via Kirchhoff blending
- Remove or repurpose `pilotLateralEOM()` (models wrong physics)
- Verify polar curve response with existing slider

### Line Twist Visualization
Physical pilot yaw rotation needs rendering:
- Add line-twist slider for static mode tuning
- Render `pilotYaw` as pilot model rotation
- Line twist spiral visualization (optional)

### Deploy Gamepad + Unzip
Brakes stowed during deployment, risers limited to 25%. B button triggers 1.5s unzip → full controls. See [WINGSUIT-BASE-FLOW.md](WINGSUIT-BASE-FLOW.md).

## Planned — Future

- **Exit phase**: Standing start, push-off, proximity terrain
- **Landing phase**: Flare detection, ground contact, quality score
- **Deploy as simulated DOF**: Integrate deploy from aero forces (currently time-based ramp)
- **Slider rendering**: Position slider.glb along lines based on deploy value
- **Camera transitions**: Per-phase zoom/tracking
- **Canopy CP/CM tuning**: Pitch stability work per cell
- **Pivot junction slider**: Assembly trim angle control
- **Output/export system**: From OUTPUT.md
- **Line tension model**: Research phase (Slegers & Costello framework)

## Source Files

| File | Purpose |
|------|---------|
| `src/sim/sim-runner.ts` | RK4 loop, gamepad, deploy orchestration, canopy handoff |
| `src/sim/sim-ui.ts` | Control panel, HUD, phase FSM, scenario system, gamepad SVG |
| `src/sim/sim-gamepad.ts` | Vehicle-aware gamepad reading |
| `src/sim/deploy-wingsuit.ts` | 10-segment tension chain, PC drag, bag physics |
| `src/sim/deploy-canopy.ts` | Canopy IC computation + inflation ramp |
| `src/sim/deploy-types.ts` | Vec3, deploy phases, render state, snapshot |
| `src/viewer/deploy-render.ts` | Deploy segment spheres, chain, bag, PC ring |
| `src/viewer/trail.ts` | Flight path ring buffer |
| `src/polar/eom.ts` | Pendulum, lateral, twist EOM + aero damping |
| `src/polar/sim.ts` | computeDerivatives, forwardEuler, rk4Step |
| `src/polar/sim-state.ts` | SimState, SimStateExtended (18 states + gravity vector) |
