# 고정 주소의 Gemma 문자 서비스

방문자는 `https://nam9nine.github.io/yaku_IPhone/`에서 하루카·마지마 대화를 열면 된다. 별도 연결창·접속 키·초대 URL은 없다. API는 `https://yaku-iphone-chat.yaku-iphone.workers.dev`다. Mac이 꺼지거나 모델이 준비되지 않았으면 실패 안내와 재시도만 제공한다.

## 실행과 종료

저장소 루트에서 설치·인증이 끝난 기존 운영자 환경을 실행한다.

```sh
PYTHONPATH=ai .tooling/gemma/venv/bin/python -m kiryu_ai.chat_stack
```

실행기는 고정 Gemma → SQLite API → 소유자 검토 화면 → named Tunnel 순으로 시작한다. 모델 파일과 실행 파일 해시를 확인하는 동안은 준비 중이다. 이미 모델/API 포트가 사용 중이면 새 모델을 적재하지 않는다. Ctrl+C 또는 SIGTERM으로 종료하면 자신이 시작한 Tunnel·관리자·API·모델만 역순으로 정리한다. API는 진행 중인 생성이 끝나거나 제한 시간에 이른 뒤 종료한다. 비정상 종료 후에는 미완료 작업을 중단으로 기록하고 자동 재생성하지 않는다. 이 명령은 로그인 시 자동 실행을 설치하지 않는다.

실행 경로는 기본 `.tooling/gemma`, 데이터는 `references/local/gemma-chat/state`다. 다른 체크아웃에서 실행할 때는 `--tooling`, `--state`, `--cloudflare`에 기존 절대 경로를 지정한다. 여러 서비스가 같은 DB를 동시에 소유하지 못하도록 잠금을 둔다.

- 모델: `127.0.0.1:8791`, 소유자 전용 무작위 키, 단일 생성 슬롯.
- 문자 API: `127.0.0.1:8766`, Tunnel의 유일한 목적지.
- 검토 UI: `127.0.0.1:8767`, 공개 전달 경로 없음.
- 로그: 데이터 폴더의 `logs/`. 관리자 일회용 링크는 `owner.log` 마지막 실행에 있다. 공유하지 않는다.
- DB 백업: 같은 폴더 `backups/`, 일일 7개·주간 4개. SQLite Backup API로 생성하며 원문 DB를 자동 삭제하지 않는다.

## Cloudflare 고정 연결

Worker는 허용된 `/v1/health`, `/v1/sessions`, `/v1/chat`, `/v1/history`, `/v1/jobs/{uuid}`만 `CHAT_API` VPC binding으로 전달한다. 사용자 입력으로 목적지·Origin·관리자 경로를 바꿀 수 없다. VPC service는 named Tunnel `yaku-iphone-chat`의 `http://127.0.0.1:8766`으로 연결한다. Tunnel ID는 `fecdb06f-4bfc-4fdd-ab1d-1c8af451d5cc`다.

공식 [Workers VPC 시작 안내](https://developers.cloudflare.com/workers-vpc/get-started/)와 [Tunnel 조건](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/)을 확인했다. QUIC 연결을 사용하며 beta/무료 조건은 변경될 수 있다. 실행기는 유료 플랜으로 자동 전환하지 않는다.

운영자 인증 파일은 `.tooling/cloudflare/config`, Tunnel 토큰은 `.tooling/cloudflare/tunnel-token.txt`, Worker↔API 증명값은 `.tooling/cloudflare/gateway-secret.txt`에 owner-only로 보관한다. 증명값은 Worker의 `GATEWAY_SECRET` secret에도 설정한다. 파일·OAuth·모델 키를 Git, 프런트엔드, PR 증거에 넣지 않는다.

Worker 업데이트 명령은 다음과 같다. 운영자 인증과 secret은 최초 설정되어 있어야 한다.

```sh
WRANGLER_SEND_METRICS=false XDG_CONFIG_HOME="$PWD/.tooling/cloudflare/config" \
  .tooling/cloudflare/node_modules/.bin/wrangler deploy --config infra/cloudflare/wrangler.json
```

도메인 구매나 Quick Tunnel은 필요하지 않다. Tunnel 재연결로 방문 주소가 바뀌지 않는다. 공개 health와 실제 Pages 대화 성공은 각각 확인해야 한다. VPC local-ready 로그만으로 인터넷 연결 성공이라고 기록하지 않는다.

## 접수·복원·대기열

익명 세션은 30일간 비활동 시 만료하며 활동으로 연장된다. 브라우저 저장소의 토큰은 소유권 확인용이며 서버에는 해시만 저장한다. 이전 유효 토큰은 이관된 방문자로 이어지지만 과거 URL endpoint·초대 키는 읽지 않는다. 브라우저 데이터 삭제 시 새 방문자로 시작한다.

접수한 문자를 요청 UUID와 같은 트랜잭션으로 저장한다. 동일 UUID 재요청은 기존 작업을 돌려주며 다른 내용이면 거절한다. 방문자당 하나의 미완료 작업, FIFO 대기 최대 8개, IP·방문자별 접수 제한을 둔다. 생성 중 약 1초, 대기 중 점진적 간격, 숨겨진 탭은 느린 조회를 사용한다. 최근 50개 이력에서 cursor로 이전 기록을 가져온다.

정상 답장만 이후 모델 이력에 들어간다. 잘린·실패 출력은 소유자 검토에만 보관한다. 접수 전 입력 초안은 서버로 보내지 않는다. 화면의 저장 안내는 보내는 문자와 답장이 개선 검토를 위해 보관됨을 알린다. 서버 완료는 실제 읽음 여부를 뜻하지 않는다.

## 품질·성능 판정

`chat_evaluate`는 작성된 다중턴 진단을 실제 모델로 실행하고 원문 출력·최종 입력 ID·검색 근거·시드를 저장한다. 정상 종료 횟수와 말투·판단·지식·문맥의 품질은 별도다. 기존 진단을 수정에 사용했다면 개발 진단으로 표시하며 독립 벤치마크라고 부르지 않는다. 팬 검토는 사용자가 실제 답장을 확인한 뒤 별도로 기록한다.

API 측정은 대기 시간, 검색·토큰 계산을 포함한 처리 시간, 모델 생성 시간과 TTFT를 구분한다. 시스템 swap은 다른 앱도 포함한 관찰값이며 프로세스 RSS만으로 Metal 전체 메모리를 계산하지 않는다. 2·4명 동시 도착은 모델 하나와 FIFO를 사용해 별도 합성 DB에서 측정한다.
