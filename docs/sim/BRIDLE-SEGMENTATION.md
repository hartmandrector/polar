# Bridle & Pilot Chute Segmentation

Replace the current monolithic bridle+PC rendering with a **segmented system** — individual GLB segments with per-segment drag, mass, and position. This feeds into the phase FSM deployment sequence.

## Current State

- `bridalandpc.gltf` — single combined model (bridle line + pilot chute), scaled as one unit
- `bridal.glb` — standalone bridle segment (unregistered, 2.1 KB)
- `bridalsegment.glb` — individual bridle segment piece (unregistered, 2.2 KB)
- `pc.glb` — standalone pilot chute (registered, measured)
- `slider.glb` — slider rigid body (unregistered, 2.5 KB)
- `snivel.glb` — canopy in bag (registered, measured)
- Deployment visuals driven by `deploy` slider with continuous geometry morphing

## Target: Segmented System

### Components (each a registered GLB with aero properties)

| Segment | GLB | Mass (kg) | Drag Area (m²) | Notes |
|---------|-----|-----------|-----------------|-------|
| Pilot chute | `pc.glb` | 0.3 | 0.7 | Already registered. Throw velocity + drag |
| Bridle segment ×N | `bridalsegment.glb` | ~negligible | Per-segment CD×A | Sequential deployment along bridle |
| Canopy bag | `snivel.glb` | Full canopy mass | Small (packed) | Not aero-loaded until line stretch |
| Slider | `slider.glb` | 0.1 | Variable | Descends lines during inflation |

### Segment Chain (deployment order)

```
Container → Bridle[0] → Bridle[1] → ... → Bridle[N] → PC
                                              ↓
                                         Canopy Bag
                                              ↓
                                    4-line-group + Slider
                                              ↓
                                         Riser attach
```

Pilot chute toss launches PC with throw velocity. Bridle segments deploy sequentially from container outward as tension propagates. When last bridle segment deploys → line stretch event.

### Per-Segment Properties

Each segment needs:
- **Position** — NED offset from previous segment (chain link)
- **Drag model** — CD × reference area, applied along relative wind
- **Mass** — for momentum transfer (most segments negligible)
- **Visual state** — packed / deploying / deployed
- **Tension** — force transmitted to next segment in chain

### Integration with Phase FSM

| Phase | Segment Behavior |
|-------|-----------------|
| Freefall (pre-toss) | All segments packed, invisible |
| Extraction | PC visible + dragging, bridle segments appear sequentially |
| Line stretch | All bridle segments deployed, snatch force event → FSM transition |
| Slider down | 4-line-group visible, slider descends, canopy inflates |
| Flying | Slider stowed, full canopy, segments hidden or minimal |

### Existing Code to Reference (not port)

CloudBASE-era bridle mechanics exist with surface area, drag coefficients, and segment positions. Use as physics reference but implement fresh against our segment factory / registry pattern:
- Segment drag: `F_drag = 0.5 * rho * V² * CD * A` per segment
- Sequential deployment: each segment has a deployment threshold on the deploy slider
- Tension propagation: upstream segment tension = downstream drag + downstream tension

## Build Order

1. **Register GLBs** — measure `bridalsegment.glb`, `slider.glb`, `bridal.glb` bounding boxes, add to model-registry.ts
2. **Define segment chain data** — positions, drag areas, deployment thresholds in polar-data or new deployment-data module
3. **Render segment chain** — replace `bridalandpc.gltf` rendering with individual positioned segments
4. **Wire to deploy slider** — segment visibility driven by deploy value (manual control first)
5. **Add drag computation** — per-segment drag forces fed into EOM during deployment phase
6. **Wire to FSM** — A button → PC toss → physics-driven deployment → line stretch event → canopy phase

## Open Questions

- How many bridle segments? (CloudBASE count vs simplified)
- Bridle segment length in meters? (need GLB measurement for scale factor)
- Does slider need its own drag model or is it captured in canopy area scaling?
- Camera zoom-out on deployment trigger (noted — FSM camera control)
