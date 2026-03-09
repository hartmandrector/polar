# Bridle Refactor — Standalone Chain Module

The bridle module simulates **PC + 10 bridle segments only**. Nothing else.

The canopy bag and suspension lines are deployment-only abstractions — they exist in `deploy-wingsuit.ts` to get geometry right during deployment, then go away at line stretch.

## Physical Arrangement

```
PC ← bridle segments ← [UNINFLATED CANOPY / BAG] ← suspension lines ← pilot shoulders
     (tension chain)    (rigid body, tumbles)       (slack until line stretch)
```

The bag sits between the bridle and the suspension lines. The bridle attaches to the **top** of the bag. The suspension lines attach to the **bottom** of the bag and run to the pilot's shoulders (harness). During deployment, the bridle pulls the bag away from the pilot. The suspension lines are slack and not under tension until line stretch.

---

## 1  Module Boundary

### `bridle-sim.ts` — PC + Chain + Segment Unstow

```ts
class BridleChainSim {
  step(anchorPos: Vec3, anchorVel: Vec3, rho: number, dt: number): void
}
```

**Owns**: PC position/velocity, 10 bridle segments, segment unstow logic, tension propagation.

**Does NOT own**: canopy bag, suspension lines, line stretch detection, pin release logic, deployment phases.

The bridle doesn't know what it's attached to. It receives an anchor point each tick and simulates a drag chain trailing from it. Same code runs during wingsuit deploy, canopy deploy, and steady canopy flight.

Segment unstow logic lives here because it's intimately tied to tension propagation — each stowed segment acts as a temporary anchor until tension exceeds the unstow threshold. During canopy flight all segments are freed so the unstow logic is naturally a no-op. This is deployment-specific behavior that stays in the bridle for encapsulation — the alternative (splitting tension math across files) is worse.

### `deploy-wingsuit.ts` — Deployment Orchestrator

**Owns**: PC throw, canopy bag rigid body, bag-to-body distance tracking, pin release, line stretch detection, deployment phases.

Creates a `BridleChainSim` at PC toss. Also creates and simulates:
- Canopy bag rigid body (tumble dynamics, 3-axis rotation) — the uninflated canopy
- Bag-to-body distance tracking (single scalar — not individual line simulation)
- Line stretch detection (bag distance from pilot shoulders ≥ 98% of suspension line length)

The suspension lines are NOT simulated as individual tensioned segments. They're slack fabric packed with the bag. The only measurement is the distance from the bag to the pilot — when that distance reaches the total suspension line length, the lines go taut and line stretch occurs.

At line stretch: freezes snapshot, **hands the bare BridleChainSim to sim-runner**. The bag and suspension line distance tracking are disposed — they served their purpose.

### `sim-runner.ts` — Owns Bridle During Canopy Flight

Takes ownership of `BridleChainSim` at line stretch. Steps it with canopy bridleTop as anchor. No bag, no lines, no deployment logic.

```ts
// During canopy flight:
const anchor = canopyBridleAttach(canopyState)  // canopy body → inertial
this.bridleChain.step(anchor, anchorVel, rho, dt)
```

### `deploy-render.ts` — Renders Whatever Exists

During deployment: bridle chain + bag + suspension line + PC (all from WingsuitDeployRenderState).
During canopy flight: bridle chain + PC only (from BridleRenderState — no bag, no suspension line).

---

## 2  Anchor Position State Machine

The bridle doesn't manage its own anchor. The **caller** provides it based on current phase:

| Phase | Anchor | Who Provides |
|-------|--------|-------------|
| `pc_toss` → `bridle_paying_out` | Wingsuit container_back | `deploy-wingsuit.ts` — body-frame offset → inertial via wingsuit DCM |
| `pin_release` → `canopy_extracting` | Bag position (top of bag) | `deploy-wingsuit.ts` — `canopyBag.position` (inertial, free to move) |
| `line_stretch` (moment) | Canopy bridleTop | `sim-runner.ts` — computed from line stretch snapshot |
| Canopy flight | Canopy bridleTop | `sim-runner.ts` — canopy body-frame offset → inertial via canopy DCM |

At pin release, the bridle anchor switches from the wingsuit container to the top of the bag. The bag is free to move because the suspension lines below it are slack — they're not under tension until line stretch. The bridle pulls the bag away from the pilot; the bag's position is the bridle anchor.

```ts
// deploy-wingsuit.ts:
if (this.phase <= 'bridle_paying_out') {
  anchor = bodyToInertial(CONTAINER_BACK, phi, theta, psi)
  anchor = v3add(bodyPos, anchor)
} else {
  // After pin release: bridle attaches to top of bag
  anchor = this.canopyBag!.position  // inertial, free to move
}
this.bridle.step(anchor, anchorVel, rho, dt)

// sim-runner.ts (after line stretch):
const anchor = bodyToInertial(BRIDLE_TOP_OFFSET, canopyState)
this.bridleChain.step(anchor, anchorVel, rho, dt)
```

---

## 3  Lifecycle Through a Wingsuit BASE Scenario

```
FREEFALL (wingsuit flying)
  └─ A button pressed → deploy-wingsuit creates BridleChainSim + throws PC
     ├─ deploy-wingsuit steps bridle (anchor = container_back)
     ├─ deploy-wingsuit steps canopy bag + suspension lines
     ├─ Segments unstow as tension propagates
     ├─ Pin releases at threshold → bag spawns
     ├─ Bag tumbles, accumulates yaw (line twist seed)
     └─ Line stretch detected (bag distance ≥ 98%)
         ├─ Snapshot frozen
         ├─ Bag + suspension lines DISPOSED
         └─ Bare BridleChainSim handed to sim-runner

CANOPY FLIGHT
  └─ sim-runner steps BridleChainSim (anchor = canopy bridleTop)
     ├─ PC bounces behind canopy (tension-drag interplay)
     ├─ No bag, no suspension lines, no deployment logic
     └─ Continues until sim stops
```

---

## 4  Reusability Across Scenarios

Because the bridle is anchor-agnostic:

- **Wingsuit BASE**: deploy-wingsuit → sim-runner (current)
- **Skydiving**: deploy-skydiver → sim-runner (same bridle, different throw + anchor geometry)
- **Debug**: bridle can be created standalone with any anchor for testing

Paragliders have no bridle — no deployment, no pilot chute, nothing to pull off the pilot's back.

The deployment-specific modules (bag, distance tracking, line stretch) are per-vehicle-type. The bridle chain is universal across any scenario that has a pilot chute.

---

## 5  Shared Helpers: `src/sim/vec3-util.ts`

```ts
v3zero, v3add, v3sub, v3scale, v3dot, v3len, v3dist
bodyToInertial(v, phi, theta, psi): Vec3
inertialToBody(v, phi, theta, psi): Vec3
```

Used by: `bridle-sim.ts`, `deploy-wingsuit.ts`, `deploy-canopy.ts`

---

## 6  Types: `deploy-types.ts`

- `BridleRenderState` — PC + segments only (for canopy flight rendering)
- `WingsuitDeployRenderState` — extends BridleRenderState + bag + suspension line (for deployment rendering)
- `LineStretchSnapshot` — produced by deploy-wingsuit, consumed by deploy-canopy
- `BridlePhase` — removed from bridle module (bridle has no phases — caller manages phases)

---

## 7  File Summary

| File | Lines | Role |
|------|-------|------|
| `bridle-sim.ts` | ~200 | PC + 10 segments. `step(anchor, vel, rho, dt)`. No phases, no bag. |
| `deploy-wingsuit.ts` | ~300 | Deployment orchestrator: bridle + bag + lines + phases + line stretch. |
| `deploy-canopy.ts` | ~200 | Canopy IC from snapshot, inflation ramp. |
| `vec3-util.ts` | ~65 | Shared Vec3 + DCM helpers. |
| `deploy-types.ts` | ~100 | Shared interfaces. |
| `deploy-render.ts` | ~400 | GLB rendering for chain + bag (deployment) or chain only (canopy). |
| `sim-runner.ts` | ~350 | Owns bridle during canopy flight. |

---

## 8  Tension Propagation: Current vs Correct

### Current Implementation (Position Clamp)

Not a spring — inelastic distance constraint with no stiffness:

1. Integrate each segment freely (gravity + drag)
2. Walk outboard → inboard (PC end toward body)
3. If distance to neighbor > rest length, snap position back and remove outward radial velocity
4. Tension estimated as `mass × |vRadial| / dt`

**Problems:**

| Issue | Detail |
|-------|--------|
| One-way propagation | Anchors never moved by constraint. Only processed segment moves. |
| Body feels no tension | Body treated as infinite mass. PC drag doesn't decelerate body. |
| No stretch | Snapped to exact rest length. Real bridle stretches ~5cm at load. |
| Order-dependent | Results change with loop direction. No convergence. |

### Correct Model: Stiff Spring

Per-segment tension-only spring:
```
F = k × max(0, dist - restLength)
```
Applied equally and opposite to both endpoints (Newton's third law).

**Stiffness**: `k_total = 5000 N/m` (~5cm stretch at 250N). Per-segment: `k_seg = 50,000 N/m`.

**Sub-stepping required**: Critical timestep ~0.9ms. Sub-step bridle at 1000Hz (5 iterations per 200Hz physics tick). Cheap math, negligible cost.

**Damping**: `c ≈ 0.1 × 2 × sqrt(k_seg × m_seg)` (10% critical). Removes stretch oscillation without affecting steady-state tension.

**What this fixes**: bidirectional propagation, realistic stretch, natural tension readout (`F = k × extension`), PC breathing, body feels deployment forces.
