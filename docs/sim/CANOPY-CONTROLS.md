# Canopy Control Mechanisms

How riser, brake, and weight shift inputs modify per-cell aerodynamics in the simulation.

**Key distinction:** All four control inputs (front risers, rear risers, brakes, weight shift) are **pure aerodynamic controls** that modify canopy shape via Kirchhoff blending. None of them involve physical rotation of the pilot body or mass/CG changes. See [PILOT-COUPLING.md](PILOT-COUPLING.md) for physical pilot rotations (pitch pendulum, line twist).

## Mechanism Summary

Each control input applies up to 5 effects on the parent canopy cell:

| Mechanism | Front Riser | Rear Riser | Brakes | Weight Shift |
|-----------|:-----------:|:----------:|:------:|:------------:|
| **α offset** (local AoA shift) | −6° | +6° | +2.5° | ⬜ TBD |
| **Force vector tilt** (cell pitch rotation) | −0.35 rad | 0.06 rad | 0.14 rad | ⬜ TBD |
| **Pitching moment** (system trim shift) | −0.15 | +0.10 | −0.04 | ⬜ TBD |
| **Drag bump** (cd_0 increase) | 0 | 0 | 0.12 | ⬜ TBD |
| **Camber change** (δ control derivatives) | — | — | yes | — |
| **Span loading shift** (differential L/R) | — | — | — | ⬜ TBD |

## Per-Input Detail

### Front Risers
Physically shortens A-lines → pulls leading edge down → canopy dives.

| Parameter | Value | Effect |
|-----------|-------|--------|
| `ALPHA_MAX_FRONT_RISER` | 6° | Local α decreases (less lift per cell) |
| `RISER_PITCH_MAX_RAD` | −0.35 (~20° nose-up) | Force vector tilts backward on pulled side → drag asymmetry → yaw toward input |
| `FRONT_RISER_CM` | −0.15 (large, intentional for tuning range) | Nose-down pitching moment → system trims to lower AoA → steeper/faster |
| `FRONT_RISER_CD_BUMP` | 0 | Currently disabled |

Primary turn mechanism: backward force vector tilt creates asymmetric drag → yaw toward pulled side.
Primary speed mechanism: CM shifts trim point to lower AoA.
Note: negative tilt (nose-up) was the only stable configuration — positive tilt (nose-down) caused instability.

### Rear Risers
Physically shortens D-lines → pulls trailing edge down → canopy flares.

| Parameter | Value | Effect |
|-----------|-------|--------|
| `ALPHA_MAX_RISER` | 6° | Local α increases (more lift per cell) |
| `REAR_RISER_PITCH_MAX_RAD` | 0.06 (~3.4° nose-up) | Force vector tilts backward (small — AoA does the work) |
| `REAR_RISER_CM` | +0.10 (large, intentional for tuning range) | Nose-up pitching moment → system trims to higher AoA → flatter/slower |
| `REAR_RISER_CD_BUMP` | 0 | Currently disabled |

Primary turn mechanism: asymmetric α increase → asymmetric lift → yaw.
Primary flare mechanism: CM shifts trim point to higher AoA.

### Brakes
Physically deflects trailing edge fabric downward → adds camber + drag plate.

| Parameter | Value | Effect |
|-----------|-------|--------|
| `BRAKE_ALPHA_COUPLING_DEG` | 2.5° | TE deflection increases effective AoA on parent cell |
| `BRAKE_PITCH_MAX_RAD` | 0.14 (~8° nose-up) | Force vector tilts backward → yaw toward braked side |
| `BRAKE_CD_BUMP` | 0.12 | TE distortion parasitic drag on parent cell |
| `cm_delta` | −0.04 | Kirchhoff pitching moment from camber change |
| `δ` derivatives | full set | `d_alpha_0: −16`, `d_cd_0: 0.04`, `d_cl_alpha: 1.2`, `d_k: 0.02` |
| Center cell coupling | 50% | Center cell gets `avg(L,R) * 0.5` brake through fabric tension |

Brake flaps are separate `AeroSegment`s with their own polar (`BRAKE_FLAP_POLAR`):
- `cl_alpha: 2.0` (fabric, not airfoil)
- `alpha_stall_fwd: 18°` (transitions to drag plate at moderate brake)
- `cd_0: 0.06`, `cd_n: 1.2`

Primary turn mechanism: asymmetric drag (bump + tilt) → yaw toward braked side.
Primary flare mechanism: camber increase across all cells → higher CL at higher AoA.

### Weight Shift
Physically shifts pilot hips laterally within harness → changes relative loading on left vs right riser groups → warps canopy shape.

**⬜ Not yet implemented** — `weightShiftLR` field exists in `SegmentControls` and the slider is wired, but no canopy segment responds to it.

**What it is:** A pure aerodynamic control, same category as brakes and risers. The pilot changes the geometry of the riser loading, which warps the canopy. This is Kirchhoff blending — the canopy shape changes, producing differential lift and drag.

**What it is NOT:** A physical rotation of the pilot body. The pilot's mass distribution does not change. There is no CG shift, no inertial rotation, no pendulum restoring force. The `pilotLateralEOM()` in eom.ts models this incorrectly as a mass pendulum and should be removed or repurposed.

**Planned implementation:**
- `weightShiftLR` (-1 to +1) feeds into canopy segment Kirchhoff blending
- Differential effect: left/right cells get asymmetric parameter shifts
- Likely a combination of force vector tilt + α offset (similar to combined front+rear riser pull on one side)
- Specific parameter values TBD — need to tune against real canopy turn behavior
- Visible in static polar curves via existing slider

## Force Vector Tilt (`cellPitchRad`)

The core geometric mechanism shared by all three control inputs. When a control input physically rotates a cell about the span axis, the **entire force vector** (lift + drag) rotates in the body x-z plane:

```
fx' = fx·cos(δ) − fz·sin(δ)
fz' = fx·sin(δ) + fz·cos(δ)
```

- **Positive δ (nose-down)**: lift tilts forward → creates thrust on that side
- **Negative δ (nose-up)**: lift tilts backward → creates drag on that side

All three controls currently use **nose-up tilt** (negative or positive convention depending on input sign), creating yaw through drag asymmetry. Front riser nose-down tilt was tested but caused instability.

Applied in both `sumAllSegments()` and `evaluateAeroForcesDetailed()` in `aero-segment.ts`.

## Gamepad Mapping

See [GAMEPAD.md](GAMEPAD.md) for full mapping details.

| Input | Control |
|-------|---------|
| Left stick Y forward | Front risers (both sides) |
| Left stick Y back | Rear risers (both sides) |
| Left stick X | Lateral weight shift |
| LT | Left brake |
| RT | Right brake |
| Right stick X | Twist recovery torque |

## Tuning History

1. Added `cellPitchRad` force vector tilt — fixed turn direction for front risers
2. Split front/rear α and tilt constants — different physics per input
3. Added brake coupling to parent cells (pitch + drag) — matching riser pattern
4. Retuned `BRAKE_FLAP_POLAR` — low stall angle for drag-plate behavior at high brake
5. Increased parent cell brake derivatives — maintain glide ratio (~2.8:1) under brakes
6. Added center cell partial brake coupling (50%) — spanwise fabric tension
7. Raised canopy `cd_0` floor (0.035 → 0.055) — realistic speed range
8. Added `FRONT_RISER_CM` / `REAR_RISER_CM` — direct system trim shift
9. Fixed gamepad variable name swap — forward=front, back=rear
10. Front riser tilt inverted to negative (nose-up) — only stable configuration
11. Brake tilt increased to 0.14, drag bump to 0.12 — more turn authority
