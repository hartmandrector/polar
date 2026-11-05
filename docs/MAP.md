# Polar Visualizer — Doc Map

> Obsidian entry point. Start here or at [[README]].  
> All links point to existing files — nothing here is duplicated or modified.

---

## 🚀 Start Here

- [[README]] — Project overview, quick start, full parameter reference
- [[AGENTS]] — Agent instructions, build commands, current phase status
- [[NEW-CONVERSATION]] — Session bootstrap / AI context doc

---

## 🧠 Core Theory

The two mathematical foundations everything else is built on:

- [[docs/aero-model-overview]] — Kirchhoff blending: attached vs. flat-plate aerodynamics
- [[docs/KIRCHHOFF]] — Full separation function specification
- [[docs/frames-overview]] — Five coordinate frames, transforms, Coriolis/gyroscopic terms
- [[docs/FRAMES]] — Full reference frames specification
- [[docs/CONTINUOUS-POLAR]] — Continuous polar architecture, segment math, interfaces
- [[docs/POLAR-VISUALIZER]] — Visualizer architecture, rendering pipeline, coordinate systems

---

## ✈️ Aerodynamic Model

- [[docs/aero-model-overview]] — Overview
- [[docs/KIRCHHOFF]] — Separation function
- [[docs/UNFINISHED-AERO]] — Known gaps and future work
- [[docs/WAKE-DOWNWASH]] — Wake and downwash modeling
- [[docs/3DATAERO]] — 3D aero extensions
- [[docs/PARAGLIDER-ROLL]] — Roll model for paraglider/canopy

---

## 🪂 Wingsuit Segments (7-segment, current)

- [[docs/CENTER-SEGMENT-SPLIT]] ⭐ — **Current architecture**: torso/leg split, hipCamber, legBend, pitch/roll/yaw (Phases A–P)
- [[docs/WINGSUIT-SEGMENTS]] — Legacy 6-segment phase notes (superseded)

---

## 🪂 Canopy / Paraglider

- [[docs/sim/CANOPY-CONTROLS]] — Canopy brake and riser controls
- [[docs/CANOPY-SIZE-MEASUREMENT]] — Physical measurement methodology
- [[docs/LINE-TENSION-MODEL]] — Line tension physics
- [[docs/PARAGLIDER-ROLL]] — Roll dynamics

---

## 🎮 Real-Time Simulation

- [[docs/sim/sim-overview]] ⭐ — 6DOF simulation overview
- [[docs/sim/STATUS]] — Current sim status and known issues
- [[docs/sim/PHASE-ARCHITECTURE]] — Phase system design
- [[docs/sim/STABILITY-ANALYSIS]] — Stability analysis framework
- [[docs/sim/STABILITY-QUICKREF]] — Quick reference for stability checks
- [[docs/SIMULATION]] — General simulation architecture
- [[docs/CONTROL-SOLVER]] — GPS control inversion: wingsuit/canopy solvers, gravity correction

### Gamepad / Input
- [[docs/sim/GAMEPAD]] — Xbox gamepad mapping
- [[docs/KEYBOARD-GAMEPAD-PLAN]] — Keyboard + gamepad control plan

### Deployment Sequence
- [[docs/sim/DEPLOY-WINGSUIT]] — Wingsuit-to-canopy deployment flow
- [[docs/sim/DEPLOYMENT-FRAMES]] — Reference frames during deployment
- [[docs/sim/DEPLOYMENT-MECHANICS]] — Physical mechanics
- [[docs/sim/DEPLOYMENT-MODULE]] — Code module architecture
- [[docs/DEPLOYMENT-ESTIMATION]] — Timing estimation

### Bridle System
- [[docs/sim/BRIDLE-REFACTOR]] — Bridle refactor plan
- [[docs/sim/BRIDLE-SEGMENTATION]] — Bridle segment model
- [[docs/sim/PILOT-COUPLING]] — Pilot-canopy coupling physics
- [[docs/sim/WINGSUIT-BASE-FLOW]] — Wingsuit BASE jump flow

### Constraints
- [[docs/sim/CONSTRAINT-MODES]] — Constraint mode system

---

## 📡 GPS Flight Viewer

- [[docs/GPS-VIEWER]] ⭐ — GPS viewer architecture, data pipeline, dual-scene replay
- [[docs/GPS-DUAL-SCENE]] — Dual-scene rendering approach
- [[docs/GPS-PROCESSING-PIPELINE]] — Data processing pipeline
- [[docs/GPS-STABILITY-SCHEMA]] — Stability schema for GPS data
- [[docs/FILTER-ARCHITECTURE]] — Kalman filter / signal processing architecture
- [[docs/INSTA360-DATA-SYNC]] — Insta360 camera sync pipeline
- [[docs/CAMERA-HEAD-POSITION]] — Head position / sensor fusion
- [[docs/HEAD-POSITION]] — Head position model

---

## 🏗️ Vehicle & Reference System

- [[docs/reference/VEHICLE-REFACTOR]] ⭐ — Vehicle decoupling architecture (Phases A–D)
- [[docs/reference/VEHICLE-REFACTOR-IMPLEMENTATION]] — Implementation details
- [[docs/REFERENCE-LENGTH]] — Per-vehicle aero vs mass reference lengths
- [[REFERENCE-LENGTH]] — (root copy)
- [[docs/SCALING-SLIDERS]] — Pilot height slider, pilotSizeCompensation
- [[docs/VEHICLE-SCALING-PLAN]] — Scaling plan
- [[docs/PIVOT-CONSOLIDATION]] — Pivot point consolidation
- [[docs/MODEL-GEOMETRY]] — Model geometry definitions

---

## 🖥️ Rendering & 3D

- [[docs/CM-ROTATION-VISUALIZATIONS]] — Pitching moment rotation visualizations
- [[docs/WIREFRAME-SUMMARY]] — Canopy cell wireframe rendering
- [[docs/IDEA-3JS-TRANSFORM]] — Three.js transform ideas
- [[docs/PERFORMANCE]] — Rendering performance

---

## 📸 Capture & Output

- [[docs/OUTPUT]] — Output system
- [[docs/reference/OUTPUT-REFACTOR-COMPATIBILITY]] — Output refactor compatibility
- [[docs/PNG-CAPTURE]] — PNG capture pipeline
- [[docs/SIM-CAPTURE-GUIDE]] — Sim capture workflow
- [[docs/CAPTURE-GUIDE]] — General capture guide

---

## 🔧 Integration & Setup

- [[docs/CLOUDBASE-INTEGRATION]] — CloudBASE integration
- [[docs/OPENCLAW-SETUP]] — OpenClaw setup and workflow
- [[docs/BLENDER-MCP-SETUP]] — Blender MCP setup
- [[docs/USER-MY-DATA]] — Three-tier guide: integrating custom vehicle data
- [[docs/user-data-beginner]] — Beginner integration guide
- [[docs/user-data-intermediate]] — Intermediate integration guide
- [[docs/user-data-advanced]] — Advanced integration guide

---

## 📐 Subsystem Context Docs

Short summaries of each subsystem for AI/agent context loading:

- [[docs/contexts/README]] — Index
- [[docs/contexts/physics-engine]] — Physics engine
- [[docs/contexts/wingsuit-aero]] — Wingsuit aerodynamics
- [[docs/contexts/canopy-system]] — Canopy system
- [[docs/contexts/charts]] — Chart system
- [[docs/contexts/visualization]] — Visualization
- [[docs/contexts/model-registry]] — Model registry
- [[docs/contexts/export-system]] — Export system

---

## 🗒️ Session Memory

- [[MEMORY]] — Persistent facts, identity, protocols
- [[NEW-CONVERSATION]] — Session bootstrap doc
- [[memory/meetings/README]] — Meeting notes index
- [[memory/wingsuit-sim-companies]] — Industry context

---

## 📋 Reference Files

- [[SOUL]] — Agent persona and engineering standards
- [[USER]] — About Hartman
- [[IDENTITY]] — Agent identity
- [[TOOLS]] — Build tools, file locations, conventions
- [[state/README]] — State system

---

## 🗂️ CFD References

- [[docs/references/README]] — References index
- [[docs/references/cfd/README]] — CFD reference notes
- [[docs/references/cfd/NOTES-PRIVATE]] — Private CFD notes

---

*This file is read-only from the project's perspective — it links to everything but is linked from nothing. Obsidian graph will show it as a hub node.*
