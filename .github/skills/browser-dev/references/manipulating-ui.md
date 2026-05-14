# Manipulating UI from Code

## Sliders — Value + Dispatch Pattern

`<input type="range">` requires both `input` and `change` events to be dispatched after setting `.value` for the app to react:

```js
const slider = (await page.$$('input[type="range"]'))[INDEX];
await slider.evaluate((node, val) => node.value = val, '45');
await slider.evaluate(node => {
  node.dispatchEvent(new Event('input',  { bubbles: true }));
  node.dispatchEvent(new Event('change', { bubbles: true }));
});
```

## Slider Indices — Polar Visualizer

**Verified empirically** (Wingsuit BASE, Inertial frame, default panel state):

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

> **Don't trust this table blindly** — indices shift if Debug Overrides is collapsed/expanded or panels change.

## Better: Direct ID Lookup (RECOMMENDED)

Most sliders have stable HTML IDs declared in `polar-visualizer/src/ui/controls.ts` (`alpha-slider`, `airspeed-slider`, `beta-slider`, `delta-slider`, `dirty-slider`, etc.). Grep `getElementById\('.*-slider'\)` in `controls.ts` for the full list.

**Example:**

```js
await page.evaluate(({ id, val }) => {
  const el = document.getElementById(id);
  el.value = String(val);
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, { id: 'alpha-slider', val: 12 });
```

## Fallback: Search by Label Text

Slower and fragile — use only when no ID exists.

```js
const all = await page.$$('input[type="range"]');
let phi = -1, theta = -1, psi = -1;
for (let i = 0; i < all.length; i++) {
  const txt = await all[i].evaluate(n => n.closest('div')?.textContent || '');
  if (txt.includes('φ (Roll)') && phi < 0) phi = i;
  else if (txt.includes('θ (Pitch)') && theta < 0) theta = i;
  else if (txt.includes('ψ (Yaw)') && psi < 0) psi = i;
}
```

The Attitude block (φ/θ/ψ) only appears in **Inertial Frame** mode.

## Dropdowns and Checkboxes

Use `click_element` with the `ref=eXX` from the accessibility snapshot. Snapshots refresh after every interaction — re-read them; don't reuse stale `ref` ids across many turns.

```
click_element(ref="e45")   # frame mode dropdown → Inertial
```

## Reading State

After every UI change, the snapshot shows updated readout values (CL, CD, forces, moments, etc.). Use those for numerical validation before screenshotting.

Use `read_page` for text-only extraction of state tables, debug overlays, readouts.
