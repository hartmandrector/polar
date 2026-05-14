# Troubleshooting: Anti-patterns Discovered

| Mistake | Symptom | Fix |
|---|---|---|
| Reparenting `forceVectors.group` under a "body attitude group" with the model | All force vectors disappear or move with the model translation | Don't. Vectors are positioned at `cgWorld` (already in world space). Rotate **only the new arrows** that need it. |
| Setting `slider.value` without dispatching events | App readouts don't update | Dispatch both `input` and `change`. |
| Running `npm run dev` from repo root | `Exit Code: 1` | `cd polar-visualizer` first. |
| Adding a new arc / arrow object but only setting its `position` | Object stays world-axis-aligned and doesn't follow body when in inertial frame | Also copy the body quaternion: `obj.quaternion.setFromRotationMatrix(rotationMatrix)` (mirror what `pitchArc`/`yawArc`/`rollArc` already do). |
| Tiny browser window | Screenshots show only side panels | Hide `#chart-column` + sim overlay (see Polar Visualizer Fundamentals). |
| Trusting stale `ref=eXX` after multiple interactions | "Element not found" errors | Re-read accessibility snapshot before each click. |
| Hard-coding slider indices | Index is wrong if Debug Overrides is collapsed/expanded | Look up sliders by HTML id (`getElementById('alpha-slider')`) — IDs are declared in `controls.ts`. |
| Calling `setViewportSize()` to fix small canvas | Has no effect on `screenshot_page` output | Use the DOM-hide pattern instead. |
| TypeScript-style casts (`as HTMLInputElement`, `: any`) inside `run_playwright_code` `page.evaluate` callbacks | `Code execution failed: [object Object]` (no useful error) | The runtime is plain JS — strip TS annotations. Use `document.getElementById(id)` not `(... as HTMLInputElement)`. |
| Reloading the polar visualizer page mid-experiment | Scenario silently reverts to "Debug" (the default) | Re-set scenario via `document.querySelector('select').value = 'wingsuit-base'` + dispatch `change` after every reload. |

## Gotchas at a Glance

- Run `npm run dev` from `polar-visualizer/`, not repo root.
- Vite auto-bumps port (5173 → 5174, ...). Check terminal output.
- Reload browser after code changes — HMR is unreliable for scene-graph edits.
- Always dispatch both `input` and `change` events after setting slider `.value`.
- Screenshots are ~962px wide — hide chart column + sim overlay for readable model.
