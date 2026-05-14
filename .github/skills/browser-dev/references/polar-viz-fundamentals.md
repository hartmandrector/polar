# Polar Visualizer Fundamentals

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

## Window/Viewport Size Matters for Screenshots

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

## Dev Hooks

Both apps expose dev hooks with live scene objects:

```js
// Polar visualizer
window.__polar.camera, .controls, .scene, .renderer

// GPS Flight Viewer
window.__polarGps.inertialScene, .bodyScene  // each with camera, controls, scene, renderer
```
