/** Heuristic panel estimates, never a device identity or measured calibration. */
export interface DeviceCalibrationInput {
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
}
export interface DeviceCalibrationProfile {
  /** True only for a supported screen signature, not a confirmed phone model. */
  identified: boolean;
  label: string;
  fullWidthMm: number;
  fullHeightMm: number;
  confidence: 'signature-match' | 'manual-spec' | 'estimated';
  sources: string[];
  screenWidthCss: number;
  screenHeightCss: number;
  warnings: string[];
}
export interface DeviceCalibrationPreset {
  id: string; label: string; widthPixels: number; heightPixels: number; ppi: number; sources: string[];
}
// Verified Apple technical-specification entries; dimensions are portrait pixels.
export const DEVICE_CALIBRATION_PRESETS: readonly DeviceCalibrationPreset[] = [
  {id:'1080x2340',label:'iPhone 13 mini · 1080 × 2340',widthPixels:1080,heightPixels:2340,ppi:476,sources:['https://support.apple.com/en-am/111873']},
  {id:'1170x2532',label:'iPhone 13 · 1170 × 2532',widthPixels:1170,heightPixels:2532,ppi:460,sources:['https://support.apple.com/en-az/111872']},
  {id:'1179x2556',label:'iPhone 15 · 1179 × 2556',widthPixels:1179,heightPixels:2556,ppi:460,sources:['https://support.apple.com/en-nz/111831']},
  {id:'1206x2622',label:'iPhone 16 Pro · 1206 × 2622',widthPixels:1206,heightPixels:2622,ppi:460,sources:['https://support.apple.com/en-us/121031']},
  {id:'1290x2796',label:'iPhone 14 Pro Max · 1290 × 2796',widthPixels:1290,heightPixels:2796,ppi:460,sources:['https://support.apple.com/en-my/111846']},
  {id:'1320x2868',label:'iPhone 16 Pro Max · 1320 × 2868',widthPixels:1320,heightPixels:2868,ppi:460,sources:['https://support.apple.com/en-us/121032']},
  {id:'1284x2778',label:'iPhone 14 Plus · 1284 × 2778',widthPixels:1284,heightPixels:2778,ppi:458,sources:['https://support.apple.com/nl-nl/111854']},
  {id:'1125x2436',label:'iPhone X · 1125 × 2436',widthPixels:1125,heightPixels:2436,ppi:458,sources:['https://support.apple.com/zh-tw/111864']},
  {id:'1242x2688',label:'iPhone 11 Pro Max · 1242 × 2688',widthPixels:1242,heightPixels:2688,ppi:458,sources:['https://support.apple.com/th-th/111878']},
  {id:'750x1334',label:'iPhone SE (3세대) · 750 × 1334',widthPixels:750,heightPixels:1334,ppi:326,sources:['https://support.apple.com/nl-nl/111866']},
  {id:'828x1792',label:'iPhone XR · 828 × 1792',widthPixels:828,heightPixels:1792,ppi:326,sources:['https://support.apple.com/en-gb/111868']},
];
const positive = (n: number): boolean => Number.isFinite(n) && n > 0;
const GENERAL_WARNING = '화면 사양 후보로 계산한 추정치입니다. 화면 확대·브라우저 설정에 따라 달라질 수 있으므로 자로 확인하세요.';

export function estimateDeviceCalibration(input: DeviceCalibrationInput): DeviceCalibrationProfile {
  const validScreen = positive(input.screenWidth) && positive(input.screenHeight)
    && input.screenWidth <= 10000 && input.screenHeight <= 10000;
  const base: DeviceCalibrationProfile = {
    identified: false,
    label: '기기 미확인 · 68 × 147 mm 추정값',
    fullWidthMm: 68,
    fullHeightMm: 147,
    confidence: 'estimated',
    sources: [],
    screenWidthCss: validScreen ? input.screenWidth : 0,
    screenHeightCss: validScreen ? input.screenHeight : 0,
    warnings: ['실제 화면 크기를 확인할 수 없습니다. 화면의 표시 영역을 자로 재서 직접 입력하세요.'],
  };
  if (!validScreen || !positive(input.devicePixelRatio) || input.devicePixelRatio > 8) return base;
  if (!/\biPhone\b/i.test(input.userAgent)) return base;
  const width = Math.min(input.screenWidth, input.screenHeight) * input.devicePixelRatio;
  const height = Math.max(input.screenWidth, input.screenHeight) * input.devicePixelRatio;
  // X/XS/11 Pro and scaled mini modes can share this browser signature while
  // having different physical panels. A UA does not disambiguate them.
  if (Math.abs(width - 1125) <= 1 && Math.abs(height - 2436) <= 1) {
    return {...base, label: '화면 사양 중복 · 직접 보정 필요', warnings: [
      '같은 브라우저 화면 값이 서로 다른 크기의 iPhone에서 나타날 수 있어 자동 크기 추정을 적용하지 않습니다.',
      ...base.warnings,
    ]};
  }
  const panel = DEVICE_CALIBRATION_PRESETS.find(p => Math.abs(width - p.widthPixels) <= 1 && Math.abs(height - p.heightPixels) <= 1);
  if (!panel) return base;
  return {
    ...base,
    identified: true,
    label: `iPhone 화면 사양 후보 · ${panel.widthPixels} × ${panel.heightPixels} px / ${panel.ppi} ppi`,
    fullWidthMm: panel.widthPixels / panel.ppi * 25.4,
    fullHeightMm: panel.heightPixels / panel.ppi * 25.4,
    confidence: 'signature-match',
    sources: [...panel.sources],
    warnings: [GENERAL_WARNING],
  };
}

export interface ViewportEstimate { widthMm: number; heightMm: number; warnings: string[] }
/**
 * Map the canvas/layout viewport CSS extent to its share of the physical panel.
 * Prefer explicit screen orientation: a short landscape viewport can occur on a
 * portrait screen when browser chrome or the keyboard consumes vertical space.
 * visualViewportScale is diagnostic only: do not auto-apply while it is not 1.
 */
export function estimateViewportMm(
  profile: DeviceCalibrationProfile,
  viewportWidthCss: number,
  viewportHeightCss: number,
  orientation?: 'portrait' | 'landscape',
  visualViewportScale = 1,
): ViewportEstimate {
  const warnings = [...profile.warnings];
  const validScreen = positive(profile.screenWidthCss) && positive(profile.screenHeightCss);
  const landscape = orientation ? orientation === 'landscape' : profile.screenWidthCss > profile.screenHeightCss;
  const panelWidth = landscape ? profile.fullHeightMm : profile.fullWidthMm;
  const panelHeight = landscape ? profile.fullWidthMm : profile.fullHeightMm;
  if (!validScreen || !positive(viewportWidthCss) || !positive(viewportHeightCss)
      || !positive(panelWidth) || !positive(panelHeight)) {
    warnings.push('유효한 화면·표시 영역 크기가 없어 전체 화면 추정값을 사용합니다.');
    return {widthMm: positive(panelWidth) ? panelWidth : 68, heightMm: positive(panelHeight) ? panelHeight : 147, warnings};
  }
  const short = Math.min(profile.screenWidthCss, profile.screenHeightCss);
  const long = Math.max(profile.screenWidthCss, profile.screenHeightCss);
  const screenWidth = landscape ? long : short;
  const screenHeight = landscape ? short : long;
  const widthRatio = viewportWidthCss / screenWidth;
  const heightRatio = viewportHeightCss / screenHeight;
  if (widthRatio > 1.01 || heightRatio > 1.01) warnings.push('표시 영역이 화면보다 커서 화면 크기로 제한했습니다. 브라우저 확대 설정을 확인하세요.');
  if (!positive(visualViewportScale) || Math.abs(visualViewportScale - 1) > 0.01) {
    warnings.push('브라우저 확대가 감지되었습니다. 확대를 100%로 되돌린 뒤 자동 크기를 적용하세요.');
  }
  // Stay within the existing calibration domain (>= 0.1 mm) and panel extent.
  const bounded = (ratio: number, size: number): number => Math.max(Math.min(0.1, size), Math.min(1, ratio) * size);
  return {widthMm: bounded(widthRatio, panelWidth), heightMm: bounded(heightRatio, panelHeight), warnings};
}

/** Explicit selection can resolve signatures that the browser cannot distinguish. */
export function calibrationFromDevicePreset(presetId: string, input: DeviceCalibrationInput): DeviceCalibrationProfile | null {
  const preset = DEVICE_CALIBRATION_PRESETS.find(p => p.id === presetId);
  if (!preset) return null;
  const base = estimateDeviceCalibration(input);
  return {...base, identified: true, confidence: 'manual-spec', label: `${preset.label} · 직접 선택한 사양`,
    fullWidthMm: preset.widthPixels / preset.ppi * 25.4,
    fullHeightMm: preset.heightPixels / preset.ppi * 25.4,
    sources: [...preset.sources], warnings: [GENERAL_WARNING]};
}
