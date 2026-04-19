# Insta360 X5 Data Extraction & Sync Research

## Goal
Automated time synchronization between Insta360 X5 360° video and FlySight 2 GPS data for the Polar Project GPS viewer and Blender editing pipeline.

## File Format

### .insv Container
- Standard **MP4 container** (ftyp: `avc1`, isom)
- Top-level atoms: `ftyp`, `wide`, `mdat` (video data), `moov` (metadata), **`inst`** (Insta360 proprietary)
- `moov` contains: 2× `trak` (dual-lens video, handler `vide`), 1× `trak` (audio, handler `soun`)
- **No metadata/gyro track** in standard MP4 moov — all sensor data lives in the `inst` atom

### `inst` Atom (Insta360 Proprietary)
- Binary blob appended after `moov`
- **Data is encrypted/obfuscated** on X5 (confirmed: raw bytes show no recognizable IMU patterns)
- Ends with: `[inst content] [content_size: LE u32] [count: LE u32 = 3] [magic: 32-byte string]`
- Magic phrase: `8db42d694ccc418790edff439fe026bf`
- Contains: gyro, accelerometer, exposure, timestamps, GPS (if camera has GPS), camera calibration parameters

### Camera Calibration (in metadata tail)
Found in the last ~2KB before the trailer. For the X5, dual-lens calibration string:
```
2_2.000000_4252.570_4251.690_2742.240_2680.080_-0.139_-0.951_89.991_0.000000_0.000000_0.000000_
[lens1 distortion params]_10752_5376_113_2.000000_4289.130_4290.320_8070.250_2690.020_0.470_0.062_88.022_
[lens2 distortion params]_10752_5376_113_394240
```
Format: `lens_count_focal_x_focal_y_cx_cy_distort1_distort2_distort3_...resolution_w_resolution_h_...`

### File Organization (Hartman's logbook)
```
OneDrive/Wingsuit Science/
  Squaw/
    2025-07-29/
      VID_20250729_091620_00_033.insv    (1.2 GB, shorter clip)
      VID_20250729_091919_00_034.insv    (4.4 GB, main jump)
      LRV_20250729_091620_01_033.lrv     (70 MB, low-res preview)
      LRV_20250729_091919_01_034.lrv     (211 MB, low-res preview)
      hartman.csv                        (320 KB, FlySight GPS)
      360squaw072925.mp4                 (exported 360)
      untitled.blend                     (Blender project)
      keyframes72925.json                (GPS viewer keyframes)
```

Naming convention: `VID_YYYYMMDD_HHMMSS_LL_NNN.insv`
- `YYYYMMDD_HHMMSS`: recording start time (local)
- `LL`: lens index (00 = primary, 10 = secondary)
- `NNN`: sequential clip number

## Data Extraction Tools

### 1. Gyroflow (RECOMMENDED — primary tool)
- **Open source** Rust app for gyro-based video stabilization
- **Natively reads Insta360 .insv files** including encrypted gyro data
- Has Insta360 SDK integration for decryption
- Can **export raw gyro/accel data** as CSV or JSON
- Supports X5 (and all Insta360 models)
- GitHub: github.com/gyroflow/gyroflow
- **Key capability**: Extracts timestamped gyro + accel at camera's native IMU rate

### 2. Insta360 SDK
- Official SDK at insta360.com/sdk/home (requires application/approval)
- Enterprise-focused, may have restrictions
- Would provide proper decryption of the `inst` atom
- Alternative: the Insta360 Studio app itself can import GPX data

### 3. ExifTool
- `exiftool -ee -G -s -b -j -a -T filename.insv`
- Can read maker notes, some metadata from older cameras
- **May not decrypt X5 gyro data** (encrypted inst content)
- Good for: serial number, firmware, camera model, timestamps

### 4. Insta360toBlackBoxCSV (Python)
- GitHub: nivim/Insta360toBlackBoxCSV
- Extracts gyro as Betaflight BlackBox CSV
- Designed for FPV stabilization community
- **May not work with X5 encryption**

### 5. insvtools (Java)
- GitHub: alex-plekhanov/insvtools
- Can cut, dump metadata, extract/replace metadata
- Useful for trimming without re-encoding
- **dump-meta** command exports metadata as JSON

### 6. Telemetry Extractor
- Commercial tool: goprotelemetryextractor.com/tools-for-insta360
- Exports GPS, accel, gyro to GPX, CSV, KML, After Effects
- Supports Insta360 cameras

## Time Sync Strategy

### Primary Method: Insta360 Studio Project Files
The most reliable sync source is the `.insprj` XML project file created by Insta360 Studio. It contains exact trim start/end in milliseconds relative to the INSV recording start. Combined with the INSV's `creation_time` (UTC epoch from `moov/mvhd`) and FlySight's GPS epoch timestamps, we get sub-frame-accurate sync without any signal processing:

```
gps_pipeline_time = (insv_creation_epoch + trim_ms - gps_start_epoch) / 1000
```

**Requirements**: The user must have opened the INSV in Insta360 Studio and created at least one trim/scheme. This is the normal workflow when exporting an MP4.

### Fallback Method: Cross-Correlation
When no `.insprj` exists (e.g. raw INSV that was never opened in Studio), use `video-sync.ts`:
1. Extract camera IMU from INSV via Gyroflow → gyroflow CSV
2. Coarse sync: INSV `creation_time` vs FlySight epoch → offset ±1s
3. Fine sync: Cross-correlate camera angular rates (from gyroflow quaternions) with GPS-derived body rates
4. The MP4 duration gives the clip length; the fine offset positions it

### Available Sync Points (Manual Verification)
1. **Push-off at exit** — visible in both GPS acceleration and camera gyro/accel spike
2. **Pilot chute toss** — very accurate with current deploy detection system
3. **Turns/maneuvers** — correlation of gyro rates with GPS-derived body rates
4. **Camera file timestamp** — embedded in filename (`HHMMSS`) and moov metadata
5. **FlySight GPS epoch** — absolute UTC timestamps

### Challenges
- Camera `creation_time` is UTC but filename uses **local time** (e.g. `161157` = UTC+8 for `081157Z`)
- Camera may start recording minutes before jump — large INSV, small trim
- Exported MP4 `creation_time` = INSV recording start, NOT trim start
- Camera IMU rate (~30 fps in Gyroflow CSV) vs GPS rate (20 Hz) — close enough for correlation
- Coordinate frame differences between camera IMU and NED

## Insta360 Studio Integration

### What Insta360 Studio Supports
- **GPX import** via Stats dropdown → Local Data Import
- This overlays GPS stats on the video timeline
- Keyframe editing for camera orientation/zoom within 360° sphere
- Export via built-in ffmpeg: trimmed MP4s tagged `Lavf60.3.100`

### Project File Format (`.insprj`)

**Location**: `C:\Users\hartm\Documents\Insta360\Studio\Project\{hash}\{filename}.insprj`

Each INSV file that has been opened in Insta360 Studio gets a companion `.insprj` file — an XML document containing all editing state. Multiple edit "schemes" (named variants) are stored per file.

**Structure**:
```xml
<schemes>
  <scheme name="Clip2" last_edit="2026.04.18 18:05:59">
    <duration>435435</duration>
    <trim_start>308626</trim_start>
    <trim_end>319654</trim_end>
    <data_list>
      <data type="5" time="309482" pan="2.68" tilt="-0.01" fov="1.21" ... />
      ...
    </data_list>
  </scheme>
</schemes>
<default_scheme>Clip2</default_scheme>
```

**Key fields per scheme**:
| Field | Type | Description |
|-------|------|-------------|
| `duration` | int (ms) | Total INSV recording duration |
| `trim_start` | int (ms) | In-point within INSV timeline |
| `trim_end` | int (ms) | Out-point within INSV timeline |

**Key fields per keyframe** (`<data>` inside `<data_list>`):
| Field | Type | Description |
|-------|------|-------------|
| `time` | int (ms) | Position within INSV timeline |
| `pan` | float (rad) | Camera pan angle |
| `tilt` | float (rad) | Camera tilt angle |
| `roll` | float (rad) | Camera roll angle |
| `fov` | float | Field of view multiplier |
| `distance` | float | Camera distance (usually 0) |

### Timeline Project Files (`rough_cut.json`)

**Location**: `C:\Users\hartm\Documents\Insta360\Studio\TimelineProject\{hash}\rough_cut.json`

These are multi-clip timeline projects (like a video editor sequence). They reference INSV files by full path and contain trim/arrangement data. Useful for multi-clip workflows but per-clip `.insprj` files are simpler for single-export sync.

### Exported MP4 Limitations

MP4 files exported from Insta360 Studio have these properties:
- `creation_time` = **original INSV recording start** (NOT the trim start)
- Duration reflects the **trimmed length** (e.g. 11.044s)
- `udta` contains only `Lavf60.3.100` (ffmpeg muxer tag, no Insta360 metadata)
- `elst` edit list has `media_time=0` (no trim offset encoded)
- **The MP4 alone cannot tell you where in the INSV it came from**
- Must cross-reference with the `.insprj` project file to find the trim offset

## Verified Timing Chain (2025-05-03 Dashanbao)

### Source Files
```
C:\Users\hartm\OneDrive\Wingsuit Science\china\dashanbao\dashinbao\edit\25-05-03\05-03-2025-2\
├── VID_20250503_161157_00_016.insv     (10.3 GB, 435.435s, 4000×3000 @ 30fps)
├── VID_20250503_161157_00_016(1).mp4   (75 MB, 11.044s, 4000×3000 @ 30fps)
├── LRV_20250503_161157_01_016.lrv      (473 MB, 435.435s, low-res preview)
├── TRACK.CSV                            (FlySight 2, 20Hz, 888.9s coverage)
├── SENSOR.CSV                           (FlySight 2)
├── EVENT.CSV
├── RAW.UBX
├── gyroflowsensordata.csv              (13052 frames, 435.5s)
└── polar-*/                             (PNG overlay sequences)
```

### Insta360 Studio Project
```
C:\Users\hartm\Documents\Insta360\Studio\Project\3fa2e52894f25a4d6019008908bdd26e\
└── VID_20250503_161157_00_016.insv.insprj
```

**5 schemes found**:
| Scheme | Trim Start (s) | Trim End (s) | Duration (s) |
|--------|---------------|-------------|-------------|
| tt4dl | 298.3 | 363.6 | 65.2 |
| Clip1 | 298.3 | 373.4 | 75.1 |
| Clip1_copy | 324.6 | 373.4 | 48.9 |
| **Clip2** (default) | **308.6** | **319.7** | **11.0** |
| backup | 3.0 | 432.4 | 429.4 |

**Match**: Scheme "Clip2" duration (11.028s) ≈ MP4 duration (11.044s). The 16ms difference is likely audio padding by ffmpeg. **Clip2 is confirmed as the MP4 export source.**

### Epoch Timestamps
| Source | UTC Epoch (ms) | ISO |
|--------|----------------|-----|
| FlySight GPS start | 1746259458500 | 2025-05-03T08:04:18.500Z |
| INSV recording start | 1746259917000 | 2025-05-03T08:11:57.000Z |
| INSV recording end | +435435ms | 2025-05-03T08:19:12.435Z |
| FlySight GPS end | 1746260347400 | 2025-05-03T08:19:07.400Z |

INSV starts **458.5s** after GPS start.

### Timing Math

The GPS viewer's "pipeline time" is seconds from FlySight GPS start epoch. To convert an INSV-relative trim point to pipeline time:

```
gps_pipeline_time_s = (insv_creation_epoch_ms + insv_trim_ms - gps_start_epoch_ms) / 1000
```

For Clip2 (the MP4 export):
```
trim_start_pipeline = (1746259917000 + 308626 - 1746259458500) / 1000 = 767.126 s
trim_end_pipeline   = (1746259917000 + 319654 - 1746259458500) / 1000 = 778.154 s
```

### Playwright Capture Parameters
```
startTime=767.126
endTime=778.154
frameRate=60
totalFrames=662
```

### All Schemes → GPS Pipeline Time
| Scheme | Pipeline Start (s) | Pipeline End (s) | Duration (s) |
|--------|-------------------|-----------------|-------------|
| tt4dl | 756.8 | 822.1 | 65.2 |
| Clip1 | 756.8 | 831.9 | 75.1 |
| Clip1_copy | 783.1 | 831.9 | 48.9 |
| **Clip2** | **767.1** | **778.2** | **11.0** |
| backup | 461.5 | 890.9 | 429.4 |

## Automation Pipeline Plan

### Overview

The goal is a one-command pipeline: given an edit folder containing INSV, MP4, FlySight CSV, and gyroflow data, automatically compute the sync, capture overlay PNGs, and prepare a Blender VSE project with video + overlays aligned.

### Step 1: Sync Calculation (`tools/calc-timing.js`) ✅ IMPLEMENTED

**Usage**: `node tools/calc-timing.js <edit-folder> [--scheme <name>] [--json]`

Auto-discovers all inputs from the edit folder:
1. Find `.insv` file → scan top-level MP4 atoms (handles 64-bit `mdat`) → extract `creation_time` from `moov/mvhd`
2. Find `TRACK.CSV` → parse first `$GNSS` record for GPS start epoch
3. Find `.insprj` project file by searching `C:\Users\hartm\Documents\Insta360\Studio\Project\**\{insv_filename}.insprj`
4. Parse the default scheme (or `--scheme <name>`) → get `trim_start`, `trim_end`, keyframes in transition order
5. Calculate: `pipeline_start = (insv_epoch + trim_start - gps_epoch) / 1000`
6. Calculate: `pipeline_end = (insv_epoch + trim_end - gps_epoch) / 1000`
7. Convert each keyframe time to pipeline time and clip-relative time
8. With `--json`, write `sync-result.json` to edit folder:
   ```json
   {
     "insv_file": "VID_20250503_161157_00_016.insv",
     "scheme": "Clip2",
     "aspect_ratio": "4:3",
     "insv_creation_epoch_ms": 1746259917000,
     "insv_duration_ms": 435435,
     "gps_start_epoch_ms": 1746259458500,
     "gps_end_epoch_ms": 1746260347400,
     "trim_start_insv_ms": 308626,
     "trim_end_insv_ms": 319654,
     "pipeline_start_s": 767.126,
     "pipeline_end_s": 778.154,
     "frame_rate": 60,
     "total_frames": 662,
     "keyframes": [
       { "id": "point1", "insv_time_ms": 309482, "clip_time_s": 0.856,
         "pipeline_time_s": 767.982, "pan": 2.682, "tilt": -0.012,
         "roll": 0, "fov": 1.208, "distance": 0.855 },
       ...
     ],
     "transition_order": ["point1-point2", "point2-point0", ...]
   }
   ```

**Fallback** (no `.insprj`): Use the existing `video-sync.ts` cross-correlation approach with gyroflow CSV to estimate the offset. The MP4 duration gives the clip length; the offset positions it in the GPS timeline.

### Step 2: Playwright PNG Capture

Use existing capture infrastructure with the computed parameters:
```
gps.html?track=TRACK.CSV&startTime=767.126&endTime=778.154&frameRate=60&totalFrames=662
```

The capture handler already supports `startTime`, `endTime`, `frameRate`, `totalFrames` as URL params. No code changes needed for basic capture. For session state (overlays, keyframes, solver settings), pass full URL with `capture-session.ts` params.

### Step 3: Enhanced Blender VSE Import (`blender-vse-import.py`)

Extend the existing script to:
1. Import the MP4 video on **Channel 1** (currently reserved)
2. Import 4 PNG overlay sequences on Channels 2-5 (existing behavior)
3. The MP4 and PNGs are already synced (both cover the same time range) — just align frame 1 of each
4. Optionally import keyframe data from `.insprj` as Blender markers or camera keyframes

### Step 4: GPS Viewer UI — Insta360 Sync Panel

New sidebar section below the existing Head Position panel. Reads `sync-result.json` (output of `calc-timing.js --json`) and provides two actions:

#### Button 1: "Set Capture Range"
Sets `captureStart` and `captureEnd` in the existing `KeyframeSet` from the sync result's `pipeline_start_s` / `pipeline_end_s`. This defines the Playwright capture window without touching camera keyframes.

- Writes to existing `kfEditor.captureStart` / `kfEditor.captureEnd`
- Timeline immediately shows the capture range markers
- Ready for Playwright capture with no further configuration

#### Button 2: "Import Keyframes"
Creates GPS viewer `CameraKeyframe` entries from Insta360 keyframe timing. Each Insta360 keyframe's `pipeline_time_s` becomes the `t` value in a new `CameraKeyframe`.

**Keyframe mapping challenge**: Insta360 keyframes describe 360° camera orientation (`pan`, `tilt`, `roll`, `fov`, `distance` in equirectangular space), while GPS viewer keyframes describe Three.js orbit camera state (`position: [x,y,z]`, `zoom`). These are fundamentally different coordinate systems:

| Insta360 `.insprj` | GPS Viewer `CameraKeyframe` |
|---------------------|-----------------------------|
| `pan` (rad, yaw in equirect) | `position` (orbit XYZ in scene coords) |
| `tilt` (rad, pitch in equirect) | `position` (orbit elevation) |
| `fov` (multiplier) | `zoom` (PerspectiveCamera.zoom) |
| `distance` (0-1 range) | orbit radius |
| `roll` (rad) | not supported |

**Phase 1 — Timing only**: Import just the `pipeline_time_s` values as keyframe timestamps with the current camera position/zoom at each point. This gives correct timing markers on the timeline that can be manually adjusted in the GPS viewer editor. This is immediately useful for aligning overlay capture ranges to Insta360 edit decisions.

**Phase 2 — Camera mapping**: Map Insta360 pan/tilt/fov/distance to Three.js orbit controls. The 3JS orbit camera uses spherical coordinates (`theta`, `phi`, `radius`) which may have a reasonable mapping from Insta360's `pan`/`tilt`/`distance`. The head position system's pan/tilt interpretation (already in `camera-sensor.ts`) may provide a reference for coordinate conversion.

**Phase 3 — Round-trip editing**: After import, keyframes can be fine-tuned in the GPS viewer's existing keyframe editor (add/delete/reposition) and saved back via the existing JSON save/load system. The `KeyframeSet` JSON format already supports everything needed.

#### Data Flow
```
calc-timing.js --json  →  sync-result.json  →  GPS viewer sidebar
                                                  ├── Set Capture Range → kfEditor.captureStart/End
                                                  └── Import Keyframes  → kfEditor.addKeyframe()
                                                                          ↓
                                                                  keyframes.json (save)
                                                                          ↓
                                                              Playwright capture URL params
```

The sync-result.json acts as a one-way import — it is never modified by the GPS viewer. All downstream edits are stored in the existing `KeyframeSet` JSON.

#### Follow-on Enhancements
- **Scheme selector**: Dropdown to pick among schemes in the project file (re-run calc-timing with `--scheme`)
- **Timeline visualization**: Show Insta360 keyframe positions as distinct markers on the scrubber
- **Diff view**: Compare Insta360 keyframe timing with GPS viewer keyframe timing
- **Auto-capture**: One-click to load sync → set range → run Playwright capture

#### Note on Head Position Sync
The camera head position system (gyroflow CSV → `camera-sensor.ts`) is a **separate project** with its own sync challenges (two different data sources, different coordinate frames). It shares some infrastructure (the gyroflow CSV, the INSV timing) but has independent UI and is not part of this pipeline.

### Edit Folder Convention

Standardized layout for each flight:
```
edit/{date}/{session}/
├── VID_*.insv              (raw 360° recording)
├── VID_*(1).mp4            (exported trim from Insta360 Studio)
├── LRV_*.lrv               (low-res preview, same timing as INSV)
├── TRACK.CSV               (FlySight 2 GPS, $GNSS records)
├── SENSOR.CSV              (FlySight 2 barometer/IMU)
├── EVENT.CSV               (FlySight 2 events)
├── RAW.UBX                 (FlySight 2 raw GNSS)
├── gyroflowsensordata.csv  (Gyroflow-exported camera IMU)
├── sync-result.json        (calc-timing.js output: timing + keyframes)
├── keyframes.json          (GPS viewer KeyframeSet — camera positions + capture range)
├── polar-body/             (body-frame overlay PNGs)
├── polar-inertial/         (inertial-frame overlay PNGs)
├── polar-moment/           (moment overlay PNGs)
└── polar-speed/            (speed overlay PNGs)
```

## Gyroflow CSV Details

The gyroflow sensor CSV (exported from Gyroflow after loading the INSV) has:
- **13052 frames** spanning 435.5s (matches INSV duration)
- Columns: `frame, timestamp_ms, org_acc_{x,y,z}, org_pitch, org_yaw, org_roll, org_gyro_{x,y,z}, org_quat_{w,x,y,z}, focus_distance, stab_pitch, stab_yaw, stab_roll, stab_quat_{w,x,y,z}, focal_length, fov_scale, minimal_fov_scale`
- `timestamp_ms` starts at -169.963ms (pre-first-frame padding) and ends at 435513.626ms
- `timestamp_ms` is relative to INSV start — so `timestamp_ms + insv_creation_epoch = absolute UTC epoch`
- The `org_*` values are original (unstabilized) orientation; `stab_*` are Gyroflow-stabilized

This data is used by `video-sync.ts` for cross-correlation when `.insprj` is not available.

## Verified Data (2025-07-29 Squaw)
- Camera: Insta360 X5
- Camera files: 2 clips (091620 and 091919 start times)
- GPS: FlySight 2 (hartman.csv, 20 Hz)
- Fused sensor: SENSOR_fused_fusion.csv
- Resolution: 10752×5376 (per lens), native dual-fisheye
- Container: MP4/avc1 with `inst` atom
- inst atom sizes: 11.8 MB (clip 033), 15.8 MB (clip 034)
- Magic phrase confirmed: `8db42d694ccc418790edff439fe026bf`

## Verified Data (2025-05-03 Dashanbao)
- Camera: Insta360 X5
- Camera file: VID_20250503_161157_00_016.insv (4000×3000, 30fps, 435.4s)
- Exported: VID_20250503_161157_00_016(1).mp4 (4000×3000, 30fps, 11.044s, scheme "Clip2")
- GPS: FlySight 2 TRACK.CSV (20 Hz, 888.9s, 17731 GNSS records)
- Gyroflow: gyroflowsensordata.csv (30fps, 13052 frames)
- inst atom: 23.1 MB (encrypted, magic confirmed)
- insprj: 5 schemes, 51 keyframes, Clip2 = default = MP4 export source
- Timing verified: Clip2 trim → GPS pipeline → Playwright params all consistent

## Tools (`tools/`)

### `tools/calc-timing.js` — Primary sync tool ✅
Complete Insta360 ↔ FlySight sync calculator. Auto-discovers INSV, TRACK.CSV, and `.insprj` from an edit folder. Outputs all schemes with trim ranges and pipeline times, selected scheme's keyframes in transition order with both clip-relative and pipeline times. With `--json`, writes `sync-result.json` for GPS viewer consumption.

**Usage**: `node tools/calc-timing.js <edit-folder> [--scheme <name>] [--json]`

### `tools/probe-mp4.js` — Research/debug tool
Binary MP4/INSV/LRV atom parser. Extracts `moov/mvhd` creation_time, timescale, duration, track info, `udta` content, and `inst` atom size. Used to verify that exported MP4s lack trim offset data.

### `tools/parse-insprj.js` — Research/debug tool
Standalone `.insprj` XML parser. Extracts all schemes with trim ranges and all keyframes. Superseded by the `.insprj` parsing built into `calc-timing.js`, but useful for exploring project files independently.

## Architecture Notes

### Maintainability
The Insta360 Studio `.insprj` format is undocumented and may change between Studio versions. The current parser uses regex-based XML extraction rather than a full XML parser, which is sufficient for the known schema but should be monitored:

- **Known schema version**: Insta360 Studio 5.9.4, project version 2.0.0
- **Key assumptions**: `<scheme>` contains `<preference>` with trim data, `<timeline><recording><keyframes>` with keyframe data, `<transitions>` with playback order
- **Fragile points**: Attribute naming, nesting depth, new keyframe types (e.g. deep track, head tracking)
- **Mitigation**: `calc-timing.js` logs all discovered data and fails loudly if expected fields are missing

### Coordinate System Mapping (future work)
The Insta360 keyframe parameters (pan, tilt, roll, fov, distance) describe camera orientation in 360° equirectangular space. Mapping these to Three.js OrbitControls (spherical position + zoom) requires understanding:
- Insta360 `pan` → azimuthal angle (but reference frame origin differs from Three.js scene)
- Insta360 `tilt` → polar angle / elevation
- Insta360 `fov` → multiplier on base FOV (maps to `PerspectiveCamera.zoom`)
- Insta360 `distance` → 0-1 range, may map to orbit radius or post-process zoom
- Insta360 `view_mode` → projection type (13=normal?, 10=tiny planet?, 1=wide?, 2=?). Affects how pan/tilt are interpreted

This mapping is deferred to Phase 2. Phase 1 imports timing only.
