/**
 * Experimental, short-lived 2D inertial translation estimate. No browser APIs,
 * permissions, timers, gravity subtraction, screen rotation, or hidden spring.
 *
 * Input MUST be DeviceMotionEvent.acceleration already rotated into the fixed
 * calibrated world frame, in m/s². Never pass accelerationIncludingGravity.
 * W3C: https://www.w3.org/TR/orientation-event/#device-motion
 * MDN: https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/acceleration
 *
 * A still device is required at reset. Small, stable acceleration is only a
 * stationarity HEURISTIC: acceleration alone cannot distinguish rest from
 * constant velocity, establish position, or eliminate integrated sensor drift.
 * The frozen bias, low-pass, and deadband are explicitly heuristics, not sensor
 * fusion or absolute tracking. Reset after rotating substantially or drifting.
 */

export interface MotionVector { x: number; y: number; z: number }
export interface PlanarMotionVector extends MotionVector { z: 0 }
export interface MotionAcceleration { x: number | null; y: number | null; z: number | null }
export type MotionStatus = 'calibrating' | 'tracking' | 'unavailable' | 'stale' |
  'limit-reached' | 'invalid-timestamp';

export interface MotionConfig {
  /** Duration of an uninterrupted small, stable acceleration window. */
  calibrationDurationMs: number;
  /** Prevents two widely separated samples being considered a calibration. */
  minCalibrationSamples: number;
  /** Maximum 3D raw linear-acceleration magnitude during calibration. */
  calibrationMaxMagnitudeMps2: number;
  /** Maximum per-axis peak-to-peak variation within the calibration window. */
  calibrationMaxRangeMps2: number;
  /** Heuristic exponential low-pass time constant; zero explicitly disables it. */
  lowPassTimeConstantMs: number;
  /** Heuristic per-axis deadband after filtering; no velocity damping. */
  deadbandMps2: number;
  /** A longer event gap latches a stop; cannot exceed 250 ms. */
  maxGapMs: number;
  /** Radial world-XY bound from the reset origin; cannot exceed 150 mm. */
  maxDisplacementMm: number;
}

export const DEFAULT_MOTION_CONFIG: Readonly<MotionConfig> = Object.freeze({
  calibrationDurationMs: 600,
  minCalibrationSamples: 12,
  calibrationMaxMagnitudeMps2: 0.35,
  calibrationMaxRangeMps2: 0.12,
  lowPassTimeConstantMs: 80,
  deadbandMps2: 0.08,
  maxGapMs: 250,
  maxDisplacementMm: 150,
});

export interface MotionState {
  status: MotionStatus;
  displacementMm: PlanarMotionVector;
  velocityMps: PlanarMotionVector;
  /** Null until calibration succeeds, then frozen until explicit reset. */
  biasMps2: MotionVector | null;
  /** Applied XY acceleration after bias removal, low-pass, and deadband. */
  filteredAccelerationMps2: PlanarMotionVector;
  calibrationProgress: number;
  calibrationStableMs: number;
  calibrationSamples: number;
  lastTimestampMs: number | null;
  /** Every safety stop is latched. Only reset() can resume calibration. */
  requiresRecenter: boolean;
}

const zero = (): PlanarMotionVector => ({ x: 0, y: 0, z: 0 });
const initialState = (): MotionState => ({
  status: 'calibrating', displacementMm: zero(), velocityMps: zero(),
  biasMps2: null, filteredAccelerationMps2: zero(), calibrationProgress: 0,
  calibrationStableMs: 0, calibrationSamples: 0, lastTimestampMs: null,
  requiresRecenter: false,
});
const axes = ['x', 'y', 'z'] as const;
const validAcceleration = (value: MotionAcceleration | null): value is MotionVector =>
  value !== null && axes.every(axis => typeof value[axis] === 'number' && Number.isFinite(value[axis]));

function validateConfig(config: MotionConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new RangeError(`Invalid motion config: ${key}`);
    }
  }
  if (config.calibrationDurationMs <= 0 || !Number.isInteger(config.minCalibrationSamples) ||
      config.minCalibrationSamples < 2 || config.calibrationMaxMagnitudeMps2 <= 0 ||
      config.calibrationMaxRangeMps2 <= 0 || config.maxGapMs <= 0 || config.maxGapMs > 250 ||
      config.maxDisplacementMm <= 0 || config.maxDisplacementMm > 150) {
    throw new RangeError('Invalid motion config: positive calibration, gap ≤250ms, and bound ≤150mm required');
  }
}

export class MotionEstimator {
  readonly config: Readonly<MotionConfig>;
  private current = initialState();
  private calibrationStartMs: number | null = null;
  private calibrationMin: MotionVector = zero();
  private calibrationMax: MotionVector = zero();
  private calibrationMean: MotionVector = zero();
  /** Keep pre-deadband filter state so sub-threshold inputs can accumulate. */
  private lowPass: PlanarMotionVector = zero();

  constructor(config: Partial<MotionConfig> = {}) {
    const resolved = { ...DEFAULT_MOTION_CONFIG, ...config };
    validateConfig(resolved);
    this.config = Object.freeze(resolved);
  }

  /** Returns a detached snapshot, never a mutable reference to internal state. */
  get state(): MotionState {
    return {
      ...this.current,
      displacementMm: { ...this.current.displacementMm },
      velocityMps: { ...this.current.velocityMps },
      biasMps2: this.current.biasMps2 && { ...this.current.biasMps2 },
      filteredAccelerationMps2: { ...this.current.filteredAccelerationMps2 },
    };
  }

  /** Explicit recenter: clears displacement, velocity, bias, filter, and clocks. */
  reset(): MotionState {
    this.current = initialState();
    this.clearCalibration();
    this.lowPass = zero();
    return this.state;
  }

  /**
   * Use strictly increasing timestamps in milliseconds from one monotonic clock
   * (e.g. performance.now()). Null/incomplete/nonfinite acceleration is a stop,
   * not zero acceleration. There is intentionally no gravity-inclusive fallback.
   */
  update(accelerationWorld: MotionAcceleration | null, timestampMs: number): MotionState {
    if (this.current.requiresRecenter) return this.state;
    const previousTimestamp = this.current.lastTimestampMs;
    if (!Number.isFinite(timestampMs) || timestampMs < 0 ||
        (previousTimestamp !== null && timestampMs <= previousTimestamp)) {
      return this.stop('invalid-timestamp');
    }
    if (!validAcceleration(accelerationWorld)) return this.stop('unavailable');
    if (previousTimestamp !== null && timestampMs - previousTimestamp > this.config.maxGapMs) {
      return this.stop('stale');
    }
    this.current.lastTimestampMs = timestampMs;
    if (this.current.status === 'calibrating') {
      this.calibrate(accelerationWorld, timestampMs);
      return this.state;
    }

    // Tracking cannot begin before calibration has set both bias and timestamp.
    const dtMs = timestampMs - previousTimestamp!;
    const dt = dtMs / 1000;
    const bias = this.current.biasMps2!;
    const alpha = this.config.lowPassTimeConstantMs === 0 ? 1 :
      -Math.expm1(-dtMs / this.config.lowPassTimeConstantMs);
    const applied = zero();
    for (const axis of ['x', 'y'] as const) {
      this.lowPass[axis] += alpha * (accelerationWorld[axis] - bias[axis] - this.lowPass[axis]);
      applied[axis] = Math.abs(this.lowPass[axis]) <= this.config.deadbandMps2 ? 0 : this.lowPass[axis];
    }
    const velocity = zero();
    const displacement = zero();
    for (const axis of ['x', 'y'] as const) {
      // Treat this filtered sample as constant over the preceding event interval.
      // x += v*dt + .5*a*dt²; v += a*dt. Metres -> millimetres exactly once.
      velocity[axis] = this.current.velocityMps[axis] + applied[axis] * dt;
      displacement[axis] = this.current.displacementMm[axis] +
        1000 * (this.current.velocityMps[axis] * dt + 0.5 * applied[axis] * dt * dt);
    }
    if (!Number.isFinite(Math.hypot(displacement.x, displacement.y)) ||
        Math.hypot(displacement.x, displacement.y) >= this.config.maxDisplacementMm ||
        !Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) {
      // Reject the entire step and retain the last safe displacement. Do not
      // silently clamp the output while continuing to integrate behind the cap.
      return this.stop('limit-reached');
    }
    this.current.velocityMps = velocity;
    this.current.displacementMm = displacement;
    this.current.filteredAccelerationMps2 = applied;
    return this.state;
  }

  /** Call from the render loop to stop when events cease altogether. */
  checkStale(timestampMs: number): MotionState {
    if (this.current.requiresRecenter) return this.state;
    const last = this.current.lastTimestampMs;
    if (!Number.isFinite(timestampMs) || timestampMs < 0 || (last !== null && timestampMs < last)) {
      return this.stop('invalid-timestamp');
    }
    if (last !== null && timestampMs - last > this.config.maxGapMs) return this.stop('stale');
    return this.state;
  }

  private stop(status: Exclude<MotionStatus, 'calibrating' | 'tracking'>): MotionState {
    this.current.status = status;
    this.current.requiresRecenter = true;
    this.current.velocityMps = zero();
    this.current.filteredAccelerationMps2 = zero();
    this.lowPass = zero();
    return this.state;
  }

  private clearCalibration(): void {
    this.calibrationStartMs = null;
    this.calibrationMin = zero();
    this.calibrationMax = zero();
    this.calibrationMean = zero();
    this.current.calibrationStableMs = 0;
    this.current.calibrationSamples = 0;
    this.current.calibrationProgress = 0;
  }

  private calibrate(acceleration: MotionVector, timestampMs: number): void {
    if (Math.hypot(acceleration.x, acceleration.y, acceleration.z) > this.config.calibrationMaxMagnitudeMps2) {
      this.clearCalibration();
      return;
    }
    if (this.calibrationStartMs !== null && axes.some(axis =>
      Math.max(this.calibrationMax[axis], acceleration[axis]) -
      Math.min(this.calibrationMin[axis], acceleration[axis]) > this.config.calibrationMaxRangeMps2)) {
      this.clearCalibration();
    }
    if (this.calibrationStartMs === null) {
      this.calibrationStartMs = timestampMs;
      this.calibrationMin = { ...acceleration };
      this.calibrationMax = { ...acceleration };
    }
    this.current.calibrationSamples++;
    for (const axis of axes) {
      this.calibrationMin[axis] = Math.min(this.calibrationMin[axis], acceleration[axis]);
      this.calibrationMax[axis] = Math.max(this.calibrationMax[axis], acceleration[axis]);
      this.calibrationMean[axis] += (acceleration[axis] - this.calibrationMean[axis]) / this.current.calibrationSamples;
    }
    this.current.calibrationStableMs = timestampMs - this.calibrationStartMs;
    this.current.calibrationProgress = Math.min(1,
      this.current.calibrationStableMs / this.config.calibrationDurationMs,
      this.current.calibrationSamples / this.config.minCalibrationSamples);
    if (this.current.calibrationProgress === 1) {
      this.current.biasMps2 = { ...this.calibrationMean };
      this.current.status = 'tracking';
    }
  }
}
