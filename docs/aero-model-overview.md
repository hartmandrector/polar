# Aerodynamic Model — Overview

The simulator uses a **Kirchhoff separation model** that blends attached-flow and flat-plate aerodynamics through a smooth sigmoid function, producing physically motivated coefficients for any angle of attack (−180° to +180°) and any sideslip angle (−90° to +90°). Every lifting segment evaluates independently at its own local flow conditions.

→ Full specification: [KIRCHHOFF.md](../KIRCHHOFF.md)

---

- **[Separation function f(α)](../KIRCHHOFF.md#2--the-separation-function-fα)** — Dual sigmoid that smoothly transitions each segment between attached flow (f = 1) and fully separated flat-plate behaviour (f = 0)
- **[Attached-flow sub-models](../KIRCHHOFF.md#31--attached-flow-lift)** — Thin-airfoil lift (sinusoidal CL_α) and classical drag polar (CD₀ + K·CL²) for the normal flight regime
- **[Flat-plate sub-models](../KIRCHHOFF.md#33--flat-plate-lift)** — sin·cos lift and sin² drag valid at all orientations including broadside, inverted, and tumbling
- **[Coefficient blending](../KIRCHHOFF.md#4--coefficient-blending)** — Every coefficient (CL, CD, CY, CM, CP, Cn, Cl) is a weighted blend of attached and flat-plate values using f(α)
- **[Control morphing](../KIRCHHOFF.md#5--control-morphing-δ-derivatives)** — Brake, riser, and dirty inputs shift polar parameters via SymmetricControl derivatives, continuously reshaping the aerodynamic envelope
- **[Segment factories](../KIRCHHOFF.md#6--canopy-cell-segment-getcoeffs)** — Canopy cells with arc-angle flow transforms, lifting bodies with pitch offset and pivot rotation, variable-area brake flaps, parasitic drag bodies, and unzippable pilot blending
- **[Wingsuit throttle controls](../KIRCHHOFF.md#10--wingsuit-throttle-controls)** — Multi-axis throttle response (pitch, roll, yaw, dihedral, dirty) layered on top of Kirchhoff evaluation with inter-axis coupling
