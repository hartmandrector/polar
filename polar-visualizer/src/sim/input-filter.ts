/**
 * Input Filter — EMA smoothing between gamepad and sim.
 *
 * Separates "how responsive the stick feels" from "how stable the vehicle is."
 * Each axis gets its own time constant τ (seconds). Small τ = nearly raw, large τ = mushy.
 *
 * Formula: filtered += (raw - filtered) * (1 - e^(-dt/τ))
 * Handles variable dt naturally. τ=0 bypasses (raw passthrough).
 */

// ─── Core EMA ───────────────────────────────────────────────────────────────

/** Single-axis EMA state */
export interface EMAState {
  value: number;
}

/**
 * Advance one EMA step.
 * @param state   Mutable state (value is updated in place)
 * @param raw     Raw input value
 * @param tau     Time constant in seconds (0 = passthrough)
 * @param dt      Frame delta time in seconds
 * @returns       Filtered value
 */
export function emaStep(state: EMAState, raw: number, tau: number, dt: number): number {
  if (tau <= 0 || dt <= 0) {
    state.value = raw;
    return raw;
  }
  const alpha = 1 - Math.exp(-dt / tau);
  state.value += (raw - state.value) * alpha;
  return state.value;
}

// ─── Wingsuit Input Filter ──────────────────────────────────────────────────

export interface WingsuitFilterConfig {
  pitchTau: number;   // seconds (default 0.12)
  rollTau: number;    // seconds (default 0.05)
  yawTau: number;     // seconds (default 0.08)
}

export const WINGSUIT_FILTER_DEFAULTS: WingsuitFilterConfig = {
  pitchTau: 0.12,
  rollTau: 0.05,
  yawTau: 0.08,
};

export class WingsuitInputFilter {
  private pitch: EMAState = { value: 0 };
  private roll: EMAState = { value: 0 };
  private yaw: EMAState = { value: 0 };
  readonly cfg: WingsuitFilterConfig;

  constructor(config: Partial<WingsuitFilterConfig> = {}) {
    this.cfg = { ...WINGSUIT_FILTER_DEFAULTS, ...config };
  }

  /** Filter raw gamepad input, returns smoothed values */
  apply(raw: { pitchThrottle: number; rollThrottle: number; yawThrottle: number }, dt: number) {
    return {
      pitchThrottle: emaStep(this.pitch, raw.pitchThrottle, this.cfg.pitchTau, dt),
      rollThrottle:  emaStep(this.roll, raw.rollThrottle, this.cfg.rollTau, dt),
      yawThrottle:   emaStep(this.yaw, raw.yawThrottle, this.cfg.yawTau, dt),
    };
  }

  reset(): void {
    this.pitch.value = 0;
    this.roll.value = 0;
    this.yaw.value = 0;
  }
}

// ─── Canopy Input Filter ────────────────────────────────────────────────────

export interface CanopyFilterConfig {
  brakeTau: number;       // seconds (default 0.03 — brakes are fast)
  frontRiserTau: number;  // seconds (default 0.08 — risers are slower)
  rearRiserTau: number;   // seconds (default 0.08)
  lateralTau: number;     // seconds (default 0.05)
  twistTau: number;       // seconds (default 0.05)
}

export const CANOPY_FILTER_DEFAULTS: CanopyFilterConfig = {
  brakeTau: 0.40,          // ~1.2m travel, 1.0–1.5s zero→full (3τ ≈ 1.2s)
  frontRiserTau: 0.30,     // ~0.4m travel, 0.8–1.0s zero→full (3τ ≈ 0.9s)
  rearRiserTau: 0.30,      // same as front risers
  lateralTau: 0.12,        // weight shift — fast body movement, 0.3–0.5s
  twistTau: 0.05,          // intentional body twist — quick
};

export class CanopyInputFilter {
  private brakeL: EMAState = { value: 0 };
  private brakeR: EMAState = { value: 0 };
  private frontL: EMAState = { value: 0 };
  private frontR: EMAState = { value: 0 };
  private rearL: EMAState = { value: 0 };
  private rearR: EMAState = { value: 0 };
  private lateral: EMAState = { value: 0 };
  private twist: EMAState = { value: 0 };
  readonly cfg: CanopyFilterConfig;

  constructor(config: Partial<CanopyFilterConfig> = {}) {
    this.cfg = { ...CANOPY_FILTER_DEFAULTS, ...config };
  }

  /** Filter raw canopy gamepad input */
  apply(raw: {
    brakeLeft: number; brakeRight: number;
    frontRiserLeft: number; frontRiserRight: number;
    rearRiserLeft: number; rearRiserRight: number;
    lateralShift: number; twistInput: number;
  }, dt: number) {
    return {
      brakeLeft:       emaStep(this.brakeL, raw.brakeLeft, this.cfg.brakeTau, dt),
      brakeRight:      emaStep(this.brakeR, raw.brakeRight, this.cfg.brakeTau, dt),
      frontRiserLeft:  emaStep(this.frontL, raw.frontRiserLeft, this.cfg.frontRiserTau, dt),
      frontRiserRight: emaStep(this.frontR, raw.frontRiserRight, this.cfg.frontRiserTau, dt),
      rearRiserLeft:   emaStep(this.rearL, raw.rearRiserLeft, this.cfg.rearRiserTau, dt),
      rearRiserRight:  emaStep(this.rearR, raw.rearRiserRight, this.cfg.rearRiserTau, dt),
      lateralShift:    emaStep(this.lateral, raw.lateralShift, this.cfg.lateralTau, dt),
      twistInput:      emaStep(this.twist, raw.twistInput, this.cfg.twistTau, dt),
    };
  }

  reset(): void {
    this.brakeL.value = 0;
    this.brakeR.value = 0;
    this.frontL.value = 0;
    this.frontR.value = 0;
    this.rearL.value = 0;
    this.rearR.value = 0;
    this.lateral.value = 0;
    this.twist.value = 0;
  }
}

// ─── Deploy Input Filter (reuses canopy filter minus brakes) ────────────────

export class DeployInputFilter {
  private frontL: EMAState = { value: 0 };
  private frontR: EMAState = { value: 0 };
  private rearL: EMAState = { value: 0 };
  private rearR: EMAState = { value: 0 };
  private lateral: EMAState = { value: 0 };
  private twist: EMAState = { value: 0 };
  readonly cfg: CanopyFilterConfig;

  constructor(config: Partial<CanopyFilterConfig> = {}) {
    this.cfg = { ...CANOPY_FILTER_DEFAULTS, ...config };
  }

  /** Filter raw deploy gamepad input (no brakes — stowed) */
  apply(raw: {
    frontRiserLeft: number; frontRiserRight: number;
    rearRiserLeft: number; rearRiserRight: number;
    lateralShift: number; twistInput: number;
  }, dt: number) {
    return {
      frontRiserLeft:  emaStep(this.frontL, raw.frontRiserLeft, this.cfg.frontRiserTau, dt),
      frontRiserRight: emaStep(this.frontR, raw.frontRiserRight, this.cfg.frontRiserTau, dt),
      rearRiserLeft:   emaStep(this.rearL, raw.rearRiserLeft, this.cfg.rearRiserTau, dt),
      rearRiserRight:  emaStep(this.rearR, raw.rearRiserRight, this.cfg.rearRiserTau, dt),
      lateralShift:    emaStep(this.lateral, raw.lateralShift, this.cfg.lateralTau, dt),
      twistInput:      emaStep(this.twist, raw.twistInput, this.cfg.twistTau, dt),
      unzipPressed:    (raw as any).unzipPressed ?? false, // passthrough, no filter on button
    };
  }

  reset(): void {
    this.frontL.value = 0;
    this.frontR.value = 0;
    this.rearL.value = 0;
    this.rearR.value = 0;
    this.lateral.value = 0;
    this.twist.value = 0;
  }
}
