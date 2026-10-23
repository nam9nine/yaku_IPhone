# Issue #4 검증 기록

확인일: 2026-10-23. 최종 SHA·독립 리뷰·CI 판정은 [PR #9](https://github.com/nam9nine/yaku_IPhone/pull/9)의 증거를 원본으로 사용한다.

## 로컬 검사

macOS 26.5.2 arm64, Node 24.22.0 / npm 11.19.1, Playwright 1.64.1의 Chromium과 데스크톱 WebKit을 사용했다.

- `npm run check`: 타입·lint·포맷·단위 105개·빌드·하네스 통과.
- `npm run test:e2e`: 두 엔진 합계 38개 통과. 충분한 위로 밀기, 짧은·가로·아래 드래그, pointercancel/capture 손실 후 복귀, 안내 버튼에서 시작한 40/180px 스와이프와 후속 클릭 억제, 터치 탭·키보드 해제·reduced motion, 날짜/분 경계·safe area·높이 변경·문자 확대를 확인했다.
- Chromium은 CDP touch 입력의 실제 브라우저 이벤트 흐름도 확인했다. WebKit의 drag는 pointer 입력이며 실제 iPhone Safari 검증이 아니다.
- `npm run test:visual`: ko-KR, Asia/Seoul, 2026-10-23 09:41, 세 크기 × 두 엔진 6개 일반 회귀 검사 통과. 기준은 명시적 갱신 후 직접 열어 확인했다.

## 실제 이미지 비교와 수정

Apple 잠금 원본과 macOS 6장을 직접 열었다. 날짜·세로형 시계·곡면 배경의 겹침·하단 원형 제어를 비교했다. 초기 시계 획이 가늘다는 독립 리뷰를 반영해 200에서 300으로 조정하고 재캡처했다. 기본 시스템 폰트를 SVG에서 늘린 방식이므로 원본의 글자 모양·콜론·반사 재질과 차이가 있다. 자체 SVG 배경은 원본보다 면과 명암이 단순하며 Apple 자산 복제본이 아니다.

세 크기에서 날짜·시계·하단 제어는 보이고 가로 넘침이 없다. 웹 전용 해제 안내 영역 때문에 하단 바로가기는 원본보다 위에 있다. 가짜 프레임·Island·상태바·시스템 홈 지시 막대를 추가하지 않았다. 손전등과 카메라는 접근성 이름을 가진 안내 버튼이며 실제 기기 기능을 실행하지 않는다.

독립 코드 리뷰가 발견한 안내 버튼의 스와이프 시작 경로를 수정했다. 해당 버튼만 capture 대상으로 허용하고 8px 이상 이동 뒤 발생한 pointer click은 막되 키보드 click은 허용한다. 정상 해제뿐 아니라 짧은 스와이프 후 잠금 유지도 실제 브라우저에서 확인했다.

기준 변경 이유: #3의 준비 패널을 실제 잠금 화면으로 교체했다. 이전 준비 화면은 main 이력에 남아 있으며 새 기준 경로는 `tests/visual/baselines/{darwin,linux}/{chromium,webkit}/lock-{360x800,390x844,430x932}.png`다. 홈 도착 상태는 #5 통합 전 최소 상태이며 앱 격자·Dock의 검증으로 확대하지 않는다.

실제 iPhone Safari·iOS Simulator는 미검증이다. 참조 ID: `apple-lock-screen-image`, `apple-unlock`, `apple-custom-lock`.

## Linux 캡처와 독립 리뷰 보완

소스 `f0c74f33fca6f8e73934a4a338662d8cccc11d55`의 [CI run 39934862856](https://github.com/nam9nine/yaku_IPhone/actions/runs/39934862856)에서 동작 38개가 통과했다. 시각 검사는 Linux 기준이 없는 6개가 실패했으며 성공으로 계산하지 않았다. artifact `12492843869`의 ZIP SHA-256 `695a00d2668bf8b7d0060ed49745cb744a44f0b30b639912ab36a8494077801c`를 검증하고 실제 capture.png 6장을 root와 독립 검토자가 직접 열어 기준으로 등록했다. Linux WebKit은 획 폭이 좁고 시스템 폰트의 콜론·숫자 받침이 다르다. OS·엔진별 차이를 보존하며 Apple 원본과 완전히 같다고 판정하지 않는다.

독립 리뷰에서 360×320·글자 200% 환경의 native 터치 스크롤 차단을 발견했다. 높이 620px 이하에서는 양방향 스크롤과 확대를 허용하고 탭·키보드 해제를 유지한다. Chromium CDP 터치로 실제 scrollY 증가와 하단 해제 탭까지 확인한 뒤 두 엔진 동작 38개를 다시 통과했다. 이 수정은 기본 세 크기의 픽셀을 바꾸지 않는다. 최종 SHA의 Linux 회귀 결과는 PR의 필수 browser job으로 별도 확인한다.
