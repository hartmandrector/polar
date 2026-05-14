# Recipe: Trim Analysis

When changing aero coefficients in `polar-data.ts` and validating the effect on trim, lift balance, or stability, use this sweep + diff pattern.

Established during the Step 1/Step 2 leg-lift retune (April 2026).

## Dev Hook — Access System State

`polar-visualizer/src/main.ts` exposes the latest computed system state on `window.__polar`:

```js
window.__polar.lastSystemView   // { cl, cd, cy, cm, ld, vxs, vys, totalLift, totalDrag, totalSide, segmentForces[], massBreakdown, totalWeight_kg, totalInertia_kg }
window.__polar.lastFlightState  // FlightState (sliders snapshot)
window.__polar.lastReadout      // { 'r-cl', 'r-cd', 'r-cm', 'r-cp', 'r-pitch-accel', ... } — strings from the readout panel
```

`segmentForces` is `[{ name, lift, drag, side }, ...]`. For 7-segment wingsuits the names are: `head, torso, leg, r1, l1, r2, l2`.

> **Note:** `lastSystemView.cl/cd/cm/ld` are lowercase and numeric. The DOM readout (`lastReadout['r-cm']` etc.) is uppercase-keyed strings with units. Use `lastSystemView` for math.

## Browser Sweep Pattern

```js
const set = (id, val) => page.evaluate(({id, val}) => {
  const el = document.getElementById(id);
  el.value = String(val);
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, { id, val });

// 1. Set scenario (resets after every page reload!)
await page.evaluate(() => {
  const s = document.querySelector('select');
  s.value = 'wingsuit-base';
  s.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(300);

// 2. Sweep V × α and accumulate
const speeds = [25, 35, 45];
const alphas = [0,2,4,6,8,10,12,14,16,18,20,22];
await page.evaluate(() => { window.__sweep = []; });
for (const V of speeds) {
  await set('airspeed-slider', V);
  for (const a of alphas) {
    await set('alpha-slider', a);
    await page.waitForTimeout(50);
    await page.evaluate(({V, a}) => {
      const sv = window.__polar?.lastSystemView;
      const ro = window.__polar?.lastReadout || {};
      window.__sweep.push({
        V, alpha: a,
        cl: sv.cl, cd: sv.cd, cm: sv.cm, ld: sv.ld,
        totalLift: sv.totalLift, totalDrag: sv.totalDrag,
        readout: { 'r-pitch-accel': ro['r-pitch-accel'] },
        segments: sv.segmentForces
      });
    }, { V, a });
  }
}
return await page.evaluate(() => JSON.stringify(window.__sweep));
```

## Save + Diff

Sweeps are stored under `state/trim-baselines/*.json`. Convention:
- `baseline-pre-retune.json` — frozen reference at the start of an experiment
- `step1-<change>.json`, `step2-<change>.json`, ... — one file per single-knob iteration

PowerShell summarize-and-diff scripts live next to the JSON files. Pattern:

```powershell
# Find trim α (where CM crosses 0) at each V
foreach ($V in @(25,35,45)) {
  $rows = $sweep | Where-Object { $_.V -eq $V } | Sort-Object alpha
  for ($i=0; $i -lt $rows.Count - 1; $i++) {
    $a = $rows[$i]; $b = $rows[$i+1]
    if (($a.cm -le 0 -and $b.cm -ge 0) -or ($a.cm -ge 0 -and $b.cm -le 0)) {
      $t = -$a.cm / ($b.cm - $a.cm)
      $alphaTrim = $a.alpha + $t * ($b.alpha - $a.alpha)
      "V={0}  trim α = {1:F2}°" -f $V, $alphaTrim
      break
    }
  }
}
```

## Discipline

- **One knob per step.** Tempting to bundle changes — don't, except when the user explicitly OKs it (see Step 2 retune which combined 3 knobs after Step 1 cleared the path).
- **Always type-check** after editing `polar-data.ts`: `cd polar-visualizer; npx tsc --noEmit`.
- **Always reload** after a code change — Vite HMR can keep stale polar definitions.
- **Always re-set the scenario** after reload (defaults to Debug).
- **Validate against the user too.** They have the GPS viewer open in parallel and can confirm the physical feel — mathematical trim isn't sufficient.

## Iteration Discipline

1. **Type-check first**: `cd c:\dev\polar\polar-visualizer && npx tsc --noEmit`. If it fails, fix before reloading the browser.
2. **Don't run vitest by default.** Several pre-existing test failures are unrelated to current work, and the suite rarely catches what `tsc` doesn't. Only run `npx vitest run` if you specifically modified aero/inertia/segment math and want a regression check.
3. **Reload the browser tab** after every code change — relying on HMR for scene-graph changes is unreliable.
4. **Scope changes narrowly**. The polar visualizer's force/moment vectors and the GPS viewer's overlay arrows are **separate code paths**. Fixing a bug in one should not require touching the other. If you find yourself rewriting working systems to fix a new bug, stop and re-scope.
5. **Don't restructure the scene graph** unless the bug is *demonstrably* a hierarchy problem. Most rotation bugs are simpler: a wrong quaternion, a missed `applyQuaternion(bodyQuat)` call on a NED→Three.js conversion, or an arc whose `axis` is hard-coded in world space.
