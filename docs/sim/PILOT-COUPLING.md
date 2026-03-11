# Pilot–Canopy 3-DOF Coupling

**Status**: Pitch and twist implemented and integrated. Lateral weight shift needs reclassification — it is NOT a mass/inertial rotation (see §6.2 update).

Extends the 1-DOF pitch pendulum (FRAMES.md §12) to relative rotation between pilot and canopy at the riser confluence point.

**Key update (2026-03-11):** Weight shift is a **pure aero control** (Kirchhoff blending), not a physical rotation. The lateral DOF modeled here as a stiff spring pendulum is incorrect for weight shift. See [WINGSUIT-BASE-FLOW.md](WINGSUIT-BASE-FLOW.md) for the corrected classification.

**Reference:** Slegers, N. & Costello, M. (2003). "Aspects of Control for a Parafoil and Payload System." *Journal of Guidance, Control, and Dynamics*, 26(6). DOI: 10.2514/2.6933

---

## 1  Two-Body System

The system consists of two rigid bodies sharing a common **confluence point** $C$ where the suspension lines converge at the riser tops:

| Body | Symbol | Description |
|------|--------|-------------|
| Canopy | $\mathcal{C}$ | Parafoil + suspension lines above $C$ |
| Payload | $\mathcal{P}$ | Pilot + harness + risers below $C$ |

Each body has its own body frame, CG, inertia tensor, and aerodynamic model. The bodies are constrained to share position at $C$ but are free to rotate relative to each other.

---

## 2  Frames and Nomenclature

Following FRAMES.md conventions (NED, 3-2-1 Euler):

| Frame | Notation | Definition |
|-------|----------|------------|
| Inertial | $E$ | NED Earth frame (FRAMES.md §2.1) |
| Canopy body | $B_C$ | Fixed to canopy, origin at canopy CG |
| Payload body | $B_P$ | Fixed to pilot, origin at pilot CG |

**Euler angles** (3-2-1 sequence, FRAMES.md §3):
- Canopy: $(\psi_C, \theta_C, \phi_C)$ — heading, pitch, roll
- Payload: $(\psi_P, \theta_P, \phi_P)$ — heading, pitch, roll

**Angular velocities** in respective body frames:
- Canopy: $\vec{\omega}_C = (p_C, q_C, r_C)$
- Payload: $\vec{\omega}_P = (p_P, q_P, r_P)$

**Relative rotation** — payload orientation relative to canopy:

$$\vec{\delta} = (\delta_\phi,\; \delta_\theta,\; \delta_\psi)$$

where:
- $\delta_\theta = \theta_P - \theta_C$ — relative pitch (fore/aft swing) — **existing `thetaPilot`**
- $\delta_\phi = \phi_P - \phi_C$ — relative roll (lateral weight shift)
- $\delta_\psi = \psi_P - \psi_C$ — relative yaw (line twist)

---

## 3  Confluence Point Constraint

Both bodies share the same inertial position at $C$. In each body's frame, the vector from its CG to $C$ is:

$$\vec{r}_{C/CG_C}^{B_C} = \text{canopy CG to confluence (in canopy body frame)}$$

$$\vec{r}_{C/CG_P}^{B_P} = \text{pilot CG to confluence (in payload body frame)}$$

The constraint in inertial coordinates:

$$\vec{R}_{CG_C} + [EB_C]\,\vec{r}_{C/CG_C}^{B_C} = \vec{R}_{CG_P} + [EB_P]\,\vec{r}_{C/CG_P}^{B_P}$$

where $[EB_C]$ and $[EB_P]$ are the body→inertial DCMs (FRAMES.md §4.1) for each body.

This is a **holonomic constraint** — it eliminates 3 translational DOF from one body. We track one body's position and derive the other from the constraint.

---

## 4  Equations of Motion — Translational

For each body, the translational EOM follows FRAMES.md §6.1:

$$m_C \left(\frac{{}^{B_C} d\vec{V}_C}{dt} + \vec{\omega}_C \times \vec{V}_C\right) = \vec{F}_{aero,C} + m_C \vec{g}_C + \vec{T}$$

$$m_P \left(\frac{{}^{B_P} d\vec{V}_P}{dt} + \vec{\omega}_P \times \vec{V}_P\right) = \vec{F}_{aero,P} + m_P \vec{g}_P - \vec{T}$$

where $\vec{T}$ is the **constraint force** (tension) at the confluence point — equal and opposite on each body (Newton's third law). Gravity in each body frame: $\vec{g}_C = [B_C E]\,(0, 0, g)^T$ per FRAMES.md §9.

**Simplified (single translational state):** Sum both equations to eliminate $\vec{T}$:

$$M\,\vec{a}_{\text{sys}} = \vec{F}_{aero,C} + \vec{F}_{aero,P} + M\vec{g}$$

where $M = m_C + m_P$ and $\vec{a}_{\text{sys}}$ is the system CG acceleration. This is what our current single-body sim already computes — the constraint force is internal and vanishes from the system-level equation.

---

## 5  Equations of Motion — Rotational

Each body has independent rotational dynamics (FRAMES.md §6.2):

$$[I_C]\,\dot{\vec{\omega}}_C + \vec{\omega}_C \times [I_C]\,\vec{\omega}_C = \vec{M}_{aero,C} + \vec{M}_{T,C}$$

$$[I_P]\,\dot{\vec{\omega}}_P + \vec{\omega}_P \times [I_P]\,\vec{\omega}_P = \vec{M}_{aero,P} + \vec{M}_{T,P}$$

The constraint moments arise from the tension $\vec{T}$ acting at offset $\vec{r}$ from each CG:

$$\vec{M}_{T,C} = \vec{r}_{C/CG_C} \times \vec{T}$$

$$\vec{M}_{T,P} = \vec{r}_{C/CG_P} \times (-\vec{T})$$

---

## 6  Relative Rotation Dynamics

The relative angular acceleration between bodies is driven by the **coupling torques** at the confluence point. For small relative angles, each axis is modeled as a spring-damper:

### 6.1  Pitch (Fore/Aft Swing) — Gravity Pendulum

$$\ddot{\delta}_\theta = \frac{\tau_{g,\theta} + \tau_{\text{spring}} + \tau_{\text{damp}} + \tau_{\text{aero}}}{I_\theta}$$

Gravity restoring torque:

$$\tau_{g,\theta} = -m_P\,g\,l\,\sin(\delta_\theta - \theta_C)$$

where $l$ is the riser length (0.5m, CG-to-confluence), $\theta_C$ is canopy pitch.

**Singularity bypass (2026-03-11):** During steep-climb deployment, canopy pitch $\theta$ passes through ±90° Euler singularity. To prevent corrupted gravity computation, a body-frame gravity unit vector $(g_x, g_y, g_z)$ is tracked as auxiliary state:
- Initialized from deployment $\theta$: $g_x = -\sin\theta$, $g_y = 0$, $g_z = \cos\theta$
- Integrated via $\dot{\vec{g}} = -\vec{\omega} \times \vec{g}$ (full 3D cross product)
- Renormalized each step to prevent drift
- Gravity torque uses vector directly: $\tau_g = -m_P g l (\sin\delta_\theta \cdot g_z + \cos\delta_\theta \cdot g_x)$

The gravity vector is used **only** for the pendulum. Canopy translational EOM uses standard `gravityBody(phi, theta)` — the gravity vector drifts during aggressive maneuvers and destabilizes the canopy if used there.

**Feedback disabled:** Pilot pitch does NOT feed back into canopy aerodynamics (`pilotPitch` not passed to `rotatePilotMass()` during sim). This prevents a destabilizing feedback loop: pilot swing → segment position change → canopy moment change → more pilot swing. The pendulum is cosmetic only.

Spring: $k_\theta = 5$ N·m/rad (small). Damping: 70% critical of spring ($c_\theta \approx 14$ N·m·s/rad).

### 6.2  Weight Shift — ⚠️ RECLASSIFIED: Not a Physical Rotation

> **Important:** Weight shift is NOT a mass/inertial rotation. The stiff-spring EOM below is incorrect for modeling weight shift. Weight shift is a **pure aerodynamic control input** — same category as brakes and risers.

What the pilot actually does: shifts hips laterally within the harness, changing the relative loading on left vs right riser groups. This warps the canopy shape (differential span loading). The pilot's mass distribution does NOT change — the CG does not shift laterally in any meaningful way.

**Correct implementation:** `weightShiftLR` should feed into canopy segment Kirchhoff blending (like brakes and risers), not into a lateral pendulum EOM. See [WINGSUIT-BASE-FLOW.md](WINGSUIT-BASE-FLOW.md) §Weight Shift.

**Current code state:** `pilotLateralEOM()` exists in eom.ts with stiff spring + critical damping, and `pilotRoll`/`pilotRollDot` are integrated in sim.ts. This should be **removed or repurposed** once weight shift is implemented as Kirchhoff blending. The lateral EOM produces no meaningful physics because weight shift doesn't involve mass rotation.

~~Original stiff-spring model (preserved for reference):~~

$$\ddot{\delta}_\phi = -\frac{k_\phi}{I_\phi}\,\delta_\phi - \frac{c_\phi}{I_\phi}\,\dot{\delta}_\phi + \frac{\tau_{\text{input},\phi}}{I_\phi}$$

### 6.3  Twist (Line Twist / Relative Yaw)

$$\ddot{\delta}_\psi = \frac{\tau_{\text{lines}} + \tau_{\text{input}}}{I_\psi} - \frac{c_\psi}{I_\psi}\,\dot{\delta}_\psi$$

**No gravity restoring torque** — twist axis is vertical (parallel to gravity in trimmed flight). The restoring force comes entirely from line set geometry.

**Sinusoidal restoring torque** — the parallel line set behaves like a pendulum:

$$\tau_{\text{lines}} = \begin{cases} -k_\psi \sin(\delta_\psi) & |\delta_\psi| \leq \pi \\ 0 & |\delta_\psi| > \pi \end{cases}$$

Physical behavior:
- **0–90°**: Restoring force **increases** with twist — lines resist crossing. Maximum at 90°.
- **90–180°**: Force **drops off** — lines approaching fully crossed state.
- **180°**: Zero restoring torque — unstable equilibrium (lines fully crossed).
- **>180°**: Clamped to zero — no natural restoring force. Recovery requires pilot input.

Normal flight with full span produces large $k_\psi$ — control inputs cause only a few degrees of twist. During deployment (shorter span, fewer inflated cells), $k_\psi$ is much smaller and twist can develop easily.

**Single tunable parameter:** $k_\psi$ [N·m] — torsional stiffness of the line set. Depends on line count, span, and inflation state.

---

## 7  State Variables

### 7.1  Current (14 states)

| States | Variables | Count |
|--------|-----------|-------|
| Position (inertial) | $x, y, z$ | 3 |
| Velocity (body) | $u, v, w$ | 3 |
| Euler angles | $\phi, \theta, \psi$ | 3 |
| Body rates | $p, q, r$ | 3 |
| Pitch pendulum | $\delta_\theta, \dot{\delta}_\theta$ | 2 |
| **Total** | | **14** |

### 7.2  Extended (18 states)

| New states | Variables | Count |
|------------|-----------|-------|
| Lateral swing | $\delta_\phi, \dot{\delta}_\phi$ | 2 |
| Line twist | $\delta_\psi, \dot{\delta}_\psi$ | 2 |
| **New total** | | **18** |

The 12 rigid-body states describe the **system CG** motion (canopy + payload combined). The 6 relative states describe how the payload moves within that system.

---

## 8  Parameters (Vehicle Assembly)

```typescript
interface PilotCoupling {
  riserLength: number          // l [m] — CG-to-confluence distance

  // Pitch (fore/aft swing)
  pitchSpring: number          // k_θ [N·m/rad]
  pitchDamp: number            // c_θ [N·m·s/rad]

  // Lateral (weight shift)
  lateralSpring: number        // k_φ [N·m/rad]
  lateralDamp: number          // c_φ [N·m·s/rad]

  // Twist (line twist)
  twistStiffness: number       // k_ψ [N·m] — line set torsional stiffness
  twistDamp: number            // c_ψ [N·m·s/rad]

  // Pilot inertia about confluence
  pilotInertia_pitch: number   // I_θ [kg·m²]
  pilotInertia_lateral: number // I_φ [kg·m²]
  pilotInertia_twist: number   // I_ψ [kg·m²]
}
```

Most of these can be **derived** from the existing mass model:
- `riserLength` = distance from pilot CG to confluence point (already in vehicle assembly)
- `pilotInertia_*` = computed from pilot mass points via parallel-axis theorem about $C$
- Spring/damping constants = the tunable parameters (6 values)

---

## 9  Coupling Effects

### 9.1  CG Shift

When the payload rotates relative to the canopy, the **system CG shifts**. For small angles:

$$\Delta x_{CG} \approx \frac{m_P}{M}\,l\,\delta_\theta \qquad \Delta y_{CG} \approx \frac{m_P}{M}\,d_{\text{riser}}\,\delta_\phi$$

Pitch CG shift comes from the pendulum swing ($l$ = riser length). Lateral CG shift comes from the harness geometric deformation ($d_{\text{riser}}$ = lateral riser spacing). The lateral shift is the primary control mechanism for weight-shift steering — it offsets the aerodynamic moment balance, producing a turn.

### 9.2  Inertia Coupling

Payload rotation changes the system inertia tensor. The cross-products of inertia ($I_{xz}$, $I_{xy}$) become nonzero when the payload is displaced, creating roll-yaw and roll-pitch coupling (FRAMES.md §6.2 gyroscopic terms).

### 9.3  Twist Effects

Line twist beyond ~180° produces:
- **Riser shortening**: effective line length decreases as lines spiral — this is the only restoring mechanism beyond 180° (nearly negligible)
- **Brake authority loss**: control lines wrap, reducing brake range
- **Canopy distortion**: asymmetric line tension warps the canopy shape

These are secondary effects for later implementation. Note: twist during deployment (shorter span, pre-inflation) is a separate problem — the sinusoidal model with reduced $k_\psi$ covers the basic physics, but deployment-phase dynamics are deferred.

---

## 10  Gamepad Mapping

| Input | DOF | Effect |
|-------|-----|--------|
| Left stick X | $\delta_\phi$ | Lateral weight shift (harness geometry) |
| Right stick X | $\delta_\psi$ | Twist recovery torque (direct yaw input) |

Pitch pendulum ($\delta_\theta$) has **no gamepad input** — it is a freely swinging pendulum from the riser confluence. The pilot cannot directly control fore/aft swing.

**Twist recovery design:** Right stick X applies direct torque in the twist DOF. The input torque should be:
- **Weak relative to $k_\psi$ in normal flight** — pushing the stick at full span should produce negligible twist (a few degrees at most)
- **Strong enough to overcome damping in line twists** — when $|\delta_\psi| > 90°$ and the sinusoidal restoring force is dropping off, stick input provides the torque needed to kick back under 90° where the natural restoring force takes over
- Scale: `TWIST_INPUT_TORQUE` ≪ $k_\psi$ (tunable, start at ~10% of $k_\psi$)

For canopy: weight shift and twist recovery complement brake/riser inputs.
For wingsuit: lateral weight shift maps to existing roll throttle.

---

## 11  Implementation Status

1. ✅ **Pitch pendulum** — Gravity-restoring, body-frame gravity vector for singularity bypass. `pilotPendulumEOM()` in eom.ts. Rendered as `pilotPivot.rotation.x`. Feedback into canopy aero **disabled** (cosmetic only). Commits `41c1f7c`, `b5a21a1`, `a8db517`.
2. ✅ **Twist DOF** — Sinusoidal restoring torque, clamped ±π. `pilotTwistEOM()` in eom.ts. Gamepad right stick X for recovery. Seeded from bag tumble yaw at deployment. **Not yet rendered** in 3D. Commit `b5a21a1`.
3. ⚠️ **Lateral weight shift** — `pilotLateralEOM()` exists but models wrong physics (mass pendulum instead of aero control). Needs reclassification to Kirchhoff blending. See §6.2.
4. ⬜ **Weight shift Kirchhoff** — Implement canopy segment response to `weightShiftLR` as differential span loading (same pattern as brakes/risers).
5. ⬜ **Line twist rendering** — Pilot yaw rotation in 3D model, static slider for tuning, optional line spiral visualization.
6. ⬜ **Pilot aero torque** — `pilotSwingDampingTorque()` exists but effect is minimal.
7. ⬜ **Secondary effects** — Riser shortening from twist, brake authority degradation, etc.

---

## References

- Slegers, N. & Costello, M. (2003). "Aspects of Control for a Parafoil and Payload System." *JGCD* 26(6). DOI: [10.2514/2.6933](https://doi.org/10.2514/2.6933)
- FRAMES.md §6 (Rotating-Frame Derivative), §9 (Gravity), §12 (Pilot Pendulum)
- KIRCHHOFF.md §7.2 (Pilot Pitch in Aero Model)
