# CM Rotation Visualizations — Plan

**Status:** Planning · **Scope:** Polar Visualizer, Simulation, GPS Viewer

---

## 1. Problem

Total moment on the body comes from two sources:

**CP-based moment** — aero force at each segment's CP, offset from the vehicle CG:

$$\mathbf{M}_{CP} = \sum (\mathbf{r}_{CP} - \mathbf{r}_{CG}) \times \mathbf{F}_{aero}$$

**CM-based moment** — pure pitching moment from each segment's shape, about its own quarter chord:

$$\mathbf{M}_{CM} = \sum q \cdot S \cdot c \cdot C_M$$

Both are summed correctly in the math. But visually, only the CP term is legible — force arrows are drawn **at** the CP. The CM term is invisible: it's folded into the total moment arcs at the CG with no per-segment breakdown. This makes tuning `cm_0`, `cm_alpha`, and Kirchhoff CM blending hard.

---

## 2. Deliverables

1. **Per-segment CM arrows** at each segment's quarter chord.
2. **CM vs α chart** — new view on the α-based chart selector, same color scheme as CP vs α.
3. **Wingsuit wireframe** analogous to the existing canopy cell wireframe.
4. **Unified GLB/wireframe toggles** that work on whichever vehicle is loaded, in both the polar visualizer and the GPS viewer.

---

## 3. Design Decisions (settled)

- **GLB toggle:** single **Hide GLB** checkbox, auto-applies to whatever vehicle is loaded.
- **Wireframe toggle:** single **Show wireframes** checkbox (keep existing label), works for any vehicle.
- **CM arrows:** always rendered, always visible — no separate toggle. Practically they're only readable when the GLB is hidden, which follows the existing interaction pattern.
- **Chart:** separate **CM vs α** chart (not dual-axis on CP chart) — simpler to build and maintain.
- **Wireframe detail:** segment bounding boxes only for now. Morphing happens inside the box; dihedral lines, LE refinement, and CG markers can be added later as needed.
- **CM arrow axis:** body-frame spanwise (Y) for now. Segment dihedral/orientation rotation can be added later.
- **Colors:** match the existing rotational acceleration arc colors (pitch / roll / yaw). Long-term idea: unify so moment-source colors + inertia colors combine to indicate angular acceleration direction. Defer this unification.
- **Scale:** tuned visually after all pieces are in place. Mass positions are also visible in wireframe mode, so the full rotation scene (forces, moments, mass markers, CM arrows) needs to be balanced together.

---

## 4. Implementation Phases

### Phase 1 — CM vs α chart
- Add `'cm'` to `Chart1View` union in `polar-charts.ts`.
- Add dropdown option in `controls.ts`.
- Add rebuild case in `rebuildChart1()` plotting `PolarPoint.cm`.
- No sweep changes needed — `cm` is already in `PolarPoint`.

### Phase 2 — CM arrow primitive
- New file: `src/viewer/cm-arrow.ts`.
- Small curved-arrow class (or `CurvedArrow` subclass) with its own scale constant.
- API: `setCM(cm, q, S, chord)` → computes torque, maps to arc sweep, clamps to ±π/2.
- Colors reuse the pitch / roll / yaw arc palette.

### Phase 3 — Per-segment CM rendering
- Extend `ForceVectors` in `vectors.ts` with a `segmentCMArrows: CMArrow[]` array.
- Position each arrow at `seg.position + 0.25 × seg.chord × chordDir` (local quarter chord).
- Update inside the existing per-segment loop that already iterates `aeroSegments` for force arrows.

### Phase 4 — Wingsuit wireframe
- New file: `src/viewer/wingsuit-wireframes.ts`, mirroring `cell-wireframes.ts`.
- Draws bounding boxes for the 6 wingsuit segments using `a5xc()` positions + chord/span extents from `polar-data.ts`.
- Wired through `model-loader.ts` on wingsuit load.

### Phase 5 — Unified toggles
- **Polar visualizer:** consolidate existing checkboxes into one **Hide GLB** and one **Show wireframes** that work on any vehicle.
- **GPS viewer:** add the same two checkboxes to the controls panel. Wire into both `GPSScene` and `BodyFrameScene`.

### Phase 6 — Scale tuning pass
- After all rendering is in, tune `CM_SEGMENT_TORQUE_SCALE` and total-moment `TORQUE_SCALE` together so CM arrows, CP force arrows, total moment arcs, and mass-position markers all read clearly at the same time.

---

## 5. Files Touched

| File | Change |
|------|--------|
| `src/ui/polar-charts.ts` | Add CM view case |
| `src/ui/controls.ts` | Add CM dropdown option; consolidate visibility checkbox labels |
| `src/viewer/cm-arrow.ts` | **NEW** — per-segment CM arrow |
| `src/viewer/vectors.ts` | Wire CM arrows into segment loop |
| `src/viewer/wingsuit-wireframes.ts` | **NEW** — wingsuit segment wireframe |
| `src/viewer/model-loader.ts` | Attach wingsuit wireframe on load; unify GLB show/hide |
| `src/gps-viewer/gps-scene.ts` | `setWireframeVisible()`, `setGLBVisible()`, CM arrow support |
| `src/gps-viewer/body-frame-scene.ts` | Same |
| `src/gps-viewer/gps-main.ts` | Checkbox wiring |
| `gps.html` | Checkbox HTML |

---

## 6. Future / Deferred

- Segment-by-segment CM contribution chart (stacked bar or line).
- Dihedral-aware CM arrow orientation.
- Wireframe refinements: LE/TE detail, quarter-chord line, CG markers.
- Unified moment ⊕ inertia → angular-acceleration color scheme across the project.
