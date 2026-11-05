# ESKF Attitude Filter — High-Level Overview

How the GPS-velocity-aided error-state Kalman filter (ESKF) works, and how this project uses it.

The filter lives in the **sensor fusion project** (`sensor_fusion_viewer/fusion_viewer/src/eskf/`, design notes in `GPS-VELOCITY-AIDED-ESKF-PLAN.md`). This project only consumes its export: the GPS viewer uses it to orient the head model and draw the head sensor vectors (see [GPS-VIEWER.md → Head Sensor Overlay](GPS-VIEWER.md#head-sensor-overlay)).

## The problem it solves

A FlySight has a gyro, an accelerometer, and GPS. Each alone is not enough for attitude in flight:

- **Gyro** integrates rotation smoothly, but any bias makes the attitude drift without limit.
- **Accelerometer** measures *specific force* (everything except gravity), not gravity alone. On the ground it points "up", so it gives tilt. In flight it is dominated by aerodynamic force, so treating it as an "up" reference gives wrong attitude.
- **GPS** gives velocity in the earth frame, but nothing about which way the device is facing.

The ESKF combines them so that **GPS velocity corrects the attitude**. It treats the accelerometer as a propagation input, never as a gravity measurement.

## Frames and conventions

| Item | Convention |
|---|---|
| Navigation frame | Local **NWU** (North, West, Up) |
| Body frame | Firmware IMU axes after the axis remap |
| Quaternion | Hamilton, scalar-first `[w, x, y, z]`, body-to-navigation `q_NB` |
| Attitude error | Right-multiplicative: `q_true = q ⊗ Exp(δθ)`, `δθ` in body axes |
| Units | SI internally (m/s², rad/s); the CSV export uses g and °/s |

## State

| Nominal state | Error state (15) |
|---|---|
| position `p` (relative, NWU) | `δp` (3) |
| velocity `v` (NWU) | `δv` (3) |
| attitude `q` | `δθ` (3, small rotation) |
| gyro bias `b_g` | `δb_g` (3) |
| accel bias `b_a` | `δb_a` (3) |

The **nominal** state is propagated with the full nonlinear equations. The **error** state is small, so a linear Kalman filter tracks it with a 15×15 covariance `P`. After each GPS update, the estimated error is folded back into the nominal state and reset to zero. That is the "error-state" part.

## Propagation (every IMU sample, ~100 Hz)

Strapdown inertial navigation:

```text
q ← q ⊗ Exp((ω − b_g)·dt)               attitude from the gyro
a  = R(q)·(f − b_a) + g                  earth-frame acceleration, g = [0, 0, −9.81]
v ← v + a·dt                             velocity from the accelerometer
p ← p + v·dt + ½·a·dt²
```

At the same time, the covariance is propagated with the error dynamics. The line that matters for attitude alignment is:

```text
δv' = −R·[f]× · δθ  −  R·δb_a
```

An attitude error `δθ` rotates the measured specific force `f` the wrong way, so velocity is integrated in a slightly wrong direction. Propagating `P` with this equation builds a **correlation between velocity error and attitude error**.

## How the velocity innovation aligns attitude

When a GPS velocity fix arrives (~20 Hz on this track), the filter compares it with its own velocity:

```text
innovation  y = v_GPS − v_filter
```

The measurement only observes velocity, so `H = [0 I 0 0 0]`. The Kalman gain is still non-zero for the attitude rows, because `P` couples `δv` and `δθ`:

```text
K = P·Hᵀ·(H·P·Hᵀ + R)⁻¹        the attitude rows of K come from the δv–δθ covariance
δx = K·y                        corrections to velocity AND attitude AND biases
```

Intuitively: *"the velocity drifted in this direction; the attitude error that would have pushed it that way is δθ, so rotate by −δθ."*

**Sensitivity example:** a 1° tilt error with 1 g of specific force misdirects 9.81·sin(1°) ≈ 0.17 m/s² of acceleration, about 0.17 m/s of velocity error after one second. That is several times the GPS velocity noise (≈0.05–0.3 m/s), so tilt errors of about a degree become visible within a second or two.

### What is observable when

The error term `[f]×·δθ` is blind to rotation **about** the specific-force direction. Only rotation about axes perpendicular to `f` shows up in velocity.

| Flight condition | Specific force `f` | What GPS velocity can correct |
|---|---|---|
| Static on the ground, or steady glide | ≈ 1 g, roughly "up" | Tilt (roll/pitch). **Not heading**, which is rotation about `f`. |
| Turns, flares, speed changes, deployment | Changes direction | Heading too, as `f` rotates relative to the earth |
| Near-ballistic free fall (exit) | ≈ 0 | Almost nothing. Gyro-only coasting; uncertainty grows. |

Accelerometer bias produces the same signature as tilt while `f` is constant (`−R·δb_a` vs `−R·[f]×·δθ`). The filter separates them only as the attitude changes. A good uncertainty estimate (heading σ, tilt σ) is therefore part of the output, not an afterthought.

## The update in practice

- **Measurement noise** comes from the receiver's speed accuracy (`sAcc`) with a floor. Fixes with too few satellites or large `sAcc` are dropped.
- **Outlier gating:** the normalized innovation squared (NIS) is checked against a χ²(3) threshold (99.9%), and bad fixes are rejected.
- **Numerics:** a Cholesky solve, Joseph-form covariance update, and an attitude reset Jacobian when `δθ` is injected keep `P` healthy.
- **Lifecycle:** `aided` → `coasting` (no accepted fix for 1 s) → `unhealthy` (IMU gaps, repeated rejections, broken covariance), with automatic re-initialization.
- **Initialization:** velocity from the first good GPS fix; attitude from leveling (static specific force) plus a heading seed, or from another quaternion source, with explicit uncertainty.

## What this project reads from the export

From `SENSOR_fused_eskf.csv`:

| Column | Meaning | Used for |
|---|---|---|
| `qw, qx, qy, qz` | Attitude, NWU, acting on the remapped vector `[s_z, s_x, s_y]` | Head model orientation |
| `accel_earth_*` | Raw accel rotated to NWU, gravity included (specific force) | Yellow head arrow |
| `earth_accel_*` | `R·(f − b_a) + g`: calibrated, gravity removed (kinematic acceleration) | Orange head arrow |
| `gyro_*` | Body angular rate | Gyro arcs on the head |

`accel_earth − earth_accel` ≈ 1 g up (gravity plus the bias estimate). That is a quick sanity check of the export.

## Current limits

- **Offline replay.** It is causal in measurement time (no future data), but not yet real-time on the device.
- **Collocated assumption.** The antenna-to-IMU lever arm is not modeled yet; it matters during fast head motion.
- **No magnetometer, barometer or position updates** in this version; GPS velocity is the only aiding.
- **Heading is weakly observable in straight flight**, as above.

## Future direction: real-time on the device

The same structure supports running live on the FlySight:

- **Higher-rate velocity:** between GPS fixes, the propagated velocity (`v ← v + a·dt`) is a valid estimate at the IMU rate (~100 Hz), not just 20 Hz. The GPS updates keep it from drifting by continuously re-estimating attitude and accel bias. The sensor fusion project's dropout test (`dropout.ts`) already measures this: it withholds GPS for 1–10 s and compares IMU-predicted velocity against the missing fixes and against a "hold last velocity" baseline.
- **Better attitude means better acceleration**, and better acceleration means velocity can coast longer between, or without, fixes. The calibrated `earth_accel` is exactly the term integrated into velocity.
- **On-device requirements:**
  - A delayed-state buffer, or a fusion horizon, so a GPS fix is applied at its true measurement epoch rather than to the latest state.
  - A compute budget for 15×15 covariance propagation at IMU rate (or propagating `P` at a lower rate than the nominal state).
  - Measured GPS latency and a lever arm before relying on fast head-motion results.
