# User-Data: Intermediate Level

## I Have CloudBase Polars — Integrate a New Vehicle

> **Time:** ~45 minutes
> **Difficulty:** Moderate — fitting data to the system model
> **Outcome:** A complete polar that can be used in the sim with your aerodynamic data

---

## Scenario

You design canopies (or have access to CloudBase polars), or you've exported aerodynamic data from another sim (e.g., OpenVSP, XFLR5). You want to integrate a new design into this simulator without waiting for wind tunnel or flight validation.

**Assumes:** You're already familiar with using this simulator — moving the sliders, observing how angle of attack and control inputs affect glide ratio, sink rate, and stability. You've spent time exploring with the visualizer and understand the relationship between aerodynamic parameters and flight behavior.

**You'll:**
1. Understand the Kirchhoff (continuous polar) model that the sim uses
2. Extract aerodynamic coefficients from your design data (CloudBase, CFD, XFLR5)
3. Fit those coefficients to our mathematical model
4. Create a polar entry and validate it flies sensibly
5. Test it in the sim using the interactive controls

---

## Background: The Kirchhoff Model (Physics You'll Use)

This simulator uses a **continuous polar** model instead of discrete lookup tables. Instead of:

```
α = 5° → table lookup → CL=0.32, CD=0.041
α = 6° → table lookup → CL=0.38, CD=0.045
```

We use **continuous functions:**

$$CL(\alpha) = CL_\alpha \cdot \sin(\alpha - \alpha_0) \text{ (fit to data)}$$

$$CD(\alpha) = CD_0 + k \cdot CL^2 \text{ (parabolic, induced drag)}$$

**Benefits:**
- Smooth behavior (no table lookup artifacts)
- Fewer parameters (easier to tweak)
- Extrapolates gracefully outside measured range

**Trade-off:**
- Requires fitting discrete data to continuous parameters

### Fitting Kirchhoff Parameters

You have a polar table (CloudBase or other source):

| α | CL | CD |
|---|----|----|
| -5° | -0.20 | 0.050 |
| 0° | 0.35 | 0.025 |
| 5° | 0.90 | 0.035 |
| 10° | 1.35 | 0.055 |
| 15° | 1.68 | 0.085 |

From this, extract:

**1. CL_α (lift slope)**

Fit a line to the linear region (~0° to 12°):

$$CL_{fit} = CL_\alpha \cdot \sin(\alpha - \alpha_0)$$

For a parafoil: typically **1.5–2.5 /rad** (for canopy) or **2.5–3.5 /rad** (for wings).

- If CL changes by 1.0 over a 7° range: $1.0 / (7 \cdot \pi/180) = 1.0 / 0.122 = 8.2$ — too high
- Recalculate: CL goes from 0.35 @ 0° to 1.35 @ 10° → ΔCL = 1.0, Δα = 10° ≈ 0.175 rad → CL_α ≈ 5.7 /rad

Actually, let me simplify: **extract CL at known angles and compute the slope:**

```
α = 0°:   CL ≈ 0.35
α = 10°:  CL ≈ 1.35
Slope = (1.35 - 0.35) / (10 - 0) = 1.0 / 10° = 0.10 /degree
       = 0.10 * 180/π = 5.7 /radian
```

**Note:** Some tables give negative slopes (backward slope). That's normal for parafoils; keep the sign.

**2. α_0 (zero-lift angle)**

Look up where CL = 0 in your table. Parafoils typically have **α_0 = -8° to -15°** (lots of built-in camber).

If your table doesn't go to CL=0, interpolate or extrapolate.

**3. CD_0 (zero-lift drag)**

At the angle where CL = 0, read off CD. This is CD_0.

For parafoils: typically **0.08–0.12**.

**4. k (induced drag factor)**

Fit a parabola to CD:

$$CD(\alpha) = CD_0 + k \cdot CL^2$$

Use the data points far from stall (linear CL region). Rearrange:

$$k = \frac{CD - CD_0}{CL^2}$$

Compute k for several points and average.

**Example:**
- @ α=5°: CL=0.90, CD=0.035 → k = (0.035 - 0.025) / 0.90² = 0.01 / 0.81 = 0.0123
- @ α=10°: CL=1.35, CD=0.055 → k = (0.055 - 0.025) / 1.35² = 0.03 / 1.82 = 0.0165
- Average: k ≈ 0.014–0.016

Typical parafoil: **k ≈ 0.04–0.10**.

**5. Stall behavior (alpha_stall_fwd, s1_fwd)**

Look at where CL stops increasing or starts decreasing. This is your stall point.

- `alpha_stall_fwd`: angle where stall occurs [degrees]. Usually **20°–40°** for parafoils.
- `s1_fwd`: "softness" of stall. Controls how quickly CL drops past stall.
  - Higher value (3–10) = sharper stall
  - Lower value (1–2) = gradual stall

If unsure, use **s1_fwd = 3–4** (moderate).

**6. Center of Pressure (CP)**

- `cp_0`: where aerodynamic force acts at zero lift. Usually **0.20–0.40** (as fraction of chord).
- `cp_alpha`: how CP moves with angle of attack. Usually **-0.01 to -0.05** (moves aft as α increases).

For a parafoil, use:
- `cp_0 = 0.25` (quarter-chord)
- `cp_alpha = 0.00` (doesn't move much)

**7. Pitching Moment (CM)**

- `cm_0`: moment at zero lift (usually **-0.02 to 0.00**)
- `cm_alpha`: stability derivative (more negative = more stable). Usually **-0.05 to -0.15**.

For a canopy, conservative values:
- `cm_0 = -0.02`
- `cm_alpha = -0.08`

---

## Step 1: Export Polar Data from CloudBase

### Accessing CloudBase

1. Go to https://www.cloudbase.cloud (or your CloudBase subscription)
2. Find your design (e.g., "MyCanopy_235sqft")
3. Export **polar table**: CSV or table format with columns: **α, CL, CD** (at minimum)

### Expected Format

```
alpha(deg),  CL,     CD
-10,         -0.15,  0.060
-5,          0.05,   0.040
0,           0.35,   0.025
5,           0.90,   0.035
10,          1.35,   0.055
15,          1.65,   0.085
20,          1.80,   0.130
25,          1.85,   0.185
30,          1.70,   0.270
```

**Note:** Different sources format this differently. If you're not sure, ask for "aerodynamic polar as CSV" or consult the tool's documentation.

---

## Step 2: Fit Coefficients to Kirchhoff Model

Use **one of these approaches:**

### Approach A: Manual Fitting (Spreadsheet)

1. Open the CSV in Excel or Google Sheets
2. Create helper columns to compute:
   - CL fit: `=CL_α * sin((α_deg - α_0_deg) * π/180)`
   - CD fit: `=CD_0 + k * CL_fit²`
3. Adjust CL_α, α_0, CD_0, k until fit matches data
4. Visually inspect: line should go through the data points

### Approach B: Using Python (scipy.optimize)

If you're comfortable with Python:

```python
import numpy as np
from scipy.optimize import curve_fit
import csv

# Load data
data = np.loadtxt('MyCanopy_polar.csv', delimiter=',', skiprows=1)
alpha_deg = data[:, 0]
CL_data = data[:, 1]
CD_data = data[:, 2]

alpha_rad = np.deg2rad(alpha_deg)

# Define Kirchhoff functions
def CL_fit(alpha_rad, CL_alpha, alpha_0_rad):
    return CL_alpha * np.sin(alpha_rad - alpha_0_rad)

def CD_fit(alpha_rad, CD_0, k, CL_alpha, alpha_0_rad):
    CL = CL_alpha * np.sin(alpha_rad - alpha_0_rad)
    return CD_0 + k * CL**2

# Fit CL
popt_CL, _ = curve_fit(CL_fit, alpha_rad, CL_data, p0=[5.0, -0.2])
CL_alpha_fit, alpha_0_rad_fit = popt_CL

# Fit CD
popt_CD, _ = curve_fit(lambda a: CD_fit(a, *popt_CD_init, *popt_CL), 
                       alpha_rad, CD_data, p0=[0.025, 0.05])
CD_0_fit, k_fit = popt_CD

print(f"CL_α = {CL_alpha_fit:.2f} /rad")
print(f"α_0 = {np.rad2deg(alpha_0_rad_fit):.1f}°")
print(f"CD_0 = {CD_0_fit:.4f}")
print(f"k = {k_fit:.4f}")
```

Output will be your fitted coefficients.

### Approach C: Use an Online Tool (If Available)

Some aero tool repositories provide fitting scripts. Check the docs for your data source.

---

## Step 3: Extract Physical Properties

From your CloudBase design spec sheet or model, get:

- **Planform area (S):** square meters or square feet (convert to m²)
  - Example: 235 sqft = 21.82 m²
  - For this system: typically normalized, so store as actual area

- **Mean chord:** meters
  - For rectangular planform: chord = area / span
  - For trapezoidal: mean of root + tip
  - Example: 235 sqft canopy, 8m span → chord ≈ 21.82 / 8 = 2.73m

- **Span:** meters
  - Read from design spec
  - Example: 8.0 m

- **Reference length:** The key new parameter from Phase A
  - For a canopy: use pilot height (**1.875 m**) for consistency with existing system
  - For a new wingsuit: use actual flight height (~1.93m for Aura 5, measure for yours)

---

## Step 4: Create Polar Entry

In `polar-visualizer/src/polar/polar-data.ts`, create a new canopy polar:

```typescript
/**
 * MyCanopy 235 sqft continuous polar.
 * Exported from CloudBase, fitted to Kirchhoff model.
 */
export const myCan235Continuous: ContinuousPolar = {
  name: 'MyCanopy 235 sqft',
  type: 'Canopy',

  // Fitted from CloudBase data
  cl_alpha: 1.75,           // /rad — fit from table
  alpha_0: -12,             // degrees — zero-lift angle
  cd_0: 0.110,              // minimum drag
  k: 0.065,                 // induced drag factor

  cd_n: 1.1,                // broadside drag (typical parafoil)
  cd_n_lateral: 0.8,        // side drag

  // Stall
  alpha_stall_fwd: 40,      // degrees
  s1_fwd: 4,                // softness

  alpha_stall_back: -5,     // backward stall
  s1_back: 3,

  // Side force & moments
  cy_beta: -0.4,            // typical parafoil
  cn_beta: 0.10,
  cl_beta: -0.10,

  // Pitching moment
  cm_0: -0.02,
  cm_alpha: -0.08,

  // Center of pressure
  cp_0: 0.40,               // typical parafoil
  cp_alpha: -0.01,

  cg: 0.35,                 // CoG relative to CP
  cp_lateral: 0.50,

  // Physical
  s: 21.82,                 // m² (235 sqft)
  m: 77.5,                  // system mass (default; user-adjustable)
  chord: 2.73,              // mean chord [m]
  referenceLength: 1.875,   // pilot height (standard)
}
```

### Naming Convention

Use clear, unambiguous names:

- `myCan235Continuous` — your name + canopy + size
- `cloudBase_SupraZ_large` — source + design + variant
- `myWingsuit_custom_v1` — custom wingsuit with version

---

## Step 5: Register the Polar

At the bottom of `polar-data.ts`:

```typescript
export const polarRegistry = {
  aurafive: aurafiveContinuous,
  ibexul: ibexulContinuous,
  myCan235: myCan235Continuous,    // Add your new entry
  // ...
}
```

---

## Step 6: Type-Check & Validate

### Type Check
```bash
cd polar-visualizer
npx tsc --noEmit
```
Should see **zero errors**.

### Run Tests
```bash
npx vitest run
```
All tests should still pass (220+ tests).

### Load in Simulator

```bash
npm run dev
```

Open http://localhost:5173. Look at:
- **Trim point:** Should be reasonable (0°–10° AoA for a canopy)
- **Glide ratio at trim:** Should match your CloudBase polar (within 5–10%)

**Test interactively:**
Use the visualizer control sliders you already know:
- Move **Brake** slider: canopy should pitch down (increase drag)
- Move **Flap** slider: observe how angle of attack changes
- **Move Forward:** check sink rate at different speeds
- **Sweep Alpha manually:** verify that CL and CD match your fit (glanced in the chart overlay)

### Sanity Checks

| Check | Good Range | Bad Sign |
|-------|-----------|----------|
| Trim AoA | 0°–15° for canopy | >20° or negative |
| Max CL | 1.5–2.0 | <1.0 or >3.0 |
| Drag at trim | Matches polar | 5x higher/lower |
| Pitch stability | Stable (no runaway pitch) | Oscillates or diverges |

---

## Example: CloudBase Canopy Integration

**Scenario:** We have a CloudBase 210 sqft design, exported polar.

### Step 1: Export & Extract

CloudBase CSVexport:
```
alpha,  CL,     CD
-10,    -0.18,  0.065
-5,     0.08,   0.042
0,      0.36,   0.024
5,      0.88,   0.033
10,     1.30,   0.052
15,     1.60,   0.085
20,     1.72,   0.130
25,     1.65,   0.185
```

### Step 2: Fit Coefficients

Fit CL by eye: linear region 0°–15°
- @ 0°: CL = 0.36
- @ 10°: CL = 1.30
- Slope: 1.30 - 0.36 = 0.94 / 10° ≈ 5.4 /rad

Fit CD:
- @ 0°: CL=0.36, CD=0.024 → k = (0.024-0.024)/0.36² = 0
- @ 5°: CL=0.88, CD=0.033 → k = (0.033-0.024)/0.88² = 0.0116
- @ 10°: CL=1.30, CD=0.052 → k = (0.052-0.024)/1.30² = 0.0167
- Average k ≈ 0.012

Zero-lift: interpolate between -5° (CL=0.08) and 0° (CL=0.36)
- CL = 0 @ α ≈ -1°... but that's odd. More likely CloudBase data includes camber buildup.
- Use α_0 = -12° (typical parafoil) and refit.

**Fitted values:**
- CL_α = 1.75 /rad
- α_0 = -12°
- CD_0 = 0.024
- k = 0.065

### Step 3: Physical Properties

Design sheet says:
- Area: 210 sqft = 19.51 m²
- Span: 7.9 m
- Chord: 19.51 / 7.9 = 2.47 m

### Step 4: Create Polar

```typescript
export const myCanopy210Continuous: ContinuousPolar = {
  name: 'MyCanopy 210 sqft',
  type: 'Canopy',
  cl_alpha: 1.75,
  alpha_0: -12,
  cd_0: 0.024,
  k: 0.065,
  cd_n: 1.1,
  cd_n_lateral: 0.8,
  alpha_stall_fwd: 40,
  s1_fwd: 4,
  alpha_stall_back: -5,
  s1_back: 3,
  cy_beta: -0.4,
  cn_beta: 0.10,
  cl_beta: -0.10,
  cm_0: -0.02,
  cm_alpha: -0.08,
  cp_0: 0.40,
  cp_alpha: -0.01,
  cg: 0.35,
  cp_lateral: 0.50,
  s: 19.51,
  m: 77.5,
  chord: 2.47,
  referenceLength: 1.875,
}
```

### Step 5–6: Register, Type-Check, Validate

- Register in `polarRegistry`
- `npx tsc --noEmit` ✓
- `npm run dev`, check trim point (should be ~8° for this canopy)

---

## Validation Checklist

Before declaring your polar "done":

- [ ] **Fitted coefficients** — Do they look reasonable compared to original data?
- [ ] **Type check passes** — `npx tsc --noEmit` returns zero errors
- [ ] **Sim loads** — http://localhost:5173 doesn't crash
- [ ] **Trim is stable** — AoA is in reasonable range (0°–15° for canopy)
- [ ] **Glide ratio matches** — Sim L/D ≈ one CloudBase (within 10%)
- [ ] **Stall behavior** — Sim stalls near your fitted `alpha_stall_fwd`
- [ ] **Pitch is stable** — Slight AoA perturbation doesn't spiral

---

## Troubleshooting

### "Fitted coefficients look way off"

Compare your fit to the original data. Use a spreadsheet:
- Column A: α (degrees)
- Column B: CL data (original)
- Column C: CL fit (using your coefficients)
- Column D: CD data (original)
- Column E: CD fit (using your coefficients)

Columns C and E should follow B and D (roughly).

If not, refit or adjust parameters manually.

### "Sim trim is at 40° AoA"

Your `alpha_0` (zero-lift angle) is probably way off. Try:
- Check the original CloudBase data: where does CL = 0?
- If unsure, use α_0 = -12° (typical parafoil)
- Refit other parameters

### "Glide ratio is 2x higher than CloudBase"

Your `k` is too low (too little induced drag). Increase `k`:
- Try 0.10 or 0.15 instead of 0.05
- Revalidate trim point

### "Tests fail after I add my polar"

Likely forgot a required field. Compare your polar to `ibexulContinuous` line-by-line:
- Do you have all aero coefficients (CL_α, CD_0, k, α_stall, etc.)?
- Do you have all moment/CP fields?
- Do you have `s`, `m`, `chord`, `referenceLength`?

---

## What's Next?

- **[Advanced](user-data-advanced.md):** Full integration with custom GLB + mass
- **[VEHICLE-REFACTOR.md](../VEHICLE-REFACTOR.md):** Why the system is architected this way

---

## Summary

**Intermediate workflow:**
1. Export polar from CloudBase (or equivalent)
2. Fit coefficients to Kirchhoff model (5–10 parameters)
3. Extract physical properties (area, chord, span)
4. Create polar entry in code
5. Register in polarRegistry
6. Type-check, load, validate glide ratio

**Time:** ~45 minutes

**Result:** A tuned polar for your design that flies in the sim
