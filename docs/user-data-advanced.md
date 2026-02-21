# User-Data: Advanced Level

## I Have Everything Custom — Full Vehicle Integration

> **Time:** ~2–4 hours (includes measurement workflow)
> **Difficulty:** High — aerodynamics, geometry, inertia, validation
> **Outcome:** A complete vehicle (pilot + equipment) flying in the sim with your exact data

---

## Scenario

You have:
- Custom GLB model (3D geometry at true physical dimensions)
- Measured mass properties (CG, inertia tensor)
- Aerodynamic data from wind tunnel, XFLR5, or flight tests
- Possibly custom control surfaces or geometry

You want every aspect of the sim to reflect your specific setup, not defaults.

**For the architectural "why" behind this workflow, see [VEHICLE-REFACTOR.md](../VEHICLE-REFACTOR.md).**

---

## Measurement Workflow

Before you can integrate, you need to measure. This section assumes you have access to:
- The assembled equipment (wingsuit, canopy, helmet, etc.)
- A scale (for total mass)
- A method to find CG (balance point)
- A way to estimate inertia (pendulum, or calculated from CAD)

### 1. Measure Total Mass

Assemble the complete system (including helmet, harness, all gear). Weigh it.

**Example:** 77.5 kg total (typical skydiver + gear)

### 2. Find Center of Gravity (CG)

**Method A: Suspension Balance (Physical)**

1. Suspend the assembled system by a rope at the shoulders
2. Let it hang freely
3. Mark where it balances (hang point)
4. Repeat from a different point (e.g., by the head)
5. Intersection of the two lines is the CG

**Result:** A position in 3D space (ideally relative to a known reference, like the riser attachment point)

**Method B: Component-Based Calculation**

If you know each part's mass and CG:

$$CG = \frac{\sum m_i \cdot CG_i}{\sum m_i}$$

Where:
- $m_i$ = mass of component $i$ (head, arms, torso, legs, gear)
- $CG_i$ = center of gravity of component $i$

**Typical values:**
| Component | Mass (kg) | CG x/c | CG y/c | CG z/c |
|-----------|-----------|--------|--------|--------|
| Head | 4 | 0.15 | 0 | 0.85 |
| Torso | 20 | 0.45 | 0 | 0.40 |
| Arms | 8 | 0.20 | ±0.30 | 0.35 |
| Legs | 12 | 0.50 | 0 | -0.20 |
| Gear (harness, etc.) | 33.5 | 0.42 | 0 | 0.30 |

Compute weighted average → system CG.

### 3. Measure Inertia Tensor

**Method A: Pendulum Measurement (Physical)**

Suspend the system by a point and measure the period of oscillation:

$$T = 2\pi \sqrt{\frac{I}{m \cdot g \cdot d}}$$

Where:
- $I$ = moment of inertia about the suspension axis
- $m$ = mass
- $g$ = 9.81 m/s²
- $d$ = distance from suspension to CG

Rearrange:
$$I = \frac{m \cdot g \cdot d \cdot T^2}{4\pi^2}$$

Measure oscillation period $T$ (several swings, average), then compute $I$.

Repeat for all three axes (pitch, roll, yaw).

![Body & inertial frames](gifs/body-inertial-frames.gif)
*Pitch, roll, and yaw axes. Inertia measurements correspond to rotation about each.*

**Method B: CAD/Calculation**

If you have a CAD model:
- Assign densities to each component
- Calculate inertia tensor directly (most CAD tools can do this)
- Result: 6 values (Ixx, Iyy, Izz, Ixy, Ixz, Iyz)

### 4. Create Mass Segments (Normalized)

Break the system into pieces and compute each piece's contribution:

```typescript
interface MassSegment {
  name: string
  massRatio: number                    // mass / totalMass
  normalizedPosition: { x, y, z }      // position / referenceLength
}
```

**Example: 77.5 kg pilot + gear**

```typescript
const MY_CUSTOM_MASS_SEGMENTS: MassSegment[] = [
  {
    name: 'head',
    massRatio: 4 / 77.5,               // 0.052
    normalizedPosition: {
      x: 0.15 * 1.8 / 1.875,           // x/c * chord / height
      y: 0,
      z: 0.85 * 1.8 / 1.875,
    }
  },
  {
    name: 'torso',
    massRatio: 20 / 77.5,              // 0.258
    normalizedPosition: {
      x: 0.45 * 1.8 / 1.875,
      y: 0,
      z: 0.40 * 1.8 / 1.875,
    }
  },
  // ... more segments ...
]
```

### 5. Validate Mass Properties

In your CAD or measurement setup, verify:
- **Total mass:** Sum of all segments = your measured total ✓
- **CG position:** Weighted average of segment positions matches your measured CG ✓
- **Inertia tensor:** If you calculated it, does it match your pendulum measurements? ✓

---

## GLB Preparation & Geometry

### Modeling the Vehicle

Your 3D model should ideally:
1. **Be at true physical scale** (pilot = 1.875 m tall, not normalized)
2. **Have the CG at the origin** (0, 0, 0) of the model
3. **Follow NED coordinates:** +X forward, +Y right, +Z down (or specify the mapping)
4. **Include the visible equipment:** helmet, suit, harness, canopy visible (for reference)

### Exporting to GLB

From your modeling software (Blender, CAD tool):

1. Center the model at the CG
2. Apply correct scale (if model is in cm, scale by 0.01 to get meters)
3. Check orientation (forward axis should be +X)
4. Export as GLB (modern format, includes geometry, materials, metadata)

### GLB Metadata Registry Entry

In `polar-visualizer/src/viewer/model-registry.ts`:

```typescript
import { Vec3 } from '../polar/index.ts'

export const MY_CUSTOM_PILOT: GLBMetadata = {
  filePath: 'public/models/my-custom-pilot.glb',
  
  // Physical size (what dimension does this GLB represent?)
  physicalSize: {
    height: 1.875,               // Pilot head-to-toe
    chord: 1.8,                  // Wingsuit chord (if applicable)
    span: 0.5,                   // Wingspan (if applicable)
  },
  
  glbMaxDim: 3.6,                // Bounding box diagonal for scale factor
  
  // Does the GLB need flipping? (canopies often do)
  needsFlip: false,
  
  // Additional metadata
  cgOffsetFraction: 0.197,       // If CG isn't perfectly at origin, offset here
  
  // Axis mapping: which GLB axis corresponds to which NED axis?
  axes: {
    ned_x: { glbAxis: 'z', sign: 1 },   // +X (forward) = +Z in GLB
    ned_y: { glbAxis: 'x', sign: -1 },  // +Y (right) = -X in GLB
    ned_z: { glbAxis: 'y', sign: 1 },   // +Z (down) = +Y in GLB
  }
}
```

---

## Aerodynamic Data Integration

### 1. Extract Polars from Flight Data

If you have flight logs (GPS, airspeed, attitude):

**Given:** Actual flight trajectory + logged airspeed + measured weight

**Compute:**
- Lift & drag from acceleration (Newton's 2nd law)
- Angle of attack from attitude + velocity vector
- Coefficients: CL = Lift / (0.5 * ρ * V² * Area)

**Fit** CL_α, CD_0, k, stall points to the computed coefficients (same Kirchhoff model as Beginner/Intermediate).

**Tools:**
- Python + scipy (curve fitting)
- Excel/Sheets (manual fitting)
- AI-assisted fitting (if you can describe your data)

### 2. Extract Polars from Wind Tunnel Data

If you have wind tunnel test results (thrust, drag, pitching moment vs. AoA):

- Convert force data to coefficients (divide by 0.5 * ρ * V² * Area)
- Fit to Kirchhoff model (same as before)
- Extract moment coefficients (cm_0, cm_alpha) directly from pitching moment vs. AoA

### 3. Extract Polars from XFLR5 / OpenVSP / CFD

Export the polar table (α, CL, CD, CM) and fit to Kirchhoff model (same process as Intermediate).

### 4. Create Aero Segments

For a custom wingsuit, you likely have multiple aero segments:
- Head (parasitic)
- Center / torso
- Left arm
- Right arm
- Left leg
- Right leg

For each segment, create a polar and position it in the registry.

```typescript
// Center body polar (from your wind tunnel or flight data)
export const myCustomCenter: ContinuousPolar = {
  name: 'My Custom — Center Body',
  type: 'Wingsuit',
  cl_alpha: 3.2,
  // ... fitted coefficients ...
  s: 1.0,                        // Measured / estimated area
  chord: 1.8,                    // Measured system chord
  referenceLength: 1.875,        // Pilot height
}

// Left wing polar
export const myCustomLeftWing: ContinuousPolar = {
  name: 'My Custom — Left Wing',
  type: 'Wingsuit',
  cl_alpha: 2.8,
  // ... fitted coefficients ...
  s: 0.3,
  chord: 1.2,
  referenceLength: 1.875,
}

// ... right wing, head, legs ...
```

### 5. Position Segments in Registry

Segment positions are **relative to CG, normalized by referenceLength**:

```typescript
const MY_CUSTOM_SEGMENTS: AeroSegment[] = [
  {
    name: 'head',
    position: { x: 0.20, y: 0, z: 0.45 },      // normalized
    orientation: { roll_deg: 0 },
    S: 0.07,
    chord: 0.13,
    polar: myCustomHead,
    // ... other properties ...
  },
  
  {
    name: 'center',
    position: { x: 0.0, y: 0, z: 0 },          // at CG
    orientation: { roll_deg: 0 },
    S: 1.03,
    chord: 1.8,
    polar: myCustomCenter,
    // ...
  },
  
  {
    name: 'leftWing',
    position: { x: -0.05, y: 0.3, z: -0.1 },   // relative to CG
    orientation: { roll_deg: 10 },
    S: 0.30,
    chord: 1.2,
    polar: myCustomLeftWing,
    // ...
  },
  
  // ... right wing, head, legs ...
]
```

---

## Full Vehicle Registry Entry

Assemble everything into a `VehicleDefinition`:

```typescript
export const MyCustomVehicle = {
  id: 'my-custom-v1',
  name: 'My Custom Setup v1',
  
  pilot: {
    glb: MY_CUSTOM_PILOT,
    mass: MY_CUSTOM_MASS_SEGMENTS,
    aeroSegments: MY_CUSTOM_SEGMENTS,
    referenceLength: 1.875,
  },
  
  equipment: [
    {
      id: 'my-canopy-210',
      type: 'Canopy',
      aero: myCanopy210Continuous,
      glb: MY_CANOPY_GLB_METADATA,
      mass: MY_CANOPY_MASS_SEGMENTS,
      referenceLength: 1.875,
    }
  ]
}
```

---

## Code Integration

### 1. Add to Model Registry

In `polar-visualizer/src/viewer/model-registry.ts`:

```typescript
// Your GLB metadata
export const MY_CUSTOM_PILOT: GLBMetadata = { /* ... */ }

// Mass segments
export const MY_CUSTOM_MASS_SEGMENTS: MassSegment[] = [ /* ... */ ]
```

### 2. Add to Polar Registry

In `polar-visualizer/src/polar/polar-data.ts`:

```typescript
export const myCustomCenter: ContinuousPolar = { /* ... */ }
export const myCustomLeftWing: ContinuousPolar = { /* ... */ }
// ... more polars ...

// Registry
export const polarRegistry = {
  myCustomCenter,
  myCustomLeftWing,
  // ... add to bottom ...
}
```

### 3. Add GLB to Public

Copy your GLB file to `polar-visualizer/public/models/my-custom-pilot.glb`

### 4. Type-Check & Test

```bash
cd polar-visualizer
npx tsc --noEmit          # Should be zero errors
npx vitest run            # All tests pass
npm run dev               # Load and test
```

---

## Validation & Debugging

### Validation Checklist

- [ ] **Type-check passes** — `tsc --noEmit` → 0 errors
- [ ] **Tests pass** — `vitest run` → all 220+ pass
- [ ] **GLB loads** — Browser console clean, model visible
- [ ] **CG aligns** — Visual CG matches mass segment calculation
- [ ] **Trim point** — Reasonable AoA (8–15° for wingsuit)
- [ ] **Glide ratio** — Matches your flight data (within 10%)
- [ ] **Inertia** — Roll/yaw rates match your flights (use mass overlay to compare)
- [ ] **Controls** — Brake/flap response makes sense
- [ ] **Stability** — No oscillations or divergence on small perturbations

![Effect of pitch control on roll rate](gifs/effect-euler-roll-rate.gif)
*Euler angle and roll rate under control input. Use this to validate your inertia tensor.*

### Debugging

**"GLB doesn't load / white screen"**
- Check browser console for errors
- Verify file path in registry matches actual file
- Is GLB in correct folder: `public/models/`?

**"Trim at 80° AoA"**
- Your aero coefficients are grossly wrong
- Start with a reference polar (Aura 5 or Ibex UL) and tweak incrementally
- Verify α_0 (zero-lift angle) is correct

**"CG position wrong"**
- Verify mass segment positions sum correctly to your measured CG
- Check GLB is actually centered at CG (or use `cgOffsetFraction` in registry)
- Render the mass overlay to visually inspect

**"Roll/pitch rates wrong"**
- Inertia tensor is off
- Re-measure using pendulum or CFD
- Verify moment arms are correct (segment positions)

**"Glide ratio doesn't match my flight"**
- Your drag polars are off (CD_0, k)
- Compare calculated vs. measured L/D
- Refit or hand-tune CD_0 and k

### Pain Point Analysis: Why This Matters

**Before (old approach):**
- "Change pilot height" = edit 25 places, high error risk
- "Add new vehicle" = copy entire sections of code, breaks tests
- "Validate inertia" = scattered across files, no single formula

**After (decoupled registry):**
- "Change pilot height" = one field in registry, automatically propagates
- "Add new vehicle" = one registry entry, no code changes
- "Validate inertia" = call `computeInertia(mass, vehicle.referenceLength, mass)`, testable

**Result:** You can integrate custom equipment in hours instead of days, with lower error rate.

---

## Example: Full Custom Integration

**Scenario:** You have a custom wingsuit design, 1.92m flight height, measured CG, wind tunnel polars, and a GLB model.

### Measurements
- Head-to-toe: 1.92 m
- System chord: 1.85 m
- CG: 0.08 m forward of origin, 0.02 m above
- Inertia: Ixx=2.1, Iyy=1.8, Izz=2.5 kg⋅m²

### Wind Tunnel Data
- CL_α = 3.1 /rad
- α_0 = -1.5°
- CD_0 = 0.093
- k = 0.355

### Workflow

**1. Write mass segments:**
```typescript
const MYSUIT_MASS_SEGMENTS: MassSegment[] = [
  {
    name: 'head',
    massRatio: 0.053,
    normalizedPosition: { x: 0.10, y: 0, z: 0.46 }  // normalized
  },
  // ... more ...
]
```

**2. Create polars:**
```typescript
export const mySuitCenter: ContinuousPolar = {
  name: 'My Suit — Center',
  cl_alpha: 3.1,
  alpha_0: -1.5,
  cd_0: 0.093,
  k: 0.355,
  // ... rest ...
  referenceLength: 1.92,
}
```

**3. Prepare GLB:**
- Model at 1.92 m height
- CG at origin (or use offset)
- Export as GLB

**4. Register:**
```typescript
// registry
const MY_SUIT_PILOT: GLBMetadata = {
  filePath: 'public/models/my-suit.glb',
  physicalSize: { height: 1.92, chord: 1.85, span: 0.5 },
  glbMaxDim: 3.7,
  needsFlip: false,
}

// Polar registry
polarRegistry.mySuitCenter = mySuitCenter
```

**5. Type-check & test:**
```
npx tsc --noEmit  ✓
npx vitest run    ✓
npm run dev       ✓ Loads, trims at 10°, matches wind tunnel data
```

---

## Summary

**Advanced workflow:**
1. Measure mass (CG, inertia)
2. Prepare & validate GLB at true scale
3. Extract aero from flight data / wind tunnel / CFD
4. Create mass segments, aero segments, polars
5. Register in model-registry and polar-data
6. Type-check, test, iterate

**Time:** ~2–4 hours (depending on measurement complexity)

**Result:** Full custom vehicle flying with your exact aerodynamics, geometry, mass, and inertial properties

---

## What's Next?

- **[VEHICLE-REFACTOR.md](../VEHICLE-REFACTOR.md):** Architecture and why decoupling matters
- **[Beginner](user-data-beginner.md):** Simpler path for quick polar tuning
- **[Intermediate](user-data-intermediate.md):** CloudBase polar integration with curve fitting
