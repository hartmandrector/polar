# Reference Papers

## In this folder

1. **Slegers-Costello-2003-Aspects-of-Control-Parafoil-Payload.pdf**
   - Slegers, N. & Costello, M., "Aspects of Control for a Parafoil and Payload System," *Journal of Guidance, Control, and Dynamics*, Vol. 26, No. 6, 2003.
   - DOI: 10.2514/2.6933
   - Topics: 9DOF parafoil-payload model (canopy 6DOF + payload 3DOF), brake deflection control, roll steering vs skid steering, joint constraint forces between canopy and payload.

## To acquire

2. **Mortaloni et al. — 6DOF Low-Aspect-Ratio Parafoil Delivery System**
   - Mortaloni, P., Yakimenko, O., Dobrokhodov, V., and Howard, R., "On the Development of a Six-Degree-of-Freedom Model of a Low-Aspect-Ratio Parafoil Delivery System," *17th AIAA Aerodynamic Decelerator Systems Technology Conference*, AIAA 2003-2105, Monterey, CA, May 2003.
   - DOI: 10.2514/6.2003-2105
   - PDF is behind AIAA paywall. Available via NPS Calhoun repository (may require institutional access): https://calhoun.nps.edu/handle/10945/35312
   - Topics: 6DOF parafoil model, added mass identification, parameter estimation, line tension modeling.

## Relevance to Polar Project

Both papers address the canopy-payload coupling problem we need for line tension modeling. Slegers & Costello treat the system as two bodies (canopy + payload) connected by a joint with constraint forces — directly analogous to our riser/bridle geometry. Mortaloni extends this with added mass identification for the inflated canopy, which connects to our apparent mass model.

Future work: integrate line tension as constraint forces between canopy and pilot mass systems (see docs/UNFINISHED-AERO.md).
