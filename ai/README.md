# 마지마·하루카 로컬 AI 실험

한국어 IF 문자 데이터의 검수·내보내기, MLX QLoRA, 실제 로컬 추론을 재현하는 명령이다. 현재 활성 대상은 **마지마와 하루카 두 명**이며 웹 메시지 앱에는 연결하지 않았다. 이 문서는 실행법이며 최종 성능·팬 평가 결과를 뜻하지 않는다.

공식 자료 원문과 출처가 있는 사실 요약, 에이전트가 새로 쓴 `authored_if` 문자, 팬 판정을 구분한다. 수집한 대본 후보가 자동으로 학습 승인을 받지는 않는다. 현재 파일럿의 문자 답변은 공식 한국어 대사 인용이 아닌 창작이며, 팬 검수는 실제 추론 결과를 보고 별도로 진행한다.

## 환경과 저장 위치

Apple Silicon Mac과 `uv`가 필요하다. 저장소 루트에서 실행한다. 설치 스크립트는 Python 3.12.13과 해시가 고정된 `requirements.lock`을 사용한다. 모델 원문·데이터·어댑터·대화 기록은 ignored 로컬 경로에 두며 Git이나 Pages 산출물에 넣지 않는다.

```sh
sh ai/bootstrap.sh
ai_python="$PWD/.tooling/character-ai/venv/bin/python"
ai_data="$PWD/references/local/kiryu-ai-2026-10-25"
export PYTHONPATH="$PWD/ai"
mkdir -p "$ai_data"
```

새 checkout에는 private 데이터가 없다. 아래 절차의 `profiles.json`, `authored-samples.jsonl`, `reviews/initial-independent.jsonl`, `dev-cases.jsonl`, `scenario-facts.json`, 원문 주석 `sources/annotations.json`은 해당 로컬 자료 묶음을 준비해야 한다. 소스 수집 명령이 이 검수·저작 자료까지 자동 생성하지는 않는다.

## 자료와 모델 확보

```sh
"$ai_python" -m kiryu_ai.sources \
  --catalog ai/source-catalog.json \
  --output "$ai_data/sources" \
  --annotations "$ai_data/sources/annotations.json"

"$ai_python" -m kiryu_ai.models \
  --model 4b \
  --output "$ai_data/models"
```

수집 결과는 `sources/manifest.json`에서 성공·제외·실패를 구분한다. 원문 SHA와 접근 기록을 남기고, 기본 재실행은 검증된 캐시를 쓴다. 최신 원문을 의도적으로 다시 확인할 때만 `--refresh`를 사용한다. 카탈로그에서 제외한 사이트를 우회 수집하지 않는다. 주석의 근거 구간이 원문에서 확인되지 않으면 사실 자료로 통과시키지 않는다.

모델은 `models.py`에 고정한 revision으로 받으며 파일별 해시는 `models/4b/receipt.json`에 남는다. `--model 9b` 또는 `--model all`도 지원하지만 다운로드 가능성이 해당 Mac의 학습 적합성을 의미하지는 않는다. 모델 저장소의 원격 코드는 실행하지 않는다.

## 데이터 검사와 학습용 내보내기

```sh
"$ai_python" -m kiryu_ai.data \
  --samples "$ai_data/data/authored-samples.jsonl" \
  --profiles "$ai_data/data/profiles.json"

"$ai_python" -m kiryu_ai.data \
  --samples "$ai_data/data/authored-samples.jsonl" \
  --profiles "$ai_data/data/profiles.json" \
  --reviews "$ai_data/data/reviews/initial-independent.jsonl" \
  --characters majima haruka \
  --output "$ai_data/data/replay-pilot"
```

검수 기록에는 `sample_id`, 현재 행의 `sha256`, `profiles_file_sha256`, `character_profile_sha256`, `reviewer`, `verdict: "pass"`, 판단 근거 `basis`가 필요하다. 행이나 인물 설정을 바꾼 뒤 예전 승인을 재사용하거나 저작자가 자기 검토로 승인하면 내보내기가 실패한다. 기존 출력 경로도 덮어쓰지 않는다. 팬 승인은 자동 부여하지 않는다.

출력은 `train.jsonl`, `valid.jsonl`, `provenance.jsonl`, `manifest.json`이다. 학습에는 마지막 인물 답변을 추가하고, 추론에는 같은 `build_messages` 입력 조립기에서 그 답변을 제외한다. 같은 상황 그룹의 분할 혼입과 중복 대화를 검사한다. `sealed-final.jsonl`은 개발·학습에 사용하지 않으며 아래 개발 평가 준비 명령도 최종 평가 자료를 거부한다.

## 토큰 감사와 학습

먼저 실제 토크나이저와 shift·padding이 적용된 배치에서 손실 범위를 검사한다. 이전 메시지·패딩·종료 뒤 개행을 제외하고 마지막 답변 첫 토큰부터 종료 토큰까지 포함해야 한다.

```sh
"$ai_python" -m kiryu_ai.training \
  --model "$ai_data/models/4b" \
  --model-revision 0e7ffd5c629ef7719d4cbc04069232580bfa9d9c \
  --data-dir "$ai_data/data/replay-pilot" \
  --output "$ai_data/runs/replay-token-audit" \
  --max-seq-length 512 \
  --audit-only
```

M5·24GB에서 확인한 현재 파일럿의 최대 길이는 답변 포함 **343토큰**이다. 512 설정은 이 자료를 자르지 않는다. 반면 **2,048토큰 진단 학습에서는 메모리 부족을 관찰했다.** 이를 성공한 학습 길이로 기록하거나 길이만 늘려 같은 조건이 성립한다고 가정하지 않는다. 길이 제한을 넘는 예시는 조용히 자르지 않고 거부한다.

짧은 진단은 별도 출력 경로에서 실행한다. `--limit`은 학습 자료에만 적용되며, `--val-batches`로 진단 검증량을 제한할 수 있다.

```sh
"$ai_python" -m kiryu_ai.training \
  --model "$ai_data/models/4b" \
  --data-dir "$ai_data/data/replay-pilot" \
  --output "$ai_data/runs/replay-diagnostic" \
  --limit 8 --iters 16 --accumulation 1 --val-batches 4 \
  --max-seq-length 512 --memory-gib 12
```

토큰 감사·유한한 손실·가중치 변화·저장본 재로드를 확인한 뒤 파일럿을 실행한다. 학습과 추론을 동시에 띄우지 않는다.

```sh
"$ai_python" -m kiryu_ai.training \
  --model "$ai_data/models/4b" \
  --model-revision 0e7ffd5c629ef7719d4cbc04069232580bfa9d9c \
  --data-dir "$ai_data/data/replay-pilot" \
  --output "$ai_data/runs/replay-pilot-4b" \
  --iters 400 --accumulation 8 \
  --max-seq-length 512 --memory-gib 12 \
  --num-layers 8 --rank 8 --scale 2 \
  --learning-rate 0.00001 --seed 42 \
  --eval-every 200 --save-every 200
```

학습 200개를 쓰는 이 명령의 400회는 microstep이며 실제 갱신은 50회다. `--memory-gib`는 MLX 메모리 지침 값이고 강제 상한은 아니다. 실행마다 새 출력 디렉터리를 사용한다. `manifest.json`의 상태·실제 갱신 수·어댑터 해시·재로드 검증과 `training.jsonl`, `token-audit.jsonl`을 확인한다. 손실 감소만으로 캐릭터 품질 통과를 선언하지 않는다.

## 고정 입력으로 기본 모델과 어댑터 비교

파일럿 출력 검토 전에 정한 임시 공학 기준은 [evaluation-policy.json](evaluation-policy.json)에 있다. 소수 문항의 통과를 통계적 우월성이나 팬 승인으로 해석하지 않는다. 선택 기준을 바꾸면 이유와 시점을 별도로 남긴다.

개발 문항·프로필·채택한 사실을 한 번 조립한다. 사실 on/off 모두 동일한 대화 이력과 `known_context`를 유지한다. 여기서 on/off는 고정 사실 묶음의 유무이며 실시간 검색기 평가가 아니다. off 문항에도 `known_context`에 답에 필요한 사실이 있을 수 있다.

```sh
"$ai_python" -m kiryu_ai.evaluation prepare \
  --cases "$ai_data/data/dev-cases.jsonl" \
  --profiles "$ai_data/data/profiles.json" \
  --knowledge "$ai_data/sources/knowledge.jsonl" \
  --scenario "$ai_data/data/scenario-facts.json" \
  --output "$ai_data/eval/replay-prepared"

"$ai_python" -m kiryu_ai.inference \
  --model "$ai_data/models/4b" \
  --requests "$ai_data/eval/replay-prepared/requests.jsonl" \
  --output "$ai_data/eval/replay-base.jsonl" \
  --seed 42 --max-tokens 128 --temperature 0.7 --top-p 0.8 --top-k 20

"$ai_python" -m kiryu_ai.inference \
  --model "$ai_data/models/4b" \
  --adapter "$ai_data/runs/replay-pilot-4b" \
  --requests "$ai_data/eval/replay-prepared/requests.jsonl" \
  --output "$ai_data/eval/replay-trained.jsonl" \
  --seed 42 --max-tokens 128 --temperature 0.7 --top-p 0.8 --top-k 20

"$ai_python" -m kiryu_ai.evaluation summary \
  --results "$ai_data/eval/replay-trained.jsonl" \
  --key "$ai_data/eval/replay-prepared/private-key.jsonl" \
  --output "$ai_data/eval/replay-trained-summary.json"

"$ai_python" -m kiryu_ai.evaluation blind \
  --requests "$ai_data/eval/replay-prepared/requests.jsonl" \
  --base "$ai_data/eval/replay-base.jsonl" \
  --trained "$ai_data/eval/replay-trained.jsonl" \
  --output "$ai_data/eval/replay-blind" \
  --seed 42
```

판정 파일 없이 만든 summary의 품질 점수는 미검토 상태다. 판단 근거·검토자 종류·실제 응답 해시가 있는 `--judgments`를 전달해야 정확도와 문맥 쌍의 두 조건 통과 수를 계산한다. 팬 말투 점수와 독립 에이전트 판정은 별도 집계한다. 블라인드 검토에는 `comparison.jsonl`을 사용하고, 정답 매핑 `private-mapping.jsonl`은 평가자에게 보여주지 않는다. 팬 투표 집계는 다음과 같다.

`fan-votes.jsonl`의 각 행에는 `blind_id`, 해당 비교 파일의 `comparison_sha256`, `preference`(`A`·`B`·`tie`), `reviewer_kind: "fan"`, 실제 검토자 `reviewer`, 판단 근거 `basis`를 기록한다. 에이전트 투표와 팬 투표는 파일과 집계를 분리한다.

```sh
"$ai_python" -m kiryu_ai.evaluation votes \
  --mapping "$ai_data/eval/replay-blind/private-mapping.jsonl" \
  --votes "$ai_data/eval/fan-votes.jsonl" \
  --output "$ai_data/eval/fan-vote-summary.json"
```

추론 실행기는 **한 프로세스에 모델 한 개를 올리고 FIFO로 순차 처리**한다. `--burst 2` 또는 `--burst 4`는 묶음 내 요청이 동시에 도착했다고 보고 대기시간을 포함하는 실험이며 병렬 추론이나 운영 서버 부하 시험이 아니다. 요청마다 KV 캐시를 새로 만들고 모델 로딩 시간은 요청 지연과 따로 기록한다. p50/p95는 표본 수·실제 생성 길이와 함께 읽는다. 출력 한도에 걸린 응답은 `finish_reason: "length"`로 남는다.

## 직접 대화

실제 생성 응답을 다음 턴에 넣는 24턴 개발 진단도 실행할 수 있다. 입력 일정 정정·물건 위치·모름 대응을 검사하며 결과의 `private-rubric.jsonl`은 모델에 전달하지 않는다. 잘린 답변 이후의 턴은 건너뛴 것으로 기록한다.

```sh
"$ai_python" -m kiryu_ai.conversations \
  --data-root "$ai_data" --model "$ai_data/models/4b" \
  --adapter "$ai_data/runs/replay-pilot-4b" \
  --output "$ai_data/eval/replay-conversations"
```

기본 모델은 `--adapter` 없이, 학습 모델은 저장 디렉터리를 명시해 실행한다. `--model`을 명시하면 선택 파일의 어댑터를 암묵적으로 가져오지 않는다.

```sh
KIRYU_AI_PYTHON="$ai_python" KIRYU_AI_DATA="$ai_data" \
  sh ai/chat.sh --character majima --visitor local-demo \
  --model "$ai_data/models/4b" \
  --adapter "$ai_data/runs/replay-pilot-4b"

KIRYU_AI_PYTHON="$ai_python" KIRYU_AI_DATA="$ai_data" \
  sh ai/chat.sh --character haruka --visitor local-demo \
  --model "$ai_data/models/4b" \
  --message '오늘은 약속을 한 시간 늦춰도 되겠니?'
```

대화 종료는 `/quit` 또는 `/exit`다. `--no-facts`로 채택한 원작 사실을 제외할 수 있다. `--message`는 한 번 답하고 종료하지만 정상적으로 끝난 답변은 세션에 저장한다. 입력과 출력 예산의 합이 2,048토큰을 넘으면 이 실행기는 입력을 거부하며 자동으로 오래된 대화를 지우지 않는다. 이는 실행기의 입력 제한이며 2,048토큰 학습 성공을 의미하지 않는다.

대화는 `sessions/` 아래 로컬 JSON에 저장하며 방문자·인물·시나리오 버전으로 구분한다. `--visitor`는 로컬 분리 키이므로 다른 키를 지정하면 다른 대화를 시작할 수 있다. 로그인·접근 제어·암호화가 있는 공개 인증 서비스가 아니며, 이 키만으로 외부 이용자를 인증해서는 안 된다. 모델·대화 파일을 웹 앱에 노출하거나 이 실행기를 외부 서버로 개방하지 않는다.

## 코드 검사

```sh
"$ai_python" -m unittest discover -s ai/tests -v
"$ai_python" -m ruff check ai
"$ai_python" -m ruff format --check ai
```

Apple Silicon 실행 환경에는 `requirements.lock`, GPU가 없는 휴대 가능한 코드 검사에는 `requirements-ci.lock`을 사용한다. 코드 검사 통과, 실제 학습 실행, 팬의 인물성 평가는 서로 다른 결과로 기록한다.
