# DOM Utilities: Reusable JavaScript Snippets

## Hide Chart Column + Expand Viewport

Makes the 3D model large enough to screenshot clearly.

```js
await page.evaluate(() => {
  const cc = document.getElementById('chart-column');
  if (cc) cc.style.display = 'none';
  const vp = document.getElementById('viewport');
  if (vp) { vp.style.flex = '1 1 auto'; vp.style.width = '100%'; }
  window.dispatchEvent(new Event('resize'));  // triggers Three.js renderer resize
});
```

Grows canvas from ~202×562 to ~682×562.

## Hide Gamepad Overlay

Removes the floating `position:fixed` gamepad status panel.

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

## Hide GPS Viewer Left Info Column

Enables full-bleed dual-pane screenshots.

```js
// Find the wrapper containing "TRACK.CSV │ Format: …" and hide it
await page.evaluate(() => {
  for (const el of document.querySelectorAll('*')) {
    if ((el.textContent || '').includes('TRACK.CSV') && (el.textContent || '').includes('Format')) {
      el.style.display = 'none';
      break;
    }
  }
});
```

## Set Slider Value with Events

Standard pattern for any slider.

```js
const setSlider = async (id, val) => page.evaluate(({id, val}) => {
  const el = document.getElementById(id);
  el.value = String(val);
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, { id, val });

// Usage:
await setSlider('alpha-slider', 12);
```

## Set Scenario (with page reload safety)

Defaults to "Debug" after every page reload.

```js
await page.evaluate(() => {
  const s = document.querySelector('select');
  s.value = 'wingsuit-base';
  s.dispatchEvent(new Event('change', { bubbles: true }));
});
```

## Verify Scene Objects Exist

Debug helper for checking if a new visualization is being created/positioned.

```js
const inspect = await page.evaluate(() => {
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
  scan(window.__polarGps?.bodyScene?.scene || window.__polar?.scene);
  return out;
});
console.log(JSON.stringify(inspect, null, 2));
```

## Common Pattern: Compose Setup, Capture, Restore

```js
// 1. Hide clutter
await page.evaluate(() => {
  document.getElementById('chart-column').style.display = 'none';
  document.getElementById('viewport').style.width = '100%';
  window.dispatchEvent(new Event('resize'));
});

// 2. Set camera
await page.evaluate(() => {
  const p = window.__polar;
  p.camera.position.set(3.30, 4.18, 3.80);
  p.camera.updateProjectionMatrix();
  p.controls.update();
});

// 3. Capture
await screenshot_page();

// 4. Restore (optional)
await page.evaluate(() => {
  document.getElementById('chart-column').style.display = 'block';
});
```
