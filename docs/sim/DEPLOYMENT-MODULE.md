# Deployment Module — State Handoff Design

The deployment phase is two sub-phases bridging freefall and canopy flight. Each sub-phase is responsible for computing initial conditions for the next state.

## State Chain

```
FREEFALL → [A button] → WS_DEPLOYMENT → [line stretch] → CP_DEPLOYMENT → [slider down] → CANOPY_FLIGHT
```

Each arrow is a handoff: the exiting state computes everything the entering state needs.

## Sub-Phase 1: Wingsuit Deployment (PC Toss → Line Stretch)

### Entry: From Freefall

Freefall state captures at the moment of A button press:
- **Body state**: position (NED), velocity (u,v,w), Euler angles (φ,θ,ψ), angular rates (p,q,r)
- **Airspeed vector**: for PC throw direction
- **Altitude AGL**: for scenario telemetry

These become the initial conditions for the PC rigid body.

### Physics During This Sub-Phase

PC toss creates a new rigid body:
- **Initial position**: container_back attachment point (from model-registry)
- **Initial velocity**: body velocity + throw vector (body-right component, ~3 m/s from CloudBASE)
- **Drag model**: starts with small unopened area (upcr=0.035m), transitions to full PC area (0.73 m²) as bridle pays out
- **Constraint**: PC-to-body distance ≤ bridle length (3.3m). Euler integrate + clamp each timestep.

Wingsuit continues flying under pilot control during this sub-phase. The PC is a parasitic drag body trailing behind.

Bridle segments deploy sequentially — each segment becomes visible as the PC-to-body distance passes its threshold (segment N visible when distance > N × 0.33m).

### Exit: Line Stretch Event

When PC-to-body distance reaches `pilottoattachmentpoint` (5.23m):

**Compute and pass forward:**
1. **Wingsuit body state at line stretch** — position, velocity, orientation, rates
2. **PC position and velocity** — now constrained at full extension
3. **Snatch force direction** — vector from body to PC (this is the bridle tension axis)
4. **Relative velocity** — difference between body velocity and PC velocity (energy absorbed by snatch)
5. **Deployment α estimate** — angle between body velocity vector and bridle tension axis ≈ initial canopy AoA

Camera zoom-out triggers here.

## Sub-Phase 2: Canopy Deployment (Line Stretch → Flying)

### Entry: From Line Stretch

Receives the full state from sub-phase 1. Now we set up the canopy system:

**Canopy initial conditions (from line stretch geometry):**
- **Position**: at the snivel/bag location (PC position minus bridle offset back toward body)
- **Orientation**: aligned with bridle tension axis (fabric is pulled taut along this vector)
- **AoA**: derived from angle between airflow and canopy chord — starts high (~90° + body pitch, near vertical)
- **Pitching moment**: exists immediately — even a ball of fabric has a center of pressure offset from CG
- **Deploy value**: small nonzero (0.05–0.15) — canopy is starting to catch air at line stretch

**Pilot coupling initial conditions (Slegers & Costello):**
- **Pitch pendulum angle (θ_pilot)**: derived from wingsuit body pitch at line stretch relative to the bridle tension axis. The pilot is swinging under the newly-taut lines.
- **Pitch rate (θ̇_pilot)**: derived from wingsuit pitch rate (q) at line stretch — momentum carries through
- **Lateral shift**: from wingsuit roll/sideslip at line stretch
- **Line twist (δ_ψ)**: from wingsuit yaw relative to bridle axis — if the body was yawed at line stretch, that's twist in the lines
- **Pivot junction**: riser convergence point — physically determined by line geometry at line stretch

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

1. **PC rigid body in SimRunner** — position, velocity, drag, constraint. Render with existing pc.glb.
2. **Bridle segment visibility** — sequential reveal as distance increases.
3. **Line stretch detection** — distance threshold → state snapshot → transition event.
4. **State injection for canopy** — set simState from freefall snapshot, activate coupling.
5. **Initial condition computation** — α, θ_pilot, δ_ψ from geometry at line stretch.
6. **Deploy as simulated DOF** — integrate deploy value from aero forces.
7. **Slider rendering** — position slider.glb along lines based on deploy value.
8. **Camera transitions** — per-phase zoom/tracking.
9. **Constraint mode presets** — auto-switch per phase (from CONSTRAINT-MODES.md).
