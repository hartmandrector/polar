# Reference Frames — Overview

The simulator manages five coordinate frames to move data between aerodynamic math (NED), equations of motion (body frame), rendering (Three.js Y-up), and model loading (GLB). Errors in frame conversions are the single most common source of physics bugs — this system makes every transformation explicit and traceable.

→ Full specification: [FRAMES.md](FRAMES.md)

---

- **[Five reference frames](FRAMES.md#2--reference-frames)** — Inertial NED Earth, Body NED, Wind frame, Three.js Y-up rendering frame, and GLB model frame — each with defined axes and conversion rules
- **[Euler angles (3-2-1 sequence)](FRAMES.md#3--euler-angles-3-2-1-sequence)** — Yaw → pitch → roll rotation sequence connecting body to inertial frame, with gimbal lock analysis for our flight envelope
- **[Direction cosine matrices](FRAMES.md#4--directional-cosine-matrices-dcm)** — Body↔Inertial and Wind↔Body DCMs with full matrix entries, used for force projection and velocity transforms
- **[Rotating-frame derivative](FRAMES.md#6--rotating-frame-derivative)** — The mathematical core: how writing Newton's law in a rotating frame produces the Coriolis (ω × V) and gyroscopic (ω × Iω) terms in the equations of motion
- **[Differential kinematic equation](FRAMES.md#7--differential-kinematic-equation-dke)** — The critical distinction that body rates (p, q, r) ≠ Euler rates (φ̇, θ̇, ψ̇), with both forward and inverse transforms
- **[Per-segment ω×r velocity correction](FRAMES.md#10--per-segment-ωr-velocity-correction)** — Each segment sees different local airspeed when the body rotates, automatically producing roll/pitch/yaw damping without explicit derivative parameters
- **[Integration pipeline](FRAMES.md#13--integration-pipeline-frame-flow)** — Complete frame flow through one integration step: Inertial → Body (forces) → Wind (per-segment aero) → Body (summation) → Inertial (kinematics) → Three.js (rendering)
