# Bridle Refactor — Standalone Chain Module

Extract bridle+PC physics from `deploy-wingsuit.ts` into a standalone `bridle-sim.ts` that can be driven by any anchor body.

---

## 1  New File: `src/sim/bridle-sim.ts`

### Class: `BridleChainSim`

**Constructor**: segment count, segment length, PC mass/area/CD range, segment mass, segment CDA

**Interface**:
```ts
step(attachPos: Vec3, attachVel: Vec3, rho: number, dt: number): boolean
```
- `attachPos` / `attachVel` — inertial NED position+velocity of the anchor point (no rotation needed — just a point in space)
- Returns `true` on line stretch detection

**State exposed**:
- `segments: BridleSegmentState[]`
- `pcPos`, `pcVel` (inertial NED)
- `canopyBag: CanopyBagState | null`
- `bridleTension`, `pinTension`, `bagTension` (scalars, N)
- `phase: BridlePhase`
- `freedCount`
- `snapshot: LineStretchSnapshot | null`

**Phases** (moved from `WingsuitDeployPhase`):
```
pc_toss → bridle_paying_out → pin_release → canopy_extracting → line_stretch
```

### What moves into `bridle-sim.ts`
- All segment chain physics (constraint solver, unstow logic)
- PC drag model (tension-dependent CD)
- Canopy bag rigid body (tumble dynamics, 3-axis rotation)
- Suspension line stretch detection
- Line stretch snapshot capture
- Constants: segment count/length, PC mass/area/CD, thresholds

### What stays in `deploy-wingsuit.ts`
- PC throw logic (release offset, throw velocity, body-frame throw direction)
- Knowledge of wingsuit body state (phi, theta, psi for initial throw direction)
- Creates `BridleChainSim` instance at PC toss
- Provides wingsuit attachment point each tick (container_back in body frame → inertial)
- Slim wrapper: ~80 lines

---

## 2  Anchor Handoff at Pin Release

**Current bug**: anchor is always the wingsuit container_back position. In reality:

| Phase | Anchor | Source |
|-------|--------|--------|
| `pc_toss` → `bridle_paying_out` | Wingsuit container_back | body-frame offset → inertial via wingsuit DCM |
| `pin_release` → `canopy_extracting` | **Canopy bag position** | `canopyBag.position` (inertial NED) |
| `line_stretch` → canopy flight | Canopy bridle attachment | canopy body-frame offset → inertial via canopy DCM |

At pin release, the container opens and the canopy bag is pulled free. The bridle is now physically connected to the canopy fabric, not the wingsuit container. The anchor switches from wingsuit body → canopy bag position (inertial, no rotation — uninflated fabric has no meaningful frame for the attachment point).

**Implementation**: `BridleChainSim.step()` always receives the anchor from outside. The caller is responsible for switching:

```ts
// In deploy-wingsuit.ts:
if (bridle.phase <= 'bridle_paying_out') {
  anchor = wingsuitContainerPos(simState)  // body → inertial
} else {
  anchor = bridle.canopyBag!.position       // already inertial
}
bridle.step(anchor, anchorVel, rho, dt)
```

After canopy handoff, `sim-runner.ts` provides the canopy bridle attachment:
```ts
anchor = canopyBridleAttach(canopyState)  // canopy body → inertial
```

---

## 3  Shared Helpers: `src/sim/vec3-util.ts`

Extract from `deploy-wingsuit.ts`:
```ts
v3zero, v3add, v3sub, v3scale, v3dot, v3len, v3dist
bodyToInertial(v, phi, theta, psi): Vec3
inertialToBody(v, phi, theta, psi): Vec3
```

Used by: `bridle-sim.ts`, `deploy-wingsuit.ts`, `deploy-canopy.ts`

---

## 4  Renderer: Bridle Visuals Under Cell Wireframes

`deploy-render.ts` currently builds its own spheres + lines. Change:

- Tie bridle segment visibility to the **Show Cell Wireframes** checkbox
- Segments rendered as small spheres at physics positions (existing approach is fine — GLB swap deferred)
- Chain line connecting segments (existing orange `BRIDLE_COLOR`)
- PC tension ring (existing)
- Suspension line (existing white line body→bag)

No functional change to rendering — just move the visibility toggle to the wireframe checkbox.

---

## 5  PC Persistence Into Canopy Flight

Currently: bridle sim stops at line stretch, PC disappears.

After refactor: `sim-runner.ts` takes ownership of `BridleChainSim` at line stretch and continues stepping it during canopy flight:

```ts
// sim-runner.ts step loop:
if (this.bridleChain) {
  const attachPos = this.modelType === 'wingsuit'
    ? wingsuitContainerPos(this.simState)
    : canopyBridleAttach(this.simState)
  this.bridleChain.step(attachPos, attachVel, config.rho, DT)
}
```

The PC continues its tension-drag interplay — bouncing behind the canopy as in real flight.

---

## 6  Updated `deploy-types.ts`

- Move `WingsuitDeployPhase` → `BridlePhase` (bridle-owned, not wingsuit-owned)
- Add `BridleRenderState` interface (replaces `WingsuitDeployRenderState` for the chain portion)
- Keep `LineStretchSnapshot` (produced by bridle, consumed by deploy-canopy)

---

## 7  File Summary

| File | Action | Result |
|------|--------|--------|
| `src/sim/vec3-util.ts` | **NEW** | ~50 lines — shared Vec3 + DCM helpers |
| `src/sim/bridle-sim.ts` | **NEW** | ~300 lines — standalone chain physics |
| `src/sim/deploy-wingsuit.ts` | **SLIM** | ~80 lines — PC throw + anchor provider |
| `src/sim/deploy-canopy.ts` | **EDIT** | Import helpers from vec3-util |
| `src/sim/deploy-types.ts` | **EDIT** | Rename phase type, add BridleRenderState |
| `src/sim/sim-runner.ts` | **EDIT** | Own BridleChainSim, step through canopy flight |
| `src/viewer/deploy-render.ts` | **EDIT** | Visibility tied to wireframe checkbox |

Total new code: ~350 lines. Total removed from deploy-wingsuit: ~400 lines. Net: smaller, cleaner.

---

## 8  Tension Propagation: Current vs Correct

### Current Implementation (Position Clamp)

Not a spring — it's an inelastic distance constraint with no stiffness:

1. Integrate each segment freely (gravity + drag)
2. Walk **outboard → inboard** (PC end toward body)
3. For each segment: if distance to neighbor > rest length, snap position back and remove outward radial velocity
4. Tension estimated as `mass × |vRadial| / dt`

**Problems:**

| Issue | Detail |
|-------|--------|
| **One-way propagation** | Anchors (body, outboard neighbors) are never moved by the constraint. Only the segment being processed moves. |
| **Body feels no tension** | The wingsuit body is treated as infinite mass — constraint never modifies its velocity. PC drag doesn't decelerate the body through the chain. |
| **No stretch** | Segments are snapped to exact rest length. Real bridle stretches ~5cm total under load (~250N). |
| **Order-dependent** | Results change depending on which direction you walk the loop. No convergence guarantee. |
| **Tension estimate is approximate** | `mass × |vRad| / dt` measures velocity correction, not actual constraint force. |

### Correct Model: Stiff Spring (Recommended)

Replace position clamp with tension-only springs between each neighbor pair. Real Spectra/Dyneema bridle line has very low elongation (~1.5% at break), giving high stiffness with small stretch.

**Per-segment spring:**
```
F_tension = k × max(0, dist - restLength)
```
Applied **equally and opposite** to both endpoints (Newton's third law).

**Stiffness estimate:**
- Total bridle stretch: ~5cm at ~250N extreme load
- Total stiffness: `k_total = 250 / 0.05 = 5000 N/m`
- Per-segment (10 springs in series): `k_seg = k_total × N = 50,000 N/m`
- At typical deployment tension (~15N): stretch ≈ 3mm total — barely visible, numerically stable

**Force on each segment per timestep:**
```ts
for each pair (segA, segB):
  delta = segB.pos - segA.pos
  dist = |delta|
  if dist > restLength:
    F = k_seg * (dist - restLength)
    dir = delta / dist
    segA.vel += (F / massA) * dt * dir
    segB.vel -= (F / massB) * dt * dir
```

**What this fixes:**
- **Bidirectional propagation** — PC drag pulls chain taut, body drag propagates to PC. Both endpoints feel the force.
- **Realistic stretch** — 5cm total gives visible but subtle elasticity. Tunable via `k_total`.
- **Natural tension readout** — `F = k × extension` is the actual physical tension at any point in the chain.
- **PC "breathing"** — tension oscillates naturally as PC drag and body drag compete through the elastic chain.
- **Body feels deployment forces** — the wingsuit actually decelerates slightly when the PC inflates (small effect but physically correct).

**Stability at 200Hz:**
- Critical timestep: `dt_crit = 2 × sqrt(m / k) = 2 × sqrt(0.01 / 50000) ≈ 0.9ms`
- Our timestep: 5ms (200Hz)
- **Needs sub-stepping or reduced stiffness.** Options:
  - Sub-step the bridle at 1000Hz within each 200Hz physics tick (5 sub-steps)
  - Reduce `k_seg` to ~2000 N/m (softer, ~12cm total stretch — less realistic but stable at 200Hz)
  - Use semi-implicit Euler (velocity update before position) — doubles the stable timestep

**Recommended**: sub-step at 1000Hz. The bridle math is cheap (10 segments, simple spring forces). 5 inner iterations per outer step adds negligible cost and keeps the stiffness realistic.

### Damping

Real bridle has internal damping (material hysteresis). Add velocity-dependent damping to prevent oscillation:

```
F_damp = c × vRadial_relative
```

Where `c ≈ 0.1 × 2 × sqrt(k_seg × m_seg)` (10% of critical damping). This removes energy from stretch oscillations without affecting the steady-state tension.
