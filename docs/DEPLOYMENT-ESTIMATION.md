# Deployment Estimation from GPS Replay

**Status:** Design doc / groundwork  
**Related:** `deploy-wingsuit.ts` (forward sim), `deploy-canopy.ts` (inflation model), `canopy-estimator.ts` (kinematic extraction)

## Problem

The forward deployment sim (`WingsuitDeploySim`) models the full PC toss → bridle → pin → line stretch → inflation sequence. But it runs as a **forward simulation** — it predicts what happens given initial conditions and timing parameters.

For GPS replay, we need the **inverse problem**: given measured GPS data (positions, velocities, accelerations at 5-20 Hz), estimate *when* each deployment phase occurred and *what the timing parameters were* for this specific jump.

GPS at 20 Hz (50ms samples) is marginal for deployment events that happen in 0.5-3 seconds total. The SG filter smooths things further. But there are observable signatures.

## Strategy: Line Stretch Anchor

The **line stretch point** is the most detectable event from GPS data:
- Sharp deceleration spike (opening shock) — easily 2-3g, visible even at 10 Hz
- Marks the boundary between wingsuit flight and canopy flight
- Natural anchor point: work backward for wingsuit deploy timing, forward for inflation

### Detection
1. Scan acceleration magnitude for the deployment region (after pilot-initiated deploy)
2. Find the peak deceleration — this is opening shock at or just after line stretch
3. The onset of deceleration (inflection point before peak) ≈ line stretch time

### Backward Reconstruction (PC toss → line stretch)
From line stretch, work backward using known physics:
- **Total chain length** is known (~7.4m from deploy-wingsuit.ts constants)
- **Airspeed at line stretch** is measured
- **Time from PC toss to line stretch** can be estimated from:
  - Typical values: 2-4 seconds depending on airspeed and body position
  - The acceleration profile shows a gradual drag increase before the spike
  - PC drag signature: slight deceleration building as PC inflates and bridle pays out

### Forward Reconstruction (line stretch → full inflation)
From line stretch forward:
- **Inflation time** = time from line stretch to steady-state flight
- Observable: airspeed decelerating rapidly, then stabilizing
- The `CanopyDeployManager`'s airspeed-driven model (`K_INFLATE * qRatio`) can be fit to the observed deceleration profile
- **Deploy fraction curve** maps to deceleration: more deployed area = more drag = faster deceleration
- At full inflation: airspeed stabilizes, descent rate stabilizes, heading dynamics become smooth

## Deployment Sub-Phases (Refined)

The deployment breaks into two halves anchored at line stretch, each with observable sub-phases:

### Pre–Line Stretch (back-calculated from line stretch)

```
PC toss → bridle stretch → line stretch
```

| Sub-Phase | Observable | Estimation Method |
|-----------|-----------|-------------------|
| **PC toss** | Subtle lateral perturbation, minor drag increase | Back-calculate from chain length + airspeed |
| **Bridle stretch** | Gradually increasing drag (PC inflating) | Drag buildup signature in deceleration |
| **Line stretch** | Sharp deceleration spike (opening shock) | Peak detection (Phase 1 ✅) |

Timing is estimated from known chain geometry (~7.4m) and observed airspeed. At 40 m/s airspeed, the PC reaches full extension in ~2s.

### Post–Line Stretch (forward from line stretch)

```
line stretch → max AoA → snivel → surge → full flight
```

| Sub-Phase | Observable | Detection |
|-----------|-----------|-----------|
| **Line stretch → max AoA** | Canopy AoA rising from ~0° to 60-90° | Peak canopy AoA from canopy estimator |
| **Snivel** | Canopy partially inflated, AoA high, airspeed dropping slowly | Between max AoA and rapid AoA decrease |
| **Surge** | Canopy AoA dropping rapidly toward trim, airspeed still decreasing | Rapid AoA decrease phase |
| **Full flight** | Canopy AoA reaches trim (~6-10°), airspeed stable | AoA within threshold of trim angle |

**Key insight:** The canopy estimator's AoA is the primary instrument for post-line-stretch phase detection. Physical inflation (0→60-70%) happens fast (~1.5s), but the canopy's *aerodynamic response* — measured as AoA settling from max to trim — takes ~4s. Full flight = AoA at trim.

**Max AoA as trust gauge:** During initial inflation there isn't much canopy force, so the CN vector (and thus AoA) is noisy/unreliable. The max AoA point marks when canopy forces dominate and the estimator becomes trustworthy. This is the effective "start of reliable canopy data."

## Observable GPS Signatures

| Event | Signature | Confidence |
|-------|-----------|------------|
| PC toss | Subtle — slight lateral perturbation, minor drag increase | Low at 20Hz |
| Bridle paying out | Gradually increasing drag (PC inflating) | Medium |
| Pin release | Not directly observable from GPS | Low |
| Line stretch / opening shock | Sharp deceleration spike, 2-3g | **High** |
| Snivel phase | Moderate deceleration, fabric catching air | Medium |
| Slider descent | Progressive deceleration, airspeed dropping | Medium |
| Full inflation | Airspeed stabilizes at canopy trim speed | **High** |
| Unzip / brake release | Not observable from GPS | N/A |

## Deployment Phase Timeline (typical wingsuit BASE)

```
t=0.0s  PC toss (pilot throws PC from BOC)
t=0.3s  PC catches air, bridle tension begins
t=0.8s  Bridle fully extended, tension building
t=1.0s  Pin release, canopy bag extracted
t=1.5s  Canopy bag clears container
t=2.0s  LINE STRETCH — suspension lines taut, opening shock
t=2.0-2.6s  Snivel — slider stretching, cells pressurizing
t=2.6-4.0s  Slider descent — progressive inflation
t=4.0-5.0s  Full inflation — flying at trim speed
```

Total: ~4-5 seconds from PC toss to flying canopy. At 20Hz that's 80-100 GPS samples — workable but tight for the fast events.

## Integration with Existing Deploy Sim

The `WingsuitDeploySim` and `CanopyDeployManager` model this entire sequence forward. For GPS estimation:

1. **Use the sim as a template** — same phase structure, same physics constants
2. **Fit timing parameters** to observed GPS data:
   - Fit `K_INFLATE` and `SNIVEL_TIME` to match the observed deceleration curve post-line-stretch
   - Fit total deploy time to match line-stretch detection
3. **For the EKF later**: the deployment sim becomes the prediction model. GPS measurements update the estimated deploy state (phase, timing, deploy fraction). This is exactly the flight controller orchestration from §10 of the EKF design doc.

## Proposed Implementation

### Phase 1: Line Stretch Detector
- Scan `GPSPipelinePoint[]` acceleration for deployment region
- Detect opening shock peak and onset
- Return `lineStretchIndex` and confidence

### Phase 2: Inflation Curve Fitting
- From line stretch forward, extract deceleration profile
- Fit `CanopyDeployManager` parameters to match
- Output: deploy fraction timeline, estimated full-inflation time

### Phase 3: Backward Timing
- From line stretch backward, estimate PC toss time
- Use chain length + airspeed to bound total deploy duration
- Refine using pre-line-stretch drag buildup signature

### Phase 4: Deploy State on Pipeline Points
- Attach `DeployEstimate` to each `GPSPipelinePoint` in the deployment region
- Fields: phase, deploy fraction, confidence, time-since-PC-toss, time-to-full-inflation

## Connection to Flight Mode State Machine

The existing `FlightModeOutput` on pipeline points has `deployConfidence`. The deploy estimator refines this:
- `deployConfidence` = 0 → no deployment
- `deployConfidence` rising = pre-line-stretch
- `deployConfidence` = 1 = post-line-stretch
- Fully inflated → transition to canopy mode

The line stretch detector becomes the authoritative trigger for wingsuit→canopy transition in the pipeline.
