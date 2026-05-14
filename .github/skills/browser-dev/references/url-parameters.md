# URL Parameters (The Power Tool)

You can preload almost any scenario via the URL — far easier than driving the UI by hand.

## GPS Viewer Params (`/gps?...`)

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

## Polar Visualizer Params

The polar viz currently has no documented URL params — drive it via UI sliders/dropdowns. If you add params later, update the skill.
