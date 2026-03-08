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

## Canopy Handoff — Frame Transform (deploy-canopy.ts)

`computeCanopyIC(snapshot)` converts the `LineStretchSnapshot` into a full
`SimStateExtended` for the canopy 6DOF integrator. This is the critical frame
mapping between the inertial-NED deployment sub-sim and the canopy body-frame
flight sim.

### Physical Geometry at Line Stretch

```
              ╭──── uninflated canopy (bag)
              │       pitch/roll/yaw from tumble
              │
         suspension lines (~1.93m)
              │
              │     ← tension axis: pilot hips → canopy (inertial NED)
              │
         wingsuit pilot (CG)
              │
              v  flight direction (~120 mph, ~45° below horizontal)
```

The pilot is flying forward-and-down at steep glide angle. The uninflated
canopy trails above-and-behind, connected by taut suspension lines. The
tension axis points from pilot hips toward the canopy bag in inertial NED.

### Step 1 — Canopy Attitude (ψ, θ, φ) from Tension Axis

The canopy body frame x-axis points along the riser line (toward the canopy).
At line stretch this is above-and-behind the pilot, giving a steep nose-up θ.

```
tensionAxisInertial = normalize(canopyBag.position − bodyPos)   // pilot → canopy, inertial NED

ψ = atan2(−ty, −tx)                    // heading: OPPOSITE to tension horizontal projection
                                        // (canopy forward = into the wind = flight direction)

θ = atan2(−tz, √(tx² + ty²))          // elevation angle above horizontal
                                        // (−tz because NED z+ = down; canopy above = negative z)
                                        // Typical: ~60–70° (canopy well above pilot)

φ = canopyBag.roll × 0.3               // from bag tumble, attenuated by snatch force
```

**Why ψ uses negated components**: The tension axis points backward
(pilot→canopy). The canopy faces forward into the wind — the opposite
horizontal direction. Negating tx and ty flips the horizontal projection 180°.

**Why θ uses the full elevation angle**: At line stretch, the uninflated canopy
at 5–7% deploy is approximately aligned with the suspension lines. The line
elevation directly gives the canopy body pitch. This produces θ ≈ 60–70°.

### Step 2 — Velocity Transform (Wingsuit Body → Inertial → Canopy Body)

Two-step DCM (Direction Cosine Matrix) chain, standard 3-2-1 Euler sequence:

```
Step 1: Wingsuit body → inertial NED
    [vN, vE, vD] = R_BI(φ_ws, θ_ws, ψ_ws) × [u_ws, v_ws, w_ws]

Step 2: Inertial NED → canopy body
    [u_c, v_c, w_c] = R_IB(φ_c, θ_c, ψ_c)ᵀ × [vN, vE, vD]
```

With θ_c ≈ 66° (steep nose-up body frame) and the velocity mainly
forward-and-down in inertial, the transform produces:
- `w_c >> u_c` → **α ≈ 70–85°** (broadside to airflow — physically correct!)
- The canopy is NOT trimmed — it's a flat plate at high angle of attack
- Over the 3s inflation, pitching moment drives α toward trim (~8–10°)

### Step 3 — Pilot Pendulum Angle (thetaPilot) from Geometry

`thetaPilot` is the pendulum angle of the pilot CG in the canopy body xz-plane,
measured from x-body toward z-body. It controls the `pilotPitch` slider and the
`makeLiftingBodySegment` pitch offset (which rotates the pilot's local α).

```
pilotDir_inertial = −tensionAxisInertial     // canopy → pilot direction (negated)

pilotDir_body = R_IBᵀ(φ_c, θ_c, ψ_c) × pilotDir_inertial    // rotate into canopy body frame

thetaPilot = atan2(pdz, pdx)                 // angle in canopy body xz-plane
                                              // Typical: ~120–150° (pilot past canopy z-axis)
```

At deployment, the pilot hangs well below and behind the canopy. In the canopy
body frame (x = along riser line, z = perpendicular down from canopy), the
pilot CG direction has a large +z component → thetaPilot ≈ 130–150°.

This matches the manually-set slider value (~144°) that produces correct
deployment behavior in the static visualizer.

### Step 4 — Angular Rates (p, q, r) — Near Zero

```
p = canopyBag.rollRate  × 0.1
q = canopyBag.pitchRate × 0.1
r = canopyBag.yawRate   × 0.1
```

The canopy is a new body just beginning to fly. The snatch force at line
stretch absorbs most angular energy. Rather than inheriting wingsuit body
rates (which are in a completely different frame), small perturbations from
the bag's residual tumble are used.

### Step 5 — Remaining Pilot Coupling ICs

| IC | Source | Factor | Notes |
|----|--------|--------|-------|
| `thetaPilotDot` | `canopyBag.pitchRate` | ×0.15 | Heavily damped by snatch |
| `pilotRoll` | `canopyBag.roll` | ×0.3 | Lateral offset from tumble |
| `pilotRollDot` | `canopyBag.rollRate` | ×0.15 | Heavily damped |
| `pilotYaw` | `canopyBag.yaw` | **×1.0** | Line twist — the deployment payoff |
| `pilotYawDot` | `canopyBag.yawRate` | **×1.0** | Twist rate carries through |

**Yaw is unattenuated**: the bag's accumulated yaw during deployment becomes
exactly the initial line twist angle. Lines wrapped around the yaw axis during
deployment don't unwind at line stretch. This is the physical mechanism that
creates line twists from body position during deployment.

### Typical Values at Handoff

From a standard wingsuit BASE deployment at ~25 m/s after flare:

| Parameter | Value | Notes |
|-----------|-------|-------|
| θ (pitch) | ~66° | Steep nose-up — canopy well above pilot |
| ψ (heading) | matches flight dir | From negated tension axis horizontal |
| α (AOA) | ~80° | Broadside to airflow — NOT trimmed |
| thetaPilot | ~144° | Pilot hanging well past canopy z-axis |
| Deploy | 5% | Just beginning inflation |
| Airspeed | ~25 m/s | Post-flare deceleration |

### Euler Singularity Guard

The canopy starts at θ ≈ 66° and pitches forward during inflation. To prevent
`Inf`/`NaN` if θ transiently passes through ±90° in `eulerRates()`, the EOM
clamps `cos(θ)` to a minimum magnitude of 1e-6 before computing `tan(θ)` and
`sec(θ)`. This is a safety net — in practice the canopy's pitching moment
drives θ forward (decreasing) toward trim well before reaching 90°.

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
