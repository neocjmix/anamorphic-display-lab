import {drawGrid} from './grids';
import {makeTexture} from './render';

export type TargetPattern = 'hello' | 'rings' | 'checkerboard';
type Pattern = Exclude<TargetPattern, 'hello'>;
type Extent = {widthMm:number;heightMm:number};

/** Coarse, static bands/cells. Invalid or overly fine input uses the 6 mm default. */
const spacing = (cellMm:number) => Number.isFinite(cellMm) && cellMm >= 2 ? cellMm : 6;

/** An opaque monochrome sample in centre-relative target millimetres, not canvas UVs. */
export function sampleOpArt(pattern:Pattern,xMm:number,yMm:number,cellMm=6):0|255 {
 const cell=spacing(cellMm);
 const band=pattern==='rings' ? Math.floor(Math.hypot(xMm,yMm)/cell) : Math.floor(xMm/cell)+Math.floor(yMm/cell);
 return band%2===0 ? 255 : 0;
}

/**
 * Make a deterministic target texture; there is deliberately no clock or animation.
 * Ring widths and square sides are measured on the target plane in millimetres.
 * Independent mm-per-pixel axes keep rings circular after mapping onto that plane,
 * including when the requested raster ratio differs from its physical aspect ratio.
 */
export function makeLiveTexture(ratio:number,pattern:TargetPattern,cellMm:number,target:Extent,plane?:Extent&{spacingMm:number}):HTMLCanvasElement {
 if(pattern==='hello')return makeTexture(ratio,plane);
 if(pattern!=='rings'&&pattern!=='checkerboard')throw new Error('Invalid target pattern.');
 if(!Number.isFinite(ratio)||ratio<=0||![target.widthMm,target.heightMm].every(n=>Number.isFinite(n)&&n>0))throw new Error('Invalid target texture dimensions.');
 const canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(1200*Math.min(1,ratio)));
 canvas.height=Math.max(1,Math.round(1200*Math.min(1,1/ratio)));
 const w=canvas.width,h=canvas.height,ctx=canvas.getContext('2d');
 if(!ctx)throw new Error('A 2D canvas is required for target textures.');
 const pixels=ctx.createImageData(w,h),cell=spacing(cellMm);
 // Bounded raster work also avoids an unbounded number of paths for large planes.
 for(let y=0;y<h;y++){
  const yMm=((y+.5)/h-.5)*target.heightMm;
  for(let x=0;x<w;x++){
   const xMm=((x+.5)/w-.5)*target.widthMm;
   const value=sampleOpArt(pattern,xMm,yMm,cell),i=(y*w+x)*4;
   pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;
   pixels.data[i+3]=255;
  }
 }
 ctx.putImageData(pixels,0,0);
 if(plane)drawGrid(ctx,w,h,plane.widthMm,plane.heightMm,plane.spacingMm,'plane');
 ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(.01,Math.min(w,h)*.0075);
 const inset=ctx.lineWidth*2.5;
 ctx.strokeRect(inset,inset,w-inset*2,h-inset*2);
 return canvas;
}
