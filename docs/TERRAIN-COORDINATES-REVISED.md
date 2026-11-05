# Terrain Rendering Architecture — Coordinate Systems & Altitude (REVISED)

## Problem Statement

The terrain disappears when simulation starts. Root cause: misunderstanding of coordinate system origin.

**Clarification**: SimState coordinates have their **origin at the exit point** (start of simulation), NOT at sea level.

---

## Coordinate Systems (CORRECTED)

### 1. NED (North-East-Down) — Physics Frame

- **Origin**: **At the exit point** (where wingsuit starts at t=0)
- **Position at t=0**: `x=0, y=0, z=0` (exit point origin, NOT -2000)
- **Units**: Meters
- **Convention**: x = North, y = East, z = Down (positive downward)
- **Flight Dynamics**: As wingsuit flies:
  - z increases (descends from exit point)
  - x/y change based on north/east movement
- **Density Altitude Reference** (SEPARATE from position):
  - Exit point altitude MSL = user-configurable slider (default 2000m)
  - Used for aerodynamic calculations only
  - Does NOT affect SimState.z positioning
  - Controlled independently in reset mode UI

### 2. Three.js (Y-up Right-Handed) — Rendering Frame

- **Origin**: Camera center (model stays here)
- **Units**: Meters (scaled to match NED)
- **Convention**: X = right, Y = up, Z = forward
- **Model Position**: Always at origin (0, 0, 0) for orbit controls
- **Conversion from NED**: `nedToThreeJS(x, y, z) = (-y, -z, x)`
  - NED north (x) → Three.js +Z
  - NED east (y) → Three.js -X
  - NED down (z) → Three.js -Y

### 3. Terrain Visual Position

- **Starts at origin** with the model (at exit point)
- **Tracks descent**: As wingsuit descends (SimState.z increases), terrain moves down visually
- **Motion Formula**: `terrain.position.y = -SimState.z` (descent distance with opposite sign)
- **Result**: Terrain moves opposite to wingsuit's flight trajectory

---

## Key Concepts

### Exit Altitude MSL (User Slider)

```
Purpose: Aerodynamic calculations (air density)
Controlled by: "Exit Altitude MSL" slider in reset mode
Default: 2000 m (MSL)
Range: 0–5000 m
Effect: Changes calculated air density for forces
Does NOT affect: Terrain positioning or SimState.z origin
```

### SimState Position (Flight Coordinates)

```
Origin: Exit point (t=0)

SimState {
  x: 0,      // north from exit
  y: 0,      // east from exit  
  z: 0,      // down from exit (positive = descended)
}

During flight:
  x: north displacement from exit point
  y: east displacement from exit point
  z: descent distance from exit point
```

### Altitude Above Ground Level (AGL)

```
AGL = -SimState.z

At start (t=0): 
  SimState.z = 0
  AGL = 0 (at exit point / ground level)
  
After 10s descent: 
  SimState.z = +100m (100m down from exit)
  AGL = -100m (100m below exit point)
  ← Correct; wingsuit has descended 100m
```

---

## Current State Flow (INCORRECT)

```
❌ OLD (broken):

flightStateToSimState():
  → z: -2000  (hardcoded MSL reference into position)
  
SimState integrated:
  → z: -2000 + Δz  (starts 2km up, wrong origin)
  
Terrain positioned at pos_z:
  → (pos_y, pos_z, -pos_x) = terrain 2km away
  
✗ Result: Terrain invisible on sim start
```

---

## Correct State Flow (PROPOSED)

```
✅ NEW (correct):

Reset Mode Setup:
  - User selects "Exit Altitude MSL" slider = 2000m
  - Stored in UI state (NOT SimState position)
  
flightStateToSimState():
  → x: 0, y: 0, z: 0  (exit point origin, correct!)
  → Pass exitAltitudeMSL separately to aerodynamic calculations
  
Physics loop (200 Hz):
  - Uses Exit Altitude MSL (2000m) for density calculations
  - Integrates position from origin (0, 0, 0)
  - z increases as wingsuit descends
  
Terrain positioning (each frame, inertial mode):
  terrain.position = nedToThreeJS coordinate:
    x: pos_y               (east from exit)
    y: -pos_z             (negated descent distance)
    z: -pos_x             (north from exit)
  
✓ Result:
  - Terrain starts at origin (with model at exit)
  - Terrain moves down visually as wingsuit descends
  - Terrain moves north/east as wingsuit moves laterally
  - Orbit controls fully functional
  - Density calculations use correct MSL altitude
```

---

## Implementation Steps

### Phase 1: Add Exit Altitude MSL Slider to Reset Mode

**File**: `src/sim/sim-ui.ts` - `createPanel()` → `exitSetupPanel`

Add to Exit Setup panel HTML:
```html
<div>
  <label style="display: block; color: #9cf; font-weight: bold; margin-bottom: 4px;">Exit Altitude MSL (m)</label>
  <input type="range" id="exit-altitude-msl" style="width: 100%; ..."
         min="0" max="5000" value="2000" step="100">
  <div id="exit-altitude-display" style="color: #aaa; font-size: 11px; text-align: center;">2000 m</div>
</div>
```

**Module-level State Variable**:
```typescript
let exitAltitudeMSL = 2000  // meters above sea level (default)
```

**Slider Wiring in setupSimUI()**:
```typescript
const altSlider = document.getElementById('exit-altitude-msl') as HTMLInputElement | null
if (altSlider) {
  altSlider.addEventListener('input', () => {
    exitAltitudeMSL = parseInt(altSlider.value, 10)
    const display = document.getElementById('exit-altitude-display')
    if (display) {
      display.textContent = `${exitAltitudeMSL} m MSL`
    }
  })
}
```

**Export Getter** (for SimRunner to access):
```typescript
export function getExitAltitudeMSL(): number {
  return exitAltitudeMSL
}
```

### Phase 2: Fix SimState Initialization

**File**: `src/sim/sim-runner.ts` - `flightStateToSimState()`

Change from:
```typescript
❌ x: 0, y: 0, z: -2000  // Wrong: position baked with MSL reference
```

To:
```typescript
✓ x: 0, y: 0, z: 0  // Correct: exit point origin
```

Pass exit altitude separately to aerodynamic calculations:
```typescript
// Get exit altitude for density calculations
const ctx = this.ctx
const exitAltitudeMSL = (ctx as any).getExitAltitudeMSL?.() ?? 2000

// When computing air density:
const rho = getDensityAtAltitude(exitAltitudeMSL + (-sim.z))
// This gives density at "MSL altitude + descent distance"
```

### Phase 3: Update Terrain Position Function

**File**: `src/sim/sim-ui.ts`

Replace current `updateTerrainPosition()`:

```typescript
/**
 * Position terrain based on descent from exit point.
 * 
 * SimState.z origin is at exit point:
 *   z = 0 at start (t=0, at exit)
 *   z > 0 as wingsuit descends
 *   z = +100 means descended 100m below exit
 * 
 * Terrain visual position opposes flight descent:
 *   Stays at origin initially
 *   Moves down visually as wingsuit descends
 */
export function updateTerrainPosition(
  pos_x: number,  // north from exit (m)
  pos_y: number,  // east from exit (m)
  pos_z: number   // down from exit (m, positive = descended)
): void {
  if (!currentTerrainModel) return
  
  // Convert NED to Three.js
  // pos_z is positive downward; negate for Three.js Y-up
  currentTerrainModel.position.set(
    pos_y,      // East → +X (terrain west as wingsuit goes east)
    -pos_z,     // Down → -Y (terrain down as wingsuit descends, opposite)
    -pos_x      // North → -Z (terrain back as wingsuit goes north)
  )
}
```

### Phase 4: Update Render Loop

**File**: `src/main.ts` - `updateVisualization()`

Simplify terrain update (no initial-z capture needed):

```typescript
// Update terrain position based on flight descent
if (isSimRunning() && state.frameMode === 'inertial') {
  // pos_x, pos_y, pos_z already have origin at exit point
  // z = 0 at start, increases as wingsuit descends
  updateTerrainPosition(state.pos_x, state.pos_y, state.pos_z)
} else {
  // Reset mode or body frame: terrain at origin
  updateTerrainPosition(0, 0, 0)
}
```

---

## Expected Results

✅ **Terrain visible in reset mode** — at origin with model at exit point  
✅ **Terrain visible when sim starts** — still at origin (z=0 at start)  
✅ **Terrain moves down** as wingsuit descends (pos_z increases)  
✅ **Terrain moves north/east** as wingsuit moves laterally  
✅ **Density calculations correct** — uses exit altitude slider (default 2000m MSL)  
✅ **Orbit controls work** — fully functional throughout  
✅ **User can adjust** exit altitude independently from terrain positioning  

---

## Files to Modify

1. **sim-ui.ts**: 
   - Add exitAltitudeMSL state variable + slider control
   - Export getExitAltitudeMSL()
   - Update updateTerrainPosition() signature (same params, fix logic)
   - Update handleTerrainSelection() to position at origin

2. **sim-runner.ts**: 
   - Fix flightStateToSimState() to use z:0 instead of z:-2000
   - Access exitAltitudeMSL from UI for aerodynamic calculations

3. **main.ts**: 
   - Simplify terrain position update (no initial-z computation)

