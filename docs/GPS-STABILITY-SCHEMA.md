# GPS Stability Data — Exchange Schema

Interface specification for flight data exported from CloudBASE (or any GPS pipeline) for consumption by polar-visualizer stability analysis scripts.

## File Format

- **Format:** CSV, comma-delimited, with header row
- **Encoding:** UTF-8
- **Filename convention:** `<vehicle>-<date>-<segment>.csv` (e.g., `aura5-20250815-glide.csv`)
- **Timestamp:** seconds from file start (float). Original GPS epoch can go in metadata.

## Required Columns

| Column | Units | Sign / Zero | Description |
|--------|-------|-------------|-------------|
| `t` | s | 0 = segment start | Time from segment start |
| `V` | m/s | always positive | True airspeed magnitude |
| `alpha` | deg | **+nose above airspeed vector** | Angle of attack (from polar coefficient matching). Typical range: 2–18° wingsuit, 5–15° canopy |
| `gamma` | deg | **+climbing, −descending** | Flight path angle. −19° = typical wingsuit glide, −25° = steep canopy |
| `phi` | deg | **+right wing down** (bank right) | Bank angle (aerodynamic roll, from acceleration). 0° = wings level, +30° = right turn |
| `theta` | deg | **+nose above horizon** | Pitch angle (= α + γ). Negative in normal descent flight |
| `psi` | deg | **0=North, +clockwise** (East=90°) | Heading. 0–360° or ±180°, both accepted |
| `p` | deg/s | **+rolling right** (right wing going down) | Body roll rate |
| `q` | deg/s | **+pitching nose up** | Body pitch rate |
| `r` | deg/s | **+yawing nose right** | Body yaw rate |

## Optional Columns

| Column | Units | Sign / Zero | Description |
|--------|-------|-------------|-------------|
| `CL` | — | **+upward lift** | Lift coefficient (system-level, from acceleration). Positive in normal flight. |
| `CD` | — | **+opposing motion** | Drag coefficient (system-level). Always positive. |
| `beta` | deg | **+wind from right** (nose left of airspeed) | Sideslip angle. Usually unknown — leave empty if not available. |
| `ax` | m/s² | **+forward** | Body-frame x acceleration (for cross-check) |
| `az` | m/s² | **+downward** (NED) | Body-frame z acceleration (for cross-check) |
| `alt_msl` | m | — | Altitude MSL (for density correction if needed) |
| `qbar` | Pa | always positive | Dynamic pressure (½ρV²) |

## Metadata Header

Optional comment block at top of file (lines starting with `#`). Parsers should skip these.

```
# vehicle: aura5
# date: 2025-08-15
# pilot_mass_kg: 85
# wing_area_m2: 2.0
# segment: steady_glide
# source: cloudbase_sg_filter
# gps_rate_hz: 10
# notes: clean air, no turbulence
```

## Sign Verification Checks

Use these sanity checks when wiring up a new data source. If any fail, you have a sign flip somewhere.

| Check | Expected | If wrong... |
|-------|----------|-------------|
| Steady glide: `gamma` | **negative** (e.g., −19°) | γ sign is flipped |
| Steady glide: `theta` | **negative** (nose below horizon) | θ sign is flipped, or α+γ composition is wrong |
| Steady glide: `alpha` | **positive** (e.g., +8°) | α sign is flipped |
| `theta` ≈ `alpha + gamma` | should hold within ~1° | one of the three has wrong sign or convention |
| Right turn: `phi` | **positive** (~+20–40°) | φ sign is flipped |
| Right turn: `r` | **positive** (nose going right) | r sign is flipped |
| Right turn: `p` | **near zero or slightly positive** during steady turn | p sign is flipped if large negative |
| Right turn: `psi` | **increasing** (e.g., 90→120°) | ψ direction is flipped (CCW convention) |
| Pullout / flare: `q` | **positive** (nose pitching up) | q sign is flipped |
| Level flight: `CL` | **positive** (~0.3–0.8) | CL sign is flipped |
| Any flight: `CD` | **positive** (always) | CD sign is flipped |
| Any flight: `V` | **positive** (always) | something is very wrong |

### Quick test procedure
Pick one right-hand turn from your data. Verify: φ>0, r>0, ψ increasing. If all three agree, your lateral signs are consistent. Then pick a steady glide segment: γ<0, α>0, θ<0, θ≈α+γ. If those hold, longitudinal signs are good.

## Conventions

- **Sign conventions match NED / standard aero:**
  - γ negative in descent (consistent with polar-visualizer)
  - φ positive = right wing down
  - ψ 0–360° or ±180°, CW from north
  - α positive = nose above airspeed vector
  - Body rates follow right-hand rule (p: roll right+, q: nose up+, r: nose right+)
- **Degrees for angles, deg/s for rates** — human-readable CSV. Scripts convert internally.
- **NaN or empty** for missing values. Don't interpolate or zero-fill — let the consumer decide.
- **Segment, not full flight.** Trim the data to the relevant phase before export (steady glide, speed run, turn entry, etc.). Short clean segments are more useful than full flights with mixed phases.

## Body Rate Derivation

For reference, if the export pipeline has smooth Euler angles but not body rates, the conversion is:

```
p = φ̇ - ψ̇·sin(θ)
q = θ̇·cos(φ) + ψ̇·sin(φ)·cos(θ)
r = -θ̇·sin(φ) + ψ̇·cos(φ)·cos(θ)
```

Where φ̇, θ̇, ψ̇ are time derivatives of the Euler angles. The SG filter should produce smooth enough angles that differentiation is clean.

## What This Enables

On the polar-visualizer side, this data feeds:

1. **Trim validation** — steady-state V vs γ vs α compared to eigenvalue trim table
2. **CL/CD polar overlay** — measured coefficients vs Kirchhoff model predictions
3. **Mode extraction** — spectral analysis of q(t) for short period, V(t) for phugoid, p(t) for roll subsidence, ψ(t) for spiral
4. **Damping estimation** — log-decrement or curve fitting on oscillation envelopes
5. **Frequency comparison** — FFT peaks vs predicted natural frequencies from eigenvalue analysis

## Canopy Normal CSV (for `--mode canopy`)

A separate CSV format for canopy flight data, where orientation is derived from the
canopy normal vector (canopy position relative to pilot in NED) rather than from
coefficient matching.

### Required Columns

| Column | Units | Description |
|--------|-------|-------------|
| `t`    | s     | Time from segment start |
| `V`    | m/s   | True airspeed magnitude |
| `vN`   | m/s   | Air-relative velocity North |
| `vE`   | m/s   | Air-relative velocity East |
| `vD`   | m/s   | Air-relative velocity Down (positive = descending) |
| `cnN`  | m     | Canopy normal North — canopy position relative to pilot |
| `cnE`  | m     | Canopy normal East |
| `cnD`  | m     | Canopy normal Down (negative = canopy above pilot) |

### Optional Columns

CL, CD, qbar, rho — passed through if present.

### Sign Convention

The canopy normal vector points from pilot to canopy. In normal flight:
- `cnD` is **negative** (canopy is above the pilot)
- `cnN` is slightly positive (canopy is ahead due to trim AOA)
- `cnE` is near zero in straight flight, positive in right turns

### Processing

`gps-beta-enhance.ts --mode canopy` derives canopy orientation from this vector:
1. CN unit vector = tension line direction (pilot → canopy)
2. Project airspeed onto the plane ⊥ to CN → canopy forward axis
3. Cross product → canopy lateral axis
4. Extract Euler angles from the resulting DCM
5. α from airspeed projected into canopy longitudinal plane + trim offset
6. β from airspeed lateral component in canopy body frame
7. Body rates via inverse DKE on the derived Euler angles

## Example

```csv
# vehicle: aura5
# pilot_mass_kg: 85
# segment: steady_glide
# gps_rate_hz: 10
t,V,alpha,gamma,phi,theta,psi,p,q,r,CL,CD
0.0,35.2,8.1,-19.0,0.3,-10.9,142.5,0.0,0.1,0.0,0.42,0.15
0.1,35.1,8.2,-19.1,0.5,-10.9,142.5,0.2,0.0,-0.1,0.42,0.15
0.2,35.1,8.1,-19.0,0.4,-10.9,142.6,0.1,0.1,0.0,0.42,0.15
```
