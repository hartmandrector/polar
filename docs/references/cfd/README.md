# CFD / Wind-Tunnel Reference Captures

> **This folder is gitignored except for `README.md` and `.gitignore`.**
> Drop CFD plots, screenshots, and spanwise/chordwise distribution
> captures here. Many sources are proprietary and must not be committed.
> See `NOTES-PRIVATE.md` (gitignored) for the live capture index and
> tuning history.

## Folder layout

```
cfd/
  .gitignore            ← keeps everything below out of git
  README.md             ← this file (public stub)
  NOTES-PRIVATE.md      ← gitignored capture index + tuning history
  spanwise/             ← CL, CD, CM vs y/(b/2)
  chordwise/            ← CP, pressure distribution vs x/c
  polar/                ← system-level: CL-α, CD-CL², L/D-α, CM-α sweeps
  sideslip/             ← β-sweep: CY-β, CN-β, CL-β, etc.
  geometry/             ← reference dimensions, planform plots, twist diagrams
```

## Naming convention

`<configuration>_<condition>_<quantity>.png` — examples:
- `armwing_a10_v40_spanwise_CL.png`
- `system_neutral_polar_CLalpha.png`
- `torso_a8_chordwise_CP.png`

## How CFD plots map to model coefficients

| CFD plot | Model parameter(s) |
|---|---|
| CL vs α (per panel or system) | `cl_alpha`, `alpha_0` |
| CD vs CL² | `cd_0`, `k` |
| Spanwise CL distribution | `s` (area), per-segment `alpha_0` balance |
| Chordwise CP location vs α | `cp_0`, `cp_alpha` |
| CM vs α (per panel) | `cm_0`, `cm_alpha` (camber residual only) |
| CY vs β | `cy_beta` |
| CN vs β | `cn_beta` + lateral CP placement |
| CL (roll) vs β | `cl_beta` (dihedral effect) |
| Stall plots | `alpha_stall_fwd`, `s1_fwd` |

## Calibration ceilings (real-world, not CFD)

- **Max L/D for a regular wingsuit: ~3:1** (top suits 3.0–3.2). CFD that
  reports 4+ is theoretical (no container, ideal pose). The Aura 5 target
  band is **2.8–3.0:1**.
- **Top-speed spread** between wingsuit designs is larger than L/D spread
  (~25 mph difference between fastest and slowest regular suits).

## Tuning history

See `NOTES-PRIVATE.md` for capture-driven tuning history and per-image notes.
