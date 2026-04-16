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

### Available Sync Points
1. **Push-off at exit** — visible in both GPS acceleration and camera gyro/accel spike
2. **Pilot chute toss** — very accurate with current deploy detection system
3. **Turns/maneuvers** — correlation of gyro rates with GPS-derived body rates
4. **Camera file timestamp** — embedded in filename (`HHMMSS`) and metadata
5. **FlySight GPS epoch** — absolute UTC timestamps

### Sync Algorithm (proposed)
1. Extract camera IMU (gyro/accel) from .insv via Gyroflow or SDK
2. Extract FlySight GPS timeline with absolute epochs
3. Cross-correlate:
   - Camera accel magnitude vs GPS-derived acceleration magnitude
   - Camera gyro rates vs GPS-derived body rates (p, q, r)
4. Find peak correlation → time offset
5. Refine with known events (push-off, PC toss)

### Challenges
- Camera timestamp is local time, GPS is UTC — need timezone offset
- Camera may start recording minutes before jump — large offset
- Trimming in Insta360 Studio changes timeline origin
- Camera IMU rate (~200-400 Hz) vs GPS rate (5-20 Hz) — need resampling
- Coordinate frame differences between camera IMU and NED

## Insta360 Studio Integration

### What Insta360 Studio Supports
- **GPX import** via Stats dropdown → Local Data Import
- This overlays GPS stats on the video timeline
- Keyframe editing for camera orientation/zoom within 360° sphere
- Project files (`.insp` or project format) — need to investigate if keyframes are exportable

### What We Need to Investigate
1. Can Insta360 Studio project files be parsed for keyframe data?
2. What format does it use internally for camera orientation keyframes?
3. Can we generate GPX from FlySight data that Insta360 Studio accepts?
4. Is there a CLI or API for Insta360 Studio batch processing?

## Next Steps
1. **Install Gyroflow** and test IMU extraction from the 07-29-25 .insv files
2. **Build FlySight → GPX converter** for Insta360 Studio stats import
3. **Build cross-correlation tool** for automated time offset calculation
4. **Investigate Insta360 Studio project format** for keyframe import/export
5. **Integrate with GPS viewer** — add camera timeline + offset controls
6. **Blender automation** — script the overlay workflow with synced data

## Verified Data (2025-07-29 Squaw)
- Camera: Insta360 X5
- Camera files: 2 clips (091620 and 091919 start times)
- GPS: FlySight 2 (hartman.csv, 20 Hz)
- Fused sensor: SENSOR_fused_fusion.csv
- Resolution: 10752×5376 (per lens), native dual-fisheye
- Container: MP4/avc1 with `inst` atom
- inst atom sizes: 11.8 MB (clip 033), 15.8 MB (clip 034)
- Magic phrase confirmed: `8db42d694ccc418790edff439fe026bf`
