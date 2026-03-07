# Wingsuit Deploy Sub-Module — Architecture

Single file: `src/sim/deploy-wingsuit.ts`

Owns **all** wingsuit deployment physics, tension propagation, GLB lifecycle, and handoff computation. Called by SimRunner each tick. Produces render state consumed by a separate render module.

## Tension Chain

The fundamental mechanism. Every state transition is driven by tension reaching a threshold.

```
PC ←─ bridle[9] ←─ ... ←─ bridle[0] ←─ PIN (0.5m from end) ←─ container ←─ risers ←─ pilot hips
      ↑                                    ↑                        ↑              ↑
      drag (tension-dependent)        release threshold      closure system    weight shift
      propagates ←──────────────────────────────────────────────────────────── bias
```

**10 bridle segments** (bridalsegment.glb = 0.33m each, total 3.3m).
Each segment has mass (~10g) for acceleration computation.
Tension propagates from PC inward: segment N pulls on N-1 when distance > rest length.

**Pin location**: ~0.5m from container end of bridle (approximately segments 0–1).
Everything outboard of the pin unstows sequentially via tension. The last 0.5m (pin-side)
dumps all at once when pin tension exceeds release threshold.

## PC Drag — Tension-Dependent Model

The PC is **not** binary opened/unopened. Its drag coefficient is a continuous function of bridle tension:

```
effectiveCD = CD_min + (CD_max - CD_min) × tensionFactor
tensionFactor = clamp(bridleTension / TENSION_FULL_INFLATION, 0, 1)
```

- **High tension** → PC fabric stretches taut, holds shape → high CD → more drag → more tension (positive feedback)
- **Low tension** → PC collapses partially, shape distorts → low CD → less drag → less tension (negative feedback)
- This creates realistic oscillation in the PC-bridle system: tension builds, overshoots, relaxes, rebuilds

**CD range**: `CD_min ≈ 0.3` (collapsed), `CD_max ≈ 0.9` (fully inflated). Tunable.

The PC area also varies with tension (fabric stretch), but area variation is smaller than CD variation.
Start with CD-only model, add area scaling if needed.

**PC persists through canopy flight** — stays attached to bridle, bouncing behind canopy.
Same tension-drag interplay continues. No removal or collapse at handoff.

## Sub-States

```
IDLE
  │  [A button]
  ▼
PC_TOSS ─── PC spawned, low drag (low tension → collapsed shape), no segments visible
  │  [tension on segment nearest PC > unstow threshold]
  ▼
BRIDLE_PAYING_OUT ─── segments unstow one at a time as tension propagates inward
  │  each segment: constrained at stow point → tension threshold → free to move
  │  PC drag increases as tension builds (feedback loop)
  │  [tension reaches pin segment]
  ▼
PIN_RELEASE ─── pin tension > release threshold → last 0.5m of bridle dumps at once
  │  canopy released from container → snivel-slider.glb spawns
  │  sudden tension increase as full chain + canopy bag mass now loading PC
  ▼
CANOPY_EXTRACTING ─── canopy bag trailing, bluff body drag, ±90° pitch/roll, free yaw
  │  PC drag high (strong tension from canopy bag mass)
  │  line geometry tracking: 4 riser groups, slider position
  │  [total chain distance ≈ 5.23m]
  ▼
LINE_STRETCH ─── snapshot everything → handoff to canopy deploy sub-module
```

## Tension Model

Per-segment, each tick:

```ts
// Propagate from PC inward
for (i = N-1; i >= 0; i--) {
    const outboard = (i === N-1) ? pc.position : segments[i+1].position
    const dist = distance(segments[i].position, outboard)
    
    if (dist > REST_LENGTH) {
        // Taut — compute tension
        const stretch = dist - REST_LENGTH
        const tensionMag = stretch * SPRING_STIFFNESS  // or constraint force
        
        // Apply constraint: clamp position
        clamp segments[i] to REST_LENGTH from outboard
        // Remove outward radial velocity (inelastic)
        project out radial component
        
        // Record tension for:
        // 1. PC drag feedback
        // 2. Unstow threshold check on next inboard segment
        // 3. Pin release check
        tension[i] = tensionMag
    }
}

// Check sequential unstow
if (nextStowedSegment && tension[nextStowedSegment + 1] > UNSTOW_THRESHOLD) {
    release(nextStowedSegment)  // mark visible, free to move
}

// Check pin release
if (!pinReleased && tension[PIN_SEGMENT] > PIN_RELEASE_THRESHOLD) {
    pinReleased = true
    release all segments inboard of pin
    spawnCanopyBag()
}
```

## Body Frame

All positions computed in **wingsuit body frame** (NED, origin at wingsuit CG).

- Segment positions: body-relative, updated each tick
- PC position: body-relative
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

## Canopy Bag Rigid Body (after PIN_RELEASE)

- **Drag**: bluff body CD ≈ 1.0, area from snivel-slider.glb bbox
- **Constraint**: distance to bridle endpoint (same pattern as segment constraints)
- **Rotation**: Euler integration with hard stops at ±90° pitch/roll, free yaw
- **Yaw accumulation**: tracked continuously → becomes initial line twist (δ_ψ) at line stretch
- **No bag in BASE jumping**: canopy stowed directly in container, but mechanics are the same — fabric extracts from container after pin release

## GLB Lifecycle

| Sub-State | Visible | Hidden |
|-----------|---------|--------|
| IDLE | — | all deploy meshes |
| PC_TOSS | pc.glb, tension line (body→PC) | segments, snivel-slider |
| BRIDLE_PAYING_OUT | pc.glb, freed segments, tension line | stowed segments, snivel-slider |
| PIN_RELEASE | pc.glb, all segments, snivel-slider.glb | — |
| CANOPY_EXTRACTING | pc.glb, all segments, snivel-slider.glb, 4 riser lines | — |
| LINE_STRETCH | freeze all → handoff | — |

Segments: `bridalsegment.glb` (0.33m real-world). Positioned along chain. Oriented along tension direction.

## Render Interface

```ts
interface WingsuitDeployState {
    phase: WingsuitDeployPhase
    pcPosition: Vec3           // body-relative, meters
    pcDragCoefficient: number  // current tension-dependent CD
    segments: {
        position: Vec3         // body-relative
        visible: boolean
        orientation: Quat      // aligned along chain
    }[]
    canopyBag?: {              // present after PIN_RELEASE
        position: Vec3
        orientation: Quat
    }
    bridleTension: number      // scalar [N], for HUD + PC drag feedback
    pinTension: number         // tension at pin segment [N]
    chainDistance: number       // total PC-to-hips [m]
    lineStretchSnapshot?: LineStretchSnapshot
}
```

## SimRunner Integration

```ts
// sim-runner.ts tick loop
if (this.wsDeploy) {
    this.wsDeploy.step(DT, bodyState, rho)
    if (this.wsDeploy.phase === 'line_stretch') {
        const snapshot = this.wsDeploy.snapshot
        this.transitionToCanopy(snapshot)
    }
}
```

SimRunner owns the deploy sub-module. Creates on A button. PC persists into canopy flight
(canopy deploy sub-module inherits the PC rigid body for continued tension-drag interplay).

## File Organization

```
src/sim/
    deploy-wingsuit.ts    (~400)  Tension chain, sub-states, GLB lifecycle, handoff
    deploy-canopy.ts      (~300)  Slider descent, inflation, line twist recovery
    deploy-render.ts      (~250)  Three.js rendering for both deploy modules
    deploy-types.ts       (~80)   Shared types: WingsuitDeployState, LineStretchSnapshot, Vec3, etc.
    sim-runner.ts         (~350)  Core loop, owns deploy sub-modules
    sim-state-machine.ts  (~200)  Top-level FSM: freefall/deployment/canopy/landed
    sim-gamepad.ts        (~150)  Vehicle-aware gamepad reading
    sim-hud.ts            (~300)  HUD rendering, phase box, telemetry
    sim-ui.ts             (~150)  Thin orchestrator: setup, event binding
```

## Constants

| Constant | Value | Source |
|----------|-------|--------|
| `BRIDLE_SEGMENT_LENGTH` | 0.33 m | bridalsegment.glb |
| `BRIDLE_SEGMENT_COUNT` | 10 | 3.3m / 0.33m |
| `PIN_POSITION` | segment 1 (~0.5m from container) | real geometry |
| `TOTAL_BRIDLE_LENGTH` | 3.3 m | bridal.glb |
| `TOTAL_LINE_LENGTH` | 5.23 m | CloudBASE |
| `PC_MASS` | 0.057 kg | CloudBASE |
| `PC_AREA` | 0.732 m² | π × 0.483² |
| `PC_CD_MIN` | 0.3 | collapsed, low tension |
| `PC_CD_MAX` | 0.9 | fully inflated, high tension |
| `TENSION_FULL_INFLATION` | ~20 N | tunable: tension at which PC is fully inflated |
| `CANOPY_BAG_MASS` | 3.7 kg | CloudBASE |
| `CANOPY_BAG_CD` | 1.0 | bluff body |
| `THROW_VELOCITY` | 3.0 m/s | CloudBASE, body-right |
| `UNSTOW_TENSION_THRESHOLD` | ~5 N | tunable |
| `PIN_RELEASE_TENSION` | ~50 N | tunable |
| `SEGMENT_MASS` | ~0.01 kg | ~10g per segment for acceleration calc |

## Open Questions

1. **Spring stiffness vs constraint clamp** — pure constraint (position clamp + velocity projection) or spring-damper for smoother tension? CloudBASE used constraint clamp.
2. **Tension measurement** — compute from constraint force (position correction × mass / dt²) or track spring stretch explicitly?
3. **Weight shift → riser asymmetry** — linear mapping from pilotRoll to riser tension bias? Or geometric (hip offset changes moment arms)?
4. **PC area variation with tension** — start CD-only, or include area scaling from fabric stretch?
5. **Segment-to-segment damping** — any relative velocity damping between neighboring segments, or just the radial velocity projection?
