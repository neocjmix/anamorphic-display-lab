import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDisplayFrame, displayLocalToWorld, displayMmToViewport, intersectRayPlane,
  projectVirtualPoint, targetUvToWorld, unprojectDisplayPoint, validateCalibration,
  viewportToDisplayMm, worldToTargetUv, type Calibration, type Result, type Vec3 } from '../src/geometry.ts';
const base = ():Calibration => ({ eye:{x:0,y:0,z:350}, display:{widthMm:68,heightMm:147,angleDeg:30,pivot:{x:0,y:0,z:0}},target:{center:{x:0,y:0,z:0},widthMm:40,heightMm:90} });
function value<T>(result:Result<T>):T { if (!result.ok) assert.fail(`Expected valid geometry: ${result.reason}`); return result.value; }
function near(a:number,b:number,tolerance=1e-9) { assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`); }
function near3(a:Vec3,b:Vec3,tolerance=1e-9) { near(a.x,b.x,tolerance); near(a.y,b.y,tolerance); near(a.z,b.z,tolerance); }

test('identity at zero angle for any eye offset and target point',()=>{
  const c=base(); c.display.angleDeg=0;c.eye={x:80,y:-32,z:350};
  for(const p of [{x:0,y:0,z:0},{x:20,y:-35,z:0},{x:-20,y:35,z:0}]) {
    const result=value(projectVirtualPoint(p,c));near3(result.screenWorld,p);near(result.screenLocalMm.x,p.x);near(result.screenLocalMm.y,p.y);near(result.t,1);
    near3(value(unprojectDisplayPoint(result.screenLocalMm,c)).virtualWorld,p);
  }
});
test('known positive 30 degree right-handed Y rotation and analytical projection',()=>{
  const c=base(), frame=value(buildDisplayFrame(c.display));
  near3(displayLocalToWorld({x:20,y:7},frame),{x:10*Math.sqrt(3),y:7,z:-10});
  const p={x:15,y:20,z:0};
  // z = -x tan(theta), t = d/(d - x tan(theta)).
  const t=350/(350-15*Math.tan(Math.PI/6));
  const projected=value(projectVirtualPoint(p,c));
  near(projected.t,t);near(projected.screenLocalMm.x,t*15/Math.cos(Math.PI/6));near(projected.screenLocalMm.y,t*20);
});
test('rotation about displaced pivot holds every point on pivot axis fixed',()=>{
  const c=base();c.display.pivot={x:34,y:57,z:0};c.display.angleDeg=74;
  const f=value(buildDisplayFrame(c.display));near3(displayLocalToWorld({x:34,y:-24},f),{x:34,y:-24,z:0});
  const c2=base();c2.display.angleDeg=90;c2.display.pivot={x:10,y:999,z:20};
  near3(value(buildDisplayFrame(c2.display)).origin,{x:-10,y:0,z:30});
});
test('pixel and texture mappings preserve y-up world vs y-down viewport',()=>{
  const c=base();const viewport={width:680,height:1470};
  assert.deepEqual(displayMmToViewport({x:-34,y:73.5},c.display,viewport),{x:0,y:0});
  assert.deepEqual(displayMmToViewport({x:34,y:-73.5},c.display,viewport),{x:680,y:1470});
  const p={x:12.25,y:-32.5};const round=viewportToDisplayMm(displayMmToViewport(p,c.display,viewport),c.display,viewport);near(round.x,p.x);near(round.y,p.y);
  c.target.center={x:7,y:12,z:45};
  near3(targetUvToWorld({x:0,y:0},c.target),{x:-13,y:57,z:45});
  const uv=worldToTargetUv(targetUvToWorld({x:.13,y:.78},c.target),c.target);near(uv.x,.13);near(uv.y,.78);
});
test('bounded texture support is explicit and never repeats or clamps',()=>{
  const c=base();c.display.angleDeg=0;
  const inside=value(unprojectDisplayPoint({x:0,y:0},c));assert.equal(inside.insideTarget,true);
  const outside=value(unprojectDisplayPoint({x:30,y:0},c));assert.equal(outside.insideTarget,false);assert.ok(outside.targetUv.x>1);
  const projected=value(projectVirtualPoint({x:100,y:0,z:0},c));assert.equal(projected.insideDisplay,false);assert.equal(projected.insideTarget,false);
});
test('deterministic random projection/reprojection round trips include offset eyes, pivots and virtual depth',()=>{
  let state=8241; const random=()=>{state=(1664525*state+1013904223)>>>0;return state/2**32;};
  for(let i=0;i<500;i++) {
    const c=base();c.display.angleDeg=(random()-.5)*130;c.display.pivot={x:(random()-.5)*60,y:0,z:(random()-.5)*25};
    c.eye={x:(random()-.5)*120,y:(random()-.5)*100,z:250+random()*400};
    c.target.center={x:(random()-.5)*20,y:(random()-.5)*20,z:(random()-.5)*60};
    const p=targetUvToWorld({x:random(),y:random()},c.target);
    const screen=value(projectVirtualPoint(p,c));const round=value(unprojectDisplayPoint(screen.screenLocalMm,c));near3(round.virtualWorld,p,1e-8);
    near(screen.t*round.t,1,1e-9);
  }
});
test('rejects edge-on, near-edge-on and eye-on-target configurations',()=>{
  const c=base();c.display.angleDeg=90;assert.deepEqual(validateCalibration(c),{ok:false,reason:'eye-on-screen-plane'});
  c.display.angleDeg=89.999999;assert.deepEqual(validateCalibration(c),{ok:false,reason:'ill-conditioned-screen'});
  c.display.angleDeg=30;c.target.center.z=350;assert.deepEqual(validateCalibration(c),{ok:false,reason:'eye-on-target-plane'});
  c.target.center.z=0;c.eye={x:0,y:0,z:0};assert.deepEqual(validateCalibration(c),{ok:false,reason:'eye-on-screen-plane'});
});
test('parallel, behind-eye, zero-length and nonfinite rays are rejected',()=>{
  const origin={x:0,y:0,z:0},eye={x:0,y:0,z:350},normal={x:0,y:0,z:1};
  assert.deepEqual(intersectRayPlane(eye,{x:10,y:0,z:350},origin,normal),{ok:false,reason:'parallel-ray'});
  assert.deepEqual(intersectRayPlane(eye,{x:0,y:0,z:700},origin,normal),{ok:false,reason:'intersection-behind-eye'});
  assert.deepEqual(intersectRayPlane(eye,eye,origin,normal),{ok:false,reason:'degenerate-ray'});
  assert.deepEqual(intersectRayPlane(eye,{x:Infinity,y:0,z:0},origin,normal),{ok:false,reason:'non-finite'});
  assert.deepEqual(intersectRayPlane(origin,eye,origin,normal),{ok:false,reason:'intersection-behind-eye'});
});
test('invalid dimensions and off-target-plane inputs fail explicitly',()=>{
  const c=base();c.display.widthMm=0;assert.deepEqual(validateCalibration(c),{ok:false,reason:'invalid-size'});
  c.display.widthMm=68;c.target.heightMm=-1;assert.deepEqual(validateCalibration(c),{ok:false,reason:'invalid-size'});
  c.target.heightMm=90;assert.deepEqual(projectVirtualPoint({x:0,y:0,z:2},c),{ok:false,reason:'point-off-target-plane'});
  c.eye.x=NaN;assert.deepEqual(validateCalibration(c),{ok:false,reason:'non-finite'});
});
test('geometry and UV are invariant under uniform millimetre scaling',()=>{
  const original=base();original.eye.x=34;original.display.pivot={x:8,y:0,z:5};
  const p={x:12,y:23,z:0},expected=value(projectVirtualPoint(p,original));
  for(const scale of [1e-8,1e-4,1,1e4,1e8]) {
    const mul=(v:Vec3):Vec3=>({x:v.x*scale,y:v.y*scale,z:v.z*scale});
    const c:Calibration={eye:mul(original.eye),display:{...original.display,pivot:mul(original.display.pivot),widthMm:68*scale,heightMm:147*scale},target:{center:mul(original.target.center),widthMm:40*scale,heightMm:90*scale}};
    const result=value(projectVirtualPoint(mul(p),c));near(result.t,expected.t);near(result.uv.x,expected.uv.x);near(result.uv.y,expected.uv.y);
  }
});
test('forward and inverse mapping propagate singular and behind-eye errors',()=>{
  const c=base();
  // The eye-to-target ray is parallel to a 30° screen at this virtual x.
  const parallel={x:350/Math.tan(Math.PI/6),y:0,z:0};
  assert.deepEqual(projectVirtualPoint(parallel,c),{ok:false,reason:'parallel-ray'});
  assert.deepEqual(projectVirtualPoint({x:1000,y:0,z:0},c),{ok:false,reason:'intersection-behind-eye'});
  // Physical local x=-700 places the display point at the eye's z.
  assert.deepEqual(unprojectDisplayPoint({x:-700,y:0},c),{ok:false,reason:'parallel-ray'});
  c.target.center.z=400;
  assert.deepEqual(projectVirtualPoint({x:0,y:0,z:400},c),{ok:false,reason:'intersection-behind-eye'});
  assert.deepEqual(unprojectDisplayPoint({x:0,y:0},c),{ok:false,reason:'intersection-behind-eye'});
});
