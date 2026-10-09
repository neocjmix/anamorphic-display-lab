/** Phase 1 static geometry. Millimetres; +x right, +y up, +z toward viewer.
 * Rotation is right-handed about +Y. UV and viewport coordinates are y-down.
 * No tracking, temporal state, arbitrary corrective clamps, or hidden unit conversion.
 */
export interface Vec2 { x: number; y: number }
export interface Vec3 extends Vec2 { z: number }
export interface DisplayConfig {
  widthMm: number;
  heightMm: number;
  angleDeg: number;
  /** World-space axis pivot; pivot.y has no effect for a Y-axis rotation. */
  pivot: Vec3;
}
export interface TargetPlane { center: Vec3; widthMm: number; heightMm: number }
export interface Calibration { eye: Vec3; display: DisplayConfig; target: TargetPlane }
export interface Viewport { width: number; height: number }
export interface DisplayFrame { origin: Vec3; right: Vec3; up: Vec3; normal: Vec3 }
export type GeometryError = 'non-finite' | 'invalid-size' | 'eye-on-screen-plane' |
  'eye-on-target-plane' | 'ill-conditioned-screen' | 'parallel-ray' |
  'intersection-behind-eye' | 'point-off-target-plane' | 'degenerate-ray';
export type Result<T> = { ok: true; value: T } | { ok: false; reason: GeometryError };
export interface Projection {
  screenLocalMm: Vec2;
  screenWorld: Vec3;
  uv: Vec2;
  insideDisplay: boolean;
  insideTarget: boolean;
  /** screenWorld = eye + t * (virtualPoint - eye). */
  t: number;
}
export interface Reprojection {
  virtualWorld: Vec3;
  targetUv: Vec2;
  insideTarget: boolean;
  /** virtualWorld = eye + t * (screenWorld - eye). */
  t: number;
}
/** Dimensionless tolerances, preserving behaviour under uniform unit scaling. */
const ANGULAR_EPS = 1e-7;
const RELATIVE_EPS = 1e-10;
const fail = (reason: GeometryError): Result<never> => ({ ok: false, reason });
const pass = <T>(value: T): Result<T> => ({ ok: true, value });
const finite2 = (v: Vec2) => Number.isFinite(v.x) && Number.isFinite(v.y);
const finite3 = (v: Vec3) => finite2(v) && Number.isFinite(v.z);
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x-b.x, y:a.y-b.y, z:a.z-b.z });
const dot = (a: Vec3, b: Vec3) => a.x*b.x + a.y*b.y + a.z*b.z;
const length = (v: Vec3) => Math.hypot(v.x,v.y,v.z);
const insideUv = (v: Vec2) => v.x >= 0 && v.x <= 1 && v.y >= 0 && v.y <= 1;
const validSize = (width: number, height: number) => Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

/** Rotates the initially calibrated display around a fixed world-space Y axis. */
export function buildDisplayFrame(display: DisplayConfig): Result<DisplayFrame> {
  if (!finite3(display.pivot) || !Number.isFinite(display.angleDeg)) return fail('non-finite');
  if (!validSize(display.widthMm, display.heightMm)) return fail('invalid-size');
  const a = (display.angleDeg % 360) * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a), p = display.pivot;
  const frame: DisplayFrame = {
    origin: { x:p.x-c*p.x-s*p.z, y:0, z:p.z+s*p.x-c*p.z },
    right: { x:c,y:0,z:-s }, up:{ x:0,y:1,z:0 }, normal:{ x:s,y:0,z:c },
  };
  return finite3(frame.origin) ? pass(frame) : fail('non-finite');
}

/** Rejects configurations with no stable screen homography or target projection. */
export function validateCalibration(calibration: Calibration): Result<DisplayFrame> {
  const { eye, display, target } = calibration;
  if (!finite3(eye) || !finite3(target.center)) return fail('non-finite');
  if (!validSize(target.widthMm,target.heightMm)) return fail('invalid-size');
  const frame = buildDisplayFrame(display);
  if (!frame.ok) return frame;
  const delta = sub(eye, frame.value.origin);
  const distance = length(delta);
  const scale = Math.max(display.widthMm,display.heightMm,target.widthMm,target.heightMm,distance);
  if (!Number.isFinite(scale)) return fail('non-finite');
  const screenDistance = dot(delta,frame.value.normal);
  if (Math.abs(screenDistance) <= RELATIVE_EPS * scale) return fail('eye-on-screen-plane');
  if (Math.abs(screenDistance) / distance <= ANGULAR_EPS) return fail('ill-conditioned-screen');
  if (Math.abs(eye.z-target.center.z) <= RELATIVE_EPS * scale) return fail('eye-on-target-plane');
  return frame;
}

export function targetUvToWorld(uv: Vec2, target: TargetPlane): Vec3 {
  return { x:target.center.x+(uv.x-0.5)*target.widthMm,
    y:target.center.y+(0.5-uv.y)*target.heightMm,z:target.center.z };
}
export function worldToTargetUv(point: Vec3, target: TargetPlane): Vec2 {
  return { x:0.5+(point.x-target.center.x)/target.widthMm,
    y:0.5-(point.y-target.center.y)/target.heightMm };
}
export function displayMmToViewport(local: Vec2, display: Pick<DisplayConfig,'widthMm'|'heightMm'>, viewport: Viewport): Vec2 {
  return { x:(local.x/display.widthMm+0.5)*viewport.width,
    y:(0.5-local.y/display.heightMm)*viewport.height };
}
export function viewportToDisplayMm(pixel: Vec2, display: Pick<DisplayConfig,'widthMm'|'heightMm'>, viewport: Viewport): Vec2 {
  return { x:(pixel.x/viewport.width-0.5)*display.widthMm,
    y:(0.5-pixel.y/viewport.height)*display.heightMm };
}
export function displayLocalToWorld(local: Vec2, frame: DisplayFrame): Vec3 {
  return { x:frame.origin.x+local.x*frame.right.x+local.y*frame.up.x,
    y:frame.origin.y+local.x*frame.right.y+local.y*frame.up.y,
    z:frame.origin.z+local.x*frame.right.z+local.y*frame.up.z };
}

/** Intersects an infinite plane with a forward ray. Out-of-bounds isn't singular. */
export function intersectRayPlane(eye: Vec3, through: Vec3, planeOrigin: Vec3, normal: Vec3): Result<{ point:Vec3; t:number }> {
  if (![eye,through,planeOrigin,normal].every(finite3)) return fail('non-finite');
  const direction = sub(through,eye), rayLength = length(direction), normalLength = length(normal);
  if (rayLength === 0 || normalLength === 0) return fail('degenerate-ray');
  if (!Number.isFinite(rayLength) || !Number.isFinite(normalLength)) return fail('non-finite');
  // Normalize first to avoid product overflow and make angular conditioning explicit.
  const d = {x:direction.x/rayLength,y:direction.y/rayLength,z:direction.z/rayLength};
  const n = {x:normal.x/normalLength,y:normal.y/normalLength,z:normal.z/normalLength};
  const denominator = dot(d,n);
  if (Math.abs(denominator) <= ANGULAR_EPS) return fail('parallel-ray');
  const distance = dot(sub(planeOrigin,eye),n)/denominator;
  const t = distance/rayLength;
  if (!Number.isFinite(t)) return fail('non-finite');
  if (t <= 0) return fail('intersection-behind-eye');
  const point = {x:eye.x+distance*d.x,y:eye.y+distance*d.y,z:eye.z+distance*d.z};
  return finite3(point) ? pass({point,t}) : fail('non-finite');
}

export function projectVirtualPoint(point: Vec3, calibration: Calibration): Result<Projection> {
  const checked = validateCalibration(calibration);
  if (!checked.ok) return checked;
  if (!finite3(point)) return fail('non-finite');
  const { target, display, eye } = calibration;
  const scale = Math.max(target.widthMm,target.heightMm,Math.abs(eye.z-target.center.z));
  if (Math.abs(point.z-target.center.z) > RELATIVE_EPS*scale) return fail('point-off-target-plane');
  const frame = checked.value;
  const hit = intersectRayPlane(eye,point,frame.origin,frame.normal);
  if (!hit.ok) return hit;
  const relative = sub(hit.value.point,frame.origin);
  const local = {x:dot(relative,frame.right),y:dot(relative,frame.up)};
  const uv = displayMmToViewport(local,display,{width:1,height:1});
  if (!finite2(local) || !finite2(uv)) return fail('non-finite');
  return pass({screenLocalMm:local,screenWorld:hit.value.point,uv,insideDisplay:insideUv(uv),
    insideTarget:insideUv(worldToTargetUv(point,target)),t:hit.value.t});
}

/** Inverse texture lookup. Sample a texture ONLY if ok && value.insideTarget. */
export function unprojectDisplayPoint(localMm: Vec2, calibration: Calibration): Result<Reprojection> {
  const checked = validateCalibration(calibration);
  if (!checked.ok) return checked;
  if (!finite2(localMm)) return fail('non-finite');
  const world = displayLocalToWorld(localMm,checked.value);
  const hit = intersectRayPlane(calibration.eye,world,calibration.target.center,{x:0,y:0,z:1});
  if (!hit.ok) return hit;
  const targetUv = worldToTargetUv(hit.value.point,calibration.target);
  if (!finite2(targetUv)) return fail('non-finite');
  return pass({virtualWorld:hit.value.point,targetUv,insideTarget:insideUv(targetUv),t:hit.value.t});
}
