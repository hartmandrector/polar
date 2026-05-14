# Recipe: Canopy Capture

Capture clean canopy flight phases from GPS viewer.

## Setup for Canopy Steady Phase

**Track:** `05-02-2025-1`, slider ~5700

**URL:**
```
http://localhost:5173/gps?track=05-02-2025-1/TRACK.CSV&roll=blended&overlays=1&kf=1
```

**Steps:**
1. Scrub playback slider to ~5700 (canopy steady, +7s after line-stretch, Trust=Yes, canopy α=16°)
2. Set `Mode: Canopy`
3. Apply "Canopy top-down (no GLB)" camera preset
4. Hide GLB (checkbox in PNG Capture panel)
5. Hide left info column (DOM: find wrapper with "TRACK.CSV │ Format: …", set `display:none`)
6. `screenshot_page`

**What you're validating:**
- Canopy CM arcs arranged in planform layout
- Segment force vectors (if visible)
- Moment decomposition across all segments

## Why Top-Down + No GLB

- **Top-down:** Gives clear view of wing planform with CM arcs distributed across span
- **No GLB:** Canopy GLB can occlude arrow tails; wireframe shows aero geometry only
- **Body frame:** Rotation-invariant — same camera preset works across entire canopy phase

## Setup for Canopy Late Phase (High Rates)

**Track:** `05-02-2025-1`, slider ~6500

Same steps as "Steady," but scrub to higher slider value. Body rates are higher, moments shift more visibly.
