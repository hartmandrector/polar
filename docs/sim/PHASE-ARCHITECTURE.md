# Simulation Phase Architecture

Continuous 6DOF simulation across flight phases — from launch through landing.

## Phases

```
prelaunch → freefall → deployment → canopy → landed
```

Each phase owns: active aero segments, control mapping, transition conditions, visible GLB models.

## Phase Definitions

| Phase | Vehicle | Controls | Entry Condition | Exit Condition |
|-------|---------|----------|-----------------|----------------|
| **prelaunch** | Standing/seated model | None (countdown) | Scenario start | Jump trigger (gamepad/timer) |
| **freefall** | Wingsuit 6-segment | Pitch/roll/yaw sticks | Exit from prelaunch | Pilot chute throw (gamepad button) |
| **deployment** | Wingsuit + bridle + pilot chute + inflating canopy | Limited (body position only) | Pilot chute throw | Canopy fully inflated (`deploy ≈ 1.0`) |
| **canopy** | 7-cell canopy + pilot body + bridle + pilot chute | Risers/brakes/weight shift | Inflation complete | Altitude ≈ 0 or user stop |
| **landed** | Static model | None | Ground contact | Scenario reset |

## Deployment Sequence (aero-driven)

See [DEPLOYMENT-MECHANICS.md](DEPLOYMENT-MECHANICS.md) for the full deployment model — bridle segments, slider, 4-line-group abstraction, and visualization plan.

The deployment phase is NOT a timer — each step is driven by aerodynamics:

1. **Pilot chute throw** — initial position + velocity from hand throw. Drag model takes over.
2. **Bridle extraction** — pilot chute drag creates tension → pulls bridle segments out. Per-segment drag + tension propagation.
3. **Canopy bag extraction** — bridle tension exceeds threshold → canopy bag leaves container.
4. **Line stretch** — suspension lines deploy to full length. Snatch force spike.
5. **Canopy inflation** — slider controls opening rate. Existing `deploy` slider morphs geometry + aero.

Each step maps to a sub-state within the deployment phase. The existing deployment sliders (`pilotChuteDeploy`, `deploy`) provide debug override for any sub-state.

## New Components Needed

### Pilot Chute
- Separate rigid body with position, velocity, drag coefficient
- Initial conditions from throw (velocity vector relative to body + offset from hand position)
- Drag area: ~0.7 m² (typical BASE pilot chute)
- Once inflated, acts as constant-drag anchor for bridle system

### Bridle
- Multi-segment chain: pilot chute → bridle tape → closing pin → canopy bag
- Each segment: position, length, drag coefficient, tension
- Tension propagation: upstream drag accumulates downstream
- Existing `LineSetGLB` data provides segment geometry

### Phase Controller (FSM)
```typescript
interface SimPhase {
  name: string
  activeSegments: AeroSegment[]
  controlMapping: ControlMapping
  canTransitionTo: (state: SimState) => string | null
  onEnter: (state: SimState) => SimState
  onExit: (state: SimState) => SimState
}
```

The FSM lives above SimRunner. SimRunner stays phase-agnostic — it integrates whatever segments and controls the FSM gives it.

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

1. **Phase FSM shell** — state machine above SimRunner, UI-driven phase control (not gamepad)
2. **FSM status panel** — nested scenario/phase/sub-state display with telemetry
3. **Remove LB/RB vehicle cycling** — replace with scenario/phase selection in UI
4. **Pilot chute rigid body** — position/velocity/drag, throw from hand, trajectory rendering
5. **Bridle tension chain** — multi-segment extraction driven by pilot chute drag
6. **Deployment timing from aero** — connect pilot chute drag → extraction speed → inflation rate
7. **Vehicle assembly swap** — wingsuit model → canopy+pilot model transition during deployment
8. **Continuous mode toggle** — switch between debug (manual sliders) and continuous (aero-driven)
9. **Scenario system** — data-driven initial conditions and phase sequences

Steps 1-3 are next. Everything else builds on them.

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
│  Recovery: spread risers + kick left          │
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

