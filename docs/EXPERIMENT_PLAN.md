# Experiment plan: Phase 0 / Phase 1

## 1. 질문과 구분

가설: 고정된 한 눈의 위치와 실제 화면 자세가 입력값에 맞으면, ray/plane 교차로 만든 anamorphic 패턴은 그 눈에서 가상 XY 평면상의 원래 패턴과 같은 시선 방향을 만든다. 이때 실제 관찰자가 글자와 테두리를 화면에 붙은 왜곡된 그림보다 고정된 가상 평면처럼 지각하는지는 **별도 인간 실험 질문**이다.

세 결과를 분리한다.

1. **Geometric correctness:** 대응점의 시선 방향, forward/inverse round trip, 축·부호·단위, 유효성 판정이 수학 모델에 맞는가?
2. **World-lock stability:** 눈 또는 화면이 변할 때 목표 위치가 유지되는가? Phase 1은 tracking이 없으므로 이 동적 성능을 검증하지 않는다. 정적 자세마다 기하가 맞는 것과 연속 동작 안정성은 다르다.
3. **Perceptual illusion:** 실제 사람이 정해진 조건에서 화면과 분리된 평면처럼 경험하는가? 코드, 자동 테스트, 개발자 스크린샷은 이 결과를 대신할 수 없다.

검은 배경에 흰 `HELLO`와 흰 사각 테두리를 하나의 texture로 사용한다. 텍스트와 테두리를 각각 별도 변환하지 않는다. 테두리는 글자 읽기와 별개로 형태 왜곡 및 잘림을 관찰하는 기준이다.

## 2. 좌표와 입력 계약

모든 물리 길이는 **mm**. 초기 교정 화면 중심이 world origin `(0,0,0)`이다. `+x`는 오른쪽, `+y`는 위, `+z`는 눈 쪽이다. CSS/canvas의 아래로 증가하는 y와 혼동하지 않는다.

- 눈 `E = (eyeX, eyeY, eyeZ)`, 기본 거리 `eyeZ = 350 mm`
- 화면의 교정 물리 폭 `Ws = 68 mm`, 높이 `Hs = 147 mm`는 초기 예시
- 화면의 초기 local plane은 `z = 0`
- 화면 Y 회전 `θ = 30°` 기본값; pivot `P = (px, py, pz)`는 설정 가능
- 가상 rectangle 중심 `C = (cx, cy, cz)`와 양수인 폭 `Wv`, 높이 `Hv`를 설정; 기본 평면 깊이 `cz = 0`
- 가상 평면은 world XY에 평행하며 실제 화면의 회전을 따라 회전하지 않는다

오른손 규칙 Y 회전:

```text
Ry(θ) = [ cosθ   0   sinθ
           0    1     0
         −sinθ   0   cosθ ]

S(q) = P + Ry(θ) (q − P)
q = (localX, localY, 0)
```

화면 중심 `O = S(0,0,0)`, 화면 법선 `n = Ry(θ)(0,0,1)`이다. 이 규약에서 양의 회전은 화면의 오른쪽 가장자리를 눈에서 멀어지게 한다. `P`가 원점이 아니면 회전에 따라 화면 중심도 이동한다. 실제 거치대 회전축이 입력한 pivot과 달라지는 것은 단순 각도 오차와 별개다.

## 3. Forward projection: 가상 점 → 물리 화면

가상 rectangle 위 점 `V`에서 눈으로 보이는 방향을 물리 화면에 표시한다.

```text
D = V − E
R(t) = E + t D
n · (R(t) − O) = 0
t = n · (O − E) / (n · D)
Q = E + t D
q = P + Ry(θ)^T (Q − P)
```

`q`는 초기 screen-local 좌표이다. `|q.x| ≤ Ws/2` 및 `|q.y| ≤ Hs/2`이면 표시 가능한 화면 안이다. 그 밖은 **clipped**이며 화면 안으로 강제로 옮기지 않는다. 가상 plane과 화면의 앞뒤 관계에 따라 유효한 `t`는 1보다 클 수도 작을 수도 있다. `0 < t ≤ 1`로 제한하면 안 된다.

## 4. Inverse rendering: 각 화면 픽셀 → 가상 texture

출력 raster의 각 픽셀 중심에서 실제 screen-local 위치를 계산한다. raster 크기가 `Nx × Ny`이면:

```text
localX = ((i + 0.5) / Nx − 0.5) Ws
localY = (0.5 − (j + 0.5) / Ny) Hs
Q = S(localX, localY, 0)
D = Q − E
λ = (cz − E.z) / D.z
V = E + λ D
u = (V.x − cx) / Wv + 0.5
v = 0.5 − (V.y − cy) / Hv
```

유효한 `u,v ∈ [0,1]`만 동일한 `HELLO + border` texture에서 샘플링한다. 바깥은 검정이다. 이것은 texture의 각 점을 앞으로 찍어서 생기는 빈 픽셀을 피하는 inverse mapping이다. 디스플레이의 pixel ratio는 raster 선명도에 관여하고, mm 좌표 교정은 별도로 유지한다.

### 공통 유효성 규칙

- 유한하지 않은 입력, 0 이하의 화면/가상 rectangle 크기는 invalid
- 두 ray 교차 모두 파라미터가 **strictly positive**여야 한다
- 평행 또는 수치적으로 거의 평행한 ray/plane 분모는 invalid
- 눈이 대상 plane에 있어 교차가 유일하지 않거나 ray 시작점에만 생기는 경우도 invalid
- 특이점, invalid 교차, clipped 점을 큰 유한 좌표로 대체해 그리지 않는다
- forward와 inverse의 epsilon 및 경계 규약을 일치시킨다. 특이점 가까이에서는 엄밀한 equality 대신 명시된 tolerance를 적용한다
- 렌더 가능한 일부 영역과 invalid/clipped 영역이 함께 생길 수 있다. 검정 영역이 지각 실험의 성공을 의미하지 않는다

## 5. Phase 0: 기하와 교정

먼저 수치 검증으로 모델을 검사한다. 실제 실행 결과는 테스트 출력과 함께 기록하고, 아래 목록을 통과한 것으로 미리 간주하지 않는다.

- `θ = 0`, `cz = 0`: 화면 plane과 가상 plane이 같을 때 대응은 identity
- 양·음 회전에서 부호, 비대칭 eye offset, 원점 밖 pivot 이동 확인
- 유효한 가상 점 → 화면 → 가상 plane round trip 오차 확인
- screen pixel → 가상 점 → 화면 round trip 오차 확인
- 눈과 가상 plane 사이/너머의 교차에서 positive ray 규칙 확인
- 평행 ray, 특이점, NaN/Infinity, 비양수 크기, 화면 밖 점 처리 확인
- 테두리와 `HELLO`가 같은 texture에서 함께 변형되는지 확인
- desktop/mobile resize 이후 실제 패턴 영역과 입력 mm가 여전히 일치하는지 확인

### 물리 viewport 교정

측정 대상은 휴대폰 몸체도 패널의 공칭 크기도 아닌 **현재 패턴의 표시 사각 영역**이다. ruler를 화면 위에 대어 가로/세로를 mm로 재고 입력한다. 교정 눈금이 표시되면 같은 ruler로 교차 확인한다. 눈금 검증만으로 eye distance나 회전각이 검증되는 것은 아니다.

웹의 absolute CSS length가 실제 물리 mm와 항상 일치한다고 가정하면 안 된다. 화면에서는 reference pixel 기반 정의를 사용할 수 있다. [W3C CSS Values and Units: absolute lengths](https://www.w3.org/TR/css-values-4/#absolute-lengths)

모바일 viewport 높이는 browser UI 상태에 따라 달라질 수 있다. WebKit은 작은/큰/dynamic viewport 단위를 구분하며 `dvh`는 스크롤에 따라 변할 수 있다고 설명한다. 따라서 Safari의 주소 표시줄이 접히거나 다시 나타나는 동안 측정하지 말고, 상태를 고정한 뒤 교정한다. [WebKit: viewport units](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)

전체 화면 API의 성공 여부를 가정하지 않는다. 사용할 수 없으면 브라우저에서 확보한 안정된 영역으로 수행한다. orientation, zoom, chrome, safe-area, 표시 영역 크기가 바뀌면 이전 교정을 무효로 하고 다시 측정한다.

## 6. Phase 1: 정적 인간 관찰

### 준비

- portrait 휴대폰, 자, 각도 기준, 안정된 지지대, 결과 기록지
- 패턴 영역 물리 크기, viewport 상태, 눈 거리/오프셋, pivot과 실제 자세 기록
- 단안 관찰; 눈을 누르지 않고 편안하게 한쪽 눈을 감는다
- 눈의 위치를 고정하고, 손으로 들고 연속 회전시키기보다 화면을 거치한다
- 먼저 `0°`, 다음 `30°`의 각각 **멈춘 자세**에서 관찰

### 비교

각 자세에서 보정하지 않은 기준 패턴과 보정 패턴을 같은 눈 위치·크기·밝기 조건에서 비교한다. 가능하면 보정/비보정 순서를 바꿔 반복한다. 보정 화면을 “정답”이라고 미리 안내하지 않는다.

별도로 답한다:

1. `HELLO`가 읽히는가?
2. 테두리의 비례/평행성이 목표 가상 rectangle처럼 보이는가?
3. 패턴이 화면에 붙어 있는가, 다른 방향의 가상 평면처럼 보이는가, 판단 불가인가?
4. 잘림·공백·불편함이 있는가?

Phase 1은 **정지 관찰**이다. 머리를 옮기거나 휴대폰을 움직인 동안의 결과는 tracking 테스트가 아니며 별도 조건으로 기록한다. 그 움직임에 맞춰 패턴이 자동 갱신될 것으로 기대하지 않는다.

### 실패/보류 기준

- geometry 불일치, 부호 오류, round trip tolerance 위반: 구현 실패, 지각 결론 보류
- viewport 또는 눈/pivot/각도 교정 불확실: 해당 trial 무효 또는 불확실로 기록
- 중요한 테두리가 잘려 comparison이 불가능: stimulus 조건 실패
- geometry가 맞아도 보정/비보정 차이가 없거나 가상 plane 지각이 없음: 해당 조건에서 가설 지지 없음
- 사람의 응답이 없고 자동 테스트만 통과: **perception pending**
- 불편함 발생: 즉시 중단; 성공 여부보다 중단 사실을 우선 기록

한 번의 성공/실패를 모든 사람·기기·자세에 일반화하지 않는다. 가상 깊이와 rectangle 크기 변경은 별도의 trial로 기록한다.

## 7. 기록 양식 및 현재 결과

```text
Trial / 날짜:
기기 / OS / 브라우저:
표시 모드 / browser chrome / zoom:
실측 패턴 영역 Ws × Hs (mm):
눈 E (mm) / 단안 좌우:
화면 θ (deg) / pivot P (mm):
가상 중심 C (mm) / Wv × Hv (mm):
기준/보정 제시 순서:
기하 검증 결과 / tolerance / 로그:
읽기 / 테두리 형태:
화면 부착 vs 가상 plane vs 판단 불가:
잘림 / 불편함 / 교정 불확실성:
반복 시 일관성:
결론: 지지 / 지지 없음 / 불확실 / 무효
```

현재: **인간 관찰 미실시. 착시 성공 및 world-lock 안정성은 pending.** 자동 테스트 결과와 실제 배포 상태는 실행/배포 시 별도로 확인한다.

## 8. 확장 경계

geometry(순수 좌표·교차 계산), rendering(texture 및 raster 표시), input(수동 parameter와 viewport 교정)을 분리한다. 이후 input 공급원이 바뀌더라도 ray 규약과 테스트를 재사용할 수 있어야 한다.

- **Phase 2, 미래:** 수동 dynamic 실험. 먼저 정적 결과를 검토하고, 수동으로 바뀌는 자세 입력과 실제 자세의 관계를 명시한다. 자동 pose 측정으로 표현하지 않는다.
- **Phase 3:** Phase 2 이후 결과 검토 및 사용자 승인 없이는 시작하지 않는다. 센서·카메라·6DoF를 현재 범위에 추가하지 않는다.
- **Phase 4:** 지각 실험 결과를 검토하고 명시적 승인을 받은 이후에만 iOS feasibility를 검토한다. feasibility 검토는 native 제품 구현 승인이 아니다.

이 저장소의 정적 prototype은 실험 도구이며, 입증된 world-locked display나 완성된 제품을 주장하지 않는다.
