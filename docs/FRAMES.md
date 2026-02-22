# FRAMES.md — Reference Frames & Coordinate Transformations

> Describes every reference frame used in the simulator, the
> transformations between them, the rotating-frame derivative that
> gives rise to the Coriolis terms in the equations of motion,
> and the per-segment ω×r velocity correction that produces
> automatic damping derivatives.

---

## 1  Overview

A 6DOF flight simulator requires careful management of multiple
reference frames.  Aerodynamic forces are naturally expressed in the
**wind frame**; the equations of motion are written in the **body frame**;
gravity lives in the **inertial frame**; and the 3D viewer renders in a
**Three.js Y-up frame**.  Errors in frame conversions are the single
most common source of physics bugs.

This document catalogues every frame, the matrices that connect them,
and the code that implements each transformation.

### Sources

- [Academic Flight — Aircraft Attitude and Euler Angles](https://academicflight.com/articles/aircraft-attitude-and-euler-angles/)
- [Academic Flight — Equations of Motion](https://academicflight.com/articles/equations-of-motion/)
- SIMULATION.md §§1–6 — state vector, EOM, kinematics, integration

---

## 2  Reference Frames

### 2.1  Inertial Frame E (NED Earth)

| Axis | Direction | Positive |
|------|-----------|----------|
| x | North | Forward along ground |
| y | East | Rightward |
| z | Down | Into the Earth |

The inertial frame is fixed to the Earth's surface.  For the flight
envelopes we model (paragliders, wingsuits, skydivers), Earth rotation
and curvature are ignored — the flat-Earth NED approximation is exact
to the precision we need.

**State variables in this frame:** position $(x, y, z)$ in meters.

### 2.2  Body Frame B (NED Body)

| Axis | Direction | Positive |
|------|-----------|----------|
| x | Forward | Along the vehicle's longitudinal axis (head direction) |
| y | Right | Starboard / right wing |
| z | Down | Toward the ground when level |

The body frame is rigidly attached to the vehicle and rotates with it.
All aerodynamic segment positions, mass segment positions, and the
inertia tensor are expressed in body NED.

**State variables in this frame:** velocity $(u, v, w)$ in m/s, angular rates $(p, q, r)$ in rad/s.

> **Why body-frame velocity?**  Writing Newton's law in the body frame
> makes the inertia tensor time-independent (the mass distribution doesn't
> move relative to the body).  The cost is an extra Coriolis term
> $\vec{\omega} \times \vec{V}$ in the translational EOM — see §6.

### 2.3  Wind Frame W

| Axis | Direction | Positive |
|------|-----------|----------|
| x | Along airspeed vector | Into the wind |
| y | Perpendicular to lift, in the horizontal plane | Starboard |
| z | Perpendicular to airspeed, in the plane of symmetry | Opposite to lift |

The wind frame is defined by the **relative airflow**.  Aerodynamic
forces decompose naturally here:
- **Drag:** along −x_W (opposing airspeed)
- **Side force:** along y_W
- **Lift:** along −z_W

The wind frame is related to the body frame by two angles:
- **Angle of attack** $\alpha$: rotation about the y-body axis
- **Sideslip angle** $\beta$: rotation about the z-body axis

$$
\alpha = \arctan\!\left(\frac{w}{u}\right), \qquad
\beta = \arcsin\!\left(\frac{v}{V}\right)
$$

where $V = \sqrt{u^2 + v^2 + w^2}$.

### 2.4  Three.js Rendering Frame

| Axis | Direction | Positive |
|------|-----------|----------|
| X | Left | Port (opposite to NED y) |
| Y | Up | Opposite to NED z |
| Z | Forward | Same as NED x |

Three.js uses a right-handed Y-up coordinate system.  The mapping from
NED body to Three.js is:

$$
\begin{pmatrix} X \\ Y \\ Z \end{pmatrix}_{\text{Three.js}}
=
\begin{pmatrix} -y \\ -z \\ x \end{pmatrix}_{\text{NED}}
$$

This is a fixed remapping, not a rotation — no angles involved.

**Code:** `nedToThreeJS(v)` and `threeJSToNed(v)` in `frames.ts`

```
NED →  Three.js          Three.js →  NED
x  →  Z                  X → -y
y  → -X                  Y → -z
z  → -Y                  Z →  x
```

### 2.5  GLB Model Frame

GLB models from Blender use a Z-forward convention (different from
Three.js Y-up).  The loader applies a −90° rotation at import time to
align the model with the Three.js frame.  No physics code touches this
frame — it exists only at model-loading time.

### 2.6  Chord-Fraction Frame (Wingsuit)

Wingsuit segment positions are stored as **chord fractions** (x/c) and
converted to NED meters via:

$$
x_{\text{NED}} = (\text{CG}_{xc} - x_c) \cdot \frac{\text{SYS\_CHORD}}{\text{HEIGHT}}
$$

where `CG_xc = 0.40`, `SYS_CHORD = 1.8 m`, `HEIGHT = 1.875 m`.

**Code:** `a5xc(xc)` in `polar-data.ts`

### 2.7  "Roll Angle" Disambiguation

Three distinct quantities share the word "roll" across this project and related work:

| Name | Symbol | Frame | Meaning |
|------|--------|-------|---------|
| **Euler roll** | $\phi$ | Body → Inertial | Bank angle from 3-2-1 decomposition. `FlightState.roll_deg`. |
| **Cell arc angle** | $\theta_{\text{arc}}$ | Span geometry | Angular station of a canopy cell along the curved span. `AeroSegment.orientation.roll_deg`. **Not** an Euler angle — purely geometric. |
| **GPS-derived roll** | $\phi_V$ | Velocity (wind) | Bank angle estimated by projecting acceleration onto velocity. Assumes forward = $\vec{V}$, no sideslip ($\beta = 0$). Used in Kalman filter / GPS flight analysis. |

$\phi$ and $\phi_V$ are approximately equal in steady symmetric flight (small $\beta$)
but diverge with sideslip or unsteady motion. $\theta_{\text{arc}}$ is a completely
different concept — it describes **where** a segment sits on the span, not how the
vehicle is banked.

> **Future cleanup:** `orientation.roll_deg` on `AeroSegment` could be renamed
> to `arcAngle_deg` to eliminate collision with Euler $\phi$.

---

## 3  Euler Angles (3-2-1 Sequence)

The body frame's orientation relative to the inertial frame is
parameterised by three Euler angles using the **3-2-1 (aerospace)
rotation sequence**: yaw (ψ) → pitch (θ) → roll (φ).

### 3.1  Construction Procedure

Starting from an aircraft flying north, wings level:

1. **Yaw** by ψ about the z-axis (down) — heading change
2. **Pitch** by θ about the *new* y-axis — nose up/down
3. **Roll** by φ about the *new* x-axis — bank left/right

The order matters — rotations in 3D are non-commutative.

### 3.2  Individual Rotation Matrices

$$
R_z(\psi) = \begin{pmatrix}
\cos\psi & \sin\psi & 0 \\
-\sin\psi & \cos\psi & 0 \\
0 & 0 & 1
\end{pmatrix}
$$

$$
R_y(\theta) = \begin{pmatrix}
\cos\theta & 0 & -\sin\theta \\
0 & 1 & 0 \\
\sin\theta & 0 & \cos\theta
\end{pmatrix}
$$

$$
R_x(\phi) = \begin{pmatrix}
1 & 0 & 0 \\
0 & \cos\phi & \sin\phi \\
0 & -\sin\phi & \cos\phi
\end{pmatrix}
$$

### 3.3  Singularity

The 3-2-1 representation has a coordinate singularity at $\theta = \pm 90°$
(gimbal lock) where the yaw and roll axes are aligned.  This is
acceptable for paraglider/wingsuit flight envelopes which never approach
vertical dive or vertical climb.  Quaternion kinematics would be
needed for aerobatic vehicles.

---

## 4  Directional Cosine Matrices (DCM)

### 4.1  Body → Inertial: $[EB]$

Transforms a vector from body-frame components to inertial-frame components:

$$
\vec{V}_E = [EB] \; \vec{V}_B
$$

The matrix is the product $R_x(\phi)^T \cdot R_y(\theta)^T \cdot R_z(\psi)^T$:

$$
[EB] = \begin{pmatrix}
c_\theta c_\psi & s_\phi s_\theta c_\psi - c_\phi s_\psi & c_\phi s_\theta c_\psi + s_\phi s_\psi \\
c_\theta s_\psi & s_\phi s_\theta s_\psi + c_\phi c_\psi & c_\phi s_\theta s_\psi - s_\phi c_\psi \\
-s_\theta & s_\phi c_\theta & c_\phi c_\theta
\end{pmatrix}
$$

where $c_\phi = \cos\phi$, $s_\phi = \sin\phi$, etc.

**Code:** `dcmBodyToInertial(phi, theta, psi)` in `frames.ts` — returns a 9-element column-major array.

The inverse is the transpose: $[BE] = [EB]^T$ (orthonormal rotation matrix).

### 4.2  Wind → Body: $[BW]$

Transforms aerodynamic force coefficients from wind frame to body frame:

$$
[BW] = \begin{pmatrix}
\cos\alpha\cos\beta & -\cos\alpha\sin\beta & -\sin\alpha \\
\sin\beta & \cos\beta & 0 \\
\sin\alpha\cos\beta & -\sin\alpha\sin\beta & \cos\alpha
\end{pmatrix}
$$

This is constructed as $R_y(-\beta) \cdot R_z(\alpha)$ — first rotate by α about the z-axis (yaw-like), then by −β about the new y-axis.

**Code:** `dcmWindToBody(alpha_deg, beta_deg)` in `frames.ts`

### 4.3  Wind Frame Directions in Body Frame

For force decomposition, we need the wind, lift, and side directions
expressed in body NED:

$$
\hat{d}_{\text{wind}} = (\cos\alpha\cos\beta,\; \sin\beta,\; \sin\alpha\cos\beta)
$$

$$
\hat{d}_{\text{lift}} = (-\sin\alpha\cos\beta,\; 0,\; \cos\alpha\cos\beta) \quad\text{(unnormalized)}
$$

$$
\hat{d}_{\text{side}} = (-\cos\alpha\sin\beta,\; \cos\beta,\; -\sin\alpha\sin\beta) \quad\text{(unnormalized)}
$$

Forces are applied as:
- Drag along $-\hat{d}_{\text{wind}}$
- Lift along $-\hat{d}_{\text{lift}}$ (normalized)
- Side force along $\hat{d}_{\text{side}}$ (normalized)

**Code:** `computeWindFrameNED(alpha_deg, beta_deg)` in `aero-segment.ts`

---

## 5  Quaternions (Three.js Rendering)

For the 3D viewer, we need a Three.js `Quaternion` representing the
body orientation.  This is built from the DCM rather than directly from
Euler angles, to avoid any ambiguity about rotation order:

1. Compute $[EB]$ from `dcmBodyToInertial(φ, θ, ψ)`
2. Apply the NED → Three.js axis remapping
3. Convert to Three.js `Matrix4`
4. Extract quaternion via `Quaternion.setFromRotationMatrix()`

**Code:** `bodyToInertialQuat(phi, theta, psi)` in `frames.ts`

### 5.1  Wind-Attitude Mode

When the viewer displays attitude relative to the wind (flight path),
the composition is:

$$
q_{\text{body}} = q_{\text{wind}} \cdot R_x(-\alpha) \cdot R_y(\beta)
$$

This builds the body quaternion from wind-frame Euler angles (μ, γ, ξ)
plus the aerodynamic angles (α, β).

**Code:** `bodyQuatFromWindAttitude(wind_phi, wind_theta, wind_psi, alpha_deg, beta_deg)` in `frames.ts`

### 5.2  Wind Direction in Three.js Body Frame

For rendering the airspeed vector arrow, the body-frame wind direction
is computed and converted to Three.js coordinates:

$$
\hat{d}_{\text{wind}}^{\text{Three.js}} = \text{nedToThreeJS}\!\big((\cos\alpha\cos\beta,\; \sin\beta,\; \sin\alpha\cos\beta)\big)
$$

**Code:** `windDirectionBody(alpha_deg, beta_deg)` in `frames.ts`

---

## 6  Rotating-Frame Derivative

The central mathematical result that drives the body-frame equations of
motion.  Per [Academic Flight — Equations of Motion](https://academicflight.com/articles/equations-of-motion/):

> For a vector-valued function $\vec{f}$ in frame B rotating at angular
> velocity $\vec{\omega}_{B/A}$ relative to frame A:
>
> $$\frac{{}^A d\vec{f}}{dt} = \frac{{}^B d\vec{f}}{dt} + \vec{\omega}_{B/A} \times \vec{f}$$

The inertial-frame derivative equals the body-frame derivative plus the
cross product with angular velocity.  This is the origin of every
Coriolis and gyroscopic term in the simulator.

### 6.1  Translational Dynamics

Applying the rotating-frame derivative to $\vec{P} = m\vec{V}$:

$$
\vec{F} = m\frac{{}^B d\vec{V}}{dt} + m\,\vec{\omega} \times \vec{V}
$$

Solved for acceleration in the body frame:

$$
\frac{{}^B d\vec{V}}{dt} = \frac{\vec{F}}{m} - \vec{\omega} \times \vec{V}
$$

**Scalar form (NED body):**

$$
\dot{u} = \frac{F_x}{m} + rv - qw
$$

$$
\dot{v} = \frac{F_y}{m} + pw - ru
$$

$$
\dot{w} = \frac{F_z}{m} + qu - pv
$$

The "+rv − qw" terms are the Coriolis acceleration from writing Newton's
law in the rotating body frame.  They are **not** external forces — they
arise purely from the choice of reference frame.

**Code:** `translationalEOM(force, mass, vel, omega)` in `eom.ts`

### 6.2  Rotational Dynamics (Euler's Equation)

Applying the rotating-frame derivative to $\vec{H} = [I]\vec{\omega}$:

$$
\vec{M} = [I]\frac{{}^B d\vec{\omega}}{dt} + \vec{\omega} \times [I]\vec{\omega}
$$

For a symmetric vehicle ($I_{xy} = I_{yz} = 0$, $I_{xz} \neq 0$):

$$
\Gamma = I_{xx}I_{zz} - I_{xz}^2
$$

$$
\dot{p} = \frac{1}{\Gamma}\Big[I_{zz}L + I_{xz}N - I_{xz}(I_{xx} - I_{yy} + I_{zz})pq + (I_{xz}^2 + I_{zz}(I_{zz} - I_{yy}))qr\Big]
$$

$$
\dot{q} = \frac{1}{I_{yy}}\Big[M - (I_{xx} - I_{zz})pr - I_{xz}(p^2 - r^2)\Big]
$$

$$
\dot{r} = \frac{1}{\Gamma}\Big[I_{xz}L + I_{xx}N + I_{xz}(I_{zz} - I_{yy} + I_{xx})qr - (I_{xz}^2 + I_{xx}(I_{xx} - I_{yy}))pq\Big]
$$

The $\vec{\omega} \times [I]\vec{\omega}$ terms produce gyroscopic coupling
between axes — rolling while yawing creates a pitching moment, etc.

**Code:** `rotationalEOM(moment, inertia, omega)` in `eom.ts`

### 6.3  Anisotropic Mass (Lamb/Kirchhoff Form)

When apparent mass is present and different along each axis, the
cross-terms use the **other** axis's effective mass:

$$
(m + m_{a,x})\dot{u} = F_x + (m + m_{a,y})rv - (m + m_{a,z})qw
$$

$$
(m + m_{a,y})\dot{v} = F_y + (m + m_{a,z})pw - (m + m_{a,x})ru
$$

$$
(m + m_{a,z})\dot{w} = F_z + (m + m_{a,x})qu - (m + m_{a,y})pv
$$

This asymmetry between the acceleration axis mass and the Coriolis axis
mass creates the **Munk moment** — a yawing tendency in sideslip that
is significant for ram-air canopies where the normal apparent mass far
exceeds the chordwise apparent mass.

**Code:** `translationalEOMAnisotropic(force, massPerAxis, vel, omega)` in `eom.ts`

---

## 7  Differential Kinematic Equation (DKE)

Body angular rates $(p, q, r)$ and Euler rates $(\dot\phi, \dot\theta, \dot\psi)$
are **not** the same thing.

> "It is tempting to think the DCM [EB] relates body rates to Euler
> rates. This is distinctly false."
> — [Academic Flight](https://academicflight.com/articles/aircraft-attitude-and-euler-angles/)

Euler angles are defined via a mixed sequence of rotations about
different intermediate axes.  The relationship is captured by the
**body-to-Euler-rate transformation matrix** $[B]$, which is not
orthogonal and cannot be inverted by transposing.

### 7.1  Forward DKE — Body Rates → Euler Rates

$$
\begin{pmatrix} \dot\phi \\ \dot\theta \\ \dot\psi \end{pmatrix}
= \frac{1}{\cos\theta}
\begin{pmatrix}
\cos\theta & \sin\phi\sin\theta & \cos\phi\sin\theta \\
0 & \cos\phi\cos\theta & -\sin\phi\cos\theta \\
0 & \sin\phi & \cos\phi
\end{pmatrix}
\begin{pmatrix} p \\ q \\ r \end{pmatrix}
$$

The $1/\cos\theta$ factor creates the singularity at $\theta = \pm 90°$.

**Code:** `eulerRates(p, q, r, phi, theta)` in `eom.ts`

### 7.2  Inverse DKE — Euler Rates → Body Rates

$$
\begin{pmatrix} p \\ q \\ r \end{pmatrix}
=
\begin{pmatrix}
1 & 0 & -\sin\theta \\
0 & \cos\phi & \sin\phi\cos\theta \\
0 & -\sin\phi & \cos\phi\cos\theta
\end{pmatrix}
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

**Code:** `eulerRatesToBodyRates(phiDot, thetaDot, psiDot, phi, theta)` in `eom.ts`

---

## 8  Translational Kinematics

The body-frame velocity must be rotated into the inertial frame to
update position:

$$
\begin{pmatrix} \dot{x} \\ \dot{y} \\ \dot{z} \end{pmatrix}
= [EB]
\begin{pmatrix} u \\ v \\ w \end{pmatrix}
$$

This uses the full DCM from §4.1.

**Code:** `bodyToInertialVelocity(u, v, w, phi, theta, psi)` in `eom.ts`

---

## 9  Gravity in Body Frame

Gravity is constant in the inertial frame: $\vec{g}_E = (0, 0, g)^T$ (NED: down is positive).

To project it into the body frame, multiply by $[BE] = [EB]^T$:

$$
\vec{g}_B = \begin{pmatrix}
-g\sin\theta \\
g\sin\phi\cos\theta \\
g\cos\phi\cos\theta
\end{pmatrix}
$$

At zero attitude ($\phi = \theta = 0$), gravity is purely $(0, 0, g)$ — straight down in the body frame, as expected.

**Code:** `gravityBody(phi, theta, g)` in `eom.ts`

---

## 10  Per-Segment ω×r Velocity Correction

This is where the rotating-frame derivative (§6) meets the multi-segment
aerodynamic model.

### 10.1  The Problem

When the body is rotating, segments far from the CG see a different
local airspeed than the CG itself.  A wingtip during a roll sees
increased or decreased apparent wind depending on which side it's on.

### 10.2  Local Velocity

For a segment at body-frame position $\vec{r}_i$ from the CG:

$$
\vec{V}_{\text{local},i} = \vec{V}_{\text{CG}} + \vec{\omega} \times \vec{r}_i
$$

Expanded:

$$
\vec{\omega} \times \vec{r}_i = \begin{pmatrix}
qr_z - rr_y \\
rr_x - pr_z \\
pr_y - qr_x
\end{pmatrix}
$$

### 10.3  Local Flow Angles

From the local velocity, each segment derives its own:

$$
V_i = |\vec{V}_{\text{local},i}|, \quad
\alpha_i = \arctan\!\left(\frac{w_i}{u_i}\right), \quad
\beta_i = \arcsin\!\left(\frac{v_i}{V_i}\right)
$$

$$
q_i = \tfrac{1}{2}\rho V_i^2
$$

Each segment evaluates its own Kirchhoff model at $(\alpha_i, \beta_i)$
with its own dynamic pressure $q_i$.

### 10.4  Automatic Damping Derivatives

With this correction, classical rate-damping derivatives emerge
automatically from the geometry:

| Body rate | Affected segments | Resulting damping |
|-----------|-------------------|-------------------|
| **Roll** ($p$) | Left/right wingtips see different α and V | Roll damping $C_{l_p}$ — differential lift opposes roll |
| **Pitch** ($q$) | Fore/aft segments see modified α | Pitch damping $C_{m_q}$ — trailing segments produce restoring moment |
| **Yaw** ($r$) | Left/right segments see differential drag | Yaw damping $C_{n_r}$ — asymmetric drag opposes yaw |

**No separate derivative parameters are needed** — the damping arises
from the segment positions and the ω×r correction.

### 10.5  Implementation

**Code:** `evaluateAeroForcesDetailed(segments, cgMeters, height, bodyVel, omega, controls, rho)` in `aero-segment.ts`

1. For each segment, compute $\vec{r}_i$ = (segment position − CG) × height (conversion to meters).
2. Compute $\vec{\omega} \times \vec{r}_i$.
3. $\vec{V}_{\text{local},i} = \vec{V}_{\text{CG}} + \vec{\omega} \times \vec{r}_i$
4. Derive local $(V_i, \alpha_i, \beta_i)$.
5. Call `computeSegmentForce(seg, alpha_i, beta_i, controls, rho, V_i)`.
6. Build wind frame from `computeWindFrameNED(alpha_i, beta_i)`.
7. Decompose forces into body NED with lever-arm moments.

With $\omega = 0$ this degenerates to the static path — tests confirm
both paths produce identical results at zero angular rate.

---

## 11  CP Offset in Body Frame

The center of pressure CP from the Kirchhoff model (§4.5 of KIRCHHOFF.md) is a
chord fraction.  To compute the moment arm, it must be converted to a
physical offset from the segment's aerodynamic center (AC at 0.25c):

$$
\Delta x_{\text{CP}} = -(\text{CP} - 0.25) \cdot \frac{\text{chord}}{\text{height}}
$$

The negative sign follows from the NED convention: CP aft of the AC
(CP > 0.25) produces a negative x-offset (aft in body NED).

For segments with a pitch offset (e.g. vertical pilot), this chord
offset is rotated by the base pitch angle plus any dynamic pilot pitch:

$$
\text{rotation} = \text{pitchOffset} + \text{\_chordRotationRad}
$$

$$
\Delta x' = \Delta x \cos(\text{rotation}) - \Delta z \sin(\text{rotation})
$$

$$
\Delta z' = \Delta x \sin(\text{rotation}) + \Delta z \cos(\text{rotation})
$$

**Code:** CP offset logic in `computeSegmentForce()` in `aero-segment.ts`

---

## 12  Pilot Pendulum Frame

The pilot body swings as a pendulum about the riser attachment point.
The pilot pitch angle $\theta_p$ defines a rotated sub-frame within the
body frame:

- Pilot mass positions are rotated about the riser pivot by $\theta_p$
  (same rotation as §7 of KIRCHHOFF.md, §7.2).
- The pilot's inertia about the riser pivot is computed via the
  parallel-axis theorem: $I_{\text{pivot}} = \sum m_i d_i^2$.
- Gravity provides a restoring torque: $\tau_g = -m_p g l \sin(\theta_p - \theta)$.
- Canopy pitch acceleration couples through the risers: $\tau_c = -I_p \dot{q}$.

**Code:** `computePilotPendulumParams()`, `pilotPendulumEOM()`, `pilotSwingDampingTorque()` in `eom.ts`

---

## 13  Integration Pipeline (Frame Flow)

The complete frame flow through one integration step:

```
              INERTIAL (NED Earth)
                    │
    ┌───────────────┴───────────────┐
    │ position (x,y,z)              │
    │ gravity gE = (0,0,+g)        │
    └───────────────┬───────────────┘
                    │ [BE] = [EB]ᵀ
                    ▼
              BODY (NED Body)
    ┌───────────────────────────────┐
    │ velocity (u,v,w)              │
    │ angular rates (p,q,r)         │
    │ gravity gB = [BE]·gE         │
    │ inertia tensor [I]            │
    │ segment positions             │
    │                               │
    │  for each segment i:          │
    │    V_local = V_CG + ω × rᵢ   │
    │    (αᵢ, βᵢ, Vᵢ) from V_local │
    │         │                     │
    │         ▼                     │
    │    WIND FRAME (per-segment)   │
    │    CL, CD, CY, CM, CP        │
    │    → [BW] → body forces      │
    │                               │
    │ sum forces & moments at CG    │
    │ translationalEOM → (u̇,v̇,ẇ)  │
    │ rotationalEOM   → (ṗ,q̇,ṙ)  │
    │ eulerRates      → (φ̇,θ̇,ψ̇) │
    └───────────────┬───────────────┘
                    │ [EB]
                    ▼
              INERTIAL
    ┌───────────────────────────────┐
    │ bodyToInertialVelocity        │
    │ → (ẋ,ẏ,ż) = [EB]·(u,v,w)   │
    │                               │
    │ Forward Euler / RK4           │
    │ state(t+dt) = state(t) + dt·ḟ│
    └───────────────────────────────┘
                    │
                    ▼
              THREE.JS (Y-up)
    ┌───────────────────────────────┐
    │ nedToThreeJS(position)        │
    │ bodyToInertialQuat(φ,θ,ψ)    │
    │ → scene render                │
    └───────────────────────────────┘
```

---

## 14  Code Map

| File | Key Functions | Frame Responsibility |
|------|---------------|---------------------|
| `frames.ts` | `nedToThreeJS`, `threeJSToNed` | NED ↔ Three.js axis remapping |
| `frames.ts` | `dcmBodyToInertial` | Body → Inertial DCM $[EB]$ |
| `frames.ts` | `dcmWindToBody` | Wind → Body DCM $[BW]$ |
| `frames.ts` | `bodyToInertialQuat` | Body orientation as Three.js quaternion |
| `frames.ts` | `bodyQuatFromWindAttitude` | Wind-attitude composition for rendering |
| `frames.ts` | `windDirectionBody` | Wind direction in Three.js body coords |
| `eom.ts` | `gravityBody` | Inertial gravity → body projection |
| `eom.ts` | `translationalEOM` | Body-frame Newton: $\vec{F}/m - \vec{\omega} \times \vec{V}$ |
| `eom.ts` | `translationalEOMAnisotropic` | Lamb/Kirchhoff with anisotropic mass |
| `eom.ts` | `rotationalEOM` | Euler's equation with $I_{xz}$ coupling |
| `eom.ts` | `eulerRates` | Forward DKE: body rates → Euler rates |
| `eom.ts` | `eulerRatesToBodyRates` | Inverse DKE: Euler rates → body rates |
| `eom.ts` | `bodyToInertialVelocity` | Translational kinematics: body → inertial velocity |
| `eom.ts` | `computePilotPendulumParams` | Pilot inertia about riser pivot |
| `eom.ts` | `pilotPendulumEOM` | Pilot pendulum angular acceleration |
| `aero-segment.ts` | `computeWindFrameNED` | Wind/lift/side directions in body NED |
| `aero-segment.ts` | `evaluateAeroForcesDetailed` | Per-segment ω×r → local (α, β, V) |
| `sim.ts` | `computeDerivatives` | Full 12-state derivative evaluation |
| `sim.ts` | `forwardEuler`, `rk4Step` | State integration |

---

## 15  References

- [Academic Flight — Aircraft Attitude and Euler Angles](https://academicflight.com/articles/aircraft-attitude-and-euler-angles/) — 3-2-1 Euler angles, DCM construction, differential kinematic equation
- [Academic Flight — Equations of Motion](https://academicflight.com/articles/equations-of-motion/) — Rotating-frame derivative, translational & rotational dynamic equations, numerical integration procedure
- SIMULATION.md — Project-specific 6DOF EOM reference with code mappings
- Stevens, B. L. & Lewis, F. L. (2003). *Aircraft Control and Simulation.* — Standard aerospace 6DOF reference
- Etkin, B. (1972). *Dynamics of Atmospheric Flight.* — Body-frame EOM derivation, stability derivatives
