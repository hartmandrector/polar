# SIMULATION.md — 6 DOF Equations of Motion

> Reference frame : **NED body frame** — `x` forward, `y` right, `z` down
> State vector    : 12 states `(x, y, z, u, v, w, φ, θ, ψ, p, q, r)`
> Euler sequence  : **3-2-1** (ψ → θ → φ) — yaw, pitch, roll
> Sources         :
> - [Academic Flight — Equations of Motion](https://academicflight.com/articles/equations-of-motion/)
> - [Academic Flight — Aircraft Attitude and Euler Angles](https://academicflight.com/articles/aircraft-attitude-and-euler-angles/)

---

## 1  State Vector

| # | Symbol | NED axis | Description                   | Unit  |
|---|--------|----------|-------------------------------|-------|
| 1 | x      | North    | Inertial position             | m     |
| 2 | y      | East     | Inertial position             | m     |
| 3 | z      | Down     | Inertial position (−altitude) | m     |
| 4 | u      | x-body   | Forward velocity              | m/s   |
| 5 | v      | y-body   | Rightward velocity            | m/s   |
| 6 | w      | z-body   | Downward velocity             | m/s   |
| 7 | φ      | —        | Roll  (Euler angle)           | rad   |
| 8 | θ      | —        | Pitch (Euler angle)           | rad   |
| 9 | ψ      | —        | Yaw   (Euler angle)           | rad   |
|10 | p      | x-body   | Roll  rate                    | rad/s |
|11 | q      | y-body   | Pitch rate                    | rad/s |
|12 | r      | z-body   | Yaw   rate                    | rad/s |

---

## 2  Translational Dynamic Equations

Newton's second law in a rotating body frame:

$$
\vec{F} = m\!\left(\frac{\mathrm{d}\vec{V}}{\mathrm{d}t}\bigg|_{\text{body}} + \vec{\omega}\times\vec{V}\right)
$$

Scalar form (NED body axes):

$$
\dot{u} = \frac{F_x}{m} + rv - qw
$$

$$
\dot{v} = \frac{F_y}{m} + pw - ru
$$

$$
\dot{w} = \frac{F_z}{m} + qu - pv
$$

where $F_x, F_y, F_z$ include **both** aerodynamic forces and gravity projected
into the body frame.

### 2.1  Gravity in Body Frame

$$
\vec{g}_B = \begin{pmatrix}
  -g\sin\theta \\
  g\sin\phi\cos\theta \\
  g\cos\phi\cos\theta
\end{pmatrix}
$$

> Note: This is a force per unit mass.  Multiply by `m` to get the weight
> force vector, or just add these directly to $F_x/m$, $F_y/m$, $F_z/m$.

### 2.2  Total Force

$$
F_x = F_{\text{aero},x} + m g_{B,x}
  \qquad
F_y = F_{\text{aero},y} + m g_{B,y}
  \qquad
F_z = F_{\text{aero},z} + m g_{B,z}
$$

In our codebase `sumAllSegments()` returns `SystemForces.force` which is
the **aerodynamic-only** body-frame force `{x, y, z}` in Newtons.
Gravity must be added separately.

---

## 3  Rotational Dynamic Equations (Euler's Equation)

$$
\vec{M} = \mathbf{I}\,\dot{\vec{\omega}} + \vec{\omega}\times(\mathbf{I}\,\vec{\omega})
$$

### 3.1  Full Inertia Tensor

$$
\mathbf{I} = \begin{pmatrix}
  I_{xx} & -I_{xy} & -I_{xz} \\
 -I_{xy} &  I_{yy} & -I_{yz} \\
 -I_{xz} & -I_{yz} &  I_{zz}
\end{pmatrix}
$$

Our `computeInertia()` already returns all six components
`{Ixx, Iyy, Izz, Ixy, Ixz, Iyz}`.

### 3.2  Symmetric Simplification

Paragliders and parachutes have left-right (y-axis) symmetry:

$$
I_{xy} = 0, \qquad I_{yz} = 0
$$

The only cross-product term that survives is $I_{xz}$ (coupling between
forward and downward mass distribution).

### 3.3  Scalar Form (with $I_{xz}$, $I_{xy}=I_{yz}=0$)

Define the determinant of the roll-yaw sub-system:

$$
\Gamma = I_{xx}\,I_{zz} - I_{xz}^2
$$

Then:

$$
\dot{p} = \frac{1}{\Gamma}\Big[
  I_{zz}\,L + I_{xz}\,N
  - \big(I_{xz}(I_{xx} - I_{yy} + I_{zz})\big)\,pq
  + \big(I_{xz}^2 + I_{zz}(I_{zz} - I_{yy})\big)\,qr
\Big]
$$

$$
\dot{q} = \frac{1}{I_{yy}}\Big[
  M - (I_{xx} - I_{zz})\,pr - I_{xz}(p^2 - r^2)
\Big]
$$

$$
\dot{r} = \frac{1}{\Gamma}\Big[
  I_{xz}\,L + I_{xx}\,N
  + \big(I_{xz}(I_{zz} - I_{yy} + I_{xx})\big)\,qr
  - \big(I_{xz}^2 + I_{xx}(I_{xx} - I_{yy})\big)\,pq
\Big]
$$

where $L$, $M$, $N$ are the **total moments** about the CG
(aerodynamic + any other applied moments) in the body frame.

In our codebase `sumAllSegments()` returns `SystemForces.moment` which
is `{x: L, y: M, z: N}` — the aerodynamic moment about CG in body NED.

> **Moments are body-frame only.**  We never need $L$, $M$, $N$ in the
> inertial (Earth) frame.  Euler's equation is formulated in the body
> frame, and the gyroscopic coupling terms ($\omega \times I\omega$) are
> body-frame quantities.  The rotational kinematics (§4) then project
> the resulting body rates into Euler-angle rates for the inertial frame.

> **Alternative (simpler but numerically equivalent when $I_{xz}$ is small):**
> If $I_{xz} \approx 0$, the equations reduce to the familiar diagonal form:
>
> $$\dot{p} = \frac{L + (I_{yy} - I_{zz})\,qr}{I_{xx}}$$
>
> $$\dot{q} = \frac{M + (I_{zz} - I_{xx})\,pr}{I_{yy}}$$
>
> $$\dot{r} = \frac{N + (I_{xx} - I_{yy})\,pq}{I_{zz}}$$

---

## 4  Differential Kinematic Equation (DKE)

The body angular rates $(p, q, r)$ and Euler rates
$(\dot\phi, \dot\theta, \dot\psi)$ are **not** the same thing.
Euler angles are defined via a mixed sequence of rotations about
different intermediate axes (3-2-1: yaw → pitch → roll), so the relationship is
mediated by the body-to-Euler-rate matrix $[B]$.

> **Key distinction** (per Academic Flight):
> It is tempting to think the DCM $[EB]$ relates body rates to Euler rates.
> This is false.  Euler rates are not a vector — they are a 3-tuple of
> scalar derivatives of the three consecutive rotation angles.  The matrix
> $[B]$ below is **not** orthogonal and **cannot** be inverted by transposing.

### 4.1  Forward DKE — body rates → Euler rates

$$
\begin{pmatrix} \dot\phi \\ \dot\theta \\ \dot\psi \end{pmatrix}
=
\underbrace{\frac{1}{\cos\theta}
\begin{pmatrix}
  \cos\theta & \sin\phi\sin\theta & \cos\phi\sin\theta \\
  0          & \cos\phi\cos\theta & -\sin\phi\cos\theta \\
  0          & \sin\phi            & \cos\phi
\end{pmatrix}}_{[B](\phi,\theta)}
\begin{pmatrix} p \\ q \\ r \end{pmatrix}
$$

Implemented as `eulerRates(p, q, r, φ, θ)` in `eom.ts`.

### 4.2  Inverse DKE — Euler rates → body rates

When the UI specifies Euler rates (e.g. a steady turn or known
flight-path angle rate), we need the inverse:

$$
\begin{pmatrix} p \\ q \\ r \end{pmatrix}
=
\underbrace{\begin{pmatrix}
  1 & 0       & -\sin\theta \\
  0 & \cos\phi &  \sin\phi\cos\theta \\
  0 & -\sin\phi & \cos\phi\cos\theta
\end{pmatrix}}_{[B]^{-1}(\phi,\theta)}
\begin{pmatrix} \dot\phi \\ \dot\theta \\ \dot\psi \end{pmatrix}
$$

Scalar form:

$$
p = \dot\phi - \dot\psi\sin\theta
$$

$$
q = \dot\theta\cos\phi + \dot\psi\sin\phi\cos\theta
$$

$$
r = -\dot\theta\sin\phi + \dot\psi\cos\phi\cos\theta
$$

Implemented as `eulerRatesToBodyRates(φ̇, θ̇, ψ̇, φ, θ)` in `eom.ts`.

> **Singularity**: Both $[B]$ and $[B]^{-1}$ are singular at $\theta = \pm 90°$
> (gimbal lock).  Quaternion kinematics avoid this but are not needed
> for normal paraglider/parachute flight envelopes.

---

## 5  Translational Kinematic Equations

Inertial position rates — the DCM (body → inertial) rotates the body
velocity into the inertial (NED Earth) frame:

$$
\begin{pmatrix} \dot{x} \\ \dot{y} \\ \dot{z} \end{pmatrix}
= \mathbf{R}_{BI}(\phi,\theta,\psi)\;
\begin{pmatrix} u \\ v \\ w \end{pmatrix}
$$

Our `dcmBodyToInertial(φ, θ, ψ)` already implements this matrix.

---

## 6  Integration Procedure

The integrator computes all 12 state derivatives **simultaneously** from
the current state, then advances all 12 states together.

### 6.1  Derivative Evaluation (single function of state)

Given the current state $(x, y, z, u, v, w, \phi, \theta, \psi, p, q, r)$:

1. **Aero model** → `sumAllSegments(segs, cg, h, vel, ω, controls, ρ)`
   returns `{ force, moment }` — body-frame aero forces and moments,
   with ω×r local-velocity corrections at each segment (§10).
2. **Gravity** → `gravityBody(φ, θ)` → $\vec{g}_B$
3. **Total force** → $\vec{F} = \vec{F}_{\text{aero}} + m\vec{g}_B$
4. **Translational dynamics** → `translationalEOM(F, m, V, ω)` → $(\dot{u}, \dot{v}, \dot{w})$
5. **Rotational dynamics** → `rotationalEOM(M, I, ω)` → $(\dot{p}, \dot{q}, \dot{r})$
6. **Rotational kinematics** → `eulerRates(p, q, r, φ, θ)` → $(\dot\phi, \dot\theta, \dot\psi)$
7. **Translational kinematics** → `dcmBodyToInertial(φ, θ, ψ) · V` → $(\dot{x}, \dot{y}, \dot{z})$

All 12 derivatives are returned as a single derivative vector.

### 6.2  Integrator Selection

**Forward Euler** is the baseline integrator and is sufficient for
human-flight paraglider/parachute dynamics.  Prior CloudBASE simulations
have run stably with Euler integration — the system is dominated by
aerodynamic forces with no contact forces, impacts, or other stiff
interactions that would demand a higher-order method.

$$
\text{state}_{t+\Delta t} = \text{state}_t + \Delta t \cdot f(\text{state}_t)
$$

**RK4** is available as an option for cases that need it, but it
evaluates the derivative function 4× per step, which is expensive when
each evaluation calls `sumAllSegments()` over all aero segments:

$$
\text{state}_{t+\Delta t} = \text{state}_t + \tfrac{\Delta t}{6}(k_1 + 2k_2 + 2k_3 + k_4)
$$

In practice, the same stability can be achieved with Euler at a
modestly higher rate, which is simpler and often faster overall.

### 6.3  Integration Rate Selection

The critical design choice is **rate**, not integrator order.
Rotational dynamics require a higher integration rate than
translational dynamics because angular errors propagate through the
DKE (§4) into Euler angles, which then corrupt the DCM (§5) and
the gravity projection (§2.1) — small angular drift compounds into
position drift over time.

| Sub-system | Minimum rate | Recommended | Notes |
|-----------|-------------|-------------|-------|
| **Translation** (u, v, w, x, y, z) | ~10 Hz | 10–25 Hz | Slow dynamics, aerodynamic forces only |
| **Rotation** (p, q, r, φ, θ, ψ) | ~25 Hz | 25–50 Hz | Errors propagate to translation via DCM |

For a unified loop, running everything at the rotation rate (25–50 Hz)
is simplest.  A split-rate approach (rotate at 50 Hz, translate at
25 Hz) is possible but adds complexity for marginal gain.

> **Deployment** involves rapid geometry change (span/chord inflation)
> but the resulting rotational dynamics are still aerodynamically
> damped and controllable at 25–50 Hz.  No special high-rate handling
> is needed unless exotic failure modes are simulated.

---

## 7  Pilot Pitch Pendulum Dynamics

The pilot body hangs from the risers and can swing fore/aft under the
canopy.  In the full 6DOF sim this must be modelled as a **constrained
pendulum** coupled to the main airframe state.

### 7.1  Geometry

| Symbol         | Description                            |
|----------------|----------------------------------------|
| $\theta_p$     | Pilot pitch angle relative to risers   |
| $l$            | Riser length (riser attachment → pilot CG) |
| $I_p$          | Pilot moment of inertia about riser pivot |
| $m_p$          | Pilot mass                             |

The riser pivot point in normalised NED is at
`(PILOT_PIVOT_X, 0, PILOT_PIVOT_Z)` — see `polar-data.ts`.

### 7.2  Equation of Motion

The pilot pitch EOM about the riser attachment point:

$$
I_p\,\ddot\theta_p = \tau_{\text{gravity}} + \tau_{\text{aero}} + \tau_{\text{canopy}}
$$

where:

- **Gravity torque** (restoring):
  $$\tau_g = -m_p\,g\,l\,\sin(\theta_p - \theta)$$
  with $\theta$ being the canopy pitch angle.

- **Aerodynamic torque** on the pilot body segments —
  `computeSegmentForce()` for pilot segments provides force at each
  segment CP.  The moment arm from each CP to the riser pivot gives
  the aero torque contribution.

- **Canopy coupling** — the canopy's pitch acceleration ($\dot{q}$)
  produces an apparent force on the pilot through the risers:
  $$\tau_c = -I_p\,\dot{q}$$

### 7.3  What We Have vs What the Sim Needs

| Component                     | Status          | Notes                             |
|-------------------------------|-----------------|-----------------------------------|
| Pilot segment forces          | ✅ Done          | `computeSegmentForce()` per segment |
| Pilot mass positions          | ✅ Done          | `CANOPY_PILOT_SEGMENTS[]`          |
| Pilot inertia about CG        | ✅ Done          | `computeInertia()` gives full tensor |
| Riser pivot position          | ✅ Done          | `PILOT_PIVOT_X`, `PILOT_PIVOT_Z`   |
| `rotatePilotMass()`           | ✅ Done          | Updates masses for a given pitch   |
| Pilot inertia about **riser** | ✅ Done          | `computePilotPendulumParams()` in `eom.ts` |
| Pendulum EOM function         | ✅ Done          | `pilotPendulumEOM()` in `eom.ts`           |
| Aero damping on pilot body    | ✅ Done          | `pilotSwingDampingTorque()` in `eom.ts`    |

---

## 8  What We Have vs What's Missing

### 8.1  Existing Infrastructure

| Component                   | Module            | Function / Type                    |
|-----------------------------|-------------------|------------------------------------|
| Body-frame aero forces      | `aero-segment.ts` | `sumAllSegments() → SystemForces`  |
| Body-frame aero forces (ω×r) | `aero-segment.ts` | `evaluateAeroForces() → SystemForces` |
| Body-frame aero moments     | `aero-segment.ts` | `sumAllSegments() → SystemForces`  |
| Full inertia tensor         | `inertia.ts`      | `computeInertia() → InertiaComponents` |
| Center of mass              | `inertia.ts`      | `computeCenterOfMass()`            |
| DCM body → inertial         | `frames.ts`       | `dcmBodyToInertial(φ, θ, ψ)`      |
| DCM wind → body             | `frames.ts`       | `dcmWindToBody(α, β)`             |
| Dynamic mass distribution   | `polar-data.ts`   | `rotatePilotMass(pitch, pivot, deploy)` |
| Per-segment force breakdown  | `aero-segment.ts` | `computeSegmentForce()`            |
| Derivative evaluation        | `sim.ts`          | `computeDerivatives(state, config)` |
| Forward Euler integrator     | `sim.ts`          | `forwardEuler(state, deriv, dt)`    |
| RK4 integrator               | `sim.ts`          | `rk4Step(state, config, dt)`        |
| Body → inertial velocity     | `eom.ts`          | `bodyToInertialVelocity(u,v,w,φ,θ,ψ)` |
| State vector types           | `sim-state.ts`    | `SimState`, `SimConfig`, `SimDerivatives` |
| Apparent mass (flat-plate)   | `apparent-mass.ts` | `computeApparentMass()`, `computeApparentInertia()` |
| Apparent mass at deploy      | `apparent-mass.ts` | `apparentMassAtDeploy()` |
| Effective mass/inertia       | `apparent-mass.ts` | `effectiveMass()`, `effectiveInertia()` |
| Composite frame assembly     | `composite-frame.ts` | `buildCompositeFrame()` → `CompositeFrame` |
| Frame dirty check            | `composite-frame.ts` | `frameNeedsRebuild()` |
| Frame → SimConfig            | `composite-frame.ts` | `frameToSimConfig()` |
| Anisotropic translational EOM | `eom.ts`          | `translationalEOMAnisotropic()` |

### 8.2  Missing for Full 6DOF

| Component                        | Priority | Notes                                     |
|----------------------------------|----------|-------------------------------------------|
| ~~EOM evaluation functions~~     | ~~P1~~   | ✅ `translationalEOM()`, `rotationalEOM()` in `eom.ts` |
| ~~Body rates ↔ Euler rates~~     | ~~P1~~   | ✅ `eulerRates()` + `eulerRatesToBodyRates()` in `eom.ts` |
| ~~Gravity body-frame function~~  | ~~P1~~   | ✅ `gravityBody()` in `eom.ts`             |
| ~~Rotating-frame velocity~~      | ~~P1~~✅ | `evaluateAeroForces()` in `aero-segment.ts` — §10 |
| ~~Damping derivatives~~          | ~~P1~~✅ | Automatic from ω×r in `evaluateAeroForces()` — §11 |
| ~~State vector type / container~~ | ~~P2~~✅ | `SimState`, `SimConfig` in `sim-state.ts` — §13 |
| ~~Numerical integrator~~         | ~~P2~~✅ | `forwardEuler()`, `rk4Step()` in `sim.ts` — §6 |
| Pilot pitch pendulum EOM         | ~~P2~~✅  | §7 above — `eom.ts` functions              |
| ~~Apparent-mass / added-mass~~   | ~~P3~~✅ | `apparent-mass.ts` — §12, `translationalEOMAnisotropic()` |
| ~~Composite body-frame export~~  | ~~P3~~✅ | `composite-frame.ts` — §14                 |

---

## 9  Code Reference

The EOM math is implemented in **`src/polar/eom.ts`** as pure functions
with no UI or Three.js dependencies.  See that file for:

- `gravityBody(φ, θ, g)` → body-frame gravity acceleration
- `translationalEOM(F, m, V, ω)` → `(u̇, v̇, ẇ)` — `F` must include gravity
- `rotationalEOM(M, I, ω)` → `(ṗ, q̇, ṙ)` with full $I_{xz}$ coupling
- `eulerRates(p, q, r, φ, θ)` → `(φ̇, θ̇, ψ̇)` — forward DKE
- `eulerRatesToBodyRates(φ̇, θ̇, ψ̇, φ, θ)` → `(p, q, r)` — inverse DKE- `bodyToInertialVelocity(u, v, w, φ, θ, ψ)` → `(ẋ, ẏ, ż)` — translational kinematics
- `translationalEOMAnisotropic(F, m_axis, V, ω)` → anisotropic Lamb/Kirchhoff form

The simulation loop is in **`src/polar/sim.ts`**:

- `computeDerivatives(state, config)` → all 12 state derivatives
- `forwardEuler(state, deriv, dt)` → next state (baseline integrator)
- `rk4Step(state, config, dt)` → next state (4th-order Runge-Kutta)
- `simulate(state, config, dt, steps)` → final state after N steps

The ω×r aero evaluation is in **`src/polar/aero-segment.ts`**:

- `evaluateAeroForcesDetailed(segs, cg, h, V, ω, controls, ρ)` → `{ system: SystemForces, perSegment: SegmentAeroResult[] }`
- `evaluateAeroForces(segs, cg, h, V, ω, controls, ρ)` → `SystemForces` (thin wrapper)

State types are in **`src/polar/sim-state.ts`**:

- `SimState` — 12-state vector
- `SimStateExtended` — +2 pilot pendulum states
- `SimDerivatives` — 12 derivative values
- `SimConfig` — configuration snapshot for derivative evaluation

Apparent mass is in **`src/polar/apparent-mass.ts`**:

- `computeApparentMass(geom, ρ)` → translational apparent mass per axis
- `computeApparentInertia(geom, ρ)` → rotational apparent inertia
- `apparentMassAtDeploy(geom, deploy, ρ)` → deploy-scaled apparent mass
- `effectiveMass(m, m_a)` / `effectiveInertia(I, I_a)` → combined physical + apparent

The composite body frame is in **`src/polar/composite-frame.ts`**:

- `buildCompositeFrame(config, deploy, pitch)` → cached `CompositeFrame` snapshot
- `frameNeedsRebuild(frame, deploy, pitch)` → dirty check
- `frameToSimConfig(frame, controls, useApparentMass)` → `SimConfig` for integrator

All functions are exported from the barrel `src/polar/index.ts`.

---

## 10  Aerodynamic Forces in the Rotating Frame

This is a critical gap in the current model.  `sumAllSegments()` currently
receives a **single** airspeed, α, and β that apply uniformly to every
segment.  In a rotating body frame, the **local velocity** at each segment
differs from the CG velocity because of the body rotation.

### 10.1  Local Velocity at a Segment

For a segment at body-frame position $\vec{r}_i$ from the CG, the local
freestream velocity is:

$$
\vec{V}_{\text{local},i} = \vec{V}_{\text{CG}} + \vec{\omega} \times \vec{r}_i
$$

where $\vec{\omega} = (p, q, r)$ and $\vec{r}_i$ is the segment position
relative to CG in body NED.

Expanded:

$$
\vec{\omega} \times \vec{r}_i =
\begin{pmatrix}
  q\,r_z - r\,r_y \\
  r\,r_x - p\,r_z \\
  p\,r_y - q\,r_x
\end{pmatrix}
$$

### 10.2  Local Angle of Attack and Dynamic Pressure

From the local velocity $\vec{V}_{\text{local},i}$ we derive:

$$
V_i = |\vec{V}_{\text{local},i}|,
\qquad
\alpha_i = \arctan\!\left(\frac{w_i}{u_i}\right),
\qquad
\beta_i = \arcsin\!\left(\frac{v_i}{V_i}\right)
$$

$$
q_i = \tfrac{1}{2}\rho\,V_i^2
$$

Each segment then evaluates its own coefficients at $(\alpha_i, \beta_i)$
and uses $q_i$ instead of the system-wide dynamic pressure.

### 10.3  Why This Matters

| Scenario | Effect |
|----------|--------|
| **Roll** (`p`) | Wingtip segments see increased/decreased α and $V$. This produces differential lift that opposes roll — inherent **roll damping** ($C_{l_p}$). |
| **Pitch** (`q`) | Tail/nose segments see modified α. Canopy trailing cells see more downwash — inherent **pitch damping** ($C_{m_q}$). |
| **Yaw** (`r`) | Left/right segments see differential drag — inherent **yaw damping** ($C_{n_r}$). |

With this correction, the classical damping derivatives ($C_{l_p}$,
$C_{m_q}$, $C_{n_r}$) emerge automatically from the geometry —
no separate derivative model is needed.

### 10.4  Implementation ~~Path~~ (Done)

Implemented as `evaluateAeroForces()` in `aero-segment.ts`:

1. For each segment, compute position relative to CG in meters.
2. Compute $\vec{\omega} \times \vec{r}_i$ correction.
3. Local velocity $\vec{V}_{\text{local},i} = \vec{V}_{\text{CG}} + \vec{\omega} \times \vec{r}_i$.
4. Derive local $(V_i, \alpha_i, \beta_i)$ from the local velocity vector.
5. Evaluate `computeSegmentForce(seg, \alpha_i, \beta_i, controls, \rho, V_i)`.
6. Compute per-segment wind frame from `computeWindFrameNED(\alpha_i, \beta_i)`.
7. Decompose forces into body NED, sum with lever-arm moments.

With $\omega = 0$ this degenerates exactly to the static-airspeed
path (`computeSegmentForce` + `sumAllSegments`) used by the visualiser.
Tests confirm both paths match at $\omega = 0$ and that roll/pitch
rate damping moments emerge correctly.

---

## 11  Damping Derivatives

Classical stability analysis defines three primary rate-damping
coefficients:

| Derivative | Name          | Axis   | Physical source |
|-----------|---------------|--------|------------------|
| $C_{l_p}$ | Roll damping  | x-body | Differential lift at wingtips due to roll rate |
| $C_{m_q}$ | Pitch damping | y-body | Differential α at fore/aft canopy cells |
| $C_{n_r}$ | Yaw damping   | z-body | Differential drag at left/right segments |

All three arise **automatically** from the ω×r velocity correction
in §10.  They do not need to be specified as separate model parameters.
However, for linear stability analysis or gain scheduling, they can be
extracted numerically by perturbing $p$, $q$, $r$ one at a time and
measuring the moment response:

$$
C_{l_p} \approx \frac{\partial (L / q S b)}{\partial (p b / 2V)}
\qquad
C_{m_q} \approx \frac{\partial (M / q S \bar{c})}{\partial (q \bar{c} / 2V)}
\qquad
C_{n_r} \approx \frac{\partial (N / q S b)}{\partial (r b / 2V)}
$$

where $b$ = span, $\bar{c}$ = mean chord, $V$ = airspeed.

---

## 12  Apparent Mass (Added Mass)

When an accelerating body displaces air, it must accelerate some of
that air with it.  This is modelled as **apparent mass** — virtual inertia
added to the physical inertia tensor.

### 12.1  When It Matters

| Scenario | Relevance |
|----------|----------|
| Deployment (rapid chord/span change) | High — canopy inflating from packed to full |
| Pilot pitch swing | Moderate — pilot body displacing air during pendulum motion |
| Steady flight | Low — accounted for in aero coefficients |
| High-rate manoeuvres | Moderate — rapid pitch/roll couples with displaced air mass |

### 12.2  Flat-Plate Approximation for Canopy

For a thin canopy of span $b$ and chord $c$ (projected area $S = b \cdot c$),
the dominant apparent-mass terms are:

- **Normal** (z-axis): $m_{a,z} \approx \tfrac{\pi}{4}\rho\,c^2\,b$ — disc of air of diameter $c$
- **Chordwise** (x-axis): much smaller, often neglected
- **Spanwise** (y-axis): $m_{a,y} \approx \tfrac{\pi}{4}\rho\,b^2\,c$ — relevant for sideslip

Apparent inertia terms follow similarly for rotational acceleration.

### 12.3  Implementation

Apparent mass modifies the EOM as:

$$
(m + m_a)\,\dot{\vec{V}} = \vec{F}_{\text{total}} - \vec{\omega} \times (m + m_a)\,\vec{V}
$$

With anisotropic apparent mass (Lamb/Kirchhoff form):

$$
(m + m_{a,x})\,\dot{u} = F_x + (m + m_{a,y})\,r\,v - (m + m_{a,z})\,q\,w
$$

$$
(m + m_{a,y})\,\dot{v} = F_y + (m + m_{a,z})\,p\,w - (m + m_{a,x})\,r\,u
$$

$$
(m + m_{a,z})\,\dot{w} = F_z + (m + m_{a,x})\,q\,u - (m + m_{a,y})\,p\,v
$$

Note: the Coriolis cross-terms use the **other** axis's effective mass,
not the acceleration axis.  This creates the "Munk moment" coupling
significant for ram-air canopies.

**Status: ✅ implemented** in `apparent-mass.ts` and `eom.ts`:

- `computeApparentMass()` — flat-plate translational apparent mass
- `computeApparentInertia()` — strip-theory rotational apparent inertia
- `apparentMassAtDeploy()` — deployment-scaled apparent mass
- `effectiveMass()` / `effectiveInertia()` — combine physical + apparent
- `translationalEOMAnisotropic()` — Lamb/Kirchhoff Coriolis with per-axis mass
- `SimConfig.massPerAxis` — optional field; when set, `computeDerivatives()` uses anisotropic EOM

---

## 13  State Vector Architecture

The 12-state vector needs a canonical home in the codebase.

### 13.1  Proposed Type

```typescript
export interface SimState {
  // Inertial position [m] — NED Earth frame
  x: number;  y: number;  z: number
  // Body velocity [m/s] — NED body frame
  u: number;  v: number;  w: number
  // Euler angles [rad] — 3-2-1 (ψ → θ → φ)
  phi: number;  theta: number;  psi: number
  // Body angular rates [rad/s]
  p: number;  q: number;  r: number
}
```

### 13.2  Extended State (Pilot Pendulum)

The pilot pitch degree of freedom adds two more states:

```typescript
export interface SimStateExtended extends SimState {
  thetaPilot: number     // pilot pitch angle [rad]
  thetaPilotDot: number  // pilot pitch rate [rad/s]
}
```

### 13.3  Where It Lives

The state vector should live in a new `sim/` module or alongside `eom.ts`
in the `polar/` directory.  It is **not** a visualiser concern — the
visualiser consumes the state to render, but does not own it.

Candidate: `src/polar/sim-state.ts` — pure types, no logic, portable
to CloudBASE.

### 13.4  Flow Through the Sim Loop

```
 SimState(t)
    │
    │── config changes only (not every frame) ──────────────
    ├─→ rotatePilotMass(θ_pilot, pivot, deploy)
    │     → updated mass positions
    ├─→ computeCenterOfMass() → cg [m]
    ├─→ computeInertia()     → I(t)
    │
    │── derivative evaluation f(state) — called 4× by RK4 ─
    ├─→ sumAllSegments(segs, cg, h, V_body, ω, controls, ρ)
    │     → F_aero, M_aero  (with ω×r per-segment corrections)
    ├─→ gravityBody(φ, θ)   → g_B
    ├─→ F_total = F_aero + m·g_B
    │
    ├─→ translationalEOM(F_total, m, V, ω) → V̇
    ├─→ rotationalEOM(M_aero, I, ω)        → ω̇
    ├─→ eulerRates(p, q, r, φ, θ)          → Θ̇
    ├─→ dcmBodyToInertial(φ, θ, ψ) · V     → ẋ
    │
    └─→ RK4 advance (§6.2) → SimState(t + Δt)
```

---

## 14  Composite Body Frame

Our system is assembled from **swappable components** — canopy, pilot,
PC, bridle, risers — each with their own aero segments and mass
segments.  The composite body frame is the union of all these
components positioned in NED.

### 14.1  Current Approach

1. Each polar definition (`ibexulContinuous`, etc.) provides:
   - `aeroSegments[]` — position, area, chord, coefficients
   - `massSegments[]` — position, mass ratio, labels
2. Segment positions are **height-normalized** (`position / pilotHeight`).
3. At runtime, positions are scaled by height to get meters.
4. `computeCenterOfMass()` finds the system CG.
5. `sumAllSegments()` computes forces about that CG.
6. `computeInertia()` computes the tensor about that CG.

This is correct and necessary for swappable components — you can't
pre-bake a composite when the pilot body or canopy type can change.

### 14.2  What Could Be More Explicit — ✅ Resolved

| Concern | Current | Implemented |
|---------|---------|------------|
| CG computation | Recomputed each call | ✅ Cached in `CompositeFrame.cg`, rebuilt only on deploy/pitch change |
| Inertia tensor | Recomputed each call | ✅ Cached in `CompositeFrame.inertia`, invalidated via `frameNeedsRebuild()` |
| Segment-to-CG offsets | Computed inside `sumAllSegments()` | ✅ CG from `CompositeFrame` fed to `evaluateAeroForces()` |
| Deployment transition | `deploy` parameter threads through | ✅ `buildCompositeFrame(config, deploy, pitch)` owns all deploy state |
| Apparent mass coupling | Not modelled | ✅ `effectiveMass`/`effectiveInertia` on `CompositeFrame`, fed to `SimConfig.massPerAxis` |

### 14.3  Exportability — ✅ Implemented

For CloudBASE, the composite is serialisable via `CompositeFrame`:

```typescript
export interface CompositeFrame {
  aeroSegments: AeroSegment[]
  weightSegments: MassSegment[]
  inertiaSegments: MassSegment[]
  cg: Vec3NED              // meters
  inertia: InertiaComponents
  totalMass: number        // kg
  canopyGeometry: CanopyGeometry
  apparentMass: ApparentMassResult
  effectiveMass: { x: number; y: number; z: number }
  effectiveInertia: InertiaComponents
  height: number
  rho: number
  deploy: number
  pilotPitch: number
}
```

Factory: `buildCompositeFrame(config, deploy, pilotPitch) → CompositeFrame`
Dirty check: `frameNeedsRebuild(frame, deploy, pilotPitch) → boolean`
SimConfig bridge: `frameToSimConfig(frame, controls, useApparentMass) → SimConfig`

This snapshot is exported once per configuration change
(deploy, pilot pitch, component swap) rather than every frame.

---

## 15  Euler Rate Controls (UI + Viewer + Math)

The visualiser needs to let the user specify attitude rates in the
**inertial** frame — i.e. Euler rates $(\dot\phi, \dot\theta, \dot\psi)$
— convert them to body rates for the aero model, display the results,
and visualise both angular velocity and angular acceleration in the
3D viewer.

This section covers four tightly coupled changes that should be
implemented together:

1. **UI sliders** — Euler rate inputs in the Inertial Frame dropdown
2. **Math pipeline** — inverse DKE conversion + aero evaluation with ω
3. **Readout sections** — Rates & Positions below the Inertia readout
4. **3D viewer** — dual curved arrows + persistent frame reference axes

---

### 15.1  Use Cases

| Control | Euler Rate | Effect |
|---------|-----------|--------|
| Steady coordinated turn | $\dot\psi = \text{const}$ | Sets yaw rate in inertial frame |
| Pull-up / push-over | $\dot\theta = \text{const}$ | Pitch rate in inertial frame |
| Roll initiation | $\dot\phi = \text{const}$ | Bank angle change rate |

---

### 15.2  UI: Euler Rate Sliders

**Location:** Inside the Inertial Frame dropdown, immediately below
the existing Attitude (φ, θ, ψ) sliders.

**Header:** "Euler Rates (∂/∂t)"

| Slider | ID | Label | Range | Default | Units |
|--------|----|-------|-------|---------|-------|
| $\dot\phi$ | `phi-dot-slider` | φ̇ (Roll Rate) | −180 to +180 | 0 | °/s |
| $\dot\theta$ | `theta-dot-slider` | θ̇ (Pitch Rate) | −180 to +180 | 0 | °/s |
| $\dot\psi$ | `psi-dot-slider` | ψ̇ (Yaw Rate) | −180 to +180 | 0 | °/s |

These sliders are only visible when `frameMode === 'inertial'`,
alongside the attitude sliders.

**FlightState additions:**

```typescript
// Euler rates (deg/s) — inertial frame
phiDot_degps: number    // φ̇ — roll Euler rate
thetaDot_degps: number  // θ̇ — pitch Euler rate
psiDot_degps: number    // ψ̇ — yaw Euler rate
```

---

### 15.3  Math Pipeline: Euler Rates → Body Rates → Aero

The conversion chain:

```
 UI (φ̇, θ̇, ψ̇) [deg/s]
    │
    ├─→ convert to rad/s
    │
    ├─→ eulerRatesToBodyRates(φ̇, θ̇, ψ̇, φ, θ) → (p, q, r)
    │     inverse DKE (§4.2) — already implemented in eom.ts
    │
    ├─→ evaluateAeroForces(segs, cg, h, V_body, {p,q,r}, controls, ρ)
    │     ω×r velocity correction per segment (§10)
    │     → forces/moments include roll/pitch/yaw damping automatically
    │
    ├─→ translationalEOM(F, m, V, {p,q,r})
    │     or translationalEOMAnisotropic() if apparent mass active
    │     Coriolis ω×V coupling (§2)
    │
    └─→ rotationalEOM(M, I, {p,q,r})
          gyroscopic coupling (§3)
```

Body rates $(p, q, r)$ are used in:
1. The ω×r velocity correction at each segment (§10)
2. The ω×V Coriolis term in the translational EOM (§2)
3. Gyroscopic coupling in the rotational EOM (§3)

---

### 15.4  Readout: Rates & Positions Sections

Add two new sections to the right-hand readout panel, below the
existing Inertia section.

#### 15.4.1  Rates

| Row | Label | Value | Source |
|-----|-------|-------|--------|
| Euler rates | φ̇, θ̇, ψ̇ | °/s | From UI sliders |
| Body rates | p, q, r | °/s | `eulerRatesToBodyRates()` output |
| Rotational accel | ṗ, q̇, ṙ | °/s² | `rotationalEOM()` output |

This makes the DKE conversion visible — the user can see how
inertial-frame Euler rates map to body-frame angular velocities
at the current attitude.

#### 15.4.2  Positions

| Row | Label | Value | Source |
|-----|-------|-------|--------|
| CG (body) | x, y, z | m | `computeCenterOfMass()` |
| CG (inertial) | N, E, D | m | DCM · CG (from body → inertial transform) |
| Pilot pivot | x, z | — | `PILOT_PIVOT_X`, `PILOT_PIVOT_Z` (normalised) |

---

### 15.5  3D Viewer: Dual Curved Arrows

Currently, the three curved arrows (pitch, yaw, roll) show **either**
the aerodynamic moment **or** the angular acceleration (via the
"Show acceleration arcs" checkbox).

With Euler rate controls we now also have **angular velocity** to
visualise.  The arrows serve two different physical quantities in
two different frames:

| Arrow set | Quantity | Frame | Driven by |
|-----------|----------|-------|-----------|
| **Rate arcs** (new) | Angular velocity ω = (p, q, r) | Inertial → rotated into body | Euler rate sliders → inverse DKE |
| **Accel arcs** (existing) | Angular accel α̈ = (ṗ, q̇, ṙ) | Body frame | Aero moments ÷ inertia |

#### 15.5.1  Visual Distinction

| Property | Rate arcs (angular velocity) | Accel arcs (angular acceleration) |
|----------|------------------------------|----------------------------------|
| Colors | Desaturated / pastel tones | Current bright tones (🟠🟢🟣) |
| Style | Dashed or thinner arc | Solid thick arc (unchanged) |
| Radius | 1.4 (slightly larger) | 1.2 (current) |
| Frame context | Drawn in inertial frame, rotated into body | Drawn in body frame |
| Visibility | Visible when any Euler rate ≠ 0 | Controlled by "Show accel arcs" checkbox |

Suggested rate-arc colors:

| Axis | Accel arc (existing) | Rate arc (new) |
|------|---------------------|----------------|
| Pitch (x) | `0xff8844` (orange) | `0xffbb88` (pale orange) |
| Yaw (y) | `0x44ff88` (green) | `0x88ffbb` (pale green) |
| Roll (z) | `0x8844ff` (purple) | `0xbb88ff` (pale purple) |

#### 15.5.2  Coordinate Handling

The Euler rate arcs represent rotation in the **inertial** frame,
but the viewer draws everything relative to the body.

**Approach:** Construct the rate arcs in the inertial frame
orientation, then rotate them by the body attitude quaternion
into the body frame for display.  This makes their visual direction
consistent with the inertial-frame meaning of the Euler rates.

In **inertial frame mode:** Rate arcs use the attitude quaternion
(same as the model rotation).  Accel arcs also use it (current behaviour).

In **body frame mode:** Rate arcs use the attitude quaternion (so
they appear rotated relative to the body — showing the inertial-frame
direction).  Accel arcs use identity quaternion (current behaviour —
they're already in body frame).

---

### 15.6  3D Viewer: Persistent Frame Reference Axes

Currently:
- **Inertial frame mode:** N, E, and D compass labels are visible.
  Body frame has no reference.
- **Body frame mode:** Compass labels disappear.
  The Three.js AxesHelper shows x/y/z but with no labels.

**Desired:** Always show **both** frame references, with the
non-active frame rotated:

#### 15.6.1  Inertial Frame Reference (N, E, D labels)

| Viewer mode | Behaviour |
|-------------|-----------|
| Inertial frame | N, E, and D at grid edge (current, unchanged) |
| Body frame | N and E **rotated by inverse body attitude** — they appear tilted, showing where North/East are relative to the body |

Implementation: Instead of `compassLabels.visible = false` in body
mode, set `compassLabels.visible = true` and apply the **inverse**
body quaternion:

```typescript
if (frameMode === 'body') {
  compassLabels.visible = true
  const invQuat = bodyQuat.clone().invert()
  compassLabels.quaternion.copy(invQuat)
} else {
  compassLabels.visible = true
  compassLabels.quaternion.identity()
}
```

#### 15.6.2  Body Frame Reference (x_B, y_B, z_B labels)

Create a new set of axis labels for the body frame:

| Label | Colour | Position | Meaning |
|-------|--------|----------|---------|
| `x` | Red (`#ff4444`) | Forward in body frame | NED x (forward) |
| `y` | Green (`#44ff44`) | Right in body frame | NED y (right) |
| `z` | Blue (`#4444ff`) | Down in body frame | NED z (down) |

These follow the NED body-axis convention and are positioned at
the ends of the Three.js AxesHelper (radius ~1.5).

| Viewer mode | Behaviour |
|-------------|-----------|
| Body frame | x/y/z labels at axes tips, identity rotation — the body frame reference |
| Inertial frame | x/y/z labels **rotated by body attitude quaternion** — they tilt/swing with the model, showing where the body axes point in inertial space |

Implementation: Create a `bodyAxisLabels` group (similar to
`compassLabels`), add to scene, and apply:

```typescript
if (frameMode === 'inertial') {
  bodyAxisLabels.quaternion.copy(bodyQuat)
} else {
  bodyAxisLabels.quaternion.identity()
}
```

#### 15.6.3  Summary of Frame Label Behaviour

| Viewer mode | Inertial labels (N, E, D) | Body labels (x, y, z) |
|-------------|------------------------|----------------------|
| Body frame | Rotated by inverse body quat | Identity (fixed) |
| Inertial frame | Identity (fixed at grid edge) | Rotated by body quat |

Both are always visible — the user always has a reference for each
frame regardless of which frame the viewer is displaying.

---

### 15.7  Implementation Checklist

| # | Task | Module | Status |
|---|------|--------|--------|
| 1 | Add φ̇, θ̇, ψ̇ sliders to Inertial Frame dropdown | `index.html` + `controls.ts` | ✅ |
| 2 | Add `phiDot_degps`, `thetaDot_degps`, `psiDot_degps` to `FlightState` | `controls.ts` | ✅ |
| 3 | Call `eulerRatesToBodyRates()` in main update loop | `main.ts` | ✅ |
| 4 | Pass body rates (p, q, r) to `evaluateAeroForces()` | `main.ts` | ✅ |
| 5 | Add Rates readout section (Euler rates, body rates, accel) | `index.html` + `readout.ts` | ✅ |
| 6 | Add Positions readout section (CG body, CG inertial) | `index.html` + `readout.ts` | ✅ |
| 7 | Create 3 rate-arc `CurvedArrow` objects (pale colours, radius 1.4) | `vectors.ts` | ✅ |
| 8 | Drive rate arcs from body rates (p, q, r) | `vectors.ts` | ✅ |
| 9 | Apply correct quaternion to rate arcs (inertial→body transform) | `vectors.ts` + `main.ts` | ✅ |
| 10 | Create `bodyAxisLabels` group (x, y, z sprites) | `scene.ts` | ✅ |
| 11 | Make compass labels persistent (rotate by inverse quat in body mode) | `main.ts` | ✅ |
| 12 | Rotate body axis labels by body quat in inertial mode | `main.ts` | ✅ |

### 15.8  Terminology Convention

Following Academic Flight (3-2-1 Euler / ZYX intrinsic):

| Symbol | Name | Frame | Description |
|--------|------|-------|-------------|
| $\phi$ | Roll angle | Body ↔ Inertial | Rotation about final $x_B$ |
| $\theta$ | Pitch angle | Body ↔ Inertial | Rotation about intermediate $y$ |
| $\psi$ | Yaw / heading angle | Body ↔ Inertial | Rotation about initial $z_I$ |
| $\dot\phi$ | Roll Euler rate | Inertial | Time derivative of φ |
| $\dot\theta$ | Pitch Euler rate | Inertial | Time derivative of θ |
| $\dot\psi$ | Yaw Euler rate | Inertial | Time derivative of ψ |
| $p$ | Roll body rate | Body | Angular velocity about $x_B$ |
| $q$ | Pitch body rate | Body | Angular velocity about $y_B$ |
| $r$ | Yaw body rate | Body | Angular velocity about $z_B$ |
| $\alpha$ | Angle of attack | Wind ↔ Body | $\arctan(w/u)$ |
| $\beta$ | Sideslip angle | Wind ↔ Body | $\arcsin(v/V)$ |
| $\mu$ | Bank angle | Wind ↔ Inertial | Not same as φ (unless α=β=0) |
| $\gamma$ | Flight path angle | Wind ↔ Inertial | Vertical climb/descent angle |
| $\xi$ | Heading angle (wind) | Wind ↔ Inertial | Horizontal track direction |
| $[BE]$ | DCM inertial→body | — | `dcmBodyToInertial()` returns $[EB] = [BE]^T$ |
| $[BW]$ | DCM wind→body | — | `dcmWindToBody(α, β)` |
| $[B]$ | DKE matrix | — | Body rates → Euler rates (NOT a DCM!) |

---

## 16  Per-Segment Reference Velocity Arrows

When angular rates are non-zero, each aero segment sees a **different**
local freestream velocity due to the ω×r correction (§10).  Visualising
this per-segment local velocity makes the damping mechanism tangible —
you can literally see the outer cells seeing faster/slower flow.

### 16.1  What to Show

For each aero segment that already has lift/drag/side ArrowHelper arrows,
add one more ArrowHelper: the **reference velocity** vector at that
segment's aerodynamic centre.

| Arrow | Colour | Direction | Scale | Visible when |
|-------|--------|-----------|-------|-------------|
| V_local | Cyan `0x00cccc` | Local wind direction (−V̂_local) | Proportional to local airspeed | Always (when segments visible) |

The arrow points **into the wind** at each segment — same convention
as the system wind arrow — showing the freestream each cell sees.

### 16.2  Data Source

`evaluateAeroForces()` in `aero-segment.ts` already computes the local
velocity for each segment internally:

```typescript
const u_local = bodyVel.x + wxr_x
const v_local = bodyVel.y + wxr_y
const w_local = bodyVel.z + wxr_z
```

But it does **not** return this data — it only returns the summed
forces and moments.

**Required change:** Create a new function (or extend the existing one)
that returns per-segment results including local velocity:

```typescript
export interface SegmentAeroResult {
  name: string
  /** Per-segment force result (lift, drag, side, moment, cp) */
  forces: SegmentForceResult
  /** Local velocity at this segment [m/s] — body NED */
  localVelocity: Vec3NED
  /** Local airspeed [m/s] — ||V_local|| */
  localAirspeed: number
  /** Local angle of attack [deg] */
  localAlpha: number
  /** Local sideslip [deg] */
  localBeta: number
  /** Segment position in meters [NED body frame] */
  positionMeters: Vec3NED
}

export function evaluateAeroForcesDetailed(
  segments: AeroSegment[],
  cgMeters: Vec3NED,
  height: number,
  bodyVel: Vec3NED,
  omega: AngularVelocity,
  controls: SegmentControls,
  rho: number,
): { system: SystemForces; perSegment: SegmentAeroResult[] }
```

The existing `evaluateAeroForces()` can then be a thin wrapper that
calls the detailed version and returns only `system`.

### 16.3  Arrow Rendering

#### 16.3.1  SegmentArrows Update

Add a `velocity` ArrowHelper to the existing `SegmentArrows` interface:

```typescript
export interface SegmentArrows {
  name: string
  lift: THREE.ArrowHelper
  drag: THREE.ArrowHelper
  side: THREE.ArrowHelper
  velocity: THREE.ArrowHelper   // ← new
  group: THREE.Group
}
```

Colour: `0x00cccc` (cyan) — distinct from lift (green), drag (red),
side (blue).

#### 16.3.2  Driving the Arrow

In the `updateForceVectors()` path that processes per-segment forces:

```typescript
// Local velocity arrow (−V direction = into the wind)
const localVel = perSegment[i].localVelocity
const velThree = nedToThreeJS(localVel).negate()  // flip: arrow into wind
const velMag = perSegment[i].localAirspeed
const VEL_SCALE = 0.1  // m/s → visual units
if (velMag > 0.1) {
  sa.velocity.setDirection(applyFrame(velThree.normalize()))
  sa.velocity.setLength(velMag * VEL_SCALE, 0.06, 0.03)
  sa.velocity.position.copy(posWorld)
  sa.velocity.visible = true
} else {
  sa.velocity.visible = false
}
```

### 16.4  What It Reveals

| Scenario | Velocity Arrow Pattern |
|----------|----------------------|
| Zero rate (ω = 0) | All arrows identical — same as system wind arrow |
| Roll rate (p ≠ 0) | Outer cells see different V — one side faster, one side slower |
| Pitch rate (q ≠ 0) | Leading cells vs trailing cells differ |
| Yaw rate (r ≠ 0) | Similar to roll — lateral asymmetry |
| Combined rates | Complex pattern — the actual local flow field |

This is directly tied to the damping derivatives from §11 — the
velocity arrows show **why** roll damping arises: the descending wing
sees higher local airspeed (more lift), the rising wing sees lower
(less lift), creating a restoring moment.

### 16.5  Implementation Checklist

| # | Task | Module | Status |
|---|------|--------|--------|
| 1 | Create `SegmentAeroResult` interface | `aero-segment.ts` | ✅ |
| 2 | Implement `evaluateAeroForcesDetailed()` | `aero-segment.ts` | ✅ |
| 3 | Make `evaluateAeroForces()` a wrapper | `aero-segment.ts` | ✅ |
| 4 | Add `velocity` to `SegmentArrows` interface | `vectors.ts` | ✅ |
| 5 | Create velocity ArrowHelper (cyan, `0x00cccc`) | `vectors.ts` | ✅ |
| 6 | Drive velocity arrow from `SegmentAeroResult` | `vectors.ts` | ✅ |
| 7 | Pass `perSegment` data through update chain | `main.ts` | ✅ |
| 8 | Update barrel exports | `index.ts` | ✅ |
