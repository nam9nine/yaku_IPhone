# Issue 101 검증

2026-10-27 macOS arm64 / Node 24.22.0 / Playwright 1.64.1.

- 수정 전 WebKit: innerHeight와 visualViewport 모두480, safe area34 조건에서 실제 입력 폼 아래82px 재현(검사 실패).
- 수정 후 같은 조건·resize 전·설치 앱 상태바/offsetTop24에서 폼 아래4px 이내, 전송 버튼 포커스에서도 밀착, blur 후44px 제스처 복구.
- Chromium/WebKit 관련16개 첫 통과. OS 억제 연결 후 입력/배너/전송/전경 POST·도착확인/나감14개 통과. ACK 큐 보완 뒤 전경 연결 영향2개 재검사 통과.
- Python push+server41개 통과: 전경 유예, 실제 도착확인, 종료 후 새답장, lease만료, 오래된ACK, 다른방문자/기기격리, HTTP인증·순번.
- 타입·변경파일 ESLint·production build·harness 통과. CLI 테스트 실행 경로와 테스트용 time import 오류를 수정한 뒤 재실행했다.

주 에이전트가 standalone-offset-webkit과 resized-layout-chromium 캡처를 직접 열어 입력창 아래 빈 띠 제거·버튼/본문 잘림 없음을 확인했다. 테스트는 실제 iPhone 키보드가 아니라 geometry를 재현한다. OS Push provider는 CPU/mock sender로 검증했으며 실제 iPhone 배너는 직접 확인하지 못했다.

독립 리뷰의 stale sequence ACK 소실 지적을 수정했다. presence 순서와 실제 전달확인 저장을 분리하고 frontend ACK 재시도 큐를 같은 connection에서 유지한다. 이미 provider에 발송된 Push는 회수하지 못한다. 네트워크 단절 시 lease만료 후 Push를 보장하는 방향이며 영구 무음으로 만들지 않는다.

사용자가 CI 없이 빠르게 요청했다. CI와 전체시각baseline 검사는 생략하며 기존 baseline은 변경하지 않는다. 최종 SHA·독립 리뷰·배포 결과는 PR/Issue에 기록한다.
