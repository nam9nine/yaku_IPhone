# Issue 97 메시지 하단 이동·음원·색상

2026-10-27 KST, macOS arm64, Node24.22.0, Playwright1.64.1. 사용자 요청으로 CI를 생략하며 로컬 확인 후 기존 main 전용 build/deploy를 사용한다.

- 전송/답장 추가뿐 아니라 typing false→true에서도 맨하단 이동한다. 숨겨진 앱은 scroll 계산을 건너뛰고 active 복귀 시 실제 크기로 계산한다.
- 상단/알림센터의 대화 열기 counter는 과거 저장 위치보다 최신 답장을 우선한다. 일반 이전이력 prepend는 기존 anchor를 유지한다.
- 현재 상대 답장은 실제 Apple ReceivedMessage(0.517642초), 밖의 답장은 기존 Note(4.4초)를 선택한다. arrival에서 음원 선택을 고정하므로 진입 클릭으로 소리를 재생하지 않는다. 원본 CAF/WAV PCM 동등성은 독립 리뷰에서 확인했다.
- outgoing 말풍선·전송 화살표는 기존 light/dark iOS blue 토큰을 사용한다.

실행 결과:

- 타입 검사 통과. 첫 작성 중 검사에서 새 테스트 helper 이름 오타(sendButton)를 지적해 기존 send helper로 수정했다.
- 관련 단위 `replySound.test.ts`, `messenger.test.ts`:44개 통과.
- production build 및 관련 Chromium/WebKit30개 통과(33.3초): 긴 대화 전송/typing/완료 하단 간격≤1px, 말풍선 전체 노출, 360×800/390×844/390×420/430×932, 알림 진입 하단 이동, 기존이력 더보기, 실제 디코딩 버퍼 길이로 안팎 음원 확인, 중단/취소 경계.
- 실제 캡처 typing-scroll 두 엔진 및 notification-open 화면을 직접 열어 파란 말풍선과 작성/답장 영역이 잘리지 않음을 확인했다.
- 독립 리뷰 review83은 추가 차단 문제 없음. source/PCM와 캡처를 확인했다. 정확 SHA·추가 검사·배포 결과는 PR/Issue에서 연결한다.

검사 API는 모의 환경이며 실제 스피커 청취·iPhone Safari/Chrome 실기기·OS Push는 미검증이다. OS가 소리 소유권을 먼저 얻는 경우 기기 설정음이 사용된다. CI·전체 시각 회귀는 실행하지 않았으며 기존 기준 이미지를 자동 갱신하지 않았다. 파란 UI로 바뀐 장면의 전체 환경별 baseline 검토는 후속 회귀 검사 시 필요하다.
