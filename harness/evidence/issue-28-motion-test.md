# Issue 28 모션 검사 입력과 측정 분리

## 실제 실패와 원인

[Pages 실행 40014293791](https://github.com/nam9nine/yaku_IPhone/actions/runs/40014293791)은
main `8f7a387d47b4dca53e6b64b4dd2859383061485a`의 WebKit 모션 검사 1건에서 실패했다.
287개는 통과했으며 배포는 실행되지 않아 기존 공개 버전을 유지했다.

실패 trace의 마지막 mouseMove 종료는 262851.381ms, 두 프레임 대기 종료는
262965.706ms, mouseUp 명령은 262988.764–263032.820ms다. 화면 크기 측정과 샘플러
설치를 위한 왕복이 release를 늦춰 140ms 멈춤 조건에 도달했다. 실패 캡처에는 최근 앱
화면이 보였다. 앱이 hidden인 것만으로 Home에 도착했다고 잘못 가정한 검사였다.

## 변경과 검증 방식

제품 코드, 제스처 임계값, 애니메이션과 기준 이미지는 변경하지 않는다. 처음 170px는
native pointer 입력으로 이동하고 렌더된 폭을 읽는다. 마지막 30px와 release는 브라우저의
같은 task에서 전달한다. 실제 속도 분류는 기존 native 빠른 입력·멈춤·느린 입력 검사가
담당하고, 이 검사는 release 이후의 크기 연결을 검증한다.

실제 앱이 만든 Web Animation을 일시 정지해 0/20/40/60/80/100% 위치의 DOM 폭을 읽고
즉시 재생한다. 앱의 keyframe 계산을 테스트에서 복제하지 않는다. 시작 폭의 연결,
전체 크기 점프 없음, 단계별 축소, 아이콘 크기로의 이동을 확인한다. 마지막에는 최근 앱이
없고 실행한 홈 아이콘에 포커스가 돌아왔는지도 확인한다.

## 로컬 실행 결과

- macOS arm64, Node 24.22.0, Playwright 1.64.1, Chromium/WebKit.
- `npm run check`: 타입·lint·포맷·단위 186개·빌드·하네스 통과.
- `npm run test:e2e -- tests/browser/motion.spec.ts --repeat-each=3`: 48개 통과.
- `npm run test:e2e`: 288개 통과.
- `npm run test:visual`: 기준 이미지 변경 없이 110개 통과.
- 세부 실행 로그: ignored `.tooling/motion28-*.log`. CI 결과와 대상 SHA는 PR에 연결한다.

빌드 JS는 `index-Bm_xuPCn.js`, CSS는 `index-CRvafDq5.css`로 Issue 26과 동일하다.
[WebKit 연속 축소 캡처](issue-26/webkit-long-sheet.png)와
[Chromium 최근 앱/홈 캡처](issue-26/chromium-switch-sheet.png)를 직접 다시 열어 확인했다.
제품 코드와 화면 자료가 동일하므로 기존 시각 증거를 재사용하며 새로운 화면 비교를
수행한 것으로 기록하지 않는다. 실제 iPhone Safari, ProMotion, 기기 키보드는 미검증이다.
