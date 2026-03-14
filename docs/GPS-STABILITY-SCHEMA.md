# GPS Stability Data — Exchange Schema

Interface specification for flight data exported from CloudBASE (or any GPS pipeline) for consumption by polar-visualizer stability analysis scripts.

## File Format

- **Format:** CSV, comma-delimited, with header row
- **Encoding:** UTF-8
- **Filename convention:** `<vehicle>-<date>-<segment>.csv` (e.g., `aura5-20250815-glide.csv`)
- **Timestamp:** seconds from file start (float). Original GPS epoch can go in metadata.

## Required Columns

| Column | Units | Description |
|--------|-------|-------------|
| `t` | s | Time (seconds from segment start) |
| `V` | m/s | True airspeed magnitude |
| `alpha` | deg | Angle of attack (from polar coefficient matching) |
| `gamma` | deg | Flight path angle (negative = descending) |
| `phi` | deg | Bank angle (aerodynamic roll, from acceleration) |
| `theta` | deg | Pitch angle (= α + γ) |
| `psi` | deg | Heading (GPS track, 0=N, CW positive) |
| `p` | deg/s | Body roll rate |
| `q` | deg/s | Body pitch rate |
| `r` | deg/s | Body yaw rate |

## Optional Columns

| Column | Units | Description |
|--------|-------|-------------|
| `CL` | — | Lift coefficient (system-level, from acceleration) |
| `CD` | — | Drag coefficient (system-level, from acceleration) |
| `beta` | deg | Sideslip angle (if available; usually unknown) |
| `ax` | m/s² | Body-frame x acceleration (for cross-check) |
| `az` | m/s² | Body-frame z acceleration (for cross-check) |
| `alt_msl` | m | Altitude MSL (for density correction if needed) |
| `qbar` | Pa | Dynamic pressure (½ρV², if density-corrected) |

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
