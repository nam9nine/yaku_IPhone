# Issue 35 — 제스처 검사 입력 지연

## 원인과 변경

Pages 실행 `40039189840`은 WebKit 세 건 실패, 347건 통과로 배포를 중단했다. 공개 사이트는 이전 배포를 유지했다. 실패 trace에서 빠른 입력의 move/up 명령 전달이 지연되고, PC 카드 진행 검사는 180ms 뒤 같은 폭을 읽었다. 이 결과를 성공으로 처리하거나 재시도만으로 덮지 않았다.

`releaseFastSwipe`는 탐색 전에 설치한 Playwright Clock을 입력 중에 정지한다. 네이티브 pointermove 뒤 16ms를 진행하고 pointerup을 보낸다. 두 이벤트가 `isTrusted`이며 실제 timestamp 차이가 16ms인지 검사한다. 테스트 실행기의 지연이 제품의 140ms 멈춤으로 섞이지 않게 한다. 종료 후 시계를 재개하며 테스트 probe를 제거한다. 느린 입력·실제 정지·취소 경로는 유지한다.

PC 중간→끝 카드 검사는 고정 180ms 대기 대신 폭 감소라는 기존 조건을 poll한다. 홈 복귀·최근 앱 부재·프레임 경계 검증도 유지한다. 앱 소스, 제스처 임계값, 모션 값, 스크린샷 기준과 오차는 변경하지 않았다.

## 관찰

- 수정한 빠른 입력·PC 진행 경로를 Chromium/WebKit 각 5회씩 반복한 80건이 통과했다.
- `npm run check`: macOS arm64, Node24.22.0, Playwright1.64.1에서 타입·lint·포맷·단위224·빌드·하네스 통과.
- production build의 상태바·설정·전화 수신/부재중·26장 사진·상단 패널을 두 엔진에서 조작했다. JS/CSS가 기존 제품 빌드와 일치했고 페이지/자산 오류는 없었다.
- `harness/evidence/issue-35/`의 WebKit 설정·제어 센터 캡처를 직접 열어 기존 구성과 상태바·안전 여백 유지 여부를 확인했다. 실제 iPhone Safari는 미검증이다.

독립 검토자 `/root/gesture_timing_review`는 두 엔진에서 실제 350ms 지연을 주입했다. 기존 입력은 최근 앱, 수정 helper는 홈, 실제 180ms 멈춤은 최근 앱으로 구분된 6건을 확인했다. 결과를 강제로 바꾸지 않고 시간 조건만 제어함을 검토했다. 최종 전체 검사와 SHA별 리뷰 결과는 PR의 증거 및 GitHub Actions에 기록한다.

참고: [Playwright Clock](https://playwright.dev/docs/clock). 문서가 명시한 Event.timeStamp 제어를 사용한다.
