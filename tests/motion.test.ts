import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MOTION_CONFIG, MotionEstimator, type MotionAcceleration,
  type MotionConfig, type MotionVector } from '../src/motion.ts';

const zero = { x: 0, y: 0, z: 0 };
function near(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
function ready(config: Partial<MotionConfig> = {}, bias: MotionVector = zero): MotionEstimator {
  const estimator = new MotionEstimator({ lowPassTimeConstantMs: 0, deadbandMps2: 0, ...config });
  for (let t = 0; t <= 600; t += 50) estimator.update(bias, t);
  assert.equal(estimator.state.status, 'tracking');
  return estimator;
}

test('defaults expose the declared heuristic settings and hard safety ceilings', () => {
  const estimator = new MotionEstimator();
  assert.deepEqual(estimator.config, DEFAULT_MOTION_CONFIG);
  assert.equal(estimator.config.calibrationDurationMs, 600);
  assert.equal(estimator.config.maxGapMs, 250);
  assert.equal(estimator.config.maxDisplacementMm, 150);
  assert.equal(estimator.state.status, 'calibrating');
  assert.equal(estimator.state.biasMps2, null);
  assert.equal(estimator.state.requiresRecenter, false);
});

test('requires a complete stable 600ms window and never integrates calibration samples', () => {
  const estimator = new MotionEstimator();
  const bias = { x: 0.1, y: -0.08, z: 0.06 };
  for (let t = 0; t < 600; t += 50) {
    const state = estimator.update(bias, t);
    assert.equal(state.status, 'calibrating');
    assert.ok(state.calibrationProgress < 1);
    assert.deepEqual(state.displacementMm, zero);
    assert.deepEqual(state.velocityMps, zero);
  }
  const state = estimator.update(bias, 600);
  assert.equal(state.status, 'tracking');
  assert.deepEqual(state.biasMps2, bias);
  assert.equal(state.calibrationSamples, 13);
  assert.equal(state.calibrationStableMs, 600);
  assert.equal(state.calibrationProgress, 1);
});

test('requires enough samples in addition to elapsed calibration time', () => {
  const estimator = new MotionEstimator();
  for (let t = 0; t <= 600; t += 200) estimator.update(zero, t);
  assert.equal(estimator.state.status, 'calibrating');
  assert.equal(estimator.state.calibrationProgress, 4 / 12);
  for (let t = 650; t <= 1000; t += 50) estimator.update(zero, t);
  assert.equal(estimator.state.status, 'tracking');
});

test('movement restarts calibration, including movement on unintegrated Z axis', () => {
  const estimator = new MotionEstimator();
  for (let t = 0; t <= 500; t += 50) estimator.update(zero, t);
  const moving = estimator.update({ x: 0, y: 0, z: 0.5 }, 550);
  assert.equal(moving.calibrationSamples, 0);
  assert.equal(moving.calibrationProgress, 0);
  for (let t = 600; t < 1200; t += 50) {
    assert.equal(estimator.update(zero, t).status, 'calibrating');
  }
  assert.equal(estimator.update(zero, 1200).status, 'tracking');
});

test('small but unstable samples cannot complete bias calibration', () => {
  const estimator = new MotionEstimator();
  for (let i = 0; i < 80; i++) {
    const state = estimator.update({ x: i % 2 ? 0.1 : -0.1, y: 0, z: 0 }, i * 50);
    assert.equal(state.status, 'calibrating');
    assert.equal(state.calibrationSamples, 1);
    assert.equal(state.calibrationProgress, 0);
  }
});

test('freezes initial mean bias and removes it from subsequent acceleration', () => {
  const bias = { x: 0.1, y: -0.12, z: 0.04 };
  const estimator = ready({}, bias);
  for (let t = 650; t <= 1200; t += 50) estimator.update(bias, t);
  assert.deepEqual(estimator.state.displacementMm, zero);
  assert.deepEqual(estimator.state.velocityMps, zero);
  const moved = estimator.update({ x: 1.1, y: -0.12, z: 0.04 }, 1300);
  near(moved.displacementMm.x, 5);
  near(moved.velocityMps.x, 0.1);
  assert.deepEqual(moved.biasMps2, bias);
});

test('integrates known acceleration in seconds and outputs millimetres exactly once', () => {
  const estimator = ready();
  estimator.update({ x: 1, y: -0.5, z: 6 }, 700);
  const state = estimator.update({ x: 1, y: -0.5, z: 6 }, 800);
  near(state.velocityMps.x, 0.2);
  near(state.velocityMps.y, -0.1);
  near(state.displacementMm.x, 20);
  near(state.displacementMm.y, -10);
  assert.equal(state.displacementMm.z, 0);
  assert.equal(state.velocityMps.z, 0);
  assert.equal(state.filteredAccelerationMps2.z, 0);
});

test('low-pass uses elapsed-time exponential response and keeps its own filter state', () => {
  const estimator = ready({ lowPassTimeConstantMs: 100, deadbandMps2: 0.1 });
  const first = estimator.update({ x: 1, y: 0, z: 0 }, 700);
  near(first.filteredAccelerationMps2.x, 1 - Math.exp(-1));
  const second = estimator.update({ x: 1, y: 0, z: 0 }, 800);
  near(second.filteredAccelerationMps2.x, 1 - Math.exp(-2));

  const slow = ready({ lowPassTimeConstantMs: 100, deadbandMps2: 0.08 });
  const suppressed = slow.update({ x: 0.2, y: 0, z: 0 }, 650);
  assert.equal(suppressed.filteredAccelerationMps2.x, 0);
  const accumulated = slow.update({ x: 0.2, y: 0, z: 0 }, 700);
  near(accumulated.filteredAccelerationMps2.x, 0.2 * (1 - Math.exp(-1)));
});

test('deadband suppresses small acceleration but never damps velocity or recenters', () => {
  const estimator = ready({ deadbandMps2: 0.08 });
  estimator.update({ x: 1, y: 0, z: 0 }, 700);
  for (let t = 800; t <= 1200; t += 100) {
    const state = estimator.update({ x: 0.07, y: -0.08, z: 0 }, t);
    near(state.velocityMps.x, 0.1);
    near(state.displacementMm.x, 5 + (t - 700) * 0.1);
    assert.equal(state.filteredAccelerationMps2.x, 0);
    assert.equal(state.velocityMps.y, 0);
  }
});

test('a stopped displacement remains in place with no hidden recenter spring', () => {
  const estimator = ready();
  estimator.update({ x: 1, y: 0, z: 0 }, 700);
  estimator.update({ x: -1, y: 0, z: 0 }, 800);
  for (let t = 900; t <= 5000; t += 100) {
    const state = estimator.update(zero, t);
    near(state.displacementMm.x, 10);
    near(state.velocityMps.x, 0);
  }
});

test('null, incomplete, and nonfinite readings latch unavailable instead of becoming zero', () => {
  const invalid: Array<MotionAcceleration | null> = [null,
    { x: null, y: 0, z: 0 }, { x: 0, y: null, z: 0 }, { x: 0, y: 0, z: null },
    { x: NaN, y: 0, z: 0 }, { x: 0, y: Infinity, z: 0 }, { x: 0, y: 0, z: -Infinity }];
  for (const acceleration of invalid) {
    const estimator = ready();
    const previous = estimator.update({ x: 1, y: 0, z: 0 }, 700);
    const stopped = estimator.update(acceleration, 800);
    assert.equal(stopped.status, 'unavailable');
    assert.equal(stopped.requiresRecenter, true);
    assert.deepEqual(stopped.velocityMps, zero);
    assert.deepEqual(stopped.displacementMm, previous.displacementMm);
    assert.deepEqual(estimator.update(zero, 900), stopped);
  }
});

test('null on the first event fails without attempting gravity-inclusive fallback', () => {
  const estimator = new MotionEstimator();
  const state = estimator.update(null, 0);
  assert.equal(state.status, 'unavailable');
  assert.equal(state.biasMps2, null);
  assert.equal(state.calibrationSamples, 0);
});

test('a 250ms interval is accepted but a longer gap latches stale without integration', () => {
  const estimator = ready();
  const last = estimator.update({ x: 1, y: 0, z: 0 }, 850);
  assert.equal(last.status, 'tracking');
  near(last.displacementMm.x, 31.25);
  const stopped = estimator.update({ x: 1, y: 0, z: 0 }, 1100.001);
  assert.equal(stopped.status, 'stale');
  assert.equal(stopped.requiresRecenter, true);
  assert.deepEqual(stopped.displacementMm, last.displacementMm);
  assert.deepEqual(stopped.velocityMps, zero);
  assert.deepEqual(estimator.update(zero, 1200), stopped);
});

test('render-loop staleness check detects silence without extrapolating or advancing timestamps', () => {
  const estimator = ready();
  estimator.update({ x: 1, y: 0, z: 0 }, 700);
  const prior = estimator.state;
  assert.deepEqual(estimator.checkStale(900), prior);
  assert.deepEqual(estimator.checkStale(950), prior);
  const stopped = estimator.checkStale(951);
  assert.equal(stopped.status, 'stale');
  assert.deepEqual(stopped.displacementMm, prior.displacementMm);
  assert.deepEqual(stopped.velocityMps, zero);
});

test('calibration gaps are rejected, not counted toward the stationary window', () => {
  const estimator = new MotionEstimator();
  estimator.update(zero, 0);
  const state = estimator.update(zero, 600);
  assert.equal(state.status, 'stale');
  assert.equal(state.calibrationProgress, 0);
});

test('invalid, duplicate, and decreasing sample timestamps latch an explicit stop', () => {
  for (const timestamp of [NaN, Infinity, -Infinity, -1, 599, 600]) {
    const estimator = ready();
    const stopped = estimator.update(zero, timestamp);
    assert.equal(stopped.status, 'invalid-timestamp');
    assert.equal(stopped.requiresRecenter, true);
    assert.deepEqual(estimator.update(zero, 700), stopped);
  }
  for (const timestamp of [NaN, Infinity, -1, 599]) {
    assert.equal(ready().checkStale(timestamp).status, 'invalid-timestamp');
  }
  assert.equal(ready().checkStale(600).status, 'tracking');
});

test('radial 150mm bound rejects the crossing step and stays stopped until recentered', () => {
  const estimator = ready();
  let previous = estimator.state;
  let stopped = estimator.state;
  for (let t = 700; t <= 1200; t += 100) {
    const next = estimator.update({ x: 1, y: 1, z: 0 }, t);
    if (next.status === 'limit-reached') { stopped = next; break; }
    previous = next;
  }
  assert.equal(stopped.status, 'limit-reached');
  assert.equal(stopped.requiresRecenter, true);
  assert.ok(Math.hypot(previous.displacementMm.x, previous.displacementMm.y) < 150);
  assert.deepEqual(stopped.displacementMm, previous.displacementMm);
  assert.deepEqual(stopped.velocityMps, zero);
  assert.deepEqual(estimator.update({ x: -1, y: -1, z: 0 }, 1300), stopped);
});

test('negative motion and exactly reaching the limit also require recenter', () => {
  const estimator = ready({ maxDisplacementMm: 125 });
  const first = estimator.update({ x: -1, y: 0, z: 0 }, 850);
  near(first.displacementMm.x, -31.25);
  const stopped = estimator.update({ x: -1, y: 0, z: 0 }, 1100);
  assert.equal(stopped.status, 'limit-reached');
  near(stopped.displacementMm.x, -31.25);
});

test('extreme finite readings cannot leak nonfinite displacement or velocity', () => {
  const estimator = ready();
  const state = estimator.update({ x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: 0 }, 850);
  assert.equal(state.status, 'limit-reached');
  assert.deepEqual(state.displacementMm, zero);
  assert.deepEqual(state.velocityMps, zero);
});

test('reset clears all accumulated state and accepts a new monotonic clock origin', () => {
  const estimator = ready({ lowPassTimeConstantMs: 80, deadbandMps2: 0.08 }, { x: 0.1, y: 0, z: 0 });
  estimator.update({ x: 1.1, y: 0, z: 0 }, 700);
  estimator.checkStale(1000);
  assert.deepEqual(estimator.reset(), new MotionEstimator().state);
  for (let t = 0; t <= 600; t += 50) estimator.update(zero, t);
  const clean = estimator.update(zero, 700);
  assert.equal(clean.status, 'tracking');
  assert.deepEqual(clean.displacementMm, zero);
  assert.deepEqual(clean.velocityMps, zero);
  assert.deepEqual(clean.biasMps2, zero);
  assert.deepEqual(clean.filteredAccelerationMps2, zero);
});

test('snapshots and constructor inputs cannot mutate live estimator state/config', () => {
  const config = { maxDisplacementMm: 100 };
  const estimator = ready(config);
  config.maxDisplacementMm = 200;
  assert.equal(estimator.config.maxDisplacementMm, 100);
  assert.equal(Object.isFrozen(estimator.config), true);
  const snapshot = estimator.state;
  snapshot.displacementMm.x = 99;
  snapshot.velocityMps.x = 99;
  snapshot.biasMps2!.x = 99;
  snapshot.filteredAccelerationMps2.x = 99;
  snapshot.status = 'stale';
  assert.deepEqual(estimator.state.displacementMm, zero);
  assert.deepEqual(estimator.state.velocityMps, zero);
  assert.deepEqual(estimator.state.biasMps2, zero);
  assert.deepEqual(estimator.state.filteredAccelerationMps2, zero);
  assert.equal(estimator.state.status, 'tracking');
});

test('configuration cannot disable calibration or raise the hard safety ceilings', () => {
  const invalid: Partial<MotionConfig>[] = [
    { calibrationDurationMs: 0 }, { calibrationDurationMs: -1 }, { calibrationDurationMs: NaN },
    { minCalibrationSamples: 1 }, { minCalibrationSamples: 2.5 },
    { calibrationMaxMagnitudeMps2: 0 }, { calibrationMaxRangeMps2: 0 },
    { lowPassTimeConstantMs: -1 }, { lowPassTimeConstantMs: Infinity }, { deadbandMps2: -1 },
    { maxGapMs: 0 }, { maxGapMs: 251 }, { maxDisplacementMm: 0 }, { maxDisplacementMm: 151 },
  ];
  for (const config of invalid) assert.throws(() => new MotionEstimator(config), RangeError);
});
