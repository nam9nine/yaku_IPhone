# Issue 90 알림 누락과 수신음 검증

## 실행 범위

2026-10-26, macOS arm64, Node 24.22.0, Playwright 1.64.1. 격리 worktree에서 preview 포트 4194로 실행했다. 기존 기준 이미지와 허용 오차를 바꾸지 않았다. 최종 커밋 SHA와 독립 리뷰·배포 결과는 PR 증거에 연결한다.

## 관찰한 원인과 수정

- Push 구독만 있으면 `App`이 배너를 전달하지 않고 즉시 지웠다. 구독과 실제 전달을 구분해 로컬 배너를 유지한다.
- Messages 외 화면을 브라우저 백그라운드로 취급해 홈에서도 조회가 느려졌다. 실제 `document.hidden`만 조회 간격에 사용한다. 백그라운드 조회 실패 후 홈 복귀·가상 연결 복구에서도 진행 중 작업을 재조회한다.
- 알림 센터·암호 화면·숨김 상태에서 보이지 않는 배너의 6초 시간이 소진됐다. 보이는 동안만 타이머를 시작한다.
- 수신음이 읽지 않은 배너에만 연결돼 현재 대화에서는 울리지 않았다. 새 답장 표시 이벤트를 별도로 사용한다.
- 독립 리뷰에서 앱 소리 후 늦은 Push·여러 창 중복음 경합을 발견했다. 앱과 Worker는 같은 작업 ID의 원자적 IndexedDB 소유권을 사용한다. 소리를 맡지 않은 Worker도 필수 OS 알림은 무음으로 표시한다.

## 실제 검사

- `npm run check`: 타입·lint·포맷·단위 386개·빌드·하네스 통과.
- `npm run test:e2e -- --config .tooling/notify90/playwright.config.mjs notification-reliability reply-notifications push-binding push-registration --workers=2`: Chromium/WebKit 32개 통과, 42.9초. 포트·testDir만 격리한 기존 실행 설정이다.
- 검사에는 구독이 있지만 실제 Push가 없는 360×800 / 390×844 / 430×932, 현재 대화 수신음, 무음, 재접속 중복 방지, 알림 센터 가림, 합성 숨김·복귀, 홈 상태 조회, 실제 IndexedDB의 두 창 소유권 경쟁, 다른 owner 해제 차단, 소유권 대기 중 숨김·초기화를 포함한다.
- Worker 단위 검사는 앱 먼저/OS 먼저, 표시 실패 후 소유권 해제·재전달, 오디오가 준비되지 않은 foreground, 오래된 구독·동시 Push·초기화 도중 표시를 확인했다. 오디오 단위 검사는 사용자 활성화·음량 0·무음·숨김·중복 입력·중단 후 재개·노드 해제를 확인했다.
- `npm run test:visual -- --config .tooling/notify90/playwright.visual.config.mjs --grep '홈 |notifications|messages|thread' --workers=2`: 기존 macOS 기준 32개 통과, 18.7초. 홈·알림 센터·메시지 목록과 대화의 회귀 범위다.
- 원인 재현: 새 코드에서 배너 prop 하나만 이전 `pushEnabled ? null : notification` 식으로 일시 복원하여 새 390폭 검사를 실행했다. Chromium/WebKit 모두 배너 요소 없음으로 실패했다. 실험 후 소스를 복구했고 위 최종 검사에서 통과했다. 원본 커밋 전체를 실행한 실험은 아니다.
- 초반 모의 브라우저 검사의 실패는 가상 시계를 HTTP 완료·Web Audio resume 전에 진행한 fixture 경합이었다. 실제 HTTP 저장 결과와 AudioContext `running` 확인 후 시간을 진행하도록 수정했다. 재시도로 통과 처리하지 않았다.

## 직접 화면 검토

`subscribed-fallback-chromium.png`, `subscribed-fallback-webkit.png`를 직접 열었다. 메시지 아이콘·이름·본문·닫기 버튼이 잘리지 않으며 홈 상태 표시와 Dock 배치를 유지한다. WebKit의 배너 투명도 차이는 기존 CSS 표현 차이다. 새 OS 배너 원본과 픽셀 일치를 입증한 검토가 아니며 iPhone UI 전체 완성을 주장하지 않는다.

## 소리와 플랫폼 제한

클래식 iPhone Tri-Tone의 로컬 시스템 파일을 음높이·간격 참고에만 사용했다. 앱에는 자체 Web Audio 합성음을 넣었으며 원본 오디오를 복사하지 않았다. 출처·해시·측정과 표준 근거는 `docs/reply-notifications.md`에 기록했다.

브라우저 검사의 API·알림 권한·푸시 제공자는 모의 환경이다. 실제 Web Audio 생성과 상태는 검사했지만 실제 스피커에서 들은 음질, iPhone Safari/PWA 잠금 화면, APNs 실전달을 검증한 것은 아니다. OS 소리는 기기 설정을 따르며 웹에서 사용자 지정 iPhone 메시지음을 강제할 수 없다. Native 표시 실패와 다른 경로의 소리 포기가 겹치는 순간에는 소리가 누락될 수 있다. 배너·원문 표시와 소리 요청/청취 성공은 구분한다.

## 통합 검사 후 오디오 재개 보완

`7d07c95ead52f935efffed75e517a5a09cf494fa`의 전송·알림 통합 60개 검사에서는 58개가 통과하고 WebKit 2개가 실패했다. 현재 대화의 oscillator 시작 수가 0이었고, 다른 검사는 준비 단계의 `running` 조건이 성립하지 않았다. 이때 실제 AudioContext state 전환은 기록하지 않아 `suspended`·`interrupted`·오디오 장치 상태 중 원인을 확정할 수 없다. 모델 추론 병행이나 가상 시계를 원인으로 단정하지 않는다. 실패 trace는 로컬 `.tooling/notify90/integrated-audio-failures/`에 보존했다.

상태 전환·resume 요청/완료·visibility·소리 소유권 진단만 추가한 같은 60개 검사는 통과했다. 이는 간헐 실패의 해결 증거가 아니다. 별도로 확인한 구현 경계는, 새 답장이 오는 순간 오디오가 잠시 중단돼 있으면 재개를 시도하지 않고 수신음을 소비한다는 점이었다.

이를 보완해 사용자 제스처로 이미 생성한 context만 새 visible 답장에서 최대 1초 재개 대기한다. `touchend`·`click`에서도 활성화를 시도한다. 숨김·초기화·unmount·무음 변경·기한 종료 뒤의 늦은 재개는 지난 답장을 재생하지 않는다. 재개를 기다리는 동안에는 OS 소리 소유권을 선점하지 않으며, 준비된 뒤에도 OS가 먼저 확보했으면 앱 소리는 포기한다.

- 결정적 회귀: 실제 AudioContext와 oscillator를 유지하면서 resume 승인만 지연시켰다. 새 도착 재개와 숨김·초기화·무음·기한 종료 5조건 × 2엔진, 10개 통과(22.3초). 원래 간헐 실패의 물리적 원인을 재현한 실험은 아니다.
- 위 성공 회귀에서 product 2파일만 `7d07c95` 상태로 잠시 복원하면 두 엔진 모두 재개 요청 없음으로 실패했다. 실험 종료 후 새 소스를 복구했다.
- 보완 후 `npm run check`: 단위 390개 포함 통과.
- 보완 후 `npm run test:e2e -- --config .tooling/notify90/playwright.config.mjs live-ai-chat notification-reliability --workers=2`: 70개 통과(52.7초). 실패 재시도 설정은 0이다.
- 실패 시 실제 state·resume·가시성·소유권 JSON을 첨부하도록 검사를 보완했다. 첫 통합 실패의 정확한 원인은 미확정이며, 장기간의 플랫폼 중단까지 사이트 소리 재생을 보장하지 않는다. 시각 표시·전송 동작은 오디오 재개를 기다리지 않는다.

추가 독립 리뷰는 오디오 준비 후 IndexedDB 소유권 대기 중 숨김으로 취소된 도착을 지적했다. 소유권만 해제하면 복귀 후 음량 변경이 같은 도착의 소리를 다시 낼 수 있었다. 숨김→소유권 해제→복귀→음량 변경을 추가하자 두 엔진 모두 기대 0/실제 9 oscillator로 재현됐다. 취소 시 해당 도착 ID도 소비하도록 보완했다.

- 이 최종 보완 후 `npm run check`: 단위 390개 포함 통과.
- 이 최종 보완 후 `npm run test:e2e -- --config .tooling/notify90/playwright.config.mjs notification-reliability reply-notifications push-binding push-registration --workers=2`: 42개 통과(57.7초). 위 70개 통합 결과는 이 마지막 취소 보완 직전의 결과다.
- 이번 추가 수정은 오디오 수신·취소 경계이며 화면 CSS와 기준 이미지는 변경하지 않았다. 최종 커밋의 CI 및 독립 리뷰는 PR에서 별도로 기록한다.
