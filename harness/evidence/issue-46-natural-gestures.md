# Issue 46 검증 기록

범위: [Issue 46](https://github.com/nam9nine/yaku_IPhone/issues/46). 하단 장식 막대 제거, 짧은 직선·곡선 최근 앱 제스처, 버튼 터치 누락 수정이다. 최종 검토 SHA는 PR 본문의 `harness-evidence`에 기록한다.

## 실제 실행과 실패 처리

- macOS 26.5.2 arm64, Node 24.22.0, Playwright 1.64.1. Chromium·WebKit을 구분했다. 실제 iPhone Safari·ProMotion은 미검증이다.
- 최초 관련 6개 suite 182개는 통과했다. 최신 main 통합 후 `npm run check`는 타입·lint·포맷·단위 273개·빌드·하네스를 통과했다.
- 최초 전체 E2E는 430개 통과, 4개 실패였다. 실패는 양 엔진에서 사진 위젯·헤더 버튼의 긴 하향 pull을 버튼 전체 제외가 막은 회귀였다. 실패 trace와 로그를 로컬에 보존하고 기존 검사를 유지한 채 버튼·링크 16px, 일반 영역 8px의 입력 임계 처리로 수정했다. 관련 두 suite 60개가 통과했다.
- 최종 전체 `npm run test:e2e -- --workers=2`: Chromium·WebKit 434/434 통과(4.8분). `npm run test:visual -- --workers=2`: macOS 기준을 덮어쓰지 않고 180/180 통과(36.5초).
- 최종 `npm run check`는 273/273 단위 테스트와 타입·lint·포맷·빌드·하네스를 통과했다. 직전 실행에서 기존 데이터의 truncated-gzip 테스트가 timeout/uncaught Z_BUF_ERROR로 한 번 실패한 기록은 보존했다. 동일 코드 재실행에서 통과했으며, 원인 조사는 별도 [Issue 47](https://github.com/nam9nine/yaku_IPhone/issues/47)로 분리했다. 이 PR은 데이터 코드나 검사 허용 조건을 바꾸지 않는다.

## 터치 감사

기존 production에서 설정·메시지·연락처·메모의 뒤로 버튼 및 Safari의 메뉴 닫기·주소 취소·뒤로·탭 닫기·완료를 확인했다. 버튼 안에서 아래/오른쪽으로 9px 움직인 36개 조건이 실패했다. 일반 tap은 성공했다. 상단 pull의 pointer capture와 가장자리 탐색의 click 억제가 관찰된 입력과 일치했다.

첫 수정본 감사는 back 24개, Safari·CC·전화·취소 복귀 66개, 설정의 8px·12px 경계 12개를 통과했다. 최초 초기화 timeout 1건은 보존하고 메모 6개를 다시 실행해 통과했다. Chromium 드래그는 CDP trusted touch, WebKit 드래그는 trusted mouse이며 일반 tap만 trusted touch다. 최종 pull 수정의 재검사는 브라우저 회귀 검사에 포함한다.

## 직접 본 화면과 움직임

`issue-46/`의 16개 PNG는 production build에서 Safari → 홈 → 설정을 연 뒤 360×800, 390×844, 430×932로 캡처했다. 390×844는 12·32·48px 상승을 각각 보관하고 모든 크기는 48px 상승과 놓은 뒤 최근 앱 상태를 보관했다. locale은 ko-KR, timezone은 Asia/Seoul이며 제품의 가상 시각 16:40을 사용했다.

기존 로컬 자료 `apple-app-switcher-image`, `macmost-real-gestures`의 앱 카드·이전 앱 노출을 직접 비교했다. 실제 조작 영상은 구형 iPhone의 동작 참고이며 최신 UI 치수 근거로 쓰지 않는다. `wwdc18-fluid-interfaces`의 손가락 추적·정착 원칙도 기존 설계 기준으로 유지한다. 막대 제거는 사용자 요청에 따른 의도적 차이다.

48px 상승에서 현재 카드의 가장자리, 이전 앱 일부, 앱 이름이 보인다. 390×844에서 폭은 390 → 364.63(12px) → 337.62(32px) → 323.66(48px)로 줄어든다. 양 엔진의 `geometry.json`에 실제 좌표를 보관했다. 놓은 뒤 브라우저의 실제 애니메이션을 7개 시점에서 측정한 `landing-geometry.json`은 시작 위치·크기가 놓기 직전과 같고, 폭이 323.66 → 265.19px로 단조 감소함을 보여 준다. 이는 실제 기기의 프레임 속도 측정은 아니다.

## 기준 이미지 변경

macOS·Linux 각각 기존 180장 중 168장을 변경하고 12장을 유지했다. 일반 검사는 snapshot 갱신을 하지 않으며 `maxDiffPixels: 0`을 유지한다. 변경 이유는 홈·앱·통화·패널·카드 내부에 있던 하단 막대 제거다. 제어센터·검색·최근 앱은 뒤에 비치는 막대가 사라져 블러 영역도 달라졌다.

macOS 후보는 로컬의 명시적 `--update-snapshots` 실행으로 생성했다. Linux 후보는 배포 권한 없는 임시 capture 브랜치의 [Actions 실행](https://github.com/nam9nine/yaku_IPhone/actions/runs/40080285091)에서 생성했다. 후보 생성 성공은 회귀 검사 통과와 구분한다. capture SHA는 `b48ce840811d485c6e6b1f01d2fc9081e351a594`이며 당시 구현 `9298faeaed04d3273c15aeaece2a4e10d89b914c`와 다른 파일은 임시 workflow 하나뿐이다. source/test tree 동일 여부와 artifact SHA-256 `b1166c29fe03437490be0dae9591488a2ea05d3b734abf54976467ca238e0734`를 확인했다. 임시 workflow는 제품 PR에 포함하지 않는다.

전후 이미지의 크기는 동일하다. 독립 검토자는 플랫폼별 전후 시트와 원본 픽셀을 확인했다. macOS Chromium 연락처·메시지의 작은 추가 차이는 원형 아바타 경계에 제한되며 RGB 차이는 최대 4/255였다. Linux WebKit 360의 넓은 배경 차이는 대부분 1/255이고 큰 차이는 막대 위치에 집중되었다. 이는 합성·블러 경계의 미세 렌더링 차이로 판단했으며 글자·내용·배치 변경은 보이지 않았다. 최종 독립 승인과 회귀 검사 결과는 PR에 연결한다.

## 동시 작업 보호

구현·캡처·Git 작업은 `feat/46-natural-app-gestures` 전용 worktree에서 수행했다. 기본 작업 폴더는 checkout/pull하지 않았고 다른 worktree의 미커밋 변경을 수정·정리하지 않았다. 최신 main 변경 경로와 겹치지 않는 것을 확인한 뒤 우리 브랜치에만 통합했다.
