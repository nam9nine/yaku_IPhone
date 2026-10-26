# Gemma 문자 답장의 Thinking

Thinking은 최종 문자 전에 모델이 별도 thought 채널을 생성하는 기능이다. 답장 애니메이션을 늦추는 시간과는 별개이며 오래 계산한 사실만으로 품질 개선을 판정하지 않는다. 방문자와 다음 턴 입력에는 최종 답장만 포함한다.

## 고정 실행 계약

- Gemma 4 26B-A4B IT Q4_K_M와 llama.cpp v0.7.0의 기존 파일·revision·해시를 유지한다.
- native template에 `enable_thinking=true`를 전달한다. OFF 비교만 `enable_thinking=false`, `reasoning_effort=none`을 사용한다. 이 모델 템플릿은 `high` 같은 추론 강도 값을 소비하지 않으므로 그런 이름으로 깊이를 설정했다고 표현하지 않는다.
- 입력과 전체 생성 예산의 합은 6,144토큰 이하다. 전체 생성 상한은 3,072토큰, 요청 전체 제한은 120초다. 최종 문자 길이는 프롬프트의 짧은 문자 규칙을 따른다. 생성 토큰 수에는 thought와 제어 형식도 포함된다.
- `reasoning_budget_tokens=-1`로 생각 블록을 중간에 강제로 닫지 않는다. 전체 토큰·시간 한도는 유지한다. 512토큰 블록 제한의 개발 실험에서는 강제 종료 뒤 검토 문장이 최종 채널에 이어지고 전체 길이 제한에 걸린 사례가 있어 채택하지 않았다.
- `reasoning_format=deepseek`의 `reasoning_content`는 읽고 버리며 저장·전달하지 않는다. 최종 내용에 raw control token이 나타나면 실패로 처리하고 그 내용도 저장하지 않는다. 잘림·빈 최종 답장·정상 종료 누락을 정상 문자로 보내지 않는다.
- KV 재사용·자동 문맥 잘라내기·다른 모델 fallback은 사용하지 않는다. 한 생성 슬롯과 방문자별 DB 범위를 유지한다. 종료 대기 시간도 최대 추론 시간보다 길게 둔다.

현재 입력 조립은 인물 카드, 고정 핵심 관계, 승인된 IF 시작 상태, 실제 최근 교환, 검색한 과거 대화와 원작 참고 자료를 구분한다. 모델에 같은 내용을 여러 형식으로 반복하지 않으며 검토용 관계 ID·출처·원문 SHA는 실행 메타데이터와 근거 기록에 보존한다.

## 근거와 검증의 구분

[Google Thinking 문서](https://ai.google.dev/gemma/docs/capabilities/thinking)와 실제 GGUF 내장 템플릿을 대조했다. [고정 llama.cpp 요청 처리](https://github.com/ggml-org/llama.cpp/blob/620d2225cc436ab0b001e3200e590e3b286ef9ab/tools/server/server-common.cpp), [블록 예산 처리](https://github.com/ggml-org/llama.cpp/blob/620d2225cc436ab0b001e3200e590e3b286ef9ab/common/reasoning-budget.cpp), [Gemma parser](https://github.com/ggml-org/llama.cpp/blob/620d2225cc436ab0b001e3200e590e3b286ef9ab/common/parsers/gemma4.cpp)를 확인했다. 템플릿 해시는 실행 manifest에 기록한다.

공식 문서는 이 한국어 캐릭터 과제의 품질 향상을 증명하지 않는다. 합성 개발 문항 30개와 작성자를 분리한 독립 문항 28개에서 말투·판단·관계·지식·문맥·형식을 별도로 검토한다. 실패도 분모에 포함하고 팬 검토는 별도로 남긴다. 4,096토큰으로 실행한 개발 결과를 6,144토큰 운영 환경의 메모리 검증이라고 표시하지 않는다.

로컬 실행 기록은 `references/local/gemma-chat/quality83/`, 소스 대조 자료는 `.tooling/reply84/research/`에 보관한다. 이 디렉터리에는 합성 진단만 저장하며 실사용 원문을 공개 자료로 옮기지 않는다.

```sh
PYTHONPATH=ai .tooling/gemma/venv/bin/python -m kiryu_ai.chat_evaluate \
  --registry ai/chat/registry.json --cards ai/chat/cards.json \
  --fixtures ai/chat/conversation-repair-dev.json \
  --api-key-file .tooling/gemma/model-api-key.txt \
  --manifest /tmp/evaluation-manifest.json \
  --embedding-dir .tooling/gemma/embeddings \
  --thinking on --reasoning-tokens -1 --context-tokens 6144 --max-tokens 3072 \
  --output /tmp/fresh-evaluation-output
```

평가에는 운영 manifest를 복사한 별도 파일을 사용한다. 토큰 예산은 실제 실행 중인 서버의 문맥 크기를 넘기지 않아야 한다. 실행기는 결과 파일이 있는 출력 폴더를 덮어쓰지 않는다. 속도 측정치는 관찰값이며 과거의 20초 완료 목표는 품질 우선 요청으로 더 이상 채택 기준이 아니다.
