import {validateCalibration,displayLocalToWorld,intersectRayPlane,worldToTargetUv,projectVirtualPoint,targetUvToWorld, type Calibration, type Vec3} from './geometry';
import {drawGrid,LEGACY_GRIDS,type GridSettings} from './grids';
export function makeTexture(ratio=1.5,plane?:{widthMm:number;heightMm:number;spacingMm:number}):HTMLCanvasElement {
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(1200*Math.min(1,ratio)));canvas.height=Math.max(1,Math.round(1200*Math.min(1,1/ratio)));
 const w=canvas.width,h=canvas.height,ctx=canvas.getContext('2d')!;ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);if(plane)drawGrid(ctx,w,h,plane.widthMm,plane.heightMm,plane.spacingMm,'plane');ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(.01,Math.min(w,h)*.0075);const inset=ctx.lineWidth*2.5;ctx.strokeRect(inset,inset,w-inset*2,h-inset*2);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`900 ${Math.min(w*.225,h*.6)}px Arial, Helvetica, sans-serif`;ctx.fillText('HELLO',w/2,h*.517,w*.9);return canvas;
}
export function renderProjection(canvas:HTMLCanvasElement,c:Calibration,texture:HTMLCanvasElement,width=Math.round(680*Math.max(1,Math.min(2,globalThis.devicePixelRatio||1))),height=Math.max(1,Math.round(width*c.display.heightMm/c.display.widthMm))):void {
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('이미지 해상도 값이 올바르지 않습니다');
 const scale=Math.min(1,1800/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
 const checked=validateCalibration(c);if(!checked.ok)throw new Error(checked.reason);
 const ctx=canvas.getContext('2d')!;const source=texture.getContext('2d')!.getImageData(0,0,texture.width,texture.height);const out=ctx.createImageData(canvas.width,canvas.height);
 for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
  const i=(y*canvas.width+x)*4;out.data[i+3]=255;
  const point=displayLocalToWorld({x:((x+.5)/canvas.width-.5)*c.display.widthMm,y:(.5-(y+.5)/canvas.height)*c.display.heightMm},checked.value);
  const hit=intersectRayPlane(c.eye,point,c.target.center,{x:0,y:0,z:1});
  if(!hit.ok)continue;
  const uv=worldToTargetUv(hit.value.point,c.target);if(uv.x<0||uv.x>1||uv.y<0||uv.y>1)continue;const sx=Math.max(0,Math.min(texture.width-1,uv.x*(texture.width-1)));const sy=Math.max(0,Math.min(texture.height-1,uv.y*(texture.height-1)));
  const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,texture.width-1),y1=Math.min(y0+1,texture.height-1);const fx=sx-x0,fy=sy-y0;
  for(let channel=0;channel<3;channel++){
  const pixel=(xx:number,yy:number)=>source.data[(yy*texture.width+xx)*4+channel];
  const v=(pixel(x0,y0)*(1-fx)+pixel(x1,y0)*fx)*(1-fy)+(pixel(x0,y1)*(1-fx)+pixel(x1,y1)*fx)*fy;
  out.data[i+channel]=v;}
 }ctx.putImageData(out,0,0);
}
/** Rasterize both comparison modes at the same display extent, then overlay the screen grid. */
export function renderComparison(canvas:HTMLCanvasElement,c:Calibration,texture:HTMLCanvasElement,grids:GridSettings=LEGACY_GRIDS,mode:'projected'|'original'='projected'):void {
 if(mode==='projected')renderProjection(canvas,c,texture);
 else {
  const width=Math.round(680*Math.max(1,Math.min(2,globalThis.devicePixelRatio||1))),height=Math.max(1,Math.round(width*c.display.heightMm/c.display.widthMm));
  const scale=Math.min(1,1800/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(texture,(.5+(c.target.center.x-c.target.widthMm/2)/c.display.widthMm)*canvas.width,(.5-(c.target.center.y+c.target.heightMm/2)/c.display.heightMm)*canvas.height,c.target.widthMm/c.display.widthMm*canvas.width,c.target.heightMm/c.display.heightMm*canvas.height);
 }
 if(grids.screen)drawGrid(canvas.getContext('2d')!,canvas.width,canvas.height,c.display.widthMm,c.display.heightMm,grids.screenSpacingMm,'screen');
}
export function drawDebug(canvas:HTMLCanvasElement,c:Calibration):void {
 canvas.width=1000;canvas.height=520;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#111718';ctx.fillRect(0,0,1000,520);
 const checked=validateCalibration(c);if(!checked.ok)return;const p=c.display.pivot;
 const screen=(x:number,y:number):Vec3=>displayLocalToWorld({x,y},checked.value);
 const corners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];const targets=corners.map(uv=>targetUvToWorld(uv,c.target));
 const display=[screen(-c.display.widthMm/2,c.display.heightMm/2),screen(c.display.widthMm/2,c.display.heightMm/2),screen(c.display.widthMm/2,-c.display.heightMm/2),screen(-c.display.widthMm/2,-c.display.heightMm/2)];
 const raw=(v:Vec3)=>({x:v.x*.9+v.z*.65,y:-v.y+v.z*.3});const points=[...targets,...display,c.eye,p,{x:0,y:0,z:0}].map(raw);
 const minx=Math.min(...points.map(v=>v.x))-35,maxx=Math.max(...points.map(v=>v.x))+35,miny=Math.min(...points.map(v=>v.y))-35,maxy=Math.max(...points.map(v=>v.y))+35;const scale=Math.min(820/(maxx-minx),380/(maxy-miny));
 const map=(v:Vec3)=>{const q=raw(v);return {x:90+(q.x-minx)*scale,y:65+(q.y-miny)*scale};};
 const line=(a:Vec3,b:Vec3,color:string)=>{const aa=map(a),bb=map(b);ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(aa.x,aa.y);ctx.lineTo(bb.x,bb.y);ctx.stroke();};
 targets.forEach(t=>line(c.eye,t,'#a4b78970'));
 const poly=(ps:Vec3[],color:string)=>{ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ps.forEach((v,i)=>{const q=map(v);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.closePath();ctx.stroke();};
 poly(targets,'#c9ef8b');poly(display,'#72c8ef');
 const label=(v:Vec3,s:string,color:string)=>{const q=map(v);ctx.fillStyle=color;ctx.beginPath();ctx.arc(q.x,q.y,4,0,Math.PI*2);ctx.fill();ctx.font='18px system-ui';ctx.fillText(s,q.x+10,q.y-10);};
 label(c.eye,'E · 고정된 눈','#fff');label(targets[0],'V · 가상 평면','#c9ef8b');label(display[2],'S · 실제 화면','#72c8ef');label(p,'P · 회전 중심','#f6bf83');
 targets.forEach(t=>{const hit=projectVirtualPoint(t,c);if(hit.ok)label(hit.value.screenWorld,'','#fff');});
 const origin={x:0,y:0,z:0};line(origin,{x:30,y:0,z:0},'#ec8b8b');line(origin,{x:0,y:30,z:0},'#a8d885');line(origin,{x:0,y:0,z:30},'#91b4e5');label({x:30,y:0,z:0},'+X','#ec8b8b');label({x:0,y:30,z:0},'+Y','#a8d885');label({x:0,y:0,z:30},'+Z','#91b4e5');ctx.font='15px system-ui';ctx.fillStyle='#a4aeae';ctx.fillText('직교 투영 도식 · 눈에 보이는 실제 장면과는 다릅니다',30,490);
}
