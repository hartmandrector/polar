# GPS Processing Pipeline — Import Sources & Architecture

## 1. Import Sources

### Sensor Fusion (`/mnt/c/dev/flysight firmware/sensor_fusion_handoff/fusion_viewer/src/`)

| File | What | Key Exports |
|------|------|-------------|
| `sgFilter.ts` (~160 lines) | Generic SG filter: any type via `extractValue`, multi-pass, window 5–25 | `applySGFilter<T>(data, windowSize, extractValue)`, `applySGFilterMultiPass<T>(data, windowSizes[], extractValue)`, `smoothGPSVelocities()` |
| `sgCoefficients.ts` (~large) | Pre-computed cubic SG coefficients with **position-specific endpoint formulas** for windows 5–25 | `SG_COEFFICIENTS`, `SGWindowSize`, `AVAILABLE_WINDOW_SIZES` |
| `mathUtils.ts` (~80+ lines) | Linear least-squares slope/derivative via sliding window | `getSlope<T>(points, getX, getY)`, `calculateDerivative<T>(data, windowSize, getTime, getValue)`, `calculateAcceleration()` |
| `gpsIntegration.ts` (~250 lines) | Full GPS pipeline: parse → SG smooth → LS acceleration → NWU conversion | `convertGPSToIntegration()`, `loadTrackCSV()`, `updateGPSIntegration()` |
| `trackParser.ts` (~100 lines) | FlySight TRACK.CSV parser ($GNSS lines, $VAR metadata) | `parseTrackCSV(content): TrackDataset` |
| `timestampSync.ts` | Syncs GPS timestamps to sensor timestamps via $TIME entries | `parseTIMEEntries()`, `computeTimeSync()`, `applyTimeSyncToGPS()` |
| `gpsTypes.ts` | Types: `GNSSData`, `GPSIntegrationPoint`, `GPSIntegrationResult`, `TrackDataset` | — |

### Kalman Filter (`/mnt/c/dev/kalman/src/`)

| File | What | Key Exports |
|------|------|-------------|
| `wse.ts` (~400+ lines) | **WSE engine**: velocity→kl/kd/roll extraction, sustained speeds, wind-adjusted orientation, atmosphere model, canopy line tension | `calculateWingsuitParameters(vN,vE,vD, aN,aE,aD, curKl,curKd,curRoll) → [kl,kd,roll]`, `calculateWingsuitAcceleration(vN,vE,vD, kl,kd,roll) → [aE,aU,aN]`, `calculatesustainedspeeds(kl,kd)`, `computewindadjustedwsorientation(...)`, `coefftoss(cl,cd,s,m,rho)`, `getsustainedindex()`, `indexaoa()`, `getspeed()`, `getrho()` |
| `motionestimator.ts` (~280 lines) | Complementary filter: GPS+WSE model fusion, kl/kd/roll tracking | `MotionEstimator` class, `updateFromGps(gps)`, `predictAt(t)`, `getState()` |
| `savitzky-golay.ts` (~900+ lines) | Full SG pipeline: smoothing, acceleration, **klkd sustained speed computation**, position smoothing | `smoothPoints()`, `smoothPointsN()`, `calculateSmoothedSpeeds()`, `calculateSmoothedAcceleration()`, `calculateSmoothSustainedSpeeds()`, `generateSmoothFastData()` |
| `sg-coefficients-generated.ts` | Generated SG coefficients (same format as sensor fusion) | `SG_COEFFICIENTS` |
| `types.ts` | `MLocation`, `FastDataPoint`, `WSEQPolar`, `SustainedSpeeds`, `Coefficients` | — |

### Polar Visualizer (`/mnt/c/dev/polar/polar-visualizer/scripts/`)

| File | What |
|------|------|
| `gps-overlay.ts` | Overlays GPS flight data against eigenvalue trim predictions |
| `gps-beta-enhance.ts` | β-enhanced GPS analysis |
| `gps-modes.ts` | Modal analysis of GPS data |
| `beta-equilibrium.ts` | β equilibrium calculations |
| `eigenvalue-analysis.ts` | Eigenvalue/stability analysis |
| `lib/trim-finder.ts` | Finds trim conditions from polar |
| `lib/linearize.ts` | Linearization utilities |
| `lib/analysis-types.ts` | Shared analysis types |

### CloudBASE (`/mnt/c/dev/CloudBASE/app/assets/javascripts/`)

| File | What |
|------|------|
| `baseline/trackwinds.ts` | Wind estimation from track data |
| `charts/dspolar.ts`, `dynamicsustainedpolar.ts` | Dynamic sustained polar charting |
| `charts/coefficientschart.ts` | Coefficient visualization |
| `charts/layers/polarchartwindlayer.ts` | Wind layer on polar chart |

## 2. Data Flow

```
GPS file (TRACK.CSV or generic CSV)
  → parseTrackCSV() / CSV parser
  → latLonToLocalNE() → NED position/velocity
  → applySGFilterMultiPass() on velocity components [3-pass: 21,11,7]
  → calculateAcceleration() via LS sliding window (21-point)
  → calculateWingsuitParameters(v, a) → [kl, kd, roll]
  → calculatesustainedspeeds(kl, kd) → sustained speed point
  → getsustainedindex(vs, polar, rho) → normalized polar index [0,1]
  → indexaoa(index, aoaindexes, aoas) → angle of attack
  → segment model matching (polar-visualizer factories)
  → control input estimation (throttle, pitch trim)
```

## 3. Wind System

Wind correction is needed for converting ground-relative GPS velocities to airspeed. `computewindadjustedwsorientation()` in `wse.ts` does this: subtracts wind vector from GPS velocity before kl/kd extraction. Without wind correction, kl/kd absorb wind effects → internal inconsistency with the polar model. CloudBASE `trackwinds.ts` has wind estimation from track data. For polar-visualizer: start with zero-wind (GPS-only), add wind estimation as refinement.

## 4. Key Functions to Port

### SG Filter (from sensor fusion)
- **Source**: `sensor_fusion_handoff/.../sgFilter.ts` + `sgCoefficients.ts`
- **Port as-is** — clean generic implementation, no dependencies
- Endpoint coefficients are the key feature (not just center-point convolution)

### Linear Acceleration Estimator (from sensor fusion)
- **Source**: `sensor_fusion_handoff/.../mathUtils.ts` → `getSlope()`, `calculateAcceleration()`
- LS sliding window on smoothed velocity → acceleration in each axis

### KL/KD Computation (from kalman `wse.ts`)
- `calculateWingsuitParameters(vN,vE,vD, aN,aE,aD, ...)` → `[kl, kd, roll]`
- Decomposes acceleration into lift (⊥ velocity) and drag (∥ velocity) components
- `calculatesustainedspeeds(kl, kd)` → normalized sustained speed coordinates

### Canopy Line Tension / WSE (from kalman `wse.ts`)
- `computewindadjustedwsorientation()` — full pipeline: wind correction → kl/kd → sustained index → AOA
- `computewindadjustedcanopyorientation()` (commented legacy) — extracts canopy normal from pilot drag subtraction

### AOA Mapping via Segment Model (new)
- Uses polar-visualizer's existing `segment-factories.ts` + `continuous-polar.ts`
- Map sustained speed index → segment throttle position → AOA/control state
- Bridge: `getsustainedindex()` → polar-visualizer `ContinuousPolar` lookup

## 5. Architecture — Target Layout in `polar-visualizer/src/`

```
polar-visualizer/src/
  gps/                          ← NEW module
    sg-filter.ts                ← port from sensor_fusion (sgFilter.ts)
    sg-coefficients.ts          ← port from sensor_fusion (sgCoefficients.ts)
    math-utils.ts               ← port from sensor_fusion (getSlope, calculateAcceleration)
    track-parser.ts             ← port from sensor_fusion (parseTrackCSV) + generic CSV
    wse.ts                      ← port from kalman (calculateWingsuitParameters, sustained speeds)
    atmosphere.ts               ← port from kalman/wse.ts (getrho, altitudeToPressure, temp)
    gps-pipeline.ts             ← orchestrator: parse → smooth → accel → kl/kd → polar index
    wind-model.ts               ← placeholder, zero-wind initially
    types.ts                    ← GPS point types, integration result types
  scripts/
    gps-overlay.ts              ← existing, will use new gps/ module
    gps-beta-enhance.ts         ← existing
```
