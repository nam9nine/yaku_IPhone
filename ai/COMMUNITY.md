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
