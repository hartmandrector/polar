# Simulation Phase Architecture

Continuous 6DOF simulation across flight phases — from launch through landing.

**Status**: Phase FSM, scenario system, deployment sub-sim, and wingsuit→canopy transition all implemented and working. See [STATUS.md](STATUS.md) for current state.

## Phases

```
idle → freefall → [PC toss → bridle → pin release → canopy bag → line stretch] → canopy → landed
```

Each phase owns: active aero segments, control mapping, transition conditions, visible GLB models.

## Phase Definitions

| Phase | Vehicle | Controls | Entry Condition | Exit Condition | Status |
|-------|---------|----------|-----------------|----------------|--------|
| **idle** | Selected model | Sliders | Scenario start | Start button | ✅ |
| **freefall** | Wingsuit 6-segment | Pitch/roll/yaw sticks | Start button | Line stretch (auto) | ✅ |
| **canopy** | 7-cell canopy + pilot | Risers/brakes/weight shift | Line stretch | Altitude ≈ 0 or stop | ✅ |
| **landed** | Static model | None | Ground contact | Scenario reset | ⬜ |

Note: prelaunch and deployment were originally separate phases but are now handled as sub-states within freefall (PC sub-sim runs alongside wingsuit physics, transition is automatic at line stretch).

## Deployment Sequence (aero-driven)

See [DEPLOYMENT-MECHANICS.md](DEPLOYMENT-MECHANICS.md) for the full deployment model — bridle segments, slider, 4-line-group abstraction, and visualization plan.

The deployment phase is NOT a timer — each step is driven by aerodynamics:

1. **Pilot chute throw** — initial position + velocity from hand throw. Drag model takes over.
2. **Bridle extraction** — pilot chute drag creates tension → pulls bridle segments out. Per-segment drag + tension propagation.
3. **Canopy bag extraction** — bridle tension exceeds threshold → canopy bag leaves container.
4. **Line stretch** — suspension lines deploy to full length. Snatch force spike.
5. **Canopy inflation** — slider controls opening rate. Existing `deploy` slider morphs geometry + aero.

Each step maps to a sub-state within the deployment phase. The existing deployment sliders (`pilotChuteDeploy`, `deploy`) provide debug override for any sub-state.

## Implementation Status

### Pilot Chute ✅
Implemented in `deploy-wingsuit.ts`. Tension-dependent drag (CD 0.3→0.9 continuous), wingtip release (0.9m body-right, 5 m/s throw), distance constraint with position clamp + velocity projection.

### Bridle ✅
10-segment chain (0.33m each) with per-segment drag, sequential unstow at 8N tension threshold. Pin release at 20N frees remaining segments and spawns canopy bag.

### Canopy Bag ✅
Bluff body drag (CD=1.0), 3-axis tumbling with pitch/roll ±90° clamp and free yaw (line twist seed). Suspension line (1.93m) with line stretch detection at 98%.

### Canopy Handoff ✅
`deploy-canopy.ts`: IC computation from line stretch snapshot — heading from inertial tension axis, velocity via DCM transform, bag yaw → pilot coupling twist. Deploy ramps 0.05→1.0 over 3s. GLB preloaded for instant transition.

### Phase Controller (FSM) ✅
Module-level state machine in `sim-ui.ts`: `currentPhase`, `phaseStartTime`, auto-transitions. Color-coded phase box (cyan=freefall, green=canopy). Scenario system with two-dropdown selection.

## Operating Modes

### Debug Mode (current)
- Manual slider control over all parameters
- Freeze sim, adjust, resume
- Isolate individual components (single cell, single segment)
- Phase can be set manually (jump straight to canopy)

### Continuous Mode (new)
- Full phase progression driven by physics
- Gamepad triggers phase transitions (button = throw pilot chute)
- Deployment timing emerges from aerodynamics
- Debug sliders become read-only telemetry (or manual override if toggled)

Both modes use identical physics. Debug mode overrides what continuous mode computes.

## Scenarios (extensibility)

A scenario is data — initial conditions + phase sequence + vehicle assembly:

```typescript
interface Scenario {
  name: string                    // 'BASE jump', 'Skydive', 'Paraglider launch'
  phases: string[]                // ['prelaunch', 'freefall', 'deployment', 'canopy', 'landed']
  vehicle: VehicleAssembly        // which models + segments
  initialConditions: SimState     // altitude, airspeed, attitude
  initialPhase: string            // starting phase
}
```

Example scenarios:
- **BASE wingsuit**: prelaunch (cliff) → freefall (wingsuit) → deployment → canopy → landed
- **Skydive belly**: prelaunch (airplane) → freefall (slick) → deployment → canopy → landed
- **Paraglider**: prelaunch (running) → canopy → landed (no deployment phase)
- **Debug canopy**: canopy only, manual sliders, no phase transitions

## Existing Code Reuse

| What we have | How it fits |
|-------------|-------------|
| Wingsuit SimRunner + gamepad | Freefall phase controller |
| Canopy SimRunner + gamepad | Canopy phase controller |
| `deploy` slider + geometry morphing | Deployment sub-state visualization |
| `pilotChuteDeploy` slider | Pilot chute sub-state debug control |
| Parasitic segments (bridle, pilot chute) | Constant-drag models during canopy phase |
| `LineSetGLB` registry data | Bridle segment geometry |
| Pilot coupling (3-DOF) | Active during canopy phase |
| Trail renderer | Continuous across all phases |

## Build Order

1. ✅ **Phase FSM shell** — state machine in sim-ui.ts, scenario-driven phase control
2. ✅ **FSM status panel** — nested scenario/phase display with per-phase telemetry
3. ✅ **Remove LB/RB vehicle cycling** — replaced with scenario/phase selection in UI
4. ✅ **Pilot chute rigid body** — position/velocity/drag, throw from hand, trajectory rendering
5. ✅ **Bridle tension chain** — 10-segment extraction driven by pilot chute drag
6. ✅ **Vehicle assembly swap** — wingsuit GLB → canopy GLB transition with preloading
7. ⬜ **Deployment timing from aero** — connect aero forces → inflation rate (currently time-based)
8. ⬜ **Continuous mode toggle** — switch between debug (manual sliders) and continuous (aero-driven)
9. ⬜ **Scenario system expansion** — additional scenarios (skydive, paraglider, debug canopy)

## UI: Phase Control & Status Panel

**Remove LB/RB gamepad vehicle cycling.** It's dangerous with a running sim (can crash on unbuilt vehicles like airplane/slick) and opaque about what's happening. Vehicle/phase selection belongs in the UI where it's explicit and safe.

### Gamepad Events vs FSM State

The gamepad triggers **events**, not state changes. The FSM transitions based on **physics**.

| Button | Event | FSM Effect |
|--------|-------|------------|
| **Start** (9) | Start/stop scenario | Launches current scenario or halts sim (existing behavior) |
| **A** (0) | Pilot chute toss | Spawns pilot chute body with throw velocity. FSM stays in freefall until line stretch detected by physics. |

The A button doesn't force a phase transition — it injects a physical object into the sim. The deployment phase begins when the bridle reaches full extension and canopy bag extraction starts. This is an aero-driven transition, not a button-driven one.

Other buttons (X, Y, B) reserved for scenario-context actions (cutaway, mode selection, etc.) — to be defined per scenario as needed.

### Nested Status Display

The sim panel expands into a nested visualization — outer scenario wrapping phase wrapping sub-state:

```
┌─ Scenario: BASE Wingsuit ──────────────────────┐
│  Exit: 800m AGL  │  Δh: -342m  │  Δd: 1.2 km  │
│                                                  │
│  ┌─ Phase: Freefall ─────────────────────────┐  │
│  │  t: 14.2s  │  V: 52 m/s  │  α: 38°       │  │
│  │                                            │  │
│  │  ┌─ Gamepad ───────────┐  Segments: 6     │  │
│  │  │  [SVG stick/trigger │  Next: PC toss   │  │
│  │  │   visualization]    │  (A button)      │  │
│  │  │  pitch/roll/yaw     │                  │  │
│  │  └─────────────────────┘                  │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Alt: 458m AGL  │  Trail: 287 pts               │
└──────────────────────────────────────────────────┘
```

During deployment, the inner box expands to show sub-states:

```
┌─ Phase: Deployment ──────────────────────────┐
│  ┌─ Sub: canopy inflation ────────────────┐  │
│  │  deploy: 0.43  │  snatch: 2.1g         │  │
│  │  pilot chute: stable  │  bridle: taut  │  │
│  └────────────────────────────────────────┘  │
│  Elapsed: 3.2s  │  Opening: 43%              │
└──────────────────────────────────────────────┘
```

During canopy flight with a malfunction:

```
┌─ Phase: Canopy ──────────────────────────────┐
│  ⚠ LINE TWIST: 270° right                    │
│  Recovery: spread risers + kick left 
|  (right stick -> left)                      │
│                                               │
│  ┌─ Gamepad ───────────┐  GR: 2.8  V: 14   │
│  │  [SVG stick/trigger │  Brakes: L42% R0%  │
│  │   visualization]    │  Twist rate: -15°/s│
│  │  risers/brakes/wt   │                    │
│  └─────────────────────┘                    │
│  Next: cutaway (X) or ride it out            │
└──────────────────────────────────────────────┘
```

The gamepad visualization (existing SVG stick circles + trigger bars) moves into the phase box. It automatically switches layout when the phase changes — wingsuit sticks become canopy riser/brake controls. The current HUD telemetry (speed, α, rates) also lives here.

### Scenario-Level Context

The outer scenario box provides persistent awareness across all phases:

| Field | Purpose |
|-------|---------|
| **Alt AGL** | Altitude above ground — critical for BASE, useful for all |
| **Δh / Δd from exit** | Vertical drop and horizontal distance from jump point |
| **Trail** | Point count (visual confirmation trail is recording) |
| **Time** | Total scenario elapsed time |

Future scenario-level features (not yet planned for implementation):
- **Landing area** — target zone rendered on ground plane with distance/bearing
- **Terrain collision** — ground contact detection for actual landing simulation
- **Wind field** — ambient wind affecting all phases

### Telemetry Per Phase

| Phase | Key Readouts |
|-------|-------------|
| **Prelaunch** | Altitude, wind, countdown |
| **Freefall** | Δh, Δd from exit, speed, α, glide ratio, time, gamepad (pitch/roll/yaw) |
| **Deployment** | Sub-state, deploy %, g-force, snatch load, opening time, malfunctions |
| **Canopy** | Altitude AGL, groundspeed, glide ratio, brake %, riser input, gamepad (risers/brakes/wt), malfunctions (line twist °, recovery guidance) |
| **Landed** | Total flight time, max speed, max g, distance from exit |

### Connection to Flight Computer / GPS Work

The phase FSM maps directly to the GPS flight computer's dynamic model switching problem:
- Sensor data → state estimation → phase detection → appropriate nav filter
- Same FSM concept, different domain: sim uses physics to drive phases, GPS uses sensor fusion to detect them
- Phase detection heuristics (freefall vs deployment vs canopy) are shared knowledge between both systems

