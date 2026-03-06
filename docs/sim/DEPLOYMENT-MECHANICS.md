# Deployment Mechanics

Detailed deployment sequence model — linked from [PHASE-ARCHITECTURE.md](PHASE-ARCHITECTURE.md) §Deployment.

## Overview

The deployment phase bridges freefall and canopy flight. It's only a few seconds but involves complex multi-body dynamics. Our approach: **physics-driven where it matters, abstracted where it doesn't**.

Key abstraction: individual line tensions are NOT modeled. Instead we use a **4-line-group + slider rigid body** that captures the essential geometry and drag without simulating hundreds of individual suspension lines.

## Components

### Bridle + Pilot Chute
- Segmented bridle: multiple segments, each with position, drag coefficient, and tension
- Pilot chute: rigid body with drag area (~0.7 m²), initial throw velocity
- During extraction: bridle segments deploy sequentially, pilot chute drag pulls the system
- Bridle anchors to the undeployed canopy pack (has mass + drag, but not aerodynamically loaded)

### Slider
- Square rigid body with 4 corner grommets (will have GLB model)
- The 4 line groups route through the 4 grommets
- Controls deployment speed by restricting canopy surface area
- Starts at bottom of canopy (against fabric), slides down lines during inflation
- Position along lines maps to the `deploy` slider value

### Line Geometry (4-group abstraction)

Instead of modeling individual suspension lines, we use 4 line groups:

```
         Canopy (4 corners)
            │  │  │  │          ← 4 upper lines (canopy corners → slider grommets)
         ┌──┴──┴──┴──┴──┐
         │    SLIDER     │      ← square rigid body, 4 grommets
         └──┬──┬──┬──┬──┘
            │  │  │  │          ← 4 lower lines (slider grommets → riser attachment)
         Riser attachments
         (L-front, L-rear, R-front, R-rear)
```

8 total line segments: 4 above slider + 4 below slider. Each rendered as a `THREE.Line`. The kink at the slider grommets is the key visual feature.

### Visualization (initial)
- 8 lines drawn with `THREE.Line` (line helper style)
- Slider GLB model positioned along lines based on deployment progress
- Lines update geometry each frame as slider moves down
- Upper lines fan out as canopy inflates; lower lines converge to risers

## Deployment Sequence

The `deploy` slider drives the sequence. Values map to physical sub-states:

| deploy | Sub-state | Description |
|--------|-----------|-------------|
| 0.0 | **Packed** | Canopy in container, no aero load |
| 0.0–0.1 | **Extraction** | Pilot chute drag pulls bridle → canopy bag exits container |
| 0.1–0.2 | **Line stretch** | Lines deploy to full length, snatch force spike |
| 0.2–0.5 | **Slider down** | Canopy inflates progressively, slider descends lines |
| 0.5–0.9 | **Full inflation** | Slider reaches risers, canopy pressurizes |
| 1.0 | **Flying** | Fully inflated, slider stowed, normal canopy flight |

### What Drives the Slider

Previous approach: timed sequence scaled by airspeed. Better approach: **aero-driven with state machine guardrails**.

- Pilot chute drag → bridle tension → extraction rate (physics)
- Canopy surface area (from `deploy`) → drag increase → deceleration (physics)
- Slider position → canopy spread restriction → inflation rate (physics-ish — slider descent modeled as drag-limited)
- State machine ensures correct ordering and handles edge cases

The `deploy` value can be:
- **Manually controlled** (debug mode — existing slider)
- **Physics-driven** (continuous mode — computed from aero forces each timestep)

Both use the same rendering and segment configuration.

## Mass and Drag During Deployment

| Component | Mass | Drag | Notes |
|-----------|------|------|-------|
| Canopy pack | Full canopy mass | Small (packed fabric) | Not aerodynamically loaded until line stretch |
| Bridle segments | Negligible | Per-segment CD | Sequential deployment |
| Pilot chute | ~0.3 kg | ~0.7 m² drag area | Primary extraction force |
| Slider | ~0.1 kg | Proportional to area | Creates deployment drag |
| Canopy (inflating) | Already counted | Scales with `deploy` | Existing geometry morphing handles this |

## Connection to Existing Systems

| Existing | Role in Deployment |
|----------|-------------------|
| `deploy` slider + geometry morphing | Drives canopy shape, area, aero coefficients |
| `pilotChuteDeploy` slider | Controls pilot chute state |
| Parasitic segments (bridle, PC) | Drag models already in registry |
| Torsional stiffness (pilot coupling) | Line twist physics during/after deployment |
| Pivot junction transforms | Canopy-pilot relative rotation |
| 4-riser routing | Maps to 4-line-group abstraction |

## Depth Strategy

This is a few seconds of simulation. Balance effort with importance:

1. **Now**: Draw everything right — 8 lines, slider GLB, correct geometry updates. Manual `deploy` slider control.
2. **Next**: Physics-driven slider descent from aero forces. Snatch force computation.
3. **Later**: Full bridle tension propagation, line twist during deployment, malfunction injection.
