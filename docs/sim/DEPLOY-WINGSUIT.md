# Wingsuit Deploy Sub-Module — Architecture

Single file: `src/sim/deploy-wingsuit.ts`

Owns **all** wingsuit deployment physics, tension propagation, GLB lifecycle, and handoff computation. Called by SimRunner each tick. Produces render state consumed by a separate render module.

## Tension Chain

The fundamental mechanism. Every state transition is driven by tension reaching a threshold.

```
PC ←─ bridle[9] ←─ ... ←─ bridle[0] ←─ container ←─ risers ←─ pilot hips
      ↑                                    ↑              ↑
      drag force                     closure pins    weight shift
      propagates ←─────────────────────────────────── bias
```

**10 bridle segments** (bridalsegment.glb = 0.33m each, total 3.3m).  
Each segment is a point mass with position + velocity, constrained to its neighbors.  
Tension propagates from PC inward: segment N pulls on N-1 when distance > rest length.

## Sub-States

```
IDLE
  │  [A button]
  ▼
PC_TOSS ─── PC spawned, small drag (unopened), no bridle segments visible
  │  [PC distance > segment 0 rest length → tension on segment 0]
  ▼
BRIDLE_EXTENDING ─── segments unstow one at a time as tension propagates
  │  each segment: hidden + constrained at container → tension threshold → visible + free
  │  [all 10 segments free, distance ≈ 3.3m]
  ▼
BRIDLE_STRETCHED ─── PC opens to full area (0.73 m²), drag jumps
  │  [container tension > opening threshold]
  ▼
CONTAINER_OPEN ─── canopy bag released, second rigid body spawns
  │  canopy bag: bluff body drag, ±90° pitch/roll, free yaw
  │  [total chain distance ≈ 5.23m]
  ▼
LINE_STRETCH ─── snapshot everything → handoff to canopy deploy sub-module
```

## Tension Model

Per segment, each tick:

```
for i = 0 to N-1:
    anchor = (i == 0) ? container_attach_point : segment[i-1].position
    target = (i == N-1) ? pc_position : segment[i+1].position
    
    # Constraint: max distance to anchor
    dist = distance(segment[i], anchor)
    if dist > REST_LENGTH:
        # Taut — apply constraint
        segment[i].position = clamp to REST_LENGTH from anchor
        # Remove outward radial velocity (inelastic)
        project out radial component
        # Tension propagates: this segment is now pulling on i-1
        tension[i] = drag_force_component_along_chain
```

**Tension threshold** for unstowing next segment: when the last free segment's constraint force exceeds a threshold (~5N?), the next stowed segment releases.

**Container opening threshold**: when bridle tension exceeds ~50N (tunable), container pins release and canopy bag spawns.

## Body Frame

All positions computed in **wingsuit body frame** (NED, origin at wingsuit CG).

- Segment positions: body-relative, updated each tick
- PC position: body-relative (already implemented)
- Canopy bag position: body-relative
- Weight shift offset: from pilot coupling lateral state → moves harness attach point in body Y

**At line stretch**, everything is in wingsuit body frame. The handoff transforms to canopy body frame:

1. Compute new system CG (pilot mass + canopy mass, weighted by positions)
2. Tension axis = vector from pilot hips to canopy bag
3. Canopy orientation in inertial frame (from rigid body quaternion)
4. Transform all velocities and positions to new CG-centered frame
5. Extract α, β from canopy orientation vs airflow
6. Extract δ_ψ from accumulated canopy yaw (line twist)
7. Extract θ_pilot from wingsuit pitch relative to tension axis

## GLB Lifecycle

| Sub-State | Visible | Hidden |
|-----------|---------|--------|
| IDLE | — | all deploy meshes |
| PC_TOSS | pc.glb, bridle line (body→PC) | segments, snivel-slider |
| BRIDLE_EXTENDING | pc.glb, freed segments, bridle line | stowed segments, snivel-slider |
| BRIDLE_STRETCHED | pc.glb, all segments, bridle line | snivel-slider |
| CONTAINER_OPEN | pc.glb, all segments, snivel-slider.glb, 4 lines | — |
| LINE_STRETCH | freeze all positions | — |

Segments use `bridalsegment.glb` (0.33m, real-world scale). Positioned along the chain between anchors. Oriented along the tension direction between neighbors.

## Render Interface

`deploy-wingsuit.ts` exports a state object each tick, consumed by renderer:

```ts
interface WingsuitDeployState {
    phase: WingsuitDeployPhase
    pcPosition: Vec3       // body-relative, meters
    pcVelocity: Vec3
    segments: {            // 10 bridle segments
        position: Vec3     // body-relative
        visible: boolean
        orientation: Quat  // aligned along chain
    }[]
    canopyBag?: {          // present after CONTAINER_OPEN
        position: Vec3
        orientation: Quat
        visible: boolean
    }
    bridleTension: number  // scalar, for HUD
    containerTension: number
    chainDistance: number   // total PC-to-hips
    lineStretchSnapshot?: LineStretchSnapshot  // frozen at LINE_STRETCH
}
```

Renderer reads this and drives Three.js. No physics imports in the render file, no Three.js imports in the physics file.

## SimRunner Integration

```ts
// sim-runner.ts tick loop
if (this.wsDeploy) {
    this.wsDeploy.step(DT, bodyState, rho)
    if (this.wsDeploy.phase === 'line_stretch') {
        // Hand off to canopy deploy sub-module
        const snapshot = this.wsDeploy.snapshot
        this.transitionToCanopy(snapshot)
    }
}
```

SimRunner owns the deploy sub-module instance. Creates it on A button. Destroys it at canopy handoff (canopy deploy sub-module takes over).

## File Organization

```
src/sim/
    deploy-wingsuit.ts    (~400)  This module: tension chain, sub-states, GLB lifecycle, handoff
    deploy-canopy.ts      (~300)  Future: slider descent, inflation, line twist recovery
    deploy-render.ts      (~250)  Three.js rendering for both deploy modules
    deploy-types.ts       (~80)   Shared types: WingsuitDeployState, LineStretchSnapshot, etc.
    sim-runner.ts         (~350)  Core loop, owns deploy sub-modules
    sim-state-machine.ts  (~200)  Top-level FSM: freefall/deployment/canopy/landed
    sim-gamepad.ts        (~150)  Vehicle-aware gamepad reading
    sim-hud.ts            (~300)  HUD rendering, phase box, telemetry
    sim-ui.ts             (~150)  Thin orchestrator: setup, event binding
```

## Constants (from CloudBASE + tuning)

| Constant | Value | Source |
|----------|-------|--------|
| `BRIDLE_SEGMENT_LENGTH` | 0.33 m | bridalsegment.glb |
| `BRIDLE_SEGMENT_COUNT` | 10 | 3.3m / 0.33m |
| `TOTAL_BRIDLE_LENGTH` | 3.3 m | bridal.glb measurement |
| `TOTAL_LINE_LENGTH` | 5.23 m | CloudBASE `pilottoattachmentpoint` |
| `PC_MASS` | 0.057 kg | CloudBASE |
| `PC_AREA_OPENED` | 0.732 m² | π × 0.483² |
| `PC_AREA_UNOPENED` | 0.004 m² | π × 0.035² |
| `PC_CD` | 0.9 | CloudBASE |
| `CANOPY_BAG_MASS` | 3.7 kg | CloudBASE |
| `CANOPY_BAG_CD` | 1.0 | bluff body estimate |
| `THROW_VELOCITY` | 3.0 m/s | CloudBASE, body-right |
| `UNSTOW_TENSION_THRESHOLD` | ~5 N | tunable |
| `CONTAINER_OPEN_TENSION` | ~50 N | tunable |

## Open Questions

1. **Segment mass** — bridle segments are very light (~10g each). Treat as massless constraints, or give them mass for stability?
2. **Canopy bag spawn timing** — at BRIDLE_STRETCHED or CONTAINER_OPEN? Real sequence: bridle stretches → container opens (separate event) → bag extracts. Two thresholds.
3. **Weight shift coupling during deployment** — how much does lateral shift affect riser tension asymmetry? Linear mapping from pilotRoll to riser tension bias?
4. **Snatch force** — at line stretch, relative velocity between body and canopy creates a sudden deceleration. Model as impulse or let the constraint handle it?
5. **PC drag after line stretch** — PC collapses when canopy inflates (steals the air). Model drag reduction or just hand off?
