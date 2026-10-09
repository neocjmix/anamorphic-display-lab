import test from 'node:test';
import assert from 'node:assert/strict';
import {makeLiveTexture,sampleOpArt} from '../src/op-art';
import {makeTexture} from '../src/render';
import {GRID_COLORS} from '../src/grids';

function canvasMock(){
 const operations:unknown[][]=[];
 let pixels:ImageData|undefined;
 const ctx={fillStyle:'',strokeStyle:'',globalAlpha:1,lineWidth:1,textAlign:'',textBaseline:'',font:'',
  createImageData(width:number,height:number){return {width,height,data:new Uint8ClampedArray(width*height*4)} as ImageData;},
  putImageData(image:ImageData){pixels=image;operations.push(['pixels']);},
  fillRect(...args:number[]){operations.push(['fill',this.fillStyle,...args]);},
  strokeRect(...args:number[]){operations.push(['border',this.strokeStyle,this.lineWidth,...args]);},
  fillText(...args:unknown[]){operations.push(['text',...args]);},
  save(){operations.push(['save']);},restore(){operations.push(['restore']);},
  setLineDash(d:number[]){operations.push(['dash',d]);},beginPath(){operations.push(['begin']);},
  moveTo(...args:number[]){operations.push(['move',...args]);},lineTo(...args:number[]){operations.push(['line',...args]);},
  stroke(){operations.push(['stroke',this.strokeStyle,this.globalAlpha]);},
 };
 const canvas={width:0,height:0,getContext:()=>ctx} as unknown as HTMLCanvasElement;
 return {canvas,operations,get pixels(){return pixels!;}};
}

function withCanvas<T>(run:(canvas:ReturnType<typeof canvasMock>)=>T):T{
 const mocked=canvasMock(),previous=globalThis.document;
 globalThis.document={createElement:()=>mocked.canvas} as unknown as Document;
 try{return run(mocked);}finally{globalThis.document=previous;}
}

test('HELLO retains the legacy texture including its grid and border',()=>{
 const plane={widthMm:48,heightMm:32,spacingMm:5};
 const legacy=withCanvas(mocked=>{makeTexture(1.5,plane);return {operations:mocked.operations,width:mocked.canvas.width,height:mocked.canvas.height};});
 const live=withCanvas(mocked=>{makeLiveTexture(1.5,'hello',6,plane,plane);return {operations:mocked.operations,width:mocked.canvas.width,height:mocked.canvas.height};});
 assert.deepEqual(live,legacy);
});

test('concentric ring widths are isotropic and expressed in physical millimetres',()=>{
 assert.equal(sampleOpArt('rings',0,0,6),255);
 assert.equal(sampleOpArt('rings',5.9,0,6),255);
 assert.equal(sampleOpArt('rings',6.1,0,6),0);
 assert.equal(sampleOpArt('rings',12.1,0,6),255);
 for(const radius of [1,5,7,11,13,19]){
  const value=sampleOpArt('rings',radius,0,6);
  assert.equal(sampleOpArt('rings',0,-radius,6),value);
  assert.equal(sampleOpArt('rings',radius*.6,radius*.8,6),value);
 }
});

test('checkerboard has equal physical square sides and alternates on both axes',()=>{
 assert.equal(sampleOpArt('checkerboard',1,1,6),255);
 assert.equal(sampleOpArt('checkerboard',7,1,6),0);
 assert.equal(sampleOpArt('checkerboard',1,7,6),0);
 assert.equal(sampleOpArt('checkerboard',7,7,6),255);
 assert.equal(sampleOpArt('checkerboard',-1,1,6),0);
 assert.equal(sampleOpArt('checkerboard',-1,-1,6),255);
 assert.equal(sampleOpArt('checkerboard',1,13,6),255);
});

test('invalid or excessively fine cell widths use the coarse 6 mm fallback',()=>{
 for(const invalid of [0,-1,.1,1.99,NaN,Infinity])for(const pattern of ['rings','checkerboard'] as const){
  assert.equal(sampleOpArt(pattern,7,1,invalid),sampleOpArt(pattern,7,1,6));
 }
 assert.notEqual(sampleOpArt('rings',4,0,3),sampleOpArt('rings',4,0,6));
});

test('raster uses target dimensions instead of stretching patterns with canvas ratio',()=>{
 for(const pattern of ['rings','checkerboard'] as const)withCanvas(mocked=>{
  const target={widthMm:48,heightMm:24};
  makeLiveTexture(1,pattern,6,target);
  assert.equal(mocked.canvas.width,1200);assert.equal(mocked.canvas.height,1200);
  // On this intentionally square raster, equal mm coordinates have unequal UV distances.
  const px=(x:number,y:number)=>mocked.pixels.data[(y*1200+x)*4];
  assert.equal(px(775,600),sampleOpArt(pattern,7.02,.01,6));
  assert.equal(px(600,950),sampleOpArt(pattern,.02,7.01,6));
  for(let i=0;i<mocked.pixels.data.length;i+=4){
   const p=mocked.pixels.data;
   assert.ok(p[i]===0||p[i]===255);assert.equal(p[i+1],p[i]);assert.equal(p[i+2],p[i]);assert.equal(p[i+3],255);
  }
 });
});

test('grid overlays the OP ART texture and the white border remains last',()=>withCanvas(mocked=>{
 const target={widthMm:48,heightMm:32};
 makeLiveTexture(1.5,'checkerboard',6,target,{...target,spacingMm:5});
 assert.equal(mocked.operations[0][0],'pixels');
 assert.deepEqual(mocked.operations.find(o=>o[0]==='stroke'),['stroke',GRID_COLORS.plane,.42]);
 const border=mocked.operations.at(-1)!;
 assert.equal(border[0],'border');assert.equal(border[1],'#fff');
 assert.equal(mocked.operations.some(o=>o[0]==='text'),false);
}));

test('static textures are deterministic and reject invalid physical extents',()=>{
 const target={widthMm:48,heightMm:32};
 const a=withCanvas(mocked=>{makeLiveTexture(4,'rings',6,target);return mocked.pixels.data;});
 const b=withCanvas(mocked=>{makeLiveTexture(4,'rings',6,target);return mocked.pixels.data;});
 assert.deepEqual(a,b);
 withCanvas(()=>{
  for(const ratio of [0,-1,NaN,Infinity])assert.throws(()=>makeLiveTexture(ratio,'rings',6,target));
  for(const widthMm of [0,-1,NaN,Infinity])assert.throws(()=>makeLiveTexture(1,'checkerboard',6,{...target,widthMm}));
 });
});
