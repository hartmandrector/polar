/**
 * GPS Processing Pipeline — Type Definitions
 * 
 * Coordinate frame: NED (North-East-Down) throughout pipeline.
 * Wind model uses NED wind vectors (positive = wind blowing toward N/E/D).
 */

// ============================================================================
// Raw GPS Data
// ============================================================================

/** Raw GNSS data point from FlySight TRACK.CSV */
export interface GNSSData {
  type: 'GNSS';
  isoTime: string;
  timestamp: number;       // ms since epoch
  lat: number;             // degrees
  lon: number;             // degrees
  hMSL: number;            // m above mean sea level
  velN: number;            // m/s NED
  velE: number;            // m/s NED
  velD: number;            // m/s NED
  hAcc: number;            // m horizontal accuracy
  vAcc: number;            // m vertical accuracy
  sAcc: number;            // m/s speed accuracy
  numSV: number;           // satellite count
}

/** Parsed TRACK.CSV dataset */
export interface TrackDataset {
  gnssData: GNSSData[];
  firmwareVersion: string | null;
  deviceId: string | null;
  sessionId: string | null;
}

/** CloudBASE-style stability CSV row */
export interface StabilityCSVRow {
  t: number;               // seconds from start
  V: number;               // m/s airspeed
  alpha_deg: number;       // degrees angle of attack
  gamma_deg: number;       // degrees flight path angle
  phi_deg: number;         // degrees bank angle
  theta_deg: number;       // degrees pitch
  psi_deg: number;         // degrees heading
  p_dps: number;           // deg/s roll rate
  q_dps: number;           // deg/s pitch rate
  r_dps: number;           // deg/s yaw rate
  vN: number;              // m/s NED
  vE: number;              // m/s NED
  vD: number;              // m/s NED
  hMSL: number;            // m altitude
  qbar: number;            // Pa dynamic pressure
  rho: number;             // kg/m³ density
  CL: number;              // lift coefficient
  CD: number;              // drag coefficient
}

// ============================================================================
// Processed GPS Data
// ============================================================================

/** Smoothed + differentiated GPS point ready for aero extraction */
export interface GPSProcessedPoint {
  t: number;               // seconds from start
  
  // Smoothed velocity (NED, m/s)
  velN: number;
  velE: number;
  velD: number;
  
  // LS acceleration (NED, m/s²)
  accelN: number;
  accelE: number;
  accelD: number;
  
  // Derived aero state
  airspeed: number;        // m/s (after wind correction)
  groundSpeed: number;     // m/s horizontal
  
  // Position — NED relative to first point (meters)
  posN: number;
  posE: number;
  posD: number;
  
  // Position — geodetic (for geo-referencing / map overlay)
  hMSL: number;            // m altitude above mean sea level
  lat: number;             // degrees
  lon: number;             // degrees
  
  // Atmosphere
  rho: number;             // kg/m³
  qbar: number;            // Pa dynamic pressure
}

// ============================================================================
// Aero Extraction
// ============================================================================

/** Aerodynamic coefficients extracted from GPS acceleration */
export interface AeroExtraction {
  kl: number;              // lift parameter (CL·q·S / m·g)
  kd: number;              // drag parameter (CD·q·S / m·g)
  roll: number;            // radians bank angle
  
  // Recovered coefficients
  cl: number;              // system CL (from kl, rho, S, m)
  cd: number;              // system CD (from kd, rho, S, m)
  
  // Sustained speed coordinates
  sustainedX: number;      // kl / (kl²+kd²)^0.75
  sustainedY: number;      // kd / (kl²+kd²)^0.75
  sustainedMag: number;    // magnitude of sustained speed vector
  
  // AOA from segment model matching
  aoa: number;             // radians, estimated angle of attack
  aoaResidual: number;     // CL/CD match residual (quality metric)

  // Euler angles — airspeed-based with AOA composition (matches CloudBASE)
  gamma: number;           // radians, flight path angle (negative = descending)
  theta: number;           // radians, pitch = gamma_air + alpha·cos(roll)
  psi: number;             // radians, heading = heading_air + alpha·sin(roll)
}

/** Full GPS pipeline output point */
export interface GPSPipelinePoint {
  processed: GPSProcessedPoint;
  aero: AeroExtraction;
  /** Flight mode from state machine (populated after pipeline run) */
  flightMode?: FlightModeOutput;
  /** Body-axis angular rates from Euler angle differentiation */
  bodyRates?: BodyRates;
  /** Solved pilot control inputs from control inversion (Pass 2) */
  solvedControls?: SolvedControls;
}

/** Flight mode output attached to each pipeline point */
export interface FlightModeOutput {
  mode: number;            // FlightMode enum value
  modeString: string;      // human-readable mode label
  deployConfidence: number;
  landingConfidence: number;
}

/** Body-axis angular rates via inverse DKE from Euler angles */
export interface BodyRates {
  p: number;               // deg/s roll rate
  q: number;               // deg/s pitch rate
  r: number;               // deg/s yaw rate
  /** Angular accelerations via LS linear fit on smoothed rates [deg/s²] */
  pDot?: number;
  qDot?: number;
  rDot?: number;
  /** Euler rates from SG-smoothed angles → LS derivative [deg/s] */
  phiDot?: number;
  thetaDot?: number;
  psiDot?: number;
}

/** Solved pilot control inputs from control inversion */
export interface SolvedControls {
  pitchThrottle: number;   // [-1, 1]
  rollThrottle: number;    // [-1, 1]
  yawThrottle: number;     // [-1, 1]
  converged: boolean;
}

// ============================================================================
// Wind Model
// ============================================================================

/** Wind vector — meteorological "from" convention (NED frame) */
export interface WindVector {
  wN: number;              // m/s wind FROM North (headwind when flying north)
  wE: number;              // m/s wind FROM East (headwind when flying east)
  wD: number;              // m/s wind FROM above (usually ~0)
}

// ============================================================================
// Sustained Speeds
// ============================================================================

/** Sustained speed pair */
export interface SustainedSpeeds {
  vxs: number;             // lift sustained speed
  vys: number;             // drag sustained speed
}
