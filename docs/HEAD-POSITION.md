# HEAD-POSITION.md — Sensor Fusion Head Model & Sensor Visualization

## Overview

Render the FlySight sensor fusion output as a 3D head model attached to the wingsuit pilot, with live sensor data vectors drawn on the sensor device. This brings the sensor fusion project's output into the GPS viewer for video content and analysis.

## Data Source

**File**: `SENSOR_fused_fusion (1).csv` (or similar fused CSV from sensor_fusion_viewer)
**Sample**: `public/03-27-26/SENSOR_fused_fusion (1).csv`

### Key Columns

| Column | Description | Frame |
|--------|-------------|-------|
| `timestamp` | Seconds from data start | — |
| `qw, qx, qy, qz` | Orientation quaternion (body→earth, scalar-first) | NWU earth |
| `accel_body_x/y/z` | Raw accelerometer | Body (sensor) |
| `gyro_x/y/z` | Angular velocity (°/s) | Body (sensor) |
| `gravity_body_x/y/z` | Estimated gravity in body frame | Body (sensor) |
| `linear_accel_x/y/z` | Gravity-removed acceleration | Body (sensor) |
| `earth_accel_x/y/z` | Acceleration in earth frame | NWU earth |
| `roll, pitch, yaw` | Euler angles (°) | NWU earth |
| `gps_*` | Interpolated GPS columns (NWU) | NWU earth |

**Rate**: ~13 Hz (FlySight sensor output rate)
**Coordinate system**: NWU (North-West-Up) — **different from GPS pipeline NED!**

## Three.js Scene Graph Architecture

```
vehicleGroup (at origin)
├── wingsuitModel (with body orientation)
│   └── neckAttachPoint (fixed offset on wingsuit geometry)
│       └── headGroup (relative rotation = q_head_body)
│           ├── fullhead.gltf (head mesh)
│           └── sensorDeviceGroup (fixed offset on helmet)
│               ├── accelArrow (raw accel vector)
│               ├── gyroArrow (angular velocity vector)
│               ├── magArrow (if available)
│               ├── gravityArrow (estimated gravity)
│               └── linearAccelArrow (gravity-removed)
```

### Key Insight: Scene Graph Handles Composition

By attaching head → neck → wingsuit in the Three.js scene graph, we only need to set the **relative** head rotation. Three.js composes all parent transforms automatically:
- Wingsuit body orientation → set on wingsuitModel
- Head orientation relative to body → set on headGroup
- Sensor vectors in sensor frame → set on sensorDeviceGroup arrows

**No manual matrix multiplication needed at render time.**

## Transforms

### Body-to-Head Relative Rotation

The fused CSV gives `q_head_earth` (head orientation relative to earth/NWU).
The GPS pipeline gives wingsuit body orientation as Euler angles (NED).

```
q_head_body = q_wingsuit_earth.inverse() * q_head_earth
```

This is the quaternion set on `headGroup` in the scene graph.

### Frame Conversions

1. **NWU → NED**: The fused CSV uses NWU (North-West-Up). GPS pipeline uses NED (North-East-Down).
   - NWU→NED: `(x, -y, -z)` for positions/vectors, quaternion conjugation for rotations
   
2. **NED → Three.js scene**: Existing `nedToThree()` handles this.

3. **Sensor mounting**: FlySight mounted on helmet — sensor body frame has a fixed rotation offset relative to head. This is a calibration constant (TBD per mounting, may need per-flight config).

## Implementation Phases

### Phase 1: CSV Parser
- Parse fused CSV (skip comment lines starting with `#`)
- Extract: timestamp, quaternion (qw,qx,qy,qz), sensor vectors, GPS columns
- Handle NaN values (GPS coverage gaps)
- Store as typed array for fast access
- Time-align with GPS pipeline data (interpolate to GPS timestamps or vice versa)

### Phase 2: Head Model Attachment
- Load `fullhead.gltf` (already in `public/models/`)
- Find/define neck attach point on wingsuit model (fixed offset)
- Create headGroup in scene graph under neck point
- Compute `q_head_body` from fused quaternion and wingsuit orientation
- Apply NWU→NED→Three.js transform chain
- Verify head tracks independently of wingsuit body

### Phase 3: Sensor Device & Vectors
- Optional: Load FlySight device GLB (or simple box placeholder)
- Position on helmet (fixed offset from head model)
- Draw sensor vectors as ArrowHelpers:
  - **Accel** (red): raw accelerometer, body frame
  - **Gyro** (green): angular velocity, body frame  
  - **Gravity** (yellow): estimated gravity vector in body frame
  - **Linear accel** (cyan): gravity-removed acceleration
- Vectors drawn in sensor device local frame — scene graph handles world transform
- Scale arrows appropriately (accel in g's, gyro in °/s)

### Phase 4: UI Controls
- Toggle head model visibility
- Toggle individual sensor vectors
- Opacity slider for head model (translucent to see vectors through)
- Sensor vector scale slider

## Time Synchronization

The fused CSV runs at ~13 Hz, GPS at 5 Hz. Options:
1. **Interpolate fused data to GPS timestamps** — simpler, matches existing playback
2. **Interpolate GPS to sensor timestamps** — higher rate, smoother head motion
3. **Independent playback with shared timeline** — most flexible

Recommendation: **Option 2** for smooth head motion during playback. The fused data IS the high-rate source. Interpolate GPS/aero state to sensor timestamps for the timeline, use sensor-rate for head updates.

## File Organization

```
src/gps-viewer/
  head-model.ts       — GLB loading, scene graph setup, neck attachment
  sensor-overlay.ts   — Sensor vector arrows on device model
  fusion-parser.ts    — CSV parser for fused data
```

## Notes

- Head model: `public/models/fullhead.gltf` (committed in `9f7c7ae`)
- Sensor mounting offset is per-setup — may need config file per flight
- Canopy phase: head model still works (pilot hang orientation changes the parent transform, head relative rotation stays correct)
- Both inertial and body frame views benefit — inertial shows absolute head pointing, body frame shows head-relative-to-body motion
