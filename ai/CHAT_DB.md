# 대화 DB와 JSON 이관

`kiryu_ai.chat_db.ChatDB`는 Mac의 SQLite 파일을 대화 원본으로 사용한다. 모델 추론·HTTP·관리자 화면은 이 저장 계층을 함께 사용하지만 각 작업은 별도 연결과 짧은 트랜잭션을 연다. 모델 생성 동안 DB 쓰기 트랜잭션을 유지하지 않는다.

## 저장 계약

- `ChatDB(path, session_lifetime=30일)`: 스키마 1, WAL, FULL synchronous, 외래 키 활성화. 부모 디렉터리는 700, DB·WAL·SHM은 600이다.
- `issue_session(now=None)`: `{token, visitor_id}` 반환. DB에는 SHA-256 토큰 해시만 저장한다.
- `authenticate(token, now=None)`: 유효한 경우 방문자·발급 시각·최근 활동·요청 수를 반환하고 활동 시각을 갱신한다. 만료·잘못된 토큰이면 `None`이다. 만료는 대화 삭제를 뜻하지 않는다.
- `accept(visitor, character, scenario, message, request_id)`: 사용자 메시지와 작업을 같은 트랜잭션으로 저장하고 `(job, created)`를 반환한다. `(방문자, 시나리오, UUID)` 재사용은 기존 작업을 반환하며 내용·인물이 다르면 `RequestConflict`다. 방문자에게 진행 중 작업이 있으면 `VisitorBusy`다.
- `find_request(visitor, scenario, request_id)`, `get_request(job_id, visitor=None)`: 중복 요청 확인과 작업 조회. 공개 라우트는 `visitor`를 항상 전달한다.
- `begin_run(job_id, input_messages, metadata, retrieval_hits=())`: 실제 입력의 SHA-256, 사용한 메시지 ID·프롬프트/모델 버전 등 메타데이터, 검색 근거 스냅샷을 저장한다. 전체 과거 대화를 매 요청마다 복사하지 않는다. 호출자는 `metadata`에 원문 ID와 버전이 고정된 system/현재 입력 envelope를 기록해야 한다.
- `complete(job_id, reply, metrics=None)`: AI 답장·작업 완료·측정값·사용자 메시지의 모델 이력 포함 상태를 함께 커밋한다. 이미 끝난 작업을 덮어쓰지 않는다.
- `fail(job_id, code, output='', metrics=None, status='error')`: 실패 출력을 검토용 실행 기록에 보존한다. 실패 사용자/AI 교환은 모델 이력에 넣지 않는다. 공개 작업 조회에는 실패 AI 출력이 없다.
- `recover_interrupted()`: 남은 queued/generating을 interrupted로 전환한다. 공개 조회는 `status=error`, `error.code=interrupted`로 반환한다. 재생성하지 않는다. 운영 서버는 중복 실행 잠금을 확보한 뒤 한 번 호출한다.
- `history(visitor, character, scenario)`: 모델에 전달 가능한 정상 교환만 순서대로 반환한다.
- `history_page(..., cursor=None, limit=50, include_failed=True)`: 최근 페이지를 시간 순서로 반환하고 이전 페이지 cursor를 제공한다. 실패 사용자 문자는 보이지만 실패 AI 출력은 보이지 않는다. cursor는 대화 범위·조회 방식에 묶인 HMAC 값이며 다른 방문자/인물/시나리오에 재사용할 수 없다.

원문 메시지의 내용·ID·범위·순서·시각 수정과 삭제는 SQLite 트리거가 막는다. `model_eligible`은 완료 커밋 때만 갱신한다. 최초 시간 정보가 없는 이관 메시지는 `time=null`을 유지한다. 전달·읽음 상태를 추정하지 않는다.

## 소유자 전용 조회

아래 메서드는 공개 API에서 노출하지 않는다. 접근 제어와 Host/Origin·CSRF 검사는 별도 관리자 서버 책임이다.

- `review_queue(...)`: 인물·방문자·날짜·내용·미검토·오류·모델·프롬프트 필터, offset/limit. 기본 순서는 오류→20초 초과→미검토이며 `random_sample=True`로 일반 표본을 고른다.
- `request_detail(job_id)`: 원문 대화, 실행 메타데이터·실패 출력, 검색 근거, 검토 기록.
- `save_review(...)`: 여섯 축 `speech/judgment/relationship/knowledge/context/format`에 각각 `problem/partial/appropriate/unrated`를 기록한다. 검토자·태그·원인·메모·개선 답안은 원문과 분리한다.
- `export_cases(job_ids)`: 원문·근거·검토를 반환한다. 세션/auth/settings 테이블은 조회하지 않으며 `training_eligible=false`가 기본이다. 높은 평가나 개선 답안은 학습 승인으로 바뀌지 않는다.

메타데이터·오류 코드에는 토큰이나 관리자 비밀값을 넣지 않는다. 사용자 출력과 HTTP upstream 예외의 원문을 시스템 로그에 쓰지 않는다.

## 기존 기록 이관

기존 writer를 중지하고 `web-sessions/`를 권한 700의 별도 snapshot 디렉터리에 복사한 다음 수행한다. importer는 원본을 수정하지 않으며 복사본이 조용한 상태라는 명시적 확인을 요구한다.

```sh
PYTHONPATH=ai python -m kiryu_ai.import_chat \
  --database references/local/chat/state/chat.sqlite3 \
  --snapshot references/local/chat/legacy-snapshot \
  --quiescent-snapshot
```

`auth.json`, `jobs/*.json`, `history/*.json`을 읽는다. 유효 토큰 해시와 방문자 ID를 보존하고, 성공 메시지 ID·순서·내용 해시를 유지한다. 이전 job 파일에 반복 저장된 전체 이력은 해당 job의 교환만 추출해 중복 제거한다. ID가 없는 CLI 형태 이력은 범위·원래 위치·내용에서 안정적인 ID를 만들고 request 출처는 알 수 없는 상태로 남긴다. 같은 글을 여러 번 말한 경우 내용만 같다는 이유로 합치지 않는다.

완료된 이력 쌍이 있는데 job 갱신만 누락된 경우 해당 원본 쌍으로 완료 상태를 복구한다. 그 외 미완료 작업은 interrupted로 가져온다. 원래 기록하지 않은 모델 버전·실패 출력·측정값은 만들지 않는다.

`import_records`에 상대 출처 키·내용 해시·결과를 저장한다. 동일 snapshot 재실행은 행을 늘리지 않는다. 내용이 바뀐 출처, 소유권·메시지 충돌, 잘못된 자료는 source 단위로 롤백하고 conflict로 기록한다. conflict 보고에는 원문·토큰을 넣지 않는다. conflict가 있으면 CLI 종료 코드는 1이며 원본과 보고를 검토해야 한다.

## 백업

`db.backup(private_directory)`는 SQLite Backup API와 `quick_check`로 일일본과 주간본을 만든다. 최근 7일일본·4주간본만 남기며 같은 날짜 재실행은 해당 날짜 사본을 갱신한다. 원문 DB는 자동 삭제하지 않는다. 서버 운영 스케줄러가 일일 실행을 담당한다. WAL 파일을 제외한 DB 파일만 `cp`하는 방식은 사용하지 않는다.

복구할 때는 writer를 중지하고 검증한 사본을 새 경로로 열어 행 수·최근 작업·대화 범위를 확인한 뒤 운영 DB 경로를 전환한다. 현재 파일을 실행 중인 상태에서 덮어쓰지 않는다.
