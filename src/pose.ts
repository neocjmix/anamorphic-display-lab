/** Pure rotation math. Active, right-handed rotations; +x right, +y up, +z out
 * of the display. Quaternions are stored xyzw; a*b applies b before a.
 */
import type { Vec3 } from './geometry';

export interface Quaternion { x: number; y: number; z: number; w: number }
export interface RigidPose {
  /** World-space rotation delta about the baseline display's centre. */
  orientation: Quaternion;
  /** Displacement of that centre in world axes, in millimetres. */
  translationMm: Vec3;
}
export interface EulerDegrees { pitchDeg: number; yawDeg: number; rollDeg: number }
export interface DeviceOrientationAngles {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}
export const IDENTITY_QUATERNION: Readonly<Quaternion> = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const invalidQuaternion = (): Quaternion => ({ x: NaN, y: NaN, z: NaN, w: NaN });

/** Rejects missing/non-finite/zero rotations; rescales before taking the norm. */
export function normalizeQuaternion(q: Quaternion | null | undefined): Quaternion | null {
  if (!q || ![q.x, q.y, q.z, q.w].every(Number.isFinite)) return null;
  const scale = Math.max(Math.abs(q.x), Math.abs(q.y), Math.abs(q.z), Math.abs(q.w));
  if (scale === 0) return null;
  const x = q.x / scale, y = q.y / scale, z = q.z / scale, w = q.w / scale;
  const length = Math.hypot(x, y, z, w);
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

/** Hamilton product. Inputs need not be unit; rotation callers should normalize. */
export function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** Inverse rotation (normalized conjugate). Invalid inputs produce NaNs. */
export function inverseQuaternion(q: Quaternion): Quaternion {
  const unit = normalizeQuaternion(q);
  return unit ? { x: -unit.x, y: -unit.y, z: -unit.z, w: unit.w } : invalidQuaternion();
}

/** Rotate a vector by a UNIT quaternion. No translation or unit conversion. */
export function rotateVector(q: Quaternion, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

const axisRotation = (axis: 'x' | 'y' | 'z', degrees: number): Quaternion => {
  const half = (degrees % 360) * Math.PI / 360;
  return { x: 0, y: 0, z: 0, w: Math.cos(half), [axis]: Math.sin(half) };
};

/** Manual controls: Qy(yaw) * Qx(pitch) * Qz(roll), in degrees.
 * These are intrinsic Y-X-Z rotations, not DeviceOrientationEvent angles.
 */
export function quaternionFromEulerDegrees({ pitchDeg, yawDeg, rollDeg }: EulerDegrees): Quaternion {
  return normalizeQuaternion(multiplyQuaternions(
    multiplyQuaternions(axisRotation('y', yawDeg), axisRotation('x', pitchDeg)),
    axisRotation('z', rollDeg),
  )) ?? invalidQuaternion();
}

/** Browser reference-from-screen orientation.
 * W3C intrinsic Z-X'-Y'': D = Rz(alpha) Rx(beta) Ry(gamma).
 * Device axes remain fixed to the natural screen; viewport axes need
 * S = Rz(-screen.orientation.angle), so this returns D*S.
 * A missing axis is NOT zero: it makes the sample unusable for 3D rotation.
 * https://www.w3.org/TR/orientation-event/#deviceorientation
 * https://www.w3.org/TR/screen-orientation/#concepts
 */
export function deviceOrientationToQuaternion(
  angles: DeviceOrientationAngles,
  screenAngleDeg = 0,
): Quaternion | null {
  const { alpha, beta, gamma } = angles;
  if (alpha === null || beta === null || gamma === null ||
      ![alpha, beta, gamma, screenAngleDeg].every(Number.isFinite)) return null;
  return normalizeQuaternion(multiplyQuaternions(
    multiplyQuaternions(
      multiplyQuaternions(axisRotation('z', alpha), axisRotation('x', beta)),
      axisRotation('y', gamma),
    ),
    axisRotation('z', -screenAngleDeg),
  ));
}

/** Convert a screen sample to the world delta consumed by DisplayConfig.pose.
 * reference/current are reference-from-screen quaternions from the browser.
 * R = inverse(reference)*current expresses current axes in calibrated axes.
 * B = Ry(baselineAngleDeg) maps calibrated axes to the geometry world.
 * Return B*R*inverse(B), so rotating the baseline frame gives B*R.
 * Relative orientation has no compass heading or translation information.
 * The session must invalidate calibration when screen orientation changes.
 */
export function relativeScreenOrientation(
  current: Quaternion,
  reference: Quaternion,
  baselineAngleDeg = 0,
): Quaternion | null {
  const c = normalizeQuaternion(current), r = normalizeQuaternion(reference);
  if (!c || !r || !Number.isFinite(baselineAngleDeg)) return null;
  const baseline = axisRotation('y', baselineAngleDeg);
  const relative = multiplyQuaternions(inverseQuaternion(r), c);
  return normalizeQuaternion(multiplyQuaternions(
    multiplyQuaternions(baseline, relative), inverseQuaternion(baseline),
  ));
}
