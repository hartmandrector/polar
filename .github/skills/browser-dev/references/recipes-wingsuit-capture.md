# Recipe: Wingsuit Capture

Capture clean wingsuit flight phases from GPS viewer.

## Setup for Wingsuit Cruise Phase

**Track:** `05-02-2025-1`, slider ~5400

**URL:** 
```
http://localhost:5173/gps?track=05-02-2025-1/TRACK.CSV&roll=blended&overlays=1&kf=1
```

**Steps:**
1. Scrub playback slider to ~5400 (wingsuit cruise, 45 m/s airspeed, AOA ~6°)
2. Set `Mode: Wingsuit`
3. Apply "Wingsuit close-front" camera preset
4. Hide GLB (checkbox in PNG Capture panel) — shows segment wireframes
5. Hide left info column (DOM: find wrapper with "TRACK.CSV │ Format: …", set `display:none`)
6. `screenshot_page`

**What you're validating:**
- Segment force vectors alignment in body frame
- CM arcs relative to each segment
- Overall pitch/yaw/roll moments

## Setup for Wingsuit Far View (Moment Arcs)

Same track, same phase, different camera.

**Steps:**
1. Scrub to ~5400
2. Apply "Wingsuit rear-from-distance" camera preset
3. Hide GLB
4. `screenshot_page`

**What this shows:**
- Full moment-arc readability without crowding
- Better for documenting pitching/yawing behavior over a control sweep
