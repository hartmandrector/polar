# Paraglider Roll Model

**Source:** A. Nagy, Prof. J. Roha — "2D Physical Model of Paragliders" (831paraglider roll.pdf)

## Overview

The paper presents a simplified 6DOF model split into **longitudinal** (pitch plane) and **transversal** (roll plane) sub-models, treating the canopy-lines-pilot system as a rigid body.

---

## Longitudinal Model (§2.1)

Forces and moments in the pitch plane. Canopy and pilot have separate aero:

### Force equations at system point SP

```
X_SP = X_w + X_p + (m·g)_b
Z_SP = Z_w + Z_p + (m·g)_b                                     (1)
```

### Moment equation at SP

```
M_SP = Z_w·(X_SPw − X_ACw) − X_w·k_w
     + Z_p·(X_SPp − X_ACp) − X_p·k_p + M_w + M_p              (2)
```

### Newton's second law

```
X_SP = m·(ẍ + q̈·ż)
Z_SP = m·(z̈ − q·ẋ)
M_SP = I_y·θ̈,   θ̇ = q_E                                      (3)
```

### Aero forces (wing and pilot, wind frame)

```
L_w = −[C_Lw · (ρ/2) · v² · S_w],   C_Lw = f(α)
D_w = −[C_Dw · (ρ/2) · v² · S_w],   C_Dw = f(α)              (4)

L_p = −[C_Lp · (ρ/2) · v² · S_p],   C_Lp = f(α)
D_p = −[C_Dp · (ρ/2) · v² · S_p],   C_Dp = f(α)              (5)
```

### Relevance to our estimator

Equations (4)-(5) are what we already do: separate canopy and pilot aero forces. Equation (2) adds the **moment arm geometry** — lever arms from each component's AC to the system point. Our current estimator doesn't compute moments, which limits pitch dynamics accuracy.

---

## Transversal Model (§2.3)

Roll-plane moment equilibrium about the system CG. This is the key addition for improving our roll estimate.

### Moment equilibrium about CG

```
−M_ΔFb − M_Fcf1 + M_Fcf2 + M_Gp − M_Gk = 0                  (6)
```

### Expanded (equation 7)

```
−ΔF_b·k₁ − (G_p/g)·(v²/R)·k₃·cos(γ) + (G_k/g)·(v²/R)·k₂·cos(γ)
  + G_p·sin(γ)·k₃ − G_k·sin(γ)·k₂ = 0                        (7)
```

### Parameters

| Symbol | Description | Source |
|--------|-------------|--------|
| k₁ | Distance: wing lift force → system CG | Geometry (≈ line length) |
| k₂ | Distance: canopy CG → system CG | Geometry (mass split) |
| k₃ | Distance: pilot CG → system CG | Geometry (mass split) |
| G_p | Weight of pilot [N] | Known (config) |
| G_k | Weight of canopy [N] | Known (config) |
| v | Airspeed [m/s] | GPS pipeline |
| R | Turn radius [m] | GPS heading rate: R = v / ω |
| γ | Bank angle [rad] | **Solved for** |
| ΔF_b | Asymmetric brake force [N] | Unknown (input) |

### Physical interpretation

Equation (7) balances five moments in the roll plane:

1. **−ΔF_b · k₁** — asymmetric brake input (the pilot's control)
2. **−(G_p/g) · (v²/R) · k₃ · cos(γ)** — centrifugal moment on pilot
3. **+(G_k/g) · (v²/R) · k₂ · cos(γ)** — centrifugal moment on canopy
4. **+G_p · sin(γ) · k₃** — gravity moment on pilot (restoring)
5. **−G_k · sin(γ) · k₂** — gravity moment on canopy (restoring)

---

## Simplified Coordinated Turn Roll

When brake input is unknown (ΔF_b = 0, i.e. no asymmetric control or steady-state turn) and canopy mass is negligible relative to pilot mass, equation (7) reduces to:

```
γ = atan(v² / (g · R))
```

This is the standard **coordinated turn bank angle** — derivable from centripetal force balance. It requires only velocity and turn radius, both available from GPS.

**Turn radius from GPS:**
```
ω = d(heading)/dt   [rad/s]   (heading rate from SG filter)
R = v / ω                      (undefined for straight flight, ω → 0)
```

### When this works
- Steady-state coordinated turns
- No brake asymmetry (or symmetric braking)
- Pilot mass >> canopy mass (good approximation: ~80kg vs ~5kg)

### When this fails
- Dynamic turn entry/exit (transient)
- Significant asymmetric brake input
- Very slow speed (R → ∞, ω → 0, noisy)

---

## Full Equation Roll (Equation 7)

For the full equation, we solve for γ given known v, R, masses, and geometry. Rearranging equation (7) with ΔF_b = 0 (unknown, treat as zero or estimate separately):

```
sin(γ) · (G_p·k₃ − G_k·k₂) = cos(γ) · (v²/R) · (G_p·k₃ − G_k·k₂) / g
```

This simplifies to the same atan(v²/(gR)) when the mass-arm products are equal — but when k₂ ≠ k₃ (canopy CG and pilot CG at different distances from system CG), the equilibrium bank shifts.

In practice, with G_p >> G_k, the correction is small (~1-2°). The main value of the full equation is the **framework for incorporating ΔF_b** if we later estimate brake asymmetry from riser tension or other data.

---

## Implementation Notes

- **Heading rate ω** is available from the SG filter pipeline (already computed for GPS heading)
- **Singularity at ω → 0**: straight flight, R → ∞. Fall back to aero-extraction roll when |ω| < threshold
- **Blending**: could blend coordinated-turn roll with aero-extraction roll based on turn rate magnitude — use coordinated turn in established turns, aero extraction in straight flight
- **Sign convention**: positive γ = right bank, consistent with NED (positive heading rate = turning right)
- **Wind correction**: R should ideally be computed from airspeed heading rate, not ground track heading rate. Without wind estimate, ground track is the best we have.

## Implementation Status

### Transversal model (roll) — ✅ Implemented
- `coordinatedTurnRoll()` — simple v·ω/g formula
- `fullTransversalRoll()` — equation 7 with mass geometry
- Blended mode with heading-rate-based switching
- All in `canopy-estimator.ts`, selectable via `rollMethod` config

### Longitudinal model (pitch moments) — Deferred to flying filter
The longitudinal model's moment equation (2) is a **dynamic model** — it predicts how AoA evolves under moment imbalance. This is fundamentally different from our current **kinematic extraction** which observes AoA from measured forces.

Using the moment equation as an estimator requires either:
1. Forward simulation matched to GPS observations (= Kalman filter)
2. Dynamic AoA constraint alongside kinematic extraction

Both approaches are exactly what the **orientation EKF** in the dual-filter architecture is designed to do (see `docs/FILTER-ARCHITECTURE.md`). The pitch moment from the aero model becomes the EKF's prediction step, and GPS-derived kinematics become the measurement update.

**Decision:** The longitudinal model feeds into the flying filter design, not the canopy estimator. The canopy estimator remains a kinematic extraction tool. The filter will use the full dynamic model when implemented.
