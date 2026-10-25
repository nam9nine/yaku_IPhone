# Gemma 로컬 추론

Gemma 4 26B-A4B IT의 `Q4_K_M` 원본 모델만 사용한다. 기존 MLX·Qwen 학습 환경과 어댑터는 보존하며 이 실행기에 연결하지 않는다. 모델 품질·응답 시간은 실제 실행 기록으로 따로 판정한다.

## 설치와 고정 값

```sh
sh ai/bootstrap-gemma.sh
```

Apple Silicon macOS에서 Python 3.12.13과 `ai/requirements-gemma.lock`의 hash 고정 패키지를 별도 `.tooling/gemma/venv`에 설치한다. CPU 검색용 ONNX 환경도 이 venv를 사용한다. 설치는 약 16.8 GB의 GGUF를 받으며 projector는 받지 않는다. 다운로드가 중단되면 `.part` 파일에서 재개하고, 완성된 파일의 크기·SHA-256을 확인한다.

| 자료                      | 고정 값                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| llama.cpp                 | `v0.7.0`, commit `620d2225cc436ab0b001e3200e590e3b286ef9ab`        |
| 공식 macOS arm64 바이너리 | 안정 릴리스의 `nightly-tag.txt`가 지정한 `b11669`                  |
| 바이너리 압축 SHA-256     | `dbed55493d72bc1ba2babc8770d669c2289b5bc4ee9fb2a4dfc158d45b7d13fd` |
| GGUF 저장소               | `lmstudio-community/gemma-4-26B-A4B-it-GGUF`                       |
| GGUF revision             | `f6e6747823b2912661935db7e0009287c4838073`                         |
| 모델 파일                 | `gemma-4-26B-A4B-it-Q4_K_M.gguf`                                   |
| 모델 SHA-256              | `e19514d9541344001cb7c8eaf88704b8bf2e5d8f4e9aac12402eed360cffdfc4` |
| 파일 크기                 | 16,796,017,248 bytes                                               |

원본: [llama.cpp v0.7.0](https://github.com/ggml-org/llama.cpp/releases/tag/v0.7.0), [지정 바이너리](https://github.com/ggml-org/llama.cpp/releases/tag/b11669), [고정 모델](https://huggingface.co/lmstudio-community/gemma-4-26B-A4B-it-GGUF/tree/f6e6747823b2912661935db7e0009287c4838073).

## 서버와 API 계약

`GemmaProcess(executable, model, directory, port=8791).start()`는 해당 프로세스만 소유하고 `GemmaEngine`을 반환한다. `.close()`는 소유한 프로세스만 종료한다. 다른 MLX·앱 프로세스를 임의 종료하지 않는다. 모델을 함께 적재하면 24 GB 메모리를 초과할 수 있으므로 기존 추론 서비스의 정상 종료와 기록 스냅샷을 먼저 수행한다.

```sh
PYTHONPATH=ai .tooling/gemma/venv/bin/python -m kiryu_ai.gemma_engine --directory .tooling/gemma
```

Ctrl+C 또는 SIGTERM은 이 실행기가 시작한 모델만 종료한다. API 실행기는 `GemmaEngine(api_key_file='.tooling/gemma/model-api-key.txt', manifest_path='.tooling/gemma/runtime-manifest.json')`으로 연결한다. 모델 포트를 Tunnel의 목적지로 설정하지 않는다.

- `127.0.0.1:8791`, 단일 슬롯, 문맥 4,096 토큰, 출력 최대 256 토큰.
- `--reasoning off`, `enable_thinking=false`, `reasoning_effort=none`. `reasoning_format=none`은 thinking 비활성화가 아니므로 사용하지 않는다.
- `cache_prompt=false`, RAM prompt cache 0, 자동 문맥 삭제 없음.
- `temperature=1.0`, `top_p=0.95`, `top_k=64`, 추가 min-p·presence/frequency penalty 없음.
- Web UI·projector 없음. 프로세스마다 별도 무작위 모델 API 키를 만들고 0600 파일에 보관한다. 이 키를 공개 Worker에 전달하지 않는다.
- 모델·압축·실행 파일·동적 라이브러리 해시를 검증한다. 실행 후 `/props`의 실제 내장 템플릿 해시를 `runtime-manifest.json`에 기록한다.

`GemmaEngine.count_tokens(messages)`는 `/apply-template` 결과를 `/tokenize`로 세며 출력 예약분을 포함해 4,096 한도를 지킨다. Qwen 템플릿을 재사용하거나 문자열 길이로 토큰 수를 추정하지 않는다. 역할은 `system → 실제 user/assistant 대화 → user`이며 모델 제어 구분자를 입력 본문에 허용하지 않는다.

`reply(messages, seed=None, max_tokens=256)`는 내부 SSE를 읽되 성공한 최종 문자만 반환한다. 반환값에는 `reply`, `finish_reason`, `total_seconds`, `ttft_seconds`, `prompt_tokens`, `completion_tokens`, 생성 설정·manifest가 포함된다. TTFT는 이 요청의 모델 HTTP 전송부터 첫 내용 조각까지이며 모델 최초 로딩·외부 대기열 시간은 포함하지 않는다. 준비된 입력의 토큰 계산 시간은 별도 API 단계다.

생성 요청의 전체 제한은 60초다. 각 read의 timeout뿐 아니라 전체 deadline으로 소켓을 중단한다. `GemmaFailure.code`는 공개 가능한 원인 코드이며 `.result`에는 확보한 부분 답변과 측정값이 있다. 이를 실패 검토용 DB에 보관하고 정상 UI·다음 대화 이력에는 넣지 않는다. thinking delta는 저장하지 않는다. 길이 종료·비어 있는 답장·누락된 종료 이벤트·제어 토큰 출력은 성공으로 반환하지 않는다.

근거: [서버 HTTP 계약](https://github.com/ggml-org/llama.cpp/blob/v0.7.0/tools/server/README.md), [Gemma 공식 템플릿](https://ai.google.dev/gemma/docs/core/prompt-formatting-gemma4), [공식 생성 기본값](https://huggingface.co/google/gemma-4-26B-A4B-it/blob/4d7ae4984b7db7de8f8457170b3f1a419ee76d52/generation_config.json).

## 검증

```sh
PYTHONPATH=ai .tooling/ai61/venv/bin/python -m unittest discover -s ai/tests -p test_gemma_engine.py -v
```

휴대폰 API·DB·RAG는 통합 검사를 별도로 수행한다. HTTP 모형 테스트 통과를 실제 Metal 추론, 24 GB 적합성, p95 20초 달성 또는 팬 검수 완료로 기록하지 않는다.
