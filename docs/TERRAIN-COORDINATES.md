# Terrain Rendering Architecture — Coordinate Systems & Altitude

## Problem Statement

The terrain disappears/mispositions when simulation starts. Root cause: conflation of two separate coordinate systems:

1. **Physics/Aerodynamics Coordinate System** — NED, uses `z = -2000` as MSL reference for density calculations
2. **3D Visualization Coordinate System** — Three.js rendering, terrain should position relative to actual ground

These systems are currently merged in `FlightState.pos_z`, causing terrain to be positioned 2km away.

---

## Coordinate Systems

### 1. NED (North-East-Down) — Physics Frame

- **Origin**: Arbitrary point on Earth (typically runway/drop zone)
- **Units**: Meters
- **Convention**: x = North, y = East, z = Down (positive downward)
- **Simulation State**: `SimState` contains position in NED frame
- **Default Initialization**: `x=0, y=0, z=-2000` (2km above sea level)
- **Purpose**: Aerodynamic calculations (density, wind, etc.)
- **Key Property**: `z = -2000` is an MSL reference for density-altitude charts; NOT necessarily wingsuit altitude above ground

### 2. Three.js (Y-up Right-Handed) — Rendering Frame

- **Origin**: Camera center (model stays here)
- **Units**: Meters (scaled to match NED)
- **Convention**: X = right, Y = up, Z = forward
- **Model Position**: Always at origin (0, 0, 0) for orbit controls
- **Conversion from NED**: `nedToThreeJS(x, y, z) = (-y, -z, x)`
  - NED north (x) → Three.js +Z
  - NED east (y) → Three.js -X
  - NED down (z) → Three.js -Y

### 3. Orbit Controls (Camera-Centric)

- **Center**: Model position (which is at origin)
- **Rotation**: Controlled by mouse orbit
- **Terrain**: Should move relative to model in inertial frame

---

## The -2000m Z Offset Issue

### Where It Comes From

- **Source**: `flightStateToSimState()` in `sim-runner.ts`
- **Code**: `z: 0, y: 0, z: -2000` (hardcoded default)
- **Purpose**: Mean Sea Level reference for:
  - Density calculations (speed charts assume average case)
  - If `z = 0`, speeds would be unnaturally slow (wrong density at sea level)
  - Charts tuned for typical drop zone altitude (~2000m MSL)

### Why It's a Problem

`SimState.pos_z = -2000` does NOT represent actual ground altitude. It represents:
- A **reference frame for physics calculations**
- **Not** the actual altitude above terrain
- When transferred to `FlightState.pos_z` and used for terrain positioning, it places terrain 2km away

---

## Current State Flow

```
Initial Conditions (Reset Mode)
  ↓
flightStateToSimState()
  ↓
SimState { x: 0, y: 0, z: -2000, ... }  ← MSL reference for density
  ↓
Physics Loop (200 Hz)
  - Calculates forces using density at current z
  - Integrates position (x, y, z) in NED
  ↓
simStateToFlightState()
  - Reads SimState { pos_x, pos_y, pos_z }
  - Transfers to FlightState { pos_x, pos_y, pos_z }
  ↓
main.ts updateVisualization()
  - Calls updateTerrainPosition(pos_x, pos_y, pos_z)
  - Converts to Three.js: terrain at (pos_y, pos_z, -pos_x)
  ↓
✗ WRONG: Terrain positioned 2km away (because pos_z = -2000 at start)
```

---

## Solution Architecture

### Key Insight

**Separate these concerns:**

1. **Physics Coordinate** (`SimState.z`): Maintains MSL reference for aerodynamic calculations
2. **Ground Level**: Should be a **separate concept** (not tied to z-offset)
3. **Terrain Visual Position**: Computed from wingsuit altitude ABOVE ground, not absolute NED position

### Proposed Flow (Inertial Frame)

```
Reset Mode:
  - Wingsuit at origin in Three.js
  - Terrain loaded at origin
  - Terrain altitude = 0 (at wingsuit position)

Simulation Starts:
  - SimState integrated normally (z = -2000 + Δz as flight progresses)
  - Extract actual altitude AGL from SimState:
    * Current approach: z = -2000 + something (z-drift)
    * Need: Calculate as negative of altitude climbed/descended from start
    
Terrain Positioning (each frame):
  - Wingsuit altitude AGL = -(SimState.z - initialZ)
  - Terrain altitude = 0 (reference ground level)
  - Terrain height offset = -(wingsuit_altitude_AGL)
  
  - In Three.js (negated for opposite movement):
    terrain.position.y = -(wingsuit_altitude_AGL)
    terrain.position.x = SimState.pos_y
    terrain.position.z = -SimState.pos_x
```

### Pseudocode

```typescript
// In SimRunner or context
let initialSimZ = -2000  // captured at sim start

// Each frame in updateVisualization():
const wingsuit_altitude_AGL = -(state.pos_z - initialSimZ)  // how far descended
const terrain_height_offset = -wingsuit_altitude_AGL  // opposite direction

if (isSimRunning() && state.frameMode === 'inertial') {
  updateTerrainPosition(
    state.pos_x,         // north component
    state.pos_y,         // east component
    wingsuit_altitude_AGL // altitude above ground (NOT pos_z!)
  )
}

// Inside updateTerrainPosition():
export function updateTerrainPosition(pos_x: number, pos_y: number, altitudeAGL: number): void {
  if (!currentTerrainModel) return
  
  // Convert NED to Three.js, but use AGL altitude for Y (up/down)
  currentTerrainModel.position.set(
    pos_y,               // East → +X
    -altitudeAGL,        // AGL down → -Y (terrain moves down as wingsuit climbs)
    -pos_x               // North → -Z
  )
}
```

---

## Implementation Steps (Inertial Frame Focus)

### Phase 1: Capture Initial Z
- Modify `SimRunner.startSim()` to capture `initialSimZ = sim.z` when simulation starts
- Store in a module-level variable accessible to terrain positioning code

### Phase 2: Update Terrain Position Function
- Change signature: `updateTerrainPosition(pos_x, pos_y, pos_z)` → `updateTerrainPosition(pos_x, pos_y, altitudeAGL)`
- Compute AGL inside the function or pass pre-computed value

### Phase 3: Update Render Loop
- In `main.ts updateVisualization()`:
  ```typescript
  if (isSimRunning()) {
    const altitudeAGL = -(state.pos_z - INITIAL_SIM_Z)
    updateTerrainPosition(state.pos_x, state.pos_y, altitudeAGL)
  }
  ```

### Phase 4: Verify
- Terrain should stay visible when sim starts ✓
- Terrain should move backward as wingsuit flies north ✓
- Terrain should move down as wingsuit descends ✓
- Orbit controls should remain fully functional ✓

---

## Body Frame (Future)

Once inertial frame works:
- Body frame: terrain at origin (no movement) or rotates with wingsuit orientation
- Implementation: Set `altitudeAGL = 0` in body frame mode

---

## Questions for Review

1. Should `initialSimZ` be captured in `SimRunner` or at a higher level?
2. Should we modify `FlightState` to include `altitudeAGL` field separately?
3. Should density calculations continue using the -2000m offset, or should we reconsider that architecture?
4. Do we need to track actual ground elevation, or is terrain always at z=0 visual reference?

---

## Files to Modify

1. **sim-runner.ts**: Capture and export initial Z value
2. **sim-ui.ts**: Update `updateTerrainPosition()` signature and logic
3. **main.ts**: Pass AGL altitude instead of pos_z to terrain positioning

