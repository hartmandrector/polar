# Wingsuit δ Control Model — Planning Document

## Physical Reality

A wingsuit pilot controls flight primarily through **body position** — arching, de-arching, and shifting weight/surface area forward and backward along the body axis. Unlike a canopy with discrete brake/riser inputs, the wingsuit has a single continuous dimension of body shape manipulation.

### What the pilot can do

| Input | Physical Action | Aerodynamic Effect |
|-------|----------------|-------------------|
| **Arch** (δ → 1) | Belly down, hips low, arms swept back | CP moves aft, slight camber increase, modest CD increase |
| **Neutral** (δ = 0) | Flat body, balanced position | Base polar — nominal CP, CL, CD |
| **De-arch** (δ → -1) | Shoulders forward, hips up, arms forward | CP moves forward, slight camber decrease, modest CD change |

### Key insight: CP is the primary control output

The wingsuit pilot's main control authority is **shifting the center of pressure** relative to CG to create pitch torques. The actual changes to CL_α, CD_0, and stall angle from body shape changes are relatively modest — a stable amount of camber doesn't allow for dramatic variation. The pilot is mostly redistributing where the aerodynamic force acts along the body, not fundamentally changing how much force is generated.

This is in contrast to the canopy, where brakes dramatically change camber, increasing CL and CD substantially.

## Proposed δ Range

**δ ∈ [-1, +1]** (unlike canopy which is [0, 1])

| δ | Body Position | Description |
|---|--------------|-------------|
| -1 | Full de-arch | Maximum forward CP shift, speed configuration |
| 0 | Neutral | Base polar, balanced flight |
| +1 | Full arch | Maximum aft CP shift, high-drag slow configuration |

> **Note**: This means the UI slider needs to support [-1, +1] for wingsuit, not just [0, 1].

## Parameter Effects

### Strong effects (primary control outputs)

| Parameter | δ derivative | Reasoning |
|-----------|-------------|-----------|
| **cp_0** | `d_cp_0` | Main effect: CP shifts aft with arch, forward with de-arch. Maybe ±0.05–0.10 chord fraction at full deflection. |
| **cm_0** | `cm_delta` | Equivalent way to express CP shift as a pitch moment. Could use either d_cp_0 or cm_delta — using both would double-count. |

### Moderate effects

| Parameter | δ derivative | Reasoning |
|-----------|-------------|-----------|
| **alpha_stall_fwd** | `d_alpha_stall_fwd` | Arch slightly lowers stall angle (more camber = earlier separation). De-arch slightly raises it. Maybe ±2–3°. |
| **cd_0** | `d_cd_0` | Arch increases parasitic drag (more exposed area, less streamlined). De-arch slightly reduces it. Maybe ±0.01–0.02. |
| **alpha_0** | `d_alpha_0` | Small camber effect — arch shifts α_0 slightly negative (more camber). Maybe ±1°. |

### Weak/negligible effects

| Parameter | δ derivative | Reasoning |
|-----------|-------------|-----------|
| **cl_alpha** | `d_cl_alpha` | Lift slope doesn't change much with body shape — the wing area and planform stay roughly the same. |
| **k** | `d_k` | Induced drag factor is mostly geometric (aspect ratio, planform). Almost unchanged. |
| **cd_n** | `d_cd_n` | Broadside drag coefficient — negligible change since total frontal area doesn't change much. |

## Open Questions

1. **CP vs CM for control**: Should we express the primary control as `d_cp_0` (direct CP shift) or `cm_delta` (pitch moment coefficient)? 
   - `d_cp_0` is more physically intuitive ("I moved my CP by 5% chord")
   - `cm_delta` is what the math currently uses for symmetric control pitch effect
   - We could add `d_cp_0` to `SymmetricControl` — it's a natural extension

2. **Slider range**: The current δ slider is [0, 1]. Wingsuit needs [-1, +1] to represent de-arch ↔ arch. Options:
   - Change slider to [-1, +1] globally (canopy 0 = no brakes, 1 = full brakes still works if we remap)
   - Make slider range type-dependent
   - Keep [0, 1] and define neutral = 0.5 for wingsuit (0 = full de-arch, 1 = full arch)

3. **How much CP travel?** What's a realistic range for CP movement with full arch/de-arch? This determines `d_cp_0`.

4. **Interaction with α**: Does the CP sensitivity to δ change with angle of attack? At high α the body is more bluff and arch/de-arch may have less effect. Could model as `d_cp_alpha` (change in cp_alpha with δ) but that adds complexity.

## Decisions

- **CP shift model**: Use `d_cp_0` — direct CP position shift. More physically intuitive for wingsuit.
- **Slider range**: δ ∈ [-1, +1] — centered at neutral (0), negative = de-arch, positive = arch.
- **CP travel**: ±5% chord fraction at full deflection (±9cm on 1.8m chord Aura 5).

## Final Values (Aura 5)

```
controls: {
  brake: {                      // TODO: rename to body_position later
    d_cp_0:             0.05,   // CP shifts aft 5% chord at full arch (δ=+1)
    d_alpha_0:         -1.0,    // 1° camber increase at full arch
    d_cd_0:             0.015,  // Small drag increase at full arch
    d_alpha_stall_fwd: -2.0,    // Stall angle decreases 2° at full arch
    cm_delta:           0,      // Using d_cp_0 instead
  }
}
```

## Implementation Notes

- Need to add `d_cp_0` and possibly `d_cp_alpha` to `SymmetricControl` interface
- Need to handle δ ∈ [-1, +1] in the UI (slider range change)
- The `applyDeltaMorph` function already handles the math — just needs the new CP fields
- Other model types unaffected (no controls defined)
