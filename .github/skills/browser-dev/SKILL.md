---
name: browser-dev
description: '**WORKFLOW SKILL** — Run, inspect, and iterate on the Polar Visualizer (`/`) and GPS Flight Viewer (`/gps`) in a real browser to develop and validate aero/visualization features. USE FOR: visually verifying force/moment vector changes; checking model rotation in body vs inertial frames; loading GPS tracks for replay; manipulating sliders, dropdowns, and checkboxes via Playwright; capturing screenshots for review; iterating on 3D scene-graph or rendering fixes that cannot be confirmed by `tsc` or `vitest` alone. DO NOT USE FOR: pure code refactors with no visual surface; unit-test-only changes; physics math validated by tests. INVOKES: `run_in_terminal` (dev server), `open_browser_page`, `navigate_page`, `screenshot_page`, `click_element`, `run_playwright_code`, `read_page`. Update this skill whenever a new pattern, URL param, or gotcha is discovered.'
---

# Browser-Based Development for Polar Visualizer

This project has rich 3D visualizations that cannot be validated by `tsc` or `vitest` alone. This skill describes how to run the dev server, load scenarios, manipulate UI, and capture screenshots so you can iterate on visual features without constant supervision.

## Two Apps, Two URLs

| App | URL | Purpose |
|---|---|---|
| **Polar Visualizer** | `http://localhost:5173/` | Aero model + 3D model. Shows **one frame at a time** (body **or** inertial, switchable via dropdown). More complete aerodynamics surface. Best for testing model rendering, vectors, segment math, sliders. |
| **GPS Flight Viewer** | `http://localhost:5173/gps` | Replays real GPS flights. Shows **two scenes simultaneously** (inertial + body frame side-by-side). Best for validating overlays against real data. Less complete but uses real flight inputs. |

> Note the GPS URL is `/gps` (no `.html`). Both work but `/gps` is canonical.

## Starting the Dev Server

**CRITICAL**: Run from `polar-visualizer/`, **not** the repo root. Running from `c:\dev\polar` will fail with exit code 1.

```powershell
cd c:\dev\polar\polar-visualizer
npm run dev
```

Use `mode=async` since the dev server is long-running. Note the actual port from output — Vite auto-bumps to 5174, 5175, etc. if 5173 is busy.

If a port other than 5173 is in use, **substitute it** in every URL below.

## URL Parameters (the Power Tool)

You can preload almost any scenario via the URL — far easier than driving the UI by hand.

### GPS Viewer params (`/gps?...`)

| Param | Values | Effect |
|---|---|---|
| `track` | path to TRACK.CSV under `/public/` (no leading `/`) | Auto-loads flight, e.g. `track=07-29-25/TRACK.CSV` |
| `trim` | number (degrees) | Canopy trim offset |
| `roll` | `gps`, `blended`, `kalman`, etc. | Roll estimation method |
| `overlays` | `0` / `1` | Show/hide aero overlay arrows |
| `solver` | `0` / `1` | Enable Pass-2 control inversion solver |
| `axis` | `none`, `euler`, `body`, `both` | Axis-helper visibility |
| `kf` | `0` / `1` | Enable keyframe overrides |
| `sensor` | path to fused sensor CSV | Override auto-detected SENSOR fusion file |
| `keyframes` | base64-encoded keyframe JSON | Inject keyframe data |
| `session` | base64-encoded full session state | Restore complete capture session |

**Recommended GPS test URL** (track loaded + sensible defaults):

```
http://localhost:5173/gps?track=07-29-25/TRACK.CSV&roll=blended&overlays=0&axis=none&kf=1
```

Other available tracks under `polar-visualizer/public/`:
- `03-27-26/TRACK.CSV`
- `04-28-25/TRACK.CSV`
- `05-02-2025-1/TRACK.CSV`
- `05-04-25/TRACK.CSV`
- `07-29-25/TRACK.CSV`

(Run `Get-ChildItem -Path c:\dev\polar\polar-visualizer\public -Recurse -Filter TRACK.CSV` to enumerate.)

### Polar Visualizer params

The polar viz currently has no documented URL params — drive it via UI sliders/dropdowns. If you add params later, update this skill.

## ⚠️ Window/Viewport Size Matters

The screenshot tool's headless browser has an effective window of **~962px wide** regardless of `setViewportSize()`. The `#chart-column` panel on the right (~480px wide) and the `#sidebar` controls (~280px wide) leave only ~200px for the 3D `#viewport` canvas — the model is unreadable in that space.

**Fix before screenshotting**: hide the chart column and force the viewport to flex:

```js
await page.evaluate(() => {
  const cc = document.getElementById('chart-column');
  if (cc) cc.style.display = 'none';
  const vp = document.getElementById('viewport');
  if (vp) { vp.style.flex = '1 1 auto'; vp.style.width = '100%'; }
  window.dispatchEvent(new Event('resize'));  // triggers Three.js renderer resize
});
```

This grows the canvas from ~202×562 to ~682×562 — enough for clear screenshots of model + axes + arrows.

**Also hide the sim/gamepad overlay** (a `position:fixed` panel that floats over the viewport):

```js
await page.evaluate(() => {
  for (const el of document.querySelectorAll('div')) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && (el.textContent || '').includes('Gamepad') && el.children.length < 30) {
      el.style.display = 'none';
    }
  }
});
```

If screenshots show overlapping panels, run both snippets and re-capture.

## Manipulating UI from Code

### Sliders — value + dispatch pattern

`<input type="range">` requires both `input` and `change` events to be dispatched after setting `.value` for the app to react:

```js
const slider = (await page.$$('input[type="range"]'))[INDEX];
await slider.evaluate((node, val) => node.value = val, '45');
await slider.evaluate(node => {
  node.dispatchEvent(new Event('input',  { bubbles: true }));
  node.dispatchEvent(new Event('change', { bubbles: true }));
});
```

**Polar Visualizer slider indices** — verified empirically (Wingsuit BASE, Inertial frame, default panel state):

| Index | Slider |
|---|---|
| 0 | α (AOA) |
| 1 | β (Sideslip) |
| 2 | Airspeed |
| 3 | ρ (Density) |
| 4 | Pitch Throttle |
| 5 | Yaw Throttle |
| 6 | Roll Throttle |
| 7 | Dirty |
| 8 | Dihedral |
| 9 | Deploy |
| 10–16 | (Debug Overrides block sliders — only present if Debug Overrides is expanded) |
| 17 | φ (Roll) |
| 18 | θ (Pitch) |
| 19 | ψ (Yaw) |
| 20 | φ̇ (Roll Rate) |
| 21 | θ̇ (Pitch Rate) |
| 22 | ψ̇ (Yaw Rate) |

> **Don't trust this table blindly** — indices shift if Debug Overrides is collapsed/expanded or panels change. The robust pattern is to **find sliders by their label text** instead of by index:
>
> ```js
> const all = await page.$$('input[type="range"]');
> let phi = -1, theta = -1, psi = -1;
> for (let i = 0; i < all.length; i++) {
>   const txt = await all[i].evaluate(n => n.closest('div')?.textContent || '');
>   if (txt.includes('φ (Roll)') && phi < 0) phi = i;
>   else if (txt.includes('θ (Pitch)') && theta < 0) theta = i;
>   else if (txt.includes('ψ (Yaw)') && psi < 0) psi = i;
> }
> ```
>
> The Attitude block (φ/θ/ψ) only appears in **Inertial Frame** mode.

### Dropdowns and checkboxes

Use `click_element` with the `ref=eXX` from the accessibility snapshot. Snapshots refresh after every interaction — re-read them; don't reuse stale `ref` ids across many turns.

```
click_element(ref="e45")   # frame mode dropdown → Inertial
```

### Reading state

After every UI change, the snapshot shows updated readout values (CL, CD, forces, moments, etc.). Use those for numerical validation before screenshotting.

## Screenshots & Camera Composition

### Tools

- `screenshot_page` — captures the whole viewport.
- `read_page` — text-only; use for state tables, debug overlays, readouts.

### Driving the camera (dev hooks)

Both apps expose dev hooks with live `camera`, `controls`, `scene`, and `renderer`:

| App | Hook | Scene fields |
|---|---|---|
| Polar Visualizer | `window.__polar` | `camera`, `controls`, `scene`, `renderer` |
| GPS Flight Viewer | `window.__polarGps` | `inertialScene`, `bodyScene` (each with `camera`, `controls`, `scene`, `renderer`) |

```js
// Polar visualizer
await page.evaluate(() => {
  const p = window.__polar;
  p.camera.position.set(3.30, 4.18, 3.80);
  p.controls.target.set(0, 0, 0);
  p.camera.zoom = 1.0;
  p.camera.updateProjectionMatrix();
  p.controls.update();
});

// GPS viewer (body-frame pane)
await page.evaluate(() => {
  const bs = window.__polarGps.bodyScene;
  bs.camera.position.set(-1.06, 2.40, -1.89);
  bs.camera.zoom = 1.0;
  bs.camera.updateProjectionMatrix();
  bs.controls.target.set(0, 0, 0);
  bs.controls.update();
});
```

### Saved camera presets

Validated shots, all targeting `(0, 0, 0)`:

#### Polar Visualizer (`window.__polar.camera`)

| Preset | Frame | `camera.position` | Notes |
|---|---|---|---|
| **Body 3-quarter** | Body | `(3.30, 4.18, 3.80)` | All three body axes visible; force/moment arrows readable; segment positions clear. |

#### GPS Flight Viewer body-frame pane (`window.__polarGps.bodyScene.camera`)

| Preset | Subject | `camera.position` | Notes |
|---|---|---|---|
| **Wingsuit close-front** | Wingsuit | `(-1.06, 2.40, -1.89)` | Front-quarter view, fills the right pane. Shows segment force vectors and CM arcs clearly. Default for wingsuit-phase shots. |
| **Wingsuit rear-from-distance** | Wingsuit | `(1.03, 0.66, 12.13)` | From behind/above at distance. Better for moment-arc readability when the close-front view crowds the arcs. |
| **Canopy top-down (no GLB)** | Canopy | `(-0.80, 8.90, -2.38)` | Looking down from above. Hide GLB checkbox to see canopy CM arcs cleanly arranged in the wing planform. |

Add new presets here as you discover useful angles. Body-frame presets work for **any track point** in the matching phase — the body frame is rotation-invariant, so a single camera position composes well across the whole flight. **This is why we prefer body-frame for visual validation.**

### Composing a good shot

1. Pick frame mode (Body for vector inspection, Inertial for attitude validation).
2. Set sliders to the scenario you want to see.
3. Apply a saved preset (or set a new camera position via the dev hook).
4. Hide chart column + sim overlay (see Window/Viewport section).
5. Toggle "Hide GLB" + "Show Wireframes" if the GLB obscures something.
6. `screenshot_page`.

### Screenshot workflow for visual debugging

1. **Baseline**: load app, capture before any changes.
2. **Make code edit** → save → Vite auto-reloads.
3. **Reload page** (`navigate_page` to the same URL) to be safe — HMR sometimes keeps stale state.
4. **Repeat the exact same camera/slider setup** (use the dev hook — numerically reproducible).
5. **Capture after** — diff visually against baseline.

## Three Common Validation Setups

### A. Polar Visualizer — Inertial frame moment-arc rotation

```
URL:        http://localhost:5173/
Steps:      Frame → Inertial; ψ slider to 90°; θ slider to 45°.
Validates:  Moment arcs (pitch/yaw/roll), CM arrows rotate correctly with body.
```

### B. Polar Visualizer — Body frame baseline

```
URL:        http://localhost:5173/
Steps:      Frame → Body; α = 8° (or as needed); apply "Body 3-quarter" camera preset.
Validates:  Force/moment vectors stay aligned with body axes regardless of attitude.
```

### C. GPS Viewer — Real-flight overlay

```
URL:        http://localhost:5173/gps?track=07-29-25/TRACK.CSV&roll=blended&overlays=1&kf=1
Validates:  Overlay arrows + moment arcs match GPS-derived orientation in both panes.
```

## GPS Viewer Quick Recipes

The GPS viewer is a **two-pane app** (inertial left, body right). For visual validation of segment vectors, **always work in the body pane** — it's rotation-invariant, so one camera preset composes well across the entire flight.

### Phase indexing — track 05-02-2025-1 (7183 points, ~20 Hz)

| Slider value | Phase | Notes |
|---|---|---|
| 0 — 4900 | Pre-exit / wingsuit | Long wingsuit cruise |
| 5400 | **Wingsuit cruise** | 45 m/s airspeed, AOA ~6°. Use `Mode: Wingsuit`. |
| 5500 | Line-stretch / pre-canopy | `Mode: Canopy` but pre-deployment-replay onset; canopy GLB not yet shown. |
| 5700 | **Canopy steady** | `+7s LS`, Trust=Yes, canopy α=16°. **Use this for canopy CM-arc validation.** |
| 6500 | Late canopy / flare | High body rates; CM arcs shift visibly. |
| 6800+ | Ground | Airspeed → 0, mode → Ground. Don't waste time here. |

> Heuristic: `Mode: Canopy` ≠ canopy CM arcs visible. Look at **Trust=Yes** and a positive `t from LS` in the readout — that's when canopy aero overlay is actually computing. ~5700 is a reliable canopy-phase index for this track.

### Recipe 1 — Canopy CM arcs (top-down, no GLB)

```js
// 1. Scrub to canopy phase
const slider = (await page.$$('input[type="range"]'))[0];
await slider.evaluate(n => n.value = '5700');
await slider.evaluate(n => {
  n.dispatchEvent(new Event('input', { bubbles: true }));
  n.dispatchEvent(new Event('change', { bubbles: true }));
});

// 2. Hide GLB via the "Hide GLB" checkbox (use the live ref from the snapshot)
//    click_element(ref="eXXX")  // checkbox "Hide GLB"

// 3. Apply canopy top-down preset
await page.evaluate(() => {
  const bs = window.__polarGps.bodyScene;
  bs.camera.position.set(-0.80, 8.90, -2.38);
  bs.camera.zoom = 1.0;
  bs.camera.updateProjectionMatrix();
  bs.controls.target.set(0, 0, 0);
  bs.controls.update();
});
// 4. screenshot_page
```

### Recipe 2 — Wingsuit segment vectors (close-front)

```js
// 1. Scrub to wingsuit cruise (~5400 for track 05-02-2025-1)
// 2. Apply wingsuit close-front preset
await page.evaluate(() => {
  const bs = window.__polarGps.bodyScene;
  bs.camera.position.set(-1.06, 2.40, -1.89);
  bs.camera.zoom = 1.0;
  bs.camera.updateProjectionMatrix();
  bs.controls.target.set(0, 0, 0);
  bs.controls.update();
});
// 3. screenshot_page
```

### Recipe 3 — Verify segment objects exist in the scene

```js
// Walk the bodyScene to find named segment objects. Useful when you've added
// a new visualization and aren't sure if it's being created/positioned.
const found = await page.evaluate(() => {
  const out = [];
  function scan(o) {
    if (o.name && o.name.includes('-cm') && !o.name.endsWith('-cm-arc')) {
      out.push({ name: o.name, visible: o.visible, pos: [+o.position.x.toFixed(2), +o.position.y.toFixed(2), +o.position.z.toFixed(2)] });
    }
    if (o.children) for (const c of o.children) scan(c);
  }
  scan(window.__polarGps.bodyScene.scene);
  return out;
});
return found;
```

### Hiding GPS-viewer side panels for clean shots

The GPS viewer has a left info column ("Flight Data" / "Moment Decomposition" / "PNG Capture" / "Head Sensor"). For full-bleed dual-pane shots, hide it via DOM. The two scene panes are direct children of the top-level wrapper — the side column is the next sibling. Inspect the snapshot for the wrapping `generic [ref=eXX]` that contains "TRACK.CSV │ Format: …" and `display:none` it.

### "Mode says canopy but I don't see canopy CM arcs" — common confusion

`gps-aero-overlay.ts` shows the **wingsuit overlay** when `flightMode === 'Canopy'` but `isPostLineStretch === false` (pre-line-stretch canopy is still flying as wingsuit). Canopy CM arcs only render once `showCanopyAero` is true — i.e. **after line-stretch** AND `effectiveCs` is non-null. Use the `Trust: Yes` field as the proxy and pick a slider value with `t from LS > +5s`.

## Iteration Discipline

1. **Type-check first**: `cd c:\dev\polar\polar-visualizer && npx tsc --noEmit`. If it fails, fix before reloading the browser.
2. **Don't run vitest by default.** Several pre-existing test failures are unrelated to current work, and the suite rarely catches what `tsc` doesn't. Only run `npx vitest run` if you specifically modified aero/inertia/segment math and want a regression check.
3. **Reload the browser tab** after every code change — relying on HMR for scene-graph changes is unreliable.
4. **Scope changes narrowly**. The polar visualizer's force/moment vectors and the GPS viewer's overlay arrows are **separate code paths**. Fixing a bug in one should not require touching the other. If you find yourself rewriting working systems to fix a new bug, stop and re-scope.
5. **Don't restructure the scene graph** unless the bug is *demonstrably* a hierarchy problem. Most rotation bugs are simpler: a wrong quaternion, a missed `applyQuaternion(bodyQuat)` call on a NED→Three.js conversion, or an arc whose `axis` is hard-coded in world space.

## Anti-patterns Discovered

| Mistake | Symptom | Fix |
|---|---|---|
| Reparenting `forceVectors.group` under a "body attitude group" with the model | All force vectors disappear or move with the model translation | Don't. Vectors are positioned at `cgWorld` (already in world space). Rotate **only the new arrows** that need it. |
| Setting `slider.value` without dispatching events | App readouts don't update | Dispatch both `input` and `change`. |
| Running `npm run dev` from repo root | `Exit Code: 1` | `cd polar-visualizer` first. |
| Adding a new arc / arrow object but only setting its `position` | Object stays world-axis-aligned and doesn't follow body when in inertial frame | Also copy the body quaternion: `obj.quaternion.setFromRotationMatrix(rotationMatrix)` (mirror what `pitchArc`/`yawArc`/`rollArc` already do). |
| Tiny browser window | Screenshots show only side panels | Hide `#chart-column` + sim overlay (see Window/Viewport section). |
| Trusting stale `ref=eXX` after multiple interactions | "Element not found" errors | Re-read accessibility snapshot before each click. |
| Hard-coding slider indices | Index is wrong if Debug Overrides is collapsed/expanded | Look up sliders by their label text. |
| Calling `setViewportSize()` to fix small canvas | Has no effect on `screenshot_page` output | Use the DOM-hide pattern instead. |

## Updating This Skill

When you discover a new URL param, slider index, gotcha, or workflow that future agents should know, append it here. Keep entries **specific** ("frame mode dropdown is `ref=e45` in Wingsuit BASE scenario after attitude expansion") rather than vague ("look at the dropdown").
