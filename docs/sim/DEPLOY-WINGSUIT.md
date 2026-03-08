# Wingsuit Deploy Sub-Module — Architecture

**Status**: Fully implemented and working. Full deployment chain runs in real-time: PC toss → bridle → pin release → canopy bag → line stretch → canopy handoff.

## Source Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/sim/deploy-wingsuit.ts` | ~450 | WingsuitDeploySim: tension chain, sub-states, handoff snapshot |
| `src/sim/deploy-canopy.ts` | ~200 | Canopy IC computation + CanopyDeployManager inflation ramp |
| `src/sim/deploy-types.ts` | ~75 | Shared types: Vec3, phases, render state, snapshot |
| `src/viewer/deploy-render.ts` | ~250 | DeployRenderer: segment spheres, chain, bag, PC ring |

## Tension Chain

Every state transition is driven by tension reaching a threshold.

```
PC ←─ bridle[9] ←─ ... ←─ bridle[0] ←─ PIN ←─ container ←─ risers ←─ pilot hips
      ↑                                    ↑
      drag (tension-dependent)        release threshold (20N)
```

**10 bridle segments** (0.33m each, total 3.3m). Each segment has mass (~10g).
Tension propagates from PC inward: constraint force when distance > rest length.

**Pin location**: segment index 1 (~0.5m from container end).
Segments outboard of pin unstow sequentially at 8N. Pin release at 20N frees the rest.

## PC Drag — Tension-Dependent

```
effectiveCD = CD_MIN + (CD_MAX - CD_MIN) × clamp(tension / TENSION_FULL_INFLATION, 0, 1)
```

- `CD_MIN = 0.3` (collapsed) → `CD_MAX = 0.9` (fully inflated)
- `TENSION_FULL_INFLATION = 100N`
- Positive feedback: more tension → more drag → more tension
- PC persists through canopy flight (stays attached)

## Sub-States (implemented)

```
IDLE → [A button] → BRIDLE_PAYING_OUT → [pin tension > 20N] → PIN_RELEASE
    → CANOPY_EXTRACTING → [bag distance ≥ 1.89m] → LINE_STRETCH
```

## Constraint Model

Position clamp + velocity projection (same as CloudBASE):

```ts
// Per segment, propagate from PC inward
if (dist > REST_LENGTH) {
    // Clamp position to max distance from outboard neighbor
    // Project out radial velocity component (inelastic)
    // Record tension = mass × |vRad| / dt
}
```

## Canopy Bag (after PIN_RELEASE)

- Bluff body drag: CD=1.0, area from bounding box estimate
- Distance constraint to innermost freed segment
- 3-axis rotation: pitch/roll ±90° with bounce, yaw unconstrained (line twist seed)
- Random initial yaw rate: ±0.25 rad/s
- Suspension line: `SUSPENSION_LINE_LENGTH = 1.93m` (5.23 total − 3.3 bridle)
- Line stretch trigger: bag-to-body distance ≥ 98% of suspension line length

## Line Stretch Snapshot

```ts
interface LineStretchSnapshot {
    bodyState: SimState           // full 12-state (position, velocity, attitude, rates)
    pcPosition: Vec3              // inertial NED
    pcVelocity: Vec3
    canopyBag: CanopyBagState     // position, velocity, pitch/roll/yaw + rates
    tensionAxis: Vec3             // body frame: pilot hips → bag
    tensionAxisInertial: Vec3     // inertial NED
    chainDistance: number
    time: number
}
```

## Canopy Handoff (deploy-canopy.ts)

`computeCanopyIC(snapshot)` → `SimStateExtended`:
- **Heading (ψ)**: from inertial tension axis horizontal projection (canopy faces into wind, opposite line direction)
- **Pitch (θ)**: from tension axis line angle, ~−6° default trim
- **Roll (φ)**: from bag roll, attenuated 30%
- **Velocity**: full DCM transform — wingsuit body → inertial → canopy body
- **Angular rates**: snatch-damped 70% (SNATCH_DAMP = 0.3)
- **Pilot coupling ICs**: bag pitch → thetaPilot, bag roll → pilotRoll, bag yaw → pilotYaw (line twist)

`CanopyDeployManager`: ramps deploy 0.05 → 1.0 over 3s (ease-out curve). Initial brakes 30%.

## Render State

```ts
interface WingsuitDeployRenderState {
    phase: WingsuitDeployPhase
    segments: { position: Vec3; visible: boolean }[]
    pcPosition: Vec3
    pcCD: number
    bridleTension: number
    chainDistance: number
    canopyBag?: CanopyBagState
    bagDistance: number
    bagTension: number
}
```

DeployRenderer (deploy-render.ts): 10 orange spheres (segments), orange chain line, white suspension line, blue box (bag), red ring (PC tension indicator). All in inertial NED frame — only container attachment point rotated by body quaternion. Disposed at canopy transition.

## SimRunner Integration

```ts
// A button → spawn
this.wsDeploy = new WingsuitDeploySim(bodyState, rho)

// Each physics tick
const hitLineStretch = this.wsDeploy.step(DT, bodyState, rho)
if (hitLineStretch && this.wsDeploy.snapshot) {
    const canopyIC = computeCanopyIC(this.wsDeploy.snapshot)
    this.simState = { ...canopyIC }
    this.modelType = 'canopy'
    this.canopyDeploy = new CanopyDeployManager()
}
```

GLB preloading: canopy model loaded at scenario start, instant swap at line stretch.

## Constants (as implemented)

| Constant | Value | Notes |
|----------|-------|-------|
| `SEGMENT_COUNT` | 10 | 3.3m / 0.33m |
| `REST_LENGTH` | 0.33 m | per segment |
| `SEGMENT_MASS` | 0.01 kg | ~10g |
| `SEGMENT_CDA` | 0.01 | drag coefficient × area |
| `PIN_SEGMENT` | 1 | ~0.5m from container |
| `UNSTOW_THRESHOLD` | 8 N | tuned from 15N |
| `PIN_RELEASE_THRESHOLD` | 20 N | tuned from 50N |
| `PC_MASS` | 0.057 kg | CloudBASE |
| `PC_AREA` | 0.732 m² | π × 0.483² |
| `PC_CD_MIN / MAX` | 0.3 / 0.9 | tension-dependent |
| `TENSION_FULL_INFLATION` | 100 N | CD reaches max |
| `THROW_VELOCITY` | 5.0 m/s | body-right at wingtip |
| `THROW_OFFSET_Y` | 0.9 m | wingtip (full arm extension) |
| `SUSPENSION_LINE_LENGTH` | 1.93 m | 5.23 − 3.3 bridle |
| `LINE_STRETCH_FRACTION` | 0.98 | triggers snapshot |
| `CANOPY_BAG_MASS` | 3.7 kg | CloudBASE |
| `CANOPY_BAG_CDA` | 0.5 | bluff body |
| `INITIAL_BRAKE` | 0.30 | canopy deploy |
| `INFLATION_TIME` | 3.0 s | ease-out ramp |

## Resolved Questions

1. **Constraint clamp chosen** over spring-damper — simpler, matches CloudBASE, stable at 200Hz.
2. **Tension from constraint force**: mass × |vRad| / dt — works well for threshold detection.
3. **Weight shift → riser asymmetry**: deferred — not yet coupled into deployment.
4. **PC area variation**: CD-only model sufficient — area scaling not needed.
5. **Segment damping**: radial velocity projection only — no inter-segment damping needed.
