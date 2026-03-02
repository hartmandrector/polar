# Simulation & Technical Documentation — GIF Capture Guide

Same toolchain as CAPTURE-GUIDE.md (ShareX region capture, 12–15 fps, 600–800px wide, < 3MB).

For sim captures: **run the sim with gamepad**, capture the 3D viewport + sim panel showing inputs. The gamepad visualization panel makes inputs readable in the gif.

---

## Part 1 — Simulation Captures

### 1. Hero: Wingsuit Flight with Gamepad

**The showcase gif for STATUS.md and sim-overview.md.**

Show: Stable wingsuit flight with visible pitch/roll inputs on gamepad panel + force vectors + HUD telemetry.

- Polar: A5 Segments, Frame: Body, Start sim
- Fly steady for 2s, gentle pitch up, hold, pitch down, gentle roll turn
- Capture: 3D viewport + sim panel (sticks + HUD visible)
- Duration: 6–8s

`sim-hero-wingsuit.gif`

---

### 2. Canopy Flight with Brakes

Show: Canopy brake input → asymmetric force response → turn initiation.

- Polar: Ibex UL, Frame: Inertial, Start sim
- Fly straight 2s, apply left brake (LT) gradually, hold turn, release, apply right brake
- Capture: 3D viewport + sim panel (trigger bars filling visible)

`sim-canopy-brakes.gif`

---

### 3. Canopy Riser Input

Show: Front riser dive → speed increase, rear riser → flare/slow.

- Polar: Ibex UL, Start sim
- Push left stick forward (front risers) — watch speed increase in HUD
- Pull back (rear risers) — watch speed decrease
- Capture: 3D viewport + sim panel + HUD speed readout

`sim-canopy-risers.gif`

---

### 4. Wingsuit Yaw (Trigger Differential)

Show: Yaw control via LT/RT triggers → heading change + sideslip.

- Polar: A5 Segments, Frame: Inertial, Start sim
- Squeeze RT gradually → yaw right, release, squeeze LT → yaw left
- Capture: 3D viewport + sim panel (trigger bars show differential yaw)

`sim-wingsuit-yaw.gif`

---

### 5. Wingsuit Roll Requires Active Piloting

Show: Roll input → bank → needs continuous correction (realistic feel).

- Polar: A5 Segments, Start sim
- Quick roll right, hold, correct back to level, roll left
- Capture: 3D viewport + sim panel (right stick X deflection visible)

`sim-wingsuit-roll.gif`

---

### 6. Frame Toggle During Flight

Show: Body frame → Inertial frame switch while flying (vectors snap between reference frames).

- Start sim in Body Frame, fly steady
- Press View button (☰☰) mid-flight — vectors snap to inertial
- Press again — back to body frame
- Capture: 3D viewport + frame label if visible

`sim-frame-toggle.gif`

---

### 7. Polar Switch During Flight

Show: Switching from wingsuit to canopy mid-sim (or vice versa) — demonstrates vehicle-aware gamepad auto-switching.

- Start sim on A5 Segments
- Press RB to cycle to Ibex UL — model changes, gamepad labels update
- Capture: 3D viewport + sim panel (labels change from Pitch/Roll → L Riser/R Riser)

`sim-polar-switch.gif`

---

### 8. Orbit Camera While Flying (Wingsuit)

Show: Left stick orbiting the camera around the flying model.

- Polar: A5 Segments, Start sim, fly stable
- Slowly orbit camera with left stick — show the model from multiple angles while force vectors track
- Capture: 3D viewport only

`sim-orbit-camera.gif`

---

## Part 2 — FRAMES.md Equation Visualizations

These replace long equation blocks with a quick gif showing the physical meaning.

---

### 9. §2.3 Wind Frame: α and β Definition

Show: Sweep α with velocity vector visible, then sweep β — demonstrate how wind frame rotates relative to body.

- Frame: Body, vectors visible
- Sweep α slowly 0°→45°→0°, then sweep β 0°→30°→0°
- Capture: 3D viewport showing velocity vector + lift/drag vectors rotating

Explains: $\alpha = \arctan(w/u)$, $\beta = \arcsin(v/V)$

`frames-alpha-beta-definition.gif`

---

### 10. §4.1–4.2 DCM: Body↔Inertial Transform

Show: Same flight condition viewed in both frames — vectors identical in magnitude but rotated.

- Set α ≈ 30°, roll ≈ 15°
- Toggle Body → Inertial → Body
- Capture: 3D viewport

Explains: $\vec{V}_E = [EB]\,\vec{V}_B$ — the DCM just rotates the coordinate axes

`frames-dcm-body-inertial.gif`

---

### 11. §6.1 Rotating-Frame ω×v Correction

Show: Add roll rate → watch per-segment velocity vectors change (outer wing speeds up, inner slows down).

- Frame: Body, α ≈ 20°
- Sweep roll rate (φ̇) from 0 → 30°/s → 0
- Capture: 3D viewport showing per-segment local velocity vectors fanning asymmetrically

This is the existing `effect-euler-roll-rate.gif` — already captured! Just needs linking into FRAMES.md.

`(existing: effect-euler-roll-rate.gif)`

---

### 12. §6.2 Euler's Equation: Moment Vectors

Show: Moment arcs (pitch, roll, yaw) responding to α and control inputs.

- Frame: Body, α sweep or throttle sweep
- Capture: 3D viewport zoomed on moment arcs
- Show pitch moment arc growing/shrinking/flipping as α crosses trim

`frames-moment-arcs.gif`

---

### 13. §10 Per-Segment ω×r Velocity Correction

Show: With roll rate, each segment sees different local velocity — force vectors become asymmetric.

- Frame: Body, 6-segment wingsuit
- Apply roll rate → outer wing generates more lift, inner wing less
- Capture: 3D viewport showing asymmetric force vectors across segments

Explains the automatic damping derivatives from §10.4 — you don't need explicit $C_{l_p}$, the per-segment ω×r does it naturally.

`frames-segment-velocity-correction.gif`

---

### 14. §11 CP Offset in Body Frame

Show: CP diamond moving along chord as α changes.

- Mass overlay ON, α sweep 0° → 60°
- Watch CP diamond migrate forward then back toward half-chord
- Capture: 3D viewport zoomed on model + CP diamond

`frames-cp-offset.gif`

---

## Part 3 — KIRCHHOFF.md Equation Visualizations

---

### 15. §2 Separation Function f(α)

Show: CL curve with annotation or readout showing f(α) value — f=1.0 (attached) smoothly dropping to f=0.0 (separated).

- Chart 1: CL vs α, readout panel visible (f(α) value)
- Sweep α from 0° → 90° slowly
- Capture: CL chart + readout f(α) value

Explains: $f(\alpha) = \sigma_{\text{fwd}} \cdot \sigma_{\text{back}}$ — the double-sigmoid separation model

`kirchhoff-separation-function.gif`

---

### 16. §3.1–3.2 Attached vs Flat-Plate Sub-Models

Show: At low α, CL/CD follow the attached (linear) model. At high α, they follow flat-plate (sin²α, sin·cos).

- Chart 1: CL vs α with legacy ON
- Sweep α from 0° → 180°
- Capture: chart showing the transition from linear ramp → sine-cosine flat plate

The rainbow gradient on the continuous curve already shows this beautifully — the color shift marks the blending.

`kirchhoff-attached-vs-flatplate.gif`

---

### 17. §4.1 CL Blending: √f·CL_attached + (1-f)·CL_flat

Show: The Kirchhoff blending — how CL transitions from attached to flat-plate.

Same as #16 but with zoomed crop on the stall transition region (α ≈ 20°–50°) where f transitions from 1→0.

`kirchhoff-cl-blending.gif`

---

### 18. §5 Control Morphing (δ)

Show: Sweep brake/riser δ and watch the polar curve morph in real time.

- Polar: Ibex UL, Chart 1: CL vs α or Polar Curve
- Sweep δ slider from -1 → +1
- Capture: δ slider + chart

Explains: How δ offsets cl_alpha, alpha_stall, cd_0, etc. — the "phantom angle" approach.

`kirchhoff-delta-morphing.gif`

---

### 19. §6 Canopy Cell Segment: Deploy Scaling

Show: Deploy slider from 0% → 100% — canopy inflates, force vectors grow.

- Polar: Ibex UL, deploy slider
- Sweep deploy from 0% → 100%
- Capture: 3D viewport + deploy slider

Already partially captured as `deployment.gif` — could recapture with force vectors more prominent.

`(existing: deployment.gif — consider recapture with per-segment forces visible)`

---

### 20. §9 Variable-Area Brake Flap

Show: Brake input → flap extends from trailing edge, changes per-cell force distribution.

- Polar: Ibex UL with brakes visible
- Apply left brake gradually — watch flap extend, force vectors shift
- Capture: 3D viewport zoomed on canopy cells

`kirchhoff-brake-flap.gif`

---

### 21. §10 Wingsuit Throttle Controls

Show: Each throttle control's effect — pitch shifts trim, roll creates asymmetry, yaw creates differential, dirty degrades performance.

- Polar: A5 Segments, frame: Body
- Sweep each throttle one at a time: pitch → roll → yaw → dirty
- Capture: 3D viewport + throttle sliders

Some already captured (`backfly throttles.gif`). Worth a clean recapture showing the sim panel with control labels.

`kirchhoff-wingsuit-throttles.gif`

---

## Part 4 — Chart Enhancements (Pre-Capture)

Before capturing chart-focused gifs, consider adding these visual improvements:

### Glide Lines on Speed Polar
- Tangent line from origin to speed polar curve = best L/D
- Horizontal tangent = min sink rate
- These are the two most important performance points — worth showing

### L/D Annotation on CL vs CD Polar Curve
- Tangent from origin to polar curve = max L/D operating point
- Add thin dashed line from origin tangent to curve

### Stall Region Shading
- Light red/orange shaded band on CL chart showing the stall transition region (where f < 0.5)
- Helps visually distinguish attached/separated regimes

### Current Operating Point Marker
- The existing dot on charts is good — ensure it's prominent in captures

---

## Part 5 — Non-Sim Static Captures Still Needed

These don't require the sim running — just slider sweeps.

| # | What | Slider | Chart | Status |
|---|------|--------|-------|--------|
| A | CP travel vs α | α | CP vs α | Not yet captured |
| B | Speed polar full sweep | α | Speed Polar | Not yet captured |
| C | Density altitude effect | ρ | Speed Polar + readout | Not yet captured |
| D | Dirty flying (6-seg) | dirty | CL vs α | Not yet captured |
| E | Dihedral effect | dihedral | 3D viewport | Not yet captured |
| F | Canopy area scaling | area slider (debug) | 3D viewport | Not yet captured |
| G | Pilot pitch effect (extended) | pilot pitch slider | 3D viewport + forces | Partial (`deploy-headup...gif`) |
| H | Legacy vs continuous overlay | legacy toggle | any chart | Not yet captured |

---

## File Organization

```
polar-visualizer/docs/gifs/
├── (existing 19 gifs)
├── sim-hero-wingsuit.gif          # Part 1
├── sim-canopy-brakes.gif
├── sim-canopy-risers.gif
├── sim-wingsuit-yaw.gif
├── sim-wingsuit-roll.gif
├── sim-frame-toggle.gif
├── sim-polar-switch.gif
├── sim-orbit-camera.gif
├── frames-alpha-beta-definition.gif  # Part 2
├── frames-dcm-body-inertial.gif
├── frames-moment-arcs.gif
├── frames-segment-velocity-correction.gif
├── frames-cp-offset.gif
├── kirchhoff-separation-function.gif  # Part 3
├── kirchhoff-attached-vs-flatplate.gif
├── kirchhoff-cl-blending.gif
├── kirchhoff-delta-morphing.gif
├── kirchhoff-brake-flap.gif
└── kirchhoff-wingsuit-throttles.gif
```

## Priority Order

**High value, easy capture (do first):**
1. `sim-hero-wingsuit.gif` — the showcase
2. `sim-canopy-brakes.gif` — trigger bars filling = great visual
3. `frames-alpha-beta-definition.gif` — replaces paragraphs of math
4. `kirchhoff-separation-function.gif` — core concept of the whole aero model

**High value, needs chart enhancement first:**
5. Speed polar with glide lines (Part 4 enhancement → then capture B)
6. L/D annotation on polar curve (Part 4 → then recapture polar sweep)

**Recaptures of existing (lower priority):**
7. Deployment with per-segment forces visible
8. Wingsuit throttles with sim panel showing inputs
