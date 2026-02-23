# Reference Papers

## In this folder

1. **Slegers-Costello-2003-Aspects-of-Control-Parafoil-Payload.pdf**
   - Slegers, N. & Costello, M., "Aspects of Control for a Parafoil and Payload System," *Journal of Guidance, Control, and Dynamics*, Vol. 26, No. 6, 2003.
   - DOI: 10.2514/2.6933
   - Topics: 9DOF parafoil-payload model (canopy 6DOF + payload 3DOF), brake deflection control, roll steering vs skid steering, joint constraint forces between canopy and payload.

2. **Clarke-Gutman-2022-Dynamic-Model-Skydiver.pdf**
   - Clarke, R. & Gutman, P.-O., "A dynamic model of a skydiver with validation in wind tunnel and free fall," *IFAC Journal of Systems and Control*, Vol. 22, 2022, 100207.
   - DOI: 10.1016/j.ifacsc.2022.100207
   - arXiv: 2202.10233
   - Topics: Segmented rigid-body skydiver model, per-segment aerodynamic coefficients, wind tunnel validation, freefall validation. Directly applicable to slick skydiver modeling.

3. **Clarke-Gutman-2023-Skydiving-Technique-Analysis.pdf**
   - Clarke, R. & Gutman, P.-O., "Skydiving technique analysis from a control engineering perspective: Developing a tool for studying human motor equivalence," *IFAC Journal of Systems and Control*, Vol. 23, 2023, 100218.
   - DOI: 10.1016/j.ifacsc.2023.100218
   - arXiv: 2201.05917
   - Topics: Control engineering analysis of skydiving technique, motor equivalence, body pose → aerodynamic effect mapping. Follow-up to the 2022 paper.

## Additional papers of interest (not acquired)

- Works Jr., M., "Wings of Man — The Theory of Freefall Flight," AIAA 1979-452 (1979). Classic foundational theory.
- Aoyama & Nakashima, "Simulation Analysis of Maneuver in Skydiving," 2006. Earlier maneuver simulation.
- Dietz et al., "A CFD Toolkit for Modeling Parachutists in Freefall," AIAA 2011-2589. CFD approach — computationally heavy but potential data source.
- Clarke & Gutman, "Model Predictive Control for Skydiver Fall-Rate Adjustment," IEEE MED 2019. MPC control with simpler body model.
- Kim et al., "Projected Area of a Freefall Skydiver — Anthropometry," 2024. Body segment projected area methodology.

## To acquire

2. **Mortaloni et al. — 6DOF Low-Aspect-Ratio Parafoil Delivery System**
   - Mortaloni, P., Yakimenko, O., Dobrokhodov, V., and Howard, R., "On the Development of a Six-Degree-of-Freedom Model of a Low-Aspect-Ratio Parafoil Delivery System," *17th AIAA Aerodynamic Decelerator Systems Technology Conference*, AIAA 2003-2105, Monterey, CA, May 2003.
   - DOI: 10.2514/6.2003-2105
   - PDF is behind AIAA paywall. Available via NPS Calhoun repository (may require institutional access): https://calhoun.nps.edu/handle/10945/35312
   - Topics: 6DOF parafoil model, added mass identification, parameter estimation, line tension modeling.

## Relevance to Polar Project

**Parafoil coupling** (Slegers & Costello, Mortaloni): Both papers address the canopy-payload coupling problem we need for line tension modeling. Slegers & Costello treat the system as two bodies (canopy + payload) connected by a joint with constraint forces — directly analogous to our riser/bridle geometry. Mortaloni extends this with added mass identification for the inflated canopy, which connects to our apparent mass model.

**Slick skydiver modeling** (Clarke & Gutman): The 2022 paper is the primary reference for extending the Polar system to model slick (no-wingsuit) skydivers. Segmented rigid body with per-segment drag and lift coefficients, validated against real wind tunnel and freefall data. The 2023 follow-up connects body pose to aerodynamic outcomes — relevant for our Kirchhoff-based segment factories applied to human body segments.

Future work: integrate line tension as constraint forces between canopy and pilot mass systems (see docs/UNFINISHED-AERO.md).
