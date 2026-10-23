---
name: visual-review
description: 'yaku_IPhone의 UI 변경과 Playwright 기준 이미지 변경을 실제 캡처로 검토하고 PR의 시각 증거를 작성한다. 화면 구현, 디자인 차이 수정, baseline 갱신, UI PR 검토에 사용한다.'
---

# 화면을 직접 비교하고 증거 남기기

프로젝트 루트의 `AGENTS.md`, `docs/visual-qa.md`, `docs/harness.md`와 대상 Issue를 읽는다. `references/manifest.json`에서 비교할 공식 자료와 source ID를 확인한다. 현재 작업이 기반 화면인지 제품 잠금/홈 화면인지 먼저 구분한다.

1. 실제 변경 파일과 Issue 완료 조건을 확인한다. `src/`, 스타일, 자산, 브라우저 설정·검사 또는 baseline 변경이면 시각 검토를 수행한다.
2. 저장소의 Playwright 명령으로 production build를 실행한다. OS·브라우저·viewport·상태와 시간 조건을 고정한다. macOS와 Linux, Chromium과 WebKit 기준을 섞지 않는다.
3. 필요한 실제 조작을 수행하고 캡처한다. 캡처와 원본 reference를 이미지 뷰어로 **직접 열어** 비율·여백·타이포그래피·glass·safe area·가독성을 비교한다.
4. 차이를 수정하고 같은 조건으로 다시 확인한다. 가짜 상태바·Dynamic Island·기기 프레임은 사용자 선택에 따라 그리지 않는다. 실제 iPhone Safari 결과가 없으면 미검증으로 남긴다.
5. 최종 이미지를 저장소에서 추적할 경로에 보관한다. baseline을 변경했다면 변경 이유와 이전/새 이미지의 실제 비교를 별도 독립 검토자에게 전달한다.
6. `docs/harness.md`의 schema에 맞춰 실제 environment, 검사 명령·결과, scenes, reference ID, 이미지 경로, 관찰·차이·제한을 기록한다. UI 변경은 `npm run check`, `npm run test:e2e`, `npm run test:visual`의 통과 결과가 필요하다. 구현과 캡처가 commit된 현재 PR head SHA로 증거를 연결한다.

스크린샷 테스트 통과는 사람이 화면을 봤다는 증거가 아니다. 자신이 구현한 코드를 자신의 독립 리뷰로 승인하지 않는다. 독립 검토를 맡았다면 최종 diff·이미지·Issue 조건을 실제로 확인하고 검토 범위와 발견한 문제를 보고한다.

기반 화면에는 해당 범위의 로딩·잘림 여부만 판정하며 Apple 화면 일치도를 평가했다고 주장하지 않는다. 아직 보지 않은 이미지, 실행하지 않은 기기, 존재하지 않는 artifact, 예시 문장을 실제 성공 결과로 기록하지 않는다. 시각 검토가 필요한데 캡처할 수 없으면 이유를 남기고 증거를 미완료로 유지한다.

반환 결과는 확인한 SHA, 환경, 이미지 경로, reference ID, 수정한 차이, 남은 문제, baseline 변경 여부로 정리한다. 실제 결과를 확인한 뒤에만 PR 증거를 `pass`로 작성한다.
