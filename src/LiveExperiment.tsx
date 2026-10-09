import React,{useEffect,useRef,useState} from 'react';
import type {Calibration} from './geometry';
import type {GridSettings} from './grids';
import {makeLiveTexture,type TargetPattern} from './op-art';
import {renderLive} from './live-render';
import {IDENTITY_QUATERNION,normalizeQuaternion,deviceOrientationToQuaternion,relativeScreenOrientation,quaternionFromEulerDegrees,multiplyQuaternions,inverseQuaternion,rotateVector,type Quaternion} from './pose';
import {accelerationToWorld} from './sensor-transform';
import {sensorPoseReady} from './sensor-gate';
import {parseLiveSettings} from './live-settings';
import {DEFAULT_PANE} from './pane';
import {MotionEstimator} from './motion';
type Sample={alpha:number;beta:number;gamma:number;at:number};
const screenAngle=()=>screen.orientation?.angle??(window as Window&{orientation?:number}).orientation??0;
const zero={x:0,y:0,z:0};
const motionLabels:Record<string,string>={calibrating:'정지 보정 중',tracking:'이동 추정 중',unavailable:'이동 센서 사용 불가 · 초기화 필요',stale:'이동 샘플 중단 · 초기화 필요','limit-reached':'150 mm 한계 · 초기화 필요','invalid-timestamp':'시간 오류 · 초기화 필요'};
export function LiveExperiment({calibration,grids,visible=true,onLoad}:{calibration:Calibration;grids:GridSettings;visible?:boolean;onLoad:(c:Calibration,g:GridSettings)=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),sample=useRef<Sample|null>(null),reference=useRef<Quaternion|null>(null),referenceAngle=useRef(0),estimator=useRef(new MotionEstimator());
 const [source,setSource]=useState<'manual'|'sensor'>('manual'),[enabled,setEnabled]=useState(false),[translation,setTranslation]=useState(false),[frozen,setFrozen]=useState(false);
 const [manual,setManual]=useState({pitchDeg:0,yawDeg:0,rollDeg:0,x:0,y:0,z:0}),[eye,setEye]=useState(calibration.eye);
 const [status,setStatus]=useState('수동 모드 · 센서는 꺼져 있습니다'),[metrics,setMetrics]=useState(''),[poseText,setPoseText]=useState('');
 const [pattern,setPattern]=useState<TargetPattern>('hello'),[cellMm,setCellMm]=useState(6);
 const [requesting,setRequesting]=useState(false),[motionAvailable,setMotionAvailable]=useState(false);
 const motionWaitingSince=useRef(0);
 const [expanded,setExpanded]=useState(true),[pane,setPane]=useState(DEFAULT_PANE);
 const active=useRef({source,translation,frozen,manual,eye,enabled});active.current={source,translation,frozen,manual,eye,enabled};
 const renderedStyle=useRef({pattern,cellMm,pane,grids});
 const log=useRef<unknown[]>([]),lastPose=useRef<Calibration>(calibration),calibrated=useRef(false),generation=useRef(0),rawMotionAt=useRef(0);
 function stop(){generation.current++;setRequesting(false);setMotionAvailable(false);setTranslation(false);setEnabled(false);setSource('manual');sample.current=null;reference.current=null;calibrated.current=false;estimator.current.reset();setStatus('센서 중지 · 수동 모드');}
 function recenter(){
  if(active.current.source==='manual'){setManual({pitchDeg:0,yawDeg:0,rollDeg:0,x:0,y:0,z:0});setFrozen(false);setStatus('수동 자세 초기화');return;}
  const s=sample.current;
  if(!s||performance.now()-s.at>300){reference.current=null;calibrated.current=false;setFrozen(true);setStatus('유효한 최신 방향 샘플이 없습니다. 기존 이미지를 유지합니다.');return;}
  const angle=screenAngle(),next=deviceOrientationToQuaternion(s,angle);
  if(!next){reference.current=null;calibrated.current=false;setFrozen(true);return;}
  referenceAngle.current=angle;reference.current=next;calibrated.current=true;
  estimator.current.reset();rawMotionAt.current=0;motionWaitingSince.current=performance.now();setFrozen(false);
  setStatus(`기준 자세 저장 · 약 1초간 정지하세요. 실제 폰을 초기 Y각 ${calibration.display.angleDeg}°와 보정 중심에 둔 기준입니다. 눈·평면 위치는 고정하세요.`);
 }

 async function start(){
  if(!window.isSecureContext){setStatus('HTTPS에서 센서를 사용할 수 있습니다. 수동 모드는 사용 가능합니다.');return;}
  if(!('DeviceOrientationEvent' in window)){setStatus('방향 센서 API 미지원 · 수동 모드를 사용하세요.');return;}
  const token=++generation.current;setRequesting(true);
  type PermissionConstructor={requestPermission?:()=>Promise<string>};
  try{
   // Both calls happen synchronously within this click, before any await.
   const o=DeviceOrientationEvent as unknown as PermissionConstructor;
   const m=window.DeviceMotionEvent as unknown as PermissionConstructor|undefined;
   const requests=[o.requestPermission?o.requestPermission():Promise.resolve('granted'),m?.requestPermission?m.requestPermission().catch(()=>'denied'):Promise.resolve(m?'granted':'unavailable')];
   const [orientation,motion]=await Promise.all(requests);if(token!==generation.current)return;
   if(orientation!=='granted'){setStatus('방향 센서 권한 거부 · 수동 모드를 사용하세요.');return;}
   sample.current=null;reference.current=null;calibrated.current=false;estimator.current.reset();setSource('sensor');setEnabled(true);setMotionAvailable(motion==='granted');if(motion!=='granted')setTranslation(false);
   setStatus('센서 샘플 대기 · 기기를 기준 자세로 고정한 후 기준 자세/이동 초기화를 누르세요.'+(motion!=='granted'?' 이동 센서 권한 없음: 회전만 사용 가능합니다.':''));
  }catch{if(token===generation.current)setStatus('센서 권한 요청 실패 · 수동 모드를 사용하세요.');}finally{if(token===generation.current)setRequesting(false);}
 }
 useEffect(()=>()=>{generation.current++;},[]);
 useEffect(()=>{
  if(!enabled)return;if(reference.current){reference.current=null;calibrated.current=false;setFrozen(true);setStatus('초기 보정이 바뀌었습니다. 센서 기준을 다시 저장하세요.');}const started=performance.now();
  const orientation=(e:DeviceOrientationEvent)=>{if([e.alpha,e.beta,e.gamma].every(v=>typeof v==='number'&&Number.isFinite(v)))sample.current={alpha:e.alpha!,beta:e.beta!,gamma:e.gamma!,at:performance.now()};};
  const motion=(e:DeviceMotionEvent)=>{
   if(!active.current.translation||!calibrated.current||!reference.current)return;
   const now=performance.now(),s=sample.current;if(!s||now-s.at>300)return;
   const a=e.acceleration;rawMotionAt.current=now;
   if(!a||![a.x,a.y,a.z].every(v=>typeof v==='number'&&Number.isFinite(v))){estimator.current.update(null,now);return;}
   const device=deviceOrientationToQuaternion(s,0)!;
   estimator.current.update(accelerationToWorld({x:a.x!,y:a.y!,z:a.z!},device,reference.current,calibration.display.angleDeg,calibration.display.pose?.orientation),now);
  };
  const invalidate=()=>{calibrated.current=false;reference.current=null;setFrozen(true);setStatus('화면 방향/가시성이 바뀌어 기준을 해제했습니다. 표시 영역을 다시 보정한 뒤 기준 자세를 다시 저장하세요.');};
  const visibility=()=>{if(document.hidden)invalidate();};
  window.addEventListener('deviceorientation',orientation);window.addEventListener('devicemotion',motion);window.addEventListener('orientationchange',invalidate);screen.orientation?.addEventListener('change',invalidate);document.addEventListener('visibilitychange',visibility);
  const timer=window.setInterval(()=>{const s=sample.current;if(!s&&performance.now()-started>2000)setStatus('권한 요청 완료, 유효한 방향 샘플 없음 · 수동 모드를 사용할 수 있습니다.');else if(s&&performance.now()-s.at>500&&calibrated.current){invalidate();setStatus('방향 샘플이 오래되어 정지했습니다. 기준 자세를 다시 저장하세요.');}},500);
  return()=>{window.removeEventListener('deviceorientation',orientation);window.removeEventListener('devicemotion',motion);window.removeEventListener('orientationchange',invalidate);screen.orientation?.removeEventListener('change',invalidate);document.removeEventListener('visibilitychange',visibility);clearInterval(timer);};
 },[enabled,calibration]);
 useEffect(()=>{
  const texture=makeLiveTexture(calibration.target.widthMm/calibration.target.heightMm,pattern,cellMm,calibration.target,grids.plane?{...calibration.target,spacingMm:grids.planeSpacingMm}:undefined);
  const pixels=texture.getContext('2d')!.getImageData(0,0,texture.width,texture.height);
  let raf=0,last=0,lastReport=0,frames=0,reportStart=performance.now();
  const tick=(now:number)=>{
   raf=requestAnimationFrame(tick);if(document.hidden||now-last<1000/15)return;last=now;
   const a=active.current,s=sample.current;let orientation=quaternionFromEulerDegrees(a.manual),position={x:a.manual.x,y:a.manual.y,z:a.manual.z};
   let warning='',poseReady=true;
   if(a.source==='sensor'){
    poseReady=sensorPoseReady(calibrated.current,!!reference.current,s?.at??null,now,screenAngle(),referenceAngle.current);
    if(!poseReady){warning='센서 기준 없음 / 중단 · 기존 이미지 유지';}
    else{const delta=relativeScreenOrientation(deviceOrientationToQuaternion(s!,referenceAngle.current)!,reference.current!,calibration.display.angleDeg)!;const base=normalizeQuaternion(calibration.display.pose?.orientation)||IDENTITY_QUATERNION;orientation=multiplyQuaternions(base,multiplyQuaternions(delta,inverseQuaternion(base)));if(a.translation&&!rawMotionAt.current&&now-motionWaitingSince.current>1500)estimator.current.update(null,now);position=a.translation?estimator.current.checkStale(now).displacementMm:zero;}
   }
   const basePose=calibration.display.pose;
   const current={...calibration,eye:a.eye,display:{...calibration.display,pose:{orientation:multiplyQuaternions(orientation,normalizeQuaternion(basePose?.orientation)||IDENTITY_QUATERNION),translationMm:{x:position.x+(basePose?.translationMm.x||0),y:position.y+(basePose?.translationMm.y||0),z:position.z+(basePose?.translationMm.z||0)}}}};
   const start=performance.now();
   if(!a.frozen&&poseReady&&canvas.current){warning=renderLive(canvas.current,current,pixels,grids,pane)||warning;lastPose.current=structuredClone(current);renderedStyle.current={pattern,cellMm,pane,grids};frames++;}
   const renderMs=performance.now()-start;
   if(now-lastReport>250){
    const state=estimator.current.state;const hz=frames*1000/(now-reportStart);frames=0;reportStart=now;lastReport=now;
    setMetrics(`${a.frozen||!poseReady?'정지':hz.toFixed(1)+' fps'} · 최대 15 fps / 긴 변 480 px · 계산 ${renderMs.toFixed(1)} ms · 방향 샘플 ${s?Math.round(now-s.at)+' ms 전':'없음'}${warning?' · '+warning:''}`);
    setPoseText(`이동 x ${position.x.toFixed(1)} / y ${position.y.toFixed(1)} / z ${position.z.toFixed(1)} mm${a.translation?' · '+(rawMotionAt.current||state.requiresRecenter?motionLabels[state.status]:'이동 샘플 대기 / 미지원 가능')+' · '+Math.round(state.calibrationProgress*100)+'% 보정':''}`);
    log.current.push({timeMs:now,source:a.source,frozen:a.frozen,renderedCalibration:lastPose.current,renderedStyle:renderedStyle.current,estimatedStyle:{pattern,cellMm,pane,grids},poseReady,estimatedPose:current.display.pose,translation:a.translation,motion:state,renderMs,measuredFps:hz,sensorAgeMs:s?now-s.at:null});if(log.current.length>2400)log.current.shift();
   }
  };raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);
 },[calibration,grids,pane,pattern,cellMm]);
 function saveSettings(){saveJson('anamorphic-live-settings.json',{version:1,kind:'live-settings',calibration,grids,manual,eye,pane,pattern,cellMm});}
 async function loadSettings(file?:File){if(!file)return;try{if(file.size>1000000)throw new Error('1 MB 이하 파일을 선택하세요');const v=parseLiveSettings(await file.text());stop();setTranslation(false);setFrozen(false);setManual(v.manual);setEye(v.eye);setPane(v.pane);setPattern(v.pattern);setCellMm(v.cellMm);onLoad(v.calibration,v.grids);setStatus('설정을 수동 모드로 불러왔습니다. 실제 표시 영역을 확인하세요. 센서 기준은 새로 저장해야 합니다.');}catch(e){setStatus(e instanceof Error?e.message:'설정을 읽을 수 없습니다');}}
 function saveJson(name:string,payload:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function exportLog(){const payload={version:1,kind:'experimental-live-session',createdAt:new Date().toISOString(),calibration,grids,pane,pattern,cellMm,filter:estimator.current.config,render:{maxFps:15,maxEdgePx:480,method:'exact inverse homography, bilinear RGB'},limitations:'Fixed assumed eye. Rotation calibrated, not externally validated. 2D acceleration dead reckoning with drift; not 6DoF. Log capped at most recent 2400 samples.',samples:log.current};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='anamorphic-live-session.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <><canvas ref={canvas} className="live-canvas" aria-label="실시간 투영 화면"/>{visible&&<div className="live-controls"><button onClick={()=>setExpanded(!expanded)}>동적 실험 {expanded?'접기':'펼치기'}</button><button onClick={()=>setFrozen(!frozen)} aria-pressed={frozen}>{frozen?'B · 실시간 재개':'A · 현재 이미지 정지'}</button>{expanded&&<>
 <label><input type="checkbox" checked={pane.enabled} onChange={e=>setPane(v=>({...v,enabled:e.target.checked}))}/>실제 화면 · 반투명 파란 평면</label><label>파란 평면 불투명도 {Math.round(pane.opacity*100)}%<input type="range" min="0" max="0.8" step="0.01" value={pane.opacity} onChange={e=>setPane(v=>({...v,opacity:Number(e.target.value)}))}/></label><p>가상 표적이 실제 화면보다 앞에 있으면 원래 색, 뒤에 있으면 파란색 아래에 표시합니다. 평면의 교차를 보여주는 색상 단서이며 실제 가림·입체 시점을 재현하지 않습니다.</p><label>표적 무늬 <select aria-label="표적 무늬" value={pattern} onChange={e=>setPattern(e.target.value as TargetPattern)}><option value="hello">HELLO</option><option value="rings">동심원 · OP ART</option><option value="checkerboard">체커보드 · OP ART</option></select></label>{pattern!=='hello'&&<label>무늬 간격 {cellMm} mm<input type="range" min="2" max="20" step="1" value={cellMm} onChange={e=>setCellMm(Number(e.target.value))}/></label>}<p>무늬 자체는 움직이거나 깜박이지 않습니다. 불편하거나 어지러우면 중단하세요.</p><h3>2/3단계 · 수동 / 센서 회전 + 실험적 이동</h3><p>눈과 가상 평면은 공간에 고정된 것으로 가정합니다. 추적하지 않습니다. 먼저 수동 자세를 검증하고 센서를 켜세요. 센서 기준 저장 시 폰을 초기 Y각 {calibration.display.angleDeg}°와 보정된 화면 중심에 맞추세요.</p>
 <div className="button-row"><button onClick={()=>void start()} disabled={enabled||requesting}>센서 권한 요청 · 시작</button><button onClick={stop}>센서 중지 / 수동</button><button onClick={recenter}>기준 자세 / 이동 초기화</button><button onClick={exportLog}>실험 로그 JSON ↓</button><button onClick={saveSettings}>동적 설정 저장 ↓</button><label className="file-button">동적 설정 불러오기<input type="file" accept="application/json,.json" onChange={e=>{void loadSettings(e.target.files?.[0]);e.target.value='';}}/></label></div>
 <label><input type="checkbox" checked={translation} disabled={source==='sensor'&&!motionAvailable} onChange={e=>{setTranslation(e.target.checked);estimator.current.reset();rawMotionAt.current=0;motionWaitingSince.current=performance.now();}}/>가속도 이동 추정 (실험적 · 기본 꺼짐)</label>
 <p className="warning">이동은 x/y만 추정합니다. 센서 오차가 누적되므로 실제 위치가 아닙니다. 150 mm 한계 또는 샘플 중단 시 초기화가 필요합니다. 일정 속도와 정지를 구별할 수 없습니다. 화면 방향이 바뀌면 재보정하세요. 현재 화면 중심 회전을 가정하며 눈 이동·깊이는 자동 추적하지 않습니다.</p>
 {source==='manual'&&<div className="live-fields">{(['pitchDeg','yawDeg','rollDeg','x','y','z'] as const).map((key,i)=><label key={key}>{['피치 X °','요 Y °','롤 Z °','이동 x mm','이동 y mm','이동 z mm'][i]}<input type="range" min={i<3?-80:-150} max={i<3?80:150} step="1" value={manual[key]} onChange={e=>setManual(v=>({...v,[key]:Number(e.target.value)}))}/><output>{manual[key]}</output></label>)}</div>}
 <div className="live-fields">{(['x','y','z'] as const).map(key=><label key={key}>고정 눈 {key} mm<input type="number" value={eye[key]} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&Math.abs(n)<=1000000)setEye(v=>({...v,[key]:n}));}}/></label>)}</div>
 <p role="status">{status}</p><p>{poseText}</p><p>{metrics}</p><p className="fine">A는 마지막 이미지만 고정하고 센서 추정은 계속됩니다. B는 현재 추정 자세로 재개합니다. JSON은 최근 최대 2,400개 샘플(약 10분), 자세·필터·계산 시간·샘플 나이를 저장합니다. 센서 및 지각 정확도는 실제 기기에서 미검증입니다.</p>
 </>}</div>}</>;
}
