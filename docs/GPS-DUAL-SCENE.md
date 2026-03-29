# GPS Dual Scene — Planning Document

## Vision

Two side-by-side 3D views of the same flight, sharing one timeline:

1. **Inertial Frame View** — flight path through world space. Trail, terrain grid, camera follows the vehicle through the environment.
2. **Body Frame View** — vehicle-centered. World rotates around the vehicle. Force vectors, moment arcs, and flow angles are inspectable by orbiting the camera around the stationary vehicle.

Both views share the same playback transport (scrubber, play/pause, speed). Both allow independent orbit camera control for inspection.

---

## Architecture Discussion

### The Origin Problem

Three.js scenes are centered at world origin (0,0,0). When the vehicle flies hundreds or thousands of meters from origin, floating-point precision degrades and camera follow gets awkward.

**CloudBASE approach**: Everything computed relative to the pilot. Trail positions, static objects, canopy — all positions are `object_world_pos - pilot_pos`. The pilot stays near origin. This is effectively a "pilot-centered inertial frame."

**Current GPS viewer**: Uses absolute NED→scene coordinates. The trail is built from absolute positions, model flies along it, camera chases. Works for short flights but doesn't scale.

### Proposed Architecture: Vehicle at Origin

Adopt the CloudBASE pattern — compute all positions relative to the vehicle CG:

```
scenePos(object) = nedToScene(object.posNED - vehicle.posNED)
```

- Vehicle model sits at (0,0,0) always
- Trail positions: `trailPos[i] = nedToScene(data[i].pos - data[currentIndex].pos)`
- Grid/ground: shifted so origin = vehicle ground projection
- Force vectors, moment arcs: already in body frame, attached at origin

**With the vehicle at origin, the only difference between inertial and body frame is rotation:**

| | Inertial Frame | Body Frame |
|---|---|---|
| Vehicle position | Origin (0,0,0) | Origin (0,0,0) |
| Vehicle rotation | `bodyToInertialQuat(φ, θ, ψ)` | Identity (no rotation) |
| Trail/world objects | `nedToScene(pos - vehiclePos)` | `bodyQuat.inverse() * nedToScene(pos - vehiclePos)` |
| Force vectors | Rotated to inertial frame | Stay in body frame (native) |
| Grid/ground | Translated, no rotation | Translated + rotated by inverse body quat |
| Camera orbit | Free orbit around vehicle | Free orbit around vehicle |

### Two Scenes vs Two Cameras

**Option A: Two separate Three.js scenes**
- Pros: Completely independent rendering, easy to manage, no shared state bugs
- Cons: Duplicate model loading, duplicate lighting, more GPU memory

**Option B: One scene, two cameras + two renderers**
- Pros: Share geometry (model, trail), less memory
- Cons: Can't have different rotations on the same objects without cloning; orbit controls fight each other

**Option C: One scene, clone transforms per frame**
- Shared scene graph, but before each render pass, apply the appropriate rotation
- Complex, fragile

**Recommendation: Option A** — Two separate scenes. The models are tiny (GLB files are < 1MB each). Code is cleaner, each scene manages its own camera/controls independently. Share data arrays, not Three.js objects.

### Scene Class Refactor

Current `GPSScene` does everything: model loading, trail, camera follow, aero overlay, canopy, orbit controls.

Proposed: Factor out a base class or shared config, then two instances:

```typescript
interface DualSceneConfig {
  data: GPSPipelinePoint[]
  canopyStates: CanopyState[]
  aeroConfig: AeroOverlayConfig
  canopyAeroConfig: AeroOverlayConfig
  ekf: OrientationEKF
}

class InertialScene {
  // Vehicle at origin, world positions relative to vehicle
  // Vehicle rotated by body-to-inertial quat
  // Trail, grid in world orientation
  // Free orbit camera
}

class BodyScene {
  // Vehicle at origin, identity rotation
  // World objects rotated by inverse body quat
  // Force vectors in body frame (no rotation needed)
  // Moment arcs in body frame
  // Free orbit camera
  // Wind vector indicator?
  // AOA/sideslip visualization?
}
```

### Camera System

Current problem: follow cam is the only option, can't freely inspect.

**New camera for both views:**
- OrbitControls around the vehicle (always at origin)
- No follow algorithm needed — vehicle is always at origin
- Default viewing angle presets (behind, above, side, front) via keyboard shortcuts
- Optional: auto-rotate to maintain "behind" view (toggle)

For the **inertial view**, the orbit target moves with the vehicle (which is at origin, so the trail/world moves). The camera stays in the same relative position unless the user orbits.

For the **body frame view**, nothing moves — the user just orbits around the stationary vehicle to inspect force vectors and moments from any angle. World geometry (trail, grid) rotates around the vehicle showing how the world moves relative to the body.

### HTML Layout

```
┌─────────────────────────────────────────────────────┐
│ Transport: [▶] [═══════════════] 1:23.4 / 3:45.0 [1×] │
├──────────────────────┬──────────────────────────────┤
│   Inertial Frame     │     Body Frame               │
│   [canvas]           │     [canvas]                  │
│                      │                               │
│                      │                               │
├──────────────────────┴──────────────────────────────┤
│ Charts (full width, below scenes)                    │
│ [chart1] [chart2] [chart3] [readout]                │
└─────────────────────────────────────────────────────┘
```

Or alternatively, stacked vertically with charts to the right (current layout adapted):

```
┌──────────────────────┬──────────────────┐
│   Inertial Frame     │  Charts          │
│   [canvas]           │  [chart1]        │
├──────────────────────┤  [chart2]        │
│   Body Frame         │  [chart3]        │
│   [canvas]           │  [readout]       │
├──────────────────────┴──────────────────┤
│ Transport: [▶] [═══════] 1:23.4 [1×]   │
└─────────────────────────────────────────┘
```

**TBD: Hartman's preference on layout.**

---

## Implementation Phases

### Phase 1: Vehicle-at-Origin Refactor
- Refactor `GPSScene` so the vehicle is always at (0,0,0)
- Trail positions computed as `data[i].pos - data[current].pos` each frame
- Grid follows vehicle
- Camera: orbit controls around origin, remove follow cam algorithm
- Verify existing single-scene works identically after refactor

### Phase 2: Scene Abstraction
- Extract shared data/config interface
- Create `InertialScene` (vehicle rotated, trail in world frame)
- Create `BodyScene` (vehicle identity, trail/world rotated by inverse body quat)
- Both extend common base or share utilities

### Phase 3: HTML Layout + Wiring
- Update `gps.html` with dual canvas layout
- Wire both scenes to same transport/scrubber
- Independent OrbitControls per canvas

### Phase 4: Body Frame Enhancements
- Force vectors rendered in body frame (no rotation transform needed)
- Moment arcs in body frame
- Wind vector indicator
- AOA/sideslip angle visualization
- Head model rendering (using fullhead.gltf + sensor fusion quaternion)

### Phase 5: Camera Presets
- Keyboard shortcuts for standard views (1=behind, 2=above, 3=side, 4=front, 5=below)
- Optional auto-track mode for inertial view

---

## Decisions (from Hartman walk session 2026-03-29)

1. **Layout**: Side-by-side. Split current scene panel into two equal boxes. Each has its own OrbitControls.
2. **Trail**: Full flight length. No truncation needed for now.
3. **Grid**: Remove from both views. Confusing in inertial, not ideal in body frame either. Clean background.
4. **Aero overlay**: Show in both views. The segmented aero model overlay is the primary deliverable — curved arrows, force vectors, moment arcs. This project is the authority on segmented aerodynamics.
5. **Two separate scenes**: Confirmed. Share data arrays, not Three.js objects.
6. **Background**: Transparent for PNG export. Dark background for interactive viewing.

---

## PNG Export Pipeline

Each scene window must be able to output a stream of PNG images with **transparent background**. This produces small icon-style 3D model renders that rotate realistically with the flight data.

**Outputs per frame:**
- Inertial frame PNG (transparent)
- Body frame PNG (transparent)

These get composited with other data overlays (charts from playwright-capture, telemetry, etc.) into final video.

The polar project is the **home base** for segmented aero rendering because it's the authority on the segment model. Other projects (CloudBASE, sensor fusion) produce CSV data; this project renders the physics.

---

## Sensor Fusion Head Model

### Data Source
The fused CSV file (from sensor_fusion_handoff) contains pre-computed quaternions for head orientation. The fusion algorithm has already done the hard work — this project just renders the result.

### CSV columns used:
- `qw, qx, qy, qz` — orientation quaternion (body-to-earth, scalar-first)
- `accel_body_x/y/z` — raw accelerometer (body frame)
- `gyro_x/y/z` — angular velocity (body frame)
- Mag data if available

### Rendering plan:
1. **Parse fusion CSV** — extract quaternion timeseries, sync to GPS timestamps
2. **Head model** (`fullhead.gltf`) — attached to wingsuit model at neck/helmet position
3. **Axis remap** — sensor frame → Three.js frame (sensor mounting orientation TBD)
4. **Body-to-head transform** — the head quaternion is relative to earth, the wingsuit body has its own orientation. The head's rotation relative to the wingsuit body = `q_head_body = q_wingsuit_inertial.inverse() * q_head_inertial`
5. **Sensor visualization** — the accelerometer, gyro, and mag vectors can be drawn as arrows on the head model, showing the raw sensor data in the sensor's own reference frame. The FlySight device can be modeled too.

### Rendering layers:
- Wingsuit model: oriented by GPS-derived body angles (existing)
- Head model: oriented by fusion quaternion (new)
- Sensor arrows on head: accel/gyro/mag vectors in sensor frame (new)
- Force/moment arrows on wingsuit: from segment aero model (existing)

This substantially complicates rendering but the math is all done upstream. This project is just a renderer for pre-computed data.

---

## Key Insight

> With the vehicle at origin, the only difference between the two frames is: **who gets rotated — the vehicle or the world.**
>
> - Inertial: rotate the vehicle by `bodyToInertialQuat`
> - Body: rotate everything else by `inertialToBodyQuat` (inverse)
>
> All position math is identical. The rotation is the only toggle.

---

## Implementation Order

1. **Phase 1**: Vehicle-at-origin refactor (single scene first, verify nothing breaks)
2. **Phase 2**: Split into dual scenes, HTML layout, shared transport
3. **Phase 3**: Remove grid, clean backgrounds, PNG export with transparency
4. **Phase 4**: Sensor fusion CSV import + head model rendering
5. **Phase 5**: Sensor data visualization (accel/gyro/mag arrows on head model)
6. **Phase 6**: Polish — camera presets, auto-rotate toggle, keyboard shortcuts
