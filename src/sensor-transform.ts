import {normalizeQuaternion,multiplyQuaternions,quaternionFromEulerDegrees,inverseQuaternion,IDENTITY_QUATERNION,rotateVector,type Quaternion} from './pose';
import type {Vec3} from './geometry';
/** Unit-normalized at every external boundary, including scaled imported quaternions. */
export function accelerationToWorld(acceleration:Vec3,device:Quaternion,referenceScreen:Quaternion,baselineAngleDeg:number,basePose:Quaternion=IDENTITY_QUATERNION):Vec3 {
 const base=normalizeQuaternion(basePose)!,d=normalizeQuaternion(device)!;
 const basis=multiplyQuaternions(base,quaternionFromEulerDegrees({pitchDeg:0,yawDeg:baselineAngleDeg,rollDeg:0}));
 const toWorld=normalizeQuaternion(multiplyQuaternions(basis,multiplyQuaternions(inverseQuaternion(referenceScreen),d)))!;
 return rotateVector(toWorld,acceleration);
}
