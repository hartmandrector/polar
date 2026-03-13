# Stability Analysis — Natural Modes & Gamepad Filter Design

> Generated from `scripts/eigenvalue-analysis.ts` (commit `8e4ce60`)
> Polars: **ibexul** (Ibex UL canopy, 16 segments) and **a5segments** (Aura 5 wingsuit, 6 segments)

## 1. Executive Summary

The eigenvalue analysis reveals fundamentally different stability characteristics between the canopy and wingsuit, explaining why they feel so different on the gamepad and requiring different filter strategies:

| Property | Canopy (ibexul) | Wingsuit (a5segments) |
|----------|----------------|-----------------------|
| Speed range | 9–17 m/s | 25–55 m/s |
| Short period ζ | 0.50–0.92 | ~0.095 |
| Short period freq | ~1 Hz | 1–2 Hz (scales with V) |
| Phugoid period | ~6 s | ~20 s |
| Spiral stability | unstable >11 m/s | unstable >30 m/s |
| Primary pilot task | Turn management | Pitch management |

**Key insight:** The canopy is heavily damped in pitch (ζ=0.5–0.9) — inputs settle quickly. The wingsuit has almost no natural pitch damping (ζ≈0.095) — the pilot IS the pitch stability system. This matches Hartman's flight experience exactly.

---

## 2. Canopy Natural Modes (Ibex UL, 77.5 kg)

### 2.1 Trim Conditions

| V [m/s] | V [km/h] | α [°] | θ [°] | γ [°] | qDot [rad/s²] |
|---------|----------|-------|-------|-------|---------------|
| 10 | 36.0 | 10.1 | -12.6 | -22.7 | 0.71 |
| 12 | 43.2 | 5.0 | -26.8 | -31.8 | 4.64 |
| 14 | 50.4 | 2.0 | -42.8 | -44.7 | 8.22 |
| 16 | 57.6 | -0.7 | -66.4 | -65.7 | 11.77 |

Notes:
- Trim range ~9–17 m/s. Below 9 the wing can't generate enough lift; above 17 it's near-vertical.
- **qDot is nonzero at all trim points** — the canopy has a persistent nose-up moment due to CG offset (z=0.203m below aero center). In reality this is stabilized by the pilot pendulum.
- γ = -23° at 10 m/s (gentle glide) to -66° at 16 m/s (steep dive on front risers). Best glide ≈ 10 m/s.

### 2.2 Mode Table

**V = 10 m/s (trim flight):**

| Mode | σ [1/s] | ω [rad/s] | f [Hz] | ζ | T½ [s] | Stable |
|------|---------|-----------|--------|---|--------|--------|
| Short period | -3.92 | 6.76 | 1.08 | 0.50 | 0.18 | ✓ |
| Dutch roll | -0.33 | 1.00 | 0.16 | 0.31 | 2.09 | ✓ |
| Roll subsidence | -11.19 | — | — | 1.00 | 0.06 | ✓ |
| Spiral | -0.52 | — | — | 1.00 | 1.33 | ✓ |
| Slow real 1 | -0.34 | — | — | 1.00 | 2.05 | ✓ |
| Slow real 2 | -1.24 | — | — | 1.00 | 0.56 | ✓ |

**V = 12 m/s (accelerated):**

| Mode | σ [1/s] | ω [rad/s] | f [Hz] | ζ | T½ [s] | Stable |
|------|---------|-----------|--------|---|--------|--------|
| Short period | -5.32 | 6.14 | 0.98 | 0.66 | 0.13 | ✓ |
| Dutch roll | -0.36 | 1.01 | 0.16 | 0.34 | 1.90 | ✓ |
| Roll subsidence | -16.34 | — | — | 1.00 | 0.04 | ✓ |
| **Spiral** | **+1.10** | — | — | — | **0.63** | **✗** |
| Slow real | -0.47 | — | — | 1.00 | 1.46 | ✓ |
| Yaw damping | -3.49 | — | — | 1.00 | 0.20 | ✓ |

### 2.3 Canopy Mode Interpretation

**Short period (1 Hz, ζ=0.5–0.9):** Very well damped. Pitch disturbances settle in 1–2 oscillations. This is why brake inputs feel crisp — you pull, the canopy responds and settles. No pilot effort needed for pitch stability. Damping increases with speed (ζ=0.50 at 10 m/s → 0.92 at 16 m/s).

**Dutch roll (0.16 Hz, ζ=0.31–0.35):** Coupled yaw-roll oscillation with ~6 second period. Moderate damping — takes 3–4 oscillations to settle. This is the "wagging" you feel after releasing a turn input. Consistent across the speed range.

**Spiral mode:** Stable at trim speed (10 m/s), becomes unstable above ~11 m/s. Doubling time 0.63s at 12 m/s. Classic parafoil behavior — the canopy wants to tighten turns at speed. In practice the pilot manages this with opposite brake.

**Roll subsidence:** Very fast (T½=0.04–0.06s). Pure roll disturbances die instantly. This is the canopy's inherent roll stability from its arch/anhedral geometry.

---

## 3. Wingsuit Natural Modes (Aura 5, 77.5 kg, 6 segments)

### 3.1 Trim Conditions

| V [m/s] | V [km/h] | α [°] | θ [°] | γ [°] | qDot [rad/s²] |
|---------|----------|-------|-------|-------|---------------|
| 25 | 90 | 17.5 | -5.4 | -23.0 | -8.83 |
| 30 | 108 | 11.7 | -8.2 | -19.9 | -6.43 |
| 35 | 126 | 8.2 | -10.8 | -19.0 | -3.83 |
| 40 | 144 | 5.8 | -13.8 | -19.6 | -0.89 |
| 45 | 162 | 4.2 | -17.1 | -21.3 | 2.44 |
| 50 | 180 | 3.0 | -20.9 | -23.9 | 6.18 |
| 55 | 198 | 2.1 | -25.1 | -27.3 | 10.37 |

Notes:
- **Best glide at ~35 m/s** (γ=-19°, L/D ≈ 2.9) — matches real Aura 5 performance.
- α decreases smoothly 18° → 2° as speed increases — less lift angle needed at higher q.
- **qDot flips sign at ~40 m/s**: nose-down moment at low speed → nose-up at high speed. The crossover at 40 m/s means the wingsuit is naturally pitch-trimmed there. Below that, the suit wants to pitch down (increase speed); above, it wants to pitch up (decrease speed). This is **speed stability** — the system has a natural equilibrium near 40 m/s.
- Flight path angle γ has a minimum near 35 m/s (best glide) and steepens both slower and faster — the classic U-shaped polar curve.

### 3.2 Mode Table

**V = 35 m/s (best glide):**

| Mode | σ [1/s] | ω [rad/s] | f [Hz] | ζ | T½ [s] | Stable |
|------|---------|-----------|--------|---|--------|--------|
| Short period | -0.85 | 8.80 | 1.40 | 0.096 | 0.82 | ✓ |
| Phugoid | -0.11 | 0.32 | 0.05 | 0.33 | 6.30 | ✓ |
| **Lateral divergence** | **+9.56** | — | — | — | **0.07** | **✗** |
| Roll damping | -4.35 | — | — | 1.00 | 0.16 | ✓ |
| Yaw damping | -10.04 | — | — | 1.00 | 0.07 | ✓ |
| Slow stable | -0.03 | — | — | 1.00 | 23.3 | ✓ |

**V = 50 m/s (high speed):**

| Mode | σ [1/s] | ω [rad/s] | f [Hz] | ζ | T½ [s] | Stable |
|------|---------|-----------|--------|---|--------|--------|
| Short period | -1.17 | 12.26 | 1.95 | 0.095 | 0.59 | ✓ |
| Phugoid | -0.13 | 0.31 | 0.05 | 0.40 | 5.19 | ✓ |
| **Lateral divergence** | **+2.01** | — | — | — | **0.35** | **✗** |
| Roll damping | -5.95 | — | — | 1.00 | 0.12 | ✓ |
| Yaw damping | -2.67 | — | — | 1.00 | 0.26 | ✓ |
| Slow stable | -0.06 | — | — | 1.00 | 10.9 | ✓ |

### 3.3 Wingsuit Mode Interpretation

**Short period (1–2 Hz, ζ≈0.095):** This is the critical mode. With only 9.5% damping, a pitch disturbance takes ~7 oscillations to halve in amplitude. The pilot must actively damp pitch — using knees, arm position, and body tension. Frequency scales linearly with airspeed (1 Hz at 25 m/s → 2 Hz at 55 m/s), so the pilot's control bandwidth needs to increase with speed.

**Phugoid (0.05 Hz, ζ=0.26–0.42):** ~20 second period speed/altitude exchange. This is the "velocity response" Hartman describes — the very long loops around the final sustained speed. Moderately damped. At best glide (35 m/s, ζ=0.33) takes about 4 cycles (80 seconds) to settle to within 5% of trim speed. This dominates the feel of transitions between speed regimes.

**Lateral divergence:** The most concerning mode. At best glide, doubling time is only 0.07s — essentially instantaneous. This represents the wingsuit's tendency to yaw/sideslip divergently without active pilot control. In reality, the pilot uses leg/arm asymmetry and body tension to maintain directional stability. The divergence rate decreases at higher speed (T₂=0.35s at 50 m/s) as aerodynamic damping increases.

**Dutch roll at 25–30 m/s:** At low speed, a coupled yaw-roll oscillation appears (~0.5 Hz). At 30 m/s it's marginally unstable (σ=+0.09). Above 35 m/s this mode splits into separate roll/yaw real modes. This tracks with the known difficulty of flying wingsuits slowly — directional stability degrades.

---

## 4. Comparison & Implications

### 4.1 Why They Feel Different

| Aspect | Canopy | Wingsuit |
|--------|--------|----------|
| Pitch response | Self-stabilizing (ζ>0.5) | Pilot-stabilized (ζ≈0.1) |
| Speed transitions | Quick settling (~6s) | Slow loops (~80s to settle) |
| Turn behavior | Spiral divergence (managed by brakes) | Lateral divergence (managed by body position) |
| Input feel | Crisp, responsive, settles quickly | Requires constant management, oscillates |
| Danger zone | Low speed (stall) | Low speed (directional instability) |

### 4.2 What This Means for Gamepad Filter Design

The gamepad needs to bridge between human input bandwidth (~2–5 Hz voluntary, ~10 Hz reflex) and the vehicle's natural frequencies. Filters too aggressive → sluggish, can't control short period. Filters too light → noise excites oscillations.

**Principle:** The filter cutoff should be between the mode you want the pilot to control and the mode you want to suppress. Below the cutoff passes through; above gets smoothed out.

---

## 5. Gamepad Filter Recommendations

### 5.1 Canopy Filters

The canopy is well-damped and forgiving. Light filtering is sufficient.

| Input | Current | Recommended | Rationale |
|-------|---------|-------------|-----------|
| Brake triggers | None (raw) | **None** — keep raw | Short period ζ=0.5+ handles everything. Direct connection feels best. |
| Riser sticks | None (raw) | **Light EMA, τ≈0.05s** (fc≈3 Hz) | Risers can excite the dutch roll at 0.16 Hz — but the real issue is stick noise, not mode excitation. Light smoothing removes jitter without adding lag. |
| Weight shift | None (raw) | **None** — keep raw | Stiff spring model already acts as a filter. |
| Twist recovery | None (raw) | **None** — keep raw | Weak torque scale (2 N·m) limits excitation. |

**Canopy summary:** Mostly leave alone. The aerodynamic damping does the work. Optional light smoothing on risers for comfort.

### 5.2 Wingsuit Filters

The wingsuit needs more thoughtful filtering because ζ=0.095 means the vehicle amplifies oscillations.

| Input | Current | Recommended | Rationale |
|-------|---------|-------------|-----------|
| **Pitch throttle** | None (raw) | **EMA, τ≈0.10–0.15s** (fc≈1–1.5 Hz) | Critical axis. Cutoff at or just below short period frequency (~1.4 Hz at best glide). This lets the pilot set pitch attitude without exciting the lightly-damped oscillation. Too aggressive → can't control pitch at high speed where short period is ~2 Hz. |
| **Roll throttle** | None (raw) | **Light EMA, τ≈0.05s** (fc≈3 Hz) | Roll subsidence is fast (T½=0.16s) — the vehicle handles roll disturbances. Filter just removes stick noise. |
| **Yaw (triggers)** | None (raw) | **EMA, τ≈0.08s** (fc≈2 Hz) | Lateral divergence means yaw is sensitive. But triggers are analog (0–1), already smooth. Light smoothing prevents step inputs from exciting lateral modes. |

**Pitch filter detail:** An exponential moving average (EMA) with time constant τ:

```
filtered += (raw - filtered) * (dt / τ)
```

At τ=0.12s:
- Passes frequencies below ~1.3 Hz (pilot can control phugoid and slow pitch changes)
- Attenuates the short period at 1.4 Hz by ~30% at best glide
- At 55 m/s where short period is 2 Hz, attenuation is ~50%

This creates a natural feel: the faster you fly, the more the filter smooths pitch inputs, matching the increasing difficulty of pitch control at speed.

### 5.3 Speed-Adaptive Filtering (Future)

The short period frequency scales with airspeed. An optimal filter would adapt:

```
τ_pitch = 1 / (2π × f_shortPeriod × target_attenuation)
```

But fixed τ=0.12s is a good starting point. If the feel is right at best glide, we can tune from there.

---

## 6. Implementation Plan

### Phase 1: Add EMA to sim-gamepad.ts

Add a simple filter utility and state persistence:

```typescript
// In sim-gamepad.ts or a new sim-filter.ts
interface FilterState {
  pitchThrottle: number
  rollThrottle: number
  yawThrottle: number
}

function ema(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target
  const alpha = Math.min(1, dt / tau)
  return current + alpha * (target - current)
}
```

The filter state persists across frames in the SimRunner (not the gamepad reader — keep that pure).

### Phase 2: Wire into sim-runner.ts

After reading raw gamepad, apply filter before injecting into config:

```typescript
// In SimRunner.tick(), after readWingsuitGamepad():
const TAU_PITCH = 0.12
const TAU_ROLL = 0.05
const TAU_YAW = 0.08

this.filteredInput.pitchThrottle = ema(this.filteredInput.pitchThrottle, gp.pitchThrottle, DT, TAU_PITCH)
this.filteredInput.rollThrottle = ema(this.filteredInput.rollThrottle, gp.rollThrottle, DT, TAU_ROLL)
this.filteredInput.yawThrottle = ema(this.filteredInput.yawThrottle, gp.yawThrottle, DT, TAU_YAW)
```

### Phase 3: Expose filter constants in sim-ui.ts

Add sliders to the sim panel for real-time tuning:
- Pitch τ: 0–0.5s (default 0.12)
- Roll τ: 0–0.2s (default 0.05)
- Yaw τ: 0–0.3s (default 0.08)

This lets Hartman tune by feel with the gamepad while seeing the values.

### Phase 4: Validate with step response script

Record the response to a step input with and without filtering. Compare settling time, overshoot, and oscillation count. This closes the loop between analysis and feel.

---

## 7. Running the Analysis

```bash
cd polar-visualizer

# Single speed, full detail (A matrix printed):
npx tsx scripts/eigenvalue-analysis.ts ibexul 12

# Speed sweep:
npx tsx scripts/eigenvalue-analysis.ts ibexul
npx tsx scripts/eigenvalue-analysis.ts a5segments

# Available polars: ibexul, aurafive, a5segments, slicksin
```

### Limitations

1. **No pendulum in linearization.** The eigenvalue analysis uses the 9-state rigid body (no pilot pendulum DOFs). The canopy's qDot≠0 reflects this — in the real sim, the pendulum provides additional pitch damping. The true canopy short period may be even more damped than shown.

2. **No control effectiveness derivatives.** Current analysis shows open-loop stability only. Control derivatives (∂F/∂δ_brake, etc.) would quantify how much authority each input has at each speed — useful for gain scheduling.

3. **Single-body model.** The wingsuit analysis treats the 6 segments as one rigid body. In reality, body deformation (arm sweep, knee bend) changes the aerodynamic shape. This is captured in the gamepad throttle response but not in the linearization.

4. **`aurafive` (single-segment) doesn't work** — it has zero aero segments in the continuous polar. Use `a5segments` (6-segment model) for wingsuit analysis.

---

## Appendix: Mode Classification Reference

| Mode | Type | Characteristics |
|------|------|----------------|
| **Short period** | Oscillatory | Fast pitch oscillation. High frequency (1–10 Hz). Well-damped in stable aircraft. |
| **Phugoid** | Oscillatory | Slow speed/altitude exchange. Low frequency (0.01–0.1 Hz). Exchanges kinetic ↔ potential energy. |
| **Dutch roll** | Oscillatory | Coupled yaw-roll oscillation. Medium frequency (0.1–1 Hz). Most noticeable in lateral axis. |
| **Roll subsidence** | Real (stable) | Pure roll damping. Fast decay. Higher = more roll stability. |
| **Spiral** | Real (can be unstable) | Slow lateral divergence in turns. Unstable spiral = tightening turns. |
| **Heading** | Real (neutral) | σ≈0 always. Yaw angle is neutrally stable — no restoring force to a heading. |

---

*Document: `docs/sim/STABILITY-ANALYSIS.md`*
*Last updated: 2026-03-13*
*Source: `scripts/eigenvalue-analysis.ts` commit `8e4ce60`*
