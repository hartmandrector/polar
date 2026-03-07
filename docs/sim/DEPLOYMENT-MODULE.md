# Deployment Module — State Handoff Design

The deployment phase is two sub-phases bridging freefall and canopy flight. Each sub-phase is responsible for computing initial conditions for the next state.

## State Chain

```
FREEFALL ──[A button]──→ FREEFALL (+ PC sub-sim running) ──[line stretch]──  →CANOPY_FLIGHT (+ CP_DEPLOYMENT sub-sim running)
```

**A button does NOT change the FSM phase.** We stay in freefall — same controls, same UI, same aero model. A button spawns the PC rigid body and starts a deployment sub-simulation running alongside freefall. The pilot is still flying the wingsuit with full control.

**Line stretch is the real state transition.** Everything changes at once: polar swap, coupling activation, constraint modes, gamepad mapping, camera.

## Tension Chain Geometry

The deployment system is one continuous tension chain routed through the pilot's body:

```
Pilot hips (harness attach)
  → 4 Riser groups (front-L, front-R, rear-L, rear-R)
    → through Slider grommets (4 corners)
      → Suspension lines (A/B/C/D per group)
        → Canopy attachment points (loaded ribs)
          → Bridle attachment
            → Bridle line (3.3m)
              → Pilot chute
```

During freefall+PC the chain is slack. At line stretch the chain goes taut and every angle in this geometry becomes aerodynamically relevant.

**Weight shift steers the deployment** — the pilot's hip position (from lateral weight shift) determines which riser group goes taut first, biasing the canopy's initial turn. This is why skydivers spread risers and stay symmetric during opening.

## PC Sub-Simulation (runs during freefall)

### Spawned by A Button

A button press captures the body state and creates a PC rigid body:
- **Initial position**: container_back attachment point (from model-registry)
- **Initial velocity**: body velocity + throw vector (~3 m/s body-right, CloudBASE reference)
- **Drag model**: small unopened area initially, full PC area (0.73 m²) after bridle pays out
- **Constraint**: PC-to-body distance ≤ segment chain length. Euler integrate + clamp each timestep.

Wingsuit continues under full pilot control. The PC is a parasitic drag body trailing behind.

### What the Sub-Sim Tracks

Not just PC distance — the full chain routing in body frame:
1. **PC position and velocity** (NED + body-relative)
2. **4 line group angles** — from pilot hip position through slider to canopy attach points
3. **Pilot hip position in body frame** — from weight shift state (lateral shift moves the harness attach)
4. **Bridle segment visibility** — sequential reveal as distance increases (segment N at N × 0.33m)
5. **Chain geometry snapshot** — continuously updated, frozen at line stretch

### Line Stretch Event

When total chain distance reaches `pilottoattachmentpoint` (5.23m), the chain goes taut.

**Snapshot everything in body frame:**
1. **Wingsuit body state** — position, velocity, orientation, rates (all 18 state variables)
2. **PC position and velocity** — constrained at full extension
3. **Tension axis** — vector from pilot hips to PC (through the chain)
4. **4-riser tension distribution** — from hip position + weight shift, which risers are loaded
5. **Line twist** — body yaw relative to tension axis (δ_ψ)
6. **Relative velocity** — body vs PC (snatch force energy)
7. **Deployment α and beta** — angle between airflow and tension axis
8. **Weight shift state** — lateral offset at line stretch determines initial riser asymmetry

Camera zoom-out triggers here. FSM transitions to CP_DEPLOYMENT.

## Uninflated Canopy Rigid Body

When bridle pays out fully (PC distance > bridle length), the canopy bag is pulled from the container. This spawns a second rigid body alongside the PC.

### Physics Model

Bluff body drag on a tumbling object:
- **CD ≈ 1.0–1.2**, area from snivel.glb bounding box
- **One tension constraint**: bridle attachment point (same pattern as PC constraint)
- **Euler integration**: position + orientation (quaternion)
- **Weathervaning**: drag naturally damps the bag toward trailing behind the bridle

The 4 line attachment points exist on the canopy but are **not under tension** during this phase. The canopy is just being dragged by the bridle. The line routing geometry is tracked but passive — no forces through the lines until line stretch.

### Axis-Specific Rotation Constraints

The canopy can tumble, but the line geometry imposes hard stops on two axes:

| Axis | Constraint | Reason |
|------|-----------|--------|
| **Pitch** (nose up/down relative to bridle) | ±90° hard stop | Lines can't wrap over the top of the canopy — they go taut and physically stop the rotation |
| **Roll** (lateral tilt) | ±90° hard stop | Riser spread at pilot's hips prevents the canopy from rolling past 90° — same mechanism, lines on one side go taut |
| **Yaw** (heading / line twist axis) | **Unconstrained** | Lines CAN wrap around this axis. Any yaw accumulated during deployment = initial line twist (δ_ψ) at line stretch |

So the canopy is a pendulum that can swing ±90° in pitch and roll but spin freely in yaw. The yaw freedom is what creates line twists in real deployments — asymmetric packing, body position, airflow turbulence all seed yaw rotation.

### What This Captures

- **α at line stretch**: computed from actual canopy orientation vs airflow, not assumed from trim geometry
- **β at line stretch**: falls out naturally from sideslip / lateral throw component / body yaw
- **Initial line twist (δ_ψ)**: accumulated yaw rotation during deployment. Maps directly into the pilot coupling sinusoidal restoring torque model at line stretch.
- **Realistic deployment variability**: small differences in body attitude, airspeed, throw mechanics → different opening characteristics. Same as real life.

### Two-Body Deployment Sub-Sim Summary

During freefall after A button, SimRunner integrates two extra rigid bodies:
1. **PC**: drag + distance constraint to body. Spawns at A button.
2. **Canopy bag**: drag + distance constraint to PC/bridle endpoint + rotation limits. Spawns when bridle extends fully.

Both are parasitic — they add drag to the system but don't change the wingsuit's control model. The pilot keeps flying.

At line stretch, both bodies' states (position, velocity, orientation) are frozen into the snapshot that initializes CP_DEPLOYMENT.

---

## CP_DEPLOYMENT Entry: From Line Stretch

Receives the full state snapshot from the deployment sub-sim. Now we set up the canopy two-body system:

**Canopy initial conditions (computed from line stretch geometry):**
- **Position**: canopy bag position at line stretch
- **Orientation**: from canopy bag rigid body orientation (actual tumbling result, not assumed)
- **α**: from canopy bag orientation vs airflow — computed, not assumed from trim
- **β**: from canopy bag sideslip — computed, captures lateral asymmetry
- **Pitching moment**: exists immediately — even a ball of fabric has CP offset from CG
- **Deploy value**: small nonzero (0.05–0.15) — canopy is starting to catch air at line stretch

**Pilot coupling initial conditions (Slegers & Costello):**
- **Pitch pendulum angle (θ_pilot)**: wingsuit body pitch at line stretch relative to the tension axis
- **Pitch rate (θ̇_pilot)**: from wingsuit pitch rate (q) — momentum carries through
- **Lateral shift**: from wingsuit roll/sideslip + weight shift at line stretch
- **Line twist (δ_ψ)**: canopy bag accumulated yaw during deployment (unconstrained axis)
- **Pivot junction**: riser convergence point — from line geometry at line stretch

**Constraint mode transitions:**
- Wingsuit throttles → **locked** (arms/legs no longer control surfaces)
- Deploy slider → **simulated** (physics-driven inflation)
- Pilot pitch pendulum → **simulated** (gravity-restoring, was rigid during freefall)
- Canopy risers/brakes → **inactive** until slider clears (hands on risers but not controlling yet)

### Physics During This Sub-Phase

Slider descends the lines driven by canopy inflation pressure vs slider drag:
- `deploy` value increases from initial (~0.1) toward 1.0
- Canopy area scales with deploy → increasing drag → deceleration
- Slider position = inverse of deploy (top of lines at deploy=0, risers at deploy=1)
- AoA transitions: starts near vertical (~180°), pitches forward through surge to trim (~110°)

Pilot pendulum swings freely under the inflating canopy. This is where Slegers & Costello two-body dynamics are live — the pilot mass is a pendulum beneath the canopy, coupled through the line set.

### Exit: Canopy Flying

When deploy ≈ 1.0 and slider reaches risers:
- **Canopy state**: position, velocity, orientation, rates — continuous from deployment physics
- **Pilot coupling state**: pendulum angles and rates — continuous
- **Constraint modes**: risers/brakes activate, deploy locks at 1.0
- **Gamepad mapping**: switches to canopy layout (triggers=brakes, sticks=risers)

## SimRunner Integration

The SimRunner already reads `SimConfig` each frame via callback. The handoff works by:

1. **Capturing state snapshot** at transition moment (all 18 state variables + coupling state)
2. **Switching the polar** (wingsuit → canopy) via dropdown change event
3. **Injecting initial conditions** into SimRunner state from the snapshot
4. **Activating coupling** by returning `PilotCouplingConfig` from `buildPilotCoupling()`

The deploy slider value feeds into `SimConfig` and drives both the aero model (canopy area/coefficients scale with deploy) and the rendering (mesh morph, slider position, segment visibility).

### What SimRunner Needs Added

- **PC rigid body state** — secondary position/velocity integrated alongside main body during WS_DEPLOYMENT
- **Deploy state enum** — drives which physics model is active
- **State injection** — ability to set `simState` from external snapshot (for handoffs)
- **Deploy integration** — `deploy` as a simulated DOF, not just a slider value

## Camera

| Phase | Camera |
|-------|--------|
| Freefall | Close orbit (current) |
| WS_DEPLOYMENT | Zoom out to show PC trailing — smooth transition over ~1s |
| Line stretch | Wide shot — show full bridle + canopy bag |
| CP_DEPLOYMENT | Track from behind/above — show canopy inflation |
| Canopy flight | Standard canopy orbit (existing) |

## Build Sequence

1. ✅ **PC rigid body in SimRunner** — `deploy-wingsuit.ts`. Tension-dependent drag (CD 0.3→0.9), wingtip release, distance constraint. `DeployRenderer` renders PC ring + chain.
2. ✅ **Canopy bag rigid body** — bluff body drag (CD=1.0), 3-axis rotation with ±90° pitch/roll clamp, free yaw (line twist seed). Spawns at pin release. Rendered as blue box.
3. ✅ **Bridle rendering** — 10-segment chain with orange spheres + line. Sequential unstow at 8N threshold. Pin release at 20N.
4. ✅ **Line stretch detection** — suspension line distance threshold (1.93m × 0.98) → full state snapshot frozen with body state, bag state, tension axis (body + inertial).
5. ✅ **IC computation at line stretch** — `deploy-canopy.ts`. Heading from inertial tension axis. Velocity via full 3-2-1 DCM transform. Bag yaw → pilotYaw. Snatch damping 70%.
6. ✅ **State injection for canopy** — SimRunner injects canopy SimState, switches modelType + polarKey, activates CanopyDeployManager. GLB preloaded at scenario start for instant swap.
7. ⬜ **Deploy as simulated DOF** — integrate deploy value from aero forces during CP_DEPLOYMENT. Currently time-based ramp (3s ease-out).
8. ⬜ **Slider rendering** — position slider.glb along lines based on deploy value.
9. ⬜ **Camera transitions** — per-phase zoom/tracking.
10. ⬜ **Constraint mode presets** — auto-switch per phase (from CONSTRAINT-MODES.md).
