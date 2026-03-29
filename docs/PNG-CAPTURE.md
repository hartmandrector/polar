# PNG-CAPTURE.md — GPS Viewer Frame Capture Pipeline

## Overview

Capture the GPS viewer dual-scene display as PNG image sequences for video production. The polar-visualizer renders each frame on demand; playwright-capture screenshots it. Communication via `window.postMessage`.

## Architecture

```
┌─────────────────────┐         postMessage          ┌──────────────────────┐
│  playwright-capture  │ ──────────────────────────▶  │   polar-visualizer   │
│  (Node + Playwright) │   REQUEST_FRAME {frame: N}   │   (GPS Viewer page)  │
│                      │ ◀──────────────────────────  │                      │
│  screenshots element │   FRAME_READY {frame: N}     │  renders frame N     │
│  saves PNG to disk   │                              │  interpolates all    │
└─────────────────────┘                               │  data to exact time  │
                                                      └──────────────────────┘
```

### Message Protocol

**Request** (playwright → page):
```js
window.postMessage({ type: 'REQUEST_FRAME', frame: 1234 }, '*')
```

**Response** (page → playwright, via page.evaluate listener):
```js
window.postMessage({ type: 'FRAME_READY', frame: 1234 }, '*')
```

**Init** (playwright → page, once after load):
```js
window.postMessage({
  type: 'CAPTURE_INIT',
  frameRate: 60,
  startTime: 45.0,    // seconds into flight (from flight computer)
  endTime: 120.0,     // seconds into flight
}, '*')
```

**Response**:
```js
window.postMessage({
  type: 'CAPTURE_READY',
  totalFrames: 4500,  // (endTime - startTime) * frameRate
  startTime: 45.0,
  endTime: 120.0,
}, '*')
```

## Polar-Visualizer Side (GPS Viewer)

### What Needs to Happen

1. **Message listener** — listens for `REQUEST_FRAME` messages
2. **Time computation** — `t = startTime + frame / frameRate`
3. **Output interpolation** — interpolate ALL displayed data to exact time `t`:
   - GPS pipeline point (position, velocity, orientation, aero)
   - Body rates
   - Control solver output
   - Moment decomposition
   - Canopy estimator state
   - Flight mode
4. **Render both scenes** — set interpolated state on both GPSScene and BodyFrameScene
5. **Update legends** — all text overlays reflect interpolated values
6. **Signal ready** — post `FRAME_READY` after render completes

### Output Interpolation Strategy

The GPS data is at 5 Hz. For 60 fps video we need interpolation at every displayed quantity. Rather than upsampling inputs and re-running the pipeline, we interpolate outputs:

```typescript
interface InterpolatedFrame {
  // Find bracketing pipeline points for time t
  // Linear interpolation for positions, velocities, rates, coefficients
  // Slerp for quaternions / orientations
  // Nearest-neighbor for discrete values (flight mode, convergence flag)
}
```

**Interpolation function**: Given `t`, find indices `i` and `i+1` where `points[i].t <= t < points[i+1].t`, compute fraction `f = (t - points[i].t) / (points[i+1].t - points[i].t)`, lerp everything.

This matches the existing `setIndex(index, fraction)` pattern already in both scenes — we just need to extend it to also interpolate the legend data and moment inset.

### Capture Section in Sidebar

At bottom of sidebar scrolldown:

```
┌─────────────────────────────┐
│ PNG Capture                 │
│                             │
│ [Capture PNG Sequence]      │  ← button, triggers capture
│                             │
│ Status: Ready / Capturing   │
│ Frame: 1234 / 4500          │
│ FPS: 8.3                    │
└─────────────────────────────┘
```

- **No start/stop sliders** — use flight computer mode data automatically:
  - Start = first frame of FREEFALL mode (or a small buffer before)
  - End = last frame of LANDING mode (or end of data)
- Button triggers: open WebSocket/postMessage connection, signal playwright-capture server to begin
- Status display shows progress

### File: `src/gps-viewer/capture-handler.ts`

```typescript
export class CaptureHandler {
  private frameRate = 60
  private startTime = 0
  private endTime = 0
  private totalFrames = 0
  
  constructor(
    private renderFrame: (t: number) => void,  // callback to render at time t
    private points: GPSPipelinePoint[],
    private flightModes: FlightModeOutput[]
  ) {
    window.addEventListener('message', this.onMessage)
  }
  
  private onMessage = (e: MessageEvent) => {
    if (e.data.type === 'CAPTURE_INIT') { ... }
    if (e.data.type === 'REQUEST_FRAME') { ... }
  }
}
```

## Playwright-Capture Side

### New Capture Script: `tests/polar-capture.test.ts`

Separate from the existing CloudBASE `capture.test.ts`. Much simpler — no login flow, no DevTunnel, just localhost:5173/gps.

```typescript
test('capture polar GPS viewer frames', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('http://localhost:5173/gps')
  
  // Wait for data to load (detect via page state)
  await page.waitForFunction(() => (window as any).__dataLoaded)
  
  // Send CAPTURE_INIT
  const { totalFrames } = await page.evaluate(() => {
    return new Promise(resolve => {
      window.addEventListener('message', e => {
        if (e.data.type === 'CAPTURE_READY') resolve(e.data)
      })
      window.postMessage({ type: 'CAPTURE_INIT', frameRate: 60 }, '*')
    })
  })
  
  // Capture loop
  for (let frame = 0; frame < totalFrames; frame++) {
    // Request frame
    await page.evaluate(f => {
      window.postMessage({ type: 'REQUEST_FRAME', frame: f }, '*')
    }, frame)
    
    // Wait for FRAME_READY
    await page.waitForFunction(f => {
      return (window as any).__lastRenderedFrame === f
    }, frame)
    
    // Screenshot the dual scene container
    const container = page.locator('#dual-scene-container')
    await container.screenshot({
      path: `frames/polar/frame-${frame.toString().padStart(6, '0')}.png`,
      omitBackground: true,
    })
  }
})
```

### Trigger Options

**Option A — Button in polar-visualizer triggers playwright-capture server:**
- Polar viewer POSTs to `http://localhost:3333/capture-polar`
- Server launches `npx playwright test polar-capture.test.ts --headed`
- Playwright opens polar viewer, does the capture loop

**Option B — Manual start from playwright-capture:**
- User ensures polar viewer is running with data loaded
- Runs `npx playwright test polar-capture.test.ts --headed` directly
- Playwright navigates to GPS viewer and captures

**Recommendation: Option A** — single button click from the polar viewer is cleaner workflow. The POST to playwright-capture server includes the data file path so playwright knows which flight to load.

## Screenshot Targets

For video compositing, capture multiple elements separately:

| Target | Selector | Use |
|--------|----------|-----|
| Full page | `page` | Complete frame with sidebar |
| Dual scenes only | `#dual-scene-container` | 3D views without charts |
| Inertial only | `#inertial-box` | Inertial frame + legend |
| Body only | `#body-box` | Body frame + legend |
| Sidebar data | `#sidebar` | Flight data readout |

Transparent backgrounds (`omitBackground: true`) allow compositing in video editor.

## Implementation Order

1. **Capture handler in polar-visualizer** (`capture-handler.ts`) — message listener, frame rendering, interpolation
2. **Sidebar capture section** — button + status display
3. **`polar-capture.test.ts` in playwright-capture** — capture loop
4. **Server route** (`/capture-polar`) — trigger from button
5. **Test end-to-end** with real flight data

## Frame Rate & Duration Math

For a typical wingsuit BASE flight:
- Exit to landing: ~75 seconds
- At 60 fps: 4,500 frames
- At ~8 fps capture rate (playwright overhead): ~9.5 minutes capture time
- PNG size estimate: ~500KB per frame × 4,500 = ~2.2 GB

Consider: 30 fps halves storage and capture time; 60 fps only needed for slow-motion segments.

## Notes

- Transparent WebGL background already implemented (`setClearColor(0x000000, 0)`)
- Legends already use bubble font with dark text-shadow for PNG readability
- Camera positions logged to console on drag-end — use these for preset positions
- `setIndex(index, fraction)` already exists on both scenes — interpolation foundation is there
- Moment inset and legends need to also interpolate (currently only update on integer index change)
- Flight computer mode boundaries give natural start/end times without manual sliders
