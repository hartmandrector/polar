# GPS Flight Viewer Fundamentals

## Two-Pane Layout

The GPS viewer displays **inertial frame (left) and body frame (right)** side-by-side. For visual validation of segment vectors, **always work in the body pane** — it's rotation-invariant, so one camera preset composes well across the entire flight.

## Phase Indexing — Track 05-02-2025-1

Standard reference track: 7183 points, ~20 Hz.

| Slider value | Phase | Notes |
|---|---|---|
| 0 — 4900 | Pre-exit / wingsuit | Long wingsuit cruise |
| 5400 | **Wingsuit cruise** | 45 m/s airspeed, AOA ~6°. Use `Mode: Wingsuit`. |
| 5500 | Line-stretch / pre-canopy | `Mode: Canopy` but pre-deployment-replay onset; canopy GLB not yet shown. |
| 5700 | **Canopy steady** | `+7s LS`, Trust=Yes, canopy α=16°. **Use this for canopy CM-arc validation.** |
| 6500 | Late canopy / flare | High body rates; CM arcs shift visibly. |
| 6800+ | Ground | Airspeed → 0, mode → Ground. Don't waste time here. |

> Heuristic: `Mode: Canopy` ≠ canopy CM arcs visible. Look at **Trust=Yes** and a positive `t from LS` in the readout — that's when canopy aero overlay is actually computing. ~5700 is a reliable canopy-phase index for this track.

## Available GPS Tracks

Under `polar-visualizer/public/`:
- `03-27-26/TRACK.CSV`
- `04-28-25/TRACK.CSV`
- `05-02-2025-1/TRACK.CSV`
- `05-04-25/TRACK.CSV`
- `07-29-25/TRACK.CSV`

(Run `Get-ChildItem -Path c:\dev\polar\polar-visualizer\public -Recurse -Filter TRACK.CSV` to enumerate.)

## Hiding GPS-viewer Panels for Clean Shots

The GPS viewer has a left info column ("Flight Data" / "Moment Decomposition" / "PNG Capture" / "Head Sensor"). For full-bleed dual-pane shots, hide it via DOM. Inspect the snapshot for the wrapping `generic [ref=eXX]` that contains "TRACK.CSV │ Format: …" and set `display:none` on it.

## "Hide GLB" Checkbox Behavior

The "Hide GLB" checkbox in the PNG Capture panel:
- Hides **both** the wingsuit GLB and canopy GLB in the body-frame scene
- Turns **on** the **wingsuit segment wireframes** (a 7-box reference geometry showing the aero segments — head, body, two wing pairs, two tail pairs)

This is the **recommended setup** for capturing clean shots of segment force vectors and CM arcs without the model occluding them.

## Mode: Canopy — When CM Arcs Render

`gps-aero-overlay.ts` shows the **wingsuit overlay** when `flightMode === 'Canopy'` but `isPostLineStretch === false` (pre-line-stretch canopy is still flying as wingsuit). 

Canopy CM arcs only render once `showCanopyAero` is true — i.e. **after line-stretch** AND `effectiveCs` is non-null. Use the `Trust: Yes` field as the proxy and pick a slider value with `t from LS > +5s`.
