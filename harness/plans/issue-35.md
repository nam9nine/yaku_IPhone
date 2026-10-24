# Issue 35 — WebKit 제스처 검사의 시간 조건

Issue #33의 PR 검사는 통과했으나 Pages의 WebKit 입력 전달 지연으로 빠른 스와이프 두 건과 진행형 카드 크기 검사 한 건이 실패했다. 제품 소스·시각 기준·임계값은 유지하고 검사 입력을 재현 가능하게 만든다.

1. 실패 trace의 move/up 호출 간격과 geometry 관찰 시점을 확인한다.
2. Playwright Clock을 탐색 전에 설치하고 빠른 입력에서만 시간을 정지한다. 네이티브 move와 up 사이 16ms를 진행하며 trusted 입력과 실제 Event.timeStamp를 검증한다. 느린/정지 입력은 기존 경로를 유지한다.
3. PC 중간→끝 카드 검사는 고정 180ms 대신 실제 폭이 감소할 때까지 기다린다. 최종 홈 복귀와 프레임 경계 검증을 유지한다.
4. 관련 경로 반복, 전체 품질·동작·시각 비교, 독립 리뷰 후 필수 gate를 거쳐 병합한다. Pages 배포 및 Issue #33의 공개 동작까지 확인한다.

참고: [Playwright Clock](https://playwright.dev/docs/clock). 시간 API는 테스트에서만 제어하며 제품에 검증용 분기를 추가하지 않는다. 이 문서는 계획이며 통과 기록이 아니다.
