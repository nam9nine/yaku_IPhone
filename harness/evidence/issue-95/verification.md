# Issue 95 수신 시점·원본 음원·읽음 표시

2026-10-27 KST, macOS arm64, Node 24.22.0, Playwright 1.64.1.

사용자의 명시적인 `ci 검사하지말고 빠르게` 요청에 따라 이번 PR의 CI는 생략한다. 실제 수행한 로컬 검사와 독립 리뷰만 기록하고, CI를 성공으로 가장하지 않는다. 배포는 기존 main 전용 `local_verified: true` 빌드·발행 경로를 사용한다. 정확한 SHA·PR·배포 결과는 Issue/PR에 연결한다.

## 수정

- 중단된 AudioContext의 예약음은 다음 터치로 재개되기 전에 폐기한다. statechange·숨김·종료·실제 시간 만료에도 source.stop/disconnect를 수행한다. 페이지가 멈춰 2초 이상 지난 전달을 앱 재진입 시 복원할 때는 소리를 새로 예약하지 않는다.
- Apple 로컬 Note.m4r를 PCM WAV로 디코딩하여 실제 음원을 사용한다. 원본/산출물 해시·변환은 `references/iphone-note-source.json`에 기록했다. 합성음이 아니며 iPhone에서 직접 추출했다고 주장하지 않는다.
- 답장 작성 표시가 시작되면 해당 요청의 outgoing 문자를 읽음으로 표시하고 답장 뒤에도 유지한다. 실패 표시는 우선한다.
- 독립 리뷰에서 첫 fetch/decode 실패 후 영구 무음이 되는 경계를 발견했다. 다음 사용자 동작에 로드를 재시도하되 이미 지난 도착 ID는 소비된 상태로 유지한다. 무음·초기화 시 이미 재생 중인 음원도 중단한다.

## 실제 확인

- `npm run typecheck` 통과.
- 변경된 TS/TSX 파일 ESLint 통과.
- `npm test -- src/ai/replySound.test.ts src/ai/messenger.test.ts`: 43개 통과. 오래된 예약음의 statechange/unlock/expiry/hidden 취소, 로드 재시도와 old ID 재생 차단, 늦은 대화 복원 시 소리 제외 포함.
- `npm run test:e2e -- --config .tooling/arrival95/playwright.config.mjs notification-reliability --workers=2`: 최종 Chromium/WebKit 36개 통과, 34.2초. production build 성공. 실제 WAV 디코딩과 BufferSource 시작을 관찰하고, 작성 시작 전 전송됨/시작 뒤 읽음/소리 없음, 답장 도착 뒤 소리1회, 앱 재진입 시 추가음 없음 확인.
- 첫 실행은 34개 통과/새 읽음 검사2개 실패였다. 마지막 앱 재진입 단계에서 멈춘 가상시계로 rAF helper를 기다린 fixture 문제이며 `page.clock.resume()` 후 해결됐다. 제품 실패를 재시도로 통과 처리하지 않았다.
- `read-chromium.png`, `read-webkit.png`를 직접 열어 읽음·작성 말풍선이 동시에 보이고 잘림이 없음을 확인했다. 구독이 있는 홈 수신 배너도 360/390/430 폭에서 검사했다. 기존 baseline/허용오차는 변경하지 않았다.
- 독립 검토자 review83은 diff·두 캡처·음원 형식을 확인하고 위 로드 재시도 보완 후 차단 문제 없음을 보고했다.

전체 CI·전체 시각 회귀·실제 iPhone Safari/PWA·APNs 전달·스피커 청취는 이번에 실행하지 않았다. OS 알림의 소리는 기기 설정을 따른다. 정확한 실제 기기 지연 원인을 계측한 것은 아니며, 코드에서 확인된 예약음 재개 및 오래된 전달 복원 경로를 차단한 수정이다.
