# Camera Presets and Composition

## Saved Camera Positions

All presets target `(0, 0, 0)` as the look-at point.

### Polar Visualizer (`window.__polar.camera`)

| Preset | Frame | `camera.position` | Notes |
|---|---|---|---|
| **Body 3-quarter** | Body | `(3.30, 4.18, 3.80)` | All three body axes visible; force/moment arrows readable; segment positions clear. |

### GPS Flight Viewer Body-Frame Pane (`window.__polarGps.bodyScene.camera`)

| Preset | Subject | `camera.position` | Notes |
|---|---|---|---|
| **Wingsuit close-front** | Wingsuit | `(-1.06, 2.40, -1.89)` | Front-quarter view, fills the right pane. Shows segment force vectors and CM arcs clearly. Default for wingsuit-phase shots. |
| **Wingsuit rear-from-distance** | Wingsuit | `(1.03, 0.66, 12.13)` | From behind/above at distance. Better for moment-arc readability when the close-front view crowds the arcs. |
| **Canopy top-down (no GLB)** | Canopy | `(-0.80, 8.90, -2.38)` | Looking down from above. Hide GLB checkbox to see canopy CM arcs cleanly arranged in the wing planform. |

Body-frame presets work for **any track point** in the matching phase — the body frame is rotation-invariant, so a single camera position composes well across the whole flight. **This is why we prefer body-frame for visual validation.**

## Setting a Camera Position via Dev Hook

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

## Composing a Good Shot

1. Pick frame mode (Body for vector inspection, Inertial for attitude validation).
2. Set sliders to the scenario you want to see.
3. Apply a saved preset (or set a new camera position via the dev hook).
4. Hide chart column + sim overlay (see Polar Visualizer Fundamentals).
5. Toggle "Hide GLB" + "Show Wireframes" if the GLB obscures something.
6. `screenshot_page`.

## Screenshot Workflow for Visual Debugging

1. **Baseline**: load app, capture before any changes.
2. **Make code edit** → save → Vite auto-reloads.
3. **Reload page** (`navigate_page` to the same URL) to be safe — HMR sometimes keeps stale state.
4. **Repeat the exact same camera/slider setup** (use the dev hook — numerically reproducible).
5. **Capture after** — diff visually against baseline.

## Adding New Presets

As you discover useful camera angles, add them to this reference file with:
- The `camera.position` coordinates
- The subject (Wingsuit, Canopy, etc.)
- Why this angle is useful
- Any special setup (Hide GLB, etc.)
