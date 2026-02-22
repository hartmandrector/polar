# UNFINISHED-AERO.md — Planned Aerodynamic Features

> Stub document for aerodynamic systems that are designed but not yet implemented.

---

## 1. Downwash Modeling (Lifting-Line Theory)

**Status:** Not implemented.

Center canopy cells produce downwash that reduces the effective angle of attack
seen by neighboring cells. The plan is to use **lifting-line theory** — compute
induced downwash at each cell's spanwise station from the bound vortex
circulation of all other cells. This gives a physically grounded α reduction
that varies with loading (CL) rather than a fixed offset.

Implementation approach: after computing each cell's CL at its local α, iterate
to find the induced α_i at each station, then re-evaluate. One or two iterations
should converge.

---

## 2. Weight Shift

**Status:** Not implemented.

### Canopy — Lateral Weight Shift

The pilot has two riser attachment points (left and right). Shifting weight
laterally moves the pilot CG relative to the canopy, changing lever arms and
creating a roll moment. This is a **geometry change**, not an aerodynamic
coefficient change — the pilot segment's y-position shifts with input.

### Wingsuit — Lateral Weight Shift

Same concept applied to the wingsuit body. Lateral CG shift produces
asymmetric loading on left/right wing segments, generating roll/yaw coupling.

Both canopy and wingsuit weight shift can share a single UI slider
(`weightShiftLR`: −1 left to +1 right).
