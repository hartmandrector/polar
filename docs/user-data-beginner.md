# User-Data: Beginner Level

## I Have FlySight Logs — Tune an Existing Polar

> **Time:** ~15 minutes
> **Difficulty:** Low — no code logic, just data entry
> **Outcome:** A new named polar that matches your flight characteristics

---

## Scenario

You flew your setup (same wingsuit + canopy as one of the defaults), logged the flight with FlySight, and notice the sim doesn't quite match your actual glide ratio or turn rate. You want to create a tuned polar that fits your data better.

**You'll:**
1. Pick the closest default polar as a starting point
2. Identify which coefficients to tweak (glide → `k`; turn rate → `cl_alpha`, etc.)
3. Create a new polar entry in the code with tweaked values
4. Validate against your FlySight logs
5. Iterate (only change 1–2 coefficients per iteration)

---

## Step 1: Identify Your Starting Polar

Open `polar-visualizer/src/polar/polar-data.ts` and find the configuration that matches you:

| If you're flying... | Start with... | Find it at... |
|-----|-----|-----|
| Aura 5 wingsuit | `aurafiveContinuous` | Line ~1075 |
| Ibex UL canopy | `ibexulContinuous` | Line ~1165 |
| Slicksin skydiving suit | `slicksinContinuous` | Line ~1235 |
| Caravan (skydiving) | `caravanContinuous` | Line ~1265 |

If your setup doesn't exactly match, **pick the closest one**. Tweaking it is safer than building from scratch.

### Finding the Right Polar in the UI

When the vehicle selector is implemented, you'll see all registered polars in a dropdown. For now, the defaults are hardwired in `main.ts`.

---

## Step 2: Understand Which Fields to Modify

**Safe to change (affects flight):**
- `cl_alpha` — How much lift per degree. Lower = less aggressive, flatter glide ratio
- `cd_0` — Minimum drag. Lower = faster sink, better glide
- `k` — Induced drag. Higher = more draggy at shallow angles; lower = better glide ratio
- `alpha_stall_fwd` / `s1_fwd` — Forward stall point and sharpness

**Optional (advanced pilots):**
- `cp_0` — Where lift acts (affects pitch trim)
- `cm_alpha` — Pitch stability (affects how much input needed to change pitch)

**Do NOT change without a clear reason:**
- `m` (mass) — You didn't gain/lose 5 kg in a flight
- `chord` — Your suit didn't shrink
- `s` (area) — Planform area is fixed
- `referenceLength` — Pilot height doesn't change between flights

### Typical Tweaks

| Problem | Adjust | Direction |
|---------|--------|-----------|
| "Glide ratio is worse than expected" | `k` | Decrease from 0.360 to 0.340 |
| "Sink rate is high" | `cd_0` | Decrease from 0.097 to 0.090 |
| "Turns feel slow/unresponsive" | `cl_alpha` | Increase from 2.9 to 3.0 |
| "Stalls too easily in turns" | `alpha_stall_fwd` | Increase from 31.5 to 33 |

**Golden Rule:** Change **one** coefficient by 5–10%, test, observe, then adjust or move to the next.

### How These Affect Your Flight

![Effect of induced drag coefficient (k)](gifs/effect-cd-0.gif)
*Lower CD₀ → less drag → better glide ratio and lower sink rate*

![Effect of lift curve slope (CL_α)](gifs/effect-cl-alpha.gif)
*Higher CL_α → more aggressive response to control input → tighter turns*

![Effect of stall behavior](gifs/effect-alpha-stall-fwd.gif)
*Adjusting the stall angle affects how responsive your setup is before stalling*

---

## Step 3: Create a New Polar Entry

Open `polar-visualizer/src/polar/polar-data.ts`.

Find the polar you want to modify (e.g., `aurafiveContinuous`). Copy the entire object and paste it as a new entry **below** the original:

```typescript
// Example: Creating a tuned Aura 5 for my specific setup

export const aurafiveContinuous_MyTune: ContinuousPolar = {
  name: 'Aura 5 — My Tune v1',  // Descriptive name
  type: 'Wingsuit',

  // Copy all fields from aurafiveContinuous, then tweak...
  cl_alpha: 3.0,                // Increased from 2.9 (test tighter turns)
  alpha_0: -2,
  cd_0: 0.095,                   // Decreased from 0.097 (slightly faster)
  k: 0.350,                      // Decreased from 0.360 (better glide)
  
  cd_n: 1.1,
  cd_n_lateral: 1.0,
  alpha_stall_fwd: 31.5,
  s1_fwd: 3.7,
  alpha_stall_back: -34.5,
  s1_back: 7,
  cy_beta: -0.3,
  cn_beta: 0.08,
  cl_beta: -0.08,
  cm_0: -0.02,
  cm_alpha: -0.08,
  cp_0: 0.40,
  cp_alpha: -0.05,
  cg: 0.40,
  cp_lateral: 0.50,
  s: 2,
  m: 77.5,
  chord: 1.8,
  referenceLength: 1.875,
  
  massSegments: WINGSUIT_MASS_SEGMENTS,
  cgOffsetFraction: 0.197,
  
  controls: {
    brake: {
      d_cp_0:             0.03,
      d_alpha_0:         -0.5,
      d_cd_0:             0.005,
      d_alpha_stall_fwd: -1.0,
    },
    dirty: {
      d_cd_0:             0.025,
      d_cl_alpha:        -0.3,
      d_k:                0.08,
      d_alpha_stall_fwd: -3.0,
      d_cp_0:             0.03,
      d_cp_alpha:         0.02,
    }
  }
}
```

### Naming Convention
Use a name that includes:
- Base polar name (`Aura 5`)
- What you changed (`MyTune`, `Lower_Glide`, `Tighter_Turns`)
- Version number (`v1`, `v2`)

Example: `aurafiveContinuous_GlideTune_v2`

---

## Step 4: Register Your Polar

At the bottom of `polar-data.ts`, find the registry object. It looks like:

```typescript
export const polarRegistry = {
  aurafive: aurafiveContinuous,
  ibexul: ibexulContinuous,
  slicksin: slicksinContinuous,
  caravan: caravanContinuous,
  a5segments: a5segmentsContinuous,
}
```

Add your new polar to this list:

```typescript
export const polarRegistry = {
  aurafive: aurafiveContinuous,
  aurafive_myTune: aurafiveContinuous_MyTune,  // Add here
  ibexul: ibexulContinuous,
  // ... rest
}
```

**Key:** The first part of the dictionary key (`myTune`) should match the variable name (without the `aurafiveContinuous_` prefix).

---

## Step 5: Validate Your Polar

### Type Check (No Errors)
Run the type checker:
```bash
cd polar-visualizer
npx tsc --noEmit
```
You should see **zero errors**. If you see errors, you likely:
- Forgot a required field
- Misspelled a field name
- Didn't copy-paste all the control derivatives

### Load the Sim
Start the dev server:
```bash
npm run dev
```
Open `http://localhost:5173` in your browser. The sim should load without crashing.

### Trim Check (Sanity)
In the control panel, look at the trim point (AoA where forces balance):
- Should be ~8–15° for a wingsuit
- Should be ~0–5° for a canopy
- Should NOT be 80° or negative (something's wrong)

---

## Step 6: Compare to FlySight Data

### Export FlySight Log
1. Go to https://www.flysight.ca/viewer
2. Upload your flight log
3. Click **Export** → CSV
4. Save the file (e.g., `my-flight.csv`)

### Load Into Sim (When Available)
When the FlySight importer is added to this project, you'll be able to:
1. Load your CSV
2. Overlay your actual flight path
3. Overlay the sim trajectory
4. Compare glide ratio, turn radius, sink rate

**For now:** Manually compare key metrics:

| Metric | How to Get It |
|--------|--------------|
| **Glide Ratio** | Horizontal distance / vertical distance from FlySight |
| **Turn Radius** | FlySight shows this in the web viewer |
| **Sink Rate** | FlySight vertical velocity average |
| **Stall Point** | Lowest AoA before hard stall in FlySight |

---

## Step 7: Iterate

If your new polar doesn't match:

1. **Glide ratio is off:** Tweak `k` (higher = better glide) and `cd_0` (lower = faster)
2. **Turn rate is off:** Tweak `cl_alpha` (higher = tighter turns)
3. **Stall behavior wrong:** Tweak `alpha_stall_fwd` and `s1_fwd`
4. **Pitch feels weird:** Tweak `cm_alpha` (more negative = more stable)

**Each iteration:**
1. Modify coefficients
2. Save file
3. Browser hot-reloads (or manual refresh)
4. Compare to FlySight
5. Go to step 1 if not right yet

**Pro tip:** Create `aurafiveContinuous_MyTune_v2`, `v3`, etc. Don't overwrite `v1`. That way you can compare versions and track what worked.

---

## Common Mistakes

| Mistake | Why It's Wrong | Fix |
|---------|----------------|-----|
| Changing `m` or `chord` | You don't gain/lose mass between flights | Don't change these |
| Modifying the default polar directly | Breaks all tests + your next flight | Always create a new entry |
| Forgetting to add to registry | Your polar exists but sim doesn't know about it | Add to `polarRegistry` at bottom |
| Changing `referenceLength` | Scales all moment arms; breaks physics | Keep it at 1.875 (or match your height in meters) |
| Large changes (e.g., `cl_alpha`: 2.9 → 5.0) | Physics blows up; can't debug | Change by 5–10% per iteration |

---

## Example: Complete Walkthrough

**Scenario:** I flew my Aura 5 + Ibex UL, and my glide ratio is 15% better than the sim predicts.

**Step 1:** Pick `aurafiveContinuous` starting point

**Step 2:** Glide ratio is high → `k` is too high (too much drag) → decrease `k`

**Step 3:** Create new entry:
```typescript
export const aurafiveContinuous_BetterGlide: ContinuousPolar = {
  name: 'Aura 5 — Better Glide',
  type: 'Wingsuit',
  cl_alpha: 2.9,
  alpha_0: -2,
  cd_0: 0.097,
  k: 0.340,               // Decreased from 0.360
  // ... rest copied ...
}
```

**Step 4:** Register:
```typescript
export const polarRegistry = {
  aurafive: aurafiveContinuous,
  aurafive_betterGlide: aurafiveContinuous_BetterGlide,  // Add
  // ...
}
```

**Step 5:** Type check: `npx tsc --noEmit` ✓

**Step 6:** Load sim, check trim point (should be ~10° AoA) ✓

**Step 7:** Export FlySight data, compare glide ratio
- Old sim: 15.2:1
- New sim: 16.8:1
- Actual flight: 16.5:1
- Good match! ✓

**If not perfect:** Create `_BetterGlide_v2`, tweak `k` again, re-test.

---

## What's Next?

If you want to go deeper:

- **[Intermediate](user-data-intermediate.md):** Integrate a CloudBase polar or custom aero data
- **[Advanced](user-data-advanced.md):** Build a full custom vehicle with your GLB + mass measurements
- **[VEHICLE-REFACTOR.md](../VEHICLE-REFACTOR.md):** Understand the architecture behind why this works

---

## Troubleshooting

### "I changed a coefficient but the sim behavior didn't change"
- Did you restart the dev server? (`npm run dev`)
- Did you add the polar to the registry? (Check `polarRegistry` at bottom of polar-data.ts)
- Did you reload the browser page?

### "Type check fails with 'missing property'"
- Check that you copied *all* fields from the original polar
- Look at the error message — it'll tell you which field is missing
- Compare your polar to the original line-by-line

### "The sim crashes when I select my polar"
- Likely a missing control derivatives object
- Make sure `controls` has `brake` and `dirty` sub-objects
- Copy them from the original if unsure

### "Trim point is at 80° AoA"
- Your coefficients are way off
- Revert to the original polar and make smaller changes
- Change one coefficient by 5% at a time, not 50%

---

## Summary

**Beginner workflow:**
1. Copy an existing polar
2. Tweak 1–2 coefficients
3. Register it
4. Type-check & test
5. Compare to FlySight
6. Iterate

**Time:** ~15 minutes per cycle

**Next:** Ready for intermediate, or questions? See the troubleshooting section.
