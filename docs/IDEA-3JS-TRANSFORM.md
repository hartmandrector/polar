# IDEA — Three.js Transform Bridge

> Concept for cleanly bridging GLB mesh measurements and the aerodynamic body frame (NED). Not a plan — just capturing the idea for future reference.

---

## The Problem

GLB models arrive in their own coordinate system with arbitrary scale. Three.js applies a chain of parent-child transforms (scale, rotation, position) to place them in the scene. Our physics uses NED body frame with normalized positions. These are two independent coordinate worlds.

Currently we bridge them with manually measured scale factors (`glbToMeters`, `glbToNED`, `parentScale`, `childScale`, `pilotSizeCompensation`). This works but creates complexity — every new scaling feature (canopy size, pilot height, pivot) has to thread through both systems carefully.

## The Idea

Three.js `Object3D` already provides `localToWorld()` and `worldToLocal()` transforms at any node in the scene graph. In theory, you could:

1. Query a mesh vertex or named point in GLB-local coords
2. Let Three.js apply the full parent-child transform chain
3. Read the world-space result
4. Convert world-space → NED body frame (one known rotation)

This would give exact positions for any point on any mesh, accounting for all current scaling and rotation, without manually tracking each factor.

## Why We Don't Do This

- Makes the simulation dependent on the Three.js scene graph — can't compute physics without a renderer
- Breaks the goal of a drop-in physics module (export, CloudBASE, Kalman filter)
- Duplicates work: we'd be re-deriving what we already know from physical measurements
- Swapping GLB models would silently change physics if transforms differ

## What We Do Instead

- Measure physical dimensions from GLB models once (model-registry.ts)
- Convert to NED-normalized positions at build time
- Physics operates entirely in NED body frame — no Three.js dependency
- Bridge factors (`parentScale`, `childScale`, etc.) exist only in the rendering layer
- Dynamic changes (deployment, pilot pitch) are handled in NED directly

## The Tradeoff

More manual bridging work when adding scaling features, but the physics stays self-contained and portable. The rendering layer is a visualization of the physics, not a participant in it.

## Body Frame Convention

Standard aerodynamic body frame (NED-aligned at zero attitude):
- **x_b** = forward (nose) — aligns with North
- **y_b** = right (starboard) — aligns with East
- **z_b** = down (belly) — aligns with Down

Vehicle is **belly-down** in both frames. No flip. Gravity = `[0, 0, +g]`.
