# Wingsuit BASE Flow — Full Simulation Phases

Complete wingsuit BASE jump flow from exit through landing.

## Phase Sequence

```
exit → freefall → deploy → unzip → canopy → landing
```

| Phase | Vehicle Model | Gamepad Mode | Entry | Exit | Status |
|-------|--------------|--------------|-------|------|--------|
| **exit** | Wingsuit | Wingsuit controls | Scenario start | Clear of object | ⬜ planned |
| **freefall** | Wingsuit 6-seg | Wingsuit stick+triggers | Exit complete | A button (PC toss) | ✅ |
| **deploy** | Wingsuit → canopy | Deploy gamepad (limited) | A button | Inflation complete | ✅ |
| **unzip** | Canopy + zipped pilot | Deploy gamepad (limited) | Inflation complete | B button + 1.5s | ✅ |
| **canopy** | Canopy + unzipped pilot | Full canopy gamepad | Unzip complete | Ground contact | ✅ |
| **landing** | Static | None | Ground contact | Reset | ⬜ planned |

## Current State (what works)

- **Freefall**: Full wingsuit 6-seg aero, gamepad pitch/roll/yaw ✅
- **Deploy sub-sim**: PC toss → bridle → pin release → bag → line stretch ✅
- **Canopy transition**: IC from tension axis, S-curve inflation, pilot pendulum ✅
- **Canopy flight**: 7-cell aero, brakes/risers/weight shift gamepad ✅

---

## Pilot-Canopy Control Inputs

Three distinct control mechanisms connect the pilot to the canopy. Each has different physics and visualization requirements. Getting these distinctions right is critical.

### Weight Shift — Pure Aero Control

**What it is:** The pilot shifts their hips laterally, which changes the loading on the left vs right riser groups. This warps the canopy shape — similar to pulling both front and rear risers asymmetrically. It is a **control input**, same category as brakes and risers.

**What it is NOT:** A mass/inertial rotation. The pilot's mass distribution doesn't change. The pilot doesn't roll to the side. There is no pendulum restoring force because there is no displacement of mass.

**Physics model:**
- `weightShiftLR` (-1 to +1) feeds into canopy segment Kirchhoff blending
- Differential span loading: shifts the effective riser geometry left/right
- Changes canopy shape → asymmetric lift → turn initiation
- Same implementation pattern as brakes and front/rear risers
- No mass model changes, no CG shift, no inertia changes

**Visualization:**
- Canopy deformation (visible in cell geometry changes, force vector asymmetry)
- Polar curve changes visible in static chart mode
- Pilot body does NOT visually rotate — the effect is in the canopy, not the pilot
- May need a subtle hip-shift visualization later, but NOT a roll rotation

**Slider:** Single `weight-shift-slider` already exists in HTML (-100 to +100). Currently wired to `controls.weightShiftLR` but **no segment responds to it yet**. Needs Kirchhoff implementation in canopy segments.

**Current code status:**
- ✅ Slider UI exists
- ✅ `SegmentControls.weightShiftLR` field exists and is piped from slider
- ✅ Gamepad reads left stick X as `lateralShift`
- ✅ Kirchhoff blending in canopy segments (differential tilt + CM)
- ✅ Inverse span scaling (collapsed span amplifies effect)
- ⬜ `pilotLateralEOM()` exists but is WRONG for weight shift — should be removed or repurposed

### Line Twist (Yaw) — Physical Rotation with Dynamics

**What it is:** The pilot's body rotates around the vertical axis relative to the canopy. The suspension lines twist around each other. This is a **physical rotation** with real geometry-dependent restoring torque.

**What it is NOT:** An aerodynamic control. Line twist does not change the canopy's Kirchhoff parameters or aerodynamic shape. The canopy doesn't know or care that the pilot is twisted.

**Physics model:**
- `pilotYaw` [rad] — physical rotation of pilot body relative to canopy
- Restoring torque from line geometry (sinusoidal, already in `pilotTwistEOM`)
- Damping from line friction and air resistance
- Gamepad twist recovery input (right stick X) already wired
- Can accumulate during deployment (bag tumble → line twist seed)

**Visualization:**
- **Must be drawn** as actual pilot rotation relative to canopy
- Pilot model rotates around the suspension line axis
- Lines visually twist (spiral pattern at high twist angles)
- This is a real geometric change that the viewer should show

**Slider:** Needs a dedicated `line-twist-slider` for static visualization and tuning outside of simulation. This lets us verify the restoring torque curve, see the visual rotation, and tune the twist dynamics before running it in the full sim.

**Current code status:**
- ✅ `pilotYaw`, `pilotYawDot` in SimStateExtended
- ✅ `pilotTwistEOM()` in eom.ts — sinusoidal restoring torque
- ✅ Integration in sim.ts (forwardEuler + RK4)
- ✅ Gamepad twist recovery input wired
- ✅ Deploy seeds line twist from bag tumble yaw
- ✅ 3D rendering: `pilotPivot.rotation.y` (nested inside pitch)
- ✅ Static slider ±360° for visualization
- ✅ HUD: amber >10°, flashing red >90° with direction/rate/recovery
- ⬜ Spiral line rendering (cosmetic, deferred)
- ⬜ Torsional coupling from canopy yaw rate (future)

### Pilot Pitch Pendulum — Physical Swing (existing)

For completeness: the pitch pendulum is the third pilot-canopy DOF.

- Physical swing of pilot body fore/aft under canopy
- Gravity restoring torque (body-frame gravity vector for singularity bypass)
- Rendered as `pilotPivot.rotation.x` in Three.js
- Cosmetic only — does not feed back into canopy aero (feedback loop disabled)
- No slider needed — driven by simulation dynamics

### Summary Table

| Control | Type | Changes Canopy Aero | Changes Pilot Orientation | Has Mass/Inertia | Slider |
|---------|------|--------------------|--------------------------|--------------------|--------|
| **Weight shift** | Aero control | ✅ Kirchhoff blending | ❌ No rotation | ❌ No | ✅ Exists |
| **Line twist** | Physical rotation | ❌ No | ✅ Yaw rotation | ✅ Yes (inertia) | ⬜ Needs slider |
| **Pilot pitch** | Physical swing | ❌ (disabled) | ✅ Pitch swing | ✅ Yes (pendulum) | N/A (sim only) |
| **Brakes** | Aero control | ✅ Kirchhoff blending | ❌ No | ❌ No | ✅ Exists |
| **Front risers** | Aero control | ✅ Kirchhoff blending | ❌ No | ❌ No | ✅ Exists |
| **Rear risers** | Aero control | ✅ Kirchhoff blending | ❌ No | ❌ No | ✅ Exists |

---

## Deploy Gamepad Phase

### Problem
When canopy transition happens (line stretch), gamepad switches instantly from wingsuit to full canopy controls. Pilot may still be holding wingsuit inputs → accidental riser/brake input during deployment. In reality:
- Brakes are **stowed** (Velcro) — pilot can't access them until after unzip
- Risers have **limited range** — pilot can reach them but the harness/wingsuit restricts motion
- Pilot needs to actively **unzip** the wingsuit arm wings before having full control

### Design: Deploy Gamepad Mode
Active from **line stretch** until **unzip complete**.

**Controls during deploy:**
| Input | Mapping | Range |
|-------|---------|-------|
| LT / RT (triggers) | **No brakes** — stowed | 0 (ignored) |
| Left stick Y | Left riser — **25% of normal range** | 0–0.25 |
| Right stick Y | Right riser — **25% of normal range** | 0–0.25 |
| Left stick X | Lateral weight shift (normal) | -1 to +1 |
| Right stick X | Twist recovery (normal) | -1 to +1 |
| **B button** | **Unzip** command | Toggle |

### Unzip Sequence
1. Pilot presses **B** at any time after A (deployment starts)
2. `unzipProgress` ramps from 0 → 1 over **1.5 seconds** (linear)
3. During unzip:
   - HUD overlay shows "UNZIPPING..." with progress bar
   - Pilot drag morphs (wingsuit → slick via existing `unzip` segment parameter)
   - Brake access gradually unlocked (0% → 100%)
   - Riser range gradually expands (25% → 100%)
4. At `unzipProgress = 1.0`:
   - Switch to full canopy gamepad
   - HUD shows "UNZIPPED" briefly

### State Machine

```
                    A button
   freefall ──────────────► deploy_zipped
                                │
                            B button
                                │
                                ▼
                          deploy_unzipping ──── 1.5s ────► canopy_full
                          (progress 0→1)                  (full controls)
```

If pilot never presses B, they stay in `deploy_zipped` with limited controls indefinitely. Realistic — some pilots fly the whole jump zipped up (sketchy but it happens).

## Simulation Overlay Updates

The HUD should actively coach the pilot through the deployment sequence. Flashing prompts for time-sensitive actions.

### During Deploy (zipped)
```
Phase: 🪂 Canopy
Deploy: 85% · Brakes: STOWED
Controls: risers (limited)
⚡ PRESS B TO UNZIP ⚡  (flashing)
```
The unzip prompt flashes continuously while zipped. If the pilot is trying to use brakes or full risers, they need to see immediately that they can't until they unzip.

### During Unzip
```
Phase: 🪂 Canopy  
Deploy: 100% · UNZIPPING [████░░░░░░] 60%
Controls: risers (expanding) · brakes (unlocking)
```

### Line Twist Warning
If `|pilotYaw| > threshold` (e.g. > 90°), overlay flashes a twist warning:
```
Phase: 🪂 Canopy
⚡ LINE TWIST — KICK TO RECOVER ⚡  (flashing)
Twist: 270° · Right stick X to kick
```
This flashes until the pilot recovers below the threshold. Real-world line twist is a critical emergency — the overlay should reflect that urgency.

### After Unzip (normal flight)
```
Phase: 🪂 Canopy
Deploy: 100% · Brakes: 30%
Controls: risers/brakes
```
(Normal canopy HUD, no special prompts)

## Effect on Aero Model

The `unzip` parameter morphs the pilot shape from wingsuit to slick:
- **Zipped** (unzip=0): wingsuit pilot drag, arm wings still creating area
- **Unzipped** (unzip=1.0): slick pilot, reduced drag, better GR

The `unzip` value maps to existing segment parameters:
- Arm wing area reduces as unzip progresses
- Leg wing tightens
- CD shifts from wingsuit profile to slick jumper profile

---

## Exit Phase (future)

Wingsuit BASE exit from a cliff/object:
- Standing start, body attitude matters
- Push-off velocity + direction
- Proximity terrain for reference
- Transition to freefall when clear of object

## Landing Phase (future)

- Flare detection (both brakes > 80% simultaneously)
- Ground contact: altitude ≈ 0, sink rate check
- Landing quality score (sink rate, ground speed, flare timing)
- Sim stops, stats displayed

---

## Implementation Plan

### Phase 1: Weight Shift Kirchhoff ✅
1. ✅ Kirchhoff blending for `weightShiftLR` in canopy segments (differential tilt + CM)
2. ✅ Verified with slider in static mode + gamepad in sim
3. ✅ Inverse span scaling for deploy effect
4. ⬜ Remove or repurpose `pilotLateralEOM` (models wrong physics)

### Phase 2: Line Twist Visualization ✅
5. ✅ Line-twist slider in HTML controls (±360°)
6. ✅ Pilot yaw rotation in 3D (`pilotPivot.rotation.y`, nested inside pitch)
7. ✅ HUD twist indicator with direction, rate, recovery status
8. ⬜ Spiral line rendering (cosmetic, deferred)

### Phase 3: Deploy Gamepad + Unzip ✅
9. ✅ `readDeployGamepad()` in `sim-gamepad.ts` — limited controls
10. ✅ Unzip state in `CanopyDeployManager` (B button, 1.5s ramp)
11. ✅ B button detection + gamepad mode selection based on phase + unzip
12. ✅ HUD overlay for deploy/unzip state (brakes stowed, progress bar, flash prompts)
13. ⬜ Wire unzip progress → `unzip` segment parameter (pilot drag morph)

### Phase 3.5: Airspeed Inflation + Slider Rendering ✅
14. ✅ Airspeed-dependent inflation model (K=1.0, V_REF=25, soft cap)
15. ✅ Slider GLB descends from canopy to above pilot head

### Phase 4: Cleanup + Polish
16. ⬜ Wire unzip → pilot drag morph (wingsuit → slick)
17. ⬜ Remove/repurpose `pilotLateralEOM()`
18. ⬜ Strip diagnostic logging
19. ⬜ Line twist torsional coupling from canopy yaw rate

### Phase 5: Exit + Landing (future)
20. ⬜ Exit scenario with terrain
21. ⬜ Landing detection + flare model
