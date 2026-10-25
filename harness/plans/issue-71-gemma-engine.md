# Issue #71 · Gemma 실행기와 입력 계약

Gemma 4 26B-A4B IT Q4_K_M과 llama.cpp v0.7.0의 고정 아티팩트를 로컬에 준비한다. 모델·바이너리·embedded template 해시를 manifest에 남기고 Qwen 학습 코드와 분리한다.

- native template/tokenizer로 입력을 계산하고 4,096 문맥에서 출력 256토큰을 예약한다.
- 단일 슬롯, thinking OFF, KV 재사용·자동 문맥 이동 OFF와 공식 샘플링을 적용한다.
- private loopback 키로 모델 포트를 보호하고 소유한 프로세스만 시작·종료한다.
- 잘림·timeout·control token·thought/tool 출력은 정상 답장으로 통과시키지 않는다.
- CPU protocol 검사, 실제 모델 토큰 일치와 추론, 독립 리뷰를 거쳐 PR을 전달한다.

단일 smoke와 실제 인물 품질·p95 측정은 구분한다. 다중턴·RAG·공개 연결 평가는 #72–74에서 수행한다.
