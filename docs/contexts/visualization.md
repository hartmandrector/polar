# Context: Visualization

> **Load this context** when working on the Three.js 3D viewer: scene setup,
> model loading, force vector arrows, mass overlay, cell wireframes,
> deployment animation, or the NED↔Three.js coordinate mapping.

---

## Scope

Everything that draws to the 3D canvas — scene management, GLB model loading
and assembly, force/moment vector visualization, mass point overlay, cell
wireframe debugging, attitude rotation, and the render loop.

---

## Key Files

### Must Read
| File | Lines | What's There |
|------|-------|-------------|
| `src/viewer/model-loader.ts` | 654 | GLB loading, canopy+pilot assembly, deployment scaling, CG offset, bridle positioning |
| `src/viewer/vectors.ts` | 681 | Force arrow creation/update, per-segment rendering, CP diamond, deployment position scaling |
| `src/main.ts` | 767 | App entry point — wires scene, controls, charts, models, force vectors, render loop |

### Also Read
| File | Lines | What's There |
|------|-------|-------------|
| `src/viewer/scene.ts` | 192 | Three.js scene, camera, lights, grid, orbit controls, compass/body axis labels |
| `src/viewer/mass-overlay.ts` | 234 | Mass segment spheres, CG/CP markers (green octahedron), 3D mass distribution |
| `src/viewer/cell-wireframes.ts` | 315 | Cell volume wireframes, LE nose triangles, color-coded by cell position |
| `src/viewer/frames.ts` | 274 | Coordinate frame transforms: `bodyToInertialQuat()`, `bodyQuatFromWindAttitude()`, NED↔Three.js quaternions |
| `src/viewer/shaded-arrow.ts` | 120 | Gradient-shaded force arrow geometry |
| `src/viewer/curved-arrow.ts` | 165 | Moment arc arrow geometry |

---

## Coordinate Mapping: NED ↔ Three.js

This is the single most important thing to get right in the viewer.

### The Transform

```
Three.js X = −NED y    (NED right → Three.js left)
Three.js Y = −NED z    (NED down → Three.js up)
Three.js Z = +NED x    (NED forward → Three.js toward camera)
```

Implemented in `frames.ts` as `nedToThreeJS()` and the inverse `threeJSToNED()`.

### Rotation Convention

The model rotates in Three.js space to match NED Euler angles:
1. `bodyQuatFromWindAttitude(α, β)` — creates a quaternion from wind-relative angles
2. `bodyToInertialQuat(φ, θ, ψ)` — creates a quaternion from Euler angles
3. Applied to the model group via `group.quaternion.copy(q)`

### CG Offset

After loading, the model is shifted so the physics CG sits at the Three.js
origin (0, 0, 0). This shift (`cgOffsetThree`) is subtracted from:
- Model mesh position
- Force vector origins
- Mass overlay positions
- Bridle position

**If you add a new visual element positioned in NED, you must subtract `cgOffsetThree`.**

---

## Model Loading Pipeline

### Single Model (wingsuit, skydiver, airplane)
```
1. GLTFLoader.load(path)
2. Normalize: scale so maxDim → TARGET_SIZE (2.0)
3. Center at BBox center
4. Apply CG offset (shift forward by cgOffsetFraction × bodyLength)
5. Add to scene
```

### Composite Model (canopy + pilot)
```
1. Load canopy GLB, apply parentScale (1.5) with X-flip (-1.5, 1.5, 1.5)
2. Load pilot GLB
3. Measure pilot rawBBox → pilotBodyExtent
4. Create pilotPivot group:
   - Position at riser attachment (PILOT_OFFSET + shoulderOffset)
   - Pilot mesh inside pivot, offset down by shoulderOffset
   - Pilot rotated -90° X, scaled by childScale (0.850)
5. Store pilotScale = TARGET_SIZE / (pilotBodyExtent × childScale)
6. Create composite group with canopy + pilotPivot
7. Normalize composite: scale by pilotScale (pilot body = TARGET_SIZE)
8. Center at riser convergence (not BBox center)
9. Apply CG from mass segments → cgOffsetThree
10. Attach bridle at registry bridleTop position
11. Store baseBridlePos for deployment scaling
```

### Deployment Animation (per-frame)
```
canopy.scale.set(-parentScale × spanScale, parentScale, parentScale × chordScale)
bridle.position = baseBridlePos × (spanScale, 1, chordScale) - cgOffset
// vectors.ts: segment positions × (chordScale, spanScale, 1) for canopy segments
```

---

## Force Vector System

### Arrow Types
| Type | Visual | What It Shows |
|------|--------|--------------|
| Lift (green) | Shaded arrow | Total lift force, perpendicular to wind |
| Drag (red) | Shaded arrow | Total drag force, along wind |
| Side (blue) | Shaded arrow | Total side force |
| Weight (yellow) | Shaded arrow | Gravity vector (always NED +z) |
| Moment (colored arcs) | Curved arrows | Pitch (green), yaw (blue), roll (red) |
| Per-segment | Small arrows | Individual segment lift+drag, color-coded |

### Per-Segment Rendering

When segments exist, individual arrows are drawn at each segment's position:
- Position = segment NED position, converted to Three.js, minus `cgOffsetThree`
- CP offset applied along chord direction: `-(cp - 0.25) × chord / height`
- Deployment scaling applied to canopy segments (span × chord)
- Color palette: cells (cyan/green/yellow/orange by position), flaps (darker variants), lines/PC (gray)

### CP Diamond

Green octahedron marker showing the system center of pressure:
- **Area-weighted average** of per-segment CPs (rendering approximation)
- Physics uses per-segment 3D CP positions for actual moment arms
- Position: NED → Three.js, minus `cgOffsetThree`

---

## Constraints & Invariants

### Critical
- **Always subtract `cgOffsetThree`** from any NED→Three.js position before placing in scene.
- **Canopy X is flipped** — `scale.x` is negated (−1.5) to correct left/right. Any manual positioning on canopy must account for this.
- **`pilotScale` is derived from canopy mesh scale** — not computed independently. This ensures physics segment NED positions map exactly to GLB coordinates.
- **Deployment scale formulas must be identical** in model-loader.ts, vectors.ts, and main.ts. If you change one, change all three.

### Architecture Rules
1. **`model-loader.ts` handles spatial assembly only** — no physics, no coefficient evaluation.
2. **`vectors.ts` only reads forces/positions** — it does not compute them. Forces come from `aero-segment.ts`.
3. **`main.ts` is the glue** — it wires controls → physics → rendering. Keep logic in specialized modules.
4. **Scene origin = physics CG** — this is established by `applyCgFromMassSegments()` and must be respected by all visual elements.
5. **All constants from registry** — no magic numbers in viewer code. Scales, offsets, and positions come from `model-registry.ts`.

---

## Related Contexts
- `docs/contexts/model-registry.md` — GLB data, scaling, assembly parameters
- `docs/contexts/canopy-system.md` — Deployment behavior, segment positions
- `docs/contexts/charts.md` — 2D chart panels (separate from 3D viewer)
