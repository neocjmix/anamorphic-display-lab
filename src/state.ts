import type { Calibration } from './geometry';
import {normalizeQuaternion} from './pose';
import {parseGrids,type GridSettings} from './grids';
export const DEFAULT_CALIBRATION: Calibration = {eye:{x:0,y:0,z:350},display:{widthMm:68,heightMm:147,angleDeg:30,pivot:{x:0,y:0,z:0}},target:{center:{x:0,y:0,z:0},widthMm:48,heightMm:32}};
export interface SavedCalibration {version:1; calibration:Calibration;grids?:GridSettings}
export function serializeCalibration(calibration:Calibration,grids?:GridSettings):string {return JSON.stringify({version:1,calibration,...(grids?{grids}:{})});}
export function parseCalibration(text:string):Calibration {
 const v=JSON.parse(text) as SavedCalibration;
 if(v.version!==1||!v.calibration) throw new Error('Expected a version 1 calibration file.');
 const c=v.calibration;
 const vec=(p:unknown):boolean=>!!p&&typeof p==='object'&&['x','y','z'].every(k=>typeof (p as Record<string,unknown>)[k]==='number'&&Number.isFinite((p as Record<string,number>)[k])&&Math.abs((p as Record<string,number>)[k])<=1000000);
 if(!c.display||!c.target||!vec(c.eye)||!vec(c.display.pivot)||!vec(c.target.center)||![c.display.widthMm,c.display.heightMm,c.display.angleDeg,c.target.widthMm,c.target.heightMm].every(n=>typeof n==='number'&&Number.isFinite(n))) throw new Error('Calibration must contain finite numeric dimensions and coordinates.');
 if([c.display.widthMm,c.display.heightMm,c.target.widthMm,c.target.heightMm].some(n=>n<0.1||n>10000)) throw new Error('Dimensions must be between 0.1 and 10,000 mm.');
 if(Math.abs(c.display.angleDeg)>3600)throw new Error('Rotation must be between -3600 and 3600 degrees.');
 if(c.display.pose!==undefined){
  const pose=c.display.pose;
  if(!pose||!vec(pose.translationMm)||!normalizeQuaternion(pose.orientation))throw new Error('Pose must contain a finite nonzero quaternion and bounded translation.');
 }
 parseGrids(v.grids);
 return structuredClone(c);
}
export function calibrationFromHash(hash:string):Calibration|null {const p=new URLSearchParams(hash.replace(/^#/,''));const s=p.get('calibration');return s?parseCalibration(s):null;}
export function parseSettings(text:string):{calibration:Calibration;grids:GridSettings} {return {calibration:parseCalibration(text),grids:parseGrids(JSON.parse(text).grids)};}
export function settingsFromHash(hash:string):ReturnType<typeof parseSettings>|null {const p=new URLSearchParams(hash.replace(/^#/,''));const s=p.get('calibration');return s?parseSettings(s):null;}
export interface Observation {id:string;time:string;calibration:Calibration;success:string;clarity:number;angle:number;distance:number;stability:string;perception:string;notes:string;viewport:{width:number;height:number};comparisonMode:'original'|'projected';raster:{width:number;height:number};targetId:'HELLO-border-v1';grids?:GridSettings;}
export const RECORDS_KEY='anamorphic-static-observations-v1';
