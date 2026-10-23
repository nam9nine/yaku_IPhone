# Issue 14 Safari와 두 앱 통합 검증

2026-10-23, macOS 26.5.2 arm64 / Node 24.22.0 / Playwright 1.64.1. 검증 커밋은 PR 본문에 연결한다.

- 품질: 타입·lint·포맷·단위 171개·production build·하네스 통과.
- 브라우저: Chromium/WebKit 전체 140개 통과. 최초 실행의 WebKit 짧은 화면 2건은 resize 직후 이전 bounding box와 새 viewport를 섞어 읽는 검사 문제였다. 실패 캡처의 배치는 정상이며, 동일 evaluate에서 좌표·viewport·hit target을 읽고 안정될 때까지 poll하도록 수정한 뒤 전체 재실행했다.
- 시각: 최초 macOS 앱 baseline 22개를 명시적으로 생성한 뒤 일반 실행에서 기존 잠금/홈을 포함한 40개 통과. 기존 18개 기준은 변경하지 않았다.
- Linux 앱 baseline은 CI의 실제 캡처를 검토한 뒤 별도로 등록한다. 누락 중 browser/merge-gate 실패를 유지한다.

## 동작 검토

두 내부 문서·제목 검색·주소 분류·뒤로/앞으로/새로고침·탭별 history와 스크롤·마지막 탭 닫기·홈 재진입·새로고침 초기화를 확인했다. 설정의 비행기 모드와 Wi-Fi를 연결해 현재 페이지 유지, 새 이동/재로드 차단, 연결 복구 후 재시도를 검사했다. 외부 http(s)는 명시적 새 창 링크만 제공하고 iframe/프록시를 사용하지 않는다.

주소 편집은 사용자 이벤트 안에서 동기 focus해 사용자 입력 의도를 보존한다. 실제 iPhone 키보드 동작을 관찰한 것은 아니다. 페이지 메뉴는 앱 안에 표시해 하단 홈 제스처와 밝기 효과를 유지하고, 메뉴 중 홈 버튼·스와이프·재진입·Escape도 검사했다. 실제 Tab/Enter와 Alt+Home 대체 조작을 양 엔진에서 확인했다.

## 직접 시각 검토

`images/issue-14/`의 24장을 조정 에이전트와 구현에 참여하지 않은 `agent:/root/lock_home_review`가 직접 열었다. 시작·안내 화면은 360×800/390×844/430×932 양 엔진, 나머지는 390×844의 메뉴·예제·탭·외부 안내·다크+130% 글자 오프라인 안내, 주소 편집은 390×420이다. 시계 09:41, 날짜 2026-10-23, ko-KR/Asia-Seoul, reduced motion을 고정했다.

Apple의 `apple-safari-compact-image`, `apple-safari-start-image`, `apple-safari-tabs-image`와 주소 capsule·원형 조작·2열 탭·간격을 비교했다. 자체 시작 콘텐츠, 실제 페이지 미리보기 대신 제목/주소 카드, 별도 44px 홈 조작 영역은 범위에 따른 차이다. 기기 프레임·상태바·Island·가짜 홈 인디케이터는 없다. 작은 화면·큰 글자에서도 가로 넘침이나 조작 가림을 발견하지 못했다. WebKit의 오프라인 배경 blur가 Chromium보다 약하지만 전경 안내는 읽을 수 있다.

설정 baseline은 Issue 13에서 직접 검토한 목록과 화면 모드/큰 글자 장면을 포함한다. 기준 추가 이유는 완성된 두 앱의 후속 회귀 방지이며, 기존 기준의 차이를 덮어쓰는 갱신이 아니다.

실제 iPhone Safari·소프트 키보드는 미검증이다. viewport 축소 검사는 입력과 이동/취소/홈 영역 배치만 확인한다. 공개 배포와 CI 결과는 PR/Issue에 실행 후 기록한다.
