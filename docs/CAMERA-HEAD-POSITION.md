# Camera Head Position — Planning Doc

## Overview

Add a second head orientation source to the GPS viewer: **Insta360 X5 camera quaternions** exported from Gyroflow. This complements the existing FlySight fused sensor (`SENSOR_fused_fusion.csv`) and gives us an independent orientation measurement from the camera's IMU.

## Current State

### Existing Head Sensor System
- **Load button**: "Load Fused CSV" in sidebar → imports `SENSOR_fused_fusion.csv`
- **Data**: FlySight fused quaternion (NWU body-to-earth, scalar-first) at sensor sample rate
- **Rendering**: `head-renderer.ts` draws head GLB model with `getHeadThreeQuat()` — direct quaternion from CSV with NWU→Three.js remap `(-qy, qz, -qx, qw)`
- **Mount offset**: `MOUNT_PITCH_DEG = 10` — single-axis body-frame correction for sensor mounting angle
- **Auto time-alignment**: via `gps_time` column in fused CSV
- **Race condition handling**: `pendingSensorData` queue for GLB load timing

### What We're Adding
- **Second button**: "Load Camera Quaternion" (or "Load X5 Data")
- **Data source**: Gyroflow camera data CSV export (per-frame or full 1kHz)
- **Quaternion fields**: `org_quat_w`, `org_quat_x`, `org_quat_y`, `org_quat_z`
- **Time sync**: Uses `video-sync.ts` offset (epoch-based + optional cross-correlation)

## Architecture

### Data Priority
When both sources are available:
1. **Camera quaternion** → drives the head GLB model position/orientation (trusted for absolute orientation)
2. **FlySight fused sensor** → drives the sensor visualization arrows (local measurement, already working well)
3. **Neither** → head model hidden (current behavior)

When only one source:
- Camera only → drives head model
- Sensor only → drives head model (current behavior)

### Mount Offsets (Two Separate Concepts)

#### 1. Camera Mount Position (lever arm)
Where the camera sits relative to the helmet/head center.
- **X5 on selfie stick**: ~15-20cm above helmet top, offset forward by stick angle
- **Configurable sliders**: X (forward/back), Y (left/right), Z (up/down) in body frame
- Changes per jump based on stick position/angle
- Affects where we'd draw a camera icon, NOT the head model position
- For head model: camera position tells us head position after subtracting the mount offset

#### 2. Camera Orientation Offset (misalignment)
The camera's forward axis vs the head's forward axis.
- Selfie stick angle creates a pitch offset (camera tilted relative to head forward)
- Possible yaw offset if stick isn't perfectly centered
- Roll offset if mount is twisted
- **Configurable sliders**: pitch, yaw, roll offsets (degrees) — all three axes
- Applied as body-frame pre-rotation before converting camera quat → head quat:
  ```
  head_quat = camera_quat * inverse(mount_rotation_offset)
  ```

### Time Synchronization

#### Automatic (from video-sync.ts)
- Gyroflow project file provides `created_at` epoch → coarse offset
- Camera CSV timestamps are relative (ms from video start)
- `camera_pipeline_time = camera_timestamp_ms + sync_offset_ms`
- `sync_offset_ms` from `sync-result.json` or computed on load

#### Manual Override
- Slider/input for manual time offset adjustment (fine tuning by eye)
- Similar to existing `headTimeOffset` input for fused sensor

### Interpolation
- Camera data at 30fps (per-frame export) or 1kHz (full export)
- GPS viewer runs at variable rate, needs interpolation between camera samples
- **Slerp** between nearest camera quaternions (same as current head sensor slerp)
- For 30fps data: max 33ms gap, smooth enough for 60fps Playwright capture
- For 1kHz data: 1ms gaps, no visible interpolation artifacts

## UI Changes

### Sidebar Section
```
── Head Orientation ──────────────
[Load Fused CSV]  [Load Camera Quat]

Source: Camera X5 (synced)  ← status text

Camera Mount Offset:
  Position X: [====|====] 0.0 cm
  Position Y: [====|====] 0.0 cm  
  Position Z: [====|====] 15.0 cm
  
  Pitch: [====|====] -15°
  Yaw:   [====|====] 0°
  Roll:  [====|====] 0°

Time Offset: [====|====] -62405 ms (auto)
  [Manual Override] □
```

### Display
- Head GLB model driven by selected source (camera takes priority)
- When both sources loaded, could optionally show a ghost/wireframe for the secondary source to visually compare
- Playwright capture: include camera mount offsets in URL params (`camPitch`, `camYaw`, `camRoll`, `camX`, `camY`, `camZ`, `camOffset`)

## File Format

### Camera Data CSV (from Gyroflow)
```csv
frame,timestamp_ms,org_acc_x,org_acc_y,org_acc_z,org_pitch,org_yaw,org_roll,
org_gyro_x,org_gyro_y,org_gyro_z,org_quat_w,org_quat_x,org_quat_y,org_quat_z,
focus_distance,stab_pitch,stab_yaw,stab_roll,stab_quat_w,stab_quat_x,stab_quat_y,
stab_quat_z,focal_length,fov_scale,minimal_fov_scale
```

Key fields:
- `timestamp_ms` — relative to video start (can be negative for pre-roll IMU)
- `org_quat_w/x/y/z` — fused camera orientation quaternion
- `org_gyro_x/y/z` — raw gyro (deg/s), useful for future analysis
- `org_acc_x/y/z` — raw accelerometer, useful for sync verification

### Sync Result JSON (from video-sync.ts)
```json
{
  "offsetMs": -62405,
  "method": "correlation",
  "confidence": "fine",
  "videoStartEpochMs": 1753802359000,
  "gpsStartEpochMs": 1753802422050
}
```

## Implementation Plan

### Phase 1: Camera Data Loader
- [ ] New parser: `camera-sensor.ts` — reads Gyroflow camera CSV
- [ ] Camera data type: `CameraFrame { timestampMs, quat: {w,x,y,z}, gyro?, acc? }`
- [ ] Load button in sidebar UI
- [ ] Time offset input (manual entry, auto-populated from sync-result.json if found)
- [ ] Store camera frames on scene alongside sensor data

### Phase 2: Head Model from Camera Quaternion
- [ ] Determine Gyroflow quaternion convention (reference frame, handedness)
- [ ] Build camera→head quaternion transform (apply mount orientation offset)
- [ ] Modify head-renderer to accept either source, camera takes priority
- [ ] Slerp interpolation at render time
- [ ] Verify visually: head model should match camera perspective in 360° video

### Phase 3: Mount Offset Controls
- [ ] Position offset sliders (X/Y/Z in cm)
- [ ] Orientation offset sliders (pitch/yaw/roll in degrees)
- [ ] Live preview — adjustments immediately update head model
- [ ] Save/load offset profiles per jump (or reasonable defaults)

### Phase 4: Dual Source Comparison
- [ ] Ghost/wireframe mode when both sources loaded
- [ ] Overlay comparison: camera quat vs fused sensor quat → angular difference readout
- [ ] Useful for calibrating mount offsets and validating sensor fusion quality

### Phase 5: Playwright & Capture
- [ ] Camera offset params in URL for automated capture
- [ ] Include in `CaptureSessionState` and `buildCaptureUrl()`
- [ ] 60fps interpolation verified smooth

## Open Questions

1. **Gyroflow quaternion convention**: What frame? Gravity-aligned + magnetic north? Need to test by loading data and comparing known orientations (standing upright, looking north, etc.)

2. **`org_quat` vs `stab_quat`**: The `org` (original) is the raw fused orientation. The `stab` (stabilized) is after Gyroflow applies stabilization. We want `org` — it represents actual camera orientation in space.

3. **Camera position relevance**: For the GPS viewer, we care about HEAD orientation (to position the head model). The camera's physical position on the helmet matters for accurate lever-arm correction but is secondary. The orientation offset (stick angle) is what matters most.

4. **Auto-detect sync**: Could we auto-detect the Gyroflow project file or sync-result.json in the same folder as the camera CSV? Would simplify the load flow.

5. **FlySight fused vs camera IMU quality**: Which IMU is better? FlySight has a dedicated 9DOF IMU. Insta360 X5 IMU is optimized for video stabilization (high gyro rate, may have different accel noise characteristics). Visual comparison will reveal this.

6. **Multiple cameras per jump**: Some setups have chin-mount + top-mount. For now, support one camera source. Extensible later.

## Physical Setup (2025-07-29 Squaw)
- Camera: Insta360 X5 on selfie stick mount
- Mount: Top of helmet, stick angled forward
- Approximate lever arm: ~15cm up, ~5cm forward from head center
- Stick provides ~20° forward pitch offset
- FlySight fused sensor: separate device on back of helmet (different mount angle)
