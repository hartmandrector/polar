# Recipe: GPS Overlays Validation

Validate control solver against GPS overlay with segment vectors visible.

## Recipe 1 — Canopy CM Arcs (Top-Down, No GLB)

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

## Recipe 2 — Wingsuit Segment Vectors (Close-Front)

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

## Recipe 3 — Verify Segment Objects Exist in the Scene

Walk the bodyScene to find named segment objects. Useful when you've added a new visualization and aren't sure if it's being created/positioned.

```js
const found = await page.evaluate(() => {
  const out = [];
  function scan(o) {
    if (o.name && o.name.includes('-cm') && !o.name.endsWith('-cm-arc')) {
      out.push({ 
        name: o.name, 
        visible: o.visible, 
        pos: [+o.position.x.toFixed(2), +o.position.y.toFixed(2), +o.position.z.toFixed(2)] 
      });
    }
    if (o.children) for (const c of o.children) scan(c);
  }
  scan(window.__polarGps.bodyScene.scene);
  return out;
});
return found;
```

## Three Common Validation Setups

### A. Polar Visualizer — Inertial Frame Moment-Arc Rotation

```
URL:        http://localhost:5173/
Steps:      Frame → Inertial; ψ slider to 90°; θ slider to 45°.
Validates:  Moment arcs (pitch/yaw/roll), CM arrows rotate correctly with body.
```

### B. Polar Visualizer — Body Frame Baseline

```
URL:        http://localhost:5173/
Steps:      Frame → Body; α = 8° (or as needed); apply "Body 3-quarter" camera preset.
Validates:  Force/moment vectors stay aligned with body axes regardless of attitude.
```

### C. GPS Viewer — Real-Flight Overlay

```
URL:        http://localhost:5173/gps?track=07-29-25/TRACK.CSV&roll=blended&overlays=1&kf=1
Validates:  Overlay arrows + moment arcs match GPS-derived orientation in both panes.
```
