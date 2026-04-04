/**
 * Flight Computer — Mode Detection State Machine
 * 
 * Ported from BASElineXR EnhancedFlightMode.java + FlightMode.java.
 * Detects flight phases from GPS data: Ground → Plane → Wingsuit → Deploy → Canopy → Landing.
 * 
 * Uses dual-rate detection (fast per-sample + slow 1Hz) with gated transitions
 * to prevent mode oscillation. Deploy detection uses sustained speeds (vxs threshold).
 * 
 * Designed for real-time but works fine for post-processing — just feed points sequentially.
 */

import { calculateSustainedSpeeds } from './wse';
import { AeroExtraction } from './types';

// ============================================================================
// Flight Modes
// ============================================================================

export const enum FlightMode {
  UNKNOWN  = 0,
  GROUND   = 1,
  PLANE    = 2,
  WINGSUIT = 3,
  FREEFALL = 4,
  DEPLOY   = 5,
  CANOPY   = 6,
  LANDING  = 7,
}

const MODE_STRINGS: Record<number, string> = {
  [FlightMode.UNKNOWN]:  'Unknown',
  [FlightMode.GROUND]:   'Ground',
  [FlightMode.PLANE]:    'Plane',
  [FlightMode.WINGSUIT]: 'Wingsuit',
  [FlightMode.FREEFALL]: 'Freefall',
  [FlightMode.DEPLOY]:   'Deploy',
  [FlightMode.CANOPY]:   'Canopy',
  [FlightMode.LANDING]:  'Landing',
};

export function flightModeString(mode: FlightMode): string {
  return MODE_STRINGS[mode] ?? 'Unknown';
}

// ============================================================================
// Basic Mode Detection (instantaneous, from groundspeed + climb)
// ============================================================================

/** Basic mode from instantaneous horizontal speed and climb rate (m/s) */
function getBasicMode(groundSpeed: number, climb: number): FlightMode {
  if (-0.3 * groundSpeed + 7 < climb && 33 < groundSpeed) {
    return FlightMode.PLANE;
  } else if (climb < -13 && climb < -groundSpeed - 10 && groundSpeed < 19) {
    return FlightMode.FREEFALL;
  } else if (climb < groundSpeed - 32 && climb < -0.3 * groundSpeed + 5.5) {
    return FlightMode.WINGSUIT;
  } else if (climb < -17) {
    return FlightMode.WINGSUIT;
  } else if (-11.5 < climb && climb < -1.1 && groundSpeed - 31 < climb && climb < groundSpeed - 4 && 1.1 < groundSpeed && groundSpeed < 23.5 && climb < -groundSpeed + 20) {
    return FlightMode.CANOPY;
  } else if (groundSpeed + Math.abs(climb - 1) < 5) {
    return FlightMode.GROUND;
  } else if (-1 < climb && climb < 2 && !(groundSpeed > 10)) {
    return FlightMode.GROUND;
  } else {
    return FlightMode.UNKNOWN;
  }
}

// ============================================================================
// Flight Computer State Machine
// ============================================================================

/** Configuration for the flight computer */
export interface FlightComputerConfig {
  /** Slow integration rate (default 0.1) */
  slowAlpha: number;
  /** Confidence threshold for slow mode change (default 0.7) */
  slowThreshold: number;
  /** Deploy detection integration speed (default 0.3) */
  deployAlpha: number;
  /** Deploy confidence threshold (default 0.6) */
  deployThreshold: number;
  /** Landing integration speed (default 0.25) */
  landingAlpha: number;
  /** Landing confidence threshold (default 0.5) */
  landingThreshold: number;
  /** Minimum jump height for landing detection (meters, default 60) */
  minJumpHeight: number;
  /** Sustained speed threshold for deploy (vxs, default 19) */
  deployVxsThreshold: number;
  /** Sustained speed threshold for freefall deploy (vys, default -33) */
  deployVysThreshold: number;
  /** Grace period after reset (seconds, default 3) */
  gracePeriod: number;
}

const DEFAULT_CONFIG: FlightComputerConfig = {
  slowAlpha: 0.1,
  slowThreshold: 0.7,
  deployAlpha: 0.3,
  deployThreshold: 0.6,
  landingAlpha: 0.25,
  landingThreshold: 0.5,
  minJumpHeight: 60,
  deployVxsThreshold: 19,
  deployVysThreshold: -33,
  gracePeriod: 3,
};

/** Input point for the flight computer */
export interface FlightComputerInput {
  t: number;            // seconds from start
  groundSpeed: number;  // m/s horizontal
  climb: number;        // m/s vertical (negative = descending)
  hMSL: number;         // meters altitude
  /** Sustained speed X (lift). Computed from kl if not provided. */
  vxs?: number;
  /** Sustained speed Y (drag). Computed from kd if not provided. */
  vys?: number;
  /** Aero extraction result (used to get vxs/vys if not provided directly) */
  aero?: AeroExtraction;
}

/** Output from flight computer at each timestep */
export interface FlightComputerOutput {
  mode: FlightMode;
  modeString: string;
  deployConfidence: number;
  landingConfidence: number;
}

export class FlightComputer {
  private cfg: FlightComputerConfig;

  // State
  private currentMode: FlightMode = FlightMode.UNKNOWN;
  private slowMode: FlightMode = FlightMode.UNKNOWN;
  private slowModeConfidence = 0;
  private fastMode: FlightMode = FlightMode.UNKNOWN;

  // Deploy detection
  private deployConfidence = 0;
  private deployDetected = false;
  private wingsuitEstablished = false;

  // Direct canopy fallback (when deploy detection fails)
  private canopyConfidence = 0;
  private canopyFallback = false;
  private _canopyFallbackLogged = false;

  // Landing detection
  private landingConfidence = 0;
  private landingDetected = false;
  private altMin = NaN;
  private altMax = NaN;

  // Timing
  private lastSlowUpdate = -Infinity;
  private resetTime = -Infinity;

  constructor(config: Partial<FlightComputerConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  /** Reset to initial state */
  reset(t: number = 0): void {
    this.currentMode = FlightMode.GROUND;
    this.slowMode = FlightMode.UNKNOWN;
    this.fastMode = FlightMode.UNKNOWN;
    this.slowModeConfidence = 0;
    this.deployConfidence = 0;
    this.deployDetected = false;
    this.wingsuitEstablished = false;
    this.canopyConfidence = 0;
    this.canopyFallback = false;
    this._canopyFallbackLogged = false;
    this.landingConfidence = 0;
    this.landingDetected = false;
    this.altMin = NaN;
    this.altMax = NaN;
    this.lastSlowUpdate = -Infinity;
    this.resetTime = t;
  }

  /** Get current mode */
  get mode(): FlightMode {
    return this.currentMode;
  }

  /** Process one timestep. Call sequentially for each GPS point. */
  update(input: FlightComputerInput): FlightComputerOutput {
    const { t, groundSpeed, climb, hMSL } = input;

    // Resolve sustained speeds
    let vxs = input.vxs ?? 0;
    let vys = input.vys ?? 0;
    if (input.aero && vxs === 0 && vys === 0) {
      vxs = input.aero.sustainedX;
      vys = input.aero.sustainedY;
    }

    // Fast update (every sample)
    this.updateFast(groundSpeed, climb, vxs, vys, t);

    // Slow update (~1Hz)
    if (t - this.lastSlowUpdate >= 1.0) {
      this.lastSlowUpdate = t;
      this.updateSlow(groundSpeed, climb, hMSL);
    }

    // Apply gated transitions
    this.currentMode = this.applyTransitionGates(groundSpeed, climb);

    return {
      mode: this.currentMode,
      modeString: flightModeString(this.currentMode),
      deployConfidence: this.deployConfidence,
      landingConfidence: this.landingConfidence,
    };
  }

  /** Process an entire array of points. Returns mode output per point. */
  processAll(inputs: FlightComputerInput[]): FlightComputerOutput[] {
    this.reset(inputs.length > 0 ? inputs[0].t : 0);
    return inputs.map(input => this.update(input));
  }

  // ---------- Internal ----------

  private updateFast(
    groundSpeed: number, climb: number,
    vxs: number, vys: number, t: number,
  ): void {
    this.fastMode = getBasicMode(groundSpeed, climb);

    // Grace period after reset
    const inGracePeriod = (t - this.resetTime) < this.cfg.gracePeriod;
    if (inGracePeriod) {
      this.deployConfidence = 0;
      this.deployDetected = false;
      this.wingsuitEstablished = false;
      return;
    }

    if (this.currentMode === FlightMode.WINGSUIT) {
      if (vxs > this.cfg.deployVxsThreshold) {
        if (!this.wingsuitEstablished) {
          console.log(`[FC] t=${t.toFixed(1)}s wingsuitEstablished=true (vxs=${vxs.toFixed(1)} > ${this.cfg.deployVxsThreshold})`);
        }
        this.wingsuitEstablished = true;
      }
      if (this.wingsuitEstablished && vxs < this.cfg.deployVxsThreshold && vxs > 0) {
        this.deployConfidence += (1 - this.deployConfidence) * this.cfg.deployAlpha;
      } else {
        this.deployConfidence *= (1 - this.cfg.deployAlpha);
      }
      this.deployDetected = this.deployConfidence > this.cfg.deployThreshold;

      // Log every ~2s while in wingsuit
      if (Math.abs(t % 2) < 0.15) {
        console.log(`[FC] t=${t.toFixed(1)}s WINGSUIT: gs=${groundSpeed.toFixed(1)} climb=${climb.toFixed(1)} vxs=${vxs.toFixed(1)} wsEstab=${this.wingsuitEstablished} deployConf=${this.deployConfidence.toFixed(2)} canopyConf=${this.canopyConfidence.toFixed(2)} fastMode=${flightModeString(this.fastMode)}`);
      }

    } else if (this.currentMode === FlightMode.FREEFALL) {
      if (vys > this.cfg.deployVysThreshold && vys < 0) {
        this.deployConfidence += (1 - this.deployConfidence) * this.cfg.deployAlpha;
      } else {
        this.deployConfidence *= (1 - this.cfg.deployAlpha);
      }
      this.deployDetected = this.deployConfidence > this.cfg.deployThreshold;

    } else {
      this.deployConfidence = 0;
      this.deployDetected = false;
      this.wingsuitEstablished = false;
    }

    // ── Cross-mode canopy fallback (works from WINGSUIT, DEPLOY, PLANE, UNKNOWN) ──
    // Tracks whether speed/climb have entered the canopy-like regime
    // even if getBasicMode doesn't return CANOPY (its zone is narrow).
    // Uses broader criteria: gs < 25, -12 < climb < 0, NOT in freefall zone.
    const canopyLike = groundSpeed < 25 && climb > -12 && climb < 0
      && this.fastMode !== FlightMode.FREEFALL && this.fastMode !== FlightMode.GROUND;
    const postWingsuit = this.wingsuitEstablished
      && (this.currentMode === FlightMode.WINGSUIT
        || this.currentMode === FlightMode.DEPLOY
        || this.currentMode === FlightMode.PLANE
        || this.currentMode === FlightMode.UNKNOWN);

    if (postWingsuit && (this.fastMode === FlightMode.CANOPY || canopyLike)) {
      this.canopyConfidence += (1 - this.canopyConfidence) * 0.3;
    } else if (postWingsuit) {
      this.canopyConfidence *= 0.85;
    } else {
      this.canopyConfidence = 0;
    }
    this.canopyFallback = this.canopyConfidence > 0.6;

    if (this.canopyFallback && !this._canopyFallbackLogged) {
      console.log(`[FC] t=${t.toFixed(1)}s canopyFallback triggered (canopyConf=${this.canopyConfidence.toFixed(2)}, gs=${groundSpeed.toFixed(1)}, climb=${climb.toFixed(1)}, mode=${flightModeString(this.currentMode)}, fastMode=${flightModeString(this.fastMode)})`);
      this._canopyFallbackLogged = true;
    }
  }

  private updateSlow(groundSpeed: number, climb: number, hMSL: number): void {
    // Altitude tracking
    if (!isNaN(hMSL)) {
      if (isNaN(this.altMin) || hMSL < this.altMin) this.altMin = hMSL;
      if (isNaN(this.altMax) || hMSL > this.altMax) this.altMax = hMSL;
    }

    // Slow mode confidence integration
    if (this.fastMode === this.slowMode) {
      this.slowModeConfidence += (1 - this.slowModeConfidence) * this.cfg.slowAlpha * 2;
    } else {
      this.slowModeConfidence *= (1 - this.cfg.slowAlpha);
      if (this.slowModeConfidence < (1 - this.cfg.slowThreshold)) {
        this.slowMode = this.fastMode;
        this.slowModeConfidence = 0.5;
      }
    }

    // Landing detection
    if (this.currentMode === FlightMode.CANOPY || this.currentMode === FlightMode.LANDING) {
      const onGround = getBasicMode(groundSpeed, climb) === FlightMode.GROUND;
      const slowSpeed = groundSpeed < 7;
      const lowClimb = Math.abs(climb) < 3;
      const significantAlt = !isNaN(this.altMax) && !isNaN(this.altMin)
        && (this.altMax - this.altMin) > this.cfg.minJumpHeight;

      if ((onGround || (slowSpeed && lowClimb)) && significantAlt) {
        const altNorm = !isNaN(hMSL) ? (hMSL - this.altMin) / (this.altMax - this.altMin) : 0.5;
        this.landingConfidence += (1 - this.landingConfidence) * (1 - altNorm) * this.cfg.landingAlpha;
      } else {
        this.landingConfidence *= (1 - this.cfg.landingAlpha * 0.3);
      }
      this.landingDetected = this.landingConfidence > this.cfg.landingThreshold;
    } else {
      this.landingConfidence = 0;
      this.landingDetected = false;
    }
  }

  private applyTransitionGates(groundSpeed: number, climb: number): FlightMode {
    // Stay on ground if we look like ground and are already there
    if (groundSpeed + Math.abs(climb - 1) < 5 && this.currentMode === FlightMode.GROUND) {
      return FlightMode.GROUND;
    }

    switch (this.currentMode) {
      case FlightMode.GROUND:
        if (this.fastMode === FlightMode.PLANE) return FlightMode.PLANE;
        if (this.fastMode === FlightMode.WINGSUIT) return FlightMode.WINGSUIT;
        if (this.fastMode === FlightMode.FREEFALL) return FlightMode.FREEFALL;
        return FlightMode.GROUND;

      case FlightMode.PLANE:
        if (this.canopyFallback) {
          console.log(`[FC] PLANE → CANOPY (canopy fallback, canopyConf=${this.canopyConfidence.toFixed(2)})`);
          return FlightMode.CANOPY;
        }
        if (this.fastMode === FlightMode.WINGSUIT) return FlightMode.WINGSUIT;
        if (this.fastMode === FlightMode.FREEFALL) return FlightMode.FREEFALL;
        if (this.fastMode === FlightMode.GROUND) return FlightMode.GROUND;
        return FlightMode.PLANE;

      case FlightMode.WINGSUIT:
        if (this.deployDetected) {
          console.log(`[FC] WINGSUIT → DEPLOY (deployConf=${this.deployConfidence.toFixed(2)})`);
          return FlightMode.DEPLOY;
        }
        if (this.canopyFallback) {
          console.log(`[FC] WINGSUIT → CANOPY (direct fallback, canopyConf=${this.canopyConfidence.toFixed(2)})`);
          return FlightMode.CANOPY;
        }
        // Only allow WINGSUIT→PLANE if wingsuit wasn't established (prevents deploy flare from escaping)
        if (this.fastMode === FlightMode.PLANE && !this.wingsuitEstablished) return FlightMode.PLANE;
        return FlightMode.WINGSUIT;

      case FlightMode.FREEFALL:
        if (this.deployDetected) return FlightMode.DEPLOY;
        if (this.fastMode === FlightMode.WINGSUIT) return FlightMode.WINGSUIT;
        return FlightMode.FREEFALL;

      case FlightMode.DEPLOY:
        if (this.fastMode === FlightMode.CANOPY || this.canopyFallback) {
          console.log(`[FC] DEPLOY → CANOPY`);
          return FlightMode.CANOPY;
        }
        console.log(`[FC] DEPLOY: waiting for CANOPY fastMode, got ${flightModeString(this.fastMode)} gs=${groundSpeed.toFixed(1)} climb=${climb.toFixed(1)}`);
        return FlightMode.DEPLOY;

      case FlightMode.CANOPY:
        if (this.landingDetected) return FlightMode.LANDING;
        return FlightMode.CANOPY;

      case FlightMode.LANDING:
        // Stay in Landing until nearly stopped (< 0.5 m/s groundspeed)
        if (groundSpeed < 0.5) {
          this.resetJumpState();
          return FlightMode.GROUND;
        }
        return FlightMode.LANDING;

      case FlightMode.UNKNOWN:
      default:
        return this.mapBasicToEnhanced(this.fastMode);
    }
  }

  private mapBasicToEnhanced(basic: FlightMode): FlightMode {
    switch (basic) {
      case FlightMode.GROUND: return FlightMode.GROUND;
      case FlightMode.PLANE: return FlightMode.PLANE;
      case FlightMode.WINGSUIT: return FlightMode.WINGSUIT;
      case FlightMode.FREEFALL: return FlightMode.FREEFALL;
      // Don't map directly to canopy — must go through deploy
      case FlightMode.CANOPY: return FlightMode.UNKNOWN;
      default: return FlightMode.UNKNOWN;
    }
  }

  private resetJumpState(): void {
    this.altMin = NaN;
    this.altMax = NaN;
    this.deployConfidence = 0;
    this.deployDetected = false;
    this.wingsuitEstablished = false;
    this.canopyConfidence = 0;
    this.canopyFallback = false;
    this._canopyFallbackLogged = false;
    this.landingConfidence = 0;
    this.landingDetected = false;
    this.slowModeConfidence = 0;
  }
}
