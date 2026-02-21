# USER-MY-DATA — Integrating Your Own Vehicle Data

> **Overview:** Three-tier guide for integrating your own aerodynamic, geometric, and mass data.
> **Related:** [VEHICLE-REFACTOR.md](reference/VEHICLE-REFACTOR.md) (architectural context), [REFERENCE-LENGTH.md](REFERENCE-LENGTH.md) (constants & normalization)

---

## What Level Are You?

### Beginner: "I know forces and basic flight physics"

**→ [Beginner](user-data-beginner.md)** — I have FlySight logs and want to tweak an existing polar to match my flights

- **Time:** ~15 minutes
- **Knowledge:** Understand glide ratio, sink rate, angle of attack, gravity
- **Task:** Change one or two numbers in an existing polar; compare to real flight data
- **Use case:** "Same wingsuit + canopy as the default, but my glide ratio is off by 10%"
- **No coding required; no math**

### Intermediate: "I know aerodynamics and can use math tools"

**→ [Intermediate](user-data-intermediate.md)** — I have a new canopy design with CloudBase polars, or exported data from XFLR5/CFD

- **Time:** ~45 minutes
- **Knowledge:** Understand CL, CD, curve fitting, Kirchhoff model, CoG, moment arms
- **Task:** Extract aerodynamic coefficients from a polar table; fit them to the system's model
- **Use case:** "We designed a new 235 sqft canopy and want to simulate it alongside the defaults"
- **Math required (fitting polars); testing in visualizer; not full system integration**

### Advanced: "I have specialized expertise (design, aerodynamics, CAD)"

**→ [Advanced](user-data-advanced.md)** — I have custom GLB geometry, measured mass properties, and aerodynamic data from wind tunnel or flight tests

- **Time:** ~2–4 hours (includes measurement workflow)
- **Knowledge:** Measurement techniques (CG, inertia), GLB modeling, polar extraction, full system architecture
- **Task:** Measure & model every aspect of your vehicle (mass, geometry, aero); integrate all into the sim
- **Use case:** "Our team built a custom wingsuit + canopy setup; I want full fidelity in the sim with exact mass, geometry, aerodynamics"
- **Requires:** 3D modeling, measurement techniques, aerodynamic analysis

---

## Quick Decision Tree

```
Do you have FlySight logs from your flights?
├─ YES → You're BEGINNER
│         "My flights don't match the default, let me tune it"
│
└─ NO, I have a new design
   ├─ Do you have full GLB model + mass measurements?
   │  ├─ YES → You're ADVANCED
   │  │        "Full integration with my custom design"
   │  │
   │  └─ NO → You're INTERMEDIATE
   │          "I have CloudBase polars or XFLR5 export"
   │          "I want to simulate my design without full measurements"
```

---

## What Level Are You? (Table View)

---

## Key Concepts

Before diving in, here are terms you'll see across all three levels:

### What Is a "Polar"?

A **polar** is a bundle of aerodynamic coefficients that describes how a surface (wing, canopy, wingsuit) behaves at different angles of attack. In this system:

```typescript
interface ContinuousPolar {
  name: string                    // "Aura 5 Wingsuit"
  type: 'Wingsuit' | 'Canopy'    // Type of equipment

  // Lift model: how much lift per degree of angle of attack
  cl_alpha: number                // e.g., 2.9 /radian

  // Drag model
  cd_0: number                    // Minimum drag at zero lift
  k: number                        // Induced drag factor

  // Stall behavior
  alpha_stall_fwd: number         // Stall point (forward flight)
  alpha_stall_back: number        // Stall point (backward flight)

  // Center of pressure: where the aerodynamic force acts
  cp_0: number                    // At zero lift

  // ... and several more (see polar-data.ts for full list)

  // Physical properties
  s: number                        // Area [m²]
  m: number                        // Mass [kg]
  chord: number                    // Reference chord [m]
  referenceLength: number         // Height for normalizing positions [m]

  // Optional control derivatives (brake, flap, etc.)
  controls?: { ... }
}
```

You don't need to understand the aerodynamic theory—that's why there are three levels. But you should know:
- **Coefficients are dimensionless** (CL, CD, etc. have no units)
- **They describe the shape & how it moves through air**
- **The same shape (e.g., Aura 5 wingsuit) has one polar**
- **Changing one coefficient ripples through the simulation**

### What Does "Normalization" Mean?

All positions in the system are stored **normalized** (divided by a reference length):

```
normalized_position = physical_position / referenceLength
```

**Example:**
- Pilot height (reference length): 1.875 m
- Physical CG position: 0.094 m forward of origin
- Normalized position: 0.094 / 1.875 = 0.05

**Why?** So you can scale the pilot (change height) and everything scales with it:
- If pilot grows to 2.0 m → `normalized_position × 2.0 = 0.10 m` (still proportional)

All three levels handle this automatically; you just need to know it exists.

### What Is the "Registry"?

The **registry** is a database where the system looks up vehicle configurations:

```typescript
const VEHICLE_REGISTRY = {
  'aura5-ibexul': { ... },        // Default wingsuit + canopy combo
  'ibexul-slicksin': { ... },     // Alternative
  'caravan': { ... },              // Skydiving
}
```

To add your vehicle, you add an entry here. No code changes needed—just data.

---

## Common Concepts Across Levels

### Moment Arm & Inertia

When you change `referenceLength`, two things scale:
1. **Moment arms** (distance from CG to control surface)
   - Scales linearly with reference length
   - Example: pilot height 1.875 → 2.0 m, moment arms grow by 6.7%

2. **Inertia** (resistance to rotation)
   - Scales with (reference length)²
   - Heavier pilot + bigger moment arms = harder to pitch/roll

**Both scale together automatically** when you set `referenceLength` on your polar.

**👉 Beginner:** Don't worry about this; use defaults
**👉 Intermediate:** Not needed unless you're changing pilot height
**👉 Advanced:** Essential for accurate physics; measure this

---

## Concept Progression by Level

| Concept | Beginner | Intermediate | Advanced |
|---------|----------|--------------|----------|
| Polars (aerodynamic coefficients) | Tweak existing | Fit from data | Extract & create |
| Normalization | Don't worry | Optional | Essential |
| Mass segment distribution | Not needed | Not needed | Core workflow |
| Inertia tensor (pitch/roll/yaw) | Not needed | Not needed | Measure & validate |
| GLB geometry + modeling | Not needed | Not needed | Full workflow |
| Measurement techniques | Not needed | Not needed | Pendulum, CAD, balance |

(Later sections explain each concept in full detail for the level that needs it.)

---

## Common Concepts Across Levels

### Segment Positions

A "segment" is a piece of the vehicle (head, center wing, canopy cell, etc.). Each segment:
- Has a position in normalized coordinates
- Has aerodynamic coefficients (from a polar)
- Contributes force + moment to the system

**Segments are positioned at build time**, using the vehicle's registry entry. You don't edit segment positions in code; you edit them in the registry.

### Mass Distribution

Mass is defined as a list of **mass segments**:

```typescript
interface MassSegment {
  name: string
  massRatio: number                   // Fraction of total mass
  normalizedPosition: { x, y, z }     // Position / referenceLength
}
```

When the system denormalizes (converts to meters):
```
physical_position = normalized_position × referenceLength
```

So if you change `referenceLength`, all mass segment positions scale together. ✓

---

## Workflow Overview

### Beginner Workflow
```
1. Identify which polar to start from
2. Modify coefficients (CL_α, CD_0, stall angles) in a new polar entry
3. Register the new polar
4. Select it in the UI (when available)
5. Compare sim vs. FlySight logs
6. Iterate
```
👉 **No GLB, no mass, no geometry changes.**

### Intermediate Workflow
```
1. Export polar table from CloudBase (or equivalent)
2. Fit coefficients to our model (or use provided converter)
3. Create polar entry with fitted coefficients
4. Specify canopy area, chord, span from spec sheet
5. Register the new polar
6. Test: does glide ratio match?
```
👉 **Aero only; reuse default pilot + mass.**

### Advanced Workflow
```
1. Measure: wingspan, chord, mass distribution, CG, inertia
2. Prepare GLB: scale to physical dimensions, position at CG
3. Extract aero: fit polars from flight data or wind tunnel
4. Create polar entries (head, body, wings, etc.)
5. Create mass segments from measurements
6. Create GLB metadata entry
7. Register vehicle
8. Validate: test both aero trim points and inertial properties
```
👉 **Full integration: GLB + aero + mass.**

---

## File Locations

When you create or modify data, know where each piece goes:

| What | Where |
|------|-------|
| Polar coefficients | `polar-visualizer/src/polar/polar-data.ts` |
| Mass segments | `polar-visualizer/src/viewer/model-registry.ts` |
| GLB geometry | `polar-visualizer/public/models/*.glb` (your files here) |
| GLB metadata | `polar-visualizer/src/viewer/model-registry.ts` |
| Tests | `polar-visualizer/src/tests/` |

For details on each, see the section for your level.

---

## Validation Checklist

Once you've added your vehicle, before declaring it "done":

- [ ] **Polars exist** — all component polars (head, wings, etc.) are registered
- [ ] **Mass segments defined** — CG position and inertia match your measurements
- [ ] **GLB loads** — no console errors; model renders at correct scale
- [ ] **Trim is sensible** — sim trims at a reasonable airspeed + AoA
- [ ] **Stability checks out** — slight perturbations don't spiral out immediately
- [ ] **Compare to real data** — if you have flight logs, differences are explainable

---

## Questions & Support

- **"I broke something; how do I debug?"** → See [Advanced > Debugging](user-data-advanced.md#debugging)
- **"My polar coefficients seem wrong"** → See [Advanced > Polar Extraction](user-data-advanced.md#polar-extraction-from-flight-data)
- **"I want to modify a default vehicle"** → See [Beginner](user-data-beginner.md)
- **"I have CloudBase polars"** → See [Intermediate](user-data-intermediate.md)
- **"I have everything custom"** → See [Advanced](user-data-advanced.md)

---

## Next: Choose Your Path

**[→ I'm a Beginner](user-data-beginner.md)** — Tweak an existing polar with FlySight logs

**[→ I'm Intermediate](user-data-intermediate.md)** — Integrate CloudBase or exported polar data

**[→ I'm Advanced](user-data-advanced.md)** — Full custom vehicle with GLB + measurements
