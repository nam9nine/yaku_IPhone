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
