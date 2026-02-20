# Context: Charts

> **Load this context** when working on the Chart.js polar curve panels,
> the numeric readout, or the AOA color system.

---

## Scope

The right-side panel of the Polar Visualizer: two Chart.js scatter plots
with dropdown view selectors, a numeric coefficient readout, an inertia/rates
readout, and the AOA color gradient legend.

---

## Key Files

| File | Lines | What's There |
|------|-------|-------------|
| `src/ui/polar-charts.ts` | 493 | Chart creation, update, cursor, legacy overlay, AOA legend |
| `src/ui/chart-data.ts` | 271 | Sweep generators: `sweepPolar()`, `sweepSegments()`, `sweepLegacyPolar()`, AOA color map |
| `src/ui/readout.ts` | 130 | Numeric display: coefficients, forces, L/D, inertia, rates, positions |
| `src/ui/controls.ts` | 330 | `FlightState` interface, slider wiring, `readState()` |
| `src/ui/debug-panel.ts` | 609 | Per-segment coefficient inspector, polar parameter overrides |

---

## Chart Architecture

### Two Chart Panels

**Chart 1** (α-based, with vertical cursor):
| View | X axis | Y axis |
|------|--------|--------|
| CL | α (deg) | CL |
| CD | α (deg) | CD |
| CP | α (deg) | CP (% chord) |
| L/D | α (deg) | CL/CD |

**Chart 2** (cross-plot, with point cursor):
| View | X axis | Y axis |
|------|--------|--------|
| Polar curve | CD | CL |
| Speed polar | Vxs (m/s or mph) | Vys (m/s or mph) |

Both charts show:
- **Continuous polar** (thick line, AOA-colored gradient)
- **Legacy polar** overlay (thin dashed, togglable via checkbox)
- **Current α cursor** (vertical line on Chart 1, point on Chart 2)

### Data Flow

```
Controls change (α, β, δ, dirty, polar, airspeed, ρ)
  │
  ├─ updateChartSweep() — full recompute
  │    ├─ sweepPolar() or sweepSegments() → PolarPoint[]
  │    ├─ sweepLegacyPolar() → LegacyPoint[]
  │    └─ Rebuild both charts
  │
  └─ updateChartCursor() — α-only change (no recompute)
       ├─ Move vertical line on Chart 1
       └─ Move cursor point on Chart 2
```

### Sweep Modes

**Single-airfoil** (`sweepPolar()`): Evaluates `getAllCoefficients()` at each α.
Used when no segments are available.

**Segment-summed** (`sweepSegments()`): Evaluates per-segment forces via
`computeSegmentForce()` + `sumAllSegments()`, then decomposes back into
pseudo-coefficients by projecting onto wind-frame directions. Used when
`aeroSegments` exist on the polar.

The segment sweep captures effects invisible to the single-airfoil model:
asymmetric forces, per-segment stall, deployment-dependent behavior.

### AOA Color System

All curves are colored by angle of attack using an HSL gradient:
```
hue = 270 × (1 - t)    where t = (α - minAlpha) / (maxAlpha - minAlpha)
```
- Low α (blue, hue 270) → cyan → green → yellow → red → high α (magenta, hue 0)
- Same gradient used in both charts and the color legend strip

### Legacy Overlay

Legacy polars (`WSEQPolar`) use lookup-table interpolation instead of the
Kirchhoff model. The overlay shows how well the continuous model matches
the original BASEline/CloudBASE data. Toggle via checkbox (synced between charts).

---

## Numeric Readout

| Section | Values | Source |
|---------|--------|--------|
| Coefficients | CL, CD, CY, CM, CN, CL_roll, CP, f | `getAllCoefficients()` |
| Forces | Lift, Drag, Side, Weight [N] | `coeffToForces()` |
| Performance | L/D, glide angle | Derived from CL/CD |
| Legacy | CL, CD, CP (if legacy polar exists) | `getLegacyCoefficients()` |
| Inertia | Ixx, Iyy, Izz, angular accelerations | `computeInertia()` + torque/I |
| Rates | Euler rates, body rates, body accelerations | From sim state |
| Positions | CG body frame, CG inertial frame | From mass computation |

---

## Debug Panel

`debug-panel.ts` provides an advanced inspector (togglable) with:
- Per-segment coefficient table (α_local, CL, CD, S, F for each segment)
- System-level aggregated view
- Polar parameter override sliders (temporarily modify CL_α, CD_0, etc.)
- Segment polar overrides (per-segment coefficient tweaks)

---

## Constraints

- **Charts rebuild on full sweep, cursor-only on α change** — don't call `updateChartSweep()` when only α moved (expensive).
- **Animation disabled** (`animation: false`) — charts update immediately, no transitions.
- **α axis is reversed** (high α on left, low on right) — matches aerodynamic convention.
- **Speed polar Y axis is reversed** (negative Vys = sinking, at bottom) — matches pilot convention.
- **Segment sweep uses pseudo-coefficients** — these are force-derived, not direct polar evaluation. They include effects like ω×r and per-segment stall that the single-airfoil model doesn't see.

---

## Related Contexts
- `docs/contexts/physics-engine.md` — Where coefficient functions live
- `docs/contexts/visualization.md` — 3D viewer (separate from charts)
