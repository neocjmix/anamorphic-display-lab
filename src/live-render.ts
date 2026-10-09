import {geometryErrorLabel} from './localization';
import {validateCalibration,type Calibration} from './geometry';
import {paneBlendWeight,PANE_RGB,type PaneSettings} from './pane';
import {drawGrid,type GridSettings} from './grids';
/** Exact inverse plane homography; bounded 480px long edge, bilinear RGB samples.
 * No CSS perspective or affine-triangle approximation. Texture pixels cached by caller. */
export function renderLive(canvas:HTMLCanvasElement,c:Calibration,source:ImageData,grids:GridSettings,pane:PaneSettings={enabled:false,opacity:0}){
 const scale=480/Math.max(c.display.widthMm,c.display.heightMm);
 const w=Math.max(1,Math.round(c.display.widthMm*scale)),h=Math.max(1,Math.round(c.display.heightMm*scale));
 if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
 const ctx=canvas.getContext('2d')!,checked=validateCalibration(c);ctx.fillStyle='#000';
 if(!checked.ok){ctx.fillRect(0,0,w,h);return geometryErrorLabel(checked.reason);}
 const f=checked.value,e=c.eye,t=c.target;
 const dx=c.display.widthMm/w,dy=-c.display.heightMm/h;
 const ox=f.origin.x+(-c.display.widthMm/2+dx/2)*f.right.x+(c.display.heightMm/2+dy/2)*f.up.x-e.x;
 const oy=f.origin.y+(-c.display.widthMm/2+dx/2)*f.right.y+(c.display.heightMm/2+dy/2)*f.up.y-e.y;
 const oz=f.origin.z+(-c.display.widthMm/2+dx/2)*f.right.z+(c.display.heightMm/2+dy/2)*f.up.z-e.z;
 const frontMask=pane.enabled&&grids.screen?new Uint8Array(w*h):null;
 const out=ctx.createImageData(w,h),data=out.data,s=source.data,sw=source.width,sh=source.height;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;data[i+3]=255;
  const background=paneBlendWeight(null,pane);for(let k=0;k<3;k++)data[i+k]=PANE_RGB[k]*background;
  const vx=ox+x*dx*f.right.x+y*dy*f.up.x,vy=oy+x*dx*f.right.y+y*dy*f.up.y,vz=oz+x*dx*f.right.z+y*dy*f.up.z;
  if(Math.abs(vz)<=1e-7*Math.hypot(vx,vy,vz))continue;
  const ray=(t.center.z-e.z)/vz;if(ray<=0)continue;
  const u=.5+(e.x+ray*vx-t.center.x)/t.widthMm,v=.5-(e.y+ray*vy-t.center.y)/t.heightMm;
  if(u<0||u>1||v<0||v>1)continue;
  const sx=u*(sw-1),sy=v*(sh-1),x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,sw-1),y1=Math.min(y0+1,sh-1),fx=sx-x0,fy=sy-y0;
  const tint=paneBlendWeight(ray,pane);if(frontMask&&ray<=1+1e-9)frontMask[y*w+x]=1;
  for(let k=0;k<3;k++)data[i+k]=((s[(y0*sw+x0)*4+k]*(1-fx)+s[(y0*sw+x1)*4+k]*fx)*(1-fy)+(s[(y1*sw+x0)*4+k]*(1-fx)+s[(y1*sw+x1)*4+k ]*fx)*fy)*(1-tint)+PANE_RGB[k]*tint;
 }
 ctx.putImageData(out,0,0);if(grids.screen){drawGrid(ctx,w,h,c.display.widthMm,c.display.heightMm,grids.screenSpacingMm,'screen');if(frontMask){const overlay=ctx.getImageData(0,0,w,h);for(let p=0;p<frontMask.length;p++)if(frontMask[p])for(let k=0;k<4;k++)overlay.data[p*4+k]=data[p*4+k];ctx.putImageData(overlay,0,0);}}
 const side=(e.x-f.origin.x)*f.normal.x+(e.y-f.origin.y)*f.normal.y+(e.z-f.origin.z)*f.normal.z;
 return side<=0?'눈이 화면 뒤에 있습니다':'';
}
