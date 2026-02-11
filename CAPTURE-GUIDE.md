# GIF Capture Guide for README

Instructions for recording animated GIFs that demonstrate each continuous polar parameter in the Polar Visualizer. Each capture shows a parameter being adjusted in real time with the relevant chart visible.

---

## Toolchain

### Recording: ShareX (recommended for Windows)

- **Download:** https://getsharex.com (free, open source)
- **Why:** Built-in GIF recording, region capture, auto-save — no post-processing needed for simple captures
- **Setup:**
  1. Install ShareX
  2. Go to **Task settings → Screen recorder → Screen recording options**
  3. Set **FPS:** 15 (good balance of smoothness vs file size)
  4. Set **Output:** GIF
  5. Hotkey: `Ctrl+Shift+PrintScreen` starts/stops region recording

### Alternative: OBS Studio + ffmpeg

If you need higher quality or more control:

1. Record with OBS as MP4 (1080p, 30fps)
2. Convert with ffmpeg:
   ```bash
   # Crop to region, scale to 720px wide, 15fps, good palette
   ffmpeg -i input.mp4 -vf "crop=W:H:X:Y,scale=720:-1:flags=lanczos,fps=15,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" output.gif
   ```

### Optimization: gifsicle (optional, for size reduction)

```bash
gifsicle -O3 --lossy=80 --colors 128 input.gif -o output.gif
```

### Online alternative: ezgif.com

Upload MP4 → convert to GIF → crop/resize → optimize. No install needed.

---

## General Capture Settings

| Setting | Value | Notes |
|---------|-------|-------|
| Browser width | 1920px or wider | So charts render at full resolution |
| Capture region | Chart panel + relevant slider | Crop tight — exclude unrelated UI |
| GIF width | 600–800px | Good for GitHub README rendering |
| FPS | 12–15 | Smooth enough, keeps file size < 2MB |
| Duration | 3–6 seconds | Long enough to see full sweep |
| Loop | Yes (infinite) | GIFs loop by default |
| Color depth | 128 colors | Sufficient for chart content |

---

## Capture Composition Tips

- **Show the slider AND the chart together.** Crop the region so the viewer can see which knob is being turned and the chart response simultaneously.
- **Slow, steady sweeps.** Drag the slider smoothly from one end to the other over 4–5 seconds.
- **Start from the baseline.** Begin each capture at the default/baseline value, then sweep.
- **Use the Aura 5 (wingsuit) polar** as the default model unless otherwise noted — it has the clearest parameter responses.
- **Chart dropdown:** Make sure the correct chart type is selected before recording.
- **Legacy overlay:** Turn it ON for captures where comparison matters (CL, CD, CP). Turn it OFF when it clutters the visual.
- **Pause at extremes.** Hold at min and max for ~1 second so the viewer can read the values.

---

## Part 1 — Captures for Existing README Sections

These replace or supplement the current ASCII art diagrams and parameter tables.

---

### 1. Hero / Overview GIF

**What to show:** Full app — sweep α from -180° to +180° with CL vs α chart visible, 3D model rotating.

**Setup:**
- Model: Wingsuit, Polar: Aura 5
- Chart 1: CL vs α
- Legacy: ON
- Frame: Body Frame

**Action:**
1. Set α = -180°
2. Start recording (capture full app or at least 3D viewport + chart column)
3. Slowly drag α slider from -180° → +180° over ~6 seconds
4. Stop recording

**Crop:** Full app width, or 3D viewport + chart column (exclude sidebar if too wide)

**Filename:** `hero-alpha-sweep.gif`

---

### 2. CL_alpha — Lift Curve Slope

**What to show:** The effect of changing `cl_alpha` on the CL vs α curve.

**Problem:** `cl_alpha` is not an interactive slider in the current UI — it's baked into the polar definition.

**Workaround options:**
- **(A) Switch between polars** that have different `cl_alpha` values: Aura 5 (2.9) → Caravan (4.8) → Slick Sin (very low). Select each from the Polar dropdown while CL vs α chart is visible.
- **(B) Temporarily add a `cl_alpha` slider** to the app for capture purposes, then remove it. (I can help you add a temporary debug slider if you want.)

**Setup:**
- Chart 1: CL vs α
- Legacy: OFF (cleaner)
- α somewhere in the linear region (~10°)

**Action (Option A — switching polars):**
1. Start with Aura 5 selected
2. Start recording (capture: Polar dropdown + CL vs α chart)
3. Hold 1 sec → switch to Caravan → hold 1 sec → switch to Slick Sin → hold 1 sec → switch back to Aura 5
4. Stop recording

**Filename:** `effect-cl-alpha.gif`

**Note:** Option B (temporary slider) would produce a much better GIF — a smooth morph instead of discrete jumps. Let me know if you want me to add temporary param sliders to the app.

---

### 3. Alpha_0 — Zero-Lift AOA

**What to show:** Shifting the lift curve left/right by changing `alpha_0`.

**Same challenge as above** — `alpha_0` isn't a slider. 

**Workaround:** Compare Aura 5 (α₀ = -1°, slight camber) vs Slick Sin (α₀ = 0°, symmetric) vs Ibex UL (α₀ = -3°, cambered). Focus on where CL crosses zero.

**Setup:**
- Chart 1: CL vs α
- Legacy: OFF
- Zoom mental note: the zero-crossing region around α = -5° to +5° is the key area

**Action:**
1. Start recording (Polar dropdown + CL chart)
2. Switch between polars, pausing 1.5 sec on each
3. Stop

**Filename:** `effect-alpha-0.gif`

---

### 4. CD_0 — Parasitic Drag

**What to show:** How the drag "floor" shifts when switching between bodies with different `cd_0`.

**Setup:**
- Chart 1: CD vs α
- Legacy: OFF

**Action:**
1. Start recording (Polar dropdown + CD chart)
2. Switch: Caravan (0.029) → Aura 5 (0.101) → Ibex UL (0.12) → Slick Sin (0.467)
3. Pause 1.5 sec on each so the CD floor shift is visible
4. Stop

**Filename:** `effect-cd-0.gif`

---

### 5. K — Induced Drag Factor

**What to show:** How `k` affects the drag curve steepness / L/D max.

**Setup:**
- Chart 1: L/D vs α (best visual for k's effect)
- Legacy: OFF

**Action:**
1. Same polar-switching approach
2. Show L/D peak height changing between models
3. Caption will explain the k values

**Filename:** `effect-k.gif`

---

### 6. CD_n — Broadside Drag

**What to show:** Drag at α = 90° (broadside). The "roof" of the drag curve.

**Setup:**
- Chart 1: CD vs α
- Legacy: OFF
- Switch between polars (they have different `cd_n` values)

**Action:**
1. Start recording
2. Set α ≈ 90° so the cursor dot is at the peak
3. Switch between polars to show broadside drag varying
4. Stop

**Filename:** `effect-cd-n.gif`

---

### 7. Alpha Stall Forward — Stall Angle

**What to show:** Where CL peaks and starts dropping. This is one of the most dramatic parameters.

**Setup:**
- Chart 1: CL vs α
- Legacy: OFF

**Action:**
1. Start recording (Polar dropdown + CL chart)
2. Switch: Caravan (stalls at 22°) → Aura 5 (34.5°) → Slick Sin (45°)
3. The CL peak visibly slides along the α axis
4. Stop

**Filename:** `effect-alpha-stall-fwd.gif`

**This is one of the most impactful GIFs** — the stall point shifting is very visual on the CL curve.

---

### 8. S1_fwd — Stall Sharpness

**What to show:** Sharp vs gradual stall break (replaces the ASCII art in the README).

**Same challenge** — not a slider. Different polars have different `s1_fwd`:
- Caravan: 4° (moderate-sharp)
- Aura 5: 4° (moderate)  
- Slick Sin: 8° (very gradual)

**Setup:**
- Chart 1: CL vs α
- Legacy: OFF

**Action:**
1. Switch between Caravan and Slick Sin to show sharp vs gradual stall
2. The CL peak transition from sharp to rounded is the key visual

**Filename:** `effect-s1-fwd.gif`

**Note:** This one would benefit enormously from a temporary `s1_fwd` slider — the difference between 2° and 8° is dramatic. Consider adding a debug panel.

---

### 9. Sideslip — β Sweep

**What to show:** Effect of β (sideslip) on all coefficients — CL drops with cos²β, cross-flow drag appears.

**Setup:**
- Chart 1: CL vs α (or CD vs α)
- α fixed at ~20° (normal flight region)
- Legacy: OFF

**Action:**
1. Start recording (β slider + chart + readout panel showing CY, Cn, Cl_roll)
2. Slowly sweep β from 0° → 45° → 90° → back to 0°
3. Watch CL collapse, CD change, side force appear in readout
4. Stop

**Filename:** `effect-beta-sideslip.gif`

**This is an excellent capture** because β IS an existing slider, so you get smooth, continuous animation.

---

### 10. Pitching Moment & CP Travel

**What to show:** How CP moves along the chord as α changes.

**Setup:**
- Chart 1: CP vs α
- Legacy: ON (shows comparison)
- Polar: Aura 5

**Action:**
1. Start recording (α slider + CP chart)
2. Sweep α from 0° → 90° slowly
3. CP starts at ~0.35, migrates forward, then drifts toward 0.50 as flow separates
4. Stop

**Filename:** `effect-cp-travel.gif`

---

### 11. Dirty Flying Control

**What to show:** How the `dirty` control degrades performance — reduces CL, increases CD, earlier stall.

**Setup:**
- Chart 1: CL vs α
- Polar: Aura 5
- Legacy: OFF

**Action:**
1. Start recording (dirty slider + CL chart)
2. Slowly sweep dirty from 0.00 → 1.00
3. Watch the CL curve compress and stall point shift left
4. Stop

**Filename:** `effect-dirty-flying.gif`

**Another excellent capture** — dirty IS a slider, smooth animation.

---

### 12. Delta (Control Input)

**What to show:** How δ (brake/riser) morphs the polar.

**Setup:**
- Chart 1: CL vs α
- Polar: Ibex UL (canopy — has the most control authority)
- Legacy: OFF

**Action:**
1. Start recording (δ slider + CL chart)
2. Sweep δ from -1.0 → +1.0
3. Watch lift curve shift and morph
4. Stop

**Filename:** `effect-delta-control.gif`

---

### 13. Speed Polar

**What to show:** The performance envelope — Vxs vs Vys across all α.

**Setup:**
- Chart 2: Speed Polar (Vxs vs Vys)
- Polar: Aura 5
- Legacy: ON
- mph: your preference

**Action:**
1. Start recording (α slider + speed polar chart)
2. Sweep α from 0° → 90°
3. The white cursor dot traces the speed polar curve
4. Stop

**Filename:** `speed-polar-sweep.gif`

---

### 14. Legacy Overlay Toggle

**What to show:** Continuous model vs legacy table-interpolated data.

**Setup:**
- Chart 1: CL vs α
- Polar: Aura 5

**Action:**
1. Start recording (Legacy checkbox + CL chart)
2. Toggle Legacy ON → OFF → ON
3. Show continuous (thick rainbow) vs legacy (thin line) match
4. Stop

**Filename:** `legacy-overlay-toggle.gif`

---

## Part 2 — Additional Captures (Not Yet in README)

These would add value as new README sections or supplementary visuals.

---

### 15. Full-Range α Sweep with 3D Model

**What to show:** The 3D wingsuit rotating through full ±180° with force vectors dynamically changing.

**Setup:**
- Model: Wingsuit, Frame: Body Frame
- Good camera angle (orbit to ~30° above, slightly to the side)
- All vectors visible

**Action:**
1. Start recording (3D viewport only, no sidebar)
2. Sweep α from -180° → +180° slowly
3. Watch lift/drag vectors rotate and scale, moment arcs change
4. Stop

**Filename:** `3d-alpha-sweep.gif`

---

### 16. Model Comparison

**What to show:** Switching between all 4 models at the same α.

**Setup:**
- α ≈ 20°, Chart 1: CL vs α, Legacy: ON

**Action:**
1. Start recording (model dropdown + polar dropdown + chart)
2. Switch through: Wingsuit → Canopy → Skydiver → Airplane
3. Each model has dramatically different CL curve
4. Stop

**Filename:** `model-comparison.gif`

---

### 17. Body Frame vs Inertial Frame

**What to show:** 3D vectors in body frame vs inertial frame.

**Setup:**
- α ≈ 30° (vectors clearly angled)

**Action:**
1. Start recording (frame dropdown + 3D viewport)
2. Toggle Body Frame → Inertial Frame → Body Frame
3. Vectors snap between reference frames
4. Stop

**Filename:** `frame-comparison.gif`

---

### 18. Polar Curve (CL vs CD)

**What to show:** The drag polar shape — parabolic attached regime blending to flat-plate.

**Setup:**
- Chart 2: Polar Curve (CL vs CD)
- Legacy: ON

**Action:**
1. Start recording
2. Sweep α from 0° → 90° slowly
3. Cursor traces the polar curve
4. Stop

**Filename:** `polar-curve-sweep.gif`

---

### 19. Density Altitude Effect

**What to show:** How ρ (air density) affects sustained speeds but NOT coefficients.

**Setup:**
- Chart 2: Speed Polar
- Readout panel visible (forces section)

**Action:**
1. Start recording (ρ slider + speed polar + readout)
2. Sweep ρ from 1.225 (sea level) → 0.400 (high altitude)
3. Speed polar expands (faster speeds at altitude), forces change, coefficients don't
4. Stop

**Filename:** `effect-density.gif`

---

### 20. Kirchhoff Separation Function f(α)

**What to show:** The separation function itself — currently only shown in the readout panel.

**Suggestion:** Consider adding an f(α) vs α mini-chart, or capture the readout panel's f(α) value as α is swept. The readout shows `f(α)` numerically.

**Setup:**
- Readout panel visible (f(α) row)
- Chart 1: CL vs α (to show correlation)

**Action:**
1. Start recording (readout + CL chart)
2. Sweep α from 0° → 90°
3. Watch f(α) drop from 1.0 → 0.0 as CL stalls
4. Stop

**Filename:** `kirchhoff-separation.gif`

---

## Part 3 — Temporary Debug Sliders (Optional but Recommended)

The biggest limitation for captures 2, 3, 6, 7, 8 above is that `cl_alpha`, `alpha_0`, `cd_n`, `alpha_stall_fwd`, and `s1_fwd` are not exposed as interactive sliders — they're hardcoded per polar definition.

**Recommendation:** I can add a collapsible "Debug / Parameter Override" panel to the app with sliders for:

| Slider | Range | Default (Aura 5) |
|--------|-------|-------------------|
| `cl_alpha` | 1.0 – 6.0 | 2.9 |
| `alpha_0` | -10° – +10° | -1° |
| `cd_0` | 0.01 – 0.50 | 0.101 |
| `k` | 0.05 – 1.0 | 0.32 |
| `cd_n` | 0.5 – 2.0 | 1.1 |
| `alpha_stall_fwd` | 10° – 60° | 34.5° |
| `s1_fwd` | 1° – 15° | 4° |
| `cm_alpha` | -0.05 – 0.0 | -0.012 |

This would let you smoothly sweep each parameter and capture a beautiful, continuous GIF instead of switching between discrete polar presets. The panel can be hidden behind a toggle so it doesn't clutter the normal UI.

**Let me know if you'd like me to implement this debug panel — it would make captures 2, 3, 6, 7, 8 dramatically better.**

---

## File Organization

Store all GIFs in the repo:

```
polar-visualizer/
├── docs/
│   └── gifs/
│       ├── hero-alpha-sweep.gif
│       ├── effect-cl-alpha.gif
│       ├── effect-alpha-0.gif
│       ├── effect-cd-0.gif
│       ├── effect-k.gif
│       ├── effect-cd-n.gif
│       ├── effect-alpha-stall-fwd.gif
│       ├── effect-s1-fwd.gif
│       ├── effect-beta-sideslip.gif
│       ├── effect-cp-travel.gif
│       ├── effect-dirty-flying.gif
│       ├── effect-delta-control.gif
│       ├── speed-polar-sweep.gif
│       ├── legacy-overlay-toggle.gif
│       ├── 3d-alpha-sweep.gif
│       ├── model-comparison.gif
│       ├── frame-comparison.gif
│       ├── polar-curve-sweep.gif
│       ├── effect-density.gif
│       └── kirchhoff-separation.gif
```

### README Embedding

```markdown
#### Effect of `cl_alpha`

![Effect of cl_alpha](polar-visualizer/docs/gifs/effect-cl-alpha.gif)
```

### Size Budget

GitHub renders README images inline. Keep each GIF:
- **Width:** 600–800px (renders well on all screens)
- **File size:** Under 2–3 MB per GIF (GitHub warns at 10MB, hard limit at 25MB)
- **Duration:** 3–6 seconds
- **If too large:** Reduce FPS to 10, reduce colors to 64, or use gifsicle `--lossy=100`

---

## Quick Checklist

- [ ] Install ShareX (or set up OBS + ffmpeg)
- [ ] Run `npm run dev` in `polar-visualizer/`
- [ ] Open browser to full width
- [ ] Capture GIFs per the instructions above
- [ ] Optimize with gifsicle if needed
- [ ] Place in `polar-visualizer/docs/gifs/`
- [ ] Update README.md with `![](...)` references
- [ ] (Optional) Ask me to add debug parameter sliders for smoother captures
