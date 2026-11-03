# Issue 136 — 아이폰 통화 마이크의 오디오 세션

소유자가 iPhone Safari에서 통화 마이크를 누르면 `AudioSession category is not compatible with audio capture`가 뜨고 녹음·인식이 되지 않는다고 보고했다(2026-11-04). 데스크톱 Chrome은 정상이다.

원인: 메시지 알림음 준비가 문서 capture 단계의 `pointerup`·`touchend`·`click`·`keydown`에서 `navigator.audioSession.type`을 `auto`에서 `transient`로 바꾼다. WebKit은 `auto`나 `play-and-record` 세션에서만 마이크를 허용하므로 마이크 버튼 탭 직후의 `getUserMedia`가 매번 거절된다. Playwright WebKit에서 `transient`·`ambient`·`playback`의 같은 거절을 재현했다. 기존 e2e는 마이크와 녹음기를 가짜로 바꾸면서 이 규칙을 흉내 내지 않았고, 서버에는 iPhone에서 올라온 녹음이 없다.

1. 녹음과 Web Speech가 마이크를 쓰는 동안 세션을 `play-and-record`로 두고, 끝나면 그동안 다른 코드가 바꾸지 않은 경우에만 이전 값으로 되돌린다. 알림음 준비는 `auto`·`ambient`만 바꾸므로 녹음 중 탭이 세션을 덮지 않는다.
2. e2e 가짜 마이크가 WebKit의 세션 규칙을 따르게 하고, 수정 전 코드에서 같은 오류 문구로 실패하는지 확인한다.
3. 세션 유지·복원과 권한 실패 시 복원을 단위 테스트한다.
4. 관련 검사, 독립 검토 후 PR·병합·Pages 배포를 진행한다.

실제 iPhone에서 녹음·변환이 되는지는 소유자 기기 결과로만 기록한다. 데스크톱 WebKit 실행은 iPhone 검증이 아니다. 실제 사람 목소리·잡음에서의 Whisper 품질은 이 Issue 범위가 아니다.
