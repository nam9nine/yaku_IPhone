# Issue #5·#6 홈 화면과 통합 검증

확인일: 2026-10-23. 최종 SHA와 독립 리뷰·CI 판정은 [PR #10](https://github.com/nam9nine/yaku_IPhone/pull/10)의 `harness-evidence`를 원본으로 사용한다. #6은 #5와 같은 잠금→홈 연결 결과의 통합 검증으로 함께 처리한다.

## 구현과 범위

사진·달력 위젯 2개, 첫 페이지 4열×4행 앱, 둘째 페이지 8개 앱, 고정 Dock 4개를 구현했다. 좌우 스와이프·페이지 버튼·화살표 키로 이동하고 아이콘 누름 반응과 준비 중 안내를 제공한다. 앱 내부·외부 API·스토리는 구현하지 않았다. 잠금 외형은 사용자 요청대로 추가 정교화하지 않고 기존 기능을 연결했다.

## 실제 로컬 검사

macOS 26.5.2 arm64, Node 24.22.0 / npm 11.19.1, Playwright 1.64.1의 Chromium·데스크톱 WebKit에서 실행했다.

- `npm run check`: 타입·lint·포맷·Vitest 109개·빌드·harness 통과.
- `npm run test:e2e`: 잠금·홈 합계 74개 통과. 세 크기 배치, 잠금→홈→재잠금, 포커스, 짧은·수직·방향을 되돌린 드래그, 양 끝 페이지, pointercancel·capture loss·blur·합성 hidden 복귀, 아이콘 클릭 억제, 키보드·reduced motion, 200% 문자·짧은 높이 스크롤을 확인했다.
- Chromium에서는 CDP touch 입력으로 잠금 해제·홈 페이지 넘기기·세로 스크롤을 실행했다. WebKit은 pointer 입력과 스크롤 정책·프로그램식 scrollBy 경로이며 실제 iPhone Safari 터치 검증으로 기록하지 않는다.
- `npm run test:visual`: 잠금·홈 1/2페이지 × 세 크기 × 두 엔진, 총 18개 일반 회귀 검사 통과. 캡처 안정화 후 WebKit 9개를 추가 실행해 통과했다.

## 직접 비교와 해결한 문제

Apple 홈 원본과 새 macOS 홈 12장을 root와 비구현 독립 검토자가 직접 열었다. 위젯·격자·라벨·Dock이 360×800, 390×844, 430×932에서 보이고 가로 넘침이나 겹침은 없었다. 기존 잠금 6장은 회귀 검사를 유지했으며 이전 PR에서 직접 검토했다. 별도 360×800·문자 200% 및 390×600·합성 safe area 캡처도 root가 열어 확인했다. 짧은 화면에서는 앱 영역을 스크롤하고 Dock을 유지하므로 화면 밖 항목은 스크롤로 접근한다.

원본과 다른 점: 직접 작성한 SVG 아이콘은 세부·재질이 단순하다. 사진은 프로젝트용 생성 풍경이며 달력은 일정 없음으로 표시한다. 원본의 검색 대신 페이지 점과 재잠금 버튼을 제공하고 하단 여백은 웹 viewport에 맞췄다. 배경·사진·아이콘은 로컬 자산이며 출처와 생성 프롬프트는 [홈 자산 기록](../../docs/assets-home.md)에 있다. Apple의 이미지·폰트를 앱 자산으로 복사하지 않았다.

실제 Chromium touch 검사에서 자식 아이콘의 implicit pointer capture를 부모 페이지로 옮기는 순간 발생한 `lostpointercapture`가 정상 드래그를 취소하는 문제를 찾았다. 부모 자신의 capture 손실에만 취소하도록 고쳤으며 다시 실제 touch 페이지 이동을 통과했다. WebKit의 버튼 Tab 탐색은 명시적 `tabIndex=0`으로 확인했다. 글자 확대 때 위젯 최소 높이를 글자 크기에 맞추고 라벨 줄바꿈을 허용해 달력 겹침을 없앴다.

## 시각 기준 등록 이유와 고정 조건

홈은 #4의 최소 도착 패널을 대체하는 새 제품 화면이므로 새 `home-{1,2}-{크기}.png` 기준을 등록한다. 잠금 기준은 변경하지 않는다. 시간은 2026-10-23 09:41, locale `ko-KR`, timezone `Asia/Seoul`, 앱 순서·배경·페이지를 고정한다.

초기 WebKit 일반 검사에서 사진 하단의 미세한 축소 렌더링 픽셀 차이를 발견했다. 캡처 전에 `reducedMotion: reduce`와 이미지 `decode()` 완료를 고정하고 전환이 없는 정지 장면을 촬영한다. 기존·새 이미지를 직접 비교했고 경계·배치는 같으며 사진 질감에만 차이가 있었다. 애니메이션의 합성 경로에 따른 축소 렌더링 차이로 추정한다. 구현 담당자는 새 context로 세 크기를 각각 3회 별도 실행해 전체 RGB 픽셀 차이 0을 확인했고 root의 일반 회귀 재실행도 통과했다. 이 조사자는 구현 담당자이므로 최종 독립 리뷰와 구분한다. 허용 오차 0과 마스크 없음은 유지했다. macOS WebKit 첫 페이지 360/430 기준만 새 정지 조건으로 바꿨으며 나머지 홈 기준은 그대로 통과했다. 일반 동작 검사는 기본 모션과 reduced motion을 모두 실행한다.

실제 iPhone Safari·iOS Simulator는 미검증이다. 공식 자료는 `apple-home-screen-image`, `apple-lock-screen-image`, `apple-unlock`; 코드 구조 참고는 `macos-portfolio`, `bymanos`, `ios27-design-system`이다.

## Linux 실행과 캡처

정지 조건을 고정한 소스 `0ff257a399705b8b7366072087d11f2dad283613`의 [run 39937912116](https://github.com/nam9nine/yaku_IPhone/actions/runs/39937912116) 첫 시도는 Ubuntu Azure 미러 다운로드 중 15분 제한으로 취소됐다. 브라우저 검사는 실행되지 않았으며 성공으로 기록하지 않았다. 같은 SHA의 두 번째 시도에서는 품질 검사와 동작 74개, 기존 잠금 회귀 6개가 통과했다. 홈 12개는 Linux 기준 누락으로 실패해 직접 검토할 캡처를 생성했다.

artifact `12494859474`의 ZIP SHA-256 `a27328378b7fc44c7c711c6d4c895d96da04fe1cf5e35eeed77e87b5a6bb004b`를 확인하고 실제 capture.png 12개만 추출했다. root가 두 페이지·세 크기·두 엔진 모두 직접 열었다. 위젯·아이콘·라벨·Dock과 페이지 표시가 보이며, Linux WebKit의 가는 숫자 글꼴·사진 축소 재질 차이는 플랫폼별 기준에 보존한다. 추적 위치는 `tests/visual/baselines/linux/{chromium,webkit}/home-{1,2}-{360x800,390x844,430x932}.png`다. 최종 SHA의 Linux 일반 회귀는 필수 browser job에서 별도 판정한다.
