# Issue #22 탐색·스크롤·모션 검증

[Issue #22](https://github.com/nam9nine/yaku_IPhone/issues/22), [PR #23](https://github.com/nam9nine/yaku_IPhone/pull/23). 최종 SHA와 실행 결과는 PR의 `harness-evidence`에 연결한다.

## 요구와 구현

- 최근 앱이 처음부터 비었거나 마지막 카드를 닫으면 약한 8px 블러를 700ms 동안 나타냈다가 홈으로 복귀한다. 빈 화면 뒤의 중복 20px 블러를 제거했다. 조기 닫기·재진입 시 이전 타이머를 취소한다.
- 제어 센터의 빈 영역은 탭으로 닫는다. 버튼·입력·슬라이더·상세 패널은 제외하고, 가로 드래그·취소·blur·resize는 탭으로 취급하지 않는다. WebKit에서 preventDefault 뒤 click이 생략될 수 있어 실제 pointer 시작/이동/끝도 추적한다.
- 설정 목록만 세로 스크롤로 전환했다. 문서와 홈은 고정하고 설정 화면별 scrollTop을 유지한다. 설정·Safari의 왼쪽 가장자리에서 오른쪽으로 미는 기존 탐색은 한 단계만 돌아가며 최초 화면에서는 유지한다.
- 패널 종료는 200ms opacity 전환, 드래그 시각 갱신은 requestAnimationFrame으로 묶는다. 예약 프레임·종료 타이머·애니메이션은 중단 시 정리한다. 시스템 및 앱의 동작 줄이기는 존중한다.

## 실행과 직접 검토

macOS 26.5.2 arm64, Node24.22.0, Playwright1.64.1의 Chromium·WebKit에서 production build를 검사했다. `npm run check`, `test:e2e`, `test:visual` 로그는 `.tooling/issue22-final-check.log`, `.tooling/issue22-final-e2e.log`, `.tooling/issue22-final-visual.log`에 있다. 로컬 전체 동작242개·시각62개가 통과했고 마지막 CSS 보완 후 system56개도 통과했다. 최종 SHA의 Linux 결과는 PR 필수 검사로 별도 확인한다.

시각 장면은 기존 62개를 유지한다. 설정 메인 세 크기·다크 큰 글자·설정 미리보기가 포함된 최근 앱 세 크기, 양 엔진 총14개 기준이 변경된다. 설정의 가로 페이지 푸터 제거·자연스러운 행 높이와 미리보기 동기화가 이유다. 나머지48개는 그대로다. 허용 오차나 baseline 플랫폼 구분은 변경하지 않았다.

조정 에이전트와 구현하지 않은 `agent:/root/empty_panel_review`가 변경 장면과 기존 기준을 직접 열어 비교했다. 비교할 iOS 스타일은 `apple-app-switcher-image`·`apple-control-center-image`와 `docs/ios-system-design.md`를 따른다. 빈 목록의 시간·설정 세로 스크롤·배경 탭은 이번 사용자 요구다.

독립 검토에서 앱 동작 줄이기 누락과 예약 rAF cleanup을 지적해 보완했다. 부모 opacity가 backdrop root를 만들어 약한 blur가 보이지 않는 문제는 기존 장면 filter의 0→8→0 전환으로 보완했다. 알림 배경은 원래 선명하므로 닫힐 때 역으로 흐려지지 않도록 예외 처리했다. Chromium native touch에서 설정 본문 scrollTop 0→168, document.scrollY0, 가장자리 뒤로 복귀 및 앱 재진입 후168 복원을 확인했다. WebKit은 desktop wheel/pointer 및 키보드 대체 입력으로 구분했다. 두 엔진에서 일반 모션의 빈 목록 자동 복귀·제어 버튼 유지·빈 공간 닫기·작은 화면 상세 유지·단계별 Escape를 직접 실행했다.

초기 WebKit 빈 공간 tap 검사 실패는 pointer tap 추적으로 해결했다. 종료 모션 추가 후 기존 검사는 배경 앱의 visibility만 확인해 너무 일찍 Alt+Home을 입력했으므로, 실제 패널 제거를 확인한 다음 입력하도록 바꿨다. 기다리는 시간을 임의로 늘리거나 assertion을 삭제하지 않았다.

Linux 첫 실행에서는 동작241/242가 통과하고 Chromium의 합성 스크롤 입력 한 건이 실패했다. trace의 목록은 실제로 넘쳤지만 scrollTop이0으로 남았다. CSS 원인이라고 단정하지 않고, 실험적 synthesizeScrollGesture를 프레임별 native touchStart/Move/End 입력으로 바꾸고 실제 hit target·overflow를 확인하도록 했다. scrollTop을 직접 설정하지 않으며 기존 스크롤·복원 assertion은 유지한다. 정확한 입력 누락 원인은 확정하지 않았고 최종 Linux 결과로 재검증한다. Linux 변경14장도 기존 기준과 직접 비교·독립 승인 후 등록했다.

## 제한

실제 iPhone Safari와 실제 기기의 프레임 속도는 미검증이다. 모션의 입력·상태 전이와 데스크톱 브라우저 실행을 확인했으며 모든 기기에서 렉이 없다고 보장하지 않는다. 기본 iOS 외형과 이번 사용자 지정 동작을 구분한다. main 배포와 공개 URL 검증 결과는 완료 후 Issue에 남긴다.
