# 답장 알림과 수신음

알림 구독은 전달 성공을 뜻하지 않는다. 사이트는 새 답장이 실제 표시되는 시점에 읽지 않은 배너를 만든다. 푸시 권한이나 구독이 있어도 배너를 미리 지우지 않는다. 현재 열어 둔 대화는 읽은 것으로 처리하고 배너 없이 수신음만 낸다. 알림 센터·암호 화면에 가렸거나 페이지가 숨겨진 동안에는 배너의 6초 표시 시간이 소진되지 않는다.

홈·설정으로 이동해도 페이지 자체가 보이면 상태 조회는 계속한다. 대화 상대 활성 상태와 브라우저 가시성을 분리했으며 실제로 숨겨진 페이지에서만 느린 조회를 사용한다.

Web Push는 별도 경로다. Service Worker는 유효한 새 push마다 OS 알림을 표시한다. [WebKit의 userVisibleOnly 요구](https://webkit.org/blog/12945/meet-web-push/)에 따라 앱이 열려 있다는 이유로 `showNotification`을 생략하지 않는다. 앱과 Service Worker가 작업 ID별 소리 소유권을 같은 IndexedDB의 readwrite 트랜잭션으로 확보한다. 앱이 먼저 재생하면 뒤늦은 OS 표시는 `silent: true`이고, OS 경로가 먼저 확보하면 기본 OS 소리를 요청하며 앱은 소리를 반복하지 않는다. 여러 창에서도 한 경로만 소유권을 얻는다. 표시 실패나 재생 전 페이지 숨김·초기화로 취소되면 해당 소유권만 해제한다. 보이는 페이지가 있다는 이유만으로 OS를 무음 처리하지 않으므로 사용자 활성화 전이나 오디오 중단 상태에도 OS 소리를 요청할 수 있다. 소유권은 소리 재생 또는 OS 소리 요청을 뜻하며 사용자가 실제로 들었다는 증거는 아니다. OS 알림 표시가 실패한 순간 이미 다른 경로가 소리를 포기했다면 소리가 누락될 수 있으나 배너·원문 전달은 유지한다.

웹 표준의 [NotificationOptions](https://notifications.spec.whatwg.org/#dictdef-notificationoptions)에는 사용자 지정 사운드 파일을 고르는 항목이 없다. 따라서 이 사이트의 수신음을 iPhone 잠금 화면 알림음으로 강제 설정할 수 없다. 앱 제어센터의 무음·음량은 사이트 수신음에 적용된다. OS 알림 소리는 기기의 알림 설정·집중 모드·무음을 따르며 앱의 가상 음량을 OS 설정으로 바꾸지는 않는다. 실제 iPhone 알림 확인과 데스크톱 WebKit 검사는 구분한다.

## 사이트 수신음

사용자 요청으로 Apple의 실제 **Note** 원본을 사용한다. macOS에 설치된 `ToneLibrary.framework/Versions/A/Resources/AlertTones/Modern/Note.m4r`를 `afconvert -f WAVE -d LEI16`로 PCM 디코딩해 `public/audio/iphone-note.wav`로 제공한다. 합성·재작곡하거나 음높이·속도를 바꾸지 않았다. 확인일 2026-10-27, Apple 소유 시스템 음원이며 오픈소스 라이선스라고 표시하지 않는다. iPhone에서 직접 추출한 파일이나 모든 iPhone의 현재 기본 설정이라고 주장하지 않는다. [Apple 문자 알림 설정](https://support.apple.com/en-ie/guide/iphone/iph62faab6a4/27/ios/27)은 문자 수신음을 선택하는 기능을 설명한다.

도착 전에 사용자 동작으로 context와 음원을 준비하고, 새 답장이 실제 표시될 때만 한 번 재생한다. 앱 열기·읽음·재조회는 재생 이벤트가 아니다. 페이지 중단 후 2초 이상 지난 전달을 복원할 때는 배너·원문만 복원한다. 중단·숨김·종료·음원 길이 만료 시 활성 음원을 정지·연결 해제하며, 다음 터치의 resume 전에 남은 음원도 폐기한다. AudioContext의 시간이 멈춰도 실제 시간 타이머가 오래된 예약음을 정리한다.

무음·음량 0·숨김 때 지난 수신음은 나중에 재생하지 않는다. 사용자 터치 없이 브라우저가 차단한 소리는 강제로 재생하지 않는다. 잠금 화면 OS 알림음은 기기 설정을 따른다.

답장 작성 말풍선이 시작되면 해당 요청 문자는 `읽음`으로 표시하고 답장 후에도 유지한다. 이는 캐릭터 채팅의 연출 상태이며 실제 사람이 확인했다는 의미가 아니다. 전송 실패 표시는 덮어쓰지 않는다.

## 오디오 재개 근거

WebKit의 [공식 interruption 회귀 검사](https://github.com/WebKit/WebKit/blob/main/LayoutTests/webaudio/audiocontext-state-interrupted.html)는 `resume()`이 중단 종료까지 기다리거나 재생 가능 상태로 돌아오지 않을 수 있음을 다룬다. [WebKit의 사용자 제스처 설명](https://webkit.org/blog/6784/new-video-policies-for-ios/)에 명시된 `touchend`·`click`·`keydown`에서도 context 활성화를 시도한다. 이는 기존 `pointerup`에 더한 호환 경로이며 실제 iPhone 검증을 대신하지 않는다.

한 번의 `running` 확인은 이후 상태를 보장하지 않는다. 따라서 새 수신 이벤트에서 재개 결과를 확인하고, 소리 소유권 획득 뒤에도 현재 가시성과 상태를 다시 확인한다. OS가 재개를 허용하지 않거나 중단이 길면 사이트 소리는 생략하고 배너·대화 본문은 계속 표시한다.

## 검증 구분

브라우저 테스트의 권한·푸시 제공자·API는 모의 환경이다. 보이는 사이트의 배너·읽음·소리 생성·중복 방지와 실제 Web Audio 노드 생성은 확인하지만 OS 잠금 화면이나 스피커에서 사용자가 들은 소리까지 검증했다고 기록하지 않는다. Service Worker 검사는 표시 실패를 성공으로 저장하지 않는지, 초기화 뒤 이전 구독 알림을 차단하는지도 별도로 확인한다.

## 대화 안팎의 수신음

현재 보고 있는 상대의 새 답장은 `ReceivedMessage`, 홈·다른 앱·다른 대화에서의 새 답장은 기존 `Note`로 구분한다. 선택은 도착 시점의 읽음 상태로 고정하며 알림을 눌러 들어온 동작이 음원을 바꾸거나 다시 재생하지 않는다. 두 음원은 별도로 준비하고 선택한 음원만 준비되면 재생한다.

`ReceivedMessage.caf`는 Apple ToneLibrary의 실제 시스템 음원으로, 원본 PCM을 WAV에 담았다. 출처·해시는 `references/iphone-conversation-sound-source.json`에 기록했다. 이는 웹 페이지가 소리를 담당할 때의 구분이며, OS Push 경로가 먼저 소리를 맡으면 기기 설정음이 사용될 수 있다. 잠금 화면의 음원을 웹에서 강제하지 않는다.

보내는 말풍선은 [Apple이 설명하는 iMessage의 파란 말풍선](https://support.apple.com/guide/iphone/about-imessage-iph4e9799206/ios)을 참고해 기존 `--app-accent` 토큰을 사용한다. 실제 iMessage 서비스 연결을 의미하지 않는다.

## Issue 99: 전송음과 설치 앱 전경 전달

사용자가 유효한 새 문자를 보내면 같은 `ReceivedMessage` 음원을 한 번 재생한다. 사용자 요청의 ‘그 소리’를 재사용한 것이며 iPhone 고유 전송용 음원으로 새로 추출했다고 표시하지 않는다. 빈 입력·중복 제출·실패 재조회는 새 전송음을 만들지 않는다.

Push는 보이는 페이지에 최대 1.2초간 재생 기회를 준다. 페이지가 사용자 활성화된 AudioContext, 음원 준비, 현재 구독과 가시성을 확인하고 원자적인 claim을 확보한 뒤 시작한다. 실패·시간 초과·무응답이면 Worker가 기존 OS 소리 경로를 시도한다. 실제 claim 없이 화면이 보인다는 이유만으로 OS 알림을 무음 처리하지 않는다. 같은 작업의 후속 polling과 여러 창은 claim으로 중복음을 막는다. `showNotification`은 계속 실행한다.

[W3C Audio Session 초안](https://www.w3.org/TR/audio-session/#audio-session-types)의 짧은 알림용 `transient`를 지원할 때 사용한다. 미지원이면 기존 AudioContext 경로를 유지한다. 음악용 독점 `playback`으로 고정하지 않는다. 기기 무음·집중 모드·OS 알림 설정은 이 변경으로 강제 해제하지 않는다. [WebKit의 iOS 홈 화면 앱 설명](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)처럼 설치 앱의 Push는 OS 알림 설정을 따르는 별도 경로다.

새 비동기 전송·Push 재생도 숨김, 무음/0음량, 같은 창·다른 창 대화 초기화, 컴포넌트 해제 시 취소한다. 모델 요청이나 문자 입력은 이 알림 변경으로 수집·수정하지 않는다. 실제 iPhone의 설치 앱·스피커 음향은 미검증이며 브라우저 테스트는 실제 오디오 버퍼 시작과 중복·취소 흐름을 확인한다.

## Issue 101: 채팅방에서는 사이트 배너와 OS Push 억제

어느 연락처의 채팅방을 보고 있어도 사이트 상단 배너를 즉시 숨기고 폐기한다. 다른 상대의 읽지 않은 상태와 수신음은 유지하며, 방을 나가도 지나간 배너를 되살리지 않는다.

[WebKit의 userVisibleOnly 설명](https://webkit.org/blog/12945/meet-web-push/)에 따라 이미 도착한 Push의 `showNotification`을 생략하지 않는다. 대신 서버가 발송하기 전에 기기별 전경 상태를 사용한다. 기존 인증된 `/v1/push/subscriptions` POST의 `presence` 요청으로 구독·창 ID·순번·활성 상태를 보낸다. 열린 채팅방에서는 10초마다 갱신하며 서버 lease는 25초 뒤 만료된다. 해당 구독의 lease가 살아 있는 동안 아직 보내지 않은 outbox를 유예한다. 다른 기기의 구독에는 영향을 주지 않는다.

UI의 실제 답장 도착 이벤트에서 job ID를 전달 확인으로 보낸다. 서버는 같은 방문자의 완료된 IF 요청만 확인하고 `foreground_receipts`에 남긴다. 이것은 사람의 읽음 기록이나 모델 기억이 아니다. 확인된 답장은 방을 나가도 OS Push로 재발송하지 않는다. 오래된 순번도 유효한 전달 확인은 멱등하게 누적하며, lease 활성 상태만 순번으로 비교한다. frontend 확인 대기열도 같은 connection 내 화면 전환에 걸쳐 유지한다.

숨김·페이지 종료·대화방 나감은 keepalive로 비활성을 보낸다. 종료 요청이 유실되면 lease 만료 후 미확인 답장은 정상 Push로 돌아간다. 브라우저/네트워크가 갱신하지 못하면 열린 화면에서도 25초 후 정상 Push가 가능하다. 진입 직전에 이미 provider로 전송된 알림을 회수하거나 OS 배너를 절대로 차단한다고 보장하지 않는다.

입력창 하단은 높이 차이만 의존하지 않고 입력 폼의 `focus-within`에서도 footer와 중복 safe area를 제거한다. 전송 버튼에 포커스가 이동해도 유지한다. 입력을 떠나면 기존 하단 제스처 영역이 복구된다.
