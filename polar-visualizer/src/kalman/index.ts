/**
 * src/kalman/index.ts — Barrel exports for the orientation Kalman filter module.
 */
export { OrientationEKF } from './orientation-ekf.js'
export { AeroMomentAdapter, createAeroAdapter, type AeroAdapterConfig } from './aero-adapter.js'
export { runOrientationEKF, type EKFRunnerConfig, type EKFRunnerResult } from './ekf-runner.js'
export {
  STATE_SIZE,
  MEAS_SIZE,
  StateIdx,
  MeasIdx,
  DEFAULT_CONFIG,
  type OrientationMeasurement,
  type OrientationEstimate,
  type AeroMomentModel,
  type OrientationKalmanConfig,
} from './types.js'
export {
  createIdentityMatrix,
  createZeroMatrix,
  matrixMultiply,
  matrixVectorMultiply,
  matrixAdd,
  matrixSubtract,
  matrixScale,
  transpose,
  matrixInverse,
} from './matrix.js'
