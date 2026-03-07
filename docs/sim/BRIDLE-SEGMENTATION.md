# Bridle & Pilot Chute Segmentation

Replace the current monolithic bridle+PC rendering with a **segmented system** — individual GLB segments with per-segment drag, mass, and position. This feeds into the phase FSM deployment sequence.

## Physics Reference (from CloudBASE)

Key constants extracted from `simulatordeployment.ts` and `simulatorsequencer.ts`:

| Parameter | Value | Source |
|-----------|-------|--------|
| Pilot-to-attachment (total line length) | 5.23 m | `pilottoattachmentpoint` |
| Bridle length | 3.29 m (3.3 in sequencer) | `bridallength` |
| PC diameter | 38 inches (0.965 m) | `pcsize * metersperinch` |
| PC area | π × (0.483)² ≈ 0.732 m² | computed |
| PC mass | 0.057 kg | `pcmass` |
| Canopy mass | 3.7 kg | `canopymass` |
| PC drag coefficient formula | ½ × 0.9 × area / mass × ρ | `pcdragCoefficient` |
| Slider top position | 3.37 m (normal) / 1.7 m (static line) | `slidertop` |

### CloudBASE Deploy States (simulatorpc.ts)

```
stowed → throw → bridalextending → linesextending → extended
```

State machine in `PC.update()` drives transitions:
- **stowed → throw**: `pcposition ≤ 0.5 && throwposition ≠ -0.2`
- **throw → bridalextending**: `pcposition > 0.201` — calls `sdeployment.init()` with toss velocity (body velocity + 3 m/s lateral "right" component for throw arc)
- **bridalextending → linesextending**: `sdeployment.bridalstretch()` returns true (PC-to-body distance ≥ bridallength) — triggers sequencer rewrite
- **linesextending → extended**: `sdeployment.linestretch()` returns true (canopy-to-body distance ≥ pilottoattachmentpoint)

### Physics Model (simulatordeployment.ts)

Simple Euler integration per timestep:
```
dragForce = -dragCoeff × speed × velocity_unit  (opposing velocity)
velocity += dragForce × dt
position += velocity × dt
```

Two drag coefficients:
- **Bridle extending**: `pcdragCoefficient` = ½ × 0.9 × upcarea / pcmass × 1.2 (small unopened PC area `upcr=0.035`)
- **Post bridle stretch**: `totaldragCoefficient` = ½ × 0.9 × pcarea / (pcmass + canopymass) × 0.9 (full PC area, total mass)

**Constraint enforcement**: After integration, clamp segment distances:
```
if distance(segment, anchor) > maxLength:
    correction = direction × (currentLength - maxLength) / currentLength
    segment.position -= correction
```

Two constraint passes per frame: PC-to-anchor (bridle length), lines-to-anchor (total length).

### Deployment Timeline (simulatorsequencer.ts)

12-event sequence with airspeed-dependent timing:

| Event | Time offset formula | Position |
|-------|-------------------|----------|
| 0: Reach | 0 | — |
| 1: Grab | +500ms | — |
| 2: Pitch (throw) | +800ms | throwposition: -0.2 → -1.8 |
| 3: Bridle stretch | +800 + `min(1600, 3000×(3/V))` | pcposition: 0.2 → 3.3 |
| 4: Lines extending | + bridalstretchtime × 1.5 | linesposition: 0 → 5.23 |
| 5-6: Line stretch | + `20V + 55.4` | slider starts descending |
| 7: Extra middle | + `10.04V + 700` | slider at 70% |
| 8: Last max AoA | + sliderdown/2 | slider at 40% |
| 9: Slider down | + `-410×ln(V+1) + 4067` | slider at 20% |
| 10: Transition | +1500ms | slider at 10% |
| 11: Full flight | +2000ms | slider at 0 |

AoA transitions through deployment: wingsuit AoA → 180° (vertical) → back through ~150°, 140°, 118°, 112°, 110° to full flight.

## Current GLB Assets

| File | Size | Status | Notes |
|------|------|--------|-------|
| `pc.glb` | 29 KB | ✅ Registered | Pilot chute, measured |
| `snivel.glb` | 5.6 KB | ✅ Registered | Canopy in bag, measured |
| `bridalandpc.gltf` | 46 KB | ✅ Registered | Combined model (to be replaced) |
| `bridal.glb` | 2.1 KB | ❌ Unregistered | Standalone bridle segment |
| `bridalsegment.glb` | 2.2 KB | ❌ Unregistered | Individual bridle piece |
| `slider.glb` | 2.5 KB | ❌ Unregistered | Slider rigid body |

## Target: Segmented System

### Deploy State Machine

```
packed → throw → bridle_extending → line_stretch → slider_down → flying
```

Simplified from CloudBASE's 12-event timeline. Each state has:
- Entry condition (physics-driven or event-driven)
- Active segments (which GLBs visible)
- Drag model (which coefficients apply)
- Constraint set (max distances between segments)

### Segment Chain

```
Container → Bridle → PC
                      ↓ (at bridle stretch)
               Canopy Bag / Lines
                      ↓
              Slider (descends)
                      ↓
              Riser attach points
```

### Per-Segment Aero

| Segment | Drag Model | Notes |
|---------|-----------|-------|
| PC (pre-inflation) | CD=0.9, A=π×0.035² | Tiny — bridle-in-tow drag |
| PC (inflated) | CD=0.9, A=π×0.483² ≈ 0.73 m² | Full drag after bridle stretch |
| Bridle | Negligible | Thin line, no meaningful drag |
| Canopy bag | Small parasitic | Not aero-loaded until line stretch |
| Slider | Proportional to area exposed | Decreases as it descends |
| Canopy (inflating) | Scales with deploy value | Existing aero system handles this |

### Key Simplifications vs CloudBASE

1. **No sequencer timeline** — physics-driven, not time-interpolated. CloudBASE pre-computed 12 keyframes and interpolated between them. We let the physics run.
2. **Single bridle segment** — CloudBASE didn't segment the bridle either (just distance constraint). We render it but don't need N segments for physics.
3. **Constraint solver same pattern** — clamp max distances, same as CloudBASE.
4. **Deploy slider maps to physical state** — instead of sequencer driving positions, the sim integration drives deploy value which drives rendering.

## Build Order

1. **Register GLBs** — measure `bridalsegment.glb`, `slider.glb`, `bridal.glb` bounding boxes, add to model-registry.ts
2. **Deploy state machine** — new `DeployState` enum + transition logic in sim-runner or dedicated module
3. **PC toss physics** — Euler integration: throw velocity + drag deceleration + distance constraint (CloudBASE pattern)
4. **Bridle stretch detection** — when PC-body distance ≥ bridle length → state transition
5. **Line stretch → canopy phase** — FSM transition, camera zoom-out, control handoff
6. **Slider descent** — driven by canopy inflation rate (maps to deploy slider)
7. **Render segment chain** — replace `bridalandpc.gltf` with positioned individual segments
8. **Camera zoom-out on deployment** — FSM camera control per phase

## Open Questions

- Use `bridalsegment.glb` or `bridal.glb` for the visual? (need to see both in viewer)
- Slider descent rate model — physics-driven or mapped from deploy slider?
- Throw velocity vector — CloudBASE uses 3 m/s lateral. Tunable?
