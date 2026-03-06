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

1. **Phase FSM shell** — state machine above SimRunner, manual phase switching via gamepad button
2. **Pilot chute rigid body** — position/velocity/drag, throw from hand, trajectory rendering
3. **Bridle tension chain** — multi-segment extraction driven by pilot chute drag
4. **Deployment timing from aero** — connect pilot chute drag → extraction speed → inflation rate
5. **Vehicle assembly swap** — wingsuit model → canopy+pilot model transition during deployment
6. **Continuous mode toggle** — switch between debug (manual sliders) and continuous (aero-driven)
7. **Scenario system** — data-driven initial conditions and phase sequences

Steps 1-2 are next. Everything else builds on them.
