# Bridle & Pilot Chute — Physics Reference & GLB Assets

CloudBASE reference data and registered GLB assets for the deployment system. See **DEPLOYMENT-MODULE.md** for the simulation architecture.

## Physics Constants (from CloudBASE)

| Parameter | Value | Source |
|-----------|-------|--------|
| Pilot-to-attachment (total line length) | 5.23 m | `pilottoattachmentpoint` |
| Bridle length | 3.29 m (3.3 in sequencer) | `bridallength` |
| PC diameter | 38 inches (0.965 m) | `pcsize * metersperinch` |
| PC area | π × (0.483)² ≈ 0.732 m² | computed |
| Unopened PC radius | 0.035 m | `upcr` |
| PC mass | 0.057 kg | `pcmass` |
| Canopy mass | 3.7 kg | `canopymass` |
| Slider top position | 3.37 m | `slidertop` |

### Drag Coefficients

- **Bridle extending** (PC unopened): `½ × 0.9 × π×0.035² / 0.057 × 1.2`
- **Post bridle stretch** (PC open, full mass): `½ × 0.9 × 0.732 / (0.057 + 3.7) × 0.9`

### Constraint Pattern (reusable)

```
if distance(segment, anchor) > maxLength:
    correction = direction × (currentLength - maxLength) / currentLength
    segment.position -= correction
```

### CloudBASE Deploy Timeline (reference only — we use physics-driven, not keyframes)

12-event airspeed-dependent sequence. Key timing formulas:
- Bridle stretch time: `min(1600, 3000 × (3/V))` ms after throw
- Line stretch: `20V + 55.4` ms after bridle stretch
- Slider start: `10.04V + 700` ms after line stretch
- Slider down: `-410 × ln(V+1) + 4067` ms

## GLB Assets

All deployment GLBs registered in `model-registry.ts`:

| File | Size | glbToMeters | Key Dimensions | Notes |
|------|------|-------------|---------------|-------|
| `pc.glb` | 29 KB | 0.96 | 0.48 × 0.48 × 0.41 | Pilot chute |
| `snivel.glb` | 5.6 KB | 0.25 | 1.6 × 1.2 × 1.2 | Canopy in bag (bluff body for uninflated sim) |
| `bridal.glb` | 2.1 KB | **1.0** | 0.02 × 0.002 × 3.3 | Full bridle, 3.3m Z-axis, real-world scale |
| `bridalsegment.glb` | 2.2 KB | **1.0** | 0.02 × 0.002 × 0.33 | 1/10th bridle segment, real-world scale |
| `slider.glb` | 2.5 KB | **1.0** | 1.04 × 0.59 × 0.015 | Flat plate, center offset (0, 0.08, 1.12), has embedded light |
| `bridalandpc.gltf` | 46 KB | 0.81 | 0.48 × 0.48 × 3.69 | Monolithic combined model (legacy) |

### Segmented vs Monolithic Bridle

**Deferred decision.** The deployment physics (PC sub-sim, canopy bag rigid body, constraint solver) works the same regardless of rendering approach. The PC needs one distance constraint, not N segment constraints.

Options when we revisit:
- **Monolithic**: `bridal.glb` stretched/scaled to current extension length. Simple.
- **Segmented**: 10 × `bridalsegment.glb` revealed sequentially. More visual fidelity.
- **Line-only**: Skip GLB entirely, render as a Three.js Line. Cheapest.

The choice affects only rendering, not physics. Decide after the deployment sim is running and we can see what looks right.

### Open Questions (rendering only)

- Use `bridalsegment.glb` or `bridal.glb` for the visual?
- Strip embedded DirectionalLight from `slider.glb` on load?
- Throw velocity vector — CloudBASE uses 3 m/s lateral. Tunable?
