# Issue 81 초기화·메시지 화면 검증

설정에서 초기화를 확인하면 새 익명 세션으로 대화한다. 이전 세션의 DB 원문은 남지만
새 세션의 최근 이력·장기 기억에는 포함하지 않는다. 취소는 기존 세션을 유지하고,
초기화 경계 저장이 실패하면 확인창에서 오류를 알리고 초기화를 중단한다.

## 실제 실행

- macOS, Node 24.22.0, Playwright 1.64.1, Chromium/WebKit.
- `npm run check`: 359개 단위 테스트와 타입·lint·포맷·빌드·하네스 통과.
- `npm run test:e2e`: 496개 통과. 두 인물 새 세션·reload·세 탭 동시 재연결·저장 실패 포함.
- `npm run test:visual`: macOS 224개 통과. 문구 삭제로 바뀐 10개를 이전/이후/차이 직접
  비교하고 독립 승인한 뒤 반영했다. 최초 비교의 10개 의도된 차이는 실패로 기록했다.
- `PYTHONPATH=ai ...python -m unittest discover -s ai/tests -p test_chat_server.py`:
  CPU API/DB 14개 통과. 새 방문자 두 인물의 모델 입력에서 이전 메시지 제외,
  원래 요청·대화 관리자 조회 유지와 이전 job 접근 거부를 확인했다.
- 초기 단위 검증 29개 후 늦은 생성 결과 검증을 추가하여 관련 단위 30개 통과.
  중간 브라우저 실행의 2개 실패는 저장 객체에 추가된 `resetId` 단언을 갱신해 해결했다.

## 화면 증거

`reset-{chromium,webkit}.png`는 초기화 확인창,
`reset-error-{chromium,webkit}.png`는 저장 실패 확인창,
`fresh-{chromium,webkit}.png`는 초기화 후 기본 스토리만 남은 마지마 화면이다.
모두 390×844, ko-KR, Asia/Seoul, reduced motion, 고정 UI 시간으로 캡처했다.
응답은 테스트용 HTTP fixture이며 실제 모델 품질 증거가 아니다.

메시지의 이전 대화 표제·저장 안내를 제거했으며, 기존 말풍선·아바타·입력창 구성은
유지했다. 확인창 설명·오류·버튼과 입력창의 잘림/겹침을 발견하지 못했다.
인물 카드와 기본 원작 RAG·스토리 시작 장면은 초기화 뒤에도 유지된다.
실제 iPhone Safari는 검증하지 않았다. 공개 서비스 동작은 배포 후 Issue에 별도로 기록한다.

Linux 최초 CI `40283006449`에서는 동작 496개 통과, 시각 214개 통과와 의도된 문구
삭제 차이 10개를 확인했다. artifact `12633805477`의 실제 expected/actual/diff 30장을
독립 검토한 후 Linux 기준 10개를 승인 해시로 반영했다. macOS/Linux 합계 20개의
이전·이후 해시와 검토 범위는 `baseline-review.json`에 있다. 최종 PR CI 결과는 PR에서 확인한다.
