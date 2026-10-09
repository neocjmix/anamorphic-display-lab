/** Physical-screen cue only: no geometry changes. t is target ray distance / screen ray distance. */
export interface PaneSettings {enabled:boolean;opacity:number}
export const DEFAULT_PANE:PaneSettings={enabled:true,opacity:.4};
export const PANE_RGB=[35,130,235] as const;
export function paneBlendWeight(targetRayT:number|null,pane:PaneSettings):number {
 if(!pane.enabled)return 0;
 // t<1 is in front of the display; the opaque target occludes the pane.
 if(targetRayT!==null&&Number.isFinite(targetRayT)&&targetRayT>0&&targetRayT<=1+1e-9)return 0;
 return Math.max(0,Math.min(1,Number.isFinite(pane.opacity)?pane.opacity:0));
}
export function compositePane(rgb:readonly number[],targetRayT:number|null,pane:PaneSettings):number[]{const a=paneBlendWeight(targetRayT,pane);return rgb.map((v,k)=>v*(1-a)+PANE_RGB[k]*a);}
