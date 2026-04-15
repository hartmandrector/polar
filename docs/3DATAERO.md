# 3DATAERO — 3D Athlete Tracking + Aerodynamic Reconstruction

## Project Proposal & Planning Document
**Draft v0.1 — April 2026**
**Authors:** Hartman Rector, Polar Claw 🐻‍❄️

---

## 1. Vision

Build an AI-powered platform that reconstructs the aerodynamics of human flight from body-mounted 360° video and GPS/IMU data. Where Intel's 3DAT system stops at kinematics (measuring body position), 3DATAERO closes the loop — correlating body pose to aerodynamic outcome using paired flight data that no one else has.

The end state: given a 360° video of a wingsuit flight, skydive, or speed flight, reconstruct the full aerodynamic picture — lift, drag, moments, control inputs — frame by frame.

---

## 2. The Unique Dataset

This project is possible because of a rare intersection of capabilities:

| Asset | Status | Notes |
|---|---|---|
| 6DOF aerodynamic segment model | ✅ Built | Polar Project — 6-segment wingsuit, canopy models |
| GPS/IMU flight pipeline | ✅ Built | FlySight 2 → pipeline → forces, rates, control solver |
| 360° body-mounted video | ✅ Collecting | Insta360 X5, 8K @ 30fps, helmet-mounted, every jump |
| Head-mounted IMU fusion | ✅ Built | FlySight fused sensor → quaternion alignment |
| Control inversion solver | ✅ Built | Recovers pilot inputs from trajectory |
| Pose estimation for flight | ❌ Not started | Core ML work — this project |
| Paired video ↔ GPS sync | 🟡 Partial | Camera has internal sensors; timing sync needed |

Every jump with both a 360° camera and a FlySight produces a paired training sample: video frames labeled with ground-truth aerodynamic state. This dataset grows with every jump.

---

## 3. Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐
│  360° Video     │     │  FlySight 2 GPS  │
│  (Insta360 X4)  │     │  + IMU + Fused   │
│  8K @ 30fps     │     │  20Hz            │
└────────┬────────┘     └────────┬─────────┘
         │                       │
    ┌────▼────┐            ┌─────▼──────┐
    │  Pose   │            │  Aero      │
    │  Est.   │            │  Pipeline  │
    │  Model  │            │  (Polar)   │
    └────┬────┘            └─────┬──────┘
         │                       │
         │    ┌──────────┐       │
         └───►│  PAIRED  │◄──────┘
              │  DATASET │
              └────┬─────┘
                   │
            ┌──────▼───────┐
            │  Pose → Aero │
            │  Mapping     │
            │  (Learned)   │
            └──────┬───────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
   Video-Only           Real-Time
   Reconstruction       Feedback
```

### Stage 1: Data Pipeline
- Extract frames from 360° video
- Extract internal sensor data from camera files (gyro, accel, timestamps)
- Time-sync video frames ↔ FlySight GPS/IMU data
- Run Polar Project aero pipeline → per-frame ground-truth labels

### Stage 2: Pose Estimation
- Train or fine-tune a pose estimation model for human flight
- Input: equirectangular or dual-fisheye video frames
- Output: 3D joint positions (skeleton) per frame
- Challenge: unusual silhouettes (wingsuit fabric, spread limbs, helmet-mounted perspective)

### Stage 3: Pose → Aero Mapping
- Learn the function: body_pose → aerodynamic_state
- Inputs: joint angles, limb extensions, body shape descriptors
- Outputs: CL, CD, moment coefficients, effective control inputs
- Training data: Stage 1 paired dataset
- Validates against (and eventually replaces) the hand-tuned segment model

### Stage 4: Applications
- **Video-only reconstruction** — any 360° flight video → estimated aerodynamics (no GPS required)
- **Real-time HUD** — on-device pose estimation → instant aero prediction → heads-up display
- **Training tool** — show pilots what body changes do to their flight, grounded in measured data
- **Community platform** — upload 360° footage, get aero analysis back

---

## 4. Scope & Phasing

### Phase 0: Foundation (we are here)
- [x] Polar Project aero pipeline
- [x] GPS viewer with force decomposition
- [x] Control inversion solver
- [x] Head sensor fusion + time alignment
- [x] 360° video collection on every jump
- [ ] Document camera file format + internal sensor extraction
- [ ] Establish video ↔ GPS time sync protocol

### Phase 1: Paired Dataset Construction
- Build tooling to batch-process jump folders (video + GPS + sensor)
- Automated time alignment (camera internal sensors → FlySight timeline)
- Frame extraction at pipeline sample rate (20Hz or configurable)
- Per-frame label generation from aero pipeline (α, CL, CD, roll, controls, etc.)
- Target: 50+ jumps paired, 100K+ labeled frames
- **Deliverable:** Labeled dataset ready for ML training

### Phase 2: Pose Estimation for Flight
- Evaluate existing models (MediaPipe, OpenPose, HRNet, ViTPose) on flight video
- Fine-tune or train on wingsuit/skydive body positions
- Handle equirectangular distortion (or process in dual-fisheye / cubemap)
- Handle helmet-mount perspective (body is always below/in-front of camera)
- Validate: does the skeleton track limb positions accurately through maneuvers?
- **Deliverable:** Pose estimation model that works on flight 360° video

### Phase 3: Learned Aero Mapping
- Feature engineering: joint angles → meaningful aero descriptors (arm sweep angle, leg spread, arch depth, head position)
- Train regression model: pose features → aero coefficients
- Cross-validate against Polar Project segment model predictions
- Quantify: how much of the aerodynamic variance does body pose explain?
- **Deliverable:** Pose → aero model with measured accuracy

### Phase 4: Applications & Platform
- Video-only reconstruction pipeline
- Real-time inference path (edge/mobile)
- Visualization + overlay rendering
- Community upload + analysis platform
- **Deliverable:** Usable product

---

## 5. Existing Infrastructure

### What We Have
- **Polar Project codebase** — TypeScript, Three.js, full aero pipeline, GPS viewer, segment models, control solver, Playwright automation
- **FlySight 2 ecosystem** — GPS + IMU hardware, firmware knowledge, sensor fusion handoff docs
- **Camera sensor extraction** — existing tooling for pulling gyro/accel/timing from Insta360 files
- **BASEline (baseline.ws)** — Brendan's platform, laser → phone → website pipeline. Kenny Daniels maintains it and has ML experience.
- **CloudBASE** — flight simulator with physics engine, could serve as synthetic data generator
- **Kalman filter project** — GPS state estimation, same reference frames and linear algebra

### Key People
- **Hartman** — domain expert, pilot, architect, data collector (every jump = training data)
- **Kenny Daniels** — BASEline developer, ML experience, has worked with video/sensor processing
- **Polar Claw** — engineering execution, pipeline architecture, math

---

## 6. What Video Adds (and What It Can't)

### What GPS gives us
- System-level aerodynamic coefficients (CL, CD, moments)
- Full trajectory and orientation
- Control inversion (what inputs produced this flight path)
- Works every jump, reliable, 20Hz

### What GPS can't resolve
- Left/right asymmetry (roll solver estimates, but can't see the body)
- Specific limb positions producing a given coefficient
- Which body changes are deliberate vs passive
- Edge cases: transitions, partial inputs, mixed maneuvers

### What video adds
- **Asymmetry detection** — see left arm vs right arm, leg spread differences
- **Body position documentation** — correlate specific poses with measured aero outcomes
- **Edge case coverage** — deployment body positions, exit postures, transitions where GPS pipeline assumptions break down
- **Training data labeling** — "this body shape produced these coefficients"

### What video can't do alone
- Many wingsuit inputs aren't visually perceptible — weight shifts, subtle muscle tension, pressure distribution against fabric. These have large aerodynamic effects but minimal visible body shape change.
- Helmet-mounted camera can't see the pilot's head/upper back directly
- A standalone pose → aero system will have real accuracy limits. **GPS pairing is essential, not optional.** The video improves the picture; it doesn't replace the physics pipeline.

### The complementary model
GPS provides the aerodynamic truth. Video provides the body context. Together they build a dataset that neither could produce alone — "this pose caused these forces." Over time, the learned mapping gets good enough to fill in details that GPS can't resolve, while GPS keeps the overall picture anchored to physics.

---

## 7. Equirectangular Processing

The 360° camera produces equirectangular frames (2:1 aspect ratio, full sphere). Pose estimation models expect rectilinear (flat) images.

**Approach: Virtual camera extraction**
- Given equirectangular frame, extract a rectilinear "virtual camera" view pointed in any direction
- Standard spherical → rectilinear projection, well-understood math
- Keep FOV ≤ ~110° to minimize distortion at edges
- Primary extraction: **downward-looking body view** (the pilot's body is below/in-front of the helmet camera)
- Secondary extractions: side views for arm/leg spread if needed
- Multiple virtual cameras from a single 360° frame = multiple pose estimation inputs with different perspectives

This is a preprocessing step before pose estimation — extract flat views, run MediaPipe/ViTPose/etc. on those.

**Alternative**: Train a pose model directly on equirectangular input. Harder but eliminates the reprojection step. Likely a Phase 2+ investigation.

---

## 8. MediaPipe as Standalone Tool

MediaPipe (Google's pose estimation framework) is useful as a **general-purpose tool** independent of 3DATAERO:
- Real-time pose estimation from any video
- Works on standard cameras, phone video, 360° with reprojection
- Body landmark tracking (33 keypoints), hand tracking, face mesh
- Could be used for coaching feedback, social media content, general analysis
- Low barrier to entry — runs on consumer hardware, good Python SDK

**Recommendation**: Set up MediaPipe as a separate utility project. Useful immediately for exploring pose estimation quality on flight video, and feeds into 3DATAERO Phase 2 as a baseline model to evaluate/fine-tune.

---

## 9. Technical Challenges & Risks

### High Risk
| Challenge | Details | Mitigation |
|---|---|---|
| **Pose estimation in flight gear** | Wingsuits obscure normal body landmarks; fabric between limbs creates ambiguous silhouettes; many inputs (weight shift, tension) aren't visually perceptible at all | Fine-tune on flight-specific data; accept that video captures *some* body state, not all; GPS provides the aero truth that video can't | 
| **360° distortion** | Equirectangular projection warps body proportions, especially near poles | Extract rectilinear virtual camera views (downward body view primary); or train directly on equirectangular with augmentation |
| **Time sync precision** | Frame-level sync between video and GPS is critical for label quality; camera clock vs FlySight clock | Camera internal sensors (gyro) provide correlated motion signal; cross-correlate with FlySight IMU for sub-frame alignment |
| **Camera file format** | Insta360 metadata/sensor streams are proprietary | Existing extraction tooling works; community reverse-engineering efforts; worst case use camera's exported sensor data |

### Medium Risk
| Challenge | Details | Mitigation |
|---|---|---|
| **Small dataset** | Each jump is ~60-90s of data; need many jumps for model generalization | Hartman jumps frequently; can recruit other pilots; synthetic data from CloudBASE; data augmentation |
| **Aero ground truth uncertainty** | GPS-derived aero labels have their own noise and model assumptions | Quantify label uncertainty; use ensemble approaches; the segment model is physics-based so errors are structured, not random |
| **Compute requirements** | 8K @ 30fps = ~200 MB/s raw; pose estimation on 8K frames is expensive | Downsample for pose estimation (4K or 2K sufficient for skeleton); process offline; cloud compute for training |
| **Generalization across suits/bodies** | Model trained on Hartman in a Corvid may not work for different pilot + suit | Collect data across suit types; include suit type as model input; recruit other pilots for diversity |

### Low Risk (but worth noting)
| Challenge | Details |
|---|---|
| **Helmet-mount blind spots** | Camera can't see the pilot's head/upper back directly — must infer from visible limbs |
| **Motion blur at 30fps** | Fast maneuvers (corkscrews) may blur at 30fps; 8K helps but isn't a full solve |
| **Edge deployment** | Real-time HUD requires mobile/edge inference — Phase 4 concern, not immediate |

---

## 7. What Makes This Different from 3DAT

| | Intel 3DAT | 3DATAERO |
|---|---|---|
| **Camera** | Fixed multi-camera arrays (venue-specific) | Body-mounted 360° (goes with the pilot) |
| **Environment** | Controlled venue (halfpipe, rink, track) | Open sky, cliffs, mountains |
| **Occlusion** | Multiple cameras mitigate occlusion | Single camera, no occlusion (full surround) |
| **Output** | Kinematics only (pose, speed, rotation) | Kinematics + aerodynamics (forces, coefficients, control inputs) |
| **Aero model** | None | 6DOF segment model + learned mapping |
| **Ground truth** | Timing sensors, judges | GPS trajectory + IMU + physics-based reconstruction |
| **Processing** | Cloud (AWS EKS), near real-time | Offline initially, real-time as goal |
| **Scale** | Thousands of athletes, standardized sports | Specialized for human flight (wingsuit, skydiving, speed flying, paragliding) |
| **Infrastructure cost** | $millions (venue cameras, cloud, partnerships) | Consumer hardware (Insta360 + FlySight ≈ $1K) |

The fundamental difference: 3DAT measures what the body *did*. 3DATAERO measures what the body did *and what that caused aerodynamically*.

---

## 8. Data Rate & Storage Considerations

**Per jump (rough estimates):**
- 360° video: 8K @ 30fps ≈ 200 MB/s raw, ~5-15 GB per jump (compressed .insv)
- FlySight GPS: 20Hz ≈ 50 KB per jump
- FlySight sensor (fused): 200Hz ≈ 500 KB per jump
- Extracted frames at 20Hz: ~2400 frames × ~5 MB (4K downsampled) ≈ 12 GB per jump
- Aero labels: ~50 KB per jump (JSON)

**For 50 jumps:** ~250 GB video, ~600 GB extracted frames, ~2.5 MB labels

Storage is manageable. The bottleneck is processing time for frame extraction and pose estimation, not storage.

---

## 9. Name Discussion

**3DATAERO** — "3D Athlete Tracking + Aerodynamic Reconstruction"
- Pros: nods to Intel 3DAT (recognizable in the sports tech space), adds the "aero" differentiation, concise
- Cons: could be confused with Intel's trademark; pronunciation isn't immediately obvious

**Alternatives to consider:**
- **AeroPose** — pose estimation meets aerodynamics (clean, simple)
- **FlightPose** — descriptive but generic
- **PolarVision** — ties to Polar Project brand
- **6DOF Vision** — technical, accurate
- **3DATAERO** still feels right — it says exactly what it is

---

## 10. Next Actions

1. **Document the camera sensor extraction pipeline** — what data comes out of Insta360 files, what format, what's the timing reference
2. **Build a time-sync proof of concept** — take one jump with both 360° video and FlySight, cross-correlate camera gyro with FlySight gyro to establish frame-level alignment
3. **Evaluate off-the-shelf pose estimation on flight video** — grab a few frames from existing 360° footage, run through MediaPipe/ViTPose, see how badly it fails on wingsuit silhouettes
4. **Talk to Kenny** — his ML experience + BASEline data pipeline knowledge is directly relevant
5. **Start collecting paired data deliberately** — every jump with both FlySight and 360° running, consistent mounting, flight card noting conditions

---

*This document is a living plan. Update as the project evolves.*
