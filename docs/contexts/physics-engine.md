# Context: Physics Engine

> **Load this context** when working on equations of motion, force/moment
> summation, per-segment aerodynamics, inertia, apparent mass, simulation
> integration, or the composite frame assembly.

---

## Scope

The physics engine is the portable math core — everything that will ship to
CloudBASE. No Three.js, no DOM, no rendering. Pure functions operating on
the NED body frame.

---

## Key Files

### Must Read (in dependency order)
| File | Lines | What's There |
|------|-------|-------------|
| `src/polar/continuous-polar.ts` | 301 | Core types: `ContinuousPolar`, `AeroSegment`, `SegmentControls`, `MassSegment`, `FullCoefficients` |
| `src/polar/coefficients.ts` | 372 | Kirchhoff-blended coefficient functions: `getAllCoefficients()`, `getCL/CD/CY/CM/CN`, `coeffToSS()`, `coeffToForces()` |
| `src/polar/kirchhoff.ts` | 113 | Thin-airfoil Kirchhoff separation model: `separation()`, attached/plate CL/CD/CM/CP |
| `src/polar/aero-segment.ts` | 445 | Per-segment force computation: `computeSegmentForce()`, `sumAllSegments()`, `evaluateAeroForces()`, wind frame |
| `src/polar/inertia.ts` | 122 | Point-mass inertia tensor, center of mass |
| `src/polar/apparent-mass.ts` | 280 | Virtual inertia from displaced air, deployment scaling |
| `src/polar/eom.ts` | 490 | 6DOF equations of motion: translational, rotational, Euler kinematics, anisotropic mass |
| `src/polar/sim-state.ts` | 91 | State types: `SimState` (12-state vector), `SimConfig`, `SimDerivatives` |
| `src/polar/sim.ts` | 213 | Derivative evaluation + integrators (Forward Euler, RK4) |
| `src/polar/composite-frame.ts` | 221 | Vehicle snapshot assembly: `buildCompositeFrame()` → `SimConfig` |

### Reference Docs
| Doc | What's There |
|-----|-------------|
| `SIMULATION.md` | Full 6DOF derivation (1189 lines) — the math bible |
| `CONTINUOUS-POLAR.md` | Polar architecture, Kirchhoff model, segment math |
| `PILOTPITCH.md` | Pilot pendulum dynamics |

---

## Architecture

### Evaluation Pipeline

```
State (u,v,w,φ,θ,ψ,p,q,r) + Controls
  │
  ├─ Per-segment: computeSegmentForce()
  │    ├─ seg.getCoeffs(α_local, β, controls) → CL, CD, CY, CM, S, chord, position
  │    ├─ Local velocity = V_body + ω×r (per-segment velocity correction)
  │    ├─ Local α = atan2(w_local, u_local) + pitchOffset
  │    ├─ Local β = asin(v_local / |V_local|)
  │    ├─ Force = q·S·[CD·wind + CL·lift + CY·side] in NED body frame
  │    └─ Moment about segment position (for later summation about CG)
  │
  ├─ sumAllSegments() → SystemForces { force, moment, liftMag, dragMag, sideMag }
  │    ├─ Sum all segment forces
  │    ├─ Moments about CG: M = Σ(r_seg × F_seg) + Σ(M_seg_local)
  │    └─ Decompose total force into lift/drag/side magnitudes
  │
  ├─ gravityBody(φ, θ) → body-frame gravity vector
  │
  ├─ translationalEOM() or translationalEOMAnisotropic()
  │    └─ (u̇, v̇, ẇ) = F/m_eff + g_body + ω×V terms
  │
  ├─ rotationalEOM()
  │    └─ (ṗ, q̇, ṙ) = I⁻¹ · (M - ω×Iω)
  │
  ├─ eulerRates()
  │    └─ (φ̇, θ̇, ψ̇) from body rates via DKE matrix
  │
  └─ bodyToInertialVelocity()
       └─ (ẋ, ẏ, ż) inertial position derivatives
```

### 12-State Vector

| # | Symbol | Description | Unit |
|---|--------|-------------|------|
| 1–3 | x, y, z | Inertial position (NED Earth) | m |
| 4–6 | u, v, w | Body velocity (NED body) | m/s |
| 7–9 | φ, θ, ψ | Euler angles (3-2-1: yaw→pitch→roll) | rad |
| 10–12 | p, q, r | Body angular rates | rad/s |

### Force Model

Aerodynamic forces use the **Kirchhoff separation function** to blend between
attached-flow and flat-plate regimes:

```
CL = f·CL_attached + (1-f)·CL_plate
CD = f·CD_attached + (1-f)·CD_plate
```

Where `f(α)` is the Beddoes-Leishman separation function parameterized by
`alpha_stall_fwd`, `s1_fwd` (forward stall) and `alpha_stall_back`, `s1_back`.

This gives physically correct behavior from 0° through 90° (and full 360° for
skydiver model), including post-stall deep stall, and flat-plate behavior.

### Per-Segment ω×r Correction

Each segment sees a modified local velocity:
```
V_local = V_body + ω × r_seg
```
Where `r_seg` is the segment's position relative to CG. This produces:
- **Roll damping**: wing segments at different spans see different airspeeds
- **Pitch damping**: forward/aft segments see different angles of attack
- **Yaw damping**: lateral segments see differential sideslip

This is the primary source of rate damping in the model.

### Apparent Mass

For canopy-type vehicles, the displaced air volume creates virtual inertia:

| Component | Formula | Typical Value |
|-----------|---------|---------------|
| Normal (z) mass | `k_z · ρ · π · (b/2)² · t` | ~27 kg |
| Chordwise (x) mass | `k_x · ρ · π · (c/2)² · b` | ~5 kg |
| Spanwise (y) mass | `k_y · ρ · π · (t/2)² · b` | ~2 kg |
| Roll inertia | normal_mass × (b/2)² / 3 | ~40 kg·m² |
| Pitch inertia | normal_mass × (c/2)² / 3 | ~19 kg·m² |

Deployment scales apparent mass: at deploy=0 the canopy is a flat bundle with
minimal displaced air.

### Anisotropic Mass

Because apparent mass differs per axis, the translational EOM uses:
```
(m + m_a_x)·u̇ = F_x + (m + m_a_z)·r·v − (m + m_a_y)·q·w + m·g_x
```
The `translationalEOMAnisotropic()` function handles this — it's used when
`massPerAxis` is provided in `SimConfig`.

### Composite Frame

`buildCompositeFrame()` in `composite-frame.ts` assembles the full vehicle:
1. Collect aero segments (canopy + pilot, accounting for deployment)
2. Compute mass distribution (rotate pilot, scale canopy)
3. Compute CG from mass segments
4. Compute inertia tensor about CG
5. Compute apparent mass from canopy geometry
6. Combine into `SimConfig` (effective mass per axis, effective inertia)

This is computed **once per configuration change** (deploy/pilotPitch change),
not every integration step.

---

## Constraints & Invariants

### Critical
- **All physics in NED body frame** — x forward, y right, z down. No exceptions.
- **Positions are height-normalized** — divide meters by 1.875. Multiply by height before computing forces.
- **Mass ratios are fractions of `polar.m`** — multiply by `polar.m` to get kg.
- **Euler sequence is 3-2-1** (yaw → pitch → roll) — this determines the DKE matrix. Do not change without updating all kinematics.
- **Segment factories are closures** — `getCoeffs()` captures construction state and mutates per-frame. The returned object is reused across calls (not pure).
- **`sumAllSegments()` moments are about CG** — segment positions must be CG-relative. Use `relativeToCG()` if positions are GLB-origin-relative.

### Architecture Rules
1. **All polar/ files are portable** — no Three.js, no DOM, no rendering. They must work in CloudBASE.
2. **`computeDerivatives()` is the single entry point** for the sim — it calls everything else.
3. **RK4 is 4× the cost of Euler** — use Euler for interactive, RK4 for accuracy-critical paths.
4. **Apparent mass is diagonal only** — no cross-coupling terms (I_xy apparent = 0). This is standard for symmetric bodies.
5. **CompositeFrame is a snapshot** — recompute on config changes, reuse across integration steps.

---

## Test Coverage

| Test File | What It Validates |
|-----------|------------------|
| `tests/eom.test.ts` | Gravity, translational/rotational EOM, Euler kinematics, edge cases |
| `tests/sim.test.ts` | `evaluateAeroForces` (ω×r damping), `computeDerivatives` (free-fall, trim), RK4 convergence |
| `tests/canopy-polish.test.ts` | Segment positions, flap geometry, CP computation, system-vs-segment agreement |

---

## Related Contexts
- `docs/contexts/canopy-system.md` — How canopy segments are built and configured
- `docs/contexts/wingsuit-aero.md` — How wingsuit segments are built
- `docs/contexts/export-system.md` — How this engine gets packaged for CloudBASE
