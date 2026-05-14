---
name: browser-dev
description: '**WORKFLOW SKILL** — Run, inspect, and iterate on the Polar Visualizer (`/`) and GPS Flight Viewer (`/gps`) in a real browser to develop and validate aero/visualization features. USE FOR: visually verifying force/moment vector changes; checking model rotation in body vs inertial frames; loading GPS tracks for replay; manipulating sliders, dropdowns, and checkboxes via Playwright; capturing screenshots for review; iterating on 3D scene-graph or rendering fixes that cannot be confirmed by `tsc` or `vitest` alone. DO NOT USE FOR: pure code refactors with no visual surface; unit-test-only changes; physics math validated by tests.'
---

# Browser-Based Polar Development

Visual validation for aero, rendering, control solver overlays, and automated analysis workflows.

## Quick Pick Your Task

| What you want to do | Reference |
|---|---|
| **Setup** | |
| Start dev server, understand the two apps | [Polar Visualizer Fundamentals](./references/polar-viz-fundamentals.md) |
| Load a GPS track, replay modes, two-pane layout | [GPS Viewer Fundamentals](./references/gps-viewer-fundamentals.md) |
| **Interaction** | |
| Drive sliders, dropdowns, checkboxes from code | [Manipulating UI](./references/manipulating-ui.md) |
| All URL params (GPS + visualizer) | [URL Parameters](./references/url-parameters.md) |
| **Capture & Composition** | |
| Set camera angle, presets, screenshot workflow | [Camera Presets](./references/camera-presets.md) |
| Reusable JS snippets (hide panels, set sliders, etc.) | [DOM Utilities](./references/dom-utilities.md) |
| **Recipes: Specific Tasks** | |
| Validate control solver overlay on GPS flight | [GPS Overlays Recipe](./references/recipes-gps-overlays.md) |
| Automated trim sweep (all α values) + screenshots | [Trim Analysis Recipe](./references/recipes-trim-analysis.md) |
| Capture clean wingsuit phase (no GLB clutter) | [Wingsuit Capture Recipe](./references/recipes-wingsuit-capture.md) |
| Capture canopy phase from GPS | [Canopy Capture Recipe](./references/recipes-canopy-capture.md) |
| **Debugging** | |
| Something broke; help | [Troubleshooting](./references/troubleshooting.md) |

## Gotchas at a Glance

- Run `npm run dev` from `polar-visualizer/`, not repo root.
- Vite auto-bumps port (5173 → 5174, ...). Check terminal output.
- Reload browser after code changes — HMR is unreliable for scene-graph edits.
- Always dispatch both `input` and `change` events after setting slider `.value`.
- Screenshots are ~962px wide — hide chart column + sim overlay for readable model.
- `ref=eXX` IDs are stale after clicks — re-read snapshot before each interaction.
- Look up sliders by HTML id (`getElementById('alpha-slider')`) not array index.

## Iteration Discipline

1. **Type-check first**: `cd c:\dev\polar\polar-visualizer && npx tsc --noEmit`. If it fails, fix before reloading the browser.
2. **Don't run vitest by default.** Only run if you modified aero/inertia/segment math.
3. **Reload the browser tab** after every code change — HMR is unreliable for scene-graph edits.
4. **Scope changes narrowly**. Visualizer vectors and GPS overlay arrows are separate code paths.
5. **Don't restructure the scene graph** — most rotation bugs are simpler (wrong quaternion, missed `applyQuaternion()` call).

## Updating This Skill

When you discover a new URL param, camera preset, recipe, or gotcha, update the relevant reference file:
- New params → [URL Parameters](./references/url-parameters.md)
- New camera angles → [Camera Presets](./references/camera-presets.md)
- New workflows → create a new `recipes-*.md` reference
- New gotchas → [Troubleshooting](./references/troubleshooting.md)
