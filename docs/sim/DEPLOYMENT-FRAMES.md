# Deployment Frames — Reference Frame Architecture

Frame definitions, transforms, and handoff math for the wingsuit deployment system.
Extends [FRAMES.md](../FRAMES.md) §12–13 into multi-body deployment dynamics.

**Reference:** Slegers, N. & Costello, M. (2003), "Aspects of Control for a Parafoil and Payload System." DOI: 10.2514/2.6933

---

## 1  Frame Inventory

Five frames are active during deployment. Three are standard (FRAMES.md §1–3), two are new:

| Frame | Symbol | Origin | Orientation | Active During |
|-------|--------|--------|-------------|---------------|
| Inertial NED | $\mathcal{I}$ | Launch point | North-East-Down, Earth-fixed | Always |
| Wingsuit body | $\mathcal{W}$ | Wingsuit CG | x-fwd along flight chord, z-down | Freefall + deployment |
| Canopy body | $\mathcal{C}$ | Canopy system CG | x-fwd along canopy chord, z-down | Post line-stretch |
| Pilot body | $\mathcal{P}$ | Pilot CG (pendulum) | Rotated sub-frame of $\mathcal{C}$ by $\theta_p$ | Post line-stretch |
| Bridle chain | — | Per-segment inertial | No fixed orientation (point masses) | Deployment |

---

## 2  Bridle Chain Frame

The bridle chain is **not a rigid body**. Each segment is an independent point mass in inertial NED with its own position and velocity. No rotating-frame derivative is applied to the free segments.

**The exception**: the container attachment point. This point is fixed in the wingsuit body frame $\mathcal{W}$ and transforms to inertial each tick:

$$\mathbf{r}_{\text{attach}}^{\mathcal{I}} = \mathbf{r}_{\text{WS}}^{\mathcal{I}} + C_{\mathcal{I}/\mathcal{W}} \, \mathbf{r}_{\text{attach}}^{\mathcal{W}}$$

where $C_{\mathcal{I}/\mathcal{W}}$ is the wingsuit body→inertial DCM (3-2-1 Euler with $\phi_w, \theta_w, \psi_w$).

The attachment point velocity includes the transport term from body rotation:

$$\mathbf{v}_{\text{attach}}^{\mathcal{I}} = \mathbf{v}_{\text{WS}}^{\mathcal{I}} + C_{\mathcal{I}/\mathcal{W}} \left( \boldsymbol{\omega}_{\mathcal{W}} \times \mathbf{r}_{\text{attach}}^{\mathcal{W}} \right)$$

**All other segments**: pure inertial NED integration. Forces are:
- Aerodynamic drag: $\mathbf{F}_D = -\tfrac{1}{2}\rho \, C_D A \, |\mathbf{v}| \, \mathbf{v}$ (inertial velocity, inertial force)
- Gravity: $\mathbf{F}_g = m_i \, (0, 0, g)^T$
- Constraint: position clamp + velocity projection when distance to neighbor exceeds rest length

No DCM needed for segment forces — everything is inertial.

---

## 3  Canopy Bag State

The canopy bag (post pin-release) is a rigid body in inertial NED with its own rotation state:

$$\text{State} = \left( \mathbf{r}_{\text{bag}}^{\mathcal{I}}, \; \mathbf{v}_{\text{bag}}^{\mathcal{I}}, \; \phi_b, \; \theta_b, \; \psi_b, \; \dot{\phi}_b, \; \dot{\theta}_b, \; \dot{\psi}_b \right)$$

The bag's Euler angles are **not** a body frame in the usual sense — they track the tumbling orientation of uninflated fabric. Pitch and roll are clamped to $\pm 90°$ (fabric can't invert through itself), yaw is free (line twist seed).

At line stretch, the bag's inertial state defines the canopy initial geometry.

---

## 4  Line Stretch Snapshot

At line stretch, we freeze a complete state snapshot. Everything is in its native frame:

| Quantity | Frame | Symbol |
|----------|-------|--------|
| Wingsuit 12-state | $\mathcal{W}$ body velocities, $\mathcal{I}$ position/attitude | $\mathbf{x}_w$ |
| PC position, velocity | $\mathcal{I}$ | $\mathbf{r}_{pc}^{\mathcal{I}}, \mathbf{v}_{pc}^{\mathcal{I}}$ |
| Canopy bag position, velocity | $\mathcal{I}$ | $\mathbf{r}_{bag}^{\mathcal{I}}, \mathbf{v}_{bag}^{\mathcal{I}}$ |
| Canopy bag orientation, rates | $\mathcal{I}$ Euler angles | $\phi_b, \theta_b, \psi_b, \dot{\phi}_b, \dot{\theta}_b, \dot{\psi}_b$ |
| Tension axis | $\mathcal{I}$ | $\hat{\mathbf{t}}^{\mathcal{I}} = \text{normalize}(\mathbf{r}_{bag}^{\mathcal{I}} - \mathbf{r}_{ws}^{\mathcal{I}})$ |

---

## 5  Canopy Attitude from Tension Axis

The tension axis $\hat{\mathbf{t}}^{\mathcal{I}}$ (pilot → bag, inertial NED) determines the canopy system geometry at line stretch. The canopy body frame is constructed from this axis:

### 5.1  Heading $\psi_c$

The canopy faces **opposite** the tension axis horizontal projection. The tension points from pilot toward the bag (trailing behind); the canopy forward axis faces into the wind:

$$\psi_c = \text{atan2}(-t_E, \; -t_N)$$

### 5.2  Pitch $\theta_c$

The elevation angle of the tension axis above horizontal. This is the **system pitch**, not the aerodynamic trim — the canopy IS at whatever angle the tension axis dictates. The angle of attack $\alpha$ is a consequence of $\theta_c$ and the velocity transform (§6):

$$\theta_c = \text{atan2}\!\left(-t_D, \; \sqrt{t_N^2 + t_E^2}\right)$$

Note: $-t_D$ because NED $z^+$ is down; bag above pilot gives $t_D < 0$, producing $\theta_c > 0$ (nose up).

At a typical BASE deployment: $\theta_c \approx 60\text{–}70°$ (canopy well above pilot).
At a high-speed low-AoA deployment: $\theta_c \approx 5\text{–}15°$ (canopy nearly level behind).

### 5.3  Roll $\phi_c$

From the canopy bag's roll state, attenuated by snatch damping:

$$\phi_c = 0.3 \, \phi_b$$

### 5.4  The Resulting DCM

The canopy body→inertial DCM is the standard 3-2-1 sequence:

$$C_{\mathcal{I}/\mathcal{C}} = R_3(\psi_c) \, R_2(\theta_c) \, R_1(\phi_c)$$

And the inverse (inertial→canopy body):

$$C_{\mathcal{C}/\mathcal{I}} = C_{\mathcal{I}/\mathcal{C}}^T$$

---

## 6  Velocity Transform: Wingsuit → Canopy Body

The velocity must be re-expressed from wingsuit body frame to canopy body frame. This is a two-step DCM chain through inertial:

### Step 1: Wingsuit body → inertial

$$\mathbf{v}^{\mathcal{I}} = C_{\mathcal{I}/\mathcal{W}} \, \mathbf{v}^{\mathcal{W}} = R_3(\psi_w) \, R_2(\theta_w) \, R_1(\phi_w) \, \begin{pmatrix} u_w \\ v_w \\ w_w \end{pmatrix}$$

### Step 2: Inertial → canopy body

$$\mathbf{v}^{\mathcal{C}} = C_{\mathcal{C}/\mathcal{I}} \, \mathbf{v}^{\mathcal{I}} = C_{\mathcal{I}/\mathcal{C}}^T \, \mathbf{v}^{\mathcal{I}}$$

### Combined

$$\mathbf{v}^{\mathcal{C}} = C_{\mathcal{I}/\mathcal{C}}^T \; C_{\mathcal{I}/\mathcal{W}} \; \mathbf{v}^{\mathcal{W}}$$

Or equivalently:

$$C_{\mathcal{C}/\mathcal{W}} = C_{\mathcal{C}/\mathcal{I}} \; C_{\mathcal{I}/\mathcal{W}} = C_{\mathcal{I}/\mathcal{C}}^T \; C_{\mathcal{I}/\mathcal{W}}$$

The resulting $(u_c, v_c, w_c)$ gives the canopy-body-frame velocity. The aerodynamic angles follow immediately:

$$\alpha = \text{atan2}(w_c, \; u_c), \qquad \beta = \arcsin\!\left(\frac{v_c}{V}\right)$$

At steep deployments ($\theta_c \approx 70°$), $\alpha$ will be large ($\approx 70°$) — the canopy is deeply stalled. The deploy ramp + EOM pitch the canopy down to trim over 2–3 seconds.

---

## 7  Pilot Position: The CG Shift Problem

This is the key unsolved piece. The pilot's **physical body doesn't move** at line stretch, but its **offset from the system CG changes** because the CG itself shifts when we switch from wingsuit-only to canopy+pilot.

### 7.1  Wingsuit vehicle

The pilot IS the wingsuit vehicle. The pilot CG is the wingsuit CG:

$$\mathbf{r}_{\text{pilot}}^{\mathcal{W}} = \mathbf{0}$$

### 7.2  Canopy vehicle

The canopy+pilot system has a combined CG that depends on both masses and their positions. In the canopy body frame, the pilot hangs below the confluence point $C$ (riser tops):

$$\mathbf{r}_{\text{CG,system}}^{\mathcal{C}} = \frac{m_c \, \mathbf{r}_c^{\mathcal{C}} + m_p \, \mathbf{r}_p^{\mathcal{C}}}{m_c + m_p}$$

The pilot's position in the canopy frame is NOT zero — it's offset along the riser direction by the line length and the pendulum angle.

### 7.3  What needs to happen at line stretch

At the moment of transition:

1. **Pilot position in inertial**: known (wingsuit CG position + body frame offset if any)
2. **Canopy bag position in inertial**: known (tracked by deployment sim)
3. **New system CG in inertial**: weighted average of pilot and canopy positions

$$\mathbf{r}_{\text{CG}}^{\mathcal{I}} = \frac{m_p \, \mathbf{r}_{\text{pilot}}^{\mathcal{I}} + m_c \, \mathbf{r}_{\text{bag}}^{\mathcal{I}}}{m_p + m_c}$$

4. **Canopy body frame origin**: at the new system CG
5. **Pilot offset in canopy frame**: transform pilot inertial position into canopy body frame, relative to new CG

$$\mathbf{r}_{\text{pilot}}^{\mathcal{C}} = C_{\mathcal{C}/\mathcal{I}} \left( \mathbf{r}_{\text{pilot}}^{\mathcal{I}} - \mathbf{r}_{\text{CG}}^{\mathcal{I}} \right)$$

### 7.4  Pilot pendulum angle ($\theta_p$) from geometry

$\theta_p$ is the pendulum angle measured from the hanging equilibrium (body $+z$, straight down from confluence point). Convention: **positive = backward** (aft swing).

The pilot direction from the confluence point $C$ in the canopy body frame:

$$\hat{\mathbf{d}}_p^{\mathcal{C}} = \text{normalize}\!\left(\mathbf{r}_{\text{pilot}}^{\mathcal{C}} - \mathbf{r}_C^{\mathcal{C}}\right)$$

where $\mathbf{r}_C^{\mathcal{C}}$ is the confluence point in canopy body frame (top of risers, above pilot CG).

The pendulum angle, measured from $+z$ (hanging) with positive toward $-x$ (backward):

$$\theta_p = -\text{atan2}\!\left(d_{p,x}, \; d_{p,z}\right)$$

The negative sign enforces **positive = backward**: when $d_{p,x} < 0$ (pilot behind canopy forward axis), $\text{atan2}$ is negative, so $\theta_p > 0$.

### 7.5  Current simplification

Currently we skip the CG computation and use the tension axis directly for the pilot direction. This works approximately because the tension axis IS the line from pilot to canopy. But it conflates the system CG with the pilot position and ignores the mass-weighted CG shift. The correct version (§7.3–7.4) uses actual inertial positions.

---

## 8  Angular Rates at Line Stretch

The canopy is a **new body** — it doesn't inherit the wingsuit's angular rates. The snatch force at line stretch absorbs most rotational energy. The initial rates come from the bag's residual tumble, heavily damped:

$$p_c = 0.1 \, \dot{\phi}_b, \quad q_c = 0.1 \, \dot{\theta}_b, \quad r_c = 0.1 \, \dot{\psi}_b$$

The damping factor (0.1) models energy absorption by the lines at snatch. Tunable.

---

## 9  Bridle Attachment Handoff

After transition, the bridle attachment point transfers from $\mathcal{W}$ to $\mathcal{C}$:

**Before line stretch:**
$$\mathbf{r}_{\text{attach}}^{\mathcal{I}} = \mathbf{r}_{\text{WS}}^{\mathcal{I}} + C_{\mathcal{I}/\mathcal{W}} \, \mathbf{r}_{\text{attach}}^{\mathcal{W}}$$

**After line stretch:**
$$\mathbf{r}_{\text{attach}}^{\mathcal{I}} = \mathbf{r}_{\text{canopy}}^{\mathcal{I}} + C_{\mathcal{I}/\mathcal{C}} \, \mathbf{r}_{\text{attach}}^{\mathcal{C}}$$

The attachment point's **body-frame offset changes** — in the wingsuit it was at the container position; in the canopy it's at the riser tops / confluence point. The inertial position should be continuous across the transition (same physical point in space).

Free bridle segments remain in inertial NED throughout — no frame change needed for them. The PC continues its tension-drag interplay with the new body.

---

## 10  The Full Transition Sequence

```
Line stretch detected
    │
    ├─ 1. Freeze snapshot (all states in native frames)
    │
    ├─ 2. Compute canopy attitude (ψ_c, θ_c, φ_c) from tension axis  [§5]
    │
    ├─ 3. Build canopy DCM: C_{I/C}, C_{C/I}                         [§5.4]
    │
    ├─ 4. Transform velocity: v^W → v^I → v^C                        [§6]
    │      α, β fall out from (u_c, v_c, w_c)
    │
    ├─ 5. Compute new system CG in inertial                           [§7.3]
    │
    ├─ 6. Compute pilot position in canopy body frame                 [§7.3]
    │
    ├─ 7. Compute θ_p from pilot-to-confluence geometry               [§7.4]
    │
    ├─ 8. Set angular rates from bag tumble residuals                  [§8]
    │
    ├─ 9. Transfer bridle attachment to canopy body                    [§9]
    │
    └─ 10. Inject SimStateExtended, switch polar, activate coupling
```

---

## 11  Debug Controls (Planned)

To verify frame correctness, we need visualization of:

| Control | Purpose |
|---------|---------|
| **Tension axis vector** | Rendered in inertial frame at line stretch — confirms direction |
| **Canopy body axes** | x/y/z rendered at canopy CG post-transition — confirms attitude |
| **Pilot pendulum arc** | Rendered from confluence to pilot CG — confirms θ_p geometry |
| **CG marker** | Diamond at system CG — confirms mass-weighted position |
| **Bridle attachment marker** | Shows which body frame the anchor follows |
| **Freeze at line stretch** | Pause sim at exact transition moment for inspection |

These supplement the existing console diagnostic (`[CanopyIC]` log) with visual confirmation in 3D.

---

## 12  Relationship to Slegers & Costello

The Slegers & Costello (2003) two-body framework defines canopy and payload as separate rigid bodies sharing a confluence point $C$. Their formulation:

- Sums translational EOM to **eliminate the constraint force** at $C$
- The relative rotation between bodies is governed by gravity + aerodynamic torques
- 9DOF total: canopy 6DOF + payload 3DOF (relative pitch, roll, yaw)

Our implementation maps directly:

| Slegers & Costello | Polar Implementation |
|-------------------|---------------------|
| Canopy body | Canopy 6DOF ($\mathcal{C}$ frame, integrated by EOM) |
| Payload body | Pilot 3DOF ($\theta_p$, pilotRoll, pilotYaw) |
| Confluence point $C$ | Riser convergence / pivot junction |
| Constraint force | Eliminated by summing translational EOM (FRAMES.md §12) |
| Relative pitch | `thetaPilot` — gravity-restoring pendulum |
| Relative roll | `pilotRoll` — stiff spring (weight shift) |
| Relative yaw | `pilotYaw` — sinusoidal restoring (line twist) |

The deployment handoff (§10) computes the ICs that initialize this two-body system from the single-body wingsuit + deployment chain geometry.

---

## Open Questions

1. **System CG computation**: Do we use the static CG from VehicleDefinition, or compute dynamically from pilot + canopy mass positions at line stretch? The canopy mass position depends on the actual bag position.

2. **Confluence point position in canopy frame**: Is this the same as the pivot junction (assembly transform), or does it need to be derived from line geometry at line stretch?

3. **Position continuity**: Should the new system origin (canopy CG) be at the mass-weighted position, or at the pilot's position (since the pilot doesn't physically move)? The latter simplifies position continuity but puts the canopy CG at the wrong location.

4. **Bridle persistence**: After handoff, does the bridle chain continue to integrate in inertial NED with only the attachment point rotating with the canopy? Or can we simplify to a single PC rigid body trailing behind?

5. **Gimbal lock near $\theta_c = 90°$**: Steep deployments produce $\theta_c$ near $90°$, approaching the Euler angle singularity. The `eulerRates()` guard (clamping $\cos\theta$ to $10^{-6}$) handles this numerically, but the physics may need a quaternion representation for robustness.
