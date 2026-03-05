# Canopy Control Mechanisms

How riser, brake, and weight shift inputs modify per-cell aerodynamics in the simulation.

## Mechanism Summary

Each control input applies up to 5 effects on the parent canopy cell:

| Mechanism | Front Riser | Rear Riser | Brakes |
|-----------|:-----------:|:----------:|:------:|
| **α offset** (local AoA shift) | −6° | +6° | +2.5° |
| **Force vector tilt** (cell pitch rotation) | 8.6° nose-down | 3.4° nose-up | 3.4° nose-up |
| **Pitching moment** (system trim shift) | −0.15 (nose-down) | +0.10 (nose-up) | −0.04 (cm_delta) |
| **Drag bump** (cd_0 increase) | 0 | 0 | 0.08 |
| **Camber change** (δ control derivatives) | — | — | yes (full Kirchhoff) |

## Per-Input Detail

### Front Risers
Physically shortens A-lines → pulls leading edge down → canopy dives.

| Parameter | Value | Effect |
|-----------|-------|--------|
| `ALPHA_MAX_FRONT_RISER` | 6° | Local α decreases (less lift per cell) |
| `RISER_PITCH_MAX_RAD` | 0.15 (~8.6°) | Force vector tilts forward → thrust on pulled side → yaw + dive |
| `FRONT_RISER_CM` | −0.15 | Nose-down pitching moment → system trims to lower AoA → steeper/faster |
| `FRONT_RISER_CD_BUMP` | 0 | Currently disabled |

Primary turn mechanism: geometric force vector tilt creates asymmetric thrust.
Primary speed mechanism: CM shifts trim point to lower AoA.

### Rear Risers
Physically shortens D-lines → pulls trailing edge down → canopy flares.

| Parameter | Value | Effect |
|-----------|-------|--------|
| `ALPHA_MAX_RISER` | 6° | Local α increases (more lift per cell) |
| `REAR_RISER_PITCH_MAX_RAD` | 0.06 (~3.4°) | Force vector tilts backward (small — AoA does the work) |
| `REAR_RISER_CM` | +0.10 | Nose-up pitching moment → system trims to higher AoA → flatter/slower |
| `REAR_RISER_CD_BUMP` | 0 | Currently disabled |

Primary turn mechanism: asymmetric α increase → asymmetric lift → yaw.
Primary flare mechanism: CM shifts trim point to higher AoA.

### Brakes
Physically deflects trailing edge fabric downward → adds camber + drag plate.

| Parameter | Value | Effect |
|-----------|-------|--------|
| `BRAKE_ALPHA_COUPLING_DEG` | 2.5° | TE deflection increases effective AoA on parent cell |
| `BRAKE_PITCH_MAX_RAD` | 0.06 (~3.4°) | Force vector tilts backward (like rear riser) |
| `BRAKE_CD_BUMP` | 0.08 | TE distortion parasitic drag on parent cell |
| `cm_delta` | −0.04 | Kirchhoff pitching moment from camber change |
| `δ` derivatives | full set | `d_alpha_0: −16`, `d_cd_0: 0.04`, `d_cl_alpha: 1.2`, `d_k: 0.02` |
| Center cell coupling | 50% | Center cell gets `avg(L,R) * 0.5` brake through fabric tension |

Brake flaps are separate `AeroSegment`s with their own polar (`BRAKE_FLAP_POLAR`):
- `cl_alpha: 2.0` (fabric, not airfoil)
- `alpha_stall_fwd: 18°` (transitions to drag plate at moderate brake)
- `cd_0: 0.06`, `cd_n: 1.2`

Primary turn mechanism: asymmetric drag + force vector tilt.
Primary flare mechanism: camber increase across all cells → higher CL at higher AoA.

## Force Vector Tilt (`cellPitchRad`)

The core geometric mechanism shared by all three control inputs. When a control input physically rotates a cell about the span axis, the **entire force vector** (lift + drag) rotates in the body x-z plane:

```
fx' = fx·cos(δ) − fz·sin(δ)
fz' = fx·sin(δ) + fz·cos(δ)
```

- **Nose-down (positive δ)**: lift tilts forward → creates thrust on that side → yaw toward input, pitch down
- **Nose-up (negative δ)**: lift tilts backward → creates drag on that side → yaw toward input, pitch up

Applied in both `sumAllSegments()` and `evaluateAeroForcesDetailed()` in `aero-segment.ts`.

## Gamepad Mapping

| Stick | Direction | Control |
|-------|-----------|---------|
| Left Y | Push forward | Front risers (left side) |
| Left Y | Pull back | Rear risers (left side) |
| Right Y | Push forward | Front risers (right side) |
| Right Y | Pull back | Rear risers (right side) |
| LT | Analog | Left brake |
| RT | Analog | Right brake |
| Left X | Left/Right | Lateral weight shift |
| Right X | Left/Right | Twist recovery torque |

## Tuning History

Starting from the original single `ALPHA_MAX_RISER = 10` for both risers:

1. Added `cellPitchRad` force vector tilt — fixed turn direction for front risers
2. Split front/rear α and tilt constants — different physics per input
3. Added brake coupling to parent cells (pitch + drag) — matching riser pattern
4. Retuned `BRAKE_FLAP_POLAR` — low stall angle for drag-plate behavior at high brake
5. Increased parent cell brake derivatives — maintain glide ratio (~2.8:1) under brakes
6. Added center cell partial brake coupling (50%) — spanwise fabric tension
7. Raised canopy `cd_0` floor (0.035 → 0.055) — realistic speed range
8. Added `FRONT_RISER_CM` / `REAR_RISER_CM` — direct system trim shift
9. Fixed gamepad variable name swap — forward=front, back=rear
