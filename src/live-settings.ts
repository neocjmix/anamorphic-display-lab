import {parseCalibration} from './state';
import {parseGrids,type GridSettings} from './grids';
import type {Calibration,Vec3} from './geometry';
import type {TargetPattern} from './op-art';
import type {PaneSettings} from './pane';
export interface ManualPose {pitchDeg:number;yawDeg:number;rollDeg:number;x:number;y:number;z:number}
export interface LiveSettings {version:1;kind:'live-settings';calibration:Calibration;grids:GridSettings;manual:ManualPose;eye:Vec3;pane:PaneSettings;pattern:TargetPattern;cellMm:number}
export function parseLiveSettings(text:string):LiveSettings{
 const v=JSON.parse(text);if(v?.version!==1||v.kind!=='live-settings')throw new Error('동적 설정 형식이 아닙니다');
 const calibration=parseCalibration(JSON.stringify({version:1,calibration:v.calibration})),grids=parseGrids(v.grids);
 if(!v.manual||!['pitchDeg','yawDeg','rollDeg','x','y','z'].every(k=>typeof v.manual[k]==='number'&&Number.isFinite(v.manual[k])&&Math.abs(v.manual[k])<=(k.endsWith('Deg')?80:150)))throw new Error('수동 자세 범위를 확인하세요');
 if(!v.eye||!['x','y','z'].every(k=>typeof v.eye[k]==='number'&&Number.isFinite(v.eye[k])&&Math.abs(v.eye[k])<=1000000))throw new Error('눈 위치를 확인하세요');
 if(!v.pane||typeof v.pane.enabled!=='boolean'||typeof v.pane.opacity!=='number'||!Number.isFinite(v.pane.opacity)||v.pane.opacity<0||v.pane.opacity>.8)throw new Error('파란 평면 설정을 확인하세요');
 const pattern=v.pattern??'hello',cellMm=v.cellMm??6;if(!['hello','rings','checkerboard'].includes(pattern)||typeof cellMm!=='number'||!Number.isFinite(cellMm)||cellMm<2||cellMm>20)throw new Error('표적 무늬와 간격을 확인하세요');
 return {version:1,kind:'live-settings',calibration,grids,manual:v.manual,eye:v.eye,pane:v.pane,pattern,cellMm};
}
