# Deployment Mechanics

Detailed deployment sequence — bridging freefall and canopy flight.

**Status**: Core deployment implemented and working. See [DEPLOY-WINGSUIT.md](DEPLOY-WINGSUIT.md) for tension chain architecture, [DEPLOYMENT-MODULE.md](DEPLOYMENT-MODULE.md) for state handoff design.

## Overview

The deployment phase is a few seconds but involves multi-body dynamics. Our approach: **tension-chain physics with sequential unstow, continuous PC drag feedback, and tumbling canopy bag**.

The original plan called for a 4-line-group + slider abstraction. The actual implementation uses a simpler 10-segment bridle tension chain with a separate canopy bag rigid body. Individual line tensions are deferred to a future line tension model (Slegers & Costello framework).

## Implemented Sequence

| Event | Trigger | What Happens |
|-------|---------|-------------|
| **PC toss** | A button (freefall) | PC rigid body spawns at wingtip (0.9m right, 5 m/s throw) |
| **Bridle paying out** | Tension > 8N per segment | Segments unstow sequentially (10 × 0.33m) |
| **Pin release** | Tension > 20N | Remaining segments freed, canopy bag spawns |
| **Canopy extracting** | Automatic | Bag trails with bluff drag, tumbles ±90° pitch/roll, free yaw |
| **Line stretch** | Bag distance ≥ 1.89m | Full state snapshot, handoff to canopy deploy |
| **Canopy inflation** | Automatic | Deploy ramps 0.05→1.0 over 3s, GLB swaps instantly |

## Physics Highlights

- **Tension-dependent PC drag**: CD 0.3→0.9 continuous. Positive feedback: tension → drag → more tension.
- **Constraint model**: Position clamp + velocity projection (CloudBASE pattern). Stable at 200Hz.
- **Canopy bag yaw = line twist seed**: Free rotation on yaw axis accumulates twist that carries into pilot coupling.
- **Snatch damping**: Angular rates reduced 70% at line stretch — line tension absorbs rotational energy.
- **Velocity transform**: Full 3-2-1 DCM rotation at handoff — wingsuit body → inertial → canopy body.

## Components (mass & drag)

| Component | Mass | Drag | Source |
|-----------|------|------|--------|
| PC | 0.057 kg | 0.732 m² × CD(0.3–0.9) | CloudBASE |
| Bridle segment (×10) | 0.01 kg | CDA = 0.01 | Tuned |
| Canopy bag | 3.7 kg | CDA = 0.5 | CloudBASE |
| Suspension lines | — | — | Distance constraint only |

## Not Yet Implemented

- **Physics-driven inflation**: Deploy currently time-based (3s ramp). Future: aero forces drive deploy rate.
- **Slider rendering**: slider.glb position along lines based on deploy value.
- **PC persistence**: PC should continue bouncing behind canopy post-transition.
- **Line tension model**: Full 4-riser + 52-line Slegers & Costello framework (research phase).
- **Weight shift → riser asymmetry**: Pilot lateral offset biasing initial opening direction.
- **Malfunction injection**: Line twists, off-heading openings, partial inflation.

## Depth Strategy

1. ✅ **Now**: Full tension chain physics + canopy bag + line stretch + handoff. Working end-to-end.
2. ⬜ **Next**: Physics-driven inflation, slider rendering, PC persistence.
3. ⬜ **Later**: Full line tension model, malfunctions, weight shift coupling during deployment.
