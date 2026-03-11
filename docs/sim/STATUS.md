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
- **Weight shift**: ✅ Kirchhoff blending implemented. Differential force tilt + CM per cell. Reuses brakeSensitivity for spanwise weighting (center=0, inner=0.4, mid=0.7, outer=1.0). Constants: WEIGHT_SHIFT_PITCH_MAX_RAD=0.04, WEIGHT_SHIFT_CM=-0.02. About 1/10th of front riser effect. Inverse span scaling: collapsed span amplifies effect (10× at 5% deploy, 1× at full). Gamepad left stick X wired.

### Pilot-Canopy Coupling
- **Pitch pendulum**: Gravity-restoring swing at riser confluence (0.5m). Body-frame gravity vector tracking bypasses Euler singularity during deployment. Rendered as `pilotPivot.rotation.x`. **Cosmetic only** — does not feed back into canopy aero (feedback loop disabled to prevent oscillation).
- **Line twist (yaw)**: ✅ Sinusoidal restoring torque (20 N·m stiffness, underdamped). Rendered as `pilotPivot.rotation.y` — nested inside pitch so twist spins around the hanging axis. Static slider ±360°. Seeded from bag tumble at deployment. Gamepad right stick X for kick recovery (2 N·m input → ~6° wobble in normal flight, critical at 180° where restoring torque = 0). HUD: amber >10°, flashing red >90° with direction/rate/recovery indicator.
- **Lateral (weight shift)**: Reclassified as pure aero control (Kirchhoff blending). `pilotLateralEOM()` still exists but is wrong physics — needs removal/repurposing.

### Phase FSM & Scenarios
- **Phase state machine**: idle → freefall → deployment → canopy → landed. Color-coded HUD. Auto-transitions.
- **Deploy gamepad**: ✅ Limited controls during deployment — brakes stowed, risers 25% range, weight shift + twist recovery full. B button triggers unzip.
- **Unzip state machine**: ✅ B button → 1.5s linear ramp. Riser range 25%→100%, brake access 0%→100% during ramp. Full canopy controls at completion.
- **HUD**: ✅ Deploy phase shows brake stow status, limited controls label, flashing "PRESS B TO UNZIP". Unzip progress bar. Line twist warning with direction/rate/recovery. Normal canopy HUD shows risers/brakes/weight shift.
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
- **Deploy inflation**: ✅ Airspeed-dependent model. Snivel phase (0.6s linear ramp to 15%), then `dDeploy/dt = K * (V/V_ref)²` with soft cap above 1.5× V_ref. K=1.0, V_REF=25. Self-regulating: more area → more drag → V drops → inflation slows. Initial brakes 30% (stowed).
- **Slider rendering**: ✅ slider.glb loaded, horizontal orientation, descends from canopy attachment to above pilot head based on deploy fraction.
- **GLB preloading**: Canopy model loads at scenario start, instant swap at line stretch.

## Planned — Near Term

### Unzip Pilot Drag Morph
Unzip progress should morph pilot from wingsuit to slick drag profile via `unzip` segment parameter. Currently unzip only unlocks controls — aero morph not wired.

### Cleanup
- Remove or repurpose `pilotLateralEOM()` (models wrong physics for weight shift)
- Strip diagnostic console.log from eom.ts, sim.ts, deploy-canopy.ts

### Line Twist Torsional Coupling
Currently twist is only seeded from bag tumble. Real canopy turns apply torsional input to pilot through the lines — need coupling from canopy yaw rate into twist EOM.

## Planned — Future

- **Exit phase**: Standing start, push-off, proximity terrain
- **Landing phase**: Flare detection, ground contact, quality score
- **Deploy as simulated DOF**: Integrate deploy from aero forces (currently airspeed-driven ramp)
- **Spiral line rendering**: Visual twist of suspension lines during line twist (cosmetic)
- **Camera transitions**: Per-phase zoom/tracking
- **Canopy CP/CM tuning**: Pitch stability work per cell
- **Pivot junction slider**: Assembly trim angle control
- **Output/export system**: From OUTPUT.md
- **Line tension model**: Research phase (Slegers & Costello framework)

## Source Files

| File | Purpose |
|------|---------|
| `src/sim/sim-runner.ts` | RK4 loop, gamepad, deploy orchestration, canopy handoff, unzip state |
| `src/sim/sim-ui.ts` | Control panel, HUD, phase FSM, scenario system, gamepad SVG |
| `src/sim/sim-gamepad.ts` | Vehicle-aware gamepad: wingsuit, canopy, deploy (limited) |
| `src/sim/deploy-wingsuit.ts` | 10-segment tension chain, PC drag, bag physics |
| `src/sim/deploy-canopy.ts` | Canopy IC computation + airspeed inflation + unzip state machine |
| `src/sim/deploy-types.ts` | Vec3, deploy phases, render state, snapshot |
| `src/viewer/deploy-render.ts` | Deploy segment spheres, chain, bag, PC ring |
| `src/viewer/trail.ts` | Flight path ring buffer |
| `src/polar/eom.ts` | Pendulum, lateral, twist EOM + aero damping |
| `src/polar/sim.ts` | computeDerivatives, forwardEuler, rk4Step |
| `src/polar/sim-state.ts` | SimState, SimStateExtended (18 states + gravity vector) |
| `src/polar/segment-factories.ts` | Kirchhoff blending: brakes, risers, weight shift |
