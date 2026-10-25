# 한국어 커뮤니티 원문 전처리

`kiryu_ai.community`는 확보한 번역 원문을 **문맥이 연결된 검수 후보**로 정리하는 오프라인 도구다. 기존 `data.py`의 `authored_if` 학습 내보내기와 별개이며, 원작 대사를 창작 데이터로 바꾸거나 기존 모델·200개 학습 파일을 수정하지 않는다. Python 표준 라이브러리만 사용한다.

```sh
PYTHONPATH=ai python3 -m kiryu_ai.community \
  --input references/local/community/documents.jsonl \
  --output references/local/community/prepared-v1
```

출력 폴더는 없거나 비어 있어야 한다. 입력과 코드의 SHA256, 산출물 체크섬을 기록하며 같은 입력·코드·seed의 결과는 바이트 단위로 재현된다. 기본 seed는 `community-v1`이다. 원문과 산출물은 ignored `references/local/`에 두고 공개 앱과 Git에 넣지 않는다.

## 입력 계약

JSONL의 각 문서는 다음 필드를 가진다.

- `source_id`, `url`, `title`, `source_path`: 고유 문서와 출처.
- `text`, `text_sha256`: 줄바꿈과 `[IMAGE:n]` 위치를 보존한 텍스트 및 정확한 UTF-8 바이트 해시.
- `source_kind`, `language`: 한국어 말투 후보에는 `fan_translation`과 `ko` 조합만 사용한다. 팬 창작·각색·공략 등은 다른 종류를 유지해 격리한다.
- `canonical_event_group`: 같은 사건의 다른 번역·미러·연재를 묶는 검수된 출처 그룹. 확신이 없으면 사건을 추측하지 않고 보수적인 게시글 그룹을 쓴다.
- `game`, `edition`, `period`, `permission_status`: 작품·번역판·시기·이용 상태. 모르는 값은 확인한 것처럼 채우지 않는다.
- 선택적 `speaker_overrides`: 문서별 동명이인·별칭 지도. 예: `{"하루카":"sasahara_haruka"}`. `null`은 일반 별칭 적용을 막는다.
- 선택적 `images`: 원문 이미지 위치와 접근 상태. 이 도구는 이미지를 내려받거나 OCR하지 않는다.

화자 표기는 `키류: 대사`, `키류:\n대사`, `키류\n:\n대사`를 처리한다. 콜론 뒤 첫 줄만 읽으며 무표기 이어말하기를 앞 화자에게 임의 배정하지 않는다. 다음 블록이 무표기 텍스트이면 앞 발화도 불완전할 수 있으므로 응답 후보에서 보류한다. 말투·문장부호·반복은 보존하고 NFC와 공백만 정리한다.

같은 화자가 라벨을 반복하며 이어 말하는 경우도 첫 줄만 목표 답변으로 쓰지 않는다. `possible_labelled_continuation`으로 보류하며 자동으로 합치지 않는다. 순수 문장부호 응답은 `nonlexical_response`로 목표 답변에서 보류하지만, 원문의 이전 문맥에서는 보존할 수 있다. RAG 근거 후보는 최소한 발화형 라벨 블록이 있는 장면으로 제한하며 제목·역자 소개·이미지 링크만 있는 장면은 제외한다.

## 산출물과 검수 수준

| 파일                            | 내용                                                                        |
| ------------------------------- | --------------------------------------------------------------------------- |
| `normalized-blocks.jsonl`       | 원문 줄 범위·문자 오프셋·원문/정리문·화자 표기·보류 종류. 무표기 줄도 보존. |
| `normalized-turns.jsonl`        | 허용된 출처의 화자 표기 발화. 실제 화자 검증 완료를 뜻하지 않음.            |
| `scene-candidates.jsonl`        | 텍스트 제목·장 구분 기반 잠정 장면. 실제 게임 장면 순서는 미검증.           |
| `sft-candidates.jsonl`          | 목표 인물 이전의 최대6발화와 목표 발화 참조. 키류·마지마·하루카 대상.       |
| `rag-candidates.jsonl`          | 원문 근거 블록. 사실 요약이나 운영 RAG 채택 자료가 아님.                    |
| `held.jsonl`                    | 독백·주석·선택지·이미지·미확인 화자·불완전 문맥·중복 창 등의 보류 이유.     |
| `duplicate-groups.jsonl`        | 같은 사건·동일 본문·80자 이상 동일3발화 시퀀스의 출처 그룹.                 |
| `split-groups.jsonl`            | 사건보다 좁게 나누지 않는 잠정 train/dev/test 그룹.                         |
| `report.json`, `checksums.json` | 집계·한계·실행 해시와 산출물 체크섬.                                        |

모든 후보는 `training_eligible:false`이며 모델용 `messages`를 출력하지 않는다. 다른 인물의 발화를 일괄 키류의 `user` 입력으로 바꾸지 않고 실제 화자를 보존한다. 수신자는 `recipient_ids:[]`, RAG 지식 보유자는 `known_by:[]`로 남긴다. 숨은 감정·정답 설명·미래 발화는 입력 이력에 추가하지 않는다. 장면 참여자가 그 사건을 안다고 자동 승인하지 않는다.

독백·괄호 주석·선택지·무표기 문장·미확인 화자·이미지 경계에서는 대화 이력을 끊는다. 같은 사건이나 확인된 긴 중복 시퀀스는 하나의 분할에 묶는다. 짧은 동일 답변이 서로 다른 장면에 나온 것만으로 삭제하지 않는다. `canonical_event_group`이 잘못되거나 알려지지 않은 중복까지 자동 판별한다고 보장하지 않는다.

후속 검수는 원문 대비 화자·장면·시기·번역 출처와 실제 메시지 입력으로의 전환을 다룬다. 팬 말투 평가, 학습 승인, 토큰·손실 마스크 검사, 운영 검색 채택은 별도 단계다. 이 전처리의 test 분할은 프로젝트의 봉인된 최종 평가 자료와 다르다.

검사:

```sh
PYTHONPATH=ai python3 -m unittest ai/tests/test_community.py -v
```

## 원문을 모델 입력으로 변환

```sh
PYTHONPATH=ai python3 -m kiryu_ai.community_inputs \
  --documents references/local/community/documents.jsonl \
  --prepared references/local/community/prepared-v1 \
  --output references/local/community/inputs-v1
```

출력 폴더는 아직 존재하지 않아야 한다. `canonical-messages.jsonl`과 각 train/dev/test 파일은 원문 이어쓰기 과제다. `user`에는 실제 화자명이 있는 이전 발화 기록을, 마지막 `assistant`에는 원문 응답을 넣는다. 다른 인물의 말을 키류의 문자로 바꾸지 않는다. 원문 SHA와 발화 범위를 재구성해 검증하고 기존 사건 분할을 보존한다. 직전 화자는 기록하지만 수신인을 확정하지 않는다. 이 입력은 현재 문자 앱의 추론 입력과 다른 과제이며 자동으로 학습 파일에 합치지 않는다.

별도 작성한 문자 각색은 `--sms <sms-adaptations.jsonl> --profiles <profiles.json>`으로 검사할 수 있다. 각색은 `authored_if`, `official_quote:false`이며 부모 원문 ID·SHA·분할·관계 변경·가시 정보 근거를 요구한다. 다른 상대를 키류로 바꾼 `authored_relationship_adaptation`과 같은 관계에서 새로 쓴 `authored_sms_adaptation`을 구분한다. 원문 답변을 그대로 복제해 창작으로 표시하는 것은 거부한다. `sms-messages.jsonl`은 기존 `build_messages`를 사용하므로 실제 문자 입력 조립 방식과 같다. 두 출력 모두 최초 상태는 `training_eligible:false`다. 형식 검증은 의미·말투·팬 검토 승인이 아니다.

실제 토큰 검사는 `masking.tokenize_sample`, `masking.audit_sample`, `training.audit_actual_batches`를 사용한다. 모델의 실제 템플릿에서 추론 접두부 일치, 답변 첫 토큰부터 종료 토큰까지 포함, 이전 발화·패딩·종료 뒤 개행 제외를 검사한다. 최대 길이를 넘으면 잘라내지 않고 보류한다.

## 이미지 수집과 한국어 OCR

Python 3.11 이상과 macOS의 Swift·Vision을 사용한다. 원문 이미지 URL이 있는 JSONL에는 `source_id`, `source_url`, `url`이 필요하며 순서와 나머지 필드는 출처 연결로 보존한다.

```sh
PYTHONPATH=ai python3 -m kiryu_ai.ocr download \
  --input references/local/community/ocr-backlog.jsonl \
  --output references/local/community/images-v1
swiftc -O ai/tools/vision_ocr.swift -o /tmp/yaku-vision-ocr
PYTHONPATH=ai python3 -m kiryu_ai.ocr recognize \
  --output references/local/community/images-v1 \
  --binary /tmp/yaku-vision-ocr
```

다운로드는 URL SHA로 재개하며 이미지 내용 SHA로 저장·OCR 중복을 제거한다. 기본 동시 요청은 전체4개·호스트2개다. 401/403/429 및 연속3회 5xx/비이미지 응답은 해당 호스트를 중단하고 다른 URL로 우회하지 않는다. 실패를 재시도하려면 `--retry-failures`, 중단 호스트는 추가로 `--retry-stopped-host <host>`가 필요하다. 성공 자료는 해시를 검사해 재사용한다. 원본 목록이 바뀌면 별도 출력 폴더를 사용한다. 접근 실패와 미시도·호스트 중단을 구분해 보고한다.

OCR은 Apple Vision accurate revision3, `ko-KR`·`en-US`, 언어 자동 보정 비활성화를 사용한다. 문자열·대안·신뢰도·정규화 좌표·크기·환경·코드/바이너리 SHA를 저장한다. [Apple의 보정 옵션](https://developer.apple.com/documentation/vision/vnrecognizetextrequest/useslanguagecorrection)을 기록해 인식 문구와 별도 교정문을 혼동하지 않는다. 소스 또는 바이너리가 바뀌면 새 `--result-dir`에 기록한다. 각 실행은 시작 시점의 다운로드 receipt를 대상으로 하며 이후 다시 실행해 추가 이미지를 처리할 수 있다.

`ocr-results.jsonl`은 이미지별 원시 인식, `ocr-source-links.jsonl`은 원문 출처·이미지 순서와 인식 결과 연결이다. `ocr-report.json`은 성공·실패·빈 인식·여러 프레임 이미지를 별도 집계한다. 현재 여러 프레임 이미지는 첫 프레임만 처리한다. OCR 문자열에는 자막 외 UI·배경 글자가 섞이므로 대사 수로 보고하지 않는다. 화자·수신인·장면을 자동 추정하지 않으며 학습 승인은 모두 false로 남긴다. 실제 이미지와의 대조, 자막 범위·줄 연결·화자·상황 검수가 필요하다.

```sh
PYTHONPATH=ai python3 -m unittest ai/tests/test_community_inputs.py ai/tests/test_ocr.py -v
```

## 검수 후 확정

원문·OCR 의미 검토 이후의 학습 내보내기와 작품별 스토리 검색은 [검수 자료 확정 절차](CURATION.md)를 따른다. 원문을 변경하지 않는 검토된 발화 병합, 익명 화자 문맥 복원, 현재 후보 SHA의 승인과 출처 범위 검증을 포함한다.
