# Issue 60 — 생활 앱과 연락처·캘린더 시각 기준

대상: [Issue 60](https://github.com/nam9nine/yaku_IPhone/issues/60). 기준 코드는 `dcd21cb`이며 Issue 58/PR 59에서 이미 배포한 UI를 회귀 검사에 반영한다. 앱 코드·스타일·허용 오차는 변경하지 않는다.

## 계획

- 기존 macOS Chromium/WebKit 시각 검사를 먼저 실행하여 변경 장면과 diff를 확보한다.
- 홈의 생활 앱 아이콘, 관계·메모를 제거한 연락처 목록/상세, 연도를 제거한 고정 10월 캘린더만 이전 기준과 비교하여 갱신한다.
- 음악 보관함/곡 상세, 택시 목적지/경로, 카레 재료/조리 단계의 360×800·390×844·430×932 대표 장면을 추가한다. 짧은 390×400 화면의 조리 단계도 확인한다.
- production preview는 다른 작업과 겹치지 않는 4175 포트를 사용한다. locale `ko-KR`, timezone `Asia/Seoul`, 고정 시간, reduced motion과 명시적인 색상 조건을 유지한다.
- 이전 기준·새 캡처·diff를 직접 열고 실제 관찰을 남긴다. Issue 58의 추적 캡처와 사용자 요구를 주 비교 근거로 사용하며, `apple-home-screen-image`·`idb-contacts-ios26`는 화면 구조의 보조 자료로만 사용한다.
- 기준 수용 뒤 `check`, 전체 `test:e2e`, 전체 `test:visual`을 실행한다. Linux 캡처와 최종 독립 검토는 조정 에이전트가 별도로 진행한다.

## 현재 제한

실제 iPhone Safari는 검증하지 않았다. macOS 캡처를 Linux 기준으로 복사하지 않는다. 이 계획은 실행 성공이나 독립 승인을 미리 기록하지 않는다.
