# 검수 자료 확정과 스토리 참고 검색

원문 후보를 모델 입력으로 바꾸는 단계와 의미 검토를 통과한 실험 파일을 내보내는 단계를 구분한다. 원본·검수 기록·생성 파일은 `references/local/yakuza-corpus/curation/2026-10-26/`에 보관한다. 공개 Git에는 코드·합성 테스트·출처 색인·수량 보고만 넣는다. 모델 재학습이나 채팅 서비스의 데이터 교체는 수행하지 않는다.

## 한국어 자료

`kiryu_ai.curation`은 원문 문서·화자·범위·분할을 다시 복원하고, 현재 후보 SHA에 대한 에이전트 의미 검토를 확인한다. 승인·검토 보류·제외·미검수를 구분한다. 리뷰의 출처 ID·해시·줄/문자 범위도 실제 문서와 대조한다. 에이전트 검토를 팬 승인이나 공식 한국어 번역 확인으로 표시하지 않는다.

```sh
PYTHONPATH=ai python3 -m kiryu_ai.curation \
  --documents <documents-curated.jsonl> \
  --prepared <processed-final> \
  --candidates <inputs-final/canonical-messages.jsonl> \
  --reviews <reviews/final-canonical-reviews.jsonl> \
  --output <new-release-directory>
```

새 출력 폴더만 허용한다. `canonical/train.jsonl`, `canonical/valid.jsonl`은 원문 이어쓰기 과제이며 `evaluation/canonical-test.jsonl`은 학습 폴더 밖에 둔다. 원작의 여러 화자를 사용자 한 명으로 바꾸지 않는다. 수신인은 여전히 미확인이다. 모델 입력에는 원문 발화와 작품·번역 판본·확인 가능한 시기만 넣고, 판정 근거·정답 감정·후속 발화를 넣지 않는다. 타깃 뒤에서만 확인되는 시기는 입력에서 미확인으로 남긴다.

동일 화자의 이어지는 문장을 복원하려면 문서에 `reviewed_turn_merges`를 추가한다. 각 항목은 원문 해시, 명시 화자, 정렬된 `line_starts`, 검토자와 근거를 요구한다. 원문 텍스트는 바꾸지 않는다. 문구를 재작성하지 않고 화자 접두사와 공백만 정리한다. 이미지 경계는 정확한 `allowed_image_line_starts`로 별도 승인한 경우에만 건너뛴다. 다른 화자·지문·장면 경계를 건너뛰는 병합은 거부한다. 경계 복원 승인과 새 입력 행의 학습 승인은 별개다.

이름이 없는 화자도 원문 라벨을 식별할 수 있으면 문서별 `speaker_overrides`로 `source_local:<source_id>:<actor>`를 부여할 수 있다. 다른 게시글의 익명 인물과 자동 통합하거나 연락처 인물로 바꾸지 않는다.

문자 각색은 다음 세 인자를 함께 추가한다.

```sh
--sms <sms-adaptations.jsonl> \
--sms-reviews <sms-reviews.jsonl> \
--profiles <profiles.json>
```

`authored-sms/`는 새로 작성된 IF 문장만 담는다. 독립 리뷰의 원문 부모·각색 행·프로필 해시와 현재 canonical 승인을 다시 검사한다. 실제 문자 앱의 `build_messages`를 사용하며 원문 이어쓰기와 합치지 않는다. 현재24개는 두 사건에서 파생된 학습용 변형이고 별도의 dev/test가 없다. 빈 검증 파일에 train을 복제하지 않는다. 이 묶음만으로 품질 평가가 가능한 것은 아니다.

`training-provenance.jsonl`, `sms-provenance.jsonl`, `dispositions.jsonl`, `release-manifest.json`에 출처와 승인 범위, 출력 해시를 남긴다. 실제 Qwen 토크나이저의 `masking.tokenize_sample` 및 `audit_sample`으로 접두부·답변/EOS·shift 이후 패딩 제외를 확인한다. 현재 canonical 최대565토큰으로11개가512를 초과하므로1024 상한으로 전량 검사했다. 길이를 잘라 학습하지 않는다.

## OCR 교정과 직접 검토

원시 OCR·원본 이미지·교정문을 각각 보존한다. `ocr_dispositions`는 원본 이미지 레코드 SHA와 검토를 결합하며 직접 보지 않은 이미지는 `unreviewed`로 남긴다. 한국어 문구와 명시 이름표를 확인한 `verified_quote`도 그 자체로 문답 학습을 승인하지 않는다. 화면의 얼굴·글 제목·이미지 나열 순서를 화자나 연속 대화의 증거로 사용하지 않는다.

현재 전체4,316장 중136장을 직접 검토했다. 이름표가 확인된 한국어 인용78개와 실제 메일1개 등을 참고용으로 분리했다. 문맥 후보3개는 캡처 사이 대화 누락을 해소하지 못해 SFT로 내보내지 않았다. 나머지4,180장은 직접 검수 미완료다. 한국어 패치 사용이 확인된 블로그도 패치의 번역판·버전을 모르면 공식 현지화로 표시하지 않는다.

## 전 시리즈 스토리 참고층

[출처 색인](../references/series-source-index.json)은29개 작품·추가 이야기를 다룬다. 공식 소개, 백과사전 줄거리, 공략, 게임 목표문을 구분한다. 리마스터/플랫폼 이식은 판본 별칭으로, 별도 이야기는 별도 ID로 기록한다. 발매 전 작품은 포함하지 않는다.

```sh
PYTHONPATH=ai python3 -m kiryu_ai.story_reference build \
  --sources <story-sources> --output <new-story-rag-directory>
PYTHONPATH=ai python3 -m kiryu_ai.story_reference query \
  --index <story-rag-directory/reference.sqlite> \
  --text '마지마' --game yakuza-kiwami-2-majima --limit 5
```

`manifest.json`, `catalog.json`, `source-associations.json`과 원문·추출물 SHA를 검증한다. 페이지 전체의 작품 목록을 모든 문단에 물려주지 않는다. 각 섹션의 작품/판본·세계관 연결이 명시된 경우만 채택한다. 청크는 해당 섹션의 정확한 문자 범위를 유지하고 출처·개정판·언어·라이선스를 함께 반환한다.

`--game`, `--edition`, `--continuity`, `--layer`로 검색 범위를 제한한다. 레이어는 `plot_reference`, `walkthrough_reference`, `mission_objective`다. Python API의 `excluded_source_ids`는 순위 제한 전에 적용하므로 평가 원문을 제외할 수 있다. SQLite FTS5와 인명 별칭·일본어 문자 색인을 쓰는 어휘 검색이며 임베딩 의미 검색이나 한국어 질문의 자동 번역은 아니다.

공략 참고문은 2차 출처의 주장이고 게임 목표문은 지시·내적 목표일 수 있다. 사건이 완료됐거나 특정 인물이 안다는 증거가 아니다. 모든 행은 `knowledge_scope:world_reference`, `known_by:[]`, `runtime_eligible:false`, `training_eligible:false`다. 현재 앱의 IF 시점·인물별 지식·방문자 기억을 승인하는 별도 정책 없이 서비스에 연결하지 않는다.

전 시리즈의 최소 줄거리/개요 자료는 확보했지만 전체 대본·모든 장·서브스토리의 완전성을 주장하지 않는다. 0 Director’s Cut 추가 장면, 유신 판본 차이, Online 전체 아크, GREE 캠페인 등에 부족 범위가 남는다. 원문 접근 실패·잘못된 리다이렉트·다른 게임이 섞인 공식 HTML도 원문과 함께 기록하고 부적절한 섹션은 제외했다.

## 검사

```sh
PYTHONPATH=ai python3 -m unittest discover -s ai/tests -v
ruff check ai
ruff format --check ai
```

합성 테스트는 오래된 리뷰·허위 승인·원문 범위 변조·화자 혼합·분할 누출·시기 정보 누출·OCR의 학습 승격·RAG 판본/출처 혼합과 검색 필터를 검사한다. 실제 원문 의미·이미지 검토와 팬 평가는 자동 테스트로 대신하지 않는다.
