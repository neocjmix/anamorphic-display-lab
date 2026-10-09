import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateDeviceCalibration, estimateViewportMm, calibrationFromDevicePreset, DEVICE_CALIBRATION_PRESETS } from '../src/device-calibration';
const input = {userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',screenWidth:390,screenHeight:844,devicePixelRatio:3};
const close = (a:number,b:number) => assert.ok(Math.abs(a-b)<1e-9, `${a} differs from ${b}`);

test('screen signature gives a physical panel estimate, never an exact phone name',()=>{
  const p=estimateDeviceCalibration(input);
  assert.equal(p.identified,true); assert.equal(p.confidence,'signature-match');
  close(p.fullWidthMm,1170/460*25.4); close(p.fullHeightMm,2532/460*25.4);
  assert.match(p.label,/후보/); assert.ok(p.sources[0].startsWith('https://support.apple.com/'));
  assert.ok(p.warnings.length);
});
test('full and partial viewport map to fractions of the panel',()=>{
  const p=estimateDeviceCalibration(input);const full=estimateViewportMm(p,390,844);
  close(full.widthMm,p.fullWidthMm);close(full.heightMm,p.fullHeightMm);
  const partial=estimateViewportMm(p,195,700);
  close(partial.widthMm,p.fullWidthMm/2);close(partial.heightMm,p.fullHeightMm*700/844);
});
test('landscape input and explicit rotation map the correct panel axes',()=>{
  const p=estimateDeviceCalibration({...input,screenWidth:844,screenHeight:390});
  assert.equal(p.identified,true);
  const v=estimateViewportMm(p,844,300);close(v.widthMm,p.fullHeightMm);close(v.heightMm,p.fullWidthMm*300/390);
  const rotated=estimateViewportMm(estimateDeviceCalibration(input),844,390,'landscape');
  close(rotated.widthMm,p.fullHeightMm);close(rotated.heightMm,p.fullWidthMm);
});
test('shortened portrait viewport does not imply landscape',()=>{
  const p=estimateDeviceCalibration(input); const v=estimateViewportMm(p,390,200);
  close(v.widthMm,p.fullWidthMm); close(v.heightMm,p.fullHeightMm*200/844);
});
test('unknown, Android, desktop-mode UA, and screen mismatch keep estimated fallback',()=>{
  for(const change of [{userAgent:'Android SM-S928B'},{userAgent:'Macintosh; Intel Mac OS X'},{screenWidth:391},{devicePixelRatio:2},{userAgent:''}]){
    const p=estimateDeviceCalibration({...input,...change});assert.equal(p.identified,false);assert.equal(p.confidence,'estimated');assert.equal(p.fullWidthMm,68);assert.equal(p.fullHeightMm,147);
  }
});
test('X / mini ambiguous browser signature is never auto-identified',()=>{
  const p=estimateDeviceCalibration({...input,screenWidth:375,screenHeight:812});
  assert.equal(p.identified,false);assert.match(p.label,/중복/);
});
test('invalid screen and DPR inputs cannot match a device',()=>{
  for(const n of [0,-1,NaN,Infinity]){
    assert.equal(estimateDeviceCalibration({...input,screenWidth:n}).identified,false);
    assert.equal(estimateDeviceCalibration({...input,devicePixelRatio:n}).identified,false);
  }
});
test('invalid, oversized and tiny viewport results remain finite and bounded',()=>{
  const p=estimateDeviceCalibration(input);
  for(const [w,h] of [[0,0],[NaN,Infinity],[-1,100],[1e9,1e9],[1e-200,1e-200]]){
    const v=estimateViewportMm(p,w,h);assert.ok(Number.isFinite(v.widthMm)&&Number.isFinite(v.heightMm));
    assert.ok(v.widthMm>=.1&&v.widthMm<=p.fullWidthMm);assert.ok(v.heightMm>=.1&&v.heightMm<=p.fullHeightMm);
  }
});
test('zoom generates an actionable warning without silently changing coordinate conventions',()=>{
  const p=estimateDeviceCalibration(input);const ordinary=estimateViewportMm(p,390,700);
  const zoomed=estimateViewportMm(p,390,700,'portrait',2);
  close(zoomed.widthMm,ordinary.widthMm);assert.ok(zoomed.warnings.some(w=>w.includes('100%')));
});
test('manual verified preset can resolve mini ambiguity with actual CSS screen bounds',()=>{
  const p=calibrationFromDevicePreset('1080x2340',{...input,screenWidth:375,screenHeight:812});
  assert.ok(p);assert.equal(p.confidence,'manual-spec');close(p.fullWidthMm,1080/476*25.4);
  close(estimateViewportMm(p,375,812).widthMm,p.fullWidthMm);
  assert.equal(calibrationFromDevicePreset('invented',input),null);
  assert.equal(new Set(DEVICE_CALIBRATION_PRESETS.map(p=>p.id)).size,DEVICE_CALIBRATION_PRESETS.length);
});
