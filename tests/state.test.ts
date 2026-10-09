import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CALIBRATION,serializeCalibration,parseCalibration,calibrationFromHash} from '../src/state';
test('calibration JSON round trips independently',()=>{const c=parseCalibration(serializeCalibration(DEFAULT_CALIBRATION));assert.deepEqual(c,DEFAULT_CALIBRATION);c.eye.z=1;assert.equal(DEFAULT_CALIBRATION.eye.z,350);});
test('URL fragment round trips and empty hash is empty',()=>{const p=new URLSearchParams({calibration:serializeCalibration(DEFAULT_CALIBRATION)});assert.deepEqual(calibrationFromHash('#'+p),DEFAULT_CALIBRATION);assert.equal(calibrationFromHash(''),null);});
test('malformed, unsupported and invalid dimensions rejected',()=>{assert.throws(()=>parseCalibration('{}'));assert.throws(()=>parseCalibration('{'));assert.throws(()=>parseCalibration(JSON.stringify({version:2,calibration:DEFAULT_CALIBRATION})));const c=structuredClone(DEFAULT_CALIBRATION);c.display.widthMm=0;assert.throws(()=>parseCalibration(serializeCalibration(c)));});

test('UI calibration bounds reject extreme small dimensions and coordinates',()=>{for(const widthMm of [1e-308,10001]){const c=structuredClone(DEFAULT_CALIBRATION);c.display.widthMm=widthMm;assert.throws(()=>parseCalibration(serializeCalibration(c)));}const c=structuredClone(DEFAULT_CALIBRATION);c.eye.x=1e308;assert.throws(()=>parseCalibration(serializeCalibration(c)));});

test('inclusive practical limits and malformed numeric values',()=>{for(const widthMm of [.1,10000]){const c=structuredClone(DEFAULT_CALIBRATION);c.display.widthMm=widthMm;assert.equal(parseCalibration(serializeCalibration(c)).display.widthMm,widthMm);}for(const angleDeg of [-3600,3600]){const c=structuredClone(DEFAULT_CALIBRATION);c.display.angleDeg=angleDeg;assert.equal(parseCalibration(serializeCalibration(c)).display.angleDeg,angleDeg);}for(const x of [-1000000,1000000]){const c=structuredClone(DEFAULT_CALIBRATION);c.eye.x=x;assert.equal(parseCalibration(serializeCalibration(c)).eye.x,x);}for(const angleDeg of [-3601,3601,NaN,Infinity]){const c=structuredClone(DEFAULT_CALIBRATION);c.display.angleDeg=angleDeg;assert.throws(()=>parseCalibration(serializeCalibration(c)));}const bad=JSON.parse(serializeCalibration(DEFAULT_CALIBRATION));bad.calibration.eye.x='350';assert.throws(()=>parseCalibration(JSON.stringify(bad)));});


test('optional rigid pose round-trips exactly through JSON and URL; legacy remains optional',()=>{
 const c=structuredClone(DEFAULT_CALIBRATION);
 c.display.pose={orientation:{x:.2,y:-.3,z:.4,w:.8},translationMm:{x:12,y:-21,z:33}};
 const parsed=parseCalibration(serializeCalibration(c));assert.deepEqual(parsed,c);
 const p=new URLSearchParams({calibration:serializeCalibration(c)});assert.deepEqual(calibrationFromHash('#'+p),c);
 parsed.display.pose!.translationMm.x=99;assert.equal(c.display.pose.translationMm.x,12);
 assert.equal(Object.hasOwn(parseCalibration(serializeCalibration(DEFAULT_CALIBRATION)).display,'pose'),false);
});

test('import rejects zero, missing, non-finite and malformed pose quaternions',()=>{
 const valid={orientation:{x:0,y:0,z:0,w:1},translationMm:{x:0,y:0,z:0}};
 const invalid=[null,{}, {translationMm:valid.translationMm},
  {...valid,orientation:null}, {...valid,orientation:{x:0,y:0,z:0,w:0}},
  {...valid,orientation:{x:0,y:0,z:0}}, {...valid,orientation:{x:0,y:0,z:0,w:'1'}},
  {...valid,orientation:{x:NaN,y:0,z:0,w:1}}, {...valid,orientation:{x:0,y:0,z:0,w:Infinity}}];
 for(const pose of invalid){
  const data=JSON.parse(serializeCalibration(DEFAULT_CALIBRATION));data.calibration.display.pose=pose;
  assert.throws(()=>parseCalibration(JSON.stringify(data)),/Pose must contain/);
 }
});

test('pose import keeps inclusive translation limits and rejects invalid or excessive displacement',()=>{
 for(const x of [-1000000,1000000]){
  const c=structuredClone(DEFAULT_CALIBRATION);c.display.pose={orientation:{x:0,y:0,z:0,w:1},translationMm:{x,y:0,z:0}};
  assert.deepEqual(parseCalibration(serializeCalibration(c)),c);
 }
 for(const translationMm of [null,{}, {x:0,y:0}, {x:'1',y:0,z:0}, {x:1000001,y:0,z:0}, {x:0,y:-1000001,z:0}, {x:0,y:0,z:Infinity}]){
  const data=JSON.parse(serializeCalibration(DEFAULT_CALIBRATION));data.calibration.display.pose={orientation:{x:0,y:0,z:0,w:1},translationMm};
  assert.throws(()=>parseCalibration(JSON.stringify(data)),/Pose must contain/);
 }
});
