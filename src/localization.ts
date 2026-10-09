import type {GeometryError} from './geometry';

const geometryErrors: Record<GeometryError,string> = {
 'non-finite':'좌표와 각도에는 유한한 숫자를 입력하세요',
 'invalid-pose':'화면 자세의 회전값 또는 이동값이 올바르지 않습니다',
 'invalid-size':'가로와 세로 길이는 0보다 커야 합니다',
 'eye-on-screen-plane':'눈이 실제 화면 평면 위에 있습니다',
 'eye-on-target-plane':'눈이 가상 표적 평면 위에 있습니다',
 'ill-conditioned-screen':'시선이 화면과 거의 평행해 안정적으로 투영할 수 없습니다',
 'parallel-ray':'광선이 평면과 평행합니다',
 'intersection-behind-eye':'교차점이 눈 뒤에 있습니다',
 'point-off-target-plane':'점이 가상 표적 평면 위에 있지 않습니다',
 'degenerate-ray':'광선의 방향을 정할 수 없습니다',
};
export function geometryErrorLabel(reason:GeometryError):string {return geometryErrors[reason];}
const parserErrors:Record<string,string> = {
 'Pose must contain a finite nonzero quaternion and bounded translation.':'회전값은 유효한 사원수여야 하며 이동값은 유한한 범위 안에 있어야 합니다.',
 'Invalid grid settings.':'격자 표시값과 간격을 확인하세요. 간격은 1~1,000 mm 사이여야 합니다.',
 'Expected a version 1 calibration file.':'버전 1 형식의 보정 파일이 필요합니다.',
 'Calibration must contain finite numeric dimensions and coordinates.':'보정값의 치수와 좌표에는 유한한 숫자를 입력하세요. 좌표의 절댓값은 1,000,000 mm 이하여야 합니다.',
 'Dimensions must be between 0.1 and 10,000 mm.':'가로와 세로 길이는 0.1~10,000 mm 사이여야 합니다.',
 'Rotation must be between -3600 and 3600 degrees.':'회전각은 -3600°~3600° 사이여야 합니다.',
};
/** Browser JSON/File error wording varies; never surface untranslated raw errors. */
export function localizeError(error:unknown):string {
 const message=error instanceof Error?error.message:'';
 return parserErrors[message] || '보정 데이터를 읽을 수 없습니다. 파일 형식과 숫자 값을 확인하세요.';
}
const observations:Record<string,string>={
 uncertain:'확실하지 않음',yes:'예',no:'아니요','not-tested':'미확인',
 'Stable at fixed eye':'눈 위치를 고정하면 안정적','Fragile / intermittent':'쉽게 깨짐 / 간헐적',Unstable:'불안정',
 'Attached to screen':'화면에 붙어 보임','Independent plane':'독립된 평면으로 보임','No clear target':'표적이 뚜렷하지 않음',
};
/** Keep persisted v1 values compatible, including pre-localization records. */
export function observationLabel(value:string):string {return observations[value] || '알 수 없음';}
