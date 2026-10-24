# Issue 47 재전처리 검증

환경은 macOS 26.5.2 arm64, Node 24.22.0, Vitest 5.0.5다. 대상은 [Issue 47](https://github.com/nam9nine/yaku_IPhone/issues/47)이며 UI·정규화·분류 규칙은 변경하지 않았다.

## 손상 입력과 정리

수정 전 실제 reader의 합성 truncated gzip을 0·1·5·25ms 소비 지연으로 실행했고, 각각 46·16·11·32번째 시도에 uncaught `Z_BUF_ERROR`와 exit 90을 관찰했다. 원본 로그는 전용 worktree의 `.tooling/stream-audit-47/before-*.log`에 보존했다. 이는 Node upstream 결함을 확정하는 주장이 아니다.

수정 후 같은 지연별 200회, 총 800회는 호출자에게 정상 reject했고 프로세스는 exit 0이었다. 별도 subprocess fixture는 uncaught handler 없이 strict rejection과 4초 종료 제한을 사용한다. 정상 10,000행, 파일 읽기 오류, JSON/UTF-8 오류, 조기 break, 소비자 throw 뒤 실제 파일 descriptor 종료를 확인했다. 전처리 실패 후 이전 run과 latest 보존·lock 및 임시 파일 제거·정상 재실행도 확인했다. 관련 테스트 26개를 연속 세 번 통과했으며 기존 5초 테스트 제한은 늘리지 않았다.

## 실제 코퍼스

고정된 원본 8개, 총 66,641,322바이트의 크기·SHA-256을 다시 검증했다. 데이터 revision은 `c153d877b4af9c66026ee6fa4eefbc29dd8c11b0`이다. 원문을 새로 수정하거나 덮어쓰지 않았다.

`node scripts/preprocess-yakuza.mjs --data-dir /Users/namgyu/yaku_IPhone/references/local/yakuza-corpus`를 두 번 실행했다. 새 run은 `19ecc5cef2b47ca30326eeb2`이며 두 번째 실행은 전수 재처리 후 `reproduced: true`였다. 입력·정규화 행은 각각 285,971개다.

이전 run `284224254b0e44d9534b15f1`과 비교해 정규화 gzip 8개 및 JSONL 색인 6개, 총 14개 payload의 바이트 수와 SHA-256이 모두 같았다. 구현 fingerprint와 run ID를 기록하는 `configuration.json`·`report.json`만 달라졌다. 새 run의 전체 출력 해시를 실제 파일과 대조했고 잔여 임시 run이나 처리 lock은 없었다. 두 run은 모두 로컬에 보존한다.

한국어가 있는 행 168,649개, 대사/메일 검토 후보 52,290개이며 학습 가능 행은 여전히 0개다. 오류 수정은 화자·청자·대화 순서 검증을 대신하지 않는다. 키류 또는 우선 인물 명단으로 다른 인물과 언어를 제거하지 않았다. 다음 대사/메일 품질 분리는 별도 Issue 51에서 파생 자료로 진행한다.

`npm run check`는 타입·lint·포맷·단위 검사·빌드·하네스를 통과했다. 결과 집계·해시는 `references/yakuza-preprocessing-report.json`에 보관한다. 원문과 정규화 텍스트는 ignored 로컬 디렉터리에만 있으며 공개 앱 번들·CI artifact에는 넣지 않는다. 직접 시각 검토는 데이터 전용 변경이므로 미적용이고, 저장소 CI의 브라우저 실행 정책은 유지한다.
