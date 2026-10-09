import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_GRIDS,LEGACY_GRIDS,parseGrids,gridPositions,drawGrid,GRID_COLORS} from '../src/grids';
import {DEFAULT_CALIBRATION,parseSettings,serializeCalibration,settingsFromHash} from '../src/state';
import {makeTexture,renderProjection,renderComparison} from '../src/render';

function canvasMock(source?:Uint8ClampedArray){
 const operations:unknown[][]=[];
 let output:ImageData|undefined;
 const ctx={fillStyle:'',strokeStyle:'',globalAlpha:1,lineWidth:1,textAlign:'',textBaseline:'',font:'',
  save(){operations.push(['save'])},restore(){operations.push(['restore'])},
  setLineDash(d:number[]){operations.push(['dash',d])},beginPath(){operations.push(['begin'])},
  moveTo(x:number,y:number){operations.push(['move',x,y])},lineTo(x:number,y:number){operations.push(['line',x,y])},
  stroke(){operations.push(['stroke',this.strokeStyle,this.globalAlpha])},
  fillRect(...args:number[]){operations.push(['fill',...args])},strokeRect(...args:number[]){operations.push(['border',...args])},
  fillText(...args:unknown[]){operations.push(['text',...args])},drawImage(...args:unknown[]){operations.push(['image',...args])},
  getImageData(){return {data:source||new Uint8ClampedArray(16)}},
  createImageData(w:number,h:number){return {data:new Uint8ClampedArray(w*h*4),width:w,height:h} as ImageData},
  putImageData(image:ImageData){output=image;operations.push(['pixels'])},
 };
 const canvas={width:2,height:2,getContext:()=>ctx} as unknown as HTMLCanvasElement;
 return {canvas,ctx:ctx as unknown as CanvasRenderingContext2D,operations,get output(){return output}};
}
test('new settings enable both grids; old JSON and URL preserve no-grid rendering',()=>{
 assert.equal(DEFAULT_GRIDS.screen,true);assert.equal(DEFAULT_GRIDS.plane,true);
 const old=serializeCalibration(DEFAULT_CALIBRATION);
 assert.deepEqual(parseSettings(old).grids,LEGACY_GRIDS);
 assert.deepEqual(settingsFromHash('#'+new URLSearchParams({calibration:old}))?.grids,LEGACY_GRIDS);
});
test('independent toggles and mm spacings round trip through settings and URL',()=>{
 for(const screen of [false,true])for(const plane of [false,true]){
  const grids={screen,plane,screenSpacingMm:12,planeSpacingMm:3};
  const text=serializeCalibration(DEFAULT_CALIBRATION,grids);
  assert.deepEqual(parseSettings(text),{calibration:DEFAULT_CALIBRATION,grids});
  assert.deepEqual(settingsFromHash('#'+new URLSearchParams({calibration:text}))?.grids,grids);
 }
 const parsed=parseGrids(undefined);parsed.screen=true;assert.equal(LEGACY_GRIDS.screen,false);
});
test('invalid grid settings are rejected even while their layers are hidden',()=>{
 for(const value of [null,{},true,{...DEFAULT_GRIDS,screen:'yes'},...[-1,0,.5,1001,Infinity,NaN,'5'].map(planeSpacingMm=>({...DEFAULT_GRIDS,plane:false,planeSpacingMm}))]){
  assert.throws(()=>parseGrids(value));
  assert.throws(()=>parseSettings(JSON.stringify({version:1,calibration:DEFAULT_CALIBRATION,grids:value})));
 }
});
test('physical grid lines use symmetric centre anchoring and explicit mm intervals',()=>{
 assert.deepEqual(gridPositions(48,5),[-20,-15,-10,-5,0,5,10,15,20]);
 assert.deepEqual(gridPositions(68,10),[-30,-20,-10,0,10,20,30]);
 assert.deepEqual(gridPositions(.1,1),[0]);
 for(const n of [0,Infinity,10001])assert.throws(()=>gridPositions(n,5));
 const c=canvasMock();drawGrid(c.ctx,680,1470,68,147,10,'screen');
 assert.ok(c.operations.some(o=>o[0]==='move'&&o[1]===340&&o[2]===0));
 assert.ok(c.operations.some(o=>o[0]==='move'&&o[1]===440&&o[2]===0));
 assert.deepEqual(c.operations.find(o=>o[0]==='stroke'),['stroke',GRID_COLORS.screen,.34]);
 assert.deepEqual(c.operations.find(o=>o[0]==='dash'),['dash',[4,4]]);
});
test('plane grid is painted into the same target texture before the HELLO and border',()=>{
 const mocked=canvasMock(),previous=globalThis.document;
 globalThis.document={createElement:()=>mocked.canvas} as unknown as Document;
 try{
  makeTexture(1.5,{widthMm:48,heightMm:32,spacingMm:5});
  const grid=mocked.operations.findIndex(o=>o[0]==='stroke');
  assert.deepEqual(mocked.operations[grid],['stroke',GRID_COLORS.plane,.42]);
  assert.ok(grid<mocked.operations.findIndex(o=>o[0]==='border'));
  assert.ok(grid<mocked.operations.findIndex(o=>o[0]==='text'&&o[1]==='HELLO'));
 }finally{globalThis.document=previous}
});
test('projection bilinearly samples all three RGB channels instead of turning grids grey',()=>{
 const texture=canvasMock(new Uint8ClampedArray([0,40,80,255,40,80,120,255,80,120,160,255,120,160,200,255]));
 const out=canvasMock(),c=structuredClone(DEFAULT_CALIBRATION);c.display.angleDeg=0;c.display.widthMm=2;c.display.heightMm=2;c.target.widthMm=2;c.target.heightMm=2;
 renderProjection(out.canvas,c,texture.canvas,1,1);
 assert.deepEqual([...out.output!.data],[60,100,140,255]);
});
test('screen overlay is identical across comparison modes, angles and target offsets',()=>{
 const c=structuredClone(DEFAULT_CALIBRATION);c.display.widthMm=68;c.display.heightMm=68;
 const overlays=[];
 for(const mode of ['original','projected'] as const)for(const angle of [0,30]){
  c.display.angleDeg=angle;c.target.center.x=angle;
  const out=canvasMock();renderComparison(out.canvas,c,canvasMock().canvas,DEFAULT_GRIDS,mode);
  const from=out.operations.findIndex(o=>o[0]==='save');
  assert.ok(from>0,'Screen grid must be drawn after image pixels');
  overlays.push(out.operations.slice(from));
 }
 for(const overlay of overlays)assert.deepEqual(overlay,overlays[0]);
 const hidden=canvasMock();renderComparison(hidden.canvas,c,canvasMock().canvas,LEGACY_GRIDS,'original');
 assert.equal(hidden.operations.some(o=>o[0]==='stroke'),false);
});
