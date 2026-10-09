/** Two independent, centre-anchored millimetre grids for the static comparison. */
export interface GridSettings {
 screen: boolean;
 plane: boolean;
 screenSpacingMm: number;
 planeSpacingMm: number;
}
export const DEFAULT_GRIDS: GridSettings = {screen:true,plane:true,screenSpacingMm:10,planeSpacingMm:5};
export const LEGACY_GRIDS: GridSettings = {...DEFAULT_GRIDS,screen:false,plane:false};
export const GRID_COLORS = {screen:'#72c8ef',plane:'#c9ef8b'} as const;
export function parseGrids(value:unknown):GridSettings {
 if(value===undefined)return {...LEGACY_GRIDS};
 if(!value||typeof value!=='object')throw new Error('Invalid grid settings.');
 const g=value as GridSettings;
 if(typeof g.screen!=='boolean'||typeof g.plane!=='boolean'||![g.screenSpacingMm,g.planeSpacingMm].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=1&&n<=1000))throw new Error('Invalid grid settings.');
 return {screen:g.screen,plane:g.plane,screenSpacingMm:g.screenSpacingMm,planeSpacingMm:g.planeSpacingMm};
}
/** Grid intersections are measured from the centre, not the top-left edge. */
export function gridPositions(extentMm:number,spacingMm:number):number[] {
 if(!Number.isFinite(extentMm)||extentMm<=0||extentMm>10000||!Number.isFinite(spacingMm)||spacingMm<1||spacingMm>1000)throw new Error('Invalid grid settings.');
 const count=Math.floor(extentMm/2/spacingMm);
 return Array.from({length:count*2+1},(_,i)=>(i-count)*spacingMm);
}
export function drawGrid(ctx:CanvasRenderingContext2D,width:number,height:number,widthMm:number,heightMm:number,spacingMm:number,kind:'screen'|'plane'):void {
 ctx.save();ctx.strokeStyle=GRID_COLORS[kind];ctx.globalAlpha=kind==='screen'?.34:.42;
 ctx.lineWidth=Math.max(1,Math.min(width/widthMm,height/heightMm)*.12);
 ctx.setLineDash(kind==='screen'?[4,4]:[]);ctx.beginPath();
 for(const x of gridPositions(widthMm,spacingMm)){const px=(.5+x/widthMm)*width;ctx.moveTo(px,0);ctx.lineTo(px,height);}
 for(const y of gridPositions(heightMm,spacingMm)){const py=(.5-y/heightMm)*height;ctx.moveTo(0,py);ctx.lineTo(width,py);}
 ctx.stroke();ctx.restore();
}
