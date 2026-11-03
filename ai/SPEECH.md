# 통화 음성 입력

휴대폰과 native Web Speech 미지원 브라우저는 마이크를 한 번만 열어
MediaRecorder로 수집한다. 마이크를 끄거나 30초가 지나면 기존 인증된
음성 저장 API에 `transcribe=1`을 붙여 전송한다. 원음은 먼저 보존하고,
Mac의 Whisper가 같은 파일을 한국어로 변환한다. 인식 결과는 읽기 전용이며
사용자가 `말 보내기`를 눌러야 통화 대화에 접수된다. 키보드 입력은 없다.

WebKit의 [동시 음성 인식·마이크 문제 보고](https://bugs.webkit.org/show_bug.cgi?id=321436)를
참고했다. 지연을 두고 두 마이크 사용자를 시작하는 방식은 사용하지 않는다.
노트북의 native 인식은 유지하며 별도 파일 저장 실패가 인식을 취소하지 않는다.
WebKit은 `navigator.audioSession`이 `auto`나 `play-and-record`일 때만 마이크를
허용하고, 메시지 알림음은 탭마다 `auto`·`ambient` 세션을 `transient`로 바꾼다. 그래서 녹음과
인식이 마이크를 쓰는 동안만 `play-and-record`를 잡고 끝나면 이전 값으로 되돌린다.
통화 종료·화면 숨김 뒤 도착한 변환 결과는 현재 입력에 반영하지 않는다.

## Mac 준비

Gemma 환경과 별개로 설치한다. 추가 GPU 모델이나 공개 포트를 열지 않는다.

```sh
python3.12 -m venv .tooling/speech/venv
.tooling/speech/venv/bin/pip install -r ai/requirements-speech.lock
.tooling/speech/venv/bin/python - <<'PY'
from huggingface_hub import snapshot_download
snapshot_download(
    'Systran/faster-whisper-small',
    revision='536b0662742c02347bc0e980a01041f333bce120',
    local_dir='.tooling/speech/model',
    allow_patterns=['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt'],
)
PY
```

[faster-whisper 공식 구현](https://github.com/SYSTRAN/faster-whisper)의
CPU INT8 추론을 사용한다. 모델은 multilingual small, 한국어 고정,
CPU 4 threads, 동시 1개, 입력 최대 35초, 실행 최대 60초다.
요청 중 모델 다운로드는 금지한다. 공개 Worker는 음성 변환 요청만
75초, 클라이언트는 90초까지 기다린다. 변환 실패해도 원음은 남는다.
다른 변환이 진행 중이면 대기열을 늘리지 않고 재시도 오류를 반환한다.

원음은 `references/local/gemma-chat/state/recordings/`의 기존 인증된
방문자/인물 경로에 저장한다. 변환만으로 메시지·RAG 기억을 만들지 않는다.
기존 저장 전용 API와 구버전 클라이언트도 유지한다.

## 이번 확인 범위

2026-11-02 한국어 합성 음성 M4A·WebM을 실제 Whisper로 변환하고,
API가 저장한 파일 해시가 업로드 원음과 같은지 확인했다.
합성 발화의 조사 `저녁에`가 `저녁의`로 출력되는 오인식은 관찰했다.
실제 사람의 목소리·잡음·iPhone 마이크 품질까지 검증한 결과는 아니다.
모델 파일·의존성 해시는 ignored `.tooling/speech/runtime-manifest.json`에 남긴다.
