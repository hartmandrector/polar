# LINE-TENSION-MODEL.md — Tension Modeling Plan

## Overview

Model the complete suspension line system as tension-bearing segments connecting the canopy airfoil to the pilot. Each line carries positive tension from aerodynamic load on the canopy down to the pilot mass. Loss of tension on individual lines affects canopy shape, aerodynamic performance, and control authority.

## References

- Slegers, N. & Costello, M., "Aspects of Control for a Parafoil and Payload System," *J. Guidance, Control, and Dynamics*, Vol. 26, No. 6, 2003. [PDF in `docs/references/`]
- Mortaloni, P., Yakimenko, O., Dobrokhodov, V., Howard, R., "On the Development of a Six-Degree-of-Freedom Model of a Low-Aspect-Ratio Parafoil Delivery System," *17th AIAA Aerodynamic Decelerator Systems Technology Conf.*, AIAA 2003-2105. [To acquire — see `docs/references/README.md`]

## Existing Infrastructure

**Line geometry extracted** from `cp2.gltf` via `extract-lines.cjs`, stored in `model-registry.ts` (line 856–960):
- 4 load-bearing ribs per half-span (ribs 2, 4, 6, 8), mirrored for full span → **8 total**
- Each rib: A/B/C/D canopy attachment points, AB and CD cascade junctions, front and rear riser endpoints
- Front and rear risers connect to pilot at shoulder points
- Half-span data only — full span by inverting `glbX`

**Weight shift geometry**: Two rigid half-spans joined through center cell. Weight shift moves each half independently; center cell distorts to bridge the position delta. This is the lateral (Δ) control — initial work done but deferred as too complex at the time.

## Segment Count

### Suspension lines (existing GLB data)

Per rib, per half-span: 6 segments (A upper, B upper, AB lower, C upper, D upper, CD lower)

| Component | Segments |
|-----------|----------|
| Line segments: 4 ribs × 6 lines × 2 sides | 48 |
| Risers: front + rear × 2 sides | 4 |
| **Subtotal — suspension lines** | **52** |

### Brake lines (no GLB model yet — to be created)

Per side: 5 canopy attachment points at trailing edge, 4 cascade junctions (each merging 2 of the 5), routing down to riser attachment below the main line riser points. Pilot holds the control end.

| Component | Segments |
|-----------|----------|
| Brake lines: 9 segments × 2 sides | 18 |
| **Subtotal — brake lines** | **18** |

### Slider

One segment — 4 grommets reef the lines during deployment, controlling airfoil opening size. Primarily drag, possibly minor lift. Model as drag segment.

| Component | Segments |
|-----------|----------|
| Slider | 1 |

### Existing aero segments

| Component | Segments |
|-----------|----------|
| Canopy cells (7: center + 3 pairs) | 7 |
| Canopy brake flaps (2) | 2 |
| Pilot body segments (~3–5) | ~4 |
| Bridle + pilot chute | 1 |
| **Subtotal — aero** | **~14** |

### Grand total

| | Segments |
|---|---|
| Aero (existing) | ~14 |
| Suspension lines | 52 |
| Brake lines | 18 |
| Slider | 1 |
| **Total** | **~85** |

## Sub-segmentation for Tension

Some segments need further subdivision to model tension correctly along their length. Candidate segments:

- **Bridle**: Free-floating pilot chute creates drag in the canopy wake. The bridle line from canopy to PC is a good test case for the tension system — high drag load, simple geometry, easy to validate.
- **Long cascade-to-riser lines**: The AB and CD lower segments span the largest distance and may need 2–3 sub-segments for accurate catenary/tension distribution.
- **Brake lines**: The 5→4→2→1 cascade has varying tension through the junctions.

Sub-segmentation multiplies the segment count but each sub-segment is computationally cheap (no aero evaluation, just tension + gravity).

## Architecture Notes

- Each line segment: two endpoints, a rest length, material stiffness, and mass per unit length
- Tension = positive only (lines go slack at zero tension, no compression)
- Slack lines → affected canopy cells lose shape → reduced aero performance on that span section
- Weight shift control: lateral CG offset tilts the two rigid half-spans differently, changing line loading asymmetrically
- Brake control: trailing-edge deflection via brake line tension, already modeled aerodynamically as flap segments — tension model adds the mechanical coupling
- The system is inherently two-body (canopy + pilot) connected by the line network — directly analogous to Slegers & Costello's joint constraint formulation

## Status

**Research phase.** No implementation yet. Next steps:
1. Study Slegers & Costello constraint force formulation
2. Acquire and study Mortaloni added mass / tension paper
3. Create GLB model for brake lines (5 attachment points + 4 junctions per side)
4. Prototype tension on bridle segment first (simplest case, good validation)
5. Extend to full line set
