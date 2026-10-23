# Issue 18 제스처와 고정 화면

사용자는 앱 본문까지 세로 스크롤 금지, 짧은 하단 위 스와이프는 홈, 이동 후 멈추기는 최근 앱으로 확정했다. 실제 iOS의 본문 스크롤과 다른 선택은 명시한다.

1. 공식 탐색/제어 센터/앱 전환/알림과 Pointer Events 원문을 저장하고 영역·우선순위를 문서화한다.
2. root는 shell reducer·하단/상단 gesture·viewport·Home 가로 페이지 및 통합, gesture-ui worktree는 SystemPanels, app-navigation worktree는 앱 본문 페이지화와 edge navigation을 담당한다. 독립 검토자는 구현하지 않는다.
3. 본문·홈 내용은 잘라 숨기지 않고 추가 가로 페이지와 키보드 버튼으로 도달한다. 상태 보존과 MRU/닫기, overlay 중 behind inert를 구분한다.
4. 방향·거리·멈춤은 프로젝트 실험값이며 Apple 비공개 임계값으로 표현하지 않는다. 취소·두 번째 pointer·화면 변경·숨김에서 복구한다.
5. 기존 스크롤 테스트를 Y=0/모든 내용 접근 계약으로 교체하고 Chromium 실제 touch 경로와 WebKit pointer를 구분한다. 3크기·짧은 viewport·확대 글자·입력·range 충돌을 확인한다.
6. 실제 before/after 캡처와 독립 검토 후 의도적으로 변경된 macOS/Linux 기준을 등록한다. 실패를 통과로 기록하지 않는다.
7. 현재 SHA 독립 검토·필수 gate·자동 squash·main Pages·공개 조작 확인까지 진행한다. 실제 iPhone Safari는 별도 미검증이다.
