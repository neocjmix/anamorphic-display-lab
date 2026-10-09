import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDisplayFrame, displayLocalToWorld, projectVirtualPoint, targetUvToWorld,
  unprojectDisplayPoint, validateCalibration, type Calibration, type Result, type Vec3 } from '../src/geometry.ts';
import { IDENTITY_QUATERNION, deviceOrientationToQuaternion, inverseQuaternion,
  multiplyQuaternions, normalizeQuaternion, quaternionFromEulerDegrees,
  relativeScreenOrientation, rotateVector, type Quaternion } from '../src/pose.ts';

const X: Vec3 = { x: 1, y: 0, z: 0 }, Y: Vec3 = { x: 0, y: 1, z: 0 }, Z: Vec3 = { x: 0, y: 0, z: 1 };
const zero = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const base = (): Calibration => ({ eye: { x: 20, y: -10, z: 400 },
  display: { widthMm: 68, heightMm: 147, angleDeg: 30, pivot: { x: 12, y: 19, z: -8 } },
  target: { center: { x: -5, y: 6, z: -20 }, widthMm: 48, heightMm: 80 } });
function value<T>(r: Result<T>): T { if (!r.ok) assert.fail(`Invalid geometry: ${r.reason}`); return r.value; }
function present<T>(v: T | null): T { assert.notEqual(v, null); return v as T; }
function near(a: number, b: number, tolerance = 1e-9) { assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`); }
function near3(a: Vec3, b: Vec3, tolerance = 1e-9) { near(a.x, b.x, tolerance); near(a.y, b.y, tolerance); near(a.z, b.z, tolerance); }
function sameRotation(a: Quaternion, b: Quaternion) { for (const axis of [X, Y, Z]) near3(rotateVector(a, axis), rotateVector(b, axis)); }
const euler = (pitchDeg = 0, yawDeg = 0, rollDeg = 0) => quaternionFromEulerDegrees({ pitchDeg, yawDeg, rollDeg });
const radians = (deg: number) => deg * Math.PI / 180;
function rx(v: Vec3, deg: number): Vec3 { const c = Math.cos(radians(deg)), s = Math.sin(radians(deg)); return { x: v.x, y: c * v.y - s * v.z, z: s * v.y + c * v.z }; }
function ry(v: Vec3, deg: number): Vec3 { const c = Math.cos(radians(deg)), s = Math.sin(radians(deg)); return { x: c * v.x + s * v.z, y: v.y, z: -s * v.x + c * v.z }; }
function rz(v: Vec3, deg: number): Vec3 { const c = Math.cos(radians(deg)), s = Math.sin(radians(deg)); return { x: c * v.x - s * v.y, y: s * v.x + c * v.y, z: v.z }; }
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

test('manual pitch/yaw/roll use right-hand signs and intrinsic Y-X-Z composition', () => {
  near3(rotateVector(euler(90), Y), Z);
  near3(rotateVector(euler(0, 90), X), { x: 0, y: 0, z: -1 });
  near3(rotateVector(euler(0, 0, 90), X), Y);
  for (const v of [X, Y, Z, { x: 4, y: -7, z: 11 }]) {
    near3(rotateVector(euler(27, -39, 61), v), ry(rx(rz(v, 61), 27), -39));
  }
});

test('normalization is safe for huge/tiny quaternions and rejects invalid rotations', () => {
  const q = euler(23, -18, 47);
  for (const scale of [1e-300, 1, -1, 1e300]) {
    const scaled = { x: q.x * scale, y: q.y * scale, z: q.z * scale, w: q.w * scale };
    const normalized = present(normalizeQuaternion(scaled));
    near(Math.hypot(normalized.x, normalized.y, normalized.z, normalized.w), 1);
    sameRotation(normalized, q);
    sameRotation(multiplyQuaternions(normalized, inverseQuaternion(scaled)), IDENTITY_QUATERNION);
  }
  for (const q of [null, undefined, { x: 0, y: 0, z: 0, w: 0 }, { x: NaN, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0, w: Infinity }]) {
    assert.equal(normalizeQuaternion(q), null);
  }
});

test('Hamilton multiplication order and inverse recover vectors', () => {
  const a = euler(31, -24, 5), b = euler(-7, 29, 51), v = { x: 23, y: -19, z: 2 };
  near3(rotateVector(multiplyQuaternions(a, b), v), rotateVector(a, rotateVector(b, v)));
  near3(rotateVector(inverseQuaternion(a), rotateVector(a, v)), v);
  const ab = rotateVector(multiplyQuaternions(a, b), v), ba = rotateVector(multiplyQuaternions(b, a), v);
  assert.ok(Math.hypot(ab.x - ba.x, ab.y - ba.y, ab.z - ba.z) > 1);
});

test('browser angles follow W3C Z-X-Y, not yaw-pitch-roll', () => {
  for (const angles of [{ alpha: 0, beta: 0, gamma: 0 }, { alpha: 51, beta: -34, gamma: 23 },
    { alpha: 270, beta: 90, gamma: -61 }, { alpha: 19, beta: -179, gamma: 89 }]) {
    const q = present(deviceOrientationToQuaternion(angles));
    for (const v of [X, Y, Z, { x: -7, y: 3, z: 5 }]) {
      near3(rotateVector(q, v), rz(rx(ry(v, angles.gamma), angles.beta), angles.alpha));
    }
  }
  near3(rotateVector(present(deviceOrientationToQuaternion({ alpha: 90, beta: 0, gamma: 0 })), X), Y);
  near3(rotateVector(present(deviceOrientationToQuaternion({ alpha: 0, beta: 90, gamma: 0 })), Y), Z);
  near3(rotateVector(present(deviceOrientationToQuaternion({ alpha: 0, beta: 0, gamma: 90 })), Z), X);
});

test('screen angle mapping uses negative local Z for portrait and both landscapes', () => {
  const angles = { alpha: 71, beta: 43, gamma: -12 };
  const device = present(deviceOrientationToQuaternion(angles, 0));
  for (const screenAngle of [0, 90, 180, 270, -90, 360]) {
    const screen = present(deviceOrientationToQuaternion(angles, screenAngle));
    for (const v of [X, Y, Z]) near3(rotateVector(screen, v), rotateVector(device, rz(v, -screenAngle)));
    // A pure physical CCW turn cancelled by viewport orientation has unchanged screen axes.
    sameRotation(present(deviceOrientationToQuaternion({ alpha: screenAngle, beta: 0, gamma: 0 }, screenAngle)), IDENTITY_QUATERNION);
  }
  const landscape = present(deviceOrientationToQuaternion({ alpha: 0, beta: 0, gamma: 0 }, 90));
  near3(rotateVector(landscape, X), { x: 0, y: -1, z: 0 });
  near3(rotateVector(landscape, Y), X);
});

test('missing or non-finite browser axes/screen angles are not fabricated as zero', () => {
  for (const bad of [null, NaN, Infinity, -Infinity]) {
    for (const axis of ['alpha', 'beta', 'gamma'] as const) {
      assert.equal(deviceOrientationToQuaternion({ alpha: 5, beta: 10, gamma: 15, [axis]: bad }), null);
    }
  }
  assert.equal(deviceOrientationToQuaternion({ alpha: 0, beta: 0, gamma: 0 }, NaN), null);
  assert.equal(relativeScreenOrientation(IDENTITY_QUATERNION, { x: 0, y: 0, z: 0, w: 0 }), null);
  assert.equal(relativeScreenOrientation(IDENTITY_QUATERNION, IDENTITY_QUATERNION, NaN), null);
});

test('relative calibration uses inverse(reference)*current and converts into baseline world axes', () => {
  for (const screenAngle of [0, 90, 180, 270]) {
    const reference = present(deviceOrientationToQuaternion({ alpha: 113, beta: 71, gamma: -23 }, screenAngle));
    const relative = euler(14, -23, 36);
    const current = multiplyQuaternions(reference, relative);
    const c = base(); c.display.angleDeg = 37;
    const baseline = value(buildDisplayFrame(c.display));
    const delta = present(relativeScreenOrientation(current, reference, c.display.angleDeg));
    c.display.pose = { orientation: delta, translationMm: zero() };
    const posed = value(buildDisplayFrame(c.display));
    near3(posed.origin, baseline.origin);
    for (const [name, axis] of [['right', X], ['up', Y], ['normal', Z]] as const) {
      near3(posed[name], ry(rotateVector(relative, axis), c.display.angleDeg));
    }
    sameRotation(present(relativeScreenOrientation(reference, reference, c.display.angleDeg)), IDENTITY_QUATERNION);
    sameRotation(present(relativeScreenOrientation({ x: -current.x, y: -current.y, z: -current.z, w: -current.w }, reference, c.display.angleDeg)), delta);
  }
});

test('unchanged optional pose preserves the legacy pivot model and projections', () => {
  const c = base(), point = targetUvToWorld({ x: .2, y: .7 }, c.target);
  const legacyFrame = value(buildDisplayFrame(c.display)), legacy = value(projectVirtualPoint(point, c));
  c.display.pose = { orientation: { ...IDENTITY_QUATERNION }, translationMm: zero() };
  const posedFrame = value(buildDisplayFrame(c.display)), posed = value(projectVirtualPoint(point, c));
  for (const key of ['origin', 'right', 'up', 'normal'] as const) near3(posedFrame[key], legacyFrame[key]);
  near3(posed.screenWorld, legacy.screenWorld); near(posed.uv.x, legacy.uv.x); near(posed.uv.y, legacy.uv.y);
  delete c.display.pose;
  assert.deepEqual(value(buildDisplayFrame(c.display)), legacyFrame);
});

test('pose rotates about baseline display centre and translates along world axes', () => {
  const c = base(), snapshot = structuredClone(c), baseline = value(buildDisplayFrame(c.display));
  const orientation = euler(25, -19, 42), translationMm = { x: 14, y: -22, z: 35 };
  c.display.pose = { orientation, translationMm };
  const posed = value(buildDisplayFrame(c.display));
  near3(posed.origin, { x: baseline.origin.x + 14, y: baseline.origin.y - 22, z: baseline.origin.z + 35 });
  for (const key of ['right', 'up', 'normal'] as const) near3(posed[key], rotateVector(orientation, baseline[key]));
  const local = { x: 13, y: -27 }, baselinePoint = displayLocalToWorld(local, baseline);
  const offset = rotateVector(orientation, { x: baselinePoint.x - baseline.origin.x, y: baselinePoint.y - baseline.origin.y, z: baselinePoint.z - baseline.origin.z });
  near3(displayLocalToWorld(local, posed), { x: posed.origin.x + offset.x, y: posed.origin.y + offset.y, z: posed.origin.z + offset.z });
  projectVirtualPoint(c.target.center, c);
  assert.deepEqual(c.eye, snapshot.eye); assert.deepEqual(c.target, snapshot.target);
});

test('posed frames are orthonormal, right-handed, quaternion-sign and scale invariant', () => {
  const c = base(), q = euler(-41, 28, 73);
  let expected: ReturnType<typeof buildDisplayFrame> | null = null;
  for (const scale of [1, -1, 1e-250, 1e250]) {
    c.display.pose = { orientation: { x: q.x * scale, y: q.y * scale, z: q.z * scale, w: q.w * scale }, translationMm: zero() };
    const f = value(buildDisplayFrame(c.display));
    for (const axis of [f.right, f.up, f.normal]) near(dot(axis, axis), 1);
    near(dot(f.right, f.up), 0); near(dot(f.right, f.normal), 0); near(dot(f.up, f.normal), 0);
    near3(cross(f.right, f.up), f.normal);
    if (expected) for (const key of ['origin', 'right', 'up', 'normal'] as const) near3(f[key], value(expected)[key]);
    expected = { ok: true, value: f };
  }
});

test('mixed rigid poses round-trip forward/inverse projections with fixed eye/target', () => {
  let state = 13873; const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 2 ** 32; };
  for (let i = 0; i < 500; i++) {
    const c = base();
    c.display.angleDeg = (random() - .5) * 80;
    c.display.pivot = { x: (random() - .5) * 40, y: 17, z: (random() - .5) * 20 };
    c.display.pose = { orientation: euler((random() - .5) * 40, (random() - .5) * 40, (random() - .5) * 90),
      translationMm: { x: (random() - .5) * 60, y: (random() - .5) * 60, z: (random() - .5) * 60 } };
    c.eye = { x: (random() - .5) * 80, y: (random() - .5) * 80, z: 300 + random() * 300 };
    const point = targetUvToWorld({ x: random(), y: random() }, c.target);
    const projected = value(projectVirtualPoint(point, c));
    const round = value(unprojectDisplayPoint(projected.screenLocalMm, c));
    near3(round.virtualWorld, point, 1e-8); near(projected.t * round.t, 1, 1e-9);
  }
});

test('projection with translation and full rotation preserves uniform physical scaling', () => {
  const c = base(); c.display.pose = { orientation: euler(18, -12, 29), translationMm: { x: 12, y: -17, z: 24 } };
  const point = targetUvToWorld({ x: .3, y: .6 }, c.target), expected = value(projectVirtualPoint(point, c));
  for (const scale of [1e-8, 1e-4, 1, 1e4, 1e8]) {
    const v = (p: Vec3): Vec3 => ({ x: p.x * scale, y: p.y * scale, z: p.z * scale });
    const scaled: Calibration = { eye: v(c.eye),
      display: { ...c.display, widthMm: c.display.widthMm * scale, heightMm: c.display.heightMm * scale,
        pivot: v(c.display.pivot), pose: { orientation: c.display.pose.orientation, translationMm: v(c.display.pose.translationMm) } },
      target: { center: v(c.target.center), widthMm: c.target.widthMm * scale, heightMm: c.target.heightMm * scale } };
    const actual = value(projectVirtualPoint(v(point), scaled));
    near(actual.uv.x, expected.uv.x); near(actual.uv.y, expected.uv.y); near(actual.t, expected.t);
  }
});

test('invalid poses and posed singularities fail explicitly without changing target or eye', () => {
  const c = base(); c.display.pose = { orientation: { x: 0, y: 0, z: 0, w: 0 }, translationMm: zero() };
  assert.deepEqual(buildDisplayFrame(c.display), { ok: false, reason: 'invalid-pose' });
  c.display.pose.orientation = { x: Infinity, y: 0, z: 0, w: 1 };
  assert.deepEqual(buildDisplayFrame(c.display), { ok: false, reason: 'non-finite' });
  c.display.pose = { orientation: { ...IDENTITY_QUATERNION }, translationMm: { x: NaN, y: 0, z: 0 } };
  assert.deepEqual(buildDisplayFrame(c.display), { ok: false, reason: 'non-finite' });
  c.display.angleDeg = 0; c.display.pivot = zero(); c.eye = { x: 0, y: 0, z: 400 };
  c.display.pose = { orientation: euler(90), translationMm: zero() };
  assert.deepEqual(validateCalibration(c), { ok: false, reason: 'eye-on-screen-plane' });
  c.display.pose.orientation = euler(0, 89.999999);
  assert.deepEqual(validateCalibration(c), { ok: false, reason: 'ill-conditioned-screen' });
  c.display.pose = { orientation: { ...IDENTITY_QUATERNION }, translationMm: { x: 0, y: 0, z: 400 } };
  assert.deepEqual(validateCalibration(c), { ok: false, reason: 'eye-on-screen-plane' });
});

test('raw device acceleration maps through calibration without applying screen correction twice', () => {
  const baseline = euler(0, 37), relative = euler(-17, 24, 13);
  const screenAcceleration = { x: 1.7, y: -2.3, z: .4 };
  for (const screenAngle of [0, 90, 180, 270]) {
    const screenToDevice = euler(0, 0, -screenAngle);
    const reference = present(deviceOrientationToQuaternion({ alpha: 113, beta: 71, gamma: -23 }, screenAngle));
    const currentScreen = multiplyQuaternions(reference, relative);
    const currentDevice = multiplyQuaternions(currentScreen, inverseQuaternion(screenToDevice));
    const rawDeviceAcceleration = rotateVector(screenToDevice, screenAcceleration);
    const deviceToWorld = multiplyQuaternions(baseline, multiplyQuaternions(inverseQuaternion(reference), currentDevice));
    near3(rotateVector(deviceToWorld, rawDeviceAcceleration), rotateVector(baseline, rotateVector(relative, screenAcceleration)));
  }
});
